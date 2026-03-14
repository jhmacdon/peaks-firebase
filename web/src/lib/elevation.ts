import sharp from "sharp";

/**
 * Fetch elevations from Mapbox Terrain-RGB tiles for an array of coordinates.
 * Groups points by tile to minimize tile fetches, caches tiles in memory.
 *
 * Terrain-RGB decode: elevation = -10000 + (R * 256 * 256 + G * 256 + B) * 0.1
 * Uses zoom 14 (~10m/pixel resolution at mid-latitudes).
 */

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || "";
const ZOOM = 14;
const TILE_SIZE = 512; // Mapbox serves 512px tiles at @2x

interface LatLng {
  lat: number;
  lng: number;
}

interface TileCoord {
  x: number;
  y: number;
  z: number;
}

interface PixelCoord {
  tileX: number;
  tileY: number;
  pixelX: number;
  pixelY: number;
}

/** Convert lat/lng to tile + pixel coordinates at given zoom */
function latLngToTilePixel(lat: number, lng: number, zoom: number): PixelCoord {
  const n = Math.pow(2, zoom);
  const latRad = (lat * Math.PI) / 180;

  const tileXFloat = ((lng + 180) / 360) * n;
  const tileYFloat = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  const tileX = Math.floor(tileXFloat);
  const tileY = Math.floor(tileYFloat);

  const pixelX = Math.floor((tileXFloat - tileX) * TILE_SIZE);
  const pixelY = Math.floor((tileYFloat - tileY) * TILE_SIZE);

  return { tileX, tileY, pixelX, pixelY };
}

/** Fetch a Mapbox terrain-RGB tile and return raw pixel buffer */
async function fetchTile(x: number, y: number, z: number): Promise<Buffer> {
  const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${z}/${x}/${y}@2x.pngraw?access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Mapbox tile fetch failed: ${res.status} for ${z}/${x}/${y}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/** Decode RGB pixel values to elevation in meters */
function rgbToElevation(r: number, g: number, b: number): number {
  return -10000 + (r * 256 * 256 + g * 256 + b) * 0.1;
}

/**
 * Fetch elevations for an array of coordinates.
 * Returns array of elevations in meters, same order as input.
 */
export async function fetchElevations(points: LatLng[]): Promise<number[]> {
  if (points.length === 0) return [];

  // Group points by tile
  const tileGroups = new Map<string, { tile: TileCoord; indices: { idx: number; px: number; py: number }[] }>();

  for (let i = 0; i < points.length; i++) {
    const { tileX, tileY, pixelX, pixelY } = latLngToTilePixel(points[i].lat, points[i].lng, ZOOM);
    const key = `${tileX}/${tileY}`;

    if (!tileGroups.has(key)) {
      tileGroups.set(key, { tile: { x: tileX, y: tileY, z: ZOOM }, indices: [] });
    }
    tileGroups.get(key)!.indices.push({ idx: i, px: pixelX, py: pixelY });
  }

  const elevations = new Array<number>(points.length);

  // Fetch tiles in parallel (batch of 10 at a time)
  const groups = Array.from(tileGroups.values());
  const BATCH = 10;

  for (let b = 0; b < groups.length; b += BATCH) {
    const batch = groups.slice(b, b + BATCH);

    await Promise.all(
      batch.map(async (group) => {
        const pngBuffer = await fetchTile(group.tile.x, group.tile.y, group.tile.z);

        // Extract raw pixel data using sharp
        const { data, info } = await sharp(pngBuffer)
          .raw()
          .toBuffer({ resolveWithObject: true });

        const channels = info.channels; // 3 or 4

        for (const pt of group.indices) {
          const px = Math.min(pt.px, info.width - 1);
          const py = Math.min(pt.py, info.height - 1);
          const offset = (py * info.width + px) * channels;

          const r = data[offset];
          const g = data[offset + 1];
          const b = data[offset + 2];

          elevations[pt.idx] = Math.round(rgbToElevation(r, g, b) * 10) / 10;
        }
      })
    );
  }

  return elevations;
}

/**
 * Compute elevation stats from an elevation profile.
 */
export function computeElevationStats(elevations: number[]): {
  gain: number;
  loss: number;
  min: number;
  max: number;
} {
  let gain = 0;
  let loss = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < elevations.length; i++) {
    const e = elevations[i];
    if (e < min) min = e;
    if (e > max) max = e;

    if (i > 0) {
      const diff = e - elevations[i - 1];
      if (diff > 0) gain += diff;
      else loss += Math.abs(diff);
    }
  }

  return {
    gain: Math.round(gain * 10) / 10,
    loss: Math.round(loss * 10) / 10,
    min: Math.round(min * 10) / 10,
    max: Math.round(max * 10) / 10,
  };
}
