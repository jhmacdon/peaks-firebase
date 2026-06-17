import { Router, Response } from "express";
import db from "../db";

const router = Router();

export function buildAreaDetailQuery(id: string): { text: string; values: unknown[] } {
  return {
    text: `SELECT a.id, a.name, a.kind, a.designation, a.manager, a.owner,
            a.country_code, a.state_codes,
            ST_Y(a.centroid) AS lat,
            ST_X(a.centroid) AS lng,
            a.bbox_min_lat, a.bbox_max_lat, a.bbox_min_lng, a.bbox_max_lng,
            COALESCE(destination_counts.destination_count, 0)::int AS destination_count,
            COALESCE(route_counts.route_count, 0)::int AS route_count,
            COALESCE(destination_rows.destinations, '[]'::json) AS destinations,
            COALESCE(route_rows.routes, '[]'::json) AS routes
     FROM areas a
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
     WHERE a.id = $1`,
    values: [id],
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
  row.destinations = Array.isArray(row.destinations) ? row.destinations : [];
  row.routes = Array.isArray(row.routes) ? row.routes : [];
  return row;
}

// GET /api/areas/:id
router.get("/:id", async (req, res: Response) => {
  const query = buildAreaDetailQuery(req.params.id);
  const result = await db.query(query.text, query.values);
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Area not found" });
    return;
  }
  res.json(mapAreaDetailRow(result.rows[0]));
});

export default router;
