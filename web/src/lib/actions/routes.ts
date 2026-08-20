"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import db from "../db";
import type { PoolClient } from "pg";
import { verifyToken } from "../auth-actions";
import { parseAreas, type ProtectedArea } from "../area-types";
import type { RouteAttempt } from "../route-history";
import {
  normalizeRouteProvenance,
  parseRouteProvenance,
  type RouteProvenance,
  type RouteProvenanceInput,
} from "../route-provenance";
import { extractSubPoints } from "../segment-geometry";
import {
  chooseActivationSegmentReference,
  insertRouteSpecificActivationSegment,
} from "../route-segment-reuse";

export interface RouteRow {
  id: string;
  name: string | null;
  owner: string;
  distance: number | null;
  gain: number | null;
  gain_loss: number | null;
  elevation_string: string | null;
  external_links: any[] | null;
  provenance: RouteProvenance | null;
  completion: string;
  shape: string | null;
  status: string;
  destination_count: number;
  created_at: string;
  updated_at: string;
}

export interface RouteDetail extends RouteRow {
  polyline6: string | null;
  geohashes: string[] | null;
  areas: ProtectedArea[];
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

export async function getRoutes(search?: string, limit = 50, offset = 0, status?: string): Promise<{ routes: RouteRow[]; total: number }> {
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  if (status) {
    conditions.push(`r.status = $${paramIdx}`);
    params.push(status);
    paramIdx++;
  }

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
              r.elevation_string, r.external_links, r.provenance, r.completion, r.shape, r.status,
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
    routes: result.rows.map((row) => ({
      ...row,
      provenance: parseRouteProvenance(row.provenance),
    })),
    total: countResult.rows[0].total,
  };
}

export async function getRoute(
  id: string,
  options?: { publicOnly?: boolean }
): Promise<RouteDetail | null> {
  const publicFilter = options?.publicOnly
    ? ` AND r.owner = 'peaks' AND r.status = 'active'`
    : "";

  const result = await db.query(
    `SELECT r.id, r.name, r.owner, r.polyline6, r.geohashes,
            r.distance, r.gain, r.gain_loss, r.elevation_string,
            r.external_links, r.provenance, r.completion, r.shape, r.status,
            (SELECT COUNT(*) FROM route_destinations WHERE route_id = r.id)::int AS destination_count,
            r.created_at, r.updated_at,
            COALESCE(area_rows.areas, '[]'::json) AS areas
     FROM routes r
     LEFT JOIN LATERAL (
       SELECT json_agg(area_obj ORDER BY kind, name) AS areas
       FROM (
         SELECT DISTINCT ON (a.kind, a.name)
                a.kind, a.name,
                json_build_object('id', a.id, 'name', a.name, 'kind', a.kind,
                                  'designation', a.designation, 'manager', a.manager) AS area_obj
         FROM route_areas ra
         JOIN areas a ON a.id = ra.area_id
         WHERE ra.route_id = r.id
         ORDER BY a.kind, a.name, a.designation DESC NULLS LAST, a.id
       ) deduped
     ) area_rows ON true
     WHERE r.id = $1${publicFilter}`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...row,
    areas: parseAreas(row.areas),
    provenance: parseRouteProvenance(row.provenance),
  };
}

