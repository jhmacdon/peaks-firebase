import { Router, Response } from "express";
import db from "../db";

const router = Router();

/**
 * Merge averages and averages_offset by summing month/day counters.
 * Either or both may be null.
 */
export function mergeAverages(
  averages: any | null,
  offset: any | null
): any | null {
  if (!offset) return averages;
  if (!averages) return offset;

  const merged: any = { months: {}, days: {} };

  // Merge months
  const allMonths = new Set([
    ...Object.keys(averages.months || {}),
    ...Object.keys(offset.months || {}),
  ]);
  for (const m of allMonths) {
    merged.months[m] =
      ((averages.months || {})[m] || 0) + ((offset.months || {})[m] || 0);
  }

  // Merge days (handle both "days" and "weekdays" keys from Firestore)
  const avgDays = averages.days || averages.weekdays || {};
  const offDays = offset.days || offset.weekdays || {};
  const allDays = new Set([...Object.keys(avgDays), ...Object.keys(offDays)]);
  for (const d of allDays) {
    merged.days[d] = (avgDays[d] || 0) + (offDays[d] || 0);
  }

  const avgUpdated = averages.lastUpdated;
  const offsetUpdated = offset.lastUpdated;
  if (avgUpdated && offsetUpdated) {
    merged.lastUpdated = avgUpdated > offsetUpdated ? avgUpdated : offsetUpdated;
  } else if (avgUpdated) {
    merged.lastUpdated = avgUpdated;
  } else if (offsetUpdated) {
    merged.lastUpdated = offsetUpdated;
  }

  return merged;
}

// GET /api/destinations/averages?ids=id1,id2,id3
// Bulk merged averages (live aggregation from session_destinations +
// tracking_sessions, merged with averages_offset for pre-migration historical
// data). Replaces the legacy Firestore "averages" collection lookup on iOS.
// Must precede /:id so the literal "averages" segment isn't captured as an id.
router.get("/averages", async (req, res: Response) => {
  const idsParam = (req.query.ids as string) || "";
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    res.json({});
    return;
  }

  const liveResult = await db.query(
    `SELECT
       sd.destination_id,
       EXTRACT(MONTH FROM ts.start_time)::int AS month,
       EXTRACT(DOW FROM ts.start_time)::int AS dow,
       COUNT(*)::int AS cnt,
       MAX(ts.start_time) AS last_session_at
     FROM session_destinations sd
     JOIN tracking_sessions ts ON ts.id = sd.session_id
     WHERE sd.destination_id = ANY($1::text[])
       AND sd.relation = 'reached'
       AND ts.start_time IS NOT NULL
     GROUP BY sd.destination_id, month, dow`,
    [ids]
  );

  const offsetResult = await db.query(
    `SELECT id, averages_offset FROM destinations WHERE id = ANY($1::text[])`,
    [ids]
  );

  const monthNames = [
    "",
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  const dayNames = ["su", "mo", "tu", "we", "th", "fr", "sa"];

  const live: Record<
    string,
    {
      months: Record<string, number>;
      days: Record<string, number>;
      lastUpdated: string | null;
    }
  > = {};
  for (const row of liveResult.rows) {
    const id = row.destination_id;
    if (!live[id]) live[id] = { months: {}, days: {}, lastUpdated: null };
    const m = monthNames[row.month];
    const d = dayNames[row.dow];
    if (m) live[id].months[m] = (live[id].months[m] || 0) + row.cnt;
    if (d) live[id].days[d] = (live[id].days[d] || 0) + row.cnt;
    const ts = row.last_session_at
      ? new Date(row.last_session_at).toISOString()
      : null;
    if (ts && (!live[id].lastUpdated || ts > live[id].lastUpdated)) {
      live[id].lastUpdated = ts;
    }
  }

  const offsetMap = new Map<string, any>(
    offsetResult.rows.map((r: any) => [r.id, r.averages_offset])
  );

  const out: Record<string, any> = {};
  for (const id of ids) {
    const liveData = live[id] || null;
    const offsetData = offsetMap.get(id) || null;
    const merged = mergeAverages(liveData, offsetData);
    if (!merged) continue;
    const liveTs = liveData?.lastUpdated;
    const offsetTs = offsetData?.lastUpdated;
    if (liveTs && offsetTs) {
      merged.lastUpdated = liveTs > offsetTs ? liveTs : offsetTs;
    } else if (liveTs) {
      merged.lastUpdated = liveTs;
    } else if (offsetTs) {
      merged.lastUpdated = offsetTs;
    }
    out[id] = merged;
  }

  res.json(out);
});

