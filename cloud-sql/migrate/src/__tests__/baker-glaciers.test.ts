import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, OUTLINE_DATA_DIR, ROSTER, importBakerGlaciers, loadBakerOsmPackage, loadBakerOutlineReview } from "../import-baker-glaciers";
import { BAKER_INVENTORY, GLIMS_SHA256, parseBakerInventory, RGI_SHA256, SNAPSHOT_SHA256 } from "../glaciers/baker";
import { parseOsmGlaciers } from "../glaciers/osm";
import { parseGlaciers } from "../glaciers/rainier";
import { applyGlacierManifest, placeContainer, placeParent, sha256, validateGlacierManifest, glacierPlaceProvenance } from "../import-glacier-manifest";
import { loadOutlineSources } from "../glaciers/outline-refresh";

const read = (dir: string, file: string) => readFileSync(join(dir, file));
const json = (dir: string, file: string) => JSON.parse(read(dir, file).toString("utf8"));
const base = loadBakerOsmPackage();
const review = loadBakerOutlineReview();
const facts = (name: string) => review.manifest.places.find(p => p.name === name)!.facts;

test("snapshot hashes, roster of 14 Mount Baker glaciers and excluded neighbours", () => {
  assert.equal(sha256(read(DATA_DIR, "baker-glaciers-overpass.json")), SNAPSHOT_SHA256);
  assert.equal(sha256(read(OUTLINE_DATA_DIR, "glims-wfs-baker.json")), GLIMS_SHA256);
  assert.equal(sha256(read(DATA_DIR, "rgi7-wfs-baker.json")), RGI_SHA256);
  const snapshot = json(DATA_DIR, "baker-glaciers-overpass.json");
  assert.equal(snapshot.osm3s.timestamp_osm_base, "2026-06-01T08:52:28Z");
  const all = parseOsmGlaciers(snapshot);
  assert.deepEqual(all.filter(p => !ROSTER.includes(p.osm_key)).map(p => [p.name, p.osm_key]).sort(),
    [["Sisters Glacier", "way:427944613"], ["Table Mountain Glacier", "way:303268527"]]);
  assert.equal(base.places.length, 14);
  assert.equal(new Set(base.places.map(p => p.id)).size, 14);
  assert.ok(base.places.every(p => p.kind === "glacier" && p.boundary.coordinates.length > 0));
  assert.equal(base.places.find(p => p.name === "Coleman Glacier")!.external_ids.wikidata, "Q5143002");
  assert.deepEqual(base.places.find(p => p.name === "Talum Glaciers")!.aliases, ["Talum Glacier"]);
  assert.equal(loadBakerOsmPackage().manifest_sha256, base.manifest_sha256, "OSM replay is deterministic");
  assert.equal(loadBakerOutlineReview().manifest.manifest_sha256, review.manifest.manifest_sha256, "refresh replay is deterministic");
});

test("shared OSM parser: roster fails closed and snowfields are per-builder", () => {
  const snapshot = json(DATA_DIR, "baker-glaciers-overpass.json");
  assert.throws(() => parseOsmGlaciers(snapshot, { roster: [...ROSTER, "way:1"] }), /missing from snapshot: way:1/);
  assert.equal(parseOsmGlaciers(snapshot, { snowfields: ["Easton Glacier"] }).find(p => p.name === "Easton Glacier")!.kind, "snowfield");
  assert.ok(parseGlaciers(snapshot).every(p => p.kind === "glacier"), "Rainier's wrapper only marks Muir Snowfield");
});

