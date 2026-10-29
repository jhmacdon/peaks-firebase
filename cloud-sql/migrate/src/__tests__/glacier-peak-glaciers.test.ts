import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, GLACIER_PEAK_SPEC, OUTLINE_DATA_DIR, importGlacierPeakGlaciers, loadGlacierPeakOsmPackage,
  loadGlacierPeakOutlineReview } from "../import-glacier-peak-glaciers";
import { parseOsmGlaciers } from "../glaciers/osm";
import { applyGlacierManifest, placeContainer, sha256 } from "../import-glacier-manifest";

const read = (dir: string, file: string) => readFileSync(join(dir, file));
const base = loadGlacierPeakOsmPackage(), review = loadGlacierPeakOutlineReview();
const facts = (name: string) => review.manifest.places.find(p => p.name === name)!.facts;

test("snapshot hashes, roster of 16 and the Dakobed glaciers left for North Cascades", () => {
  const { files, sha256: hashes } = GLACIER_PEAK_SPEC;
  assert.equal(sha256(read(DATA_DIR, files.osm)), hashes.osm);
  assert.equal(sha256(read(DATA_DIR, files.rgi)), hashes.rgi);
  assert.equal(sha256(read(OUTLINE_DATA_DIR, files.glims)), hashes.glims);
  const snapshot = JSON.parse(read(DATA_DIR, files.osm).toString("utf8"));
  assert.equal(snapshot.osm3s.timestamp_osm_base, "2026-07-15T15:22:01Z");
  assert.deepEqual(parseOsmGlaciers(snapshot).filter(p => !(p.osm_key in GLACIER_PEAK_SPEC.roster)).map(p => p.name).sort(),
    ["Butterfly Glacier", "Clark Glacier", "Moth Glacier", "Pilz Glacier", "Richardson Glacier", "Tenpeak Glaciers"]);
  assert.equal(base.places.length, 16);
  assert.ok(base.places.every(p => p.kind === "glacier" && p.parent_key === undefined && placeContainer(base, p)?.area.name === "Glacier Peak Wilderness"));
  assert.equal(base.places.find(p => p.name === "Chocolate Glacier")!.external_ids.wikidata, "Q5103616");
  assert.equal(loadGlacierPeakOsmPackage().manifest_sha256, base.manifest_sha256);
  assert.equal(loadGlacierPeakOutlineReview().manifest.manifest_sha256, review.manifest.manifest_sha256);
});

test("facts cross-check the saved WFS rows; of 16 counts East White River", () => {
  const glims = read(OUTLINE_DATA_DIR, GLACIER_PEAK_SPEC.files.glims).toString("utf8");
  assert.match(glims, /"db_area":2\.18024[0-9]*,"rec_status":"okay","src_date":"2015-09-09T00:00:00Z","glac_name":"Chocolate Glacier","subm_id":814/);
  const chocolate = facts("Chocolate Glacier");
  assert.ok(Math.abs(chocolate.area_km2! - 2.18024) < 1e-5);
  assert.equal(chocolate.observed_year, 2015);
  assert.equal(chocolate.rank_on_mountain, 3);
  assert.equal(facts("Honeycomb Glacier").rank_on_mountain, 1);
  assert.equal(chocolate.head_elevation_m, 3210);
  assert.equal(review.manifest.mountain_context.named_glacier_count, 16);
  const milk = facts("Milk Lake Glacier");
  assert.equal((milk.provenance.head_elevation as { rgi_id: string }).rgi_id, "RGI2000-v7.0-G-02-14041", "RGI names it Milk Lake Glacier WA");
  assert.equal(milk.rank_on_mountain, 16);
  const gerdine = facts("Gerdine Glacier");
  for (const k of ["area_km2", "observed_year", "rank_on_mountain", "head_elevation_m", "inventory_name"] as const) assert.equal(gerdine[k], null);
  for (const p of review.manifest.places.filter(x => x.name !== "Gerdine Glacier")) {
    assert.ok(p.facts.area_km2! > 0 && p.facts.head_elevation_m! > 0);
    for (const k of ["terminus_elevation_m", "length_km", "average_slope_deg", "flow_direction_deg", "percent_change_since_earliest"] as const)
      assert.equal(p.facts[k], null);
    assert.deepEqual(p.facts.area_history, []);
  }
});

test("outline decisions: Ptarmigan takes the 2015 inventory; Milk Lake and Gerdine flagged", () => {
  const { report, manifest } = review;
  assert.deepEqual(report.decisions.filter(d => d.chosen_source !== "osm").map(d => d.glacier), ["Ptarmigan Glacier"]);
  assert.deepEqual(report.decisions.filter(d => d.flagged).map(d => d.glacier).sort(), ["Gerdine Glacier", "Milk Lake Glacier"]);
  const ptarmigan = report.decisions.find(d => d.glacier === "Ptarmigan Glacier")!;
  assert.equal(ptarmigan.extent_evidence!.source_key, "glims-1984-09-09-reference");
  const p = manifest.places.find(x => x.name === "Ptarmigan Glacier")!;
  assert.equal(p.geometry!.credit, "Fountain, Glenn & McNeil (2023), via GLIMS");
  assert.equal(p.geometry!.observed_at, "2015-09-09");
  assert.deepEqual(report.sources[0].audit.unmatched.filter(u => u.name.trim() && u.name !== "WA").map(u => u.name).sort(),
    ["Butterfly Glacier", "East White River", "Pilz Glacier", "Richardson Glacier"]);
  assert.equal(report.sources[0].audit.invalid.length + report.sources[0].audit.ambiguous.length, 0);
  for (const x of manifest.places.filter(x => x.name !== "Ptarmigan Glacier")) assert.equal(x.geometry!.snapshot_at, "2026-07-15");
});

test("apply needs the reviewed hash and a checked wilderness ID", async () => {
  const m = review.manifest, h = `--expected-manifest-sha256=${m.manifest_sha256}`;
  await assert.rejects(importGlacierPeakGlaciers(["--apply", "--expected-manifest-sha256=wrong"]), /reviewed/);
  await assert.rejects(applyGlacierManifest(m, ["--apply", h, "--parent-mountain-id=P", "--park-area-id=A"]), /--area-id=KEY=ID/);
});
