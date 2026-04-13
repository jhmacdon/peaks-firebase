/* eslint-disable @typescript-eslint/no-explicit-any */
"use server";

import db from "../db";

/** pg may return custom enum arrays as "{a,b}" strings instead of JS arrays */
function parseArray(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string" && val.startsWith("{")) {
    return val.slice(1, -1).split(",").filter(Boolean);
  }
  return [];
}

export interface AdminSessionRow {
  id: string;
  user_id: string;
  name: string | null;
  destinationNames: string[];
  start_time: string;
  end_time: string | null;
  distance: number | null;
  total_time: number | null;
  gain: number | null;
  highest_point: number | null;
  source: string | null;
  ended: boolean;
  point_count: number;
}

export type AdminSessionSort = "start_time" | "distance" | "gain" | "total_time" | "highest_point";
export type SortDir = "asc" | "desc";

export async function getAdminSessions(
  search: string = "",
  limit: number = 50,
  offset: number = 0,
  sort?: { field: AdminSessionSort; dir: SortDir },
  filters?: { user_id?: string; destination_id?: string }
): Promise<{ sessions: AdminSessionRow[]; total: number }> {
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (filters?.user_id) {
    conditions.push(`ts.user_id = $${paramIndex}`);
    params.push(filters.user_id);
    paramIndex++;
  }

  if (filters?.destination_id) {
    conditions.push(
      `EXISTS (SELECT 1 FROM session_destinations sd WHERE sd.session_id = ts.id AND sd.destination_id = $${paramIndex})`
    );
    params.push(filters.destination_id);
    paramIndex++;
  }

  if (search.trim()) {
    conditions.push(`(ts.name ILIKE $${paramIndex} OR ts.id = $${paramIndex + 1})`);
    params.push(`%${search.trim()}%`, search.trim());
    paramIndex += 2;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await db.query(
    `SELECT COUNT(*) FROM tracking_sessions ts ${where}`,
    params
  );

  const sortColumnMap: Record<AdminSessionSort, string> = {
    start_time: "ts.start_time",
    distance: "ts.distance",
    gain: "ts.gain",
    total_time: "ts.total_time",
    highest_point: "ts.highest_point",
  };
  const sortField = sort?.field || "start_time";
  const sortDir = sort?.dir === "asc" ? "ASC" : "DESC";
  const sortCol = sortColumnMap[sortField];
  const nulls = sortDir === "ASC" ? "NULLS LAST" : "NULLS FIRST";

  const result = await db.query(
    `SELECT ts.id, ts.user_id, ts.name, ts.start_time, ts.end_time,
            ts.distance, ts.total_time, ts.gain, ts.highest_point,
            ts.source, ts.ended,
            (SELECT COUNT(*) FROM tracking_points tp WHERE tp.session_id = ts.id) as point_count
     FROM tracking_sessions ts
     ${where}
     ORDER BY ${sortCol} ${sortDir} ${nulls}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  // Fetch destination names for display
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
      user_id: r.user_id,
      name: r.name,
      destinationNames: destNameMap[r.id] || [],
      start_time: r.start_time instanceof Date ? r.start_time.toISOString() : r.start_time,
      end_time: r.end_time instanceof Date ? r.end_time.toISOString() : r.end_time,
      distance: r.distance != null ? Number(r.distance) : null,
      total_time: r.total_time != null ? Number(r.total_time) : null,
      gain: r.gain != null ? Number(r.gain) : null,
      highest_point: r.highest_point != null ? Number(r.highest_point) : null,
      source: r.source,
      ended: r.ended,
      point_count: Number(r.point_count),
    })),
    total: Number(countResult.rows[0].count),
  };
}

export interface AdminSessionDetail {
  id: string;
  user_id: string;
  name: string | null;
  start_time: string;
  end_time: string | null;
  distance: number | null;
  total_time: number | null;
  pace: number | null;
  gain: number | null;
  highest_point: number | null;
  ascent_time: number | null;
  descent_time: number | null;
  still_time: number | null;
  source: string | null;
  ended: boolean;
  is_public: boolean;
  processing_state: string | null;
  created_at: string;
  updated_at: string;
}

export async function getAdminSession(
  sessionId: string
): Promise<AdminSessionDetail | null> {
  const result = await db.query(
    `SELECT id, user_id, name, start_time, end_time, distance, total_time,
            pace, gain, highest_point, ascent_time, descent_time, still_time,
            source, ended, is_public, processing_state, created_at, updated_at
     FROM tracking_sessions
     WHERE id = $1`,
    [sessionId]
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

export interface AdminSessionPoint {
  time: number;
  segment_number: number;
  lat: number;
  lng: number;
  elevation: number | null;
  speed: number | null;
}

export async function getAdminSessionPoints(
  sessionId: string
): Promise<AdminSessionPoint[]> {
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

  let points: AdminSessionPoint[] = result.rows.map((r: any) => ({
    time: Number(r.time),
    segment_number: Number(r.segment_number),
    lat: Number(r.lat),
    lng: Number(r.lng),
    elevation: r.elevation != null ? Number(r.elevation) : null,
    speed: r.speed != null ? Number(r.speed) : null,
  }));

  if (points.length > 2000) {
    const nth = Math.ceil(points.length / 2000);
    const downsampled: AdminSessionPoint[] = [points[0]];
    for (let i = nth; i < points.length - 1; i += nth) {
      downsampled.push(points[i]);
    }
    downsampled.push(points[points.length - 1]);
    points = downsampled;
  }

  return points;
}

export interface AdminSessionDestination {
  id: string;
  name: string | null;
  elevation: number | null;
  features: string[];
  lat: number;
  lng: number;
  relation: string;
  source: string;
}

export async function getAdminSessionDestinations(
  sessionId: string
): Promise<AdminSessionDestination[]> {
  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            sd.relation, sd.source
     FROM session_destinations sd
     JOIN destinations d ON d.id = sd.destination_id
     WHERE sd.session_id = $1
     ORDER BY d.elevation DESC NULLS LAST`,
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
