/* eslint-disable @typescript-eslint/no-explicit-any */
"use server";

import db from "../db";
import { parseAreas, type ProtectedArea } from "../area-types";
import { routeDoneCoverageSql } from "../route-coverage";
import {
  parseRouteProvenance,
} from "../route-provenance";
import type {
  SessionDestination,
  SessionDetail,
  SessionPoint,
  SessionRoute,
} from "./sessions";

export interface PublicSessionBundle {
  session: SessionDetail;
  points: SessionPoint[];
  destinations: SessionDestination[];
  routes: SessionRoute[];
  areas: ProtectedArea[];
}

function parseArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (
    typeof value === "string" &&
    value.startsWith("{") &&
    value.endsWith("}")
  ) {
    return value.slice(1, -1).split(",").filter(Boolean);
  }
  return [];
}

function assertSessionId(sessionId: string): void {
  if (
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    sessionId.length > 1_500
  ) {
    throw new Error("Invalid activity");
  }
}

/**
 * Load every read-only section of a public activity for a signed-out viewer.
 * Each child query repeats the visibility check so a private session cannot
 * leak related rows if visibility changes while this request is running.
 */
export async function getPublicSessionBundle(
  sessionId: string
): Promise<PublicSessionBundle | null> {
  assertSessionId(sessionId);

  const sessionResult = await db.query(
    `SELECT id, name, start_time, end_time, distance, total_time,
            pace, gain, highest_point, ascent_time, descent_time, still_time,
            activity_type, ended, is_public, created_at, updated_at
     FROM tracking_sessions
     WHERE id = $1 AND is_public = true`,
    [sessionId]
  );

  if (sessionResult.rows.length === 0) return null;

  const [pointResult, destinationResult, routeResult, areaResult] =
    await Promise.all([
      db.query(
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
           WHERE tp.session_id = $1 AND ts.is_public = true
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
        [sessionId]
      ),
      db.query(
        `SELECT d.id, d.name, d.elevation, d.features,
                ST_Y(d.location::geometry) AS lat,
                ST_X(d.location::geometry) AS lng,
                sd.relation
         FROM session_destinations sd
         JOIN destinations d ON d.id = sd.destination_id
         JOIN tracking_sessions ts ON ts.id = sd.session_id
         WHERE sd.session_id = $1 AND ts.is_public = true
         ORDER BY d.name ASC NULLS LAST`,
        [sessionId]
      ),
      db.query(
        `SELECT r.id, r.name, r.polyline6, r.distance, r.gain, r.provenance
         FROM session_routes sr
         JOIN routes r ON r.id = sr.route_id
         JOIN tracking_sessions ts ON ts.id = sr.session_id
         WHERE sr.session_id = $1 AND ts.is_public = true
           AND ${routeDoneCoverageSql("sr")}
           AND r.status IN ('active', 'superseded')
         ORDER BY r.name ASC NULLS LAST`,
        [sessionId]
      ),
      db.query(
        `SELECT COALESCE(
                  json_agg(
                    json_build_object(
                      'id', a.id,
                      'name', a.name,
                      'kind', a.kind,
                      'designation', a.designation,
                      'manager', a.manager,
                      'parent_id', NULLIF(to_jsonb(a)->>'parent_area_id', '')
                    )
                    ORDER BY a.kind, a.name
                  ),
                  '[]'::json
                ) AS areas
         FROM session_areas sa
         JOIN areas a ON a.id = sa.area_id
         JOIN tracking_sessions ts ON ts.id = sa.session_id
         WHERE sa.session_id = $1 AND ts.is_public = true`,
        [sessionId]
      ),
    ]);

  const row = sessionResult.rows[0];
  const session: SessionDetail = {
    id: String(row.id),
    // Do not expose the owner's Firebase UID to an anonymous viewer. A signed-in
    // owner reloads through the authenticated action and receives their UID.
    user_id: "",
    name: row.name ?? null,
    destinationNames: [],
    start_time:
      row.start_time instanceof Date
        ? row.start_time.toISOString()
        : row.start_time,
    end_time:
      row.end_time instanceof Date ? row.end_time.toISOString() : row.end_time,
    distance: row.distance != null ? Number(row.distance) : null,
    total_time: row.total_time != null ? Number(row.total_time) : null,
    pace: row.pace != null ? Number(row.pace) : null,
    gain: row.gain != null ? Number(row.gain) : null,
    highest_point:
      row.highest_point != null ? Number(row.highest_point) : null,
    ascent_time: row.ascent_time != null ? Number(row.ascent_time) : null,
    descent_time: row.descent_time != null ? Number(row.descent_time) : null,
    still_time: row.still_time != null ? Number(row.still_time) : null,
    activity_type: row.activity_type ?? null,
    health_data: null,
    source: null,
    ended: row.ended === true,
    is_public: true,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
  };

  return {
    session,
    points: pointResult.rows.map((point: any) => ({
      time: Number(point.time),
      segment_number: Number(point.segment_number),
      lat: Number(point.lat),
      lng: Number(point.lng),
      elevation:
        point.elevation != null ? Number(point.elevation) : null,
      speed: point.speed != null ? Number(point.speed) : null,
    })),
    destinations: destinationResult.rows.map((destination: any) => ({
      id: String(destination.id),
      name: destination.name ?? null,
      elevation:
        destination.elevation != null
          ? Number(destination.elevation)
          : null,
      features: parseArray(destination.features),
      lat: Number(destination.lat),
      lng: Number(destination.lng),
      relation: String(destination.relation),
    })),
    routes: routeResult.rows.map((route: any) => ({
      id: String(route.id),
      name: route.name ?? null,
      polyline6: route.polyline6 ?? null,
      distance: route.distance != null ? Number(route.distance) : null,
      gain: route.gain != null ? Number(route.gain) : null,
      provenance: parseRouteProvenance(route.provenance),
    })),
    areas: parseAreas(areaResult.rows[0]?.areas ?? []),
  };
}
