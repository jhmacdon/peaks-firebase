import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as West from "../import-glacier-peak-wilderness-west-glaciers";
import * as Entiat from "../import-entiat-chelan-glaciers";
import * as Alpine from "../import-alpine-lakes-glaciers";
import { placeContainer, placeParent, sha256 } from "../import-glacier-manifest";
import type { RegionSpec } from "../glaciers/region-builder";

const packages = [
  { spec: West.GLACIER_PEAK_WILDERNESS_WEST_SPEC, review: West.loadGlacierPeakWildernessWestOutlineReview(), places: 8, cohort: "2015-09-09" },
  { spec: Entiat.ENTIAT_CHELAN_SPEC, review: Entiat.loadEntiatChelanOutlineReview(), places: 9, cohort: "2017-09-09" },
  { spec: Alpine.ALPINE_LAKES_SPEC, review: Alpine.loadAlpineLakesOutlineReview(), places: 10, cohort: "2015-09-09" },
];
const hashes = (s: RegionSpec) => [sha256(readFileSync(join(s.data_dir, s.files.osm))), sha256(readFileSync(join(s.data_dir, s.files.rgi))),
  sha256(readFileSync(join(s.outline_dir, s.files.glims)))];

test("each package: hashes, one cohort, roster size, every place in a wilderness", () => {
  for (const { spec, review, places, cohort } of packages) {
    assert.deepEqual(hashes(spec), [spec.sha256.osm, spec.sha256.rgi, spec.sha256.glims], spec.label);
    assert.equal(spec.inventory.cohort.observed_at, cohort);
    assert.equal(review.manifest.places.length, places);
    assert.ok(review.manifest.places.every(p => placeContainer(review.manifest, p)), spec.label);
  }
  assert.deepEqual(West.GLACIER_PEAK_WILDERNESS_WEST_SPEC.sha256, Entiat.ENTIAT_CHELAN_SPEC.sha256, "same snapshot, different cohort");
});

test("parents, of-N and facts", () => {
  const west = packages[0].review.manifest, entiat = packages[1].review.manifest, alpine = packages[2].review.manifest;
  const find = (m: typeof west, n: string) => m.places.find(p => p.name === n)!;
  assert.equal(placeParent(west, find(west, "Clark Glacier")).mountain_context.named_glacier_count, 2);
  for (const n of ["Pilz Glacier", "Butterfly Glacier"]) {
    assert.equal(placeParent(west, find(west, n)).parent.name, "Luahna Peak", n);
    assert.equal(placeParent(west, find(west, n)).mountain_context.named_glacier_count, 2);
  }
  assert.equal(placeParent(west, find(west, "Moth Glacier")).parent.name, "Neyah Point");
  assert.equal(find(west, "Pride Glacier").facts.area_km2, null);
  assert.equal(placeParent(entiat, find(entiat, "Company Glacier")).parent.name, "Bonanza Peak");
  assert.equal(find(entiat, "Company Glacier").facts.observed_year, 2017);
  assert.equal(placeParent(alpine, find(alpine, "Lynch Glacier")).mountain_context.named_glacier_count, 2, "Ice Worm counts at Mount Daniel");
  assert.equal(placeParent(alpine, find(alpine, "Stuart Glacier")).parent.name, "Mount Stuart");
});

test("decisions", () => {
  const [west, entiat, alpine] = packages.map(p => p.review.report.decisions);
  assert.deepEqual(west.filter(d => d.flagged).map(d => d.glacier).sort(), ["Moth Glacier", "Pride Glacier", "Tenpeak Glaciers"]);
  assert.deepEqual(entiat.filter(d => d.flagged).map(d => d.glacier), ["Hanging Glacier"]);
  assert.deepEqual(alpine.filter(d => d.chosen_source !== "osm").map(d => d.glacier).sort(), ["Colchuck Glacier", "Snow Creek Glacier"]);
  assert.deepEqual(alpine.filter(d => d.flagged).map(d => d.glacier).sort(), ["Chimney Glacier", "Foss Glacier", "Lynch Glacier", "Overcoat Glacier"]);
});
