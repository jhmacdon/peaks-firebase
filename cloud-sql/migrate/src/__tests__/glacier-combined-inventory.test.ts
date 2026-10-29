import assert from "node:assert/strict";
import { test } from "node:test";
import { union } from "polyclip-ts";
import { loadRainierOsmPackage } from "../import-rainier-glaciers";
import { glacierPlaceProvenance, manifestSha256 } from "../import-glacier-manifest";
import { individualInventoryRows, inventoryMemberCounts, reviewCombinedInventoryRows, type CombinedInventoryRow } from "../glaciers/combined-inventory";
import { chooseOutline, refreshGlacierOutlines } from "../glaciers/outline-refresh";
import { outlineMetrics, type Outline } from "../glaciers/outline-geometry";

const base = loadRainierOsmPackage(), metrics = outlineMetrics(base.parent);
const box = (x: number, width = 0.01): Outline => ({ type: "MultiPolygon", coordinates: [[[
  [x, 46.85], [x + width, 46.85], [x + width, 46.86], [x, 46.86], [x, 46.85],
]]] });
const places = [-121.76, -121.75].map((x, i) => ({ ...base.places[0], id: `branch-${i}`, osm_key: `way:${i + 1}`,
  name: `Branch ${i}`, aliases: [], boundary: box(x), facts: { ...base.places[0].facts,
    inventory_name: null, observed_year: null, area_km2: null, head_elevation_m: null, terminus_elevation_m: null,
    length_km: null, area_uncertainty_km2: null, elevation_range_m: null, average_slope_deg: null, flow_direction_deg: null, estimated_volume_km3: null, volume_uncertainty_km3: null, rank_on_mountain: null, percent_change_since_earliest: null, area_history: [], provenance: {} } }));
const boundary: Outline = { type: "MultiPolygon", coordinates: union(...places.map(p => p.boundary.coordinates) as [number[][][][], number[][][][]]) };
const row: CombinedInventoryRow = { key: "cohort:row-1", inventory_id: "row-1", area_km2: metrics.area(boundary), observed_at: "2023-09-01",
  source: { key: "cohort", source_url: "https://example.test/inventory", source_sha256: "a".repeat(64), credit: "Test inventory",
    license: "CC-BY-4.0", license_url: "https://creativecommons.org/licenses/by/4.0/", license_ok: true },
  boundary, members: places.map(p => p.osm_key),
  branch_fact_search: Object.fromEntries(places.map(p => [p.osm_key, [{ source: "dated test cohort", result: "Only a combined row exists" }]])),
};
const select = (a: number, f: number, c: Parameters<typeof chooseOutline>[2]) => chooseOutline(a, f, c, null, 2);
const run = (r = row) => reviewCombinedInventoryRows(places, places, [r], metrics, select);

test("a passing combined total clears outline flags while facts stay null and the decision is hashed", () => {
  const report = run()[0];
  assert.ok(report.osm_ratio >= 0.67 && report.osm_ratio <= 1.5);
  assert.equal(report.chosen_source, "osm");
  assert.equal(report.flagged, false);
  assert.equal(report.facts_flag, "facts: combined rows");
  assert.equal(report.members.length, 2);
  const input = { ...base, places };
  const result = refreshGlacierOutlines(input, [], [], {}, metrics, { rule: 2,
    combinedInventory: { rows: [row], snapshot_places: places } });
  assert.ok(result.report.decisions.every(d => !d.flagged && d.facts_flag === "facts: combined rows"));
  assert.deepEqual(result.manifest.places.map(p => p.boundary), places.map(p => p.boundary));
  assert.equal(result.manifest.decision_table!.combined_inventory_rows![0].area_km2, row.area_km2);
  for (const p of result.manifest.places) {
    assert.equal(p.facts.area_km2, null);
    assert.equal(p.facts.head_elevation_m, null);
    assert.equal(p.facts.length_km, null);
    assert.equal("decision_table" in glacierPlaceProvenance(result.manifest, p).catalog, false);
    assert.ok(!JSON.stringify(glacierPlaceProvenance(result.manifest, p).facts).includes('"inventory_id":"row-1"'));
  }
  const changed = structuredClone(result.manifest);
  changed.decision_table!.combined_inventory_rows![0].area_km2 += 0.01;
  assert.notEqual(manifestSha256(changed), result.manifest.manifest_sha256);
});

