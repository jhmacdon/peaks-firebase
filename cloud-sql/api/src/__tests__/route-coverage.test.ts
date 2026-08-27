import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  GAP_TOLERANCE_MAX_M,
  GAP_TOLERANCE_MIN_M,
  ROUTE_DONE_COVERAGE,
  ROUTE_PARTIAL_MIN_COVERED_M,
  ROUTE_VERTEX_TOLERANCE_M,
  coveredLengthMeters,
  gapToleranceMeters,
  meetsRouteWriteGate,
  mergeCoveredIntervals,
  routeDoneCoverageSql,
  selectRouteMatches,
} from "../route-coverage";

/** Distances along a route of vertices spaced `spacingM` apart, 0 through `throughM`. */
function everyMetres(spacingM: number, throughM: number): number[] {
  const out: number[] = [];
  for (let m = 0; m <= throughM; m += spacingM) out.push(m);
  return out;
}

test("the spec's constants are what the module uses", () => {
  assert.equal(ROUTE_VERTEX_TOLERANCE_M, 30);
  assert.equal(ROUTE_DONE_COVERAGE, 0.7);
  assert.equal(ROUTE_PARTIAL_MIN_COVERED_M, 500);
  assert.equal(GAP_TOLERANCE_MIN_M, 100);
  assert.equal(GAP_TOLERANCE_MAX_M, 1_000);
});

test("gap tolerance is 2% of route length, bounded from 100 m to 1 km", () => {
  // 2% of 1 km = 20 m, so the 100 m floor wins.
  assert.equal(gapToleranceMeters(1_000), 100);
  // 2% of 5 km = 100 m — the crossover.
  assert.equal(gapToleranceMeters(5_000), 100);
  // 2% of 29 km = 580 m, so the proportional term wins.
  assert.equal(gapToleranceMeters(29_000), 580);
  // A 5,000 km route would otherwise bridge 100 km gaps.
  assert.equal(gapToleranceMeters(5_000_000), 1_000);
  assert.equal(gapToleranceMeters(0), 100);
});

test("continent-scale routes keep hikes more than 1 km apart separate", () => {
  const intervals = mergeCoveredIntervals([0, 100, 10_000, 10_100], 5_000_000);
  assert.deepEqual(intervals, [[0, 0.00002], [0.002, 0.00202]]);
});

test("a contiguous run of covered vertices becomes one interval", () => {
  // A 10 km route with a vertex every 100 m; the first 1.5 km covered.
  const intervals = mergeCoveredIntervals(everyMetres(100, 1_500), 10_000);
  assert.deepEqual(intervals, [[0, 0.15]]);
});

test("a gap under the tolerance is bridged", () => {
  // 10 km route → tolerance = max(100, 200) = 200 m. The 150 m gap bridges.
  const intervals = mergeCoveredIntervals([0, 100, 250, 400], 10_000);
  assert.deepEqual(intervals, [[0, 0.04]]);
});

test("a gap over the tolerance splits the intervals", () => {
  // 10 km route → tolerance 200 m. The 800 m gap does not bridge.
  const intervals = mergeCoveredIntervals([0, 200, 1_000, 1_200], 10_000);
  assert.deepEqual(intervals, [[0, 0.02], [0.1, 0.12]]);
});

test("the tolerance floor bridges a 90 m dropout on a short route", () => {
  // 2 km route → 2% = 40 m, floor 100 m wins, so a 90 m dropout bridges.
  const intervals = mergeCoveredIntervals([0, 10, 100, 110], 2_000);
  assert.deepEqual(intervals, [[0, 0.055]]);
});

test("an isolated covered vertex contributes no interval", () => {
  // 10 km route, tolerance 200 m: the lone vertex at 5000 stands alone and has
  // zero length, so it is dropped rather than published as [0.5, 0.5].
  const intervals = mergeCoveredIntervals([0, 100, 5_000], 10_000);
  assert.deepEqual(intervals, [[0, 0.01]]);
});

test("no covered vertices and a zero-length route produce no intervals", () => {
  assert.deepEqual(mergeCoveredIntervals([], 10_000), []);
  assert.deepEqual(mergeCoveredIntervals([0, 100], 0), []);
});

test("a fully covered route ends at exactly 1", () => {
  // 90 m route, tolerance floor 100 m, every vertex covered.
  assert.deepEqual(mergeCoveredIntervals([0, 30, 60, 90], 90), [[0, 1]]);
});

test("fractions are rounded to six places", () => {
  assert.deepEqual(mergeCoveredIntervals([0, 1], 3), [[0, 0.333333]]);
});

test("covered length is the interval spans scaled by route length", () => {
  assert.equal(coveredLengthMeters([[0, 0.15]], 10_000), 1_500);
  // Binary fractions do not sum exactly, so compare within a millimetre.
  assert.ok(
    Math.abs(coveredLengthMeters([[0, 0.1], [0.5, 0.6]], 10_000) - 2_000) < 1e-3
  );
  assert.equal(coveredLengthMeters([], 10_000), 0);
});

test("the write gate takes 500 m of covered route OR 70% coverage", () => {
  // Drive past a trailhead: 200 m covered of a long route.
  assert.equal(meetsRouteWriteGate(0.02, 200), false);
  // Approach hike: 2.7 mi of an 18 mi trail.
  assert.equal(meetsRouteWriteGate(0.15, 4_345), true);
  // Exactly at the floor.
  assert.equal(meetsRouteWriteGate(0.01, 500), true);
  // A completed 400 m route: under the metre floor, over the coverage floor.
  assert.equal(meetsRouteWriteGate(1, 400), true);
  assert.equal(meetsRouteWriteGate(0.7, 100), true);
  assert.equal(meetsRouteWriteGate(0.69, 100), false);
});

test("selectRouteMatches applies the gate and shapes the write", () => {
  const matches = selectRouteMatches([
    {
      // 10 km route, vertex every 100 m, the first 1.5 km covered.
      route_id: "long-trail",
      length_m: 10_000,
      total_points: 101,
      matched_points: 16,
      covered_along_m: everyMetres(100, 1_500),
    },
    {
      // The same route, 200 m at the trailhead: a drive-by, not a hike.
      route_id: "drive-by",
      length_m: 10_000,
      total_points: 101,
      matched_points: 3,
      covered_along_m: everyMetres(100, 200),
    },
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].route_id, "long-trail");
  assert.equal(matches[0].coverage, 16 / 101);
  assert.deepEqual(matches[0].covered_intervals, [[0, 0.15]]);
});

test("selectRouteMatches skips rows a route can never honestly answer for", () => {
  const matches = selectRouteMatches([
    { route_id: "no-length", length_m: 0, total_points: 10, matched_points: 10, covered_along_m: [0] },
    { route_id: "no-points", length_m: 1_000, total_points: 0, matched_points: 0, covered_along_m: null },
    { route_id: "null-length", length_m: null, total_points: 10, matched_points: 10, covered_along_m: [0] },
  ]);
  assert.deepEqual(matches, []);
});

test("the did-this-route predicate keeps NULL coverage rows", () => {
  assert.equal(routeDoneCoverageSql("sr"), "(sr.coverage IS NULL OR sr.coverage >= 0.7)");
  assert.equal(routeDoneCoverageSql("x"), "(x.coverage IS NULL OR x.coverage >= 0.7)");
});
