/* eslint-disable @typescript-eslint/no-explicit-any */
"use server";

import db from "../db";
import { normalizeSearchName } from "../search-utils";

/** pg may return custom enum arrays as "{a,b}" strings instead of JS arrays */
function parseArray(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string" && val.startsWith("{")) {
    return val.slice(1, -1).split(",").filter(Boolean);
  }
  return [];
}

export interface SearchDestination {
  id: string;
  name: string | null;
  elevation: number | null;
  prominence: number | null;
  type: string;
  activities: string[];
  features: string[];
  lat: number | null;
  lng: number | null;
  score?: number;
  distance_m?: number;
}

export interface ViewportRoute {
  id: string;
  name: string | null;
  polyline6: string | null;
  distance: number | null;
  gain: number | null;
}

export interface SearchRouteResult {
  id: string;
  name: string | null;
  distance: number | null;
  gain: number | null;
  completion: string;
  shape: string | null;
  destination_count: number;
  session_count: number;
}

export interface DiscoverStats {
  destinationCount: number;
  routeCount: number;
  listCount: number;
}

/**
 * Composite-scored text search with optional geo-biasing.
 *
 * Scoring (with lat/lng):
 *   text similarity (trigram) 55% + prefix bonus 15% + proximity 15%
 *   + elevation 10% + prominence 5%
 *
 * Scoring (without lat/lng):
 *   text similarity 60% + prefix bonus 15% + elevation 15% + prominence 10%
 */
export async function searchDestinations(
  query: string,
  lat?: number,
  lng?: number,
  limit: number = 20
): Promise<SearchDestination[]> {
  const q = normalizeSearchName(query.trim());
  if (!q) return [];

  const hasGeo = lat != null && lng != null && !isNaN(lat) && !isNaN(lng);

  if (hasGeo) {
    const result = await db.query(
      `SELECT id, name, elevation, prominence, type,
              activities, features,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lng,
              ST_Distance(location, ST_MakePoint($3, $2)::geography) AS distance_m,
              (
                similarity(search_name, $1) * 0.55
                + CASE WHEN search_name ILIKE $4 THEN 0.15 ELSE 0 END
                + EXP(-1.0 * ST_Distance(location, ST_MakePoint($3, $2)::geography) / 500000.0) * 0.15
                + LEAST(COALESCE(elevation, 0), 9000.0) / 9000.0 * 0.10
                + LEAST(COALESCE(prominence, 0), 9000.0) / 9000.0 * 0.05
              ) AS score
       FROM destinations
       WHERE search_name % $1
          OR search_name ILIKE $4
       ORDER BY score DESC
       LIMIT $5`,
      [q, lat, lng, `${q}%`, limit]
    );

    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      elevation: r.elevation ? Number(r.elevation) : null,
      prominence: r.prominence ? Number(r.prominence) : null,
      type: r.type,
      activities: parseArray(r.activities),
      features: parseArray(r.features),
      lat: r.lat ? Number(r.lat) : null,
      lng: r.lng ? Number(r.lng) : null,
      score: Number(r.score),
      distance_m: r.distance_m ? Number(r.distance_m) : undefined,
    }));
  } else {
    const result = await db.query(
      `SELECT id, name, elevation, prominence, type,
              activities, features,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lng,
              (
                similarity(search_name, $1) * 0.60
                + CASE WHEN search_name ILIKE $2 THEN 0.15 ELSE 0 END
                + LEAST(COALESCE(elevation, 0), 9000.0) / 9000.0 * 0.15
                + LEAST(COALESCE(prominence, 0), 9000.0) / 9000.0 * 0.10
              ) AS score
       FROM destinations
       WHERE search_name % $1
          OR search_name ILIKE $2
       ORDER BY score DESC
       LIMIT $3`,
      [q, `${q}%`, limit]
    );

    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      elevation: r.elevation ? Number(r.elevation) : null,
      prominence: r.prominence ? Number(r.prominence) : null,
      type: r.type,
      activities: parseArray(r.activities),
      features: parseArray(r.features),
      lat: r.lat ? Number(r.lat) : null,
      lng: r.lng ? Number(r.lng) : null,
      score: Number(r.score),
    }));
  }
}

/**
 * Spatial proximity query — destinations within a radius of a point.
 * Default radius: 10,000 meters. Ordered by distance ascending.
 */