// GET /api/destinations/nearby?lat=46.85&lng=-121.7&radius=10000&limit=50
//
// IMPORTANT: keep the static `/nearby` and `/viewport` routes registered
// before the bare `/:id` handler. Express matches in declaration order, and
// a wildcard `/:id` declared first will swallow these as if "nearby" and
// "viewport" were destination IDs and 404 with "Destination not found".
router.get("/nearby", async (req, res: Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const radius = parseFloat(req.query.radius as string) || 10000; // meters
  const limit = parseInt(req.query.limit as string) || 50;
  // Ranking. Default "distance" (nearest first) keeps the map's local-peak lists unchanged. The
  // viewfinder passes sort=apparent + eye=<viewer elevation, m> to fill the horizon with the peaks
  // a person actually sees from a high vantage over a curved Earth.
  const sort = (req.query.sort as string) || "distance";
  const eye = parseFloat(req.query.eye as string);
  const useApparent = sort === "apparent" && !isNaN(eye);

  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }

  let queryText: string;
  let values: unknown[];
  if (useApparent) {
    // Long-range mountain viewfinder ranking — "fill the horizon with the peaks you can see",
    // tuned for sight lines up to ~110 km where Earth curvature dominates:
    //
    //   • Visibility gate — spherical-earth inter-visibility. A summit clears the horizon (is not
    //     hidden by the Earth's bulge) when
    //         distance <= sqrt(2 * R_eff) * (sqrt(eye) + sqrt(summit))
    //     with both heights above sea level. sqrt(2 * R_eff) ~= 4123 (m^0.5) using an R_eff that
    //     folds in generous atmospheric refraction (k ~= 0.25), so we keep distant giants like
    //     Rainier AND the lower peaks you look down at, and drop the thousands of hills that sit
    //     below the curve at range. A naive "summit above eye" / "(elev-eye)/dist" rule gets both
    //     of those wrong. Final occlusion by nearer terrain is the client's job (it has the DEM).
    //
    //   • Ranking — apparent angular size: prominence / distance, i.e. how large the peak looms in
    //     view. Prominence is the rise above the connecting saddle (what you actually see standing
    //     up), so dividing by distance balances near prominent summits against far giants. Unknown
    //     prominence falls back to a small constant so un-surveyed bumps rank low but still appear.
    queryText = `
      SELECT * FROM (
        SELECT id, name, elevation, prominence, type,
               activities, features,
               ST_Y(location::geometry) AS lat,
               ST_X(location::geometry) AS lng,
               ST_Distance(location, ST_MakePoint($2, $1)::geography) AS distance_m
        FROM destinations
        WHERE ST_DWithin(location, ST_MakePoint($2, $1)::geography, $3)
          AND elevation IS NOT NULL
      ) c
      WHERE c.distance_m <= 4123 * (sqrt(GREATEST($5, 0)) + sqrt(GREATEST(c.elevation, 0)))
      ORDER BY COALESCE(c.prominence, 100) / GREATEST(c.distance_m, 500) DESC
      LIMIT $4`;
    values = [lat, lng, radius, limit, eye];
  } else {
    queryText = `
      SELECT id, name, elevation, prominence, type,
             activities, features,
             ST_Y(location::geometry) AS lat,
             ST_X(location::geometry) AS lng,
             ST_Distance(location, ST_MakePoint($2, $1)::geography) AS distance_m
      FROM destinations
      WHERE ST_DWithin(location, ST_MakePoint($2, $1)::geography, $3)
      ORDER BY distance_m
      LIMIT $4`;
    values = [lat, lng, radius, limit];
  }

  const result = await db.query(queryText, values);
  res.json(result.rows);
});

// GET /api/destinations/viewport?minLat=46.5&maxLat=47.0&minLng=-122.0&maxLng=-121.0&limit=200
router.get("/viewport", async (req, res: Response) => {
  const minLat = parseFloat(req.query.minLat as string);
  const maxLat = parseFloat(req.query.maxLat as string);
  const minLng = parseFloat(req.query.minLng as string);
  const maxLng = parseFloat(req.query.maxLng as string);
  const limit = parseInt(req.query.limit as string) || 200;

  if ([minLat, maxLat, minLng, maxLng].some(isNaN)) {
    res.status(400).json({ error: "minLat, maxLat, minLng, maxLng are required" });
    return;
  }

  const result = await db.query(
    `SELECT id, name, elevation, prominence, type,
            activities, features,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng
     FROM destinations
     WHERE ST_Intersects(location,
       ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography)
     LIMIT $5`,
    [minLng, minLat, maxLng, maxLat, limit]
  );
  res.json(result.rows);
});

