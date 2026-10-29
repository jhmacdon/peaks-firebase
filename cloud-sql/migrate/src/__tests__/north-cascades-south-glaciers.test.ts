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
  assert.equal(m.places.length, 42);
  assert.equal(loadNorthCascadesSouthOutlineReview().manifest.manifest_sha256, m.manifest_sha256);
});

test("parents, of-N, pinned RGI rows and containers", () => {
  assert.equal(placeParent(m, place("Chickamin Glacier")).parent.name, "Dome Peak");
  assert.equal(placeParent(m, place("Chickamin Glacier")).mountain_context.named_glacier_count, 4);
  assert.equal(placeParent(m, place("Lyall Glacier")).mountain_context.named_glacier_count, 2, "Lewis Glacier counts at Frisco Mountain");
  assert.equal((place("Thunder Glacier").facts.provenance.head_elevation as { rgi_id: string }).rgi_id, "RGI2000-v7.0-G-02-14320");
  assert.equal(place("Banded Glacier").facts.head_elevation_m, null);
  assert.ok(Math.abs(place("Neve Glacier").facts.area_km2! - 3.822) < 1e-3, "all three Neve parts");
  assert.deepEqual(m.places.filter(p => !placeContainer(m, p)).map(p => p.name).sort(),
    ["Cache Glacier", "Lyall Glacier", "S Glacier", "Sandalee Glacier"]);
});

test("decisions: no switches; 15 flagged", () => {
  assert.deepEqual(review.report.decisions.filter(d => d.chosen_source !== "osm"), []);
  const flagged = review.report.decisions.filter(d => d.flagged).map(d => d.glacier);
  assert.equal(flagged.length, 15);
  for (const n of ["South Cascade Glacier", "Goode Glacier", "Le Conte Glacier", "Sandalee Glacier"]) {
    assert.ok(flagged.includes(n), n);
    assert.equal(place(n).facts.area_km2, null, `${n} is only in the 2017 cohort`);
  }
});

test("apply gate", async () => {
  await assert.rejects(applyGlacierManifest(m, ["--apply", "--expected-manifest-sha256=wrong"]), /reviewed/);
});
