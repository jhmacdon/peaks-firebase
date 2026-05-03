"use server";

import db from "../db";
import { fetchElevations, computeElevationStats } from "../elevation";
import { parseGPX, detectRouteShape, simplifyTrack, totalDistance, haversineDistance } from "../gpx";
import { encodePolyline6, pointsToLineStringZ, generateId, type TrackPoint } from "../route-utils";
import { createDestination, reverseGeocodePointName } from "./destinations";
import { normalizeSearchName } from "../search-utils";

// Re-export TrackPoint so existing consumers don't break
export type { TrackPoint } from "../route-utils";

export interface RouteAnalysis {
  name: string | null;
  points: TrackPoint[];
  shape: "out_and_back" | "loop" | "point_to_point";
  turnaroundIndex?: number;
  stats: {
    distance: number; // one-way meters
    gain: number;
    loss: number;
    minEle: number;
    maxEle: number;
  };
  nearbyDestinations: NearbyDestination[];
}

export interface NearbyDestination {
  id: string;
  name: string | null;
  elevation: number | null;
  features: string[];
  lat: number;
  lng: number;
  distanceFromRoute: number; // meters from nearest point on route
  nearestPointIndex: number; // index in points array
}

/**
 * Process an uploaded GPX file: parse, fetch DEM elevations, detect shape,
 * match destinations. Returns everything the builder UI needs.
 */
export async function processGPX(gpxContent: string): Promise<RouteAnalysis> {
  // 1. Parse GPX
  const parsed = parseGPX(gpxContent);
  if (parsed.points.length < 2) {
    throw new Error("GPX file must contain at least 2 track points");
  }

  // 2. Simplify track to reasonable point count (keep ~500-1000 points)
  const rawPoints = parsed.points.map((p) => ({ lat: p.lat, lng: p.lng, ele: p.ele }));
  let simplified = rawPoints;
  if (rawPoints.length > 1500) {
    // Increase tolerance until we're under 1500 points
    let tolerance = 5;
    while (simplified.length > 1500 && tolerance < 100) {
      simplified = simplifyTrack(rawPoints, tolerance);
      tolerance += 5;
    }
  }

  // 3. Fetch accurate elevations from Mapbox Terrain-RGB
  const elevations = await fetchElevations(simplified.map((p) => ({ lat: p.lat, lng: p.lng })));

  // 4. Build track points with cumulative distance
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

  // 5. Detect route shape
  const shapeResult = detectRouteShape(points);

  // 6. Compute one-way stats
  let oneWayPoints = points;
  if (shapeResult.shape === "out_and_back" && shapeResult.turnaroundIndex != null) {
    oneWayPoints = points.slice(0, shapeResult.turnaroundIndex + 1);
  }

  const oneWayElevations = oneWayPoints.map((p) => p.ele);
  const elevStats = computeElevationStats(oneWayElevations);
  const oneWayDistance = totalDistance(oneWayPoints);

  // 7. Match nearby destinations
  const nearbyDestinations = await matchDestinations(points);

  // 8. Ensure a trailhead exists at the route start
  await ensureTrailhead(points, nearbyDestinations);

  return {
    name: parsed.name,
    points,
    shape: shapeResult.shape,
    turnaroundIndex: shapeResult.turnaroundIndex,
    stats: {
      distance: Math.round(oneWayDistance),
      gain: elevStats.gain,
      loss: elevStats.loss,
      minEle: elevStats.min,
      maxEle: elevStats.max,
    },
    nearbyDestinations,
  };
}

/**
 * Check if a trailhead destination exists near the route start. If not,
 * create one using reverse geocoding for the name and add it to the
 * nearbyDestinations list.
 *
 * Search radius: 200m (trailheads are larger areas — parking lots, etc.)
 */
