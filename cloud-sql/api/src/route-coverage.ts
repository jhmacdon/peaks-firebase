// What a session_routes row means, and how a recording's track becomes one.
//
// NO database access in this file — everything operates on plain arrays, so
// the interval helpers, primary choice, and write gate need no database
// and are shared by processSession and the backfill script. The
// PostGIS half (measuring the length of route pieces the track came within
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

/** Minimum covered length for a partial match on a route of at most 100 km. */
export const ROUTE_PARTIAL_MIN_COVERED_M = 2_000;

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

/** Keep stored fractions stable across SQL and JavaScript floating-point sums. */
export function normalizeCoveredIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  return intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end))
    .map(([start, end]): [number, number] => [roundFraction(start), roundFraction(end)])
    .filter(([start, end]) => end > start);
}

/** Merge published spans using the same metre tolerance as SQL measurements. */
export function mergeRouteIntervals(intervals: Array<[number, number]>, lengthM: number): Array<[number, number]> {
  const ordered = normalizeCoveredIntervals(intervals).sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ordered) {
    const last = merged[merged.length - 1];
    if (last && (start - last[1]) * lengthM <= gapToleranceMeters(lengthM) + 1e-5) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
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

  return normalizeCoveredIntervals(runs.map(([start, end]) => [
    start / routeLengthM, end / routeLengthM,
  ]));
}

/** How much of the route's length the intervals actually cover, in metres. */
export function coveredLengthMeters(
  intervals: Array<[number, number]>,
  routeLengthM: number
): number {
  return intervals.reduce((sum, [start, end]) => sum + (end - start) * routeLengthM, 0);
}

/** All routes over 100 km use a 5 km floor; shorter routes need a useful share. */
export function meetsRouteWriteGate(coverage: number, coveredM: number, lengthM = 0): boolean {
  if (![coverage, coveredM, lengthM].every(Number.isFinite)
      || coverage < 0 || coverage > 1 || coveredM < 0 || lengthM < 0) return false;
  if (lengthM > 100_000) return coveredM >= 5_000;
  return coverage >= ROUTE_DONE_COVERAGE
    || (coveredM >= ROUTE_PARTIAL_MIN_COVERED_M && coverage >= 0.25);
}

/** One length measurement from buildRouteCoverageSql. */
export interface RouteCoverageRow {
  route_id: string;
  length_m: number | null;
  covered_m: number;
  covered_intervals: Array<[number, number]>;
  objective_reached?: boolean;
  has_objective?: boolean;
  covered_geometry?: string | null;
  kind?: string | null;
}

export interface RouteMatch {
  route_id: string;
  coverage: number;
  covered_m: number;
  covered_intervals: Array<[number, number]>;
  is_primary: boolean;
  /** Actual covered samples as EWKB hex, used only for containment. */
  covered_geometry?: string | null;
}

function lengthCoverage(row: RouteCoverageRow): number {
  const ratio = Number(row.covered_m) / Number(row.length_m);
  // Summing geodesic subedges can differ from the original edge by microns.
  return Math.abs(1 - ratio) < 1e-9 ? 1 : ratio;
}

function objectiveReached(row: RouteCoverageRow): boolean {
  return Boolean(row.objective_reached) || (row.has_objective === false && lengthCoverage(row) >= 0.9);
}

/** Apply the write gate and choose the primary before measuring containment. */
export function selectRouteMatches(rows: RouteCoverageRow[]): RouteMatch[] {
  const eligible = rows.filter((row) => {
    const length = Number(row.length_m);
    return length > 0 && meetsRouteWriteGate(lengthCoverage(row), Number(row.covered_m), length);
  }).sort((a, b) => Number(objectiveReached(b)) - Number(objectiveReached(a))
    || Number(b.covered_m) - Number(a.covered_m)
    || lengthCoverage(b) - lengthCoverage(a)
    || a.route_id.localeCompare(b.route_id));
  const primary = eligible[0];
  return eligible.map((row) => ({
    route_id: row.route_id,
    coverage: lengthCoverage(row),
    covered_m: Number(row.covered_m),
    covered_intervals: mergeRouteIntervals(row.covered_intervals, Number(row.length_m)),
    ...(row.covered_geometry ? { covered_geometry: row.covered_geometry } : {}),
    is_primary: row === primary,
  }));
}

/** Containment may remove secondary matches, never the chosen primary. */
export function dropContainedRouteMatches(matches: RouteMatch[], containedIds: string[]): RouteMatch[] {
  const contained = new Set(containedIds);
  return matches.filter((match) => match.is_primary || !contained.has(match.route_id));
}

/**
 * SQL predicate for "this session_routes row means the user did this route".
 *
 * Legacy manual routes and rows from the Firestore migration carry NULL
 * coverage until processing measures them again; and they meant "did this route" long before coverage existed.
 * Only the new partial rows carry a non-NULL value below ROUTE_DONE_COVERAGE.
 *
 * `alias` is always a literal written in this repo's own SQL, never user input.
 */
export function routeDoneCoverageSql(alias: string): string {
  return `(${alias}.coverage IS NULL OR ${alias}.coverage >= ${ROUTE_DONE_COVERAGE})`;
}
