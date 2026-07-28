/**
 * Render a route candidate over public OpenStreetMap tiles.
 *
 * Usage:
 *   tsx src/render-osm-route-candidate.ts \
 *     --geojson candidate.geojson --output candidate.png
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

type Position = [number, number];

const TILE_SIZE = 256;
const USER_AGENT =
  "Peaks route research/1.0 (https://github.com/jhmacdon/peaks-firebase)";

function valueAfter(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? "" : "";
}

function integerAfter(
  argv: string[],
  flag: string,
  fallback: number
): number {
  const raw = valueAfter(argv, flag);
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < 200 || value > 1280) {
    throw new Error(`${flag} must be an integer from 200 to 1280`);
  }
  return value;
}

function worldPixel(
  position: Position,
  zoom: number
): { x: number; y: number } {
  const [lng, rawLat] = position;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, rawLat));
  const scale = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y:
      (0.5 -
        Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) *
      scale,
  };
}

function chooseZoom(
  coordinates: Position[],
  width: number,
  height: number,
  padding: number
): number {
  for (let zoom = 16; zoom >= 3; zoom -= 1) {
    const points = coordinates.map((position) => worldPixel(position, zoom));
    const spanX =
      Math.max(...points.map((point) => point.x)) -
      Math.min(...points.map((point) => point.x));
    const spanY =
      Math.max(...points.map((point) => point.y)) -
      Math.min(...points.map((point) => point.y));
    if (spanX <= width - 2 * padding && spanY <= height - 2 * padding) {
      return zoom;
    }
  }
  return 3;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function tile(
  zoom: number,
  x: number,
  y: number,
  cacheDir: string
): Promise<Buffer> {
  const tilePath = path.join(cacheDir, String(zoom), String(x), `${y}.png`);
  try {
    return await readFile(tilePath);
  } catch {
    const response = await fetch(
      `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`,
      { headers: { "user-agent": USER_AGENT } }
    );
    if (!response.ok) {
      throw new Error(`OSM tile ${zoom}/${x}/${y} returned ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await mkdir(path.dirname(tilePath), { recursive: true });
    await writeFile(tilePath, buffer);
    return buffer;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const geojsonPath = valueAfter(argv, "--geojson");
  const outputPath = valueAfter(argv, "--output");
  const width = integerAfter(argv, "--width", 800);
  const height = integerAfter(argv, "--height", 800);
  if (!geojsonPath || !outputPath) {
    throw new Error("--geojson and --output are required");
  }

  const input = JSON.parse(await readFile(geojsonPath, "utf8")) as {
    features?: Array<{
      geometry?: { type?: string; coordinates?: unknown };
    }>;
  };
  const rawCoordinates = input.features?.find(
    (feature) => feature.geometry?.type === "LineString"
  )?.geometry?.coordinates;
  if (
    !Array.isArray(rawCoordinates) ||
    rawCoordinates.length < 2 ||
    !rawCoordinates.every(
      (coordinate) =>
        Array.isArray(coordinate) &&
        coordinate.length >= 2 &&
        coordinate.slice(0, 2).every(Number.isFinite)
    )
  ) {
    throw new Error("GeoJSON must contain a valid LineString");
  }
  const coordinates = rawCoordinates.map(
    (coordinate) => coordinate.slice(0, 2) as Position
  );

  const padding = 72;
  const zoom = chooseZoom(coordinates, width, height, padding);
  const worldPoints = coordinates.map((position) =>
    worldPixel(position, zoom)
  );
  const minX = Math.min(...worldPoints.map((point) => point.x));
  const maxX = Math.max(...worldPoints.map((point) => point.x));
  const minY = Math.min(...worldPoints.map((point) => point.y));
  const maxY = Math.max(...worldPoints.map((point) => point.y));
  const left = (minX + maxX) / 2 - width / 2;
  const top = (minY + maxY) / 2 - height / 2;
  const firstTileX = Math.floor(left / TILE_SIZE);
  const lastTileX = Math.floor((left + width) / TILE_SIZE);
  const firstTileY = Math.floor(top / TILE_SIZE);
  const lastTileY = Math.floor((top + height) / TILE_SIZE);
  const tileLimit = 2 ** zoom;
  const cacheDir =
    process.env.PEAKS_OSM_TILE_CACHE ??
    path.join(tmpdir(), "peaks-osm-route-tile-cache");

  const composites: sharp.OverlayOptions[] = [];
  for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
    if (tileY < 0 || tileY >= tileLimit) continue;
    for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
      const wrappedX = ((tileX % tileLimit) + tileLimit) % tileLimit;
      composites.push({
        input: await tile(zoom, wrappedX, tileY, cacheDir),
        left: Math.round(tileX * TILE_SIZE - left),
        top: Math.round(tileY * TILE_SIZE - top),
      });
    }
  }

  const points = worldPoints
    .map(
      (point) =>
        `${(point.x - left).toFixed(1)},${(point.y - top).toFixed(1)}`
    )
    .join(" ");
  const start = worldPoints[0];
  const finish = worldPoints[worldPoints.length - 1];
  const sx = start.x - left;
  const sy = start.y - top;
  const fx = finish.x - left;
  const fy = finish.y - top;
  const attribution = escapeXml("© OpenStreetMap contributors · ODbL");
  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<polyline points="${points}" fill="none" stroke="white" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>` +
      `<polyline points="${points}" fill="none" stroke="#00A896" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<circle cx="${sx}" cy="${sy}" r="8" fill="#F59E0B" stroke="white" stroke-width="3"/>` +
      `<path d="M ${fx} ${fy - 10} L ${fx - 9} ${fy + 8} L ${fx + 9} ${fy + 8} Z" fill="#111827" stroke="white" stroke-width="3"/>` +
      `<rect x="0" y="${height - 24}" width="${width}" height="24" fill="white" opacity="0.84"/>` +
      `<text x="${width - 8}" y="${height - 7}" text-anchor="end" font-family="Arial, sans-serif" font-size="12" fill="#111827">${attribution}</text>` +
      `</svg>`
  );

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: "#e5e7eb",
    },
  })
    .composite([...composites, { input: overlay, left: 0, top: 0 }])
    .png()
    .toFile(outputPath);
  console.log(`Wrote ${outputPath} at OSM zoom ${zoom}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
