/**
 * Backfill elevation data for routes missing Z coordinates.
 *
 * For each route with flat Z (all zeros):
 * 1. Extract lat/lng vertices from the path geometry
 * 2. Fetch DEM elevations from Mapbox Terrain-RGB tiles
 * 3. Smooth the elevation profile (bidirectional EMA)
 * 4. Compute gain/loss with dead-band threshold
 * 5. Update the route's path (with Z), gain, and gain_loss
 *
 * Also updates segments belonging to these routes.
 *
 * Usage:
 *   MAPBOX_TOKEN=pk.xxx DB_HOST=127.0.0.1 ... npx tsx src/backfill-elevations.ts
 */

import db from "./db";
import sharp from "sharp";

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || "";
const ZOOM = 14;
const TILE_SIZE = 512;

if (!MAPBOX_TOKEN) {
  console.error("MAPBOX_TOKEN environment variable is required");
  process.exit(1);
}

// --- Elevation fetching (duplicated from web/src/lib/elevation.ts to avoid
//     importing Next.js server action modules in a standalone script) ---

function latLngToTilePixel(lat: number, lng: number) {
  const n = Math.pow(2, ZOOM);
  const latRad = (lat * Math.PI) / 180;
  const tileXFloat = ((lng + 180) / 360) * n;
  const tileYFloat = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return {
    tileX: Math.floor(tileXFloat),
    tileY: Math.floor(tileYFloat),
    pixelX: Math.floor((tileXFloat - Math.floor(tileXFloat)) * TILE_SIZE),
    pixelY: Math.floor((tileYFloat - Math.floor(tileYFloat)) * TILE_SIZE),
  };
}

const tileCache = new Map<string, Buffer>();

