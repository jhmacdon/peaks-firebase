import { Router, Response } from "express";
import { AuthRequest } from "../auth";
import db from "../db";

const router = Router();

/**
 * Merge averages and averages_offset by summing month/day counters.
 * Either or both may be null.
 */
function mergeAverages(
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

// GET /api/destinations/:id
router.get("/:id", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.prominence, d.type,
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
            COALESCE(stats.success_count, 0) + d.success_count_offset AS success_count
     FROM destinations d
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS session_count,
              COUNT(*) FILTER (WHERE sd.relation = 'reached') AS success_count
       FROM session_destinations sd WHERE sd.destination_id = d.id
     ) stats ON true
     WHERE d.id = $1`,
    [id]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Destination not found" });
    return;
  }
  const row = result.rows[0];
  row.averages = mergeAverages(row.averages, row.averages_offset);
  delete row.averages_offset;
  res.json(row);
});

// GET /api/destinations/nearby?lat=46.85&lng=-121.7&radius=10000&limit=50
router.get("/nearby", async (req, res: Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const radius = parseFloat(req.query.radius as string) || 10000; // meters
  const limit = parseInt(req.query.limit as string) || 50;

  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }

  const result = await db.query(
    `SELECT id, name, elevation, prominence, type,
            activities, features,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng,
            ST_Distance(location, ST_MakePoint($2, $1)::geography) AS distance_m
     FROM destinations
     WHERE ST_DWithin(location, ST_MakePoint($2, $1)::geography, $3)
     ORDER BY distance_m
     LIMIT $4`,
    [lat, lng, radius, limit]
  );
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

// GET /api/destinations/:id/routes — routes for this destination
router.get("/:id/routes", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT r.id, r.name, r.polyline6, r.owner,
            r.distance, r.gain, r.gain_loss, r.elevation_string,
            r.external_links, r.completion
     FROM routes r
     JOIN route_destinations rd ON rd.route_id = r.id
     WHERE rd.destination_id = $1 AND r.status = 'active'
     ORDER BY r.name`,
    [id]
  );
  res.json(result.rows);
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
