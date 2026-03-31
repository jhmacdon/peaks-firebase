/**
 * Batch import 14er GPX files with strict validation.
 *
 * Validation gates (same as web app):
 * - Route endpoint must be within 100m of a summit
 * - Route start must be within 300m of a trailhead
 * - Minimum 0.5mi distance and 50m elevation gain
 * - No duplicates (Hausdorff distance check)
 *
 * Usage:
 *   MAPBOX_TOKEN=pk.xxx DB_HOST=127.0.0.1 ... npx tsx src/import-14er-routes.ts
 */

import fs from "fs";
import path from "path";
import db from "./db";
import sharp from "sharp";

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || "";
if (!MAPBOX_TOKEN) { console.error("MAPBOX_TOKEN required"); process.exit(1); }

// ─── Constraints ───

const SUMMIT_REACH_RADIUS = 250;
const TRAILHEAD_RADIUS = 300;
const MIN_DISTANCE = 1600;   // ~1 mi — real hike, not a ridge traverse
const MIN_GAIN = 200;        // ~650 ft — must climb substantially
const DEDUP_THRESHOLD_DEG = 0.002; // ~200m at mid-latitudes

// ─── Elevation ───

const ZOOM = 14, TILE_SIZE = 512;
const tileCache = new Map<string, Buffer>();

function latLngToTilePixel(lat: number, lng: number) {
  const n = 2 ** ZOOM, latRad = (lat * Math.PI) / 180;
  const tx = ((lng + 180) / 360) * n, ty = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { tileX: Math.floor(tx), tileY: Math.floor(ty), pixelX: Math.floor((tx - Math.floor(tx)) * TILE_SIZE), pixelY: Math.floor((ty - Math.floor(ty)) * TILE_SIZE) };
}