export function buildDestinationDetailQuery(id: string): { text: string; values: unknown[] } {
  return {
    text: `SELECT d.id, d.name, d.elevation, d.prominence, d.type,
            d.activities, d.features, d.owner,
            d.country_code, d.state_code,
            d.hero_image, d.hero_image_attribution, d.hero_image_attribution_url,
            d.averages, d.averages_offset, d.explicitly_saved, d.recency,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            ST_Z(d.location::geometry) AS elev_z,
            CASE WHEN d.boundary IS NOT NULL
                 THEN ST_AsGeoJSON(d.boundary)::json END AS boundary,
            d.bbox_min_lat, d.bbox_max_lat, d.bbox_min_lng, d.bbox_max_lng,
            d.created_at, d.updated_at,
            COALESCE(stats.session_count, 0) + d.session_count_offset AS session_count,
            COALESCE(stats.success_count, 0) + d.success_count_offset AS success_count,
            COALESCE(area_rows.areas, '[]'::json) AS areas
     FROM destinations d
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS session_count,
              COUNT(*) FILTER (WHERE sd.relation = 'reached') AS success_count
       FROM session_destinations sd WHERE sd.destination_id = d.id
     ) stats ON true
     LEFT JOIN LATERAL (
       -- Collapse PAD-US fragments: a park can exist as several areas rows with
       -- the same kind+name (e.g. Olympic NP, split into 'NP' and 'MPA'
       -- designations), so a summit links to all of them and the park would
       -- otherwise render 2-4x. A destination is at one location, so within its
       -- areas the same (kind,name) is ALWAYS one park (never two distinct
       -- same-named areas, which are far apart) — safe to show once. designation
       -- DESC prefers the primary designation (e.g. 'NP' over 'MPA'). See the
       -- duplicate-areas note in docs/superpowers/autonomous-run-2026-06-13.md.
       SELECT json_agg(area_obj ORDER BY kind, name) AS areas
       FROM (
         SELECT DISTINCT ON (a.kind, a.name)
                a.kind, a.name,
                json_build_object(
                  'id', a.id,
                  'name', a.name,
                  'kind', a.kind,
                  'designation', a.designation,
                  'manager', a.manager,
                  'parent_id', a.parent_area_id,
                  'relation', da.relation,
                  'source', da.source
                ) AS area_obj
         FROM destination_areas da
         JOIN areas a ON a.id = da.area_id
         WHERE da.destination_id = d.id
         ORDER BY a.kind, a.name, a.designation DESC NULLS LAST, a.id
       ) deduped
     ) area_rows ON true
     WHERE d.id = $1`,
    values: [id],
  };
}

export function mapDestinationDetailRow(row: any): any {
  row.averages = mergeAverages(row.averages, row.averages_offset);
  delete row.averages_offset;
  row.areas = Array.isArray(row.areas) ? row.areas : [];
  return row;
}

// GET /api/destinations/:id
router.get("/:id", async (req, res: Response) => {
  const { id } = req.params;
  const query = buildDestinationDetailQuery(id);
  const result = await db.query(query.text, query.values);
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Destination not found" });
    return;
  }
  res.json(mapDestinationDetailRow(result.rows[0]));
});

// GET /api/destinations/:id/routes — routes for this destination
router.get("/:id/routes", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT r.id, r.name, r.polyline6, r.owner,
            r.distance, r.gain, r.gain_loss, r.elevation_string,
            r.external_links, r.completion,
            COALESCE(area_rows.areas, '[]'::json) AS areas
     FROM routes r
     JOIN route_destinations rd ON rd.route_id = r.id
     LEFT JOIN LATERAL (
       -- Same areas exposure as buildRouteDetailQuery: dedup PAD-US fragments
       -- by (kind,name), preferring the primary designation, never select
       -- a.boundary.
       SELECT json_agg(area_obj ORDER BY kind, name) AS areas
       FROM (
         SELECT DISTINCT ON (a.kind, a.name)
                a.kind, a.name,
                json_build_object(
                  'id', a.id,
                  'name', a.name,
                  'kind', a.kind,
                  'designation', a.designation,
                  'manager', a.manager,
                  'parent_id', a.parent_area_id,
                  'relation', ra.relation,
                  'source', ra.source
                ) AS area_obj
         FROM route_areas ra
         JOIN areas a ON a.id = ra.area_id
         WHERE ra.route_id = r.id
         ORDER BY a.kind, a.name, a.designation DESC NULLS LAST, a.id
       ) deduped
     ) area_rows ON true
     WHERE rd.destination_id = $1 AND r.status = 'active'
     ORDER BY r.name`,
    [id]
  );
  res.json(
    result.rows.map((row: any) => {
      row.areas = Array.isArray(row.areas) ? row.areas : [];
      return row;
    })
  );
});

// GET /api/destinations/:id/lists — lists containing this destination
router.get("/:id/lists", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT l.id, l.name, l.description, l.owner,
            (SELECT COUNT(*) FROM list_destinations WHERE list_id = l.id) AS destination_count
     FROM lists l
     JOIN list_destinations ld ON ld.list_id = l.id
     WHERE ld.destination_id = $1
     ORDER BY l.name`,
    [id]
  );
  res.json(result.rows);
});

export default router;
