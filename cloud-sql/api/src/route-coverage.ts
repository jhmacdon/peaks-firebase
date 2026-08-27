// What a session_routes row means, and how a recording's track becomes one.
//
// NO database access in this file — everything operates on plain arrays, so
// the interval merge and the write gate are unit-testable without a database
// and are shared verbatim by processSession and the backfill script. The
// PostGIS half (measuring which route vertices the track came within
// ROUTE_VERTEX_TOLERANCE_M of, and how far along the route each one sits)
// lives in buildRouteCoverageSql in processing.ts.
//
// Design doc: docs/superpowers/specs/2026-08-25-route-partial-history-design.md

/** A route vertex within this many metres of the session track counts as covered. */
export const ROUTE_VERTEX_TOLERANCE_M = 30;

/**
 * Coverage at or above this fraction means the recording did the whole route.
 *
 * Two jobs, deliberately one constant: it is the OR branch of the write gate
 * that keeps completions of very short routes, and it is the cutoff every
 * existing reader uses to decide a row still means "did this route"
 * (routeDoneCoverageSql below). They must never drift apart.
 */
export const ROUTE_DONE_COVERAGE = 0.7;

/**
 * A recording that covered at least this much of a route's length earns a row
 * even when the fraction is small. Mirrors the iOS corridor engine's sanity
 * floor (MountainAttribution.minimumCorridorMeters): a drive past a trailhead
 * writes nothing, an approach hike writes a partial row.
 */
export const ROUTE_PARTIAL_MIN_COVERED_M = 500;

/** Gaps shorter than this never split an interval, however short the route. */
export const GAP_TOLERANCE_MIN_M = 100;
/** ...and on a long route the tolerance grows with it. */
export const GAP_TOLERANCE_ROUTE_FRAC = 0.02;
/** Never bridge more than a short GPS dropout, even on a continent-scale trail. */
export const GAP_TOLERANCE_MAX_M = 1_000;

/** Fractions are stored to this many decimals — sub-metre on a 100 km route. */
const FRACTION_DECIMALS = 6;

/**
 * Bridge gaps under 100 m or 2% of route length, whichever is larger, up to a
 * 1 km cap. Without the cap, one hike on a 3,000-mile trail could join covered
 * stretches that are nearly 100 km apart.
 */
export function gapToleranceMeters(routeLengthM: number): number {
  const proportional = Number.isFinite(routeLengthM) ? routeLengthM * GAP_TOLERANCE_ROUTE_FRAC : 0;
  return Math.min(
    GAP_TOLERANCE_MAX_M,
    Math.max(GAP_TOLERANCE_MIN_M, proportional)
  );
}

function roundFraction(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  const scale = 10 ** FRACTION_DECIMALS;
  return Math.round(clamped * scale) / scale;
}

/**
 * Merge the distances-along-route of covered vertices into [start, end]
 * fractions of the route linestring.
 *
 * `coveredAlongM` must be ascending — buildRouteCoverageSql aggregates it in
 * vertex order and distance along a linestring is non-decreasing in that order.
 *
 * A run that starts and ends on the same vertex covers no ground, so it is
 * dropped rather than published as a zero-width [f, f]: a lone vertex within
 * 30 m of the track, with no neighbour inside the gap tolerance, is noise, and
 * a client cannot tint a stretch of zero length.
 */
export function mergeCoveredIntervals(
  coveredAlongM: number[],
  routeLengthM: number
): Array<[number, number]> {
  if (!Number.isFinite(routeLengthM) || routeLengthM <= 0) return [];
  if (coveredAlongM.length === 0) return [];

  const tolerance = gapToleranceMeters(routeLengthM);
  const runs: Array<[number, number]> = [];
  for (const along of coveredAlongM) {
    if (!Number.isFinite(along)) continue;
    const last = runs[runs.length - 1];
    if (last && along - last[1] <= tolerance) {
      last[1] = along;
    } else {
      runs.push([along, along]);
    }
  }

  return runs
    .map(([start, end]): [number, number] => [
      roundFraction(start / routeLengthM),
      roundFraction(end / routeLengthM),
    ])
    .filter(([start, end]) => end > start);
}

/** How much of the route's length the intervals actually cover, in metres. */
export function coveredLengthMeters(
  intervals: Array<[number, number]>,
  routeLengthM: number
): number {
  return intervals.reduce((sum, [start, end]) => sum + (end - start) * routeLengthM, 0);
}

/**
 * Write a session_routes row when the recording covered at least
 * ROUTE_PARTIAL_MIN_COVERED_M of the route, OR when it covered at least
 * ROUTE_DONE_COVERAGE of its vertices. The OR keeps completions of routes
 * shorter than about 700 m, which the metre floor alone would drop.
 */
export function meetsRouteWriteGate(coverage: number, coveredM: number): boolean {
  return coveredM >= ROUTE_PARTIAL_MIN_COVERED_M || coverage >= ROUTE_DONE_COVERAGE;
}

/** One measured (session, route) pair, straight from buildRouteCoverageSql. */
export interface RouteCoverageRow {
  route_id: string;
  /** Route length in metres, summed over its own vertices. */
  length_m: number | null;
  total_points: number;
  matched_points: number;
  /** Distance along the route, in metres, of each covered vertex. Ascending. */
  covered_along_m: number[] | null;
}

/** One row to write to session_routes. */
export interface RouteMatch {
  route_id: string;
  coverage: number;
  covered_intervals: Array<[number, number]>;
}

/** Apply the write gate to a batch of measurements and shape the rows to write. */
export function selectRouteMatches(rows: RouteCoverageRow[]): RouteMatch[] {
  const matches: RouteMatch[] = [];
  for (const row of rows) {
    const total = Number(row.total_points);
    const lengthM = Number(row.length_m ?? 0);
    if (!Number.isFinite(total) || total <= 0) continue;
    if (!Number.isFinite(lengthM) || lengthM <= 0) continue;

    const coverage = Number(row.matched_points) / total;
    const intervals = mergeCoveredIntervals(row.covered_along_m ?? [], lengthM);
    if (!meetsRouteWriteGate(coverage, coveredLengthMeters(intervals, lengthM))) continue;

    matches.push({ route_id: row.route_id, coverage, covered_intervals: intervals });
  }
  return matches;
}

/**
 * SQL predicate for "this session_routes row means the user did this route".
 *
 * A NULL coverage is kept on purpose. Manually attached routes (PUT
 * /api/sessions/:id with routeIds) and every row the Firestore migration wrote
 * carry NULL, and they meant "did this route" long before coverage existed.
 * Only the new partial rows carry a non-NULL value below ROUTE_DONE_COVERAGE.
 *
 * `alias` is always a literal written in this repo's own SQL, never user input.
 */
export function routeDoneCoverageSql(alias: string): string {
  return `(${alias}.coverage IS NULL OR ${alias}.coverage >= ${ROUTE_DONE_COVERAGE})`;
}
