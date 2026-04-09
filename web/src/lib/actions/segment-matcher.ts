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

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProposedSegment {
  type: "existing" | "new" | "split";
  points: TrackPoint[];

  // existing: reuse as-is
  existingSegmentId?: string;
  existingSegmentName?: string | null;
  direction?: "forward" | "reverse";

  // split: partial reuse — references parent being split
  parentSegmentId?: string;
  startFraction?: number;
  endFraction?: number;

  // computed
  distance: number;
  gain: number;
  loss: number;

  // user-assignable
  name: string | null;
}

export interface SegmentSplit {
  originalSegmentId: string;
  originalSegmentName: string | null;
  fractions: number[]; // sorted cut points (0-1)
}

export interface AffectedRoute {
  routeId: string;
  routeName: string | null;
  segmentId: string;
  ordinal: number;
  direction: string;
}

export interface RouteDecomposition {
  segments: ProposedSegment[];
  splits: SegmentSplit[];
  affectedRoutes: AffectedRoute[];
}

// ─── Internal types ─────────────────────────────────────────────────────────

interface CandidateSegment {
  id: string;
  name: string | null;
  points: { lat: number; lng: number; ele: number }[];
  distance: number;
}

interface MatchRun {
  routeStart: number;
  routeEnd: number;
  segmentId: string;
  segmentName: string | null;
  direction: "forward" | "reverse";
  startFraction: number;
  endFraction: number;
  avgDeviation: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MATCH_THRESHOLD_M = 30;
const MIN_RUN_LENGTH_M = 50;
const GAP_BRIDGE_POINTS = 3;
const GAP_BRIDGE_METERS = 60;
const SNAP_FRACTION = 0.03; // snap split to endpoint if within 3%

// ─── Phase 1: Find candidate segments ───────────────────────────────────────

async function findCandidateSegments(
  routePoints: TrackPoint[]
): Promise<CandidateSegment[]> {
  if (routePoints.length < 2) return [];

  // Build WKT for the route
  const wkt = pointsToLineStringZ(routePoints);

  const result = await db.query(
    `SELECT s.id, s.name, s.distance,
            ST_AsGeoJSON(s.path::geometry) AS geojson
     FROM segments s
     WHERE ST_DWithin(
       s.path,
       ST_GeomFromText($1, 4326)::geography,
       $2
     )`,
    [wkt, MATCH_THRESHOLD_M * 3] // wider buffer for candidates
  );

  return result.rows.map((r: any) => {
    const geo = JSON.parse(r.geojson);
    const coords = geo.coordinates as number[][];
    return {
      id: r.id,
      name: r.name,
      distance: Number(r.distance),
      points: coords.map((c) => ({ lng: c[0], lat: c[1], ele: c[2] || 0 })),
    };
  });
}

// ─── Phase 2: Point-to-segment matching ─────────────────────────────────────

function buildSpatialHash(
  points: { lat: number; lng: number }[],
  cellSizeDeg: number = 0.0005 // ~50m
): Map<string, number[]> {
  const hash = new Map<string, number[]>();
  for (let i = 0; i < points.length; i++) {
    const cx = Math.floor(points[i].lng / cellSizeDeg);
    const cy = Math.floor(points[i].lat / cellSizeDeg);
    // Check this cell and neighbors
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        if (!hash.has(key)) hash.set(key, []);
        hash.get(key)!.push(i);
      }
    }
  }
  return hash;
}

function computeMatchRibbon(
  routePoints: TrackPoint[],
  segment: CandidateSegment
): { matched: boolean[]; deviations: number[]; nearestSegIdx: number[] } {
  const segHash = buildSpatialHash(segment.points);
  const matched: boolean[] = [];
  const deviations: number[] = [];
  const nearestSegIdx: number[] = [];

  for (let i = 0; i < routePoints.length; i++) {
    const rp = routePoints[i];
    const cx = Math.floor(rp.lng / 0.0005);
    const cy = Math.floor(rp.lat / 0.0005);
    const key = `${cx},${cy}`;

    let minDist = Infinity;
    let bestIdx = -1;

    const candidates = segHash.get(key);
    if (candidates) {
      // Deduplicate (spatial hash puts same index in multiple cells)
      const seen = new Set<number>();
      for (const idx of candidates) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        const sp = segment.points[idx];
        const d = haversineDistance(rp.lat, rp.lng, sp.lat, sp.lng);
        if (d < minDist) {
          minDist = d;
          bestIdx = idx;
        }
      }
    }

    matched.push(minDist <= MATCH_THRESHOLD_M);
    deviations.push(minDist);
    nearestSegIdx.push(bestIdx);
  }

  return { matched, deviations, nearestSegIdx };
}

