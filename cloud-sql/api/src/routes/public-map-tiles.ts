import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import db from "../db";
import { asyncRoute } from "../lib/async-route";
import { hasColumn } from "../lib/schema-features";

// Protected-area vector tiles for the main map. Mapbox fetches tiles itself and
// sends no Authorization header, so this router is mounted ahead of the /api
// auth gate. PAD-US areas are public; no user data enters a tile.
const router = Router();
const gzipAsync = promisify(gzip);

/** Below this zoom the app draws no areas; a valid request gets an empty 204. */
export const AREA_TILE_MIN_ZOOM = 8;
/** The app's source maxzoom; Mapbox overzooms above it and never asks for more. */
export const AREA_TILE_MAX_ZOOM = 14;
/** From this zoom tiles read the 3 m shape; below it, the 100 m shape_low. */
export const AREA_TILE_DETAIL_ZOOM = 11;
export const AREA_TILE_EXTENT = 4096;
export const AREA_TILE_BUFFER = 64;
export const AREA_TILE_CONTENT_TYPE = "application/vnd.mapbox-vector-tile";
/** Areas change only on a PAD-US re-import. */
export const AREA_TILE_CACHE_CONTROL = "public, max-age=86400";

export interface TileAddress { z: number; x: number; y: number }

/**
 * Parse /:z/:x/:y.mvt. Returns null for anything malformed or out of range.
 * Zooms below AREA_TILE_MIN_ZOOM parse (the caller answers 204); above the
 * max they do not, since the app never asks and they would only add DB work.
 */
export function parseTileAddress(z: string, x: string, file: string): TileAddress | null {
  const yMatch = /^(\d{1,5})\.mvt$/.exec(file);
  if (!/^\d{1,2}$/.test(z) || !/^\d{1,5}$/.test(x) || !yMatch) return null;
  const address = { z: Number(z), x: Number(x), y: Number(yMatch[1]) };
  if (address.z > AREA_TILE_MAX_ZOOM) return null;
  const size = 2 ** address.z;
  return address.x < size && address.y < size ? address : null;
}

/**
 * Higher draws later and wins label collisions: parks over monuments,
 * recreation areas and state parks, over wilderness, over forests and
 * grasslands, over everything else.
 */
export const AREA_RANK_SQL = `CASE a.kind::text
    WHEN 'national_park' THEN 5
    WHEN 'national_monument' THEN 4 WHEN 'national_recreation_area' THEN 4 WHEN 'state_park' THEN 4
    WHEN 'wilderness' THEN 3
    WHEN 'national_forest' THEN 2 WHEN 'national_grassland' THEN 2
    ELSE 1 END`;

/**
 * One indexed bbox test on the stored 3857 pieces, then clip. No transform or
 * simplify of a boundary runs per request. An area's pieces in reach collect
 * back into one feature. Features are ordered low rank first, so forests draw
 * under the wilderness and parks inside them.
 */
export function buildAreaTileQuery({ z, x, y }: TileAddress) {
  const column = z >= AREA_TILE_DETAIL_ZOOM ? "shape" : "shape_low";
  return {
    text: `WITH tile AS (
        SELECT ST_TileEnvelope($1, $2, $3) AS envelope,
               ST_TileEnvelope($1, $2, $3, margin => ${AREA_TILE_BUFFER}.0 / ${AREA_TILE_EXTENT}) AS search
      ), shapes AS (
        SELECT s.area_id, ST_CollectionExtract(ST_Collect(s.${column}), 3) AS shape
        FROM tile JOIN area_map_shapes s ON s.${column} && tile.search
        GROUP BY s.area_id
      ), features AS (
        SELECT a.id, a.name, a.kind::text AS kind, a.parent_area_id, ${AREA_RANK_SQL} AS rank,
               ST_AsMVTGeom(shapes.shape, tile.envelope, ${AREA_TILE_EXTENT}, ${AREA_TILE_BUFFER}, true) AS geom
        FROM tile, shapes JOIN areas a ON a.id = shapes.area_id
      )
      SELECT ST_AsMVT(f, 'areas', ${AREA_TILE_EXTENT}, 'geom') AS tile
      FROM (SELECT * FROM features WHERE geom IS NOT NULL ORDER BY rank, id) f`,
    values: [z, x, y],
  };
}

