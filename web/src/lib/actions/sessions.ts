/* eslint-disable @typescript-eslint/no-explicit-any */
"use server";

import db from "../db";
import { verifyToken } from "../auth-actions";

/** pg may return custom enum arrays as "{a,b}" strings instead of JS arrays */
function parseArray(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string" && val.startsWith("{")) {
    return val.slice(1, -1).split(",").filter(Boolean);
  }
  return [];
}

export interface SessionRow {
  id: string;
  name: string | null;
  destinationNames: string[];
  start_time: string;
  end_time: string | null;
  distance: number | null;
  total_time: number | null;
  pace: number | null;
  gain: number | null;
  highest_point: number | null;
  ended: boolean;
}

export interface SessionDetail extends SessionRow {
  user_id: string;
  ascent_time: number | null;
  descent_time: number | null;
  still_time: number | null;
  health_data: any | null;
  source: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface SessionPoint {
  time: number;
  segment_number: number;
  lat: number;
  lng: number;
  elevation: number | null;
  speed: number | null;
}

export interface SessionDestination {
  id: string;
  name: string | null;
  elevation: number | null;
  features: string[];
  lat: number;
  lng: number;
  relation: string;
}

export interface SessionRoute {
  id: string;
  name: string | null;
  polyline6: string | null;
  distance: number | null;
  gain: number | null;
}

export interface UserStats {
  total_sessions: number;
  total_distance: number;
  total_gain: number;
  total_time: number;
  destinations_reached: number;
}

export async function getUserSessions(
  token: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ sessions: SessionRow[]; total: number }> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");

  const countResult = await db.query(
    `SELECT COUNT(*) FROM tracking_sessions WHERE user_id = $1`,
    [user.uid]
  );

  const result = await db.query(
    `SELECT id, name, start_time, end_time, distance, total_time,
            pace, gain, highest_point, ended
     FROM tracking_sessions
     WHERE user_id = $1
     ORDER BY start_time DESC
     LIMIT $2 OFFSET $3`,
    [user.uid, limit, offset]
  );

  // Fetch destination names for each session (to derive display names)
  const sessionIds = result.rows.map((r: any) => r.id);
  const destNameMap: Record<string, string[]> = {};

  if (sessionIds.length > 0) {
    const destResult = await db.query(
      `SELECT sd.session_id, d.name
       FROM session_destinations sd
       JOIN destinations d ON d.id = sd.destination_id
       WHERE sd.session_id = ANY($1)
       ORDER BY d.elevation DESC NULLS LAST`,
      [sessionIds]
    );
    for (const row of destResult.rows) {
      if (!destNameMap[row.session_id]) destNameMap[row.session_id] = [];
      if (row.name) destNameMap[row.session_id].push(row.name);
    }
  }

  return {
    sessions: result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      destinationNames: destNameMap[r.id] || [],
      start_time: r.start_time instanceof Date ? r.start_time.toISOString() : r.start_time,
      end_time: r.end_time instanceof Date ? r.end_time.toISOString() : r.end_time,
      distance: r.distance != null ? Number(r.distance) : null,
      total_time: r.total_time != null ? Number(r.total_time) : null,
      pace: r.pace != null ? Number(r.pace) : null,
      gain: r.gain != null ? Number(r.gain) : null,
      highest_point: r.highest_point != null ? Number(r.highest_point) : null,
      ended: r.ended,
    })),
    total: Number(countResult.rows[0].count),
  };
}

export async function getSession(
  token: string,
  sessionId: string
): Promise<SessionDetail | null> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");

  const result = await db.query(
    `SELECT id, user_id, name, start_time, end_time, distance, total_time,
            pace, gain, highest_point, ascent_time, descent_time, still_time,
            activity_type, health_data, source, ended, is_public,
            created_at, updated_at
     FROM tracking_sessions
     WHERE id = $1 AND (user_id = $2 OR is_public = true)`,
    [sessionId, user.uid]
  );

  if (result.rows.length === 0) return null;

  const r = result.rows[0];
  return {
    ...r,
    start_time: r.start_time instanceof Date ? r.start_time.toISOString() : r.start_time,
    end_time: r.end_time instanceof Date ? r.end_time.toISOString() : r.end_time,
    distance: r.distance != null ? Number(r.distance) : null,
    total_time: r.total_time != null ? Number(r.total_time) : null,
    pace: r.pace != null ? Number(r.pace) : null,
    gain: r.gain != null ? Number(r.gain) : null,
    highest_point: r.highest_point != null ? Number(r.highest_point) : null,
    ascent_time: r.ascent_time != null ? Number(r.ascent_time) : null,
    descent_time: r.descent_time != null ? Number(r.descent_time) : null,
    still_time: r.still_time != null ? Number(r.still_time) : null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
}