export async function getRouteDestinations(
  routeId: string,
  options?: { publicOnly?: boolean }
): Promise<RouteDestination[]> {
  const publicJoin = options?.publicOnly
    ? `JOIN routes r ON r.id = rd.route_id`
    : "";
  const publicFilter = options?.publicOnly
    ? ` AND r.owner = 'peaks' AND r.status = 'active'`
    : "";

  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            rd.ordinal
     FROM destinations d
     JOIN route_destinations rd ON rd.destination_id = d.id
     ${publicJoin}
     WHERE rd.route_id = $1${publicFilter}
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

export async function getRouteSegments(
  routeId: string,
  options?: { publicOnly?: boolean }
): Promise<RouteSegment[]> {
  const publicJoin = options?.publicOnly
    ? `JOIN routes r ON r.id = rs.route_id`
    : "";
  const publicFilter = options?.publicOnly
    ? ` AND r.owner = 'peaks' AND r.status = 'active'`
    : "";

  const result = await db.query(
    `SELECT s.id, s.name, rs.ordinal, rs.direction,
            s.distance, s.gain, s.gain_loss, s.polyline6,
            (SELECT COUNT(*) FROM route_segments rs2 WHERE rs2.segment_id = s.id)::int AS route_count
     FROM segments s
     JOIN route_segments rs ON rs.segment_id = s.id
     ${publicJoin}
     WHERE rs.route_id = $1${publicFilter}
     ORDER BY rs.ordinal`,
    [routeId]
  );
  return result.rows;
}

export async function getRouteElevation(
  routeId: string,
  options?: { publicOnly?: boolean }
): Promise<RouteElevationPoint[]> {
  const publicFilter = options?.publicOnly
    ? ` WHERE id = $1 AND owner = 'peaks' AND status = 'active'`
    : ` WHERE id = $1`;

  const result = await db.query(
    `SELECT (dp).path[1] AS vertex_index,
            ST_X((dp).geom) AS lng,
            ST_Y((dp).geom) AS lat,
            ST_Z((dp).geom) AS elevation
     FROM (SELECT ST_DumpPoints(path::geometry) AS dp
           FROM routes${publicFilter}) sub
     ORDER BY vertex_index`,
    [routeId]
  );
  return result.rows;
}

export async function getRouteSessionCount(
  routeId: string,
  options?: { publicOnly?: boolean }
): Promise<number> {
  const publicJoin = options?.publicOnly
    ? `JOIN routes r ON r.id = sr.route_id`
    : "";
  const publicFilter = options?.publicOnly
    ? ` AND r.owner = 'peaks' AND r.status = 'active'`
    : "";

  const result = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM session_routes sr
     ${publicJoin}
     WHERE sr.route_id = $1${publicFilter}`,
    [routeId]
  );
  return result.rows[0].count;
}

export async function updateRoute(
  id: string,
  data: {
    name?: string;
    completion?: string;
    shape?: string;
    provenance?: RouteProvenanceInput | null;
  }
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
  if (data.provenance !== undefined) {
    const provenance = data.provenance === null
      ? null
      : normalizeRouteProvenance(data.provenance);
    sets.push(`provenance = $${paramIdx}::jsonb`);
    params.push(provenance ? JSON.stringify(provenance) : null);
    paramIdx++;
  }

  if (sets.length === 0) return;

  params.push(id);
  await db.query(
    `UPDATE routes SET ${sets.join(", ")} WHERE id = $${paramIdx}`,
    params
  );
}

/**
 * Accept a pending route — sets status to 'active'.
 */
export async function acceptRoute(id: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await lockRouteActivationDestinations(client, id, null);
    const pending = await client.query(
      `SELECT id
       FROM routes
       WHERE id = $1 AND status = 'pending'
       FOR UPDATE`,
      [id]
    );
    if (pending.rows.length !== 1) {
      throw new Error("Pending route changed before activation");
    }
    await assertNoConflictingLiveRoute(client, id, null);
    await assertRoutePublishIntegrity(client, id, null, "pending");
    await client.query(
      `UPDATE routes SET status = 'active' WHERE id = $1`,
      [id]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reject a pending route — deletes the route and its standalone segments.
 * CASCADE handles route_segments, route_destinations.
 */
export async function rejectRoute(id: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Find segments that ONLY belong to this route (don't delete shared segments)
    const orphanSegments = await client.query(
      `SELECT s.id FROM segments s
       JOIN route_segments rs ON rs.segment_id = s.id
       WHERE rs.route_id = $1
         AND (SELECT COUNT(*) FROM route_segments rs2 WHERE rs2.segment_id = s.id) = 1`,
      [id]
    );

    // Delete the route (cascades to route_segments, route_destinations)
    await client.query(`DELETE FROM routes WHERE id = $1`, [id]);

    // Delete orphan segments
    for (const seg of orphanSegments.rows) {
      await client.query(`DELETE FROM segments WHERE id = $1`, [seg.id]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Analyze a pending route's segments against the existing segment graph.
 * Returns the decomposition for admin review before accepting.
 */
export async function analyzePendingRoute(id: string): Promise<{
  decomposition: import("./segment-matcher").RouteDecomposition;
  points: import("../route-utils").TrackPoint[];
}> {
  // Exclude this route's standalone import segments. Otherwise their exact
  // geometry always wins the matcher and hides shared segments on other routes.
  const currentSegmentsResult = await db.query(
    `SELECT rs.segment_id
       FROM route_segments rs
      WHERE rs.route_id = $1
        AND (
          SELECT COUNT(*) FROM route_segments refs
          WHERE refs.segment_id = rs.segment_id
        ) = 1`,
    [id]
  );
  const currentSegmentIds = currentSegmentsResult.rows.map(
    (row: { segment_id: string }) => row.segment_id
  );

  // Get the route's points from its geometry
  const pointsResult = await db.query(
    `SELECT (dp).path[1] AS vertex_index,
            ST_X((dp).geom) AS lng,
            ST_Y((dp).geom) AS lat,
            ST_Z((dp).geom) AS elevation
     FROM (SELECT ST_DumpPoints(path::geometry) AS dp FROM routes WHERE id = $1) sub
     ORDER BY vertex_index`,
    [id]
  );

  if (pointsResult.rows.length < 2) {
    throw new Error("Route has insufficient points");
  }

  const { haversineDistance } = await import("../gpx");

  // Build TrackPoints with cumulative distance
  const points: import("../route-utils").TrackPoint[] = [];
  let cumDist = 0;
  for (let i = 0; i < pointsResult.rows.length; i++) {
    const row = pointsResult.rows[i];
    if (i > 0) {
      const prev = pointsResult.rows[i - 1];
      cumDist += haversineDistance(
        Number(prev.lat), Number(prev.lng),
        Number(row.lat), Number(row.lng)
      );
    }
    points.push({
      lat: Number(row.lat),
      lng: Number(row.lng),
      ele: Number(row.elevation),
      dist: Math.round(cumDist * 10) / 10,
    });
  }

  const { analyzeRouteSegments } = await import("./segment-matcher");
  const decomposition = await analyzeRouteSegments(points, {
    excludeSegmentIds: currentSegmentIds,
  });

  return { decomposition, points };
}

type RouteFactoryActivation = {
  destinationId: string;
  leaseToken: string;
  replacementRouteId: string | null;
};

async function refuseDirectFactoryActivation(id: string): Promise<void> {
  const factoryJob = await db.query(
    `SELECT destination_id
     FROM standard_route_backfill_jobs
     WHERE published_route_id = $1
       AND state <> 'verified'
     LIMIT 1`,
    [id]
  );
  if (factoryJob.rows.length > 0) {
    throw new Error(
      "This pending route is controlled by the standard-route review queue"
    );
  }
}

async function lockRouteFactoryActivation(
  client: PoolClient,
  id: string,
  activation: RouteFactoryActivation
): Promise<void> {
  const job = await client.query<{ replacement_route_id: string | null }>(
    `SELECT replacement_route_id
     FROM standard_route_backfill_jobs
     WHERE destination_id = $1
       AND state = 'approved'
       AND published_route_id = $2
       AND lease_token = $3
       AND lease_expires_at >= clock_timestamp()
     FOR UPDATE`,
    [activation.destinationId, id, activation.leaseToken]
  );
  if (job.rows.length !== 1) {
    throw new Error("Route activation is not bound to an approved job lease");
  }
  if (
    job.rows[0].replacement_route_id !== activation.replacementRouteId
  ) {
    throw new Error("Route replacement binding changed before activation");
  }
}

async function lockRouteReplacementSettlement(
  client: PoolClient,
  replacementRouteId: string | null
): Promise<void> {
  if (!replacementRouteId) return;
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('peaks-route-replacement:' || $1, 0)
     )`,
    [replacementRouteId]
  );
}