export async function getNearbyDestinations(
  lat: number,
  lng: number,
  radius: number = 10000,
  limit: number = 20
): Promise<SearchDestination[]> {
  const result = await db.query(
    `SELECT id, name, elevation, prominence, type,
            activities, features,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng,
            ST_Distance(location, ST_MakePoint($2, $1)::geography) AS distance_m
     FROM destinations
     WHERE ST_DWithin(location, ST_MakePoint($2, $1)::geography, $3)
     ORDER BY distance_m ASC
     LIMIT $4`,
    [lat, lng, radius, limit]
  );

  return result.rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    elevation: r.elevation ? Number(r.elevation) : null,
    prominence: r.prominence ? Number(r.prominence) : null,
    type: r.type,
    activities: parseArray(r.activities),
    features: parseArray(r.features),
    lat: r.lat ? Number(r.lat) : null,
    lng: r.lng ? Number(r.lng) : null,
    distance_m: r.distance_m ? Number(r.distance_m) : undefined,
  }));
}

/**
 * Most-visited destinations ordered by total session count from averages JSONB.
 */
export async function getPopularDestinations(
  limit: number = 20
): Promise<SearchDestination[]> {
  const result = await db.query(
    `SELECT id, name, elevation, prominence, type,
            activities, features,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng
     FROM destinations
     ORDER BY (averages->>'totalSessions')::int DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );

  return result.rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    elevation: r.elevation ? Number(r.elevation) : null,
    prominence: r.prominence ? Number(r.prominence) : null,
    type: r.type,
    activities: parseArray(r.activities),
    features: parseArray(r.features),
    lat: r.lat ? Number(r.lat) : null,
    lng: r.lng ? Number(r.lng) : null,
  }));
}

export async function searchRoutes(
  query: string,
  limit: number = 8
): Promise<SearchRouteResult[]> {
  const q = query.trim();
  if (!q) return [];

  const result = await db.query(
    `SELECT r.id, r.name, r.distance, r.gain, r.completion, r.shape,
            (SELECT COUNT(*) FROM route_destinations rd WHERE rd.route_id = r.id)::int AS destination_count,
            (SELECT COUNT(*) FROM session_routes sr WHERE sr.route_id = r.id)::int AS session_count
     FROM routes r
     WHERE r.owner = 'peaks'
       AND r.status = 'active'
       AND r.name ILIKE $1
     ORDER BY
       CASE WHEN r.name ILIKE $2 THEN 0 ELSE 1 END,
       (SELECT COUNT(*) FROM session_routes sr WHERE sr.route_id = r.id) DESC,
       (SELECT COUNT(*) FROM route_destinations rd WHERE rd.route_id = r.id) DESC,
       r.distance ASC NULLS LAST,
       r.name ASC NULLS LAST
     LIMIT $3`,
    [`%${q}%`, `${q}%`, limit]
  );

  return result.rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    distance: r.distance != null ? Number(r.distance) : null,
    gain: r.gain != null ? Number(r.gain) : null,
    completion: r.completion,
    shape: r.shape,
    destination_count: Number(r.destination_count),
    session_count: Number(r.session_count),
  }));
}

export async function getPopularRoutes(
  limit: number = 8
): Promise<SearchRouteResult[]> {
  const result = await db.query(
    `SELECT r.id, r.name, r.distance, r.gain, r.completion, r.shape,
            (SELECT COUNT(*) FROM route_destinations rd WHERE rd.route_id = r.id)::int AS destination_count,
            COUNT(sr.route_id)::int AS session_count
     FROM routes r
     LEFT JOIN session_routes sr ON sr.route_id = r.id
     WHERE r.owner = 'peaks'
       AND r.status = 'active'
     GROUP BY r.id, r.name, r.distance, r.gain, r.completion, r.shape
     ORDER BY session_count DESC, destination_count DESC, r.distance ASC NULLS LAST, r.name ASC NULLS LAST
     LIMIT $1`,
    [limit]
  );

  return result.rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    distance: r.distance != null ? Number(r.distance) : null,
    gain: r.gain != null ? Number(r.gain) : null,
    completion: r.completion,
    shape: r.shape,
    destination_count: Number(r.destination_count),
    session_count: Number(r.session_count),
  }));
}

export async function getDiscoverStats(): Promise<DiscoverStats> {
  const [destinations, routes, lists] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS count FROM destinations`),
    db.query(
      `SELECT COUNT(*)::int AS count
       FROM routes
       WHERE owner = 'peaks' AND status = 'active'`
    ),
    db.query(`SELECT COUNT(*)::int AS count FROM lists`),
  ]);

  return {
    destinationCount: Number(destinations.rows[0].count),
    routeCount: Number(routes.rows[0].count),
    listCount: Number(lists.rows[0].count),
  };
}

