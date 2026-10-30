import { Router, Response } from "express";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import db from "../db";
import { asyncRoute } from "../lib/async-route";
import { supportsGlaciers } from "../lib/glacier-capability";
import { hasColumn, hasGlacierSupport } from "../lib/schema-features";

const router = Router();
const gzipAsync = promisify(gzip);
export const MAP_FEATURE_LIMIT = 80;
/** Below this zoom glaciers use the ~10 m outline; from it, the ~2 m one. */
export const MAP_DETAIL_ZOOM = 14;

export interface MapViewport {
  south: number; north: number; west: number; east: number; zoom: number;
}

/** Which stored display geometry exists; the API can deploy before its migration. */
export interface MapDisplayGeometry { glaciers: boolean; trails: boolean }

/** Reject world-sized work before it reaches PostGIS. Clients split the date line. */
export function parseMapViewport(query: Record<string, unknown>): MapViewport | null {
  const read = (key: string) => typeof query[key] === "string" && String(query[key]).trim() !== ""
    ? Number(query[key]) : NaN;
  const [south, north, west, east, zoom] = ["minLat", "maxLat", "minLng", "maxLng", "zoom"].map(read);
  if (![south, north, west, east, zoom].every(Number.isFinite)
      || south < -85 || north > 85 || south >= north || west < -180 || east > 180 || west >= east
      || zoom < 11 || zoom > 22) return null;
  const width = (east - west) * 111_320 * Math.cos((south + north) / 2 * Math.PI / 180);
  if (width > 50_000 || (north - south) * 111_320 > 100_000) return null;
  return { south, north, west, east, zoom };
}

// Stored paths are 2D and simplified at write time (route_map_paths), so the
// request only tests and clips small geometries in planar space.
export function buildMapTrailsQuery(view: MapViewport, stored = true) {
  const values = [view.west, view.south, view.east, view.north, MAP_FEATURE_LIMIT + 1];
  if (!stored) return {
    text: `WITH viewport AS (SELECT ST_MakeEnvelope($1,$2,$3,$4,4326) AS box)
      SELECT r.id, r.name,
        ST_AsGeoJSON(ST_SimplifyPreserveTopology(
          ST_CollectionExtract(ST_Multi(ST_Intersection(ST_Force2D(r.path::geometry), v.box)), 2), 0.00001), 6)::json AS geometry
      FROM routes r CROSS JOIN viewport v
      WHERE r.owner='peaks' AND r.status='active' AND r.path IS NOT NULL
        AND ST_Intersects(r.path, v.box::geography)
      ORDER BY r.popularity DESC NULLS LAST, r.id
      LIMIT $5`,
    values,
  };
  return {
    text: `WITH viewport AS (SELECT ST_MakeEnvelope($1,$2,$3,$4,4326) AS box)
      SELECT r.id, r.name,
        ST_AsGeoJSON(ST_CollectionExtract(ST_Multi(ST_ClipByBox2D(m.path, v.box)), 2), 6)::json AS geometry
      FROM route_map_paths m
      JOIN routes r ON r.id=m.route_id
      CROSS JOIN viewport v
      WHERE r.owner='peaks' AND r.status='active'
        AND ST_Intersects(m.path, v.box)
      ORDER BY r.popularity DESC NULLS LAST, r.id
      LIMIT $5`,
    values,
  };
}

// map_outline and map_outline_low are generated from the full outline, so
// they change with every outline write.
export function buildMapGlaciersQuery(view: MapViewport, stored = true) {
  const boundary = !stored ? "ST_AsGeoJSON(ST_SimplifyPreserveTopology(gf.outline::geometry, 0.00001), 6)"
    : view.zoom >= MAP_DETAIL_ZOOM ? "ST_AsGeoJSON(gf.map_outline, 5)" : "ST_AsGeoJSON(gf.map_outline_low, 5)";
  const overlaps = stored ? "ST_Intersects(gf.map_outline, v.box)" : "ST_Intersects(gf.outline, v.box::geography)";
  return {
    text: `WITH viewport AS (SELECT ST_MakeEnvelope($1,$2,$3,$4,4326) AS box)
      SELECT d.id, d.name, d.type, d.features, d.activities,
        ST_Y(d.location::geometry) AS lat, ST_X(d.location::geometry) AS lng,
        ${boundary}::json AS boundary
      FROM destination_glacier_facts gf
      JOIN destinations d ON d.id=gf.destination_id
      JOIN destinations pm ON pm.id=gf.parent_mountain_id
      CROSS JOIN viewport v
      WHERE d.owner='peaks' AND pm.owner='peaks' AND 'glacier'=ANY(d.features::text[])
        AND ${overlaps}
      ORDER BY gf.area_km2 DESC NULLS LAST, d.id
      LIMIT $5`,
    values: [view.west, view.south, view.east, view.north, MAP_FEATURE_LIMIT + 1],
  };
}

async function mapDisplayGeometry(): Promise<MapDisplayGeometry> {
  const [glaciers, trails] = await Promise.all([
    hasColumn("destination_glacier_facts", "map_outline_low"),
    hasColumn("route_map_paths", "path"),
  ]);
  return { glaciers, trails };
}

/** Outlines are most of the body and compress about 3:1; URLSession sends gzip. */
export async function encodeMapBody(body: unknown, acceptsGzip: boolean) {
  const json = Buffer.from(JSON.stringify(body));
  return acceptsGzip && json.length > 1024
    ? { data: await gzipAsync(json), encoding: "gzip" as const }
    : { data: json, encoding: undefined };
}

// One bounded read for browse geometry; no user routes or activity enter this response.
router.get("/viewport", asyncRoute(async (req, res: Response) => {
  const view = parseMapViewport(req.query);
  if (!view) {
    res.status(400).json({ error: "A local viewport and zoom from 11 to 22 are required" });
    return;
  }
  const glaciersEnabled = supportsGlaciers(req);
  if (glaciersEnabled && !await hasGlacierSupport()) {
    res.status(503).json({ error: "Glacier catalog is unavailable" });
    return;
  }
  const trailsWanted = view.zoom >= 12;
  const stored = trailsWanted || glaciersEnabled ? await mapDisplayGeometry() : { glaciers: false, trails: false };
  const trailsQuery = buildMapTrailsQuery(view, stored.trails);
  const glaciersQuery = buildMapGlaciersQuery(view, stored.glaciers);
  const [trails, glaciers] = await Promise.all([
    trailsWanted ? db.query(trailsQuery.text, trailsQuery.values) : Promise.resolve({ rows: [] }),
    glaciersEnabled ? db.query(glaciersQuery.text, glaciersQuery.values) : Promise.resolve({ rows: [] }),
  ]);
  const { data, encoding } = await encodeMapBody({
    trails: trails.rows.slice(0, MAP_FEATURE_LIMIT),
    glaciers: glaciers.rows.slice(0, MAP_FEATURE_LIMIT),
    complete: trails.rows.length <= MAP_FEATURE_LIMIT && glaciers.rows.length <= MAP_FEATURE_LIMIT,
  }, Boolean(req.acceptsEncodings("gzip")));
  res.set("Cache-Control", "private, max-age=300");
  res.vary("Accept-Encoding");
  if (encoding) res.set("Content-Encoding", encoding);
  res.type("application/json").send(data);
}));

export default router;
