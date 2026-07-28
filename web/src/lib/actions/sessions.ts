/* eslint-disable @typescript-eslint/no-explicit-any */
"use server";

import db from "../db";
import { verifyToken } from "../auth-actions";
import { parseAreas, type ProtectedArea } from "../area-types";
import { peaksAPI } from "../peaks-api";
import {
  parseRouteProvenance,
  type RouteProvenance,
} from "../route-provenance";

export type SessionActivityType = "outdoor-trek" | "outdoor-moto" | "ski";
export type SessionActivityFilter =
  | "all"
  | "unknown"
  | SessionActivityType;

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
  activity_type: SessionActivityType | null;
}

export interface SessionDetail extends SessionRow {
  user_id: string;
  ascent_time: number | null;
  descent_time: number | null;
  still_time: number | null;
  health_data: unknown;
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
  provenance: RouteProvenance | null;
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
  offset: number = 0,
  activityFilter: SessionActivityFilter = "all"
): Promise<{ sessions: SessionRow[]; total: number }> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");
  const allowedFilters = new Set<SessionActivityFilter>([
    "all",
    "unknown",
    "outdoor-trek",
    "outdoor-moto",
    "ski",
  ]);
  if (!allowedFilters.has(activityFilter)) {
    throw new Error("Unsupported activity filter");
  }

  const countResult = await db.query(
    `SELECT COUNT(*)
     FROM tracking_sessions
     WHERE user_id = $1
       AND (
         $2::text = 'all'
         OR ($2::text = 'unknown' AND activity_type IS NULL)
         OR activity_type::text = $2::text
       )`,
    [user.uid, activityFilter]
  );

  const result = await db.query(
    `SELECT id, name, start_time, end_time, distance, total_time,
            pace, gain, highest_point, ended, activity_type
     FROM tracking_sessions
     WHERE user_id = $1
       AND (
         $2::text = 'all'
         OR ($2::text = 'unknown' AND activity_type IS NULL)
         OR activity_type::text = $2::text
       )
     ORDER BY start_time DESC
     LIMIT $3 OFFSET $4`,
    [user.uid, activityFilter, limit, offset]
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
      activity_type: r.activity_type ?? null,
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
    `SELECT id,
            CASE WHEN user_id = $2 THEN user_id ELSE '' END AS user_id,
            name, start_time, end_time, distance, total_time,
            pace, gain, highest_point, ascent_time, descent_time, still_time,
            activity_type,
            CASE WHEN user_id = $2 THEN health_data ELSE NULL END AS health_data,
            CASE WHEN user_id = $2 THEN source ELSE NULL END AS source,
            ended, is_public,
            created_at, updated_at
     FROM tracking_sessions
     WHERE id = $1 AND (user_id = $2 OR is_public = true)`,
    [sessionId, user.uid]
  );

  if (result.rows.length === 0) return null;

  const r = result.rows[0];
  return {
    ...r,
    destinationNames: [],
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

  const result = await db.query(
    `WITH numbered_points AS (
       SELECT tp.time, tp.segment_number,
            ST_Y(tp.location::geometry) AS lat,
            ST_X(tp.location::geometry) AS lng,
            tp.elevation, tp.speed,
            row_number() OVER (ORDER BY tp.time) AS point_index,
            count(*) OVER () AS point_count,
            row_number() OVER (
              PARTITION BY tp.segment_number ORDER BY tp.time
            ) AS segment_point_index,
            count(*) OVER (
              PARTITION BY tp.segment_number
            ) AS segment_point_count
       FROM tracking_points tp
       JOIN tracking_sessions ts ON ts.id = tp.session_id
       WHERE tp.session_id = $1
         AND (ts.user_id = $2 OR ts.is_public = true)
     ),
     sampled_points AS (
       SELECT *,
              GREATEST(
                1,
                CEIL(point_count::numeric / 1998.0)::bigint
              ) AS sample_stride
       FROM numbered_points
     ),
     candidate_points AS (
       SELECT *
       FROM sampled_points
       WHERE point_count <= 2000
          OR point_index = 1
          OR point_index = point_count
          OR segment_point_index = 1
          OR segment_point_index = segment_point_count
          OR MOD(point_index - 1, sample_stride) = 0
     ),
     bucketed_points AS (
       SELECT *,
              ntile(2000) OVER (ORDER BY time) AS sample_bucket
       FROM candidate_points
     ),
     limited_points AS (
       SELECT DISTINCT ON (sample_bucket)
              time, segment_number, lat, lng, elevation, speed
       FROM bucketed_points
       ORDER BY sample_bucket,
                CASE WHEN sample_bucket = 2000 THEN time END DESC NULLS LAST,
                time ASC
     )
     SELECT time, segment_number, lat, lng, elevation, speed
     FROM limited_points
     ORDER BY time`,
    [sessionId, user.uid]
  );

  return result.rows.map((r: any) => ({
    time: Number(r.time),
    segment_number: Number(r.segment_number),
    lat: Number(r.lat),
    lng: Number(r.lng),
    elevation: r.elevation != null ? Number(r.elevation) : null,
    speed: r.speed != null ? Number(r.speed) : null,
  }));
}

export interface SessionPointExportPage {
  points: SessionPoint[];
  hasMore: boolean;
}

