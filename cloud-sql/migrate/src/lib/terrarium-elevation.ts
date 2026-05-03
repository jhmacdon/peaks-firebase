import { PNG } from "pngjs";

const TILE_ENDPOINT = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const ZOOM = 12;
const TILE_SIZE = 256;

interface DecodedTile {
  data: Uint8Array; // RGBA, length = TILE_SIZE * TILE_SIZE * 4
}

const tileCache = new Map<string, DecodedTile>();

function lngLatToTile(lat: number, lng: number, z: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z;
  const xExact = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yExact =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(xExact);
  const y = Math.floor(yExact);
  const px = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((xExact - x) * TILE_SIZE)));
  const py = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((yExact - y) * TILE_SIZE)));
  return { x, y, px, py };
}

async function fetchTileWithRetry(z: number, x: number, y: number, retries = 3): Promise<Uint8Array | null> {
  const url = `${TILE_ENDPOINT}/${z}/${x}/${y}.png`;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return new Uint8Array(await res.arrayBuffer());
      }
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      return null;
    } catch {
      if (attempt === retries - 1) return null;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  return null;
}

function decodePng(bytes: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const png = new PNG();
    png.parse(Buffer.from(bytes), (err, data) => {
      if (err) return reject(err);
      resolve(new Uint8Array(data.data));
    });
  });
}

async function getTile(z: number, x: number, y: number): Promise<DecodedTile | null> {
  const key = `${z}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached) return cached;
  const raw = await fetchTileWithRetry(z, x, y);
  if (!raw) return null;
  try {
    const decoded = await decodePng(raw);
    const tile: DecodedTile = { data: decoded };
    tileCache.set(key, tile);
    return tile;
  } catch {
    return null;
  }
}

/**
 * Look up elevation in meters for a (lat, lng) pair using AWS Open Data
 * Terrarium DEM tiles. Returns null on persistent fetch/decode failure;
 * the caller decides whether to skip the row.
 */
export async function lookupElevation(lat: number, lng: number): Promise<number | null> {
  const { x, y, px, py } = lngLatToTile(lat, lng, ZOOM);
  const tile = await getTile(ZOOM, x, y);
  if (!tile) return null;
  const idx = (py * TILE_SIZE + px) * 4;
  const r = tile.data[idx];
  const g = tile.data[idx + 1];
  const b = tile.data[idx + 2];
  return Math.round((r * 256 + g + b / 256) - 32768);
}