async function lockRouteActivationDestinations(
  client: PoolClient,
  id: string,
  requiredDestinationId: string | null
): Promise<void> {
  const destinations = await client.query<{ id: string }>(
    `SELECT d.id
     FROM route_destinations rd
     JOIN destinations d ON d.id = rd.destination_id
     WHERE rd.route_id = $1
       AND 'summit'::destination_feature = ANY(d.features)
     ORDER BY d.id
     FOR UPDATE OF d`,
    [id]
  );
  if (
    requiredDestinationId &&
    !destinations.rows.some(
      (destination) => destination.id === requiredDestinationId
    )
  ) {
    throw new Error("Pending route is no longer linked to the approved summit");
  }
}

async function assertNoConflictingLiveRoute(
  client: PoolClient,
  id: string,
  replacementRouteId: string | null
): Promise<void> {
  const conflict = await client.query<{ id: string }>(
    `SELECT live_route.id
     FROM routes pending_route
     JOIN route_destinations pending_rd
       ON pending_rd.route_id = pending_route.id
     JOIN destinations destination
       ON destination.id = pending_rd.destination_id
     JOIN route_destinations live_rd
       ON live_rd.destination_id = destination.id
     JOIN routes live_route
       ON live_route.id = live_rd.route_id
     WHERE pending_route.id = $1
       AND 'summit'::destination_feature = ANY(destination.features)
       AND live_route.id <> pending_route.id
       AND ($2::text IS NULL OR live_route.id <> $2)
       AND live_route.owner = 'peaks'
       AND live_route.status IN ('active', 'pending')
       AND lower(live_route.name) = lower(pending_route.name)
     ORDER BY live_route.id
     LIMIT 1
     FOR UPDATE OF live_route`,
    [id, replacementRouteId]
  );
  if (conflict.rows[0]) {
    throw new Error(
      `A conflicting live route appeared before activation: ${conflict.rows[0].id}`
    );
  }
}