async function ensureTrailhead(
  points: TrackPoint[],
  nearbyDestinations: NearbyDestination[]
): Promise<void> {
  if (points.length === 0) return;

  const start = points[0];
  const TRAILHEAD_RADIUS = 200; // meters

  // Check if we already matched a trailhead near the start
  const hasTrailheadNearStart = nearbyDestinations.some(
    (d) =>
      d.features.includes("trailhead") &&
      d.nearestPointIndex <= Math.min(5, Math.floor(points.length * 0.05))
  );

  if (hasTrailheadNearStart) return;

  // Check if a trailhead exists in the DB near the start but wasn't matched
  // (might be just outside the 1.5km matchDestinations radius, or matched
  // but not at the start of the route)
  const existing = await db.query(
    `SELECT id, name, elevation,
            ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
            features
     FROM destinations
     WHERE 'trailhead' = ANY(features)
       AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
     ORDER BY ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
     LIMIT 1`,
    [start.lng, start.lat, TRAILHEAD_RADIUS]
  );

  if (existing.rows.length > 0) {
    // Trailhead exists but wasn't in the matched list — add it
    const row = existing.rows[0];
    const dist = haversineDistance(start.lat, start.lng, Number(row.lat), Number(row.lng));
    nearbyDestinations.unshift({
      id: row.id,
      name: row.name,
      elevation: row.elevation ? Number(row.elevation) : null,
      features: Array.isArray(row.features)
        ? row.features
        : typeof row.features === "string" && row.features.startsWith("{")
          ? row.features.slice(1, -1).split(",").filter(Boolean)
          : [],
      lat: Number(row.lat),
      lng: Number(row.lng),
      distanceFromRoute: Math.round(dist),
      nearestPointIndex: 0,
    });
    return;
  }

  // No trailhead nearby — create one
  try {
    const geo = await reverseGeocodePointName(start.lat, start.lng);
    const name = geo.suggestedName || "Trailhead";

    // Check for duplicate names nearby before creating
    const duplicate = await db.query(
      `SELECT id FROM destinations
       WHERE search_name = $1
         AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 1000)
       LIMIT 1`,
      [normalizeSearchName(name), start.lng, start.lat]
    );

    if (duplicate.rows.length > 0) {
      // Nearby destination with same name exists — use it instead
      return;
    }

    const created = await createDestination({
      name,
      lat: start.lat,
      lng: start.lng,
      elevation: Math.round(start.ele),
      features: ["trailhead"],
    });
    if ("duplicate" in created) {
      return;
    }
    const { id } = created;

    nearbyDestinations.unshift({
      id,
      name,
      elevation: Math.round(start.ele),
      features: ["trailhead"],
      lat: start.lat,
      lng: start.lng,
      distanceFromRoute: 0,
      nearestPointIndex: 0,
    });

    console.log(`Created trailhead: "${name}" at (${start.lat.toFixed(4)}, ${start.lng.toFixed(4)})`);
  } catch (err) {
    console.error("Failed to create trailhead:", err);
    // Non-fatal — route processing continues without the trailhead
  }
}

/**
 * Find destinations within proximity of the route.
 */
