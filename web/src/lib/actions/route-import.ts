"use server";

import { PoolClient } from "pg";
import db from "@/lib/db";
import { fetchElevations, computeElevationStats } from "@/lib/elevation";
import { parseGPX, detectRouteShape, simplifyTrack, totalDistance, haversineDistance } from "@/lib/gpx";
import { encodePolyline6, pointsToLineStringZ, generateId, type TrackPoint } from "@/lib/route-utils";
import { normalizeSearchName } from "@/lib/search-utils";

/**
 * Import a GPX file as a pending route.
 *
 * - Processes GPX: parse, simplify, fetch DEM elevations, detect shape
 * - Saves as a single standalone segment (no segment matching — safe for batch imports)
 * - Status = 'pending' until a human accepts
 * - Finds and links nearby destinations
 * - Auto-creates trailhead if needed
 */
export async function importRouteAsPending(
  gpxContent: string,
  name?: string
): Promise<{ routeId: string; name: string; stats: { distance: number; gain: number; loss: number } }> {
  // 1. Parse GPX
  const parsed = parseGPX(gpxContent);
  if (parsed.points.length < 2) {
    throw new Error("GPX file must contain at least 2 track points");
  }

  // 2. Simplify
  const rawPoints = parsed.points.map((p) => ({ lat: p.lat, lng: p.lng, ele: p.ele }));
  let simplified = rawPoints;
  if (rawPoints.length > 1500) {
    let tolerance = 5;
    while (simplified.length > 1500 && tolerance < 100) {
      simplified = simplifyTrack(rawPoints, tolerance);
      tolerance += 5;
    }
  }

  // 3. Fetch DEM elevations
  const elevations = await fetchElevations(simplified.map((p) => ({ lat: p.lat, lng: p.lng })));

  // 4. Build track points
  const points: TrackPoint[] = [];
  let cumDist = 0;
  for (let i = 0; i < simplified.length; i++) {
    if (i > 0) {
      cumDist += haversineDistance(
        simplified[i - 1].lat, simplified[i - 1].lng,
        simplified[i].lat, simplified[i].lng
      );
    }
    points.push({
      lat: simplified[i].lat,
      lng: simplified[i].lng,
      ele: elevations[i],
      dist: Math.round(cumDist * 10) / 10,
    });
  }

  // 5. Detect shape and compute one-way stats
  const shapeResult = detectRouteShape(points);
  let oneWayPoints = points;
  if (shapeResult.shape === "out_and_back" && shapeResult.turnaroundIndex != null) {
    oneWayPoints = points.slice(0, shapeResult.turnaroundIndex + 1);
  }
  const elevStats = computeElevationStats(oneWayPoints.map((p) => p.ele));
  const oneWayDistance = totalDistance(oneWayPoints);

  // 6. Route name
  const routeName = name || parsed.name || "Unnamed Route";

  // 7. Save as pending with a single standalone segment
  const routeId = generateId();
  const segId = generateId();
  const polyline6 = encodePolyline6(oneWayPoints);
  const wkt = pointsToLineStringZ(oneWayPoints);

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Insert route as pending
    await client.query(
      `INSERT INTO routes (id, name, path, polyline6, owner, distance, gain, gain_loss,
                           completion, shape, status)
       VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, 'peaks',
               $5, $6, $7, 'none'::completion_mode, $8::route_shape, 'pending')`,
      [routeId, routeName, wkt, polyline6,
       Math.round(oneWayDistance), elevStats.gain, elevStats.loss, shapeResult.shape]
    );

    // Insert single segment
    const segWkt = pointsToLineStringZ(oneWayPoints);
    const segPoly = encodePolyline6(oneWayPoints);

    await client.query(
      `INSERT INTO segments (id, name, path, polyline6, distance, gain, gain_loss)
       VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, $5, $6, $7)`,
      [segId, routeName, segWkt, segPoly,
       Math.round(oneWayDistance), elevStats.gain, elevStats.loss]
    );

    await client.query(
      `INSERT INTO route_segments (route_id, segment_id, ordinal, direction)
       VALUES ($1, $2, 0, 'forward')`,
      [routeId, segId]
    );

    // Find and link nearby destinations
    const destinations = await findNearbyDestinations(client, oneWayPoints);
    for (let i = 0; i < destinations.length; i++) {
      await client.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [routeId, destinations[i].id, i]
      );
    }

    // Auto-create trailhead if needed
    await ensureTrailheadForRoute(client, oneWayPoints, routeId);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return {
    routeId,
    name: routeName,
    stats: {
      distance: Math.round(oneWayDistance),
      gain: elevStats.gain,
      loss: elevStats.loss,
    },
  };
}