test("2015 PSU areas and RGI 7.0 attributes cross-check the saved WFS rows", () => {
  const glims = read(OUTLINE_DATA_DIR, "glims-wfs-baker.json").toString("utf8"), rgi = read(DATA_DIR, "rgi7-wfs-baker.json").toString("utf8");
  assert.match(glims, /"anlys_id":1013152,"glac_id":"G238149E48785N","db_area":6\.055[0-9]*,"rec_status":"okay","src_date":"2015-09-09T00:00:00Z","glac_name":"Coleman Glacier","subm_id":814/);
  assert.match(rgi, /"glac_name":"Coleman Glacier"/);
  const coleman = facts("Coleman Glacier");
  assert.ok(Math.abs(coleman.area_km2! - 6.0558) < 1e-4);
  assert.equal(coleman.observed_year, 2015);
  assert.equal(coleman.rank_on_mountain, 1);
  assert.equal(coleman.head_elevation_m, 3278, "RGI zmax_m 3277.7593 rounded");
  const older = (name: string) => facts(name).provenance.rgi_older_extent as { outline_year: number; area_km2: number };
  assert.ok(Math.abs(older("Coleman Glacier").area_km2 - 6.8337) < 1e-4);
  const hadley = facts("Hadley Glacier");
  assert.equal((hadley.provenance.area as { analysis_ids: string[] }).analysis_ids.length, 5, "every named part is summed");
  assert.ok(Math.abs(hadley.area_km2! - 0.663) < 1e-3);
  assert.equal(older("Easton Glacier").outline_year, 1974, "Easton's RGI outline is the 1974 map");
  assert.ok(older("Boulder Glacier").area_km2 > 6 && facts("Boulder Glacier").area_km2! < 3.4, "divide shift: why no history is served");
  assert.equal(review.manifest.mountain_context.named_glacier_count, 15, "inventory count includes Bastile Glacier");
  assert.equal(Object.keys(BAKER_INVENTORY).length, 15);
});

test("unknown or older-extent facts stay null, never zero", () => {
  for (const p of review.manifest.places) {
    const f = p.facts;
    for (const k of ["terminus_elevation_m", "elevation_range_m", "length_km", "average_slope_deg", "flow_direction_deg",
      "area_uncertainty_km2", "estimated_volume_km3", "type_code", "description"] as const) assert.equal(f[k], null, `${p.name} ${k}`);
    assert.ok(f.area_km2! > 0 && f.head_elevation_m! > 0);
    assert.deepEqual(f.area_history, []);
    assert.equal(f.area_history_scope, null);
    assert.equal(f.percent_change_since_earliest, null);
    const prov = f.provenance as Record<string, Record<string, unknown>>;
    assert.equal(prov.area.license, "CC0-1.0");
    assert.equal(prov.head_elevation.license, "CC-BY-4.0");
    assert.ok([1974, 1975].includes(prov.rgi_older_extent.outline_year as number));
  }
});

test("inventory parser fails closed on a missing part or row", () => {
  const glims = json(OUTLINE_DATA_DIR, "glims-wfs-baker.json"), rgi = json(DATA_DIR, "rgi7-wfs-baker.json");
  const drop = (raw: { features: { properties: Record<string, unknown> }[] }, keep: (p: Record<string, unknown>) => boolean) => {
    const features = raw.features.filter(f => keep(f.properties));
    return { ...raw, features, numberMatched: features.length, numberReturned: features.length, totalFeatures: features.length };
  };
  assert.throws(() => parseBakerInventory(drop(glims, p => p.anlys_id !== 1013205), rgi), /Mazama Glacier has 2 of 3/);
  assert.throws(() => parseBakerInventory(glims, drop(rgi, p => p.glac_name !== "Bastile Glacier")), /RGI 7.0 lacks: Bastile Glacier/);
  assert.throws(() => parseBakerInventory({ ...glims, numberReturned: 1 }, rgi), /Incomplete GLIMS/);
});

test("outline decisions: OSM retained everywhere; Park and Talum flagged; cohort pinned", () => {
  const { sources, references } = loadOutlineSources(join(OUTLINE_DATA_DIR, "outline-sources.json"));
  assert.deepEqual(sources.map(s => [s.observed_at, s.submission_id, s.features.length]), [["2015-09-09", "814", 75]]);
  assert.deepEqual(references.map(s => [s.observed_at, s.license_ok]), [["1975-09-09", false], ["1974-09-09", false]]);
  const { report, manifest } = review;
  assert.ok(report.decisions.every(d => d.chosen_source === "osm"));
  assert.deepEqual(report.decisions.filter(d => d.flagged).map(d => d.glacier).sort(), ["Park Glacier", "Talum Glaciers"]);
  assert.deepEqual(report.sources[0].audit.invalid.map(i => i.name), ["No Name Glacier"]);
  assert.deepEqual(report.sources[0].audit.unmatched.filter(u => u.name.trim() && u.name !== "WA").map(u => u.name).sort(),
    ["Bastile Glacier", "Camp Kiser", "Coleman Pinnacle"]);
  for (const p of manifest.places) {
    assert.deepEqual(p.boundary, base.places.find(x => x.id === p.id)!.boundary);
    assert.equal(p.geometry!.snapshot_at, "2026-06-01");
    assert.equal(p.geometry!.observed_at, null);
  }
});