async function routePassesPublishIntegrity(
  client: PoolClient,
  id: string,
  requiredDestinationId: string | null,
  requiredStatus: "pending" | "active"
): Promise<boolean> {
  const result = await client.query<{ passes: boolean }>(
    `SELECT peaks_route_passes_publish_integrity($1, $2, $3) AS passes`,
    [id, requiredDestinationId, requiredStatus]
  );
  return result.rows[0]?.passes === true;
}

async function assertRoutePublishIntegrity(
  client: PoolClient,
  id: string,
  requiredDestinationId: string | null,
  requiredStatus: "pending" | "active"
): Promise<void> {
  await client.query(
    `SELECT rd.destination_id
     FROM route_destinations rd
     JOIN destinations d ON d.id = rd.destination_id
     WHERE rd.route_id = $1
     ORDER BY rd.ordinal, rd.destination_id
     FOR UPDATE OF rd, d`,
    [id]
  );
  await client.query(
    `SELECT rs.segment_id
     FROM route_segments rs
     JOIN segments s ON s.id = rs.segment_id
     WHERE rs.route_id = $1
     ORDER BY rs.ordinal, rs.segment_id
     FOR UPDATE OF rs, s`,
    [id]
  );
  if (
    !(await routePassesPublishIntegrity(
      client,
      id,
      requiredDestinationId,
      requiredStatus
    ))
  ) {
    throw new Error(
      "Route failed summit contact, elevation, provenance, or segment assembly gates"
    );
  }
}

async function settleReplacementCoverage(
  client: PoolClient,
  replacementRouteId: string,
  currentDestinationId: string,
  newRouteId: string
): Promise<void> {
  const result = await client.query<{ status: string }>(
    `SELECT settle_route_integrity_replacement($1, $2, $3) AS status`,
    [replacementRouteId, currentDestinationId, newRouteId]
  );
  if (
    result.rows[0]?.status !== "active" &&
    result.rows[0]?.status !== "superseded"
  ) {
    throw new Error("Replacement coverage settlement returned an invalid status");
  }
}

/**
 * Accept a pending route with segment deduplication.
 * Re-analyzes segments server-side (don't rely on client-serialized decomposition
 * which may lose large points arrays), then replaces the standalone segment with
 * the decomposed segments and sets status to 'active'. When this is a standard
 * route rebuild, the old active route becomes superseded in the same
 * transaction so existing plan and session links remain intact.
 */
