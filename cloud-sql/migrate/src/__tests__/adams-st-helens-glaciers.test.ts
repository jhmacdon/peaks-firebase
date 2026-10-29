import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADAMS_SPEC, DATA_DIR as ADAMS_DIR, OUTLINE_DATA_DIR as ADAMS_OUTLINES, loadAdamsOsmPackage, loadAdamsOutlineReview } from "../import-adams-glaciers";
import { ST_HELENS_SPEC, loadStHelensOutlineReview } from "../import-st-helens-glaciers";
import { parseOsmGlaciers } from "../glaciers/osm";
import { applyGlacierManifest, placeContainer, sha256 } from "../import-glacier-manifest";

const read = (dir: string, file: string) => readFileSync(join(dir, file));
const adams = loadAdamsOutlineReview(), helens = loadStHelensOutlineReview();
const snapshot = JSON.parse(read(ADAMS_DIR, ADAMS_SPEC.files.osm).toString("utf8"));
const place = (name: string) => adams.manifest.places.find(p => p.name === name)!;

test("one snapshot for both mountains; hashes and base date", () => {
  assert.equal(sha256(read(ADAMS_DIR, ADAMS_SPEC.files.osm)), ADAMS_SPEC.sha256.osm);
  assert.equal(sha256(read(ADAMS_OUTLINES, ADAMS_SPEC.files.glims)), ADAMS_SPEC.sha256.glims);
  assert.deepEqual(ST_HELENS_SPEC.sha256, ADAMS_SPEC.sha256, "St. Helens reads byte-identical copies");
  assert.equal(snapshot.osm3s.timestamp_osm_base, "2026-05-31T22:37:44Z");
  assert.equal(loadAdamsOutlineReview().manifest.manifest_sha256, adams.manifest.manifest_sha256);
});

test("Adams: 12 places; Avalanche and White Salmon keep OSM names and take the inventory row on them", () => {
  const all = parseOsmGlaciers(snapshot).filter(p => p.boundary.coordinates.flat(2).every(([lng]) => lng > -121.8));
  assert.deepEqual(all.filter(p => !(p.osm_key in ADAMS_SPEC.roster)).map(p => p.osm_key), ["relation:18735239"]);
  assert.equal(adams.manifest.places.length, 12);
  assert.equal(adams.manifest.mountain_context.named_glacier_count, 12);
  assert.deepEqual(adams.manifest.places.filter(p => placeContainer(adams.manifest, p)).map(p => p.name).sort(),
    ["Avalanche Glacier", "Crescent Glacier", "Lava Glacier", "Pinnacle Glacier", "White Salmon Glacier"]);
  const byKey = (k: string) => adams.manifest.places.find(p => p.osm_key === k)!;
  assert.deepEqual([byKey("relation:4104274").name, byKey("relation:4104274").facts.inventory_name], ["Avalanche Glacier", "White Salmon Glacier"]);
  assert.deepEqual([byKey("relation:4104279").name, byKey("relation:4104279").facts.inventory_name], ["White Salmon Glacier", "Avalanche Glacier"]);
  assert.match(String(byKey("relation:4104279").facts.provenance.inventory_crosswalk), /PSU\/GNIS name for this outline is Avalanche Glacier/);
  assert.equal(byKey("relation:4104279").facts.head_elevation_m, null, "RGI 1969 has no Avalanche row");
  assert.equal(loadAdamsOsmPackage().places.find(p => p.name === "Mazama Glacier")!.osm_key, "relation:18735240");
});

test("Adams facts and decisions", () => {
  const glims = read(ADAMS_OUTLINES, ADAMS_SPEC.files.glims).toString("utf8");
  assert.match(glims, /"glac_name":"White Salmon  Glacier"/, "double-space spelling exists in the cohort");
  assert.equal(place("Adams Glacier").facts.rank_on_mountain, 1);
  assert.ok(Math.abs(place("Adams Glacier").facts.area_km2! - 3.866506) < 1e-6);
  assert.equal(place("Adams Glacier").facts.head_elevation_m, 3735);
  assert.deepEqual(adams.report.decisions.filter(d => d.chosen_source !== "osm").map(d => d.glacier).sort(),
    ["Gotchen Glacier", "Lyman Glacier", "White Salmon Glacier"]);
  assert.match(adams.report.decisions.find(d => d.glacier === "White Salmon Glacier")!.reason, /rule 2/);
  assert.deepEqual(adams.report.decisions.filter(d => d.flagged).map(d => d.glacier), []);
  assert.deepEqual(adams.report.sources[0].audit.unmatched.filter(u => u.name.trim() && u.name !== "WA").map(u => u.name), []);
});

test("St. Helens: Crater Glacier only, from the 2019-09-09 cohort", () => {
  const m = helens.manifest;
  assert.deepEqual(m.places.map(p => [p.name, p.osm_key]), [["Crater Glacier", "relation:6695149"]]);
  const f = m.places[0].facts;
  assert.equal(f.observed_year, 2019);
  assert.ok(Math.abs(f.area_km2! - 1.73984) < 1e-5);
  assert.equal(f.head_elevation_m, null, "RGI's 1980 maps predate Crater Glacier");
  assert.deepEqual(m.places[0].aliases, ["Tulutson Glacier"]);
  assert.equal(m.mountain_context.named_glacier_count, 1);
  assert.equal(helens.report.decisions[0].chosen_source, "osm");
  assert.equal(helens.report.decisions[0].flagged, false);
  assert.equal(m.parent.name, "Mount Saint Helens", "the Peaks row's exact name");
});

test("apply gates", async () => {
  await assert.rejects(applyGlacierManifest(adams.manifest, ["--apply", "--expected-manifest-sha256=wrong"]), /reviewed/);
  await assert.rejects(applyGlacierManifest(helens.manifest, ["--apply", `--expected-manifest-sha256=${helens.manifest.manifest_sha256}`,
    "--parent-mountain-id=P"]), /--area-id=KEY=ID/);
});
