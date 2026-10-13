"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import db from "../db";
import { computeElevationStats } from "../elevation";
import { haversineDistance, totalDistance } from "../gpx";
import {
  type TrackPoint,
  encodePolyline6,
  pointsToLineStringZ,
  generateId,
} from "../route-utils";
import { splitSegmentAtVertices, splitSegmentPieceIndices } from "../segment-geometry";
import { assertSegmentSplitsHaveNoCatalogSource } from "../segment-split-source";
import { verifyAdminToken } from "../auth-actions";

export type { ProposedSegment, SegmentSplit, AffectedRoute, RouteDecomposition } from "../segment-matcher-core";
import { analyzeRouteSegmentsWithClient, type RouteDecomposition } from "../segment-matcher-core";

export async function analyzeRouteSegments(
  points: TrackPoint[],
  options?: { excludeSegmentIds?: string[] }
): Promise<RouteDecomposition> {
  return analyzeRouteSegmentsWithClient(db, points, options);
}

// ─── Public API: Save ───────────────────────────────────────────────────────

export async function saveRouteWithSegments(
  token: string,
  input: {
    name: string;
    shape: string;
    completion: string;
    decomposition: RouteDecomposition;
    destinationIds: string[];
  }
): Promise<{ routeId: string }> {
  const admin = await verifyAdminToken(token);
  if (!admin) throw new Error("Unauthorized");

  const { decomposition } = input;
  const routeId = generateId();

  // Use a transaction for atomicity
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await assertSegmentSplitsHaveNoCatalogSource(client, decomposition.splits);

    // ── Step 1: Execute splits ──
    // Map: old segment id → array of new sub-segment ids (in order)
    const splitResults = new Map<string, string[]>();

    for (const split of decomposition.splits) {
      // Read original segment geometry
      const segResult = await client.query(
        `SELECT ST_AsGeoJSON(path::geometry, 15) AS geojson, name, distance, gain, gain_loss
         FROM segments WHERE id = $1 FOR UPDATE`,
        [split.originalSegmentId]
      );
      if (segResult.rows.length !== 1) throw new Error(`segment_split_missing:${split.originalSegmentId}`);

      const segRow = segResult.rows[0];
      const geo = JSON.parse(segRow.geojson);
      const origPoints: TrackPoint[] = (geo.coordinates as number[][]).map(
        (c, i, arr) => {
          let cumDist = 0;
          if (i > 0) {
            for (let j = 1; j <= i; j++) {
              cumDist += haversineDistance(arr[j - 1][1], arr[j - 1][0], arr[j][1], arr[j][0]);
            }
          }
          return { lat: c[1], lng: c[0], ele: c[2], dist: cumDist };
        }
      );

      const subSegIds: string[] = [];
      for (const subPoints of splitSegmentAtVertices(origPoints, split)) {
        const subId = generateId();
        subSegIds.push(subId);

        const subWkt = pointsToLineStringZ(subPoints);
        const subPoly = encodePolyline6(subPoints);
        const subDist = totalDistance(subPoints);
        const subElev = computeElevationStats(subPoints.map((p) => p.ele));

        await client.query(
          `INSERT INTO segments (id, name, path, polyline6, distance, gain, gain_loss)
           VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, $5, $6, $7)`,
          [subId, segRow.name, subWkt, subPoly, Math.round(subDist), subElev.gain, subElev.loss]
        );
      }

      splitResults.set(split.originalSegmentId, subSegIds);

      // Update all existing routes that reference the old segment
      const affectedRows = await client.query(
        `SELECT route_id, ordinal, direction
         FROM route_segments
         WHERE segment_id = $1
         ORDER BY route_id, ordinal`,
        [split.originalSegmentId]
      );

      for (const ar of affectedRows.rows) {
        const rId = ar.route_id;
        const oldOrdinal = Number(ar.ordinal);
        const dir = ar.direction;

        // Remove old reference
        await client.query(
          `DELETE FROM route_segments WHERE route_id = $1 AND segment_id = $2 AND ordinal = $3`,
          [rId, split.originalSegmentId, oldOrdinal]
        );

        // Shift subsequent ordinals to make room
        const newCount = subSegIds.length;
        if (newCount > 1) {
          await client.query(
            `UPDATE route_segments SET ordinal = ordinal + $1
             WHERE route_id = $2 AND ordinal > $3`,
            [newCount - 1, rId, oldOrdinal]
          );
        }

        // Insert new sub-segment references
        const orderedIds = dir === "reverse" ? [...subSegIds].reverse() : subSegIds;
        for (let j = 0; j < orderedIds.length; j++) {
          await client.query(
            `INSERT INTO route_segments (route_id, segment_id, ordinal, direction)
             VALUES ($1, $2, $3, $4)`,
            [rId, orderedIds[j], oldOrdinal + j, dir]
          );
        }

        // Rematerialize affected route's geometry
        await rematerializeRoute(client, rId);
      }

      // Delete original segment
      await client.query(`DELETE FROM segments WHERE id = $1`, [split.originalSegmentId]);
    }

    // ── Step 2: Build new route's segment list ──
    const routeSegRefs: { segmentId: string; direction: "forward" | "reverse" }[] = [];

    for (const seg of decomposition.segments) {
      if (seg.type === "existing") {
        routeSegRefs.push({
          segmentId: seg.existingSegmentId!,
          direction: seg.direction || "forward",
        });
      } else if (seg.type === "split") {
        const subIds = splitResults.get(seg.parentSegmentId!);
        const split = decomposition.splits.find(item => item.originalSegmentId === seg.parentSegmentId);
        if (!subIds || !split || subIds.length !== split.vertexIndices.length + 1) {
          throw new Error(`segment_split_result_missing:${seg.parentSegmentId}`);
        }
        const direction = seg.direction || "forward";
        for (const index of splitSegmentPieceIndices(split, seg.segmentStartIndex, seg.segmentEndIndex, direction)) {
          routeSegRefs.push({ segmentId: subIds[index], direction });
        }
      } else {
        // New segment — create it
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

    // ── Step 3: Build full route geometry from segments ──
    const allPoints: TrackPoint[] = [];
    for (const seg of decomposition.segments) {
      // The matcher already orders proposed points along the route. Direction
      // applies only to the stored segment reference, not this route slice.
      const pts = seg.points;
      if (allPoints.length > 0 && pts.length > 0) {
        allPoints.push(...pts.slice(1));
      } else {
        allPoints.push(...pts);
      }
    }

    const routePoly = encodePolyline6(allPoints);
    const routeWkt = pointsToLineStringZ(allPoints);
    const routeDist = totalDistance(allPoints);
    const routeElev = computeElevationStats(allPoints.map((p) => p.ele));

    // ── Step 4: Insert route ──
    await client.query(
      `INSERT INTO routes (id, name, path, polyline6, owner, distance, gain, gain_loss, completion, shape)
       VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, 'peaks', $5, $6, $7, $8::completion_mode, $9::route_shape)`,
      [routeId, input.name, routeWkt, routePoly, Math.round(routeDist),
       routeElev.gain, routeElev.loss, input.completion, input.shape]
    );

    // ── Step 5: Insert route_segments ──
    for (let i = 0; i < routeSegRefs.length; i++) {
      await client.query(
        `INSERT INTO route_segments (route_id, segment_id, ordinal, direction)
         VALUES ($1, $2, $3, $4)`,
        [routeId, routeSegRefs[i].segmentId, i, routeSegRefs[i].direction]
      );
    }

    // ── Step 6: Insert route_destinations ──
    for (let i = 0; i < input.destinationIds.length; i++) {
      await client.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [routeId, input.destinationIds[i], i]
      );
    }

    await client.query("COMMIT");
    return { routeId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}


/** Rematerialize a route's cached geometry from its segments */
async function rematerializeRoute(client: any, routeId: string): Promise<void> {
  // Get all segments in order
  const segs = await client.query(
    `SELECT rs.segment_id, rs.direction,
            ST_AsGeoJSON(s.path::geometry) AS geojson
     FROM route_segments rs
     JOIN segments s ON s.id = rs.segment_id
     WHERE rs.route_id = $1
     ORDER BY rs.ordinal`,
    [routeId]
  );

  const allPoints: TrackPoint[] = [];

  for (const row of segs.rows) {
    const geo = JSON.parse(row.geojson);
    let coords = geo.coordinates as number[][];
    if (row.direction === "reverse") coords = [...coords].reverse();

    const pts: TrackPoint[] = coords.map((c) => ({
      lat: c[1],
      lng: c[0],
      ele: c[2] || 0,
      dist: 0, // will recompute
    }));

    if (allPoints.length > 0 && pts.length > 0) {
      allPoints.push(...pts.slice(1));
    } else {
      allPoints.push(...pts);
    }
  }

  if (allPoints.length < 2) return;

  const poly = encodePolyline6(allPoints);
  const wkt = pointsToLineStringZ(allPoints);
  const dist = totalDistance(allPoints);
  const elev = computeElevationStats(allPoints.map((p) => p.ele));

  await client.query(
    `UPDATE routes SET path = ST_GeomFromText($1, 4326)::geography,
                       polyline6 = $2, distance = $3, gain = $4, gain_loss = $5,
                       updated_at = NOW()
     WHERE id = $6`,
    [wkt, poly, Math.round(dist), elev.gain, elev.loss, routeId]
  );

  // The line moved, so every auto-matched recording on this route now carries
  // coverage and covered_intervals measured against the OLD geometry — stale
  // intervals would tint the wrong stretch of the elevation profile. Hand
  // those recordings to the API's existing stuck-session sweep (Cloud
  // Scheduler → POST /internal/sweep, every 2 minutes, 50 per run) instead of
  // recomputing here: processSession is idempotent and owns the one
  // implementation of the coverage maths, and the sweep runs inside a request
  // that already exists. No new service, no timer, $0/month.
  //
  // 'manual' rows are the user's own claim and are left alone, as they are
  // everywhere else. A session mid-run keeps its claim; the next sweep gets it.
  await client.query(
    `UPDATE tracking_sessions
     SET processing_state = 'pending', processing_error = NULL
     WHERE ended = true
       AND processing_state <> 'processing'
       AND id IN (
         SELECT sr.session_id FROM session_routes sr
         WHERE sr.route_id = $1 AND sr.source = 'auto'
       )`,
    [routeId]
  );
}