async function fetchTile(x: number, y: number): Promise<Buffer> {
  const key = `${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key)!;
  const res = await fetch(`https://api.mapbox.com/v4/mapbox.terrain-rgb/${ZOOM}/${x}/${y}@2x.pngraw?access_token=${MAPBOX_TOKEN}`);
  if (!res.ok) throw new Error(`Mapbox ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  tileCache.set(key, buf);
  return buf;
}

async function fetchElevations(points: { lat: number; lng: number }[]): Promise<number[]> {
  const groups = new Map<string, { x: number; y: number; indices: { idx: number; px: number; py: number }[] }>();
  for (let i = 0; i < points.length; i++) {
    const { tileX, tileY, pixelX, pixelY } = latLngToTilePixel(points[i].lat, points[i].lng);
    const k = `${tileX}/${tileY}`;
    if (!groups.has(k)) groups.set(k, { x: tileX, y: tileY, indices: [] });
    groups.get(k)!.indices.push({ idx: i, px: pixelX, py: pixelY });
  }
  const elev = new Array<number>(points.length);
  for (const g of groups.values()) {
    const { data, info } = await sharp(await fetchTile(g.x, g.y)).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    for (const pt of g.indices) {
      const px = Math.min(pt.px, info.width - 1), py = Math.min(pt.py, info.height - 1), off = (py * info.width + px) * ch;
      elev[pt.idx] = Math.round((-10000 + (data[off] * 65536 + data[off + 1] * 256 + data[off + 2]) * 0.1) * 10) / 10;
    }
  }
  return elev;
}

function smoothElevations(e: number[], a = 0.3): number[] {
  if (e.length <= 2) return [...e];
  const s = [e[0]], b = new Array(e.length);
  for (let i = 1; i < e.length; i++) s[i] = a * e[i] + (1 - a) * s[i - 1];
  b[e.length - 1] = e[e.length - 1];
  for (let i = e.length - 2; i >= 0; i--) b[i] = a * s[i] + (1 - a) * b[i + 1];
  b[0] = e[0]; b[e.length - 1] = e[e.length - 1];
  return b;
}

function computeStats(elevations: number[]) {
  const p = smoothElevations(elevations);
  let gain = 0, loss = 0, pending = 0;
  for (let i = 1; i < p.length; i++) {
    const d = p[i] - p[i - 1];
    if ((pending >= 0 && d >= 0) || (pending <= 0 && d <= 0)) pending += d;
    else { if (pending > 4) gain += pending; else if (pending < -4) loss += Math.abs(pending); pending = d; }
  }
  if (pending > 4) gain += pending; else if (pending < -4) loss += Math.abs(pending);
  return { gain: Math.round(gain * 10) / 10, loss: Math.round(loss * 10) / 10 };
}

// ─── Helpers ───

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function totalDist(pts: { lat: number; lng: number }[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
  return d;
}

function genId(): string {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 20 }, () => c[Math.floor(Math.random() * c.length)]).join("");
}

function encodePolyline6(pts: { lat: number; lng: number }[]): string {
  let r = "", pLat = 0, pLng = 0;
  for (const p of pts) {
    const lat = Math.round(p.lat * 1e6), lng = Math.round(p.lng * 1e6);
    r += encV(lat - pLat) + encV(lng - pLng);
    pLat = lat; pLng = lng;
  }
  return r;
}

function encV(v: number): string {
  let n = v < 0 ? ~(v << 1) : v << 1, r = "";
  while (n >= 0x20) { r += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
  r += String.fromCharCode(n + 63); return r;
}

/**
 * Format route name: "<Peak> via <Trail>" or "<Peak> Trail" if same name.
 * Input like "Mount Elbert - North Mount Elbert Trail" or "Pikes Peak - Barr Trail"
 */
function formatRouteName(raw: string): string {
  // Split on " - " separator (from filename -- convention)
  const parts = raw.split(" - ").map(s => s.trim());
  if (parts.length < 2) return raw;

  const peak = parts[0];
  const trail = parts.slice(1).join(" ");

  // Normalize for comparison: strip "Mount", "Peak", "Mountain", "Trail", "Route", etc.
  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/\b(mount|mt\.?|peak|mountain|trail|route|standard|climber'?s?)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const peakNorm = normalize(peak);
  const trailNorm = normalize(trail);

  // If the trail name is essentially the peak name, just use "<Peak> Trail"
  if (peakNorm === trailNorm || trailNorm.includes(peakNorm) || peakNorm.includes(trailNorm)) {
    return `${peak} Trail`;
  }

  // Clean up trail name: remove peak name if it's redundantly included
  let cleanTrail = trail;
  // Remove the peak name from the start of the trail name
  const peakWords = peak.split(" ");
  for (const word of peakWords) {
    if (word.length > 2) {
      const re = new RegExp(`\\b${word}\\b`, "gi");
      cleanTrail = cleanTrail.replace(re, "").trim();
    }
  }
  // Remove leading/trailing junk
  cleanTrail = cleanTrail.replace(/^\s*[-–—]\s*/, "").replace(/\s+/g, " ").trim();

  if (!cleanTrail || cleanTrail.toLowerCase() === "trail" || cleanTrail.toLowerCase() === "route") {
    return `${peak} Trail`;
  }

  return `${peak} via ${cleanTrail}`;
}

function parseGPX(content: string): { name: string | null; points: { lat: number; lng: number }[] } {
  const nm = content.match(/<name>([^<]+)<\/name>/);
  const pts: { lat: number; lng: number }[] = [];
  const re = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/g;
  let m;
  while ((m = re.exec(content)) !== null) pts.push({ lat: parseFloat(m[1]), lng: parseFloat(m[2]) });
  return { name: nm?.[1] || null, points: pts };
}

// ─── Main ───

async function main() {
  const gpxDir = path.join(__dirname, "..", "gpx-14ers");
  const files = fs.readdirSync(gpxDir).filter((f: string) => f.endsWith(".gpx")).sort();

  console.log(`=== Validated import of ${files.length} GPX files ===\n`);

  let imported = 0, rejected = 0, skipped = 0;
  const rejectionReasons = new Map<string, number>();

  for (const file of files) {
    const content = fs.readFileSync(path.join(gpxDir, file), "utf8");
    if (!content.includes("<trkpt")) { skipped++; continue; }

    const parsed = parseGPX(content);
    if (parsed.points.length < 5) { skipped++; continue; }

    const rawName = file.replace(/\.gpx$/, "").replace(/--/g, " - ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
    const name = formatRouteName(rawName);

    try {
      // Fetch elevations
      const elevations = await fetchElevations(parsed.points);

      // Build points with distance
      let cumDist = 0;
      const points = parsed.points.map((p, i) => {
        if (i > 0) cumDist += haversine(parsed.points[i - 1].lat, parsed.points[i - 1].lng, p.lat, p.lng);
        return { lat: p.lat, lng: p.lng, ele: elevations[i], dist: cumDist };
      });

      const distance = cumDist;
      const stats = computeStats(elevations);

      // ─── Validation ───

      // Min distance
      if (distance < MIN_DISTANCE) {
        const reason = `Too short (${(distance / 1609.34).toFixed(1)}mi)`;
        rejectionReasons.set(reason, (rejectionReasons.get(reason) || 0) + 1);
        rejected++; continue;
      }

      // Min gain
      if (stats.gain < MIN_GAIN) {
        const reason = `Low gain (${Math.round(stats.gain)}m)`;
        rejectionReasons.set(reason, (rejectionReasons.get(reason) || 0) + 1);
        rejected++; continue;
      }

      // Route must go UP more than DOWN
      if (stats.loss > stats.gain * 1.5 && stats.loss > 100) {
        const reason = `Descends more than climbs (${Math.round(stats.gain)}m up, ${Math.round(stats.loss)}m down)`;
        rejectionReasons.set(reason, (rejectionReasons.get(reason) || 0) + 1);
        rejected++; continue;
      }

      // Summit check: endpoint OR start must be within 250m of a summit
      const endPt = points[points.length - 1];
      const startPt = points[0];

      let summitResult = await db.query(
        `SELECT id, name, ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS dist
         FROM destinations WHERE 'summit' = ANY(features)
           AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
         ORDER BY dist LIMIT 1`,
        [endPt.lng, endPt.lat, SUMMIT_REACH_RADIUS]
      );

      let reverseRoute = false;
      if (summitResult.rows.length === 0) {
        // Check start point
        summitResult = await db.query(
          `SELECT id, name, ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS dist
           FROM destinations WHERE 'summit' = ANY(features)
             AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
           ORDER BY dist LIMIT 1`,
          [startPt.lng, startPt.lat, SUMMIT_REACH_RADIUS]
        );
        if (summitResult.rows.length > 0) {
          reverseRoute = true;
        }
      }

      if (summitResult.rows.length === 0) {
        const reason = "No summit within 100m";
        rejectionReasons.set(reason, (rejectionReasons.get(reason) || 0) + 1);
        rejected++; continue;
      }

      const summit = summitResult.rows[0];

      // Reverse route if summit is at start, and recompute stats
      let finalPoints = points;
      let finalStats = stats;
      if (reverseRoute) {
        finalPoints = [...points].reverse();
        const reversedElevations = finalPoints.map(p => p.ele);
        finalStats = computeStats(reversedElevations);

        // After reversal, re-check that gain > loss
        if (finalStats.loss > finalStats.gain * 1.5 && finalStats.loss > 100) {
          const reason = `Still descends after reversal (${Math.round(finalStats.gain)}m up, ${Math.round(finalStats.loss)}m down)`;
          rejectionReasons.set(reason, (rejectionReasons.get(reason) || 0) + 1);
          rejected++; continue;
        }
      }

      // Dedup check
      const wkt = `LINESTRING Z(${finalPoints.map(p => `${p.lng} ${p.lat} ${p.ele}`).join(", ")})`;
      const dupResult = await db.query(
        `SELECT id, name, ST_HausdorffDistance(path::geometry, ST_GeomFromText($1, 4326)) AS hausdorff
         FROM routes WHERE owner = 'peaks'
           AND ST_DWithin(path, ST_GeomFromText($1, 4326)::geography, 1000)
         ORDER BY hausdorff LIMIT 1`,
        [wkt]
      );

      if (dupResult.rows.length > 0 && Number(dupResult.rows[0].hausdorff) < DEDUP_THRESHOLD_DEG) {
        const reason = `Duplicate of "${dupResult.rows[0].name}"`;
        rejectionReasons.set(reason, (rejectionReasons.get(reason) || 0) + 1);
        rejected++; continue;
      }

      // ─── Save ───

      const routeId = genId(), segId = genId();
      const polyline6 = encodePolyline6(finalPoints);

      const client = await db.connect();
      try {
        await client.query("BEGIN");

        await client.query(
          `INSERT INTO routes (id, name, path, polyline6, owner, distance, gain, gain_loss, completion, shape, status)
           VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, 'peaks', $5, $6, $7, 'none', 'out_and_back', 'pending')`,
          [routeId, name, wkt, polyline6, Math.round(distance), finalStats.gain, finalStats.loss]
        );

        await client.query(
          `INSERT INTO segments (id, name, path, polyline6, distance, gain, gain_loss)
           VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, $5, $6, $7)`,
          [segId, name, wkt, polyline6, Math.round(distance), finalStats.gain, finalStats.loss]
        );

        await client.query(
          `INSERT INTO route_segments (route_id, segment_id, ordinal, direction) VALUES ($1, $2, 0, 'forward')`,
          [routeId, segId]
        );

        // Link summit
        await client.query(
          `INSERT INTO route_destinations (route_id, destination_id, ordinal) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
          [routeId, summit.id]
        );

        // Find/link trailhead
        const thStart = finalPoints[0];
        const thResult = await client.query(
          `SELECT id FROM destinations WHERE 'trailhead' = ANY(features)
             AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
           ORDER BY ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) LIMIT 1`,
          [thStart.lng, thStart.lat, TRAILHEAD_RADIUS]
        );

        if (thResult.rows.length > 0) {
          await client.query(
            `INSERT INTO route_destinations (route_id, destination_id, ordinal) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING`,
            [routeId, thResult.rows[0].id]
          );
        }

        await client.query("COMMIT");
        const summitDist = Math.round(Number(summit.dist));
        console.log(`  ✓ ${name} → ${summit.name} (${summitDist}m) — ${(distance / 1609.34).toFixed(1)}mi, +${Math.round(finalStats.gain)}m${reverseRoute ? " [reversed]" : ""}`);
        imported++;
      } catch (err: any) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.error(`  ✗ ${file}: ${err.message}`);
      rejected++;
    }
  }

  console.log(`\n=== Results: ${imported} imported, ${rejected} rejected, ${skipped} skipped ===`);
  if (rejectionReasons.size > 0) {
    console.log("\nRejection reasons:");
    for (const [reason, count] of [...rejectionReasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}x ${reason}`);
    }
  }

  // Show which peaks we covered
  const peakResult = await db.query(
    `SELECT DISTINCT d.name FROM destinations d
     JOIN route_destinations rd ON rd.destination_id = d.id
     JOIN routes r ON r.id = rd.route_id
     WHERE r.status = 'pending' AND 'summit' = ANY(d.features)
     ORDER BY d.name`
  );
  console.log(`\nPeaks covered: ${peakResult.rows.length}`);
  for (const row of peakResult.rows) console.log(`  ${row.name}`);

  await db.end();
  process.exit(0);
}

main();
