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
  status: string;
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
              r.elevation_string, r.external_links, r.completion, r.shape, r.status,
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
            r.external_links, r.completion, r.shape, r.status,
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

/**
 * Accept a pending route — sets status to 'active'.
 */
export async function acceptRoute(id: string): Promise<void> {
  await db.query(
    `UPDATE routes SET status = 'active' WHERE id = $1 AND status = 'pending'`,
    [id]
  );
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
  points: import("@/lib/route-utils").TrackPoint[];
}> {
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

  const { haversineDistance } = await import("@/lib/gpx");

  // Build TrackPoints with cumulative distance
  const points: import("@/lib/route-utils").TrackPoint[] = [];
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
  const decomposition = await analyzeRouteSegments(points);

  return { decomposition, points };
}

/**
 * Accept a pending route with segment deduplication.
 * Replaces the route's standalone segment with the analyzed decomposition,
 * then sets status to 'active'.
 */
export async function acceptRouteWithSegments(
  id: string,
  decomposition: import("./segment-matcher").RouteDecomposition
): Promise<void> {
  const { haversineDistance, totalDistance } = await import("@/lib/gpx");
  const { encodePolyline6, pointsToLineStringZ, generateId } = await import("@/lib/route-utils");
  const { computeElevationStats } = await import("@/lib/elevation");

  // If decomposition is all "new" segments with no splits or reuses,
  // the existing standalone segment is already correct — just flip status.
  const hasExistingOrSplit = decomposition.segments.some(
    s => s.type === "existing" || s.type === "split"
  );

  if (!hasExistingOrSplit) {
    await db.query(`UPDATE routes SET status = 'active' WHERE id = $1 AND status = 'pending'`, [id]);
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Get existing route data
    const routeResult = await client.query(
      `SELECT name, shape, completion FROM routes WHERE id = $1 AND status = 'pending'`,
      [id]
    );
    if (routeResult.rows.length === 0) {
      throw new Error("Pending route not found");
    }

    // Find and delete the old standalone segments (only those used exclusively by this route)
    const oldSegs = await client.query(
      `SELECT s.id FROM segments s
       JOIN route_segments rs ON rs.segment_id = s.id
       WHERE rs.route_id = $1`,
      [id]
    );

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
      }
    }

    // Execute splits (same logic as saveRouteWithSegments)
    const splitResults = new Map<string, string[]>();

    for (const split of decomposition.splits) {
      const segResult = await client.query(
        `SELECT ST_AsGeoJSON(path::geometry) AS geojson, name FROM segments WHERE id = $1`,
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

        const subPoints = origPoints.filter(
          (p: { dist: number }) => p.dist >= startDist && p.dist <= endDist
        );
        if (subPoints.length < 2) continue;

        const subId = generateId();
        subSegIds.push(subId);
        const subWkt = pointsToLineStringZ(subPoints);
        const subPoly = encodePolyline6(subPoints);
        const subDist = totalDistance(subPoints);
        const subElev = computeElevationStats(subPoints.map((p: { ele: number }) => p.ele));

        await client.query(
          `INSERT INTO segments (id, name, path, polyline6, distance, gain, gain_loss)
           VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, $5, $6, $7)`,
          [subId, segResult.rows[0].name, subWkt, subPoly, Math.round(subDist), subElev.gain, subElev.loss]
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
        routeSegRefs.push({ segmentId: seg.existingSegmentId!, direction: seg.direction || "forward" });
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
        const newId = generateId();
        const wkt = pointsToLineStringZ(seg.points);
        const poly = encodePolyline6(seg.points);
        await client.query(
          `INSERT INTO segments (id, name, path, polyline6, distance, gain, gain_loss)
           VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, $5, $6, $7)`,
          [newId, seg.name, wkt, poly, seg.distance, seg.gain, seg.loss]
        );
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

    // Set route to active
    await client.query(`UPDATE routes SET status = 'active' WHERE id = $1`, [id]);

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
