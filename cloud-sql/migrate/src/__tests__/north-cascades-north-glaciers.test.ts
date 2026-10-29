import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, NORTH_CASCADES_NORTH_SPEC as SPEC, OUTLINE_DATA_DIR, loadNorthCascadesNorthOutlineReview } from "../import-north-cascades-north-glaciers";
import { ROSTER as BAKER_ROSTER } from "../import-baker-glaciers";
import { parseOsmGlaciers } from "../glaciers/osm";
import { applyGlacierManifest, placeContainer, placeParent, sha256 } from "../import-glacier-manifest";

const read = (dir: string, file: string) => readFileSync(join(dir, file));
const review = loadNorthCascadesNorthOutlineReview(), m = review.manifest;
const place = (name: string) => m.places.find(p => p.name === name)!;

test("hashes, base date, and the elements left to Baker, the south package or an OSM fix", () => {
  assert.equal(sha256(read(DATA_DIR, SPEC.files.osm)), SPEC.sha256.osm);
  assert.equal(sha256(read(DATA_DIR, SPEC.files.rgi)), SPEC.sha256.rgi);
  assert.equal(sha256(read(OUTLINE_DATA_DIR, SPEC.files.glims)), SPEC.sha256.glims);
  const snapshot = JSON.parse(read(DATA_DIR, SPEC.files.osm).toString("utf8"));
  assert.equal(snapshot.osm3s.timestamp_osm_base, "2026-06-01T08:52:28Z");
  const left = parseOsmGlaciers(snapshot).filter(p => !(p.osm_key in SPEC.roster) && !BAKER_ROSTER.includes(p.osm_key));
  assert.deepEqual(left.map(p => p.name), ["Neve Glacier"]);
  assert.equal(m.places.length, 25);
  assert.equal(loadNorthCascadesNorthOutlineReview().manifest.manifest_sha256, m.manifest_sha256);
});

test("parents, per-parent of-N and containers", () => {
  assert.equal(placeParent(m, place("Sulphide Glacier")).parent.name, "Mount Shuksan");
  assert.equal(placeParent(m, place("Sulphide Glacier")).mountain_context.named_glacier_count, 9);
  assert.equal(place("Crystal Glacier").facts.rank_on_mountain, 2);
  assert.equal(placeParent(m, place("Silver Glacier")).parent.name, "Mount Spickard");
  assert.equal(placeParent(m, place("Sisters Glacier")).parent.name, "South Twin");
  assert.deepEqual(placeParent(m, place("Ruth Glacier")).mountain_context, {}, "no cohort glacier on Ruth Mountain: no of-N");
  assert.equal(placeContainer(m, place("Nohokomeen Glacier"))!.area.name, "Pasayten Wilderness");
  assert.deepEqual(m.places.filter(p => !placeContainer(m, p)).map(p => p.name).sort(),
    ["Lower Curtis Glacier", "Ruth Glacier", "Sisters Glacier", "Table Mountain Glacier", "White Salmon Glacier"]);
});

test("facts and decisions", () => {
  const glims = read(OUTLINE_DATA_DIR, SPEC.files.glims).toString("utf8");
  assert.match(glims, /"db_area":3\.14[0-9]*,"rec_status":"okay","src_date":"2015-09-09T00:00:00Z","glac_name":"Sulphide Glacier","subm_id":814/);
  assert.ok(Math.abs(place("Sulphide Glacier").facts.area_km2! - 3.145) < 1e-3);
  for (const n of ["Table Mountain Glacier", "Sisters Glacier", "Ruth Glacier", "Diobsud Glacier", "Spillway Glacier", "Lower Price Glacier",
    "Noisy Creek Glacier", "Green Lake Glacier"]) assert.equal(place(n).facts.area_km2, null, n);
  // Sides of Bacon Peak (GNIS 48.66405,-121.51917): Noisy Creek NW, Green Lake NE.
  const centre = (n: string) => { const r = place(n).boundary.coordinates[0][0]; return [0, 1].map(i => r.reduce((s, q) => s + q[i], 0) / r.length); };
  const [nx, ny] = centre("Noisy Creek Glacier"), [gx, gy] = centre("Green Lake Glacier");
  assert.ok(ny > 48.66405 && nx < -121.51917 && gy > 48.66405 && gx > -121.51917);
  assert.equal(placeParent(m, place("Green Lake Glacier")).parent.name, "Bacon Peak");
  assert.deepEqual(review.report.decisions.filter(d => d.chosen_source !== "osm"), []);
  assert.deepEqual(review.report.decisions.filter(d => d.flagged).map(d => d.glacier).sort(), ["Diobsud Glacier", "Green Lake Glacier",
    "Lower Price Glacier", "Noisy Creek Glacier", "Ruth Glacier", "Sisters Glacier", "Spillway Glacier", "Table Mountain Glacier",
    "West Nooksack Glacier", "Whatcom Glacier"]);
});

test("apply needs every keyed parent", async () => {
  await assert.rejects(applyGlacierManifest(m, ["--apply", `--expected-manifest-sha256=${m.manifest_sha256}`, "--parent-mountain-id=P",
    "--area-id=north-cascades-np=A", "--area-id=pasayten-wilderness=B"]), /--parent-id=KEY=ID/);
});