export async function getSessionPointsForExport(
  token: string,
  sessionId: string,
  afterTime: number | null = null,
  limit: number = 5000
): Promise<SessionPointExportPage> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 100), 5000);
  if (
    afterTime != null &&
    (!Number.isSafeInteger(afterTime) || afterTime < 0)
  ) {
    throw new Error("Invalid export cursor");
  }

  const result = await db.query(
    `SELECT tp.time, tp.segment_number,
            ST_Y(tp.location::geometry) AS lat,
            ST_X(tp.location::geometry) AS lng,
            tp.elevation, tp.speed
     FROM tracking_points tp
     JOIN tracking_sessions ts ON ts.id = tp.session_id
     WHERE tp.session_id = $1
       AND (ts.user_id = $2 OR ts.is_public = true)
       AND ($3::bigint IS NULL OR tp.time > $3::bigint)
     ORDER BY tp.time
     LIMIT $4`,
    [sessionId, user.uid, afterTime, safeLimit + 1]
  );

  const rows = result.rows.slice(0, safeLimit);
  return {
    points: rows.map((r: any) => ({
    time: Number(r.time),
    segment_number: Number(r.segment_number),
    lat: Number(r.lat),
    lng: Number(r.lng),
    elevation: r.elevation != null ? Number(r.elevation) : null,
    speed: r.speed != null ? Number(r.speed) : null,
    })),
    hasMore: result.rows.length > safeLimit,
  };
}

export async function getSessionDestinations(
  token: string,
  sessionId: string
): Promise<SessionDestination[]> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");

  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            sd.relation
     FROM session_destinations sd
     JOIN destinations d ON d.id = sd.destination_id
     JOIN tracking_sessions ts ON ts.id = sd.session_id
     WHERE sd.session_id = $1
       AND (ts.user_id = $2 OR ts.is_public = true)
     ORDER BY d.name ASC NULLS LAST`,
    [sessionId, user.uid]
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
  token: string,
  sessionId: string
): Promise<SessionRoute[]> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");

  const result = await db.query(
    `SELECT r.id, r.name, r.polyline6, r.distance, r.gain, r.provenance
     FROM session_routes sr
     JOIN routes r ON r.id = sr.route_id
     JOIN tracking_sessions ts ON ts.id = sr.session_id
     WHERE sr.session_id = $1
       AND (ts.user_id = $2 OR ts.is_public = true)
       AND r.status = 'active'
     ORDER BY r.name ASC NULLS LAST`,
    [sessionId, user.uid]
  );

  return result.rows.map((r: any) => ({
    ...r,
    distance: r.distance != null ? Number(r.distance) : null,
    gain: r.gain != null ? Number(r.gain) : null,
    provenance: parseRouteProvenance(r.provenance),
  }));
}

export async function getSessionAreas(
  token: string,
  sessionId: string
): Promise<ProtectedArea[]> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");

  const result = await db.query(
    `SELECT COALESCE(json_agg(area_obj ORDER BY kind, name), '[]'::json) AS areas
     FROM (
       SELECT DISTINCT ON (a.kind, a.name)
              a.kind, a.name,
              json_build_object('id', a.id, 'name', a.name, 'kind', a.kind,
                                'designation', a.designation, 'manager', a.manager) AS area_obj
       FROM session_areas sa
       JOIN areas a ON a.id = sa.area_id
       JOIN tracking_sessions ts ON ts.id = sa.session_id
       WHERE sa.session_id = $1
         AND (ts.user_id = $2 OR ts.is_public = true)
       ORDER BY a.kind, a.name, a.designation DESC NULLS LAST, a.id
     ) deduped`,
    [sessionId, user.uid]
  );
  return parseAreas(result.rows[0]?.areas ?? []);
}

export interface SessionMetadataUpdate {
  name: string | null;
  activity_type: SessionActivityType | null;
  is_public: boolean;
}

const SESSION_ACTIVITY_TYPES = new Set<SessionActivityType>([
  "outdoor-trek",
  "outdoor-moto",
  "ski",
]);

export async function updateSessionMetadata(
  token: string,
  sessionId: string,
  updates: SessionMetadataUpdate
): Promise<void> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");

  const trimmedName = updates.name?.trim() || null;
  if (trimmedName && trimmedName.length > 120) {
    throw new Error("Session names must be 120 characters or fewer");
  }
  if (
    updates.activity_type != null &&
    !SESSION_ACTIVITY_TYPES.has(updates.activity_type)
  ) {
    throw new Error("Unsupported activity type");
  }
  if (typeof updates.is_public !== "boolean") {
    throw new Error("Visibility must be public or private");
  }

  const result = await db.query(
    `UPDATE tracking_sessions
     SET name = $3,
         activity_type = $4::activity_type,
         is_public = $5
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [
      sessionId,
      user.uid,
      trimmedName,
      updates.activity_type,
      updates.is_public,
    ]
  );

  if (result.rows.length === 0) {
    throw new Error("Session not found");
  }
}

export async function deleteSession(
  token: string,
  sessionId: string
): Promise<void> {
  if (!(await verifyToken(token))) throw new Error("Unauthorized");
  await peaksAPI(
    token,
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
    "Could not delete activity"
  );
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
