import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, NORTH_CASCADES_SOUTH_SPEC as SPEC, OUTLINE_DATA_DIR, loadNorthCascadesSouthOutlineReview } from "../import-north-cascades-south-glaciers";
import { parseOsmGlaciers } from "../glaciers/osm";
import { applyGlacierManifest, placeContainer, placeParent, sha256 } from "../import-glacier-manifest";

const read = (dir: string, file: string) => readFileSync(join(dir, file));
const review = loadNorthCascadesSouthOutlineReview(), m = review.manifest;
const place = (name: string) => m.places.find(p => p.name === name)!;

test("hashes, base date and a complete roster of the box", () => {
  assert.equal(sha256(read(DATA_DIR, SPEC.files.osm)), SPEC.sha256.osm);
  assert.equal(sha256(read(DATA_DIR, SPEC.files.rgi)), SPEC.sha256.rgi);
  assert.equal(sha256(read(OUTLINE_DATA_DIR, SPEC.files.glims)), SPEC.sha256.glims);
  const snapshot = JSON.parse(read(DATA_DIR, SPEC.files.osm).toString("utf8"));
  assert.equal(snapshot.osm3s.timestamp_osm_base, "2026-06-01T08:52:28Z");
  assert.equal(parseOsmGlaciers(snapshot).length, 42);
  assert.equal(m.places.length, 41, "Lyall Glacier is held: no Peaks summit within 3.7 km");
  assert.ok(!m.places.some(p => p.osm_key === "way:508039930"));
  assert.equal(loadNorthCascadesSouthOutlineReview().manifest.manifest_sha256, m.manifest_sha256);
});

test("parents, of-N, pinned RGI rows and containers", () => {
  assert.equal(placeParent(m, place("Chickamin Glacier")).parent.name, "Dome Peak");
  assert.equal(placeParent(m, place("Chickamin Glacier")).mountain_context.named_glacier_count, 4);
  assert.equal(placeParent(m, place("Buckner Glacier")).parent.name, "Mount Buckner", "the Peaks row's exact name");
  assert.equal(placeParent(m, place("Cache Glacier")).parent.name, "Mixup Peak");
  assert.equal(placeParent(m, place("Sahale Glacier")).parent.name, "Sahale Peak");
  assert.equal(placeParent(m, place("Kindy Glacier")).parent.name, "Mount Misch", "Peaks has no Mount Buckindy");
  assert.equal(placeParent(m, place("Goat Creek Glacier")).parent.name, "Mount Misch");
  assert.equal(placeParent(m, place("South Cascade Glacier")).parent.name, "Sentinel Peak", "Peaks has no Lizard Mountain");
  assert.equal((place("Thunder Glacier").facts.provenance.head_elevation as { rgi_id: string }).rgi_id, "RGI2000-v7.0-G-02-14320");
  assert.equal(place("Banded Glacier").facts.head_elevation_m, null);
  assert.ok(Math.abs(place("Neve Glacier").facts.area_km2! - 3.822) < 1e-3, "all three Neve parts");
  assert.deepEqual(m.places.filter(p => !placeContainer(m, p)).map(p => p.name).sort(),
    ["Cache Glacier", "S Glacier", "Sandalee Glacier"]);
});

test("decisions: rule 2 switches the three out-of-band outlines; 7 without facts; four glaciers from the 2017 cohort", () => {
  assert.deepEqual(review.report.decisions.filter(d => d.chosen_source !== "osm").map(d => d.glacier).sort(),
    ["Douglas Glacier", "Thunder Glacier", "Yawning Glacier"]);
  const flagged = review.report.decisions.filter(d => d.flagged);
  assert.deepEqual(flagged.filter(d => d.facts_area_km2 !== null), []);
  assert.equal(flagged.filter(d => d.facts_area_km2 === null).length, 7);
  for (const n of ["Goode Glacier", "Le Conte Glacier", "Sandalee Glacier"]) {
    assert.equal(place(n).facts.observed_year, 2017, n);
    assert.equal((place(n).facts.provenance.area as { cohort: { src_date: string } }).cohort.src_date, "2017-09-09");
    assert.equal(placeParent(m, place(n)).mountain_context.named_glacier_count, 1);
  }
  assert.equal(place("Le Conte Glacier").facts.inventory_name, "LeConte Glacier");
  assert.equal((place("Sandalee Glacier").facts.provenance.head_elevation as { rgi_id: string }).rgi_id, "RGI2000-v7.0-G-02-14232");
});

test("South Cascade: USGS benchmark 2021 DEM area, PSU 2017 kept as a cross-check", () => {
  const f = place("South Cascade Glacier").facts, area = f.provenance.area as { observed_at: string; license: string;
    cohort_cross_check: { area_km2: number; cohort: { src_date: string } } };
  assert.deepEqual([f.area_km2, f.observed_year, area.observed_at, area.license], [1.799572, 2021, "2021-08-13", "CC0-1.0"]);
  assert.equal(area.cohort_cross_check.cohort.src_date, "2017-09-09");
  assert.ok(Math.abs(area.cohort_cross_check.area_km2 - 1.777) < 1e-3);
  assert.equal(placeParent(m, place("South Cascade Glacier")).mountain_context.observed_year, 2021);
  assert.doesNotMatch(m.facts_credit, /U\.S\. Geological Survey/, "the package credit stays PSU and RGI");
  assert.equal(place("South Cascade Glacier").facts_source_url, "https://doi.org/10.5066/F7HD7SRF", "this glacier's own facts source");
  assert.match(place("South Cascade Glacier").facts_credit!, /^U\.S\. Geological Survey Glacier Project/);
  assert.equal(place("Goode Glacier").facts_credit, undefined);
});

test("apply gate", async () => {
  await assert.rejects(applyGlacierManifest(m, ["--apply", "--expected-manifest-sha256=wrong"]), /reviewed/);
});
