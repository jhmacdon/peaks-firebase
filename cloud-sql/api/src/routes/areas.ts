import { Router, Response } from "express";
import { getUid } from "../auth";
import { buildAreaDescription } from "../area-description";
import db from "../db";

const router = Router();

export function buildAreaDetailQuery(id: string, uid: string): { text: string; values: unknown[] } {
  return {
    text: `WITH requested_area AS MATERIALIZED (
             SELECT a.*,
                    a.boundary::geography AS boundary_geography
             FROM areas a
             WHERE a.id = $1
           ),
           area_sessions AS MATERIALIZED (
             SELECT s.*
             FROM requested_area a
             JOIN tracking_sessions s
               ON s.user_id = $2
              AND s.path IS NOT NULL
              AND s.path && a.boundary_geography
              -- Planar intersects on purpose: geography ST_Intersects against a
              -- large multipolygon (Olympic NP: 274 polygons, ~22k vertices) ran
              -- for minutes and blew the statement timeout; the geometry form of
              -- the same check runs in ~100ms and membership is identical at
              -- trail scale. The geography && above still uses the path index.
              AND ST_Intersects(s.path::geometry, a.boundary)
           ),
           ranked_sessions AS MATERIALIZED (
             SELECT *
             FROM area_sessions
             ORDER BY start_time DESC, id
             LIMIT 100
           )
     SELECT a.id, a.name, a.kind, a.description,
            a.description_source_name, a.description_source_url, a.description_source_license,
            a.designation, a.manager, a.owner,
            a.parent_area_id AS parent_id,
            parent.name AS parent_name,
            parent.kind AS parent_kind,
            a.country_code, a.state_codes,
            ST_Y(a.centroid) AS lat,
            ST_X(a.centroid) AS lng,
            a.bbox_min_lat, a.bbox_max_lat, a.bbox_min_lng, a.bbox_max_lng,
            ST_AsGeoJSON(
              -- Prefer the materialized display boundary (see migration
              -- 20260721_area_boundary_display.sql); fall back to a live
              -- simplify for rows imported before their backfill ran.
              COALESCE(
                a.boundary_display,
                ST_SimplifyPreserveTopology(
                  a.boundary,
                  GREATEST(
                    0.00005,
                    LEAST(
                      0.02,
                      GREATEST(
                        a.bbox_max_lat - a.bbox_min_lat,
                        a.bbox_max_lng - a.bbox_min_lng
                      ) / 1500.0
                    )
                  )
                )
              ),
              6
            )::json AS boundary,
            COALESCE(destination_counts.destination_count, 0)::int AS destination_count,
            COALESCE(route_counts.route_count, 0)::int AS route_count,
            (SELECT count(*)::int FROM area_sessions) AS session_count,
            COALESCE(destination_rows.destinations, '[]'::json) AS destinations,
            COALESCE(route_rows.routes, '[]'::json) AS routes,
            COALESCE((
              SELECT json_agg(
                json_build_object(
                  'id', s.id,
                  'user_id', s.user_id,
                  'name', s.name,
                  'start_time', s.start_time,
                  'end_time', s.end_time,
                  'distance', s.distance,
                  'total_time', s.total_time,
                  'pace', s.pace,
                  'gain', s.gain,
                  'high_point', s.highest_point,
                  'ascent_time', s.ascent_time,
                  'descent_time', s.descent_time,
                  'still_time', s.still_time,
                  'activity_type', s.activity_type,
                  'source', s.source,
                  'external_id', s.external_id,
                  'processing_state', s.processing_state,
                  'processing_error', s.processing_error,
                  'processed_at', s.processed_at,
                  'group_id', s.group_id,
                  'ended', s.ended,
                  'is_public', s.is_public,
                  'updated_at', s.updated_at,
                  'server_updated_at', s.server_updated_at,
                  'destinations_reached', COALESCE((
                    SELECT json_agg(json_build_object(
                      'id', d.id,
                      'name', d.name,
                      'elevation', d.elevation,
                      'features', d.features,
                      'lat', ST_Y(d.location::geometry),
                      'lng', ST_X(d.location::geometry)
                    ) ORDER BY d.name, d.id)
                    FROM session_destinations sd
                    JOIN destinations d ON d.id = sd.destination_id
                    WHERE sd.session_id = s.id AND sd.relation = 'reached'
                  ), '[]'::json)
                )
                ORDER BY s.start_time DESC, s.id
              )
              FROM ranked_sessions s
            ), '[]'::json) AS sessions
     FROM requested_area a
     LEFT JOIN areas parent ON parent.id = a.parent_area_id
     LEFT JOIN LATERAL (
       SELECT count(DISTINCT da.destination_id) AS destination_count
       FROM destination_areas da
       WHERE da.area_id = a.id
     ) destination_counts ON true
     LEFT JOIN LATERAL (
       SELECT count(DISTINCT ra.route_id) AS route_count
       FROM route_areas ra
       WHERE ra.area_id = a.id
     ) route_counts ON true
     LEFT JOIN LATERAL (
       SELECT json_agg(destination_obj ORDER BY prominence DESC NULLS LAST, elevation DESC NULLS LAST, name) AS destinations
       FROM (
         SELECT d.id, d.name, d.elevation, d.prominence, d.type,
                d.activities, d.features, d.country_code, d.state_code,
                ST_Y(d.location::geometry) AS lat,
                ST_X(d.location::geometry) AS lng,
                json_build_object(
                  'id', d.id,
                  'name', d.name,
                  'elevation', d.elevation,
                  'prominence', d.prominence,
                  'type', d.type,
                  'activities', d.activities,
                  'features', d.features,
                  'country_code', d.country_code,
                  'state_code', d.state_code,
                  'lat', ST_Y(d.location::geometry),
                  'lng', ST_X(d.location::geometry)
                ) AS destination_obj
         FROM destination_areas da
         JOIN destinations d ON d.id = da.destination_id
         WHERE da.area_id = a.id
         ORDER BY d.prominence DESC NULLS LAST, d.elevation DESC NULLS LAST, d.name
         LIMIT 30
       ) ranked_destinations
     ) destination_rows ON true
     LEFT JOIN LATERAL (
       SELECT json_agg(route_obj ORDER BY gain DESC NULLS LAST, distance DESC NULLS LAST, name) AS routes
       FROM (
         SELECT r.id, r.name, r.polyline6, r.owner, r.distance, r.gain,
                r.gain_loss, r.elevation_string, r.external_links, r.completion,
                json_build_object(
                  'id', r.id,
                  'name', r.name,
                  'polyline6', r.polyline6,
                  'owner', r.owner,
                  'distance', r.distance,
                  'gain', r.gain,
                  'gain_loss', r.gain_loss,
                  'elevation_string', r.elevation_string,
                  'external_links', r.external_links,
                  'completion', r.completion
                ) AS route_obj
         FROM route_areas ra
         JOIN routes r ON r.id = ra.route_id
         WHERE ra.area_id = a.id
           AND r.status = 'active'
         ORDER BY r.gain DESC NULLS LAST, r.distance DESC NULLS LAST, r.name
         LIMIT 15
       ) ranked_routes
     ) route_rows ON true
    `,
    values: [id, uid],
  };
}

function intValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function mapAreaDetailRow(row: any): any {
  row.destination_count = intValue(row.destination_count);
  row.route_count = intValue(row.route_count);
  row.session_count = intValue(row.session_count);
  row.destinations = Array.isArray(row.destinations) ? row.destinations : [];
  row.routes = Array.isArray(row.routes) ? row.routes : [];
  row.sessions = Array.isArray(row.sessions) ? row.sessions : [];
  if (typeof row.description !== "string" || row.description.trim() === "") {
    row.description = buildAreaDescription({
      name: row.name,
      kind: row.kind,
      manager: row.manager,
      stateCodes: Array.isArray(row.state_codes) ? row.state_codes : [],
      peakNames: row.destinations
        .map((destination: any) => destination?.name)
        .filter((name: unknown): name is string => typeof name === "string"),
    });
  }
  return row;
}

// GET /api/areas/:id
router.get("/:id", async (req, res: Response) => {
  const query = buildAreaDetailQuery(req.params.id, getUid(req));
  const result = await db.query(query.text, query.values);
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Area not found" });
    return;
  }
  res.json(mapAreaDetailRow(result.rows[0]));
});

export default router;
