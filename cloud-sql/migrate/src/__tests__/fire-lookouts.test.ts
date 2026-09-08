import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { auditedLookoutFeatures, matchLookout, osmLookout, LookoutSource, LookoutDestination } from "../lib/fire-lookouts";

const source: LookoutSource = { source: "ffla", sourceId: "wa/test", name: "Granite Mountain Lookout", lat: 47, lng: -121, status: "Standing", url: "https://firelookout.org/lookouts/us/wa/" };
const peak: LookoutDestination = {id: "p", name: "Granite Mountain", lat: 47, lng: -121, features: ["summit"]};

test("matches a named summit within 500m and preserves its identity", () => {
  assert.equal(matchLookout({...peak, lat: 47.003}, source)?.method, "name-and-coordinates");
  assert.equal(matchLookout({...peak, lat: 47.006}, source), null);
});
test("coordinate-only matches stay within 100m", () => {
  assert.ok(matchLookout({...peak, name: "Unnamed", lat: 47.0005}, source));
  assert.equal(matchLookout({...peak, name: "Different", lat: 47.002}, source), null);
});
test("former, partial, temporary and relocated structures cannot gain a badge", () => {
  for (const status of ["Gone", "Standing*", "Temp*", "Relocated", "Abandoned"]) {
    assert.equal(matchLookout(peak, {...source, status}), null);
  }
});
test("rejects invalid coordinates, unrelated POIs and empty normalized names", () => {
  assert.equal(matchLookout({...peak, lat: null}, source), null);
  assert.equal(matchLookout(peak, {...source, lng: NaN}), null);
  assert.equal(matchLookout({...peak, features: ["campsite"]}, source), null);
  assert.ok(matchLookout({...peak, features: ["volcano"]}, source));
  assert.equal(matchLookout({...peak, name: "Peak", lat: 47.002}, {...source, name: "Tower"}), null);
});
test("OSM requires fire-specific evidence and rejects demolished structures", () => {
  const element = { type: "node", id: 123, lat: 47, lon: -121 };
  assert.equal(osmLookout({...element, tags: {"tower:type": "observation", name: "Lookout"}}), null);
  assert.equal(osmLookout({...element, tags: {"tower:type": "watchtower", watchtower: "military"}}), null);
  assert.ok(osmLookout({...element, tags: {"tower:type": "watchtower", watchtower: "fire", disused: "yes"}}));
  assert.ok(osmLookout({...element, tags: {building: "fire_lookout", tourism: "wilderness_hut"}}));
  assert.ok(osmLookout({...element, tags: {"tower:type": "observation", observation: "firewatch"}}));
  assert.equal(osmLookout({...element, tags: {"tower:type": "watchtower", watchtower: "fire", "demolished:building": "yes"}}), null);
});

test("legacy corrections preserve all unrelated features and remain idempotent", () => {
  const original = ["summit", "fire-lookout", "hut"];
  assert.deepEqual(auditedLookoutFeatures(original, "keep_fire_lookout"), original);
  assert.deepEqual(auditedLookoutFeatures(original, "remove_fire_lookout"), ["summit", "hut"]);
  const replaced = auditedLookoutFeatures(original, "replace_fire_lookout_with_viewpoint");
  assert.deepEqual(replaced, ["summit", "hut", "viewpoint"]);
  assert.deepEqual(auditedLookoutFeatures(replaced, "replace_fire_lookout_with_viewpoint"), replaced);
  assert.deepEqual(original, ["summit", "fire-lookout", "hut"]);
});

test("reviewed place links require an exact catalog ID, cited reason and bounded distance", () => {
  const reviewed = {...source, reviewedMatches: [{destinationId: peak.id, evidenceUrl: "https://www.nps.gov/example", note: "Land manager places this lookout on the named mountain."}]};
  assert.equal(matchLookout({...peak, lat: 47.015}, reviewed)?.method, "reviewed-place-link");
  assert.equal(matchLookout({...peak, id: "other", lat: 47.015}, reviewed), null);
  assert.equal(matchLookout({...peak, lat: 47.03}, reviewed), null);
});

test("the full dry run includes reviewed mountain associations beyond the automatic search radius", () => {
  const dir = mkdtempSync(join(tmpdir(), "peaks-fire-lookout-test-"));
  try {
    writeFileSync(join(dir, "sources.json"), JSON.stringify([{...source,
      reviewedMatches: [{destinationId: peak.id, evidenceUrl: "https://www.nps.gov/example", note: "Named mountain association."}]}]));
    writeFileSync(join(dir, "catalog.json"), JSON.stringify([{...peak, lat: 47.015}]));
    const result = spawnSync(process.execPath, ["--import", "tsx", join(__dirname, "../backfill-fire-lookouts.ts"),
      `--input=${join(dir, "sources.json")}`, `--catalog=${join(dir, "catalog.json")}`,
      `--report=${join(dir, "report.json")}`, "--verified-on=2026-09-07"], {encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
    assert.equal(report.matchedCount, 1);
    assert.equal(report.matches[0].method, "reviewed-place-link");
    assert.equal(report.changedRows, 0);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