test("per-place containers and default parent; apply needs keyed area IDs", async () => {
  const m = review.manifest;
  const none = m.places.filter(p => placeContainer(m, p) === null).map(p => p.name).sort();
  assert.deepEqual(none, ["Deming Glacier", "Easton Glacier", "Squak Glacier", "Talum Glaciers"]);
  assert.ok(m.places.every(p => placeParent(m, p).parent.name === "Mount Baker"));
  assert.deepEqual(glacierPlaceProvenance(m, m.places[0]).facts.provenance.mountain_context, m.mountain_context);
  const h = `--expected-manifest-sha256=${m.manifest_sha256}`;
  await assert.rejects(importBakerGlaciers(["--apply", "--expected-manifest-sha256=wrong"]), /reviewed/);
  await assert.rejects(applyGlacierManifest(m, ["--apply", h, "--parent-mountain-id=P", "--park-area-id=A"]), /--area-id=KEY=ID/);
  await assert.rejects(applyGlacierManifest(m, ["--apply", h, "--parent-mountain-id=P"]), /--area-id=KEY=ID/);
  await assert.rejects(applyGlacierManifest(m, ["--apply", h, "--area-id=mount-baker-wilderness=A"]), /--parent-mountain-id/);
  await assert.rejects(applyGlacierManifest(m, ["--apply", h, "--parent-mountain-id=P", "--area-id=mount-baker-wilderness=A", "--area-id=other=B"]), /--area-id/);
  const previous = process.env.GLACIER_DATABASE_URL;
  delete process.env.GLACIER_DATABASE_URL;
  try {
    await assert.rejects(applyGlacierManifest(m, ["--apply", h, "--parent-mountain-id=P", "--area-id=mount-baker-wilderness=A"]), /GLACIER_DATABASE_URL/,
      "complete IDs pass the argument checks and reach the connection gate");
  } finally { if (previous !== undefined) process.env.GLACIER_DATABASE_URL = previous; }
});

test("manifest validation: container modes are exclusive and keys must resolve", () => {
  const { manifest_sha256: _h, ...m } = review.manifest, p = m.places[0];
  assert.throws(() => validateGlacierManifest({ ...m, container_area: { kind: "wilderness", name: "X" } }), /container area/);
  assert.throws(() => validateGlacierManifest({ ...m, places: [{ ...p, container_area_key: "nope" }] }), /container_area_key/);
  const { container_area_key: _k, ...withoutKey } = p;
  assert.throws(() => validateGlacierManifest({ ...m, places: [withoutKey] }), /container_area_key/, "keyed packages state null explicitly");
  assert.throws(() => validateGlacierManifest({ ...m, places: [{ ...p, parent_key: "colfax" }] }), /parent_key/);
  const parents = { colfax: { ...m.parent, name: "Colfax Peak", features: ["summit"], mountain_context: { named_glacier_count: 1 } } };
  const keyed = validateGlacierManifest({ ...m, parents, places: [{ ...p, parent_key: "colfax" }] });
  assert.equal(placeParent(keyed, keyed.places[0]).parent.name, "Colfax Peak");
  assert.deepEqual(glacierPlaceProvenance(keyed, keyed.places[0]).facts.provenance.mountain_context, { named_glacier_count: 1 });
  assert.throws(() => validateGlacierManifest({ ...m, parents: { bad: { ...m.parent, radius_m: 0 } } }), /parent identity/);
});