export async function getSessionPoints(
  token: string,
  sessionId: string
): Promise<SessionPoint[]> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");

  // Verify the user has access to this session
  const access = await db.query(
    `SELECT id FROM tracking_sessions
     WHERE id = $1 AND (user_id = $2 OR is_public = true)`,
    [sessionId, user.uid]
  );
  if (access.rows.length === 0) throw new Error("Session not found");

  const result = await db.query(
    `SELECT time, segment_number,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng,
            elevation, speed
     FROM tracking_points
     WHERE session_id = $1
     ORDER BY time`,
    [sessionId]
  );

  let points: SessionPoint[] = result.rows.map((r: any) => ({
    time: Number(r.time),
    segment_number: Number(r.segment_number),
    lat: Number(r.lat),
    lng: Number(r.lng),
    elevation: r.elevation != null ? Number(r.elevation) : null,
    speed: r.speed != null ? Number(r.speed) : null,
  }));

  // Downsample if more than 2000 points, keeping first and last
  if (points.length > 2000) {
    const nth = Math.ceil(points.length / 2000);
    const downsampled: SessionPoint[] = [points[0]];
    for (let i = nth; i < points.length - 1; i += nth) {
      downsampled.push(points[i]);
    }
    downsampled.push(points[points.length - 1]);
    points = downsampled;
  }

  return points;
}

export async function getSessionDestinations(
  sessionId: string
): Promise<SessionDestination[]> {
  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            sd.relation
     FROM session_destinations sd
     JOIN destinations d ON d.id = sd.destination_id
     WHERE sd.session_id = $1
     ORDER BY d.name ASC NULLS LAST`,
    [sessionId]
  );

  return result.rows.map((r: any) => ({
    ...r,
    elevation: r.elevation != null ? Number(r.elevation) : null,
    features: parseArray(r.features),
    lat: Number(r.lat),
    lng: Number(r.lng),
  }));
}

export async function getSessionRoutes(
  sessionId: string
): Promise<SessionRoute[]> {
  const result = await db.query(
    `SELECT r.id, r.name, r.polyline6, r.distance, r.gain
     FROM session_routes sr
     JOIN routes r ON r.id = sr.route_id
     WHERE sr.session_id = $1
     ORDER BY r.name ASC NULLS LAST`,
    [sessionId]
  );

  return result.rows.map((r: any) => ({
    ...r,
    distance: r.distance != null ? Number(r.distance) : null,
    gain: r.gain != null ? Number(r.gain) : null,
  }));
}

export async function getUserStats(
  token: string
): Promise<UserStats> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");

  const statsResult = await db.query(
    `SELECT COUNT(*) AS total_sessions,
            COALESCE(SUM(distance), 0) AS total_distance,
            COALESCE(SUM(gain), 0) AS total_gain,
            COALESCE(SUM(total_time), 0) AS total_time
     FROM tracking_sessions
     WHERE user_id = $1`,
    [user.uid]
  );

  const destResult = await db.query(
    `SELECT COUNT(DISTINCT sd.destination_id) AS destinations_reached
     FROM session_destinations sd
     JOIN tracking_sessions ts ON ts.id = sd.session_id
     WHERE ts.user_id = $1 AND sd.relation = 'reached'`,
    [user.uid]
  );

  const s = statsResult.rows[0];
  return {
    total_sessions: Number(s.total_sessions),
    total_distance: Number(s.total_distance),
    total_gain: Number(s.total_gain),
    total_time: Number(s.total_time),
    destinations_reached: Number(destResult.rows[0].destinations_reached),
  };
}
