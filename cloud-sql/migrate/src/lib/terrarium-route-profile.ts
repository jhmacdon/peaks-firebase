import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const TILE_ENDPOINT = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const ZOOM = 14;
const TILE_SIZE = 256;
const MAX_MERCATOR_LATITUDE = 85.0511287798066;
const USER_AGENT = "Peaks route elevation backfill/1.0";

type Point = { lat: number; lng: number };
type Fetcher = typeof fetch;

interface TileCoordinate {
  x: number;
  y: number;
  px: number;
  py: number;
}

interface DecodedTile {
  data: Uint8Array;
}

const memoryCache = new Map<string, DecodedTile>();

function tileCoordinate(point: Point): TileCoordinate {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    throw new Error("Route points must have finite coordinates");
  }
  if (point.lat <= -MAX_MERCATOR_LATITUDE || point.lat >= MAX_MERCATOR_LATITUDE ||
      point.lng < -180 || point.lng > 180) {
    throw new Error("Route points must be within Web Mercator coverage");
  }
  const tilesAcross = 2 ** ZOOM;
  const xExact = ((point.lng + 180) / 360) * tilesAcross;
  const latitudeRadians = point.lat * Math.PI / 180;
  const yExact = (1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) / 2 * tilesAcross;
  const x = Math.floor(xExact);
  const y = Math.floor(yExact);
  if (x < 0 || y < 0 || x >= tilesAcross || y >= tilesAcross) {
    throw new Error("Route points must be within Web Mercator coverage");
  }
  return {
    x,
    y,
    px: Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((xExact - x) * TILE_SIZE))),
    py: Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((yExact - y) * TILE_SIZE))),
  };
}

function cacheKey(x: number, y: number): string {
  return `${ZOOM}/${x}/${y}`;
}

function diskCachePath(cacheDir: string, x: number, y: number): string {
  // x and y originate from bounded integers above; never derive a path from user input.
  return path.join(cacheDir, `terrarium-z${ZOOM}-x${x}-y${y}.rgba`);
}

async function decodeTile(bytes: Uint8Array): Promise<DecodedTile> {
  const decoded = await sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== TILE_SIZE || decoded.info.height !== TILE_SIZE ||
      decoded.info.channels !== 4 || decoded.data.length !== TILE_SIZE * TILE_SIZE * 4) {
    throw new Error("Terrarium tile is not a 256px RGBA PNG");
  }
  return { data: new Uint8Array(decoded.data) };
}

async function readCachedTile(cacheDir: string, x: number, y: number): Promise<DecodedTile | null> {
  try {
    const data = new Uint8Array(await fs.readFile(diskCachePath(cacheDir, x, y)));
    if (data.length !== TILE_SIZE * TILE_SIZE * 4) return null;
    return { data };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function getTile(
  x: number,
  y: number,
  cacheDir: string | undefined,
  fetcher: Fetcher
): Promise<DecodedTile> {
  const key = `${cacheDir ?? "memory"}:${cacheKey(x, y)}`;
  const remembered = memoryCache.get(key);
  if (remembered) return remembered;
  if (cacheDir) {
    const cached = await readCachedTile(cacheDir, x, y);
    if (cached) {
      memoryCache.set(key, cached);
      return cached;
    }
  }
  const testMode = process.env.NODE_ENV === "test" ? process.env.PEAKS_TERRARIUM_TEST_RESPONSE : undefined;
  const response = testMode === "404"
    ? new Response("test tile missing", { status: 404 })
    : testMode === "corrupt"
      ? new Response("not a png", { status: 200 })
      : await fetcher(`${TILE_ENDPOINT}/${ZOOM}/${x}/${y}.png`, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Terrarium tile request failed (${response.status})`);
  const tile = await decodeTile(new Uint8Array(await response.arrayBuffer()));
  if (cacheDir) {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(diskCachePath(cacheDir, x, y), tile.data);
  }
  memoryCache.set(key, tile);
  return tile;
}

/**
 * Samples every supplied route vertex from the public z14 Terrarium tile set.
 * It rejects all partial results so callers can safely write only complete paths.
 */
export async function sampleTerrariumProfile(
  points: Point[],
  options: { cacheDir?: string; fetcher?: Fetcher } = {}
): Promise<number[]> {
  if (points.length < 2) throw new Error("A route needs at least two points");
  const coordinates = points.map(tileCoordinate);
  const fetcher = options.fetcher ?? fetch;
  const requestedTiles = new Map<string, Promise<DecodedTile>>();
  for (const coordinate of coordinates) {
    const key = cacheKey(coordinate.x, coordinate.y);
    if (!requestedTiles.has(key)) {
      requestedTiles.set(key, getTile(coordinate.x, coordinate.y, options.cacheDir, fetcher));
    }
  }
  await Promise.all(requestedTiles.values());
  const elevations = await Promise.all(coordinates.map(async (coordinate) => {
    const tile = await requestedTiles.get(cacheKey(coordinate.x, coordinate.y))!;
    const offset = (coordinate.py * TILE_SIZE + coordinate.px) * 4;
    const elevation = tile.data[offset] * 256 + tile.data[offset + 1] + tile.data[offset + 2] / 256 - 32768;
    if (!Number.isFinite(elevation)) throw new Error("Terrarium sample was invalid");
    return elevation;
  }));
  if (elevations.length !== points.length) throw new Error("Terrarium profile was incomplete");
  return elevations;
}