// Mapbox loads 15-40 tiles per screen and more while panning, so tiles get
// their own per-IP bucket instead of sharing the 120/min signed-out catalog
// limit. Each tile is one indexed query, and devices cache tiles for a day.
const tileRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 900,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many tile requests" },
});

// Low-zoom tiles cover whole regions and every device in them asks for the
// same ones, so each instance keeps recent tiles (empty ones included) and
// joins identical requests already in flight. A shared-core db-f1-micro tile
// costs up to a few hundred ms under load; a hit costs nothing. Bounded by
// bytes; an hour keeps a PAD-US re-import visible the same day.
const TILE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const TILE_CACHE_TTL_MS = 60 * 60 * 1000;
const TILE_CACHE_ENTRY_OVERHEAD = 128;
const tileCache = new Map<string, { tile: Buffer; at: number }>();
const tilesInFlight = new Map<string, Promise<Buffer>>();
let tileCacheBytes = 0;

export function clearAreaTileCache() {
  tileCache.clear();
  tileCacheBytes = 0;
}

function forget(key: string) {
  const entry = tileCache.get(key);
  if (!entry) return;
  tileCache.delete(key);
  tileCacheBytes -= entry.tile.length + TILE_CACHE_ENTRY_OVERHEAD;
}

function remember(key: string, tile: Buffer) {
  forget(key);
  tileCache.set(key, { tile, at: Date.now() });
  tileCacheBytes += tile.length + TILE_CACHE_ENTRY_OVERHEAD;
  // Map iteration is insertion order, and hits re-insert, so the first key is the least recent.
  while (tileCacheBytes > TILE_CACHE_MAX_BYTES) forget(tileCache.keys().next().value!);
}

export async function loadAreaTile(address: TileAddress): Promise<Buffer> {
  const key = `${address.z}/${address.x}/${address.y}`;
  const hit = tileCache.get(key);
  if (hit && Date.now() - hit.at < TILE_CACHE_TTL_MS) {
    tileCache.delete(key);
    tileCache.set(key, hit);
    return hit.tile;
  }
  const pending = tilesInFlight.get(key);
  if (pending) return pending;
  const load = (async () => {
    const { text, values } = buildAreaTileQuery(address);
    const tile: Buffer = (await db.query(text, values)).rows[0]?.tile ?? Buffer.alloc(0);
    remember(key, tile);
    return tile;
  })().finally(() => tilesInFlight.delete(key));
  tilesInFlight.set(key, load);
  return load;
}

router.get("/:z/:x/:file", tileRateLimit, asyncRoute(async (req, res) => {
  const address = parseTileAddress(req.params.z, req.params.x, req.params.file);
  if (!address) {
    res.status(400).json({ error: `Tile must be z/x/y.mvt with zoom ${AREA_TILE_MIN_ZOOM}-${AREA_TILE_MAX_ZOOM}` });
    return;
  }
  if (address.z < AREA_TILE_MIN_ZOOM) {
    res.set("Cache-Control", AREA_TILE_CACHE_CONTROL).status(204).end();
    return;
  }
  // The API can deploy before its migration (CI never applies migrations).
  if (!await hasColumn("area_map_shapes", "shape_low")) {
    res.set("Cache-Control", "no-store").status(503).json({ error: "Area tiles are unavailable" });
    return;
  }
  const tile = await loadAreaTile(address);
  res.set("Cache-Control", AREA_TILE_CACHE_CONTROL);
  if (tile.length === 0) {
    res.status(204).end();
    return;
  }
  res.vary("Accept-Encoding");
  // Polygon tiles shrink by about a quarter; the Mapbox HTTP stack sends gzip.
  if (req.acceptsEncodings("gzip") && tile.length > 1024) {
    res.set("Content-Encoding", "gzip");
    res.type(AREA_TILE_CONTENT_TYPE).send(await gzipAsync(tile));
    return;
  }
  res.type(AREA_TILE_CONTENT_TYPE).send(tile);
}));

export default router;
