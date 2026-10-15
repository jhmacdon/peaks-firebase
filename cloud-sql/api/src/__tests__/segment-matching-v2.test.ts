import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { dropContainedRouteMatches, selectRouteMatches, type RouteCoverageRow } from "../route-coverage";
import { buildSessionDetailQuery, buildSessionRoutesQuery, SESSION_ROUTES_SQL, SESSION_SEGMENTS_SQL } from "../routes/sessions";
import { buildRouteDetailQuery } from "../routes/routes";

const muir = (overrides: Partial<RouteCoverageRow> = {}): RouteCoverageRow => ({
  route_id: "camp-muir", length_m: 8000, covered_m: 8000,
  covered_intervals: [[0, 1]], kind: "destination", objective_reached: true, ...overrides,
});
const dc = (overrides: Partial<RouteCoverageRow> = {}): RouteCoverageRow => ({
  route_id: "dc", length_m: 16000, covered_m: 16000,
  covered_intervals: [[0, 1]], kind: "summit", objective_reached: true, ...overrides,
});

test("Rainier: Muir-only prefers its reached objective and drops DC's contained approach", () => {
  const rows = [dc({ covered_m: 7500, covered_intervals: [[0, 0.46875]],
    objective_reached: false }), muir()];
  assert.deepEqual(dropContainedRouteMatches(selectRouteMatches(rows), ["dc"]).map((r) => [r.route_id, r.is_primary]), [["camp-muir", true]]);
});

test("Rainier: summit day picks DC and drops Camp Muir inside it", () => {
  const rows = [muir(), dc()];
  assert.deepEqual(dropContainedRouteMatches(selectRouteMatches(rows), ["camp-muir"]).map((r) => [r.route_id, r.is_primary]), [["dc", true]]);
});

test("an unreached summit objective cannot outrank a reached destination even at full coverage", () => {
  const matches = selectRouteMatches([dc({ objective_reached: false }), muir({ covered_m: 6000 })]);
  assert.deepEqual(matches.map((r) => [r.route_id, r.is_primary]), [["camp-muir", true], ["dc", false]]);
});

test("covered metres then coverage decide ties; independent routes survive", () => {
  const matches = selectRouteMatches([muir({ covered_m: 7000 }), dc()]);
  assert.deepEqual(matches.map((r) => [r.route_id, r.is_primary]), [["dc", true], ["camp-muir", false]]);
  assert.equal(selectRouteMatches([muir(), dc({ covered_m: 16000 - 1e-7 })])[0].route_id, "dc");
});

test("PCT: a 1 km encounter is rejected while a 5 km section survives", () => {
  const pct: RouteCoverageRow = { route_id: "pct", length_m: 4000000,
    covered_m: 1000, covered_intervals: [[0.5, 0.50025]] };
  assert.deepEqual(selectRouteMatches([pct]), []);
  assert.equal(selectRouteMatches([{ ...pct, covered_m: 5000, covered_intervals: [[0.5, 0.50125]] }])[0].coverage, 0.00125);
});

test("densified measurements weight distance rather than the original vertex density", () => {
  // 900 dense points in the first kilometre of a 10 km route used to mean 90%.
  // The SQL reports the length of sampled pieces, so this is only 10%.
  assert.deepEqual(selectRouteMatches([{ route_id: "dense-approach", length_m: 10000,
    covered_m: 1000, covered_intervals: [[0, 0.1]] }]), []);
  assert.equal(selectRouteMatches([{ route_id: "sparse-completion", length_m: 10000,
    covered_m: 8000, covered_intervals: [[0.2, 1]] }])[0].coverage, 0.8);
});

test("session and route detail builders expose the additive segment contract", () => {
  assert.match(SESSION_ROUTES_SQL, /'is_primary', sr.is_primary, 'covered_m', sr.covered_m/);
  assert.match(SESSION_ROUTES_SQL, /sr.coverage >= 0.7/);
  assert.match(buildSessionRoutesQuery("s", "u").text, /sr.is_primary, sr.covered_m/);
  assert.match(buildSessionDetailQuery("s", "u").text, /AS segments/);
  assert.match(SESSION_SEGMENTS_SQL, /ORDER BY ss.entered_at NULLS LAST, seg.id/);
  assert.match(buildRouteDetailQuery("r", "u").text, /'ordinal', rs.ordinal, 'direction', rs.direction/);
});

test("migration adds columns without updating guarded segments", () => {
  const migration = readFileSync(resolve(__dirname, "../../../migrations/20261015_segment_model_v2.sql"), "utf8");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'trail'/);
  assert.doesNotMatch(migration, /UPDATE segments|DISABLE TRIGGER|session_replication_role|SECURITY DEFINER[\s\S]*UPDATE routes/);
  assert.match(migration, /ST_AsEncodedPolyline\(ST_Force2D\(assembled\), 6\)/);
  assert.match(migration, /ON route_segments/);
  assert.match(migration, /ON route_destinations/);
  assert.match(migration, /REFERENCING OLD TABLE AS old_segments NEW TABLE AS new_segments/);
  assert.match(migration, /FOR EACH STATEMENT EXECUTE FUNCTION/);
});

test("real Rainier summit ratios choose the longer covered DC despite Muir's higher coverage", () => {
  const matches=selectRouteMatches([dc({length_m:11529,covered_m:9615}),muir({length_m:6504,covered_m:5925})]);
  assert.equal(matches[0].route_id,"dc");
  assert.ok(matches[0].coverage < matches[1].coverage);
  assert.deepEqual(dropContainedRouteMatches(matches,["camp-muir"]).map(m=>m.route_id),["dc"]);
});

test("real Muir-day ratios prefer its reached objective over DC's partial approach", () => {
  const matches=selectRouteMatches([dc({length_m:11529,covered_m:3500,objective_reached:false}),muir({length_m:6504,covered_m:6000})]);
  assert.equal(matches[0].route_id,"camp-muir");
  assert.deepEqual(dropContainedRouteMatches(matches,["dc"]).map(m=>m.route_id),["camp-muir"]);
});

test("a route without any objective counts as reached at 90%, then covered metres rank it", () => {
  const matches=selectRouteMatches([dc({covered_m:14000,has_objective:true,objective_reached:false}),
    muir({covered_m:7200,has_objective:false,objective_reached:false})]);
  assert.equal(matches[0].route_id,"camp-muir");
});
