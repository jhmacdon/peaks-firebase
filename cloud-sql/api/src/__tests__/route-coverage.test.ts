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
  mergeRouteIntervals,
  normalizeCoveredIntervals,
  dropContainedRouteMatches,
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
  assert.equal(ROUTE_PARTIAL_MIN_COVERED_M, 2000);
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

test("write gate uses both partial floors and the long-route exception", () => {
  assert.equal(meetsRouteWriteGate(0.7, 100, 143), true);
  assert.equal(meetsRouteWriteGate(0.69, 100, 145), false);
  assert.equal(meetsRouteWriteGate(0.25, 2000, 8000), true);
  assert.equal(meetsRouteWriteGate(0.249, 2490, 10000), false);
  assert.equal(meetsRouteWriteGate(0.5, 1999, 3998), false);
  assert.equal(meetsRouteWriteGate(0.1, 10000, 100000), false);
  assert.equal(meetsRouteWriteGate(0.04999, 4999, 100001), false);
  assert.equal(meetsRouteWriteGate(0.001, 5000, 5000000), true);
  assert.equal(meetsRouteWriteGate(0.0002, 1000, 5000000), false);
  assert.equal(meetsRouteWriteGate(NaN, 5000, 10000), false);
});

test("selection uses measured lengths rather than vertex counts", () => {
  assert.deepEqual(selectRouteMatches([
    { route_id: "partial", length_m: 10000, covered_m: 3000, covered_intervals: [[0, 0.3]] },
    { route_id: "clip", length_m: 10000, covered_m: 1500, covered_intervals: [[0, 0.15]] },
    { route_id: "invalid", length_m: null, covered_m: 1000, covered_intervals: [] },
  ]), [{ route_id: "partial", coverage: 0.3, covered_m: 3000,
    covered_intervals: [[0, 0.3]], is_primary: true }]);
});

test("the did-this-route predicate keeps NULL coverage rows", () => {
  assert.equal(routeDoneCoverageSql("sr"), "(sr.coverage IS NULL OR sr.coverage >= 0.7)");
  assert.equal(routeDoneCoverageSql("x"), "(x.coverage IS NULL OR x.coverage >= 0.7)");
});

test("normalizes covered interval fractions to six decimals within [0, 1]", () => {
  assert.deepEqual(normalizeCoveredIntervals([
    [-0.000001, 0.999999999975], [0.12345678, 1.0001],
    [0.00000001, 0.00000002], [NaN, 1], [0.9, 0.8],
  ]), [[0, 1], [0.123457, 1]]);
});

test("containment drops only secondary ids and keeps independent routes", () => {
  const matches = selectRouteMatches([
    { route_id: "primary", length_m: 10000, covered_m: 10000, covered_intervals: [[0, 1]] },
    { route_id: "contained", length_m: 8000, covered_m: 8000, covered_intervals: [[0, 1]] },
    { route_id: "independent", length_m: 5000, covered_m: 4000, covered_intervals: [[0, 0.8]] },
  ]);
  assert.deepEqual(dropContainedRouteMatches(matches, ["primary", "contained"]).map((m) => m.route_id),
    ["primary", "independent"]);
});

test("every writer merges small gaps without increasing measured covered metres", () => {
  assert.deepEqual(mergeRouteIntervals([[0,0.1],[0.115,0.2],[0.4,0.5]],10000), [[0,0.2],[0.4,0.5]]);
  const row = { route_id: "r", length_m: 10000, covered_m: 7400,
    covered_intervals: [[0,0.3],[0.315,0.7],[0.72,0.8]] as Array<[number,number]> };
  const match = selectRouteMatches([row])[0];
  assert.deepEqual(match.covered_intervals, [[0,0.8]]);
  assert.equal(match.covered_m,7400);
  assert.deepEqual(mergeRouteIntervals([[0,0.00002],[0.002,0.00202]],5000000), [[0,0.00002],[0.002,0.00202]]);
});
