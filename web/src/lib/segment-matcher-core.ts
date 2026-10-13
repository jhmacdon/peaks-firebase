/* eslint-disable @typescript-eslint/no-explicit-any */
// One matcher for web review and leased catalog imports. Database access is
// supplied by the caller so importers can analyze inside their transaction.
import { computeElevationStats } from "./elevation";
import { haversineDistance, totalDistance } from "./gpx";
import { type TrackPoint, pointsToLineStringZ } from "./route-utils";

export interface SegmentMatcherClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

export interface SegmentAnalysisOptions {
  excludeSegmentIds?: string[];
  /** Original route vertex indices at graph junctions or source changes. */
  requiredCutIndices?: number[];
  /** Automatic imports accept only consecutive, identical directed XYZ vertices. */
  exactOnly?: boolean;
  /** Automatic imports must not change a segment already stored in the catalog. */
  allowExistingSplits?: boolean;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProposedSegment {
  type: "existing" | "new" | "split";
  points: TrackPoint[];
  /** Inclusive bounds in the original route; points always follow the route. */
  routeStartIndex: number;
  routeEndIndex: number;
  /** Inclusive, ascending bounds in the stored segment, when matched. */
  segmentStartIndex?: number;
  segmentEndIndex?: number;

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
  /** Exact interior vertices; writers must slice these, never interpolate them. */
  vertexIndices: number[];
  originalPointCount: number;
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
  distanceFractions: number[];
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
  exact: boolean;
  segmentStartIndex: number;
  segmentEndIndex: number;
  ribbon: MatchRibbon;
}

interface MatchRibbon {
  matched: boolean[];
  exact: boolean[];
  deviations: number[];
  nearestSegIdx: number[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MATCH_THRESHOLD_M = 30;
const MIN_RUN_LENGTH_M = 50;
const GAP_BRIDGE_POINTS = 3;
const GAP_BRIDGE_METERS = 60;
const SNAP_FRACTION = 0.03; // snap split to endpoint if within 3%

// ─── Phase 1: Find candidate segments ───────────────────────────────────────

async function findCandidateSegments(
  client: SegmentMatcherClient,
  routePoints: TrackPoint[],
  excludeSegmentIds: string[] = []
): Promise<CandidateSegment[]> {
  if (routePoints.length < 2) return [];

  // Build WKT for the route
  const wkt = pointsToLineStringZ(routePoints);

  const result = await client.query(
    `SELECT s.id, s.name, s.distance,
            ST_AsGeoJSON(s.path::geometry, 15) AS geojson
     FROM segments s
     WHERE ST_DWithin(
       s.path,
       ST_GeomFromText($1, 4326)::geography,
       $2
     )
       AND NOT (s.id = ANY($3::text[]))
     ORDER BY s.id`,
    [wkt, MATCH_THRESHOLD_M * 3, excludeSegmentIds] // wider buffer for candidates
  );

  return result.rows.map((r: any) => {
    const geo = JSON.parse(r.geojson);
    const coords = geo.coordinates as number[][];
    const points = coords.map((c) => ({
      lng: c[0],
      lat: c[1],
      ele: c[2],
    }));
    if (geo.type !== "LineString" || points.length < 2 || points.some((point) =>
      !Number.isFinite(point.lat) || !Number.isFinite(point.lng) || !Number.isFinite(point.ele))) {
      throw new Error(`candidate_segment_geometry_invalid:${r.id}`);
    }
    const cumulativeDistances = [0];
    for (let i = 1; i < points.length; i++) {
      cumulativeDistances.push(
        cumulativeDistances[i - 1] +
          haversineDistance(
            points[i - 1].lat,
            points[i - 1].lng,
            points[i].lat,
            points[i].lng
          )
      );
    }
    const measuredDistance = cumulativeDistances.at(-1) || 1;
    return {
      id: r.id,
      name: r.name,
      distance: Number(r.distance),
      points,
      distanceFractions: cumulativeDistances.map(
        (distance) => distance / measuredDistance
      ),
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

function sameXYZ(first: TrackPoint | CandidateSegment["points"][number], second: CandidateSegment["points"][number]): boolean {
  return Math.abs(first.lat - second.lat) <= 1e-9
    && Math.abs(first.lng - second.lng) <= 1e-9
    && Math.abs(first.ele - second.ele) <= 0.01;
}

function computeMatchRibbon(
  routePoints: TrackPoint[],
  segment: CandidateSegment
): MatchRibbon {
  const segHash = buildSpatialHash(segment.points);
  const ribbon: MatchRibbon = { matched: [], exact: [], deviations: [], nearestSegIdx: [] };
  for (let i = 0; i < routePoints.length; i++) {
    const rp = routePoints[i];
    const key = `${Math.floor(rp.lng / 0.0005)},${Math.floor(rp.lat / 0.0005)}`;
    let minDist = Infinity;
    let bestIdx = -1;
    let bestExact = false;
    const prior = ribbon.nearestSegIdx[i - 1];
    const previous = ribbon.nearestSegIdx[i - 2];
    const nextIndex = previous !== undefined && Math.abs(prior - previous) === 1
      ? prior + (prior - previous) : undefined;
    for (const idx of segHash.get(key) ?? []) {
      const sp = segment.points[idx];
      const distance = haversineDistance(rp.lat, rp.lng, sp.lat, sp.lng);
      const exact = sameXYZ(rp, sp);
      // At a closed segment's repeated endpoint, prefer its adjacent vertex.
      const adjacent = prior !== undefined && Math.abs(idx - prior) === 1;
      const bestAdjacent = prior !== undefined && Math.abs(bestIdx - prior) === 1;
      const continues = idx === nextIndex;
      const bestContinues = bestIdx === nextIndex;
      const nextPoint = routePoints[i + 1];
      const followsRoute = nextPoint !== undefined && [idx - 1, idx + 1].some(next =>
        segment.points[next] !== undefined && sameXYZ(nextPoint, segment.points[next]));
      const bestFollowsRoute = nextPoint !== undefined && [bestIdx - 1, bestIdx + 1].some(next =>
        segment.points[next] !== undefined && sameXYZ(nextPoint, segment.points[next]));
      if ((exact && !bestExact) || (exact === bestExact && (
        (exact && continues && !bestContinues)
        || (continues === bestContinues && exact && adjacent && !bestAdjacent)
        || (continues === bestContinues && adjacent === bestAdjacent && exact && followsRoute && !bestFollowsRoute)
        || (continues === bestContinues && adjacent === bestAdjacent && followsRoute === bestFollowsRoute && distance < minDist)
        || (!exact && distance < minDist)))) {
        minDist = distance;
        bestIdx = idx;
        bestExact = exact;
      }
    }
    ribbon.matched.push(minDist <= MATCH_THRESHOLD_M);
    ribbon.exact.push(bestExact);
    ribbon.deviations.push(minDist);
    ribbon.nearestSegIdx.push(bestIdx);
  }
  return ribbon;
}

function makeRun(
  start: number, end: number, segment: CandidateSegment, ribbon: MatchRibbon, exact: boolean
): MatchRun | undefined {
  const first = ribbon.nearestSegIdx[start];
  const last = ribbon.nearestSegIdx[end];
  if (end <= start || first < 0 || last < 0 || first === last) return undefined;
  const segmentStartIndex = Math.min(first, last);
  const segmentEndIndex = Math.max(first, last);
  const deviations = ribbon.deviations.slice(start, end + 1).filter(Number.isFinite);
  return {
    routeStart: start, routeEnd: end, segmentId: segment.id, segmentName: segment.name,
    direction: first < last ? "forward" : "reverse",
    startFraction: segment.distanceFractions[segmentStartIndex],
    endFraction: segment.distanceFractions[segmentEndIndex],
    avgDeviation: deviations.reduce((sum, value) => sum + value, 0) / (deviations.length || 1),
    segmentStartIndex, segmentEndIndex, exact, ribbon,
  };
}

// ─── Phase 3: Extract and bridge match runs ─────────────────────────────────

function extractRuns(
  ribbon: MatchRibbon,
  routePoints: TrackPoint[],
  segment: CandidateSegment,
  exactOnly: boolean
): MatchRun[] {
  const runs: MatchRun[] = [];
  // Exact spans use the same ribbon as proximity review. Each edge must follow
  // consecutive stored vertices, including short edges and reverse traversals.
  let start = 0;
  while (start < routePoints.length - 1) {
    const step = ribbon.nearestSegIdx[start + 1] - ribbon.nearestSegIdx[start];
    if (!ribbon.exact[start] || !ribbon.exact[start + 1] || Math.abs(step) !== 1) {
      start++;
      continue;
    }
    let end = start + 1;
    while (end + 1 < routePoints.length && ribbon.exact[end + 1]
      && ribbon.nearestSegIdx[end + 1] - ribbon.nearestSegIdx[end] === step) end++;
    const run = makeRun(start, end, segment, ribbon, true);
    if (run) runs.push(run);
    start = end;
  }
  if (exactOnly) return runs;

  const rawRuns: { start: number; end: number }[] = [];
  let runStart = -1;
  for (let i = 0; i < ribbon.matched.length; i++) {
    if (ribbon.matched[i] && runStart < 0) runStart = i;
    else if (!ribbon.matched[i] && runStart >= 0) {
      rawRuns.push({ start: runStart, end: i - 1 });
      runStart = -1;
    }
  }
  if (runStart >= 0) rawRuns.push({ start: runStart, end: ribbon.matched.length - 1 });

  const bridged: { start: number; end: number }[] = [];
  for (const run of rawRuns) {
    const previous = bridged[bridged.length - 1];
    if (previous && run.start - previous.end <= GAP_BRIDGE_POINTS
      && routePoints[run.start].dist - routePoints[previous.end].dist <= GAP_BRIDGE_METERS) {
      previous.end = run.end;
    } else bridged.push({ ...run });
  }
  for (const run of bridged) {
    if (routePoints[run.end].dist - routePoints[run.start].dist < MIN_RUN_LENGTH_M) continue;
    const matched = makeRun(run.start, run.end, segment, ribbon, false);
    if (matched) runs.push(matched);
  }
  return runs;
}

// ─── Phase 4: Conflict resolution ───────────────────────────────────────────

function resolveConflicts(
  allRuns: MatchRun[], routePointCount: number, candidates: Map<string, CandidateSegment>
): MatchRun[] {
  const scored = [...allRuns].sort((a, b) => Number(b.exact) - Number(a.exact)
    || ((b.routeEnd - b.routeStart) * 10 - b.avgDeviation)
      - ((a.routeEnd - a.routeStart) * 10 - a.avgDeviation)
    || a.segmentId.localeCompare(b.segmentId) || a.routeStart - b.routeStart);
  // Claim edges, not vertices: adjacent physical segments share one endpoint.
  const claimed = new Uint8Array(routePointCount - 1);
  const resolved: MatchRun[] = [];
  for (const run of scored) {
    let claimedCount = 0;
    for (let i = run.routeStart; i < run.routeEnd; i++) claimedCount += claimed[i];
    if (!run.exact && claimedCount > (run.routeEnd - run.routeStart) * 0.5) continue;
    const available: { start: number; end: number }[] = [];
    let currentStart = -1;
    for (let i = run.routeStart; i <= run.routeEnd; i++) {
      if (i < run.routeEnd && !claimed[i]) {
        if (currentStart < 0) currentStart = i;
      } else if (currentStart >= 0) {
        available.push({ start: currentStart, end: i });
        currentStart = -1;
      }
    }
    // Exact source edges must never become new geometry just because another
    // candidate won most of this run. Proximity review keeps its longest span.
    const ranges = run.exact ? available : available.sort((a, b) =>
      (b.end - b.start) - (a.end - a.start)).slice(0, 1);
    for (const range of ranges) {
      // Recompute stored vertex bounds, direction and fractions after trimming.
      const trimmed = makeRun(range.start, range.end, candidates.get(run.segmentId)!, run.ribbon, run.exact);
      if (!trimmed) continue;
      for (let i = range.start; i < range.end; i++) claimed[i] = 1;
      resolved.push(trimmed);
    }
  }
  return resolved.sort((a, b) => a.routeStart - b.routeStart);
}

// ─── Phase 5-6: Build decomposition ─────────────────────────────────────────

function buildDecomposition(
  routePoints: TrackPoint[], matches: MatchRun[], candidates: Map<string, CandidateSegment>,
  requiredCuts: number[], exactOnly: boolean
): { segments: ProposedSegment[]; splits: SegmentSplit[] } {
  const proposed: ProposedSegment[] = [];
  const splitMap = new Map<string, Set<number>>();
  const cutSet = new Set(requiredCuts);
  const stats = (start: number, end: number) => {
    const points = routePoints.slice(start, end + 1);
    const elevation = computeElevationStats(points.map(point => point.ele));
    return { points, routeStartIndex: start, routeEndIndex: end,
      distance: Math.round(totalDistance(points)), gain: elevation.gain, loss: elevation.loss };
  };
  const addNew = (start: number, end: number) => {
    if (end <= start) return;
    const cuts = [start, ...requiredCuts.filter(index => index > start && index < end), end];
    for (let i = 1; i < cuts.length; i++) {
      proposed.push({ type: "new", name: null, ...stats(cuts[i - 1], cuts[i]) });
    }
  };
  const cutMatches: MatchRun[] = [];
  for (const match of matches) {
    const cuts = [match.routeStart, ...requiredCuts.filter(index => index > match.routeStart && index < match.routeEnd), match.routeEnd];
    for (let i = 1; i < cuts.length; i++) {
      const part = makeRun(cuts[i - 1], cuts[i], candidates.get(match.segmentId)!, match.ribbon, match.exact);
      if (part) cutMatches.push(part);
    }
  }
  let cursor = 0;
  for (const match of cutMatches) {
    addNew(cursor, match.routeStart);
    const candidate = candidates.get(match.segmentId)!;
    const lowerRoutePoint = routePoints[match.direction === "reverse" ? match.routeEnd : match.routeStart];
    const upperRoutePoint = routePoints[match.direction === "reverse" ? match.routeStart : match.routeEnd];
    const lowerBoundary = match.direction === "reverse" ? match.routeEnd : match.routeStart;
    const upperBoundary = match.direction === "reverse" ? match.routeStart : match.routeEnd;
    const allowStartSnap = !exactOnly && !match.exact && !cutSet.has(lowerBoundary);
    const allowEndSnap = !exactOnly && !match.exact && !cutSet.has(upperBoundary);
    const canSnapStart = match.segmentStartIndex === 0 || (allowStartSnap
      && match.startFraction <= SNAP_FRACTION
      && haversineDistance(lowerRoutePoint.lat, lowerRoutePoint.lng,
        candidate.points[0].lat, candidate.points[0].lng) <= MATCH_THRESHOLD_M);
    const canSnapEnd = match.segmentEndIndex === candidate.points.length - 1 || (allowEndSnap
      && match.endFraction >= 1 - SNAP_FRACTION
      && haversineDistance(upperRoutePoint.lat, upperRoutePoint.lng,
        candidate.points[candidate.points.length - 1].lat, candidate.points[candidate.points.length - 1].lng) <= MATCH_THRESHOLD_M);
    const segmentStartIndex = canSnapStart ? 0 : match.segmentStartIndex;
    const segmentEndIndex = canSnapEnd ? candidate.points.length - 1 : match.segmentEndIndex;
    const bounds = { segmentStartIndex, segmentEndIndex };
    if (canSnapStart && canSnapEnd) {
      proposed.push({ type: "existing", existingSegmentId: match.segmentId,
        existingSegmentName: match.segmentName, direction: match.direction, name: match.segmentName,
        ...bounds, ...stats(match.routeStart, match.routeEnd) });
    } else {
      if (!splitMap.has(match.segmentId)) splitMap.set(match.segmentId, new Set());
      const vertices = splitMap.get(match.segmentId)!;
      if (segmentStartIndex > 0) vertices.add(segmentStartIndex);
      if (segmentEndIndex < candidate.points.length - 1) vertices.add(segmentEndIndex);
      proposed.push({ type: "split", parentSegmentId: match.segmentId,
        existingSegmentName: match.segmentName, direction: match.direction, name: match.segmentName,
        startFraction: candidate.distanceFractions[segmentStartIndex],
        endFraction: candidate.distanceFractions[segmentEndIndex],
        ...bounds, ...stats(match.routeStart, match.routeEnd) });
    }
    cursor = match.routeEnd;
  }
  addNew(cursor, routePoints.length - 1);
  const splits = [...splitMap].map(([segmentId, vertices]) => {
    const segment = candidates.get(segmentId)!;
    const vertexIndices = [...vertices].sort((a, b) => a - b);
    return { originalSegmentId: segmentId, originalSegmentName: segment.name, vertexIndices,
      originalPointCount: segment.points.length,
      fractions: vertexIndices.map(index => segment.distanceFractions[index]) };
  });
  // A route may traverse a whole segment and later only part of it. Once its
  // parent is split, every occurrence must reference the replacement pieces.
  for (const segment of proposed) {
    if (segment.type !== "existing" || !splitMap.has(segment.existingSegmentId!)) continue;
    segment.type = "split";
    segment.parentSegmentId = segment.existingSegmentId;
    delete segment.existingSegmentId;
    segment.startFraction = 0;
    segment.endFraction = 1;
  }
  return { segments: proposed, splits };
}

// ─── Phase 7: Find affected routes ──────────────────────────────────────────

async function findAffectedRoutes(
  client: SegmentMatcherClient,
  segmentIds: string[]
): Promise<AffectedRoute[]> {
  if (segmentIds.length === 0) return [];

  const result = await client.query(
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

export async function analyzeRouteSegmentsWithClient(
  client: SegmentMatcherClient, inputPoints: TrackPoint[], options: SegmentAnalysisOptions = {}
): Promise<RouteDecomposition> {
  if (inputPoints.length < 2) throw new Error("route_requires_two_vertices");
  let cumulativeDistance = 0;
  const points = inputPoints.map((point, index) => {
    if (![point.lat, point.lng, point.ele].every(Number.isFinite)
      || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) throw new Error("route_geometry_invalid");
    if (index > 0) cumulativeDistance += haversineDistance(inputPoints[index - 1].lat,
      inputPoints[index - 1].lng, point.lat, point.lng);
    return { ...point, dist: cumulativeDistance };
  });
  if (cumulativeDistance <= 0) throw new Error("route_has_no_length");
  const requiredCuts = [...new Set(options.requiredCutIndices ?? [])].sort((a, b) => a - b);
  if (requiredCuts.some(index => !Number.isInteger(index) || index < 0 || index >= points.length)) {
    throw new Error("required_cut_index_invalid");
  }
  const candidates = await findCandidateSegments(client, points, options.excludeSegmentIds ?? []);
  const candidateMap = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const allRuns = candidates.flatMap(candidate => extractRuns(
    computeMatchRibbon(points, candidate), points, candidate, options.exactOnly ?? false));
  const resolved = resolveConflicts(allRuns, points.length, candidateMap);
  const { segments, splits } = buildDecomposition(points, resolved, candidateMap,
    requiredCuts, options.exactOnly ?? false);
  if (splits.length && options.allowExistingSplits === false) {
    throw new Error(`existing_segment_split_requires_review:${splits.map(split => split.originalSegmentId).sort().join(",")}`);
  }
  const affectedRoutes = await findAffectedRoutes(client, splits.map(split => split.originalSegmentId));
  return { segments, splits, affectedRoutes };
}
