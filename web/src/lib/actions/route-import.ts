"use server";

import { PoolClient } from "pg";
import db from "@/lib/db";
import { fetchElevations, computeElevationStats } from "@/lib/elevation";
import { parseGPX, simplifyTrack, totalDistance, haversineDistance } from "@/lib/gpx";
import { encodePolyline6, pointsToLineStringZ, generateId, type TrackPoint } from "@/lib/route-utils";
import { normalizeSearchName } from "@/lib/search-utils";

// ─── Validation constraints ────────────────────────────────────────────────

const SUMMIT_REACH_RADIUS = 250;     // meters — route endpoint must be this close to a summit
const TRAILHEAD_RADIUS = 300;        // meters — route start must be this close to a trailhead/road
const MIN_ROUTE_DISTANCE = 800;      // meters (~0.5 mi)
const MIN_ROUTE_GAIN = 50;           // meters — must have meaningful elevation gain
const DEDUP_HAUSDORFF_THRESHOLD = 200; // meters — routes closer than this are duplicates

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RouteCandidate {
  name: string;
  points: TrackPoint[];
  source: string;       // "gpx", "osm", "manual", etc.
  sourceDetail?: string; // filename, URL, etc.
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summit: { id: string; name: string; distance: number } | null;
  trailhead: { id: string; name: string; distance: number; created: boolean } | null;
  nearbyDestinations: { id: string; name: string; distance: number }[];
  isDuplicate: boolean;
  duplicateRouteId?: string;
  stats: {
    distance: number;
    gain: number;
    loss: number;
    startElevation: number;
    endElevation: number;
  };
}

export interface ImportResult {
  routeId: string;
  name: string;
  validation: ValidationResult;
}

// ─── Main entry point: validate and import ─────────────────────────────────

/**
 * Validate a route candidate against our constraints.
 * Does NOT write to the database — pure read-only check.
 */