function detectDirection(
  nearestSegIdx: number[],
  start: number,
  end: number
): "forward" | "reverse" {
  let fwd = 0;
  let rev = 0;
  for (let i = start + 1; i <= end; i++) {
    if (nearestSegIdx[i] < 0 || nearestSegIdx[i - 1] < 0) continue;
    const diff = nearestSegIdx[i] - nearestSegIdx[i - 1];
    if (diff > 0) fwd += diff;
    else if (diff < 0) rev += Math.abs(diff);
  }
  return fwd >= rev ? "forward" : "reverse";
}

// ─── Phase 3: Extract and bridge match runs ─────────────────────────────────

function extractRuns(
  ribbon: { matched: boolean[]; deviations: number[]; nearestSegIdx: number[] },
  routePoints: TrackPoint[],
  segment: CandidateSegment
): MatchRun[] {
  // Find contiguous matched runs
  const rawRuns: { start: number; end: number }[] = [];
  let runStart = -1;

  for (let i = 0; i < ribbon.matched.length; i++) {
    if (ribbon.matched[i] && runStart < 0) {
      runStart = i;
    } else if (!ribbon.matched[i] && runStart >= 0) {
      rawRuns.push({ start: runStart, end: i - 1 });
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    rawRuns.push({ start: runStart, end: ribbon.matched.length - 1 });
  }

  // Bridge small gaps
  const bridged: { start: number; end: number }[] = [];
  for (const run of rawRuns) {
    if (
      bridged.length > 0 &&
      run.start - bridged[bridged.length - 1].end <= GAP_BRIDGE_POINTS
    ) {
      const gapDist =
        routePoints[run.start].dist - routePoints[bridged[bridged.length - 1].end].dist;
      if (gapDist <= GAP_BRIDGE_METERS) {
        bridged[bridged.length - 1].end = run.end;
        continue;
      }
    }
    bridged.push({ ...run });
  }

  // Convert to MatchRuns, filtering short ones
  const runs: MatchRun[] = [];
  for (const run of bridged) {
    const runDist = routePoints[run.end].dist - routePoints[run.start].dist;
    if (runDist < MIN_RUN_LENGTH_M) continue;

    const direction = detectDirection(ribbon.nearestSegIdx, run.start, run.end);
    const segPointCount = segment.points.length;

    // Compute fractions along existing segment
    const startSegIdx = ribbon.nearestSegIdx[run.start];
    const endSegIdx = ribbon.nearestSegIdx[run.end];
    const startFrac = Math.max(0, startSegIdx / (segPointCount - 1));
    const endFrac = Math.min(1, endSegIdx / (segPointCount - 1));

    let avgDev = 0;
    let devCount = 0;
    for (let i = run.start; i <= run.end; i++) {
      if (ribbon.matched[i]) {
        avgDev += ribbon.deviations[i];
        devCount++;
      }
    }

    runs.push({
      routeStart: run.start,
      routeEnd: run.end,
      segmentId: segment.id,
      segmentName: segment.name,
      direction,
      startFraction: direction === "forward" ? Math.min(startFrac, endFrac) : Math.min(startFrac, endFrac),
      endFraction: direction === "forward" ? Math.max(startFrac, endFrac) : Math.max(startFrac, endFrac),
      avgDeviation: devCount > 0 ? avgDev / devCount : Infinity,
    });
  }

  return runs;
}

// ─── Phase 4: Conflict resolution ───────────────────────────────────────────

function resolveConflicts(
  allRuns: MatchRun[],
  routePointCount: number
): MatchRun[] {
  // Score: prefer higher coverage and lower deviation
  const scored = allRuns.map((run) => ({
    run,
    score:
      (run.routeEnd - run.routeStart) * 10 - run.avgDeviation,
  }));
  scored.sort((a, b) => b.score - a.score);

  const claimed = new Uint8Array(routePointCount); // 0 = unclaimed
  const resolved: MatchRun[] = [];

  for (const { run } of scored) {
    // Check if the run's range is mostly unclaimed
    let claimedCount = 0;
    for (let i = run.routeStart; i <= run.routeEnd; i++) {
      if (claimed[i]) claimedCount++;
    }
    if (claimedCount > (run.routeEnd - run.routeStart) * 0.5) continue;

    // Find the largest unclaimed sub-range
    let bestStart = -1;
    let bestEnd = -1;
    let curStart = -1;

    for (let i = run.routeStart; i <= run.routeEnd; i++) {
      if (!claimed[i]) {
        if (curStart < 0) curStart = i;
      } else {
        if (curStart >= 0 && (bestStart < 0 || i - curStart > bestEnd - bestStart)) {
          bestStart = curStart;
          bestEnd = i - 1;
        }
        curStart = -1;
      }
    }
    if (curStart >= 0 && (bestStart < 0 || run.routeEnd - curStart + 1 > bestEnd - bestStart)) {
      bestStart = curStart;
      bestEnd = run.routeEnd;
    }

    if (bestStart < 0) continue;

    // Claim the range
    for (let i = bestStart; i <= bestEnd; i++) {
      claimed[i] = 1;
    }

    resolved.push({ ...run, routeStart: bestStart, routeEnd: bestEnd });
  }

  resolved.sort((a, b) => a.routeStart - b.routeStart);
  return resolved;
}

// ─── Phase 5-6: Build decomposition ─────────────────────────────────────────

function buildDecomposition(
  routePoints: TrackPoint[],
  matches: MatchRun[],
  candidates: Map<string, CandidateSegment>
): { segments: ProposedSegment[]; splits: SegmentSplit[] } {
  const proposed: ProposedSegment[] = [];
  const splitMap = new Map<string, Set<number>>(); // segmentId → fractions as ints (x10000)
  let cursor = 0;

  for (const match of matches) {
    // Gap before this match = new segment
    if (match.routeStart > cursor) {
      const gapPoints = routePoints.slice(cursor, match.routeStart + 1);
      if (gapPoints.length >= 2) {
        const elev = computeElevationStats(gapPoints.map((p) => p.ele));
        proposed.push({
          type: "new",
          points: gapPoints,
          distance: Math.round(totalDistance(gapPoints)),
          gain: elev.gain,
          loss: elev.loss,
          name: null,
        });
      }
    }

    // Determine if full or partial reuse
    const isFullReuse =
      match.startFraction <= SNAP_FRACTION &&
      match.endFraction >= 1 - SNAP_FRACTION;

    const matchPoints = routePoints.slice(match.routeStart, match.routeEnd + 1);
    const elev = computeElevationStats(matchPoints.map((p) => p.ele));

    if (isFullReuse) {
      proposed.push({
        type: "existing",
        points: matchPoints,
        existingSegmentId: match.segmentId,
        existingSegmentName: match.segmentName,
        direction: match.direction,
        distance: Math.round(totalDistance(matchPoints)),
        gain: elev.gain,
        loss: elev.loss,
        name: match.segmentName,
      });
    } else {
      // Partial overlap → split needed
      const sf = Math.max(0, match.startFraction);
      const ef = Math.min(1, match.endFraction);

      // Snap to endpoints
      const snappedSf = sf <= SNAP_FRACTION ? 0 : sf;
      const snappedEf = ef >= 1 - SNAP_FRACTION ? 1 : ef;

      // Record split fractions
      if (!splitMap.has(match.segmentId)) splitMap.set(match.segmentId, new Set());
      const fracs = splitMap.get(match.segmentId)!;
      if (snappedSf > 0) fracs.add(Math.round(snappedSf * 10000));
      if (snappedEf < 1) fracs.add(Math.round(snappedEf * 10000));

      proposed.push({
        type: "split",
        points: matchPoints,
        parentSegmentId: match.segmentId,
        existingSegmentName: match.segmentName,
        direction: match.direction,
        startFraction: snappedSf,
        endFraction: snappedEf,
        distance: Math.round(totalDistance(matchPoints)),
        gain: elev.gain,
        loss: elev.loss,
        name: match.segmentName,
      });
    }

    cursor = match.routeEnd;
  }

  // Trailing gap
  if (cursor < routePoints.length - 1) {
    const gapPoints = routePoints.slice(cursor);
    if (gapPoints.length >= 2) {
      const elev = computeElevationStats(gapPoints.map((p) => p.ele));
      proposed.push({
        type: "new",
        points: gapPoints,
        distance: Math.round(totalDistance(gapPoints)),
        gain: elev.gain,
        loss: elev.loss,
        name: null,
      });
    }
  }

  // If no matches at all, the entire route is one new segment
  if (proposed.length === 0) {
    const elev = computeElevationStats(routePoints.map((p) => p.ele));
    proposed.push({
      type: "new",
      points: routePoints,
      distance: Math.round(totalDistance(routePoints)),
      gain: elev.gain,
      loss: elev.loss,
      name: null,
    });
  }

  // Build splits list
  const splits: SegmentSplit[] = [];
  for (const [segId, fracSet] of splitMap) {
    const seg = candidates.get(segId);
    splits.push({
      originalSegmentId: segId,
      originalSegmentName: seg?.name || null,
      fractions: Array.from(fracSet)
        .map((f) => f / 10000)
        .sort((a, b) => a - b),
    });
  }

  return { segments: proposed, splits };
}

// ─── Phase 7: Find affected routes ──────────────────────────────────────────

async function findAffectedRoutes(
  segmentIds: string[]
): Promise<AffectedRoute[]> {
  if (segmentIds.length === 0) return [];

  const result = await db.query(
    `SELECT rs.route_id, r.name AS route_name,
            rs.segment_id, rs.ordinal, rs.direction
     FROM route_segments rs
     JOIN routes r ON r.id = rs.route_id
     WHERE rs.segment_id = ANY($1)
     ORDER BY rs.route_id, rs.ordinal`,
    [segmentIds]
  );

  return result.rows.map((r: any) => ({
    routeId: r.route_id,
    routeName: r.route_name,
    segmentId: r.segment_id,
    ordinal: Number(r.ordinal),
    direction: r.direction,
  }));
}

// ─── Public API: Analyze ────────────────────────────────────────────────────

export async function analyzeRouteSegments(
  points: TrackPoint[]
): Promise<RouteDecomposition> {
  // Phase 1: Find candidates
  const candidates = await findCandidateSegments(points);

  if (candidates.length === 0) {
    // No existing segments nearby — everything is new
    const elev = computeElevationStats(points.map((p) => p.ele));
    return {
      segments: [
        {
          type: "new",
          points,
          distance: Math.round(totalDistance(points)),
          gain: elev.gain,
          loss: elev.loss,
          name: null,
        },
      ],
      splits: [],
      affectedRoutes: [],
    };
  }

  // Phase 2-3: Match and extract runs for each candidate
  const allRuns: MatchRun[] = [];
  const candidateMap = new Map<string, CandidateSegment>();

  for (const seg of candidates) {
    candidateMap.set(seg.id, seg);
    const ribbon = computeMatchRibbon(points, seg);
    const runs = extractRuns(ribbon, points, seg);
    allRuns.push(...runs);
  }

  // Phase 4: Resolve conflicts
  const resolved = resolveConflicts(allRuns, points.length);

  // Phase 5-6: Build decomposition
  const { segments, splits } = buildDecomposition(points, resolved, candidateMap);

  // Phase 7: Find affected routes
  const splitSegIds = splits.map((s) => s.originalSegmentId);
  const affectedRoutes = await findAffectedRoutes(splitSegIds);

  return { segments, splits, affectedRoutes };
}

// ─── Public API: Save ───────────────────────────────────────────────────────

export async function saveRouteWithSegments(input: {
  name: string;
  shape: string;
  completion: string;
  decomposition: RouteDecomposition;
  destinationIds: string[];
}): Promise<{ routeId: string }> {
  const { decomposition } = input;
  const routeId = generateId();

  // Use a transaction for atomicity
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // ── Step 1: Execute splits ──
    // Map: old segment id → array of new sub-segment ids (in order)
    const splitResults = new Map<string, string[]>();

    for (const split of decomposition.splits) {
      // Read original segment geometry
      const segResult = await client.query(
        `SELECT ST_AsGeoJSON(path::geometry) AS geojson, name, distance, gain, gain_loss
         FROM segments WHERE id = $1`,
        [split.originalSegmentId]
      );
      if (segResult.rows.length === 0) continue;

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
          return { lat: c[1], lng: c[0], ele: c[2] || 0, dist: cumDist };
        }
      );

      const totalDist = origPoints[origPoints.length - 1].dist;

      // Build cut points: [0, ...fractions, 1]
      const cuts = [0, ...split.fractions, 1];
      const subSegIds: string[] = [];

      for (let i = 0; i < cuts.length - 1; i++) {
        const startDist = cuts[i] * totalDist;
        const endDist = cuts[i + 1] * totalDist;

        // Extract sub-segment points
        const subPoints = extractSubPoints(origPoints, startDist, endDist);
        if (subPoints.length < 2) continue;

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
        // Find the sub-segment that covers this portion
        const subIds = splitResults.get(seg.parentSegmentId!);
        if (subIds && subIds.length > 0) {
          // Determine which sub-segment this split portion corresponds to
          const split = decomposition.splits.find(
            (s) => s.originalSegmentId === seg.parentSegmentId
          );
          if (split) {
            const cuts = [0, ...split.fractions, 1];
            // Find the sub-segment whose range contains our startFraction
            for (let i = 0; i < cuts.length - 1; i++) {
              if (
                seg.startFraction! >= cuts[i] - 0.01 &&
                seg.endFraction! <= cuts[i + 1] + 0.01
              ) {
                if (i < subIds.length) {
                  routeSegRefs.push({
                    segmentId: subIds[i],
                    direction: seg.direction || "forward",
                  });
                }
                break;
              }
            }
          }
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
      const pts = seg.direction === "reverse" ? [...seg.points].reverse() : seg.points;
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

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract points between two cumulative distances, interpolating at boundaries */
function extractSubPoints(
  points: TrackPoint[],
  startDist: number,
  endDist: number
): TrackPoint[] {
  const result: TrackPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const d = points[i].dist;

    if (d >= startDist && d <= endDist) {
      // Interpolate start boundary if this is the first point and we're past startDist
      if (result.length === 0 && i > 0 && points[i - 1].dist < startDist) {
        result.push(interpolatePoint(points[i - 1], points[i], startDist));
      }
      result.push(points[i]);
    } else if (d > endDist && result.length > 0) {
      // Interpolate end boundary
      result.push(interpolatePoint(points[i - 1], points[i], endDist));
      break;
    }
  }

  // Handle case where startDist falls exactly on a point
  if (result.length === 0 && points.length > 0) {
    // Find the point closest to startDist
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i].dist <= startDist && points[i + 1].dist >= startDist) {
        result.push(interpolatePoint(points[i], points[i + 1], startDist));
        for (let j = i + 1; j < points.length && points[j].dist <= endDist; j++) {
          result.push(points[j]);
        }
        break;
      }
    }
  }

  return result;
}

/** Linear interpolation between two points at a target cumulative distance */
function interpolatePoint(a: TrackPoint, b: TrackPoint, targetDist: number): TrackPoint {
  const segDist = b.dist - a.dist;
  if (segDist === 0) return { ...a };
  const t = (targetDist - a.dist) / segDist;
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
    ele: a.ele + (b.ele - a.ele) * t,
    dist: targetDist,
  };
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
}