test("an out-of-band total runs rule 2 on the group and cannot invent branch outlines", () => {
  const small: Outline = { type: "MultiPolygon", coordinates: union(box(-121.76, 0.002).coordinates, box(-121.75, 0.002).coordinates) };
  const candidate = { key: "new-cohort", boundary: small, area_km2: metrics.area(small), observed_at: "2024-09-01", license_ok: true };
  const r = { ...row, area_km2: candidate.area_km2, candidates: [candidate] };
  assert.equal(run(r)[0].chosen_source, "new-cohort");
  assert.throws(() => refreshGlacierOutlines({ ...base, places }, [], [], {}, metrics, { rule: 2,
    combinedInventory: { rows: [r], snapshot_places: places } }), /hold for dated per-branch outline crosswalk/);
  assert.equal(run({ ...r, candidates: [{ ...candidate, license_ok: false }] })[0].flagged, true);
});

test("a passing total cannot hide a missing branch, uncovered area, or duplicate member", () => {
  const third = { ...places[0], id: "third", osm_key: "way:3", name: "Third branch", boundary: box(-121.74, 0.001) };
  const larger: Outline = { type: "MultiPolygon", coordinates: union(boundary.coordinates, third.boundary.coordinates) };
  const r = { ...row, boundary: larger, area_km2: metrics.area(larger) };
  assert.throws(() => reviewCombinedInventoryRows(places, [...places, third], [r], metrics, select), /possible missing branch Third/);
  assert.throws(() => run(r), /uncovered ice/);
  assert.throws(() => run({ ...row, members: ["way:1", "way:1"] }), /Invalid combined inventory row/);
  assert.throws(() => reviewCombinedInventoryRows(places, places, [row, { ...row }], metrics, select), /Duplicate inventory row key/);
  assert.throws(() => run({ ...row, branch_fact_search: {} }), /search dated branch facts/);
  const overlap = { ...places[1], boundary: places[0].boundary };
  assert.throws(() => reviewCombinedInventoryRows([places[0], overlap], [places[0], overlap], [row], metrics, select), /double-count ice/);
});

test("parent counts use member places across parents, and never infer an area total", () => {
  const counts = inventoryMemberCounts([...places, { ...places[0], id: "third", parent_key: "other" }], "default");
  assert.equal(counts.default.named_glacier_count, 2);
  assert.equal(counts.other.named_glacier_count, 1);
  assert.equal("area_km2" in counts.default, false);
  assert.throws(() => inventoryMemberCounts([...places, places[0]], "default"), /Duplicate/);
});


test("two inventory rows and three places form one component; only isolated one-to-one rows supply facts", () => {
  const third = { ...places[0], id: "third", osm_key: "way:3", name: "Third", boundary: box(-121.74) };
  const all = [...places, third];
  const second: CombinedInventoryRow = { ...row, key: "cohort:row-2", inventory_id: "row-2",
    boundary: box(-121.745, 0.015), members: [places[1].osm_key, third.osm_key],
    area_km2: metrics.area(box(-121.745, 0.015)),
    branch_fact_search: { ...row.branch_fact_search, "way:3": [{ source: "branch inventory search", result: "No independent figure" }] } };
  const first = { ...row, boundary: box(-121.76, 0.015), area_km2: metrics.area(box(-121.76, 0.015)) };
  const result = reviewCombinedInventoryRows(all, all, [first, second], metrics, select);
  assert.equal(result.length, 1); assert.equal(result[0].rows.length, 2); assert.equal(result[0].members.length, 3);
  assert.equal(result[0].facts_flag, "facts: combined rows"); assert.equal(result[0].flagged, false);
  assert.equal(individualInventoryRows([first, second]).length, 0);
  assert.equal(individualInventoryRows([{ ...first, members: ["way:1"] }]).length, 1);
  assert.throws(() => refreshGlacierOutlines({ ...base, places: all.map(p => ({ ...p, facts: { ...p.facts, area_km2: 2 } })) }, [], [], {}, metrics,
    { rule: 2, combinedInventory: { rows: [first, second], snapshot_places: all } }), /cannot supply individual facts/);
});
