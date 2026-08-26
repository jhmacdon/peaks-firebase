import { Router, Response } from "express";
import { asyncRoute } from "../lib/async-route";
import { getUid } from "../auth";
import db from "../db";
import { normalizeExternalLinks } from "../lib/external-links";
import { buildRouteAccessSql } from "../lib/route-access";

const router = Router();

export function buildRouteDetailQuery(
  id: string,
  uid: string
): { text: string; values: unknown[] } {
  return {
    text: `SELECT r.id, r.name, r.polyline6, r.owner,
            r.distance, r.gain, r.gain_loss, r.elevation_string,
            r.elevation_source, r.elevation_source_url,
            r.elevation_attribution, r.elevation_license_url,
            r.elevation_retrieved_at,
            r.external_links, r.provenance, r.completion,
            r.created_at, r.updated_at,
            COALESCE(area_rows.areas, '[]'::json) AS areas
     FROM routes r
     LEFT JOIN LATERAL (
       -- Collapse PAD-US fragments: a park can exist as several areas rows with
       -- the same kind+name (e.g. Olympic NP, split into 'NP' and 'MPA'
       -- designations), so a route links to all of them and the park would
       -- otherwise render 2-4x. Within a single route's areas the same
       -- (kind,name) is the same park, so it's safe to show once. designation
       -- DESC prefers the primary designation (e.g. 'NP' over 'MPA'). Mirrors
       -- buildDestinationDetailQuery's areas LATERAL.
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
     WHERE r.id = $1 AND r.status = 'active'
       AND ${buildRouteAccessSql("r", "$2")}`,
    values: [id, uid],
  };
}

/** Ordered destinations for one route, trailhead amenities included.
 *
 *  One builder serves both `GET /:id/destinations` and the array embedded in
 *  `GET /:id`, so the two can never drift into different shapes — the client
 *  decodes them with the same reader and falls back from one to the other.
 *  `amenities` is JSONB, so it arrives as an object and serializes as one. */
export function buildRouteDestinationsQuery(
  id: string,
  uid: string
): { text: string; values: unknown[] } {
  return {
    text: `SELECT d.id, d.name, d.elevation, d.features, d.amenities,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            rd.ordinal
     FROM destinations d
     JOIN route_destinations rd ON rd.destination_id = d.id
     JOIN routes r ON r.id = rd.route_id
     WHERE rd.route_id = $1
       AND r.status = 'active'
       AND ${buildRouteAccessSql("r", "$2")}
     ORDER BY rd.ordinal`,
    values: [id, uid],
  };
}

export function buildRouteElevationQuery(
  id: string,
  uid: string
): { text: string; values: unknown[] } {
  return {
    text: `SELECT (dp).path[1] AS vertex_index,
            ST_X((dp).geom) AS lng,
            ST_Y((dp).geom) AS lat,
            ST_Z((dp).geom) AS elevation
     FROM (
       SELECT ST_DumpPoints(r.path::geometry) AS dp
       FROM routes r
       WHERE r.id = $1 AND r.status = 'active'
         AND ${buildRouteAccessSql("r", "$2")}
     ) sub
     ORDER BY vertex_index`,
    values: [id, uid],
  };
}

export function buildNearbyRoutesQuery(
  lat: number,
  lng: number,
  radius: number,
  limit: number,
  uid: string
): { text: string; values: unknown[] } {
  return {
    text: `SELECT r.id, r.name, r.distance, r.gain, r.gain_loss, r.elevation_string,
            r.external_links, r.provenance, r.completion,
            ST_Distance(r.path, ST_MakePoint($2, $1)::geography) AS distance_to_point
     FROM routes r
     WHERE ST_DWithin(r.path, ST_MakePoint($2, $1)::geography, $3)
       AND r.status = 'active'
       AND ${buildRouteAccessSql("r", "$5")}
     ORDER BY distance_to_point
     LIMIT $4`,
    values: [lat, lng, radius, limit, uid],
  };
}

export function mapRouteDetailRow(row: any, destinations: any[] = []): any {
  row.areas = Array.isArray(row.areas) ? row.areas : [];
  row.external_links = normalizeExternalLinks(row.external_links);
  // Embedded in ordinal order, straight from the query — route detail costs
  // the client one request instead of two.
  row.destinations = Array.isArray(destinations) ? destinations : [];
  return row;
}

// GET /api/routes/near?lat=46.85&lng=-121.7&radius=5000&limit=20
// Registered before /:id so Express does not treat "near" as a route id.
router.get("/near", asyncRoute(async (req, res: Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const radius = parseFloat(req.query.radius as string) || 5000;
  const limit = parseInt(req.query.limit as string) || 20;

  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }

  const query = buildNearbyRoutesQuery(lat, lng, radius, limit, getUid(req));
  const result = await db.query(query.text, query.values);
  res.json(result.rows);
}));

// GET /api/routes/:id
router.get("/:id", asyncRoute(async (req, res: Response) => {
  const { id } = req.params;
  const uid = getUid(req);
  const query = buildRouteDetailQuery(id, uid);
  const destinationsQuery = buildRouteDestinationsQuery(id, uid);
  const [result, destinations] = await Promise.all([
    db.query(query.text, query.values),
    db.query(destinationsQuery.text, destinationsQuery.values),
  ]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Route not found" });
    return;
  }
  res.json(mapRouteDetailRow(result.rows[0], destinations.rows));
}));

// GET /api/routes/:id/destinations
router.get("/:id/destinations", asyncRoute(async (req, res: Response) => {
  const { id } = req.params;
  const query = buildRouteDestinationsQuery(id, getUid(req));
  const result = await db.query(query.text, query.values);
  res.json(result.rows);
}));

// GET /api/routes/:id/elevation — elevation profile from LineStringZ vertices
router.get("/:id/elevation", asyncRoute(async (req, res: Response) => {
  const { id } = req.params;
  const query = buildRouteElevationQuery(id, getUid(req));
  const result = await db.query(query.text, query.values);
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Route not found or has no path" });
    return;
  }
  res.json(result.rows);
}));

export default router;