export async function acceptRouteWithSegments(
  id: string,
  factoryActivation?: RouteFactoryActivation | null
): Promise<void> {
  const replacementRouteId =
    factoryActivation?.replacementRouteId ?? null;
  const replacementDestinationId =
    factoryActivation?.destinationId ?? null;
  if (replacementRouteId === id) {
    throw new Error("A route cannot replace itself");
  }
  if (!factoryActivation) {
    await refuseDirectFactoryActivation(id);
  }
  const { haversineDistance, totalDistance } = await import("../gpx");
  const { encodePolyline6, pointsToLineStringZ, generateId } = await import("../route-utils");
  const { computeElevationStats } = await import("../elevation");

  // Re-analyze server-side to get fresh decomposition with full points arrays
  const { decomposition } = await analyzePendingRoute(id);

  // If decomposition is all "new" segments with no splits or reuses,
  // the existing standalone segment is already correct — just flip status.
  const hasExistingOrSplit = decomposition.segments.some(
    s => s.type === "existing" || s.type === "split"
  );

  if (!hasExistingOrSplit) {
    const client = await db.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      if (factoryActivation) {
        await lockRouteFactoryActivation(client, id, factoryActivation);
      }
      await lockRouteReplacementSettlement(client, replacementRouteId);
      await lockRouteActivationDestinations(
        client,
        id,
        replacementDestinationId
      );
      const pending = await client.query(
        `SELECT id FROM routes
         WHERE id = $1 AND owner = 'peaks' AND status = 'pending'
         FOR UPDATE`,
        [id]
      );
      if (pending.rows.length !== 1) {
        throw new Error("Pending route changed before activation");
      }
      if (replacementRouteId) {
        const replacement = await client.query(
          `SELECT r.id
           FROM routes r
           JOIN route_destinations rd ON rd.route_id = r.id
           WHERE r.id = $1
             AND r.owner = 'peaks'
             AND r.status = 'active'
             AND rd.destination_id = $2
           FOR UPDATE OF r`,
          [replacementRouteId, replacementDestinationId]
        );
        if (replacement.rows.length !== 1) {
          throw new Error("Route replacement changed before activation");
        }
      }
      await assertNoConflictingLiveRoute(
        client,
        id,
        replacementRouteId
      );
      await assertRoutePublishIntegrity(
        client,
        id,
        replacementDestinationId,
        "pending"
      );
      await client.query(
        `UPDATE routes SET status = 'active' WHERE id = $1`,
        [id]
      );
      if (replacementRouteId && replacementDestinationId) {
        await settleReplacementCoverage(
          client,
          replacementRouteId,
          replacementDestinationId,
          id
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    if (factoryActivation) {
      await lockRouteFactoryActivation(client, id, factoryActivation);
    }
    await lockRouteReplacementSettlement(client, replacementRouteId);
    await lockRouteActivationDestinations(
      client,
      id,
      replacementDestinationId
    );

    // Get existing route data
    const routeResult = await client.query(
      `SELECT name, shape, completion, provenance
       FROM routes
       WHERE id = $1 AND owner = 'peaks' AND status = 'pending'
       FOR UPDATE`,
      [id]
    );
    if (routeResult.rows.length === 0) {
      throw new Error("Pending route not found");
    }
    if (replacementRouteId) {
      const replacement = await client.query(
        `SELECT r.id
         FROM routes r
         JOIN route_destinations rd ON rd.route_id = r.id
         WHERE r.id = $1
           AND r.owner = 'peaks'
           AND r.status = 'active'
           AND rd.destination_id = $2
         FOR UPDATE OF r`,
        [replacementRouteId, replacementDestinationId]
      );
      if (replacement.rows.length !== 1) {
        throw new Error("Route replacement changed before activation");
      }
    }
    await assertNoConflictingLiveRoute(
      client,
      id,
      replacementRouteId
    );
    const routeProvenance = routeResult.rows[0].provenance
      ? JSON.stringify(routeResult.rows[0].provenance)
      : null;

    // Find the old standalone segment IDs (before deleting them)
    const oldSegs = await client.query(
      `SELECT s.id FROM segments s
       JOIN route_segments rs ON rs.segment_id = s.id
       WHERE rs.route_id = $1`,
      [id]
    );
    const deletedSegIds = new Set<string>();

    // Clear old route_segments
    await client.query(`DELETE FROM route_segments WHERE route_id = $1`, [id]);

    // Delete orphan standalone segments
    for (const seg of oldSegs.rows) {
      const refCount = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM route_segments WHERE segment_id = $1`,
        [seg.id]
      );
      if (refCount.rows[0].cnt === 0) {
        await client.query(`DELETE FROM segments WHERE id = $1`, [seg.id]);
        deletedSegIds.add(seg.id);
      }
    }

    // Execute splits (same logic as saveRouteWithSegments)
    const splitResults = new Map<string, string[]>();

    for (const split of decomposition.splits) {
      const segResult = await client.query(
        `SELECT ST_AsGeoJSON(path::geometry) AS geojson, name, provenance FROM segments WHERE id = $1`,
        [split.originalSegmentId]
      );
      if (segResult.rows.length === 0) continue;

      const geo = JSON.parse(segResult.rows[0].geojson);
      const origPoints = (geo.coordinates as number[][]).map(
        (c: number[], i: number, arr: number[][]) => {
          let d = 0;
          if (i > 0) {
            for (let j = 1; j <= i; j++) {
              d += haversineDistance(arr[j-1][1], arr[j-1][0], arr[j][1], arr[j][0]);
            }
          }
          return { lat: c[1], lng: c[0], ele: c[2] || 0, dist: d };
        }
      );

      const totalDist = origPoints[origPoints.length - 1].dist;
      const cuts = [0, ...split.fractions, 1];
      const subSegIds: string[] = [];

      for (let i = 0; i < cuts.length - 1; i++) {
        const startDist = cuts[i] * totalDist;
        const endDist = cuts[i + 1] * totalDist;

        const subPoints = extractSubPoints(origPoints, startDist, endDist);
        if (subPoints.length < 2) continue;

        const subId = generateId();
        subSegIds.push(subId);
        const subWkt = pointsToLineStringZ(subPoints);
        const subPoly = encodePolyline6(subPoints);
        const subDist = totalDistance(subPoints);
        const subElev = computeElevationStats(subPoints.map((p: { ele: number }) => p.ele));

        await client.query(
          `INSERT INTO segments (id, name, path, polyline6, distance, gain, gain_loss, provenance)
           VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, $5, $6, $7, $8::jsonb)`,
          [subId, segResult.rows[0].name, subWkt, subPoly, Math.round(subDist), subElev.gain, subElev.loss,
           segResult.rows[0].provenance ? JSON.stringify(segResult.rows[0].provenance) : null]
        );
      }

      splitResults.set(split.originalSegmentId, subSegIds);

      // Update affected routes
      const affected = await client.query(
        `SELECT route_id, ordinal, direction FROM route_segments
         WHERE segment_id = $1 AND route_id != $2 ORDER BY route_id, ordinal`,
        [split.originalSegmentId, id]
      );

      for (const ar of affected.rows) {
        await client.query(
          `DELETE FROM route_segments WHERE route_id = $1 AND segment_id = $2 AND ordinal = $3`,
          [ar.route_id, split.originalSegmentId, ar.ordinal]
        );
        if (subSegIds.length > 1) {
          await client.query(
            `UPDATE route_segments SET ordinal = ordinal + $1 WHERE route_id = $2 AND ordinal > $3`,
            [subSegIds.length - 1, ar.route_id, Number(ar.ordinal)]
          );
        }
        const orderedIds = ar.direction === "reverse" ? [...subSegIds].reverse() : subSegIds;
        for (let j = 0; j < orderedIds.length; j++) {
          await client.query(
            `INSERT INTO route_segments (route_id, segment_id, ordinal, direction) VALUES ($1, $2, $3, $4)`,
            [ar.route_id, orderedIds[j], Number(ar.ordinal) + j, ar.direction]
          );
        }
      }

      await client.query(`DELETE FROM segments WHERE id = $1`, [split.originalSegmentId]);
    }

    // Build new segment references for this route
    const routeSegRefs: { segmentId: string; direction: string }[] = [];

    for (const seg of decomposition.segments) {
      if (seg.type === "existing") {
        const createRouteSpecificSegment = async (): Promise<string> => {
          return insertRouteSpecificActivationSegment({
            client,
            name: seg.name || seg.existingSegmentName || null,
            points: seg.points,
            distance: seg.distance,
            routeProvenance,
          });
        };
        routeSegRefs.push(
          await chooseActivationSegmentReference({
            client,
            existingSegmentId: seg.existingSegmentId!,
            points: seg.points,
            direction: seg.direction || "forward",
            routeProvenance,
            forceRouteSpecific: deletedSegIds.has(seg.existingSegmentId!),
            createRouteSpecificSegment,
          })
        );
      } else if (seg.type === "split") {
        const subIds = splitResults.get(seg.parentSegmentId!);
        if (subIds) {
          const split = decomposition.splits.find(s => s.originalSegmentId === seg.parentSegmentId);
          if (split) {
            const cuts = [0, ...split.fractions, 1];
            for (let i = 0; i < cuts.length - 1; i++) {
              if (seg.startFraction! >= cuts[i] - 0.01 && seg.endFraction! <= cuts[i + 1] + 0.01 && i < subIds.length) {
                routeSegRefs.push({ segmentId: subIds[i], direction: seg.direction || "forward" });
                break;
              }
            }
          }
        }
      } else {
        const newId = await insertRouteSpecificActivationSegment({
          client,
          name: seg.name,
          points: seg.points,
          distance: seg.distance,
          routeProvenance,
        });
        routeSegRefs.push({ segmentId: newId, direction: "forward" });
      }
    }

    // Insert route_segments
    for (let i = 0; i < routeSegRefs.length; i++) {
      await client.query(
        `INSERT INTO route_segments (route_id, segment_id, ordinal, direction) VALUES ($1, $2, $3, $4)`,
        [id, routeSegRefs[i].segmentId, i, routeSegRefs[i].direction]
      );
    }

    await assertRoutePublishIntegrity(
      client,
      id,
      replacementDestinationId,
      "pending"
    );

    // Set the reviewed route to active only after every hard gate passes.
    await client.query(`UPDATE routes SET status = 'active' WHERE id = $1`, [id]);
    if (replacementRouteId && replacementDestinationId) {
      await settleReplacementCoverage(
        client,
        replacementRouteId,
        replacementDestinationId,
        id
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getPendingRouteCount(): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(*)::int AS count FROM routes WHERE status = 'pending'`
  );
  return result.rows[0].count;
}

/**
 * The requesting user's own attempt history on one route — every session of
 * theirs that `session_routes` matched to it (Task 22, "efforts-lite" route
 * history). Strictly own-data: filtered by the verified caller's uid, never
 * a parameter, so this can never return another user's sessions. No
 * leaderboard, no other users' rows — session_routes carries no data this
 * can't honestly answer read-only.
 *
 * A route can be matched to a session either 'manual' (no coverage
 * recorded) or 'auto' (coverage ~0.7-1 in production); both count as a real
 * attempt; there's no principled coverage cutoff that wouldn't also drop
 * legitimate manual matches, which never set coverage at all.
 */
export async function getUserRouteHistory(
  token: string,
  routeId: string
): Promise<RouteAttempt[]> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");

  const result = await db.query(
    `SELECT ts.id AS session_id, ts.start_time, ts.total_time
     FROM session_routes sr
     JOIN tracking_sessions ts ON ts.id = sr.session_id
     WHERE sr.route_id = $1 AND ts.user_id = $2
     ORDER BY ts.start_time ASC`,
    [routeId, user.uid]
  );

  return result.rows.map((r) => ({
    sessionId: r.session_id,
    startTime: r.start_time instanceof Date ? r.start_time.toISOString() : r.start_time,
    totalTime: r.total_time != null ? Number(r.total_time) : null,
  }));
}

/**
 * The batched form of {@link getUserRouteHistory}: one verified token, one
 * query, every requested route's attempt history keyed by route id. A
 * session can match several catalog routes at once (up to 10 in production),
 * and `SessionRouteHistory` needs each match's attempt count to pick which
 * one to feature — calling `getUserRouteHistory` once per match would fire
 * that many separate round trips (and separate `verifyToken` calls) for one
 * section on one page. This does the same read as `ANY($1::text[])` instead,
 * grouped client-side by `route_id`. `getUserRouteHistory` stays as the
 * single-route form for the route page's one-liner, where there is only ever
 * one route in play and a one-element batch call would just be this with
 * extra steps.
 */
export async function getUserRouteHistoryBatch(
  token: string,
  routeIds: string[]
): Promise<Record<string, RouteAttempt[]>> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");
  if (routeIds.length === 0) return {};

  const result = await db.query(
    `SELECT sr.route_id, ts.id AS session_id, ts.start_time, ts.total_time
     FROM session_routes sr
     JOIN tracking_sessions ts ON ts.id = sr.session_id
     WHERE sr.route_id = ANY($1::text[]) AND ts.user_id = $2
     ORDER BY ts.start_time ASC`,
    [routeIds, user.uid]
  );

  const byRoute: Record<string, RouteAttempt[]> = {};
  for (const r of result.rows) {
    const attempt: RouteAttempt = {
      sessionId: r.session_id,
      startTime: r.start_time instanceof Date ? r.start_time.toISOString() : r.start_time,
      totalTime: r.total_time != null ? Number(r.total_time) : null,
    };
    (byRoute[r.route_id] ??= []).push(attempt);
  }
  return byRoute;
}