/**
 * Batch import multiple GPX files as pending routes.
 */
export async function batchImportRoutes(
  files: { gpxContent: string; name?: string }[]
): Promise<{ imported: number; failed: number; results: { name: string; routeId?: string; error?: string }[] }> {
  const results: { name: string; routeId?: string; error?: string }[] = [];
  let imported = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const result = await importRouteAsPending(file.gpxContent, file.name);
      results.push({ name: result.name, routeId: result.routeId });
      imported++;
    } catch (err: unknown) {
      results.push({ name: file.name || "Unknown", error: err instanceof Error ? err.message : "Unknown error" });
      failed++;
    }
  }

  return { imported, failed, results };
}

// --- Internal helpers ---

async function findNearbyDestinations(
  client: PoolClient,
  points: TrackPoint[]
): Promise<{ id: string; name: string }[]> {
  if (points.length === 0) return [];

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const result = await client.query(
    `SELECT d.id, d.name, d.elevation, d.features,
            ST_Y(d.location::geometry) AS lat, ST_X(d.location::geometry) AS lng
     FROM destinations d
     WHERE ST_Y(d.location::geometry) BETWEEN $1 AND $2
       AND ST_X(d.location::geometry) BETWEEN $3 AND $4`,
    [minLat - 0.02, maxLat + 0.02, minLng - 0.025, maxLng + 0.025]
  );

  const matched: { id: string; name: string; nearestIdx: number }[] = [];

  for (const row of result.rows) {
    const dLat = Number(row.lat);
    const dLng = Number(row.lng);

    let minDist = Infinity;
    let nearestIdx = 0;
    const step = Math.max(1, Math.floor(points.length / 200));
    for (let i = 0; i < points.length; i += step) {
      const d = haversineDistance(dLat, dLng, points[i].lat, points[i].lng);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }
    const searchStart = Math.max(0, nearestIdx - step);
    const searchEnd = Math.min(points.length - 1, nearestIdx + step);
    for (let i = searchStart; i <= searchEnd; i++) {
      const d = haversineDistance(dLat, dLng, points[i].lat, points[i].lng);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }

    if (minDist <= 1500) {
      matched.push({ id: row.id, name: row.name, nearestIdx });
    }
  }

  matched.sort((a, b) => a.nearestIdx - b.nearestIdx);
  return matched;
}

async function ensureTrailheadForRoute(
  client: PoolClient,
  points: TrackPoint[],
  routeId: string
): Promise<void> {
  if (points.length === 0) return;

  const start = points[0];

  // Check if a trailhead already exists nearby
  const existing = await client.query(
    `SELECT id FROM destinations
     WHERE 'trailhead' = ANY(features)
       AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 200)
     LIMIT 1`,
    [start.lng, start.lat]
  );

  if (existing.rows.length > 0) {
    // Link it if not already linked
    await client.query(
      `INSERT INTO route_destinations (route_id, destination_id, ordinal)
       VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
      [routeId, existing.rows[0].id]
    );
    return;
  }

  // No trailhead nearby — create one with a generic name
  // (reverse geocoding would need the Mapbox token which may not be available in all contexts)
  const { reverseGeocodePointName } = await import("@/lib/actions/destinations");
  let name = "Trailhead";
  try {
    const geo = await reverseGeocodePointName(start.lat, start.lng);
    if (geo.suggestedName) name = geo.suggestedName;
  } catch { /* non-fatal */ }

  // Dedup by name
  const duplicate = await client.query(
    `SELECT id FROM destinations
     WHERE search_name = $1
       AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 1000)
     LIMIT 1`,
    [normalizeSearchName(name), start.lng, start.lat]
  );

  if (duplicate.rows.length > 0) return;

  const thId = generateId();
  await client.query(
    `INSERT INTO destinations (id, name, search_name, location, elevation, features, owner, type)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5, $6), 4326)::geography,
             $6, ARRAY['trailhead']::destination_feature[], 'peaks', 'point')`,
    [thId, name, normalizeSearchName(name), start.lng, start.lat, Math.round(start.ele)]
  );

  await client.query(
    `INSERT INTO route_destinations (route_id, destination_id, ordinal)
     VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
    [routeId, thId]
  );
}
