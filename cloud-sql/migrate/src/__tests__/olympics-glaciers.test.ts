import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, OLYMPICS_SPEC, OUTLINE_DATA_DIR, importOlympicsGlaciers, loadOlympicsOsmPackage, loadOlympicsOutlineReview } from "../import-olympics-glaciers";
import { parseOsmGlaciers } from "../glaciers/osm";
import { applyGlacierManifest, placeContainer, placeParent, sha256 } from "../import-glacier-manifest";
import { outlineMetrics } from "../glaciers/outline-geometry";

const read = (dir: string, file: string) => readFileSync(join(dir, file));
const base = loadOlympicsOsmPackage(), review = loadOlympicsOutlineReview();
const place = (name: string) => review.manifest.places.find(p => p.name === name)!;

test("snapshot hashes, roster of 11 and the three OSM polygons held back", () => {
  const { files, sha256: hashes } = OLYMPICS_SPEC;
  assert.equal(sha256(read(DATA_DIR, files.osm)), hashes.osm);
  assert.equal(sha256(read(DATA_DIR, files.rgi)), hashes.rgi);
  assert.equal(sha256(read(OUTLINE_DATA_DIR, files.glims)), hashes.glims);
  const snapshot = JSON.parse(read(DATA_DIR, files.osm).toString("utf8"));
  assert.equal(snapshot.osm3s.timestamp_osm_base, "2026-07-15T15:22:01Z");
  const all = parseOsmGlaciers(snapshot);
  assert.deepEqual(all.filter(p => !(p.osm_key in OLYMPICS_SPEC.roster)).map(p => p.name).sort(), ["Carrie Glacier", "Fairchild Glacier", "White Glacier"]);
  const white = all.find(p => p.name === "White Glacier")!;
  assert.throws(() => outlineMetrics(base.parent).validate(white.boundary), /Self-intersection|interior splits/, "inner ring shares edges with the outer ring");
  assert.equal(base.places.length, 11);
  assert.ok(base.places.every(p => placeContainer(base, p)?.area.name === "Olympic National Park"));
  assert.equal(loadOlympicsOutlineReview().manifest.manifest_sha256, review.manifest.manifest_sha256);
});

test("parents from DEM heads, each with its own of-N", () => {
  const m = review.manifest, parent = (n: string) => placeParent(m, place(n));
  for (const n of ["Blue Glacier", "Hoh Glacier", "Hubert Glacier", "Humes Glacier", "Ice River Glacier", "Jeffers Glacier"])
    assert.equal(parent(n).parent.name, "Mount Olympus");
  assert.equal(parent("Queets Glacier").parent.name, "Mount Queets");
  for (const n of ["Anderson Glacier", "Eel Glacier", "Hanging Glacier"]) assert.equal(parent(n).parent.name, "Mount Anderson");
  assert.equal(parent("Cameron Glaciers").parent.name, "Mount Cameron");
  assert.equal(parent("Blue Glacier").mountain_context.named_glacier_count, 6);
  assert.equal(parent("Eel Glacier").mountain_context.named_glacier_count, 3);
  assert.equal(place("Blue Glacier").facts.rank_on_mountain, 1);
  assert.equal(place("Eel Glacier").facts.rank_on_mountain, 1);
  assert.deepEqual(place("Cameron Glaciers").aliases, ["Cameron Glacier"]);
});

test("facts cross-check the saved WFS rows", () => {
  const glims = read(OUTLINE_DATA_DIR, OLYMPICS_SPEC.files.glims).toString("utf8");
  assert.match(glims, /"db_area":3\.74091[0-9]*,"rec_status":"okay","src_date":"2015-09-09T00:00:00Z","glac_name":"Hoh Glacier","subm_id":814/);
  assert.ok(Math.abs(place("Hoh Glacier").facts.area_km2! - 3.74091) < 1e-5);
  assert.equal(place("Hoh Glacier").facts.head_elevation_m, 2358);
  assert.equal((place("Cameron Glaciers").facts.provenance.head_elevation as { rgi_id: string }).rgi_id, "RGI2000-v7.0-G-02-13848");
  assert.equal((place("Cameron Glaciers").facts.provenance.area as { analysis_ids: string[] }).analysis_ids.length, 4);
  for (const p of review.manifest.places) for (const k of ["terminus_elevation_m", "length_km", "percent_change_since_earliest"] as const)
    assert.equal(p.facts[k], null);
});

test("outline decisions: Ice River and Jeffers take the 2015 inventory; Queets, Anderson, Cameron flagged", () => {
  const { report } = review;
  assert.deepEqual(report.decisions.filter(d => d.chosen_source !== "osm").map(d => d.glacier).sort(), ["Ice River Glacier", "Jeffers Glacier"]);
  assert.deepEqual(report.decisions.filter(d => d.flagged).map(d => d.glacier).sort(), ["Anderson Glacier", "Cameron Glaciers", "Queets Glacier"]);
  assert.ok(report.decisions.filter(d => d.chosen_source !== "osm").every(d => d.extent_evidence?.source_key === "glims-1987-09-09-reference"));
  assert.deepEqual(report.sources[0].audit.unmatched.filter(u => u.name.trim() && u.name !== "WA").map(u => u.name).sort(),
    ["Carrie Glacier", "Carrie Glacier WA", "Fairchild Glacier", "White Glacier"]);
  assert.equal(place("Jeffers Glacier").geometry!.observed_at, "2015-09-09");
});

test("apply needs every keyed parent and the park", async () => {
  const m = review.manifest, h = `--expected-manifest-sha256=${m.manifest_sha256}`;
  await assert.rejects(importOlympicsGlaciers(["--apply", "--expected-manifest-sha256=wrong"]), /reviewed/);
  await assert.rejects(applyGlacierManifest(m, ["--apply", h, "--parent-mountain-id=P", "--area-id=olympic-national-park=A"]), /--parent-id=KEY=ID/);
});
