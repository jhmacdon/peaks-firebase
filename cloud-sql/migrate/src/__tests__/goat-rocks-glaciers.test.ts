import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, GOAT_ROCKS_SPEC as SPEC, OUTLINE_DATA_DIR, loadGoatRocksOutlineReview } from "../import-goat-rocks-glaciers";
import { parseOsmGlaciers } from "../glaciers/osm";
import { applyGlacierManifest, placeContainer, placeParent, sha256 } from "../import-glacier-manifest";

const read = (dir: string, file: string) => readFileSync(join(dir, file));
const review = loadGoatRocksOutlineReview(), m = review.manifest;
const place = (name: string) => m.places.find(p => p.name === name)!;

test("hashes, base date and every named OSM glacier in the box", () => {
  assert.equal(sha256(read(DATA_DIR, SPEC.files.osm)), SPEC.sha256.osm);
  assert.equal(sha256(read(DATA_DIR, SPEC.files.rgi)), SPEC.sha256.rgi);
  assert.equal(sha256(read(OUTLINE_DATA_DIR, SPEC.files.glims)), SPEC.sha256.glims);
  const snapshot = JSON.parse(read(DATA_DIR, SPEC.files.osm).toString("utf8"));
  assert.equal(snapshot.osm3s.timestamp_osm_base, "2026-07-15T15:22:01Z");
  assert.deepEqual(parseOsmGlaciers(snapshot).map(p => p.name).sort(), ["Conrad Glacier", "McCall Glacier", "Meade Glacier", "Packwood Glacier"]);
  assert.equal(loadGoatRocksOutlineReview().manifest.manifest_sha256, m.manifest_sha256);
});

test("parents, of-N and containers", () => {
  for (const [n, parent] of [["Conrad Glacier", "Gilbert Peak"], ["Meade Glacier", "Gilbert Peak"],
    ["McCall Glacier", "Old Snowy Mountain"], ["Packwood Glacier", "Old Snowy Mountain"]]) {
    assert.equal(placeParent(m, place(n)).parent.name, parent, n);
    assert.equal(placeParent(m, place(n)).mountain_context.named_glacier_count, 2);
    assert.equal(placeContainer(m, place(n))?.area.name, "Goat Rocks Wilderness");
  }
});

test("decisions: all OSM; Conrad and Packwood outside the ratio band", () => {
  assert.deepEqual(review.report.decisions.filter(d => d.chosen_source !== "osm"), []);
  assert.deepEqual(review.report.decisions.filter(d => d.flagged).map(d => d.glacier).sort(), ["Conrad Glacier", "Packwood Glacier"]);
  assert.ok(m.places.every(p => p.facts.area_km2 !== null && p.facts.observed_year === 2015));
});

test("apply gate", async () => {
  await assert.rejects(applyGlacierManifest(m, ["--apply", "--expected-manifest-sha256=wrong"]), /reviewed/);
});