async function matchDestinations(points: TrackPoint[]): Promise<NearbyDestination[]> {
  if (points.length === 0) return [];

  // Build a bounding box with buffer for the query
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  // Add ~2km buffer
  const latBuffer = 0.02;
  const lngBuffer = 0.025;

  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.features,
            ST_Y(d.location::geometry) as lat,
            ST_X(d.location::geometry) as lng
     FROM destinations d
     WHERE ST_Y(d.location::geometry) BETWEEN $1 AND $2
       AND ST_X(d.location::geometry) BETWEEN $3 AND $4`,
    [minLat - latBuffer, maxLat + latBuffer, minLng - lngBuffer, maxLng + lngBuffer]
  );

  // For each destination, find nearest point on route
  const destinations: NearbyDestination[] = [];

  for (const row of result.rows) {
    const dLat = Number(row.lat);
    const dLng = Number(row.lng);

    let minDist = Infinity;
    let nearestIdx = 0;

    // Sample route points (every 5th to avoid O(n*m) explosion)
    const step = Math.max(1, Math.floor(points.length / 200));
    for (let i = 0; i < points.length; i += step) {
      const d = haversineDistance(dLat, dLng, points[i].lat, points[i].lng);
      if (d < minDist) {
        minDist = d;
        nearestIdx = i;
      }
    }

    // Refine around the nearest point
    const searchStart = Math.max(0, nearestIdx - step);
    const searchEnd = Math.min(points.length - 1, nearestIdx + step);
    for (let i = searchStart; i <= searchEnd; i++) {
      const d = haversineDistance(dLat, dLng, points[i].lat, points[i].lng);
      if (d < minDist) {
        minDist = d;
        nearestIdx = i;
      }
    }

    // Only include destinations within 1.5km of the route
    if (minDist <= 1500) {
      const features = Array.isArray(row.features)
        ? row.features
        : typeof row.features === "string" && row.features.startsWith("{")
          ? row.features.slice(1, -1).split(",").filter(Boolean)
          : [];

      destinations.push({
        id: row.id,
        name: row.name,
        elevation: row.elevation ? Number(row.elevation) : null,
        features,
        lat: dLat,
        lng: dLng,
        distanceFromRoute: Math.round(minDist),
        nearestPointIndex: nearestIdx,
      });
    }
  }

  // Sort by position along route
  destinations.sort((a, b) => a.nearestPointIndex - b.nearestPointIndex);

  return destinations;
}

/**
 * Chop an out-and-back track at the turnaround point.
 * Returns only the one-way portion.
 */
export async function chopOutAndBack(
  points: TrackPoint[],
  turnaroundIndex: number
): Promise<{ points: TrackPoint[]; stats: RouteAnalysis["stats"] }> {
  const oneWay = points.slice(0, turnaroundIndex + 1);

  // Recompute cumulative distance
  let cumDist = 0;
  const recomputed: TrackPoint[] = oneWay.map((p, i) => {
    if (i > 0) {
      cumDist += haversineDistance(oneWay[i - 1].lat, oneWay[i - 1].lng, p.lat, p.lng);
    }
    return { ...p, dist: Math.round(cumDist * 10) / 10 };
  });

  const elevStats = computeElevationStats(recomputed.map((p) => p.ele));

  return {
    points: recomputed,
    stats: {
      distance: Math.round(totalDistance(recomputed)),
      gain: elevStats.gain,
      loss: elevStats.loss,
      minEle: elevStats.min,
      maxEle: elevStats.max,
    },
  };
}

/**
 * Save a route with its segments to the database (simple version without segment matching).
 */
export async function saveRoute(input: {
  name: string;
  shape: string;
  completion: string;
  segments: {
    name: string | null;
    points: TrackPoint[];
  }[];
  destinationIds: string[];
}): Promise<{ routeId: string }> {
  const routeId = generateId();

  // Build full route points from all segments
  const allPoints: TrackPoint[] = [];
  for (const seg of input.segments) {
    if (allPoints.length > 0 && seg.points.length > 0) {
      // Skip first point of subsequent segments (it's the same as last of previous)
      allPoints.push(...seg.points.slice(1));
    } else {
      allPoints.push(...seg.points);
    }
  }

  const polyline6 = encodePolyline6(allPoints);
  const wkt = pointsToLineStringZ(allPoints);
  const distance = totalDistance(allPoints);
  const elevStats = computeElevationStats(allPoints.map((p) => p.ele));

  // Insert route
  await db.query(
    `INSERT INTO routes (id, name, path, polyline6, owner, distance, gain, gain_loss, completion, shape)
     VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, 'peaks', $5, $6, $7, $8::completion_mode, $9::route_shape)`,
    [routeId, input.name, wkt, polyline6, Math.round(distance), elevStats.gain, elevStats.loss,
     input.completion, input.shape]
  );

  // Insert segments and route_segments
  for (let i = 0; i < input.segments.length; i++) {
    const seg = input.segments[i];
    const segId = generateId();
    const segWkt = pointsToLineStringZ(seg.points);
    const segPoly = encodePolyline6(seg.points);
    const segDist = totalDistance(seg.points);
    const segElev = computeElevationStats(seg.points.map((p) => p.ele));

    await db.query(
      `INSERT INTO segments (id, name, path, polyline6, distance, gain, gain_loss)
       VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, $5, $6, $7)`,
      [segId, seg.name, segWkt, segPoly, Math.round(segDist), segElev.gain, segElev.loss]
    );

    await db.query(
      `INSERT INTO route_segments (route_id, segment_id, ordinal, direction)
       VALUES ($1, $2, $3, 'forward')`,
      [routeId, segId, i]
    );
  }

  // Insert route_destinations
  for (let i = 0; i < input.destinationIds.length; i++) {
    await db.query(
      `INSERT INTO route_destinations (route_id, destination_id, ordinal)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [routeId, input.destinationIds[i], i]
    );
  }

  return { routeId };
}