export async function validateRouteCandidate(
  candidate: RouteCandidate
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { points } = candidate;

  if (points.length < 5) {
    return {
      valid: false, errors: ["Route has fewer than 5 points"],
      warnings: [], summit: null, trailhead: null, nearbyDestinations: [],
      isDuplicate: false, stats: { distance: 0, gain: 0, loss: 0, startElevation: 0, endElevation: 0 },
    };
  }

  // Compute stats
  const distance = totalDistance(points);
  const elevStats = computeElevationStats(points.map(p => p.ele));

  const stats = {
    distance: Math.round(distance),
    gain: elevStats.gain,
    loss: elevStats.loss,
    startElevation: points[0].ele,
    endElevation: points[points.length - 1].ele,
  };

  // Check minimum distance
  if (distance < MIN_ROUTE_DISTANCE) {
    errors.push(`Route is too short: ${(distance / 1609.34).toFixed(1)} mi (minimum ${(MIN_ROUTE_DISTANCE / 1609.34).toFixed(1)} mi)`);
  }

  // Check minimum gain
  if (elevStats.gain < MIN_ROUTE_GAIN) {
    errors.push(`Insufficient elevation gain: ${Math.round(elevStats.gain)}m (minimum ${MIN_ROUTE_GAIN}m)`);
  }

  // Check for summit at route endpoint
  const endPt = points[points.length - 1];
  const summitResult = await db.query(
    `SELECT id, name,
            ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance
     FROM destinations
     WHERE 'summit' = ANY(features)
       AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
     ORDER BY distance
     LIMIT 1`,
    [endPt.lng, endPt.lat, SUMMIT_REACH_RADIUS]
  );

  let summit: ValidationResult["summit"] = null;
  if (summitResult.rows.length > 0) {
    summit = {
      id: summitResult.rows[0].id,
      name: summitResult.rows[0].name,
      distance: Math.round(Number(summitResult.rows[0].distance)),
    };
  } else {
    // Also check route start (route might be stored in descent direction)
    const startPt = points[0];
    const startSummit = await db.query(
      `SELECT id, name,
              ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance
       FROM destinations
       WHERE 'summit' = ANY(features)
         AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
       ORDER BY distance
       LIMIT 1`,
      [startPt.lng, startPt.lat, SUMMIT_REACH_RADIUS]
    );

    if (startSummit.rows.length > 0) {
      summit = {
        id: startSummit.rows[0].id,
        name: startSummit.rows[0].name,
        distance: Math.round(Number(startSummit.rows[0].distance)),
      };
      warnings.push("Summit is at route start, not end — route may need reversal");
    } else {
      errors.push(`Route endpoint is not within ${SUMMIT_REACH_RADIUS}m of any summit`);
    }
  }

  // Check for trailhead at route start
  const startPt = points[0];
  const trailheadResult = await db.query(
    `SELECT id, name,
            ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance
     FROM destinations
     WHERE 'trailhead' = ANY(features)
       AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
     ORDER BY distance
     LIMIT 1`,
    [startPt.lng, startPt.lat, TRAILHEAD_RADIUS]
  );

  let trailhead: ValidationResult["trailhead"] = null;
  if (trailheadResult.rows.length > 0) {
    trailhead = {
      id: trailheadResult.rows[0].id,
      name: trailheadResult.rows[0].name,
      distance: Math.round(Number(trailheadResult.rows[0].distance)),
      created: false,
    };
  } else {
    warnings.push(`No trailhead found within ${TRAILHEAD_RADIUS}m of route start — one will be created`);
  }

  // Check for duplicates
  let isDuplicate = false;
  let duplicateRouteId: string | undefined;

  const wkt = pointsToLineStringZ(points);
  const dupResult = await db.query(
    `SELECT id, name,
            ST_HausdorffDistance(
              path::geometry,
              ST_GeomFromText($1, 4326)
            ) AS hausdorff
     FROM routes
     WHERE owner = 'peaks'
       AND ST_DWithin(path, ST_GeomFromText($1, 4326)::geography, 1000)
     ORDER BY hausdorff
     LIMIT 1`,
    [wkt]
  );

  if (dupResult.rows.length > 0) {
    const hausdorff = Number(dupResult.rows[0].hausdorff);
    // Hausdorff is in degrees here (geometry), convert roughly: 1 degree ≈ 111km at equator
    const hausdorffMeters = hausdorff * 111000 * Math.cos((startPt.lat * Math.PI) / 180);
    if (hausdorffMeters < DEDUP_HAUSDORFF_THRESHOLD) {
      isDuplicate = true;
      duplicateRouteId = dupResult.rows[0].id;
      errors.push(`Duplicate of existing route "${dupResult.rows[0].name}" (${Math.round(hausdorffMeters)}m Hausdorff distance)`);
    }
  }

  // Find other nearby destinations (for display, not gating)
  const nearbyDestinations: { id: string; name: string; distance: number }[] = [];
  const midIdx = Math.floor(points.length / 2);
  const sampleIndices = [0, Math.floor(midIdx / 2), midIdx, midIdx + Math.floor((points.length - midIdx) / 2), points.length - 1];

  for (const idx of sampleIndices) {
    const p = points[idx];
    const nearby = await db.query(
      `SELECT id, name,
              ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance
       FROM destinations
       WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 200)
         AND NOT ('summit' = ANY(features) AND id = $3)
       ORDER BY distance
       LIMIT 3`,
      [p.lng, p.lat, summit?.id || ""]
    );
    for (const row of nearby.rows) {
      if (!nearbyDestinations.find(d => d.id === row.id)) {
        nearbyDestinations.push({
          id: row.id,
          name: row.name,
          distance: Math.round(Number(row.distance)),
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summit,
    trailhead,
    nearbyDestinations,
    isDuplicate,
    duplicateRouteId,
    stats,
  };
}

/**
 * Import a GPX file as a pending route with full validation.
 * Processes GPX → DEM elevations → validates → saves if valid.
 */
export async function importRouteAsPending(
  gpxContent: string,
  name?: string
): Promise<ImportResult> {
  // Parse
  const parsed = parseGPX(gpxContent);
  if (parsed.points.length < 2) {
    throw new Error("GPX file must contain at least 2 track points");
  }

  // Simplify
  const rawPoints = parsed.points.map(p => ({ lat: p.lat, lng: p.lng, ele: p.ele }));
  let simplified = rawPoints;
  if (rawPoints.length > 1500) {
    let tolerance = 5;
    while (simplified.length > 1500 && tolerance < 100) {
      simplified = simplifyTrack(rawPoints, tolerance);
      tolerance += 5;
    }
  }

  // Fetch DEM elevations
  const elevations = await fetchElevations(simplified.map(p => ({ lat: p.lat, lng: p.lng })));

  // Build track points
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

  const routeName = name || parsed.name || "Unnamed Route";

  // Validate
  const validation = await validateRouteCandidate({
    name: routeName,
    points,
    source: "gpx",
  });

  if (!validation.valid) {
    throw new Error(`Route validation failed: ${validation.errors.join("; ")}`);
  }

  // Save as pending
  const routeId = await savePendingRoute(routeName, points, validation);

  return { routeId, name: routeName, validation };
}

/**
 * Batch import with validation. Returns results for each file.
 */
export async function batchImportRoutes(
  files: { gpxContent: string; name?: string }[]
): Promise<{ imported: number; rejected: number; results: { name: string; routeId?: string; error?: string; validation?: ValidationResult }[] }> {
  const results: { name: string; routeId?: string; error?: string; validation?: ValidationResult }[] = [];
  let imported = 0;
  let rejected = 0;

  for (const file of files) {
    try {
      const result = await importRouteAsPending(file.gpxContent, file.name);
      results.push({ name: result.name, routeId: result.routeId, validation: result.validation });
      imported++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      results.push({ name: file.name || "Unknown", error: msg });
      rejected++;
    }
  }

  return { imported, rejected, results };
}

// ─── Internal: save validated route ────────────────────────────────────────

async function savePendingRoute(
  name: string,
  points: TrackPoint[],
  validation: ValidationResult
): Promise<string> {
  const routeId = generateId();
  const segId = generateId();
  const polyline6 = encodePolyline6(points);
  const wkt = pointsToLineStringZ(points);

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Route
    await client.query(
      `INSERT INTO routes (id, name, path, polyline6, owner, distance, gain, gain_loss,
                           completion, shape, status)
       VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, 'peaks',
               $5, $6, $7, 'none'::completion_mode, 'out_and_back'::route_shape, 'pending')`,
      [routeId, name, wkt, polyline6,
       validation.stats.distance, validation.stats.gain, validation.stats.loss]
    );

    // Standalone segment
    await client.query(
      `INSERT INTO segments (id, name, path, polyline6, distance, gain, gain_loss)
       VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, $5, $6, $7)`,
      [segId, name, wkt, polyline6,
       validation.stats.distance, validation.stats.gain, validation.stats.loss]
    );

    await client.query(
      `INSERT INTO route_segments (route_id, segment_id, ordinal, direction)
       VALUES ($1, $2, 0, 'forward')`,
      [routeId, segId]
    );

    // Link summit
    let ordinal = 0;
    if (validation.summit) {
      await client.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [routeId, validation.summit.id, ordinal++]
      );
    }

    // Link or create trailhead
    if (validation.trailhead) {
      await client.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [routeId, validation.trailhead.id, ordinal++]
      );
    } else {
      // Create trailhead
      await createAndLinkTrailhead(client, routeId, points[0], ordinal);
    }

    await client.query("COMMIT");
    return routeId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function createAndLinkTrailhead(
  client: PoolClient,
  routeId: string,
  startPoint: TrackPoint,
  ordinal: number
): Promise<void> {
  let name = "Trailhead";
  try {
    const { reverseGeocodePointName } = await import("@/lib/actions/destinations");
    const geo = await reverseGeocodePointName(startPoint.lat, startPoint.lng);
    if (geo.suggestedName) name = geo.suggestedName;
  } catch { /* non-fatal */ }

  // Dedup
  const dup = await client.query(
    `SELECT id FROM destinations
     WHERE search_name = $1
       AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 1000)
     LIMIT 1`,
    [normalizeSearchName(name), startPoint.lng, startPoint.lat]
  );

  if (dup.rows.length > 0) {
    await client.query(
      `INSERT INTO route_destinations (route_id, destination_id, ordinal)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [routeId, dup.rows[0].id, ordinal]
    );
    return;
  }

  const thId = generateId();
  await client.query(
    `INSERT INTO destinations (id, name, search_name, location, elevation, features, owner, type)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5, $6), 4326)::geography,
             $6, ARRAY['trailhead']::destination_feature[], 'peaks', 'point')`,
    [thId, name, normalizeSearchName(name), startPoint.lng, startPoint.lat, Math.round(startPoint.ele)]
  );

  await client.query(
    `INSERT INTO route_destinations (route_id, destination_id, ordinal)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [routeId, thId, ordinal]
  );
}