async function fetchTile(x: number, y: number): Promise<Buffer> {
  const key = `${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key)!;

  const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${ZOOM}/${x}/${y}@2x.pngraw?access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox tile fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  tileCache.set(key, buf);
  return buf;
}

function rgbToElevation(r: number, g: number, b: number): number {
  return -10000 + (r * 256 * 256 + g * 256 + b) * 0.1;
}

async function fetchElevations(points: { lat: number; lng: number }[]): Promise<number[]> {
  const tileGroups = new Map<string, { x: number; y: number; indices: { idx: number; px: number; py: number }[] }>();

  for (let i = 0; i < points.length; i++) {
    const { tileX, tileY, pixelX, pixelY } = latLngToTilePixel(points[i].lat, points[i].lng);
    const key = `${tileX}/${tileY}`;
    if (!tileGroups.has(key)) tileGroups.set(key, { x: tileX, y: tileY, indices: [] });
    tileGroups.get(key)!.indices.push({ idx: i, px: pixelX, py: pixelY });
  }

  const elevations = new Array<number>(points.length);
  const groups = Array.from(tileGroups.values());

  for (let b = 0; b < groups.length; b += 10) {
    await Promise.all(
      groups.slice(b, b + 10).map(async (group) => {
        const pngBuffer = await fetchTile(group.x, group.y);
        const { data, info } = await sharp(pngBuffer).raw().toBuffer({ resolveWithObject: true });
        const channels = info.channels;

        for (const pt of group.indices) {
          const px = Math.min(pt.px, info.width - 1);
          const py = Math.min(pt.py, info.height - 1);
          const offset = (py * info.width + px) * channels;
          elevations[pt.idx] = Math.round(rgbToElevation(data[offset], data[offset + 1], data[offset + 2]) * 10) / 10;
        }
      })
    );
  }

  return elevations;
}

// --- Smoothing and stats ---

function smoothElevations(elevations: number[], alpha = 0.3): number[] {
  if (elevations.length <= 2) return [...elevations];
  const smoothed = new Array<number>(elevations.length);
  smoothed[0] = elevations[0];
  for (let i = 1; i < elevations.length; i++) {
    smoothed[i] = alpha * elevations[i] + (1 - alpha) * smoothed[i - 1];
  }
  const backward = new Array<number>(elevations.length);
  backward[elevations.length - 1] = elevations[elevations.length - 1];
  for (let i = elevations.length - 2; i >= 0; i--) {
    backward[i] = alpha * smoothed[i] + (1 - alpha) * backward[i + 1];
  }
  backward[0] = elevations[0];
  backward[elevations.length - 1] = elevations[elevations.length - 1];
  return backward;
}

function computeStats(elevations: number[]): { gain: number; loss: number } {
  const profile = smoothElevations(elevations);
  let gain = 0, loss = 0, pending = 0;
  const threshold = 4;

  for (let i = 1; i < profile.length; i++) {
    const diff = profile[i] - profile[i - 1];
    if ((pending >= 0 && diff >= 0) || (pending <= 0 && diff <= 0)) {
      pending += diff;
    } else {
      if (pending > threshold) gain += pending;
      else if (pending < -threshold) loss += Math.abs(pending);
      pending = diff;
    }
  }
  if (pending > threshold) gain += pending;
  else if (pending < -threshold) loss += Math.abs(pending);

  return {
    gain: Math.round(gain * 10) / 10,
    loss: Math.round(loss * 10) / 10,
  };
}

// --- Main ---

async function main() {
  console.log("=== Backfill Route Elevations ===\n");

  // Find routes with flat Z coordinates (Z = 0 on all vertices)
  const routes = await db.query(`
    SELECT r.id, r.name, ST_NPoints(r.path::geometry) AS num_points
    FROM routes r
    WHERE r.owner = 'peaks'
      AND r.path IS NOT NULL
      AND ST_Z(ST_StartPoint(r.path::geometry)) = 0
      AND ST_Z(ST_PointN(r.path::geometry, 2)) = 0
    ORDER BY r.name
  `);

  console.log(`Found ${routes.rows.length} routes needing elevation backfill\n`);

  let updated = 0;
  let failed = 0;

  for (const route of routes.rows) {
    try {
      // Extract vertices
      const vertices = await db.query(`
        SELECT ST_Y((dp).geom) AS lat, ST_X((dp).geom) AS lng
        FROM (SELECT ST_DumpPoints(path::geometry) AS dp FROM routes WHERE id = $1) sub
        ORDER BY (dp).path[1]
      `, [route.id]);

      const points = vertices.rows.map((v: any) => ({
        lat: Number(v.lat),
        lng: Number(v.lng),
      }));

      if (points.length < 2) {
        console.log(`  Skipping ${route.name}: only ${points.length} points`);
        failed++;
        continue;
      }

      // Fetch DEM elevations
      const elevations = await fetchElevations(points);

      // Compute stats
      const stats = computeStats(elevations);

      // Build WKT with Z
      const wktCoords = points.map((p: { lat: number; lng: number }, i: number) =>
        `${p.lng} ${p.lat} ${elevations[i]}`
      ).join(", ");
      const wkt = `LINESTRING Z(${wktCoords})`;

      // Update route
      await db.query(`
        UPDATE routes SET
          path = ST_GeomFromText($2, 4326)::geography,
          gain = $3,
          gain_loss = $4
        WHERE id = $1
      `, [route.id, wkt, stats.gain, stats.loss]);

      console.log(`  ✓ ${route.name} — ${points.length} pts, +${Math.round(stats.gain)}m / -${Math.round(stats.loss)}m`);
      updated++;

      // Also update segments for this route
      const segments = await db.query(`
        SELECT s.id, ST_NPoints(s.path::geometry) AS num_points
        FROM segments s
        JOIN route_segments rs ON rs.segment_id = s.id
        WHERE rs.route_id = $1
          AND ST_Z(ST_StartPoint(s.path::geometry)) = 0
      `, [route.id]);

      for (const seg of segments.rows) {
        const segVerts = await db.query(`
          SELECT ST_Y((dp).geom) AS lat, ST_X((dp).geom) AS lng
          FROM (SELECT ST_DumpPoints(path::geometry) AS dp FROM segments WHERE id = $1) sub
          ORDER BY (dp).path[1]
        `, [seg.id]);

        const segPoints = segVerts.rows.map((v: any) => ({
          lat: Number(v.lat),
          lng: Number(v.lng),
        }));

        if (segPoints.length < 2) continue;

        const segElevations = await fetchElevations(segPoints);
        const segStats = computeStats(segElevations);

        const segWktCoords = segPoints.map((p: { lat: number; lng: number }, i: number) =>
          `${p.lng} ${p.lat} ${segElevations[i]}`
        ).join(", ");

        await db.query(`
          UPDATE segments SET
            path = ST_GeomFromText($2, 4326)::geography,
            gain = $3,
            gain_loss = $4
          WHERE id = $1
        `, [seg.id, `LINESTRING Z(${segWktCoords})`, segStats.gain, segStats.loss]);
      }
    } catch (err: any) {
      console.error(`  ✗ ${route.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== Done: ${updated} updated, ${failed} failed ===`);
  await db.end();
  process.exit(0);
}

main();
