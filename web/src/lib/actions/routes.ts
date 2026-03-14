"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import db from "@/lib/db";

export interface RouteRow {
  id: string;
  name: string | null;
  owner: string;
  distance: number | null;
  gain: number | null;
  gain_loss: number | null;
  elevation_string: string | null;
  external_links: any[] | null;
  completion: string;
  shape: string | null;
  destination_count: number;
  created_at: string;
  updated_at: string;
}

export interface RouteDetail extends RouteRow {
  polyline6: string | null;
  geohashes: string[] | null;
}

export interface RouteDestination {
  id: string;
  name: string | null;
  elevation: number | null;
  features: string[];
  lat: number;
  lng: number;
  ordinal: number;
}

export interface RouteElevationPoint {
  vertex_index: number;
  lat: number;
  lng: number;
  elevation: number;
}

export async function getRoutes(search?: string, limit = 50, offset = 0): Promise<{ routes: RouteRow[]; total: number }> {
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  if (search && search.trim()) {
    conditions.push(`r.name ILIKE $${paramIdx}`);
    params.push(`%${search.trim()}%`);
    paramIdx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit, offset);

  const [result, countResult] = await Promise.all([
    db.query(
      `SELECT r.id, r.name, r.owner, r.distance, r.gain, r.gain_loss,
              r.elevation_string, r.external_links, r.completion, r.shape,
              (SELECT COUNT(*) FROM route_destinations WHERE route_id = r.id)::int AS destination_count,
              r.created_at, r.updated_at
       FROM routes r
       ${where}
       ORDER BY r.name NULLS LAST
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    ),
    db.query(
      `SELECT COUNT(*)::int AS total FROM routes r ${where}`,
      params.slice(0, paramIdx - 1)
    ),
  ]);

  return {
    routes: result.rows,
    total: countResult.rows[0].total,
  };
}

export async function getRoute(id: string): Promise<RouteDetail | null> {
  const result = await db.query(
    `SELECT r.id, r.name, r.owner, r.polyline6, r.geohashes,
            r.distance, r.gain, r.gain_loss, r.elevation_string,
            r.external_links, r.completion, r.shape,
            (SELECT COUNT(*) FROM route_destinations WHERE route_id = r.id)::int AS destination_count,
            r.created_at, r.updated_at
     FROM routes r
     WHERE r.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

export async function getRouteDestinations(routeId: string): Promise<RouteDestination[]> {
  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            rd.ordinal
     FROM destinations d
     JOIN route_destinations rd ON rd.destination_id = d.id
     WHERE rd.route_id = $1
     ORDER BY rd.ordinal`,
    [routeId]
  );
  return result.rows;
}

export interface RouteSegment {
  id: string;
  name: string | null;
  ordinal: number;
  direction: string;
  distance: number | null;
  gain: number | null;
  gain_loss: number | null;
  polyline6: string | null;
  route_count: number;
}

export async function getRouteSegments(routeId: string): Promise<RouteSegment[]> {
  const result = await db.query(
    `SELECT s.id, s.name, rs.ordinal, rs.direction,
            s.distance, s.gain, s.gain_loss, s.polyline6,
            (SELECT COUNT(*) FROM route_segments rs2 WHERE rs2.segment_id = s.id)::int AS route_count
     FROM segments s
     JOIN route_segments rs ON rs.segment_id = s.id
     WHERE rs.route_id = $1
     ORDER BY rs.ordinal`,
    [routeId]
  );
  return result.rows;
}

export async function getRouteElevation(routeId: string): Promise<RouteElevationPoint[]> {
  const result = await db.query(
    `SELECT (dp).path[1] AS vertex_index,
            ST_X((dp).geom) AS lng,
            ST_Y((dp).geom) AS lat,
            ST_Z((dp).geom) AS elevation
     FROM (SELECT ST_DumpPoints(path::geometry) AS dp
           FROM routes WHERE id = $1) sub
     ORDER BY vertex_index`,
    [routeId]
  );
  return result.rows;
}

export async function getRouteSessionCount(routeId: string): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(*)::int AS count FROM session_routes WHERE route_id = $1`,
    [routeId]
  );
  return result.rows[0].count;
}

export async function updateRoute(
  id: string,
  data: { name?: string; completion?: string; shape?: string }
): Promise<void> {
  const sets: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  if (data.name !== undefined) {
    sets.push(`name = $${paramIdx}`);
    params.push(data.name);
    paramIdx++;
  }
  if (data.completion !== undefined) {
    sets.push(`completion = $${paramIdx}::completion_mode`);
    params.push(data.completion);
    paramIdx++;
  }
  if (data.shape !== undefined) {
    sets.push(`shape = $${paramIdx}::route_shape`);
    params.push(data.shape);
    paramIdx++;
  }

  if (sets.length === 0) return;

  params.push(id);
  await db.query(
    `UPDATE routes SET ${sets.join(", ")} WHERE id = $${paramIdx}`,
    params
  );
}