/**
 * Destinations the given user has never reached (not in session_destinations).
 * If lat/lng provided, ordered by proximity; otherwise by elevation descending.
 */
export async function getUnclimbedDestinations(
  userId: string,
  lat?: number,
  lng?: number,
  limit: number = 20
): Promise<SearchDestination[]> {
  const hasGeo = lat != null && lng != null && !isNaN(lat) && !isNaN(lng);

  if (hasGeo) {
    const result = await db.query(
      `SELECT d.id, d.name, d.elevation, d.prominence, d.type,
              d.activities, d.features,
              ST_Y(d.location::geometry) AS lat,
              ST_X(d.location::geometry) AS lng,
              ST_Distance(d.location, ST_MakePoint($3, $2)::geography) AS distance_m
       FROM destinations d
       WHERE d.id NOT IN (
         SELECT sd.destination_id FROM session_destinations sd
         JOIN tracking_sessions ts ON ts.id = sd.session_id
         WHERE ts.user_id = $1 AND sd.relation = 'reached'
       )
       ORDER BY distance_m ASC
       LIMIT $4`,
      [userId, lat, lng, limit]
    );

    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      elevation: r.elevation ? Number(r.elevation) : null,
      prominence: r.prominence ? Number(r.prominence) : null,
      type: r.type,
      activities: parseArray(r.activities),
      features: parseArray(r.features),
      lat: r.lat ? Number(r.lat) : null,
      lng: r.lng ? Number(r.lng) : null,
      distance_m: r.distance_m ? Number(r.distance_m) : undefined,
    }));
  } else {
    const result = await db.query(
      `SELECT d.id, d.name, d.elevation, d.prominence, d.type,
              d.activities, d.features,
              ST_Y(d.location::geometry) AS lat,
              ST_X(d.location::geometry) AS lng
       FROM destinations d
       WHERE d.id NOT IN (
         SELECT sd.destination_id FROM session_destinations sd
         JOIN tracking_sessions ts ON ts.id = sd.session_id
         WHERE ts.user_id = $1 AND sd.relation = 'reached'
       )
       ORDER BY d.elevation DESC NULLS LAST
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      elevation: r.elevation ? Number(r.elevation) : null,
      prominence: r.prominence ? Number(r.prominence) : null,
      type: r.type,
      activities: parseArray(r.activities),
      features: parseArray(r.features),
      lat: r.lat ? Number(r.lat) : null,
      lng: r.lng ? Number(r.lng) : null,
    }));
  }
}

/**
 * All destinations whose location falls within the given bounding box.
 * Uses ST_Intersects with ST_MakeEnvelope for spatial index efficiency.
 */
export async function getDestinationsInViewport(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
  limit: number = 200
): Promise<SearchDestination[]> {
  const result = await db.query(
    `SELECT id, name, elevation, prominence, type,
            activities, features,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng
     FROM destinations
     WHERE ST_Intersects(
       location,
       ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
     )
     LIMIT $5`,
    [minLng, minLat, maxLng, maxLat, limit]
  );

  return result.rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    elevation: r.elevation ? Number(r.elevation) : null,
    prominence: r.prominence ? Number(r.prominence) : null,
    type: r.type,
    activities: parseArray(r.activities),
    features: parseArray(r.features),
    lat: r.lat ? Number(r.lat) : null,
    lng: r.lng ? Number(r.lng) : null,
  }));
}

/**
 * All routes whose path intersects the given bounding box.
 * Returns lightweight data suitable for map overlays.
 */
export async function getRoutesInViewport(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
  limit: number = 100
): Promise<ViewportRoute[]> {
  const result = await db.query(
    `SELECT id, name, polyline6, distance, gain
     FROM routes
     WHERE path IS NOT NULL
       AND owner = 'peaks'
       AND status = 'active'
       AND ST_Intersects(
         path,
         ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
       )
     LIMIT $5`,
    [minLng, minLat, maxLng, maxLat, limit]
  );

  return result.rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    polyline6: r.polyline6 ?? null,
    distance: r.distance ? Number(r.distance) : null,
    gain: r.gain ? Number(r.gain) : null,
  }));
}
