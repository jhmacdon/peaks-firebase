import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BAKER_SPEC, DATA_DIR, OUTLINE_DATA_DIR, loadBakerPackage } from "../import-baker-glaciers";
import { BAKER_INVENTORY } from "../glaciers/baker";
import { inventoryFacts, inventoryMountainContext, parseInventory, type InventoryConfig } from "../glaciers/psu-inventory";
import { loadRegionOsmPackage, loadRegionOutlineReview, type RegionSpec } from "../glaciers/region-builder";
import { placeParent, sha256 } from "../import-glacier-manifest";
import { usgsBenchmarkArea } from "../glaciers/usgs-benchmark";

const glims = JSON.parse(readFileSync(join(OUTLINE_DATA_DIR, "glims-wfs-baker.json"), "utf8"));
const rgi = JSON.parse(readFileSync(join(DATA_DIR, "rgi7-wfs-baker.json"), "utf8"));
const { "Thunder Glacier": _thunder, "Bastile Glacier": _bastile, ...rest } = BAKER_INVENTORY;
/** Baker's data split across two synthetic mountains exercises per-parent ranks and contexts. */
const split: InventoryConfig = { cohort: BAKER_SPEC.inventory.cohort, rgi_outline_years: "1974–75",
  mountains: { "mount-baker": { label: "Mount Baker", names: rest },
    colfax: { label: "Colfax Peak", names: { "Thunder Glacier": 2, "Bastile Glacier": 1 } } } };

test("Baker built through the generic region builder (rule 2) has a stable hash", () => {
  assert.equal(loadBakerPackage().manifest_sha256, "05f2ef2e0fa9ec7a247ef09253a0308bb957abf2556afe870b20b4993be16c7e");
});

test("per-mountain ranks and contexts; names unique across mountains", () => {
  const inv = parseInventory(glims, rgi, split);
  assert.equal(inventoryMountainContext(inv, split, "colfax").named_glacier_count, 2);
  assert.equal(inventoryMountainContext(inv, split, "mount-baker").named_glacier_count, 13);
  const thunder = { id: "x", name: "Thunder Glacier", osm_key: "way:1", external_ids: {}, kind: "glacier" as const,
    boundary: { type: "MultiPolygon" as const, coordinates: [] } };
  const f = inventoryFacts(inv, split, "colfax", thunder, "Thunder Glacier");
  assert.equal(f.rank_on_mountain, 1);
  assert.match(String(f.provenance.rank_method), /among 2 named Colfax Peak glaciers/);
  assert.throws(() => inventoryFacts(inv, split, "mount-baker", thunder, "Thunder Glacier"), /not an inventory glacier of Mount Baker/);
  assert.throws(() => parseInventory(glims, rgi, { ...split, mountains: { ...split.mountains, extra: { label: "X", names: { "Thunder Glacier": 2 } } } }),
    /two mountains/);
  const unknown = inventoryFacts(inv, split, "nowhere", { ...thunder, name: "Gerdine Glacier" }, null);
  assert.equal(unknown.area_km2, null);
  assert.equal(unknown.rank_on_mountain, null);
  assert.equal(unknown.head_elevation_m, null);
  assert.match(String(unknown.provenance.note), /No individual glacier/);
});

test("rgi_absent, rgi_ids and glac_ids are explicit and fail closed", () => {
  const drop = (raw: { features: { properties: Record<string, unknown> }[] }, keep: (p: Record<string, unknown>) => boolean) => {
    const features = raw.features.filter(f => keep(f.properties));
    return { ...raw, features, numberMatched: features.length, numberReturned: features.length, totalFeatures: features.length };
  };
  const noBastile = drop(rgi, p => p.glac_name !== "Bastile Glacier");
  assert.throws(() => parseInventory(glims, noBastile, split), /RGI 7.0 lacks: Bastile Glacier/);
  const inv = parseInventory(glims, noBastile, { ...split, rgi_absent: ["Bastile Glacier"] });
  assert.equal(inv.rgi.get("Bastile Glacier"), null);
  const bastile = inventoryFacts(inv, split, "colfax", { id: "b", name: "Bastile Glacier", osm_key: "way:2", external_ids: {}, kind: "glacier",
    boundary: { type: "MultiPolygon", coordinates: [] } }, "Bastile Glacier");
  assert.equal(bastile.head_elevation_m, null);
  assert.ok(bastile.area_km2! > 0);
  assert.throws(() => parseInventory(glims, rgi, { ...split, rgi_absent: ["Bastile Glacier"] }), /has a row for rgi_absent/);
  const coleman = rgi.features.find((f: { properties: Record<string, unknown> }) => f.properties.glac_name === "Coleman Glacier").properties.rgi_id;
  const renamed = { ...rgi, features: rgi.features.map((f: { properties: Record<string, unknown> }) => f.properties.rgi_id === coleman
    ? { ...f, properties: { ...f.properties, glac_name: "Coleman Glacier WA" } } : f) };
  assert.throws(() => parseInventory(glims, renamed, split), /RGI 7.0 lacks: Coleman Glacier/);
  assert.equal(parseInventory(glims, renamed, { ...split, rgi_ids: { "Coleman Glacier": coleman } }).rgi.get("Coleman Glacier")!.rgi_id, coleman);
  const thunderIds = glims.features.filter((f: { properties: Record<string, unknown> }) => f.properties.glac_name === "Thunder Glacier"
    && String(f.properties.src_date).startsWith("2015")).map((f: { properties: Record<string, unknown> }) => String(f.properties.glac_id));
  const one = { ...split, mountains: { ...split.mountains, colfax: { label: "Colfax Peak", names: { "Thunder Glacier": { parts: 1, glac_ids: [thunderIds[0]] }, "Bastile Glacier": 1 } } } };
  assert.deepEqual(parseInventory(glims, rgi, one).areas.get("Thunder Glacier")!.glacier_ids, [thunderIds[0]]);
});

test("region spec: keyed parents carry their own mountain context; roster and inventory checks", () => {
  const spec: RegionSpec = { ...BAKER_SPEC, inventory: split,
    parents: { ...BAKER_SPEC.parents, colfax: { name: "Colfax Peak", features: ["summit"], country_code: "US", state_code: "WA", lat: 48.7856, lng: -121.8392, radius_m: 1000 } },
    roster: { ...BAKER_SPEC.roster, "relation:4778054": { parent: "colfax", inventory: "Thunder Glacier", container: null } } };
  const m = loadRegionOsmPackage(spec);
  const thunder = m.places.find(p => p.name === "Thunder Glacier")!;
  assert.equal(thunder.parent_key, "colfax");
  assert.equal(placeParent(m, thunder).mountain_context.named_glacier_count, 2);
  assert.equal(m.mountain_context.named_glacier_count, 13);
  assert.ok(m.places.filter(p => p !== thunder).every(p => p.parent_key === undefined));
  assert.equal(loadRegionOutlineReview(spec).report.decisions.length, 14);
  assert.throws(() => loadRegionOsmPackage({ ...spec, roster: { ...spec.roster, "relation:4778054": { parent: "mount-baker", inventory: "Thunder Glacier", container: null } } }),
    /not listed under its parent/);
  assert.throws(() => loadRegionOsmPackage({ ...spec, roster: { ...spec.roster, "relation:4778054": { parent: "colfax", inventory: "Park Glacier", container: null } } }),
    /not listed under its parent|two places/);
  assert.throws(() => loadRegionOsmPackage({ ...spec, sha256: { ...spec.sha256, rgi: "0".repeat(64) } }), /Unreviewed snapshot/);
});

test("cohort names match config names like the outline matcher, and the spellings are recorded", () => {
  const respaced = { ...glims, features: glims.features.map((f: { properties: Record<string, unknown> }) =>
    f.properties.glac_name === "Thunder Glacier" && f.properties.anlys_id === 1013147 ? { ...f, properties: { ...f.properties, glac_name: "Thunder  glacier" } } : f) };
  const inv = parseInventory(respaced, rgi, split);
  assert.equal(inv.areas.get("Thunder Glacier")!.analysis_ids.length, 2);
  assert.deepEqual(inv.areas.get("Thunder Glacier")!.glims_names, ["Thunder  glacier"]);
  const thunder = { id: "x", name: "Thunder Glacier", osm_key: "way:1", external_ids: {}, kind: "glacier" as const,
    boundary: { type: "MultiPolygon" as const, coordinates: [] } };
  assert.deepEqual((inventoryFacts(inv, split, "colfax", thunder, "Thunder Glacier").provenance.area as { glims_names: string[] }).glims_names, ["Thunder  glacier"]);
  assert.equal("glims_names" in (inventoryFacts(parseInventory(glims, rgi, split), split, "colfax", thunder, "Thunder Glacier").provenance.area as object), false);
  assert.throws(() => parseInventory(glims, rgi, { ...split, mountains: { ...split.mountains, extra: { label: "X", names: { "Thunder Glaciers": 1 } } } }),
    /normalise alike/);
});

test("split WFS analyses count once; far-apart same-name parts need listed glac_ids", () => {
  type Row = { properties: Record<string, unknown>; geometry: { type: string; coordinates: number[][][] } };
  const rows = glims.features as Row[], wfs = (features: Row[]) => ({ ...glims, features, numberMatched: features.length, numberReturned: features.length });
  const base = parseInventory(glims, rgi, split);
  const thunder = rows.find(f => f.properties.glac_name === "Thunder Glacier" && String(f.properties.src_date).startsWith("2015"))!;
  const piece = { ...thunder, properties: { ...thunder.properties } };
  assert.equal(parseInventory(wfs([...rows, piece]), rgi, split).areas.get("Thunder Glacier")!.area_km2, base.areas.get("Thunder Glacier")!.area_km2);
  assert.throws(() => parseInventory(wfs([...rows, { ...piece, properties: { ...piece.properties, db_area: 9 } }]), rgi, split), /disagree/);
  const hadley = rows.filter(f => f.properties.glac_name === "Hadley Glacier" && String(f.properties.src_date).startsWith("2015"));
  assert.ok(new Set(hadley.map(f => f.properties.glac_id)).size > 1, "Hadley's nearby parts are several GLIMS glaciers");
  const moved = rows.map(f => f !== hadley[0] ? f : { ...f, geometry: { ...f.geometry,
    coordinates: f.geometry.coordinates.map(r => r.map(([x, y]) => [x + .1, y])) } });
  assert.throws(() => parseInventory(wfs(moved), rgi, split), /Hadley Glacier parts lie more than 1000 m apart/);
  const ids = hadley.map(f => String(f.properties.glac_id));
  const listed = { ...split, mountains: { ...split.mountains, "mount-baker": { ...split.mountains["mount-baker"],
    names: { ...split.mountains["mount-baker"].names, "Hadley Glacier": { parts: hadley.length, glac_ids: ids } } } } };
  assert.equal(parseInventory(wfs(moved), rgi, listed).areas.get("Hadley Glacier")!.area_km2, base.areas.get("Hadley Glacier")!.area_km2);
});

test("country and state codes come from the spec", () => {
  const m = loadRegionOsmPackage({ ...BAKER_SPEC, country_code: "CA", state_code: "BC" });
  assert.deepEqual([m.country_code, m.state_code], ["CA", "BC"]);
});

test("a mountain may take its names from another dated cohort of the cleared submission", () => {
  type Row = { properties: Record<string, unknown> };
  const rows = glims.features as Row[];
  const later = rows.filter(f => ["Thunder Glacier", "Bastile Glacier"].includes(String(f.properties.glac_name)) && String(f.properties.src_date).startsWith("2015"))
    .map((f, i) => ({ ...f, properties: { ...f.properties, src_date: "2017-09-09T00:00:00Z", anlys_id: 9_000_000 + i, db_area: .5 } }));
  const both = { ...glims, features: [...rows.filter(f => !(["Thunder Glacier", "Bastile Glacier"].includes(String(f.properties.glac_name))
    && String(f.properties.src_date).startsWith("2015"))), ...later] };
  both.numberMatched = both.numberReturned = both.features.length;
  const cohort = { ...split.cohort, observed_at: "2017-09-09" };
  const config: InventoryConfig = { ...split, mountains: { ...split.mountains, colfax: { ...split.mountains.colfax, cohort } } };
  assert.throws(() => parseInventory(both, rgi, split), /Incomplete 2015 GLIMS cohort: Thunder Glacier/);
  const inv = parseInventory(both, rgi, config);
  assert.equal(inventoryMountainContext(inv, config, "colfax").observed_year, 2017);
  assert.equal(inventoryMountainContext(inv, config, "mount-baker").observed_year, 2015);
  const thunder = { id: "x", name: "Thunder Glacier", osm_key: "way:1", external_ids: {}, kind: "glacier" as const,
    boundary: { type: "MultiPolygon" as const, coordinates: [] } };
  const f = inventoryFacts(inv, config, "colfax", thunder, "Thunder Glacier");
  assert.equal(f.observed_year, 2017);
  assert.equal((f.provenance.area as { cohort: { src_date: string } }).cohort.src_date, "2017-09-09");
  assert.throws(() => parseInventory(both, rgi, { ...config, mountains: { ...config.mountains, colfax: { ...config.mountains.colfax,
    cohort: { ...cohort, submission_id: "744" } } } }), /outside the cleared submission/);
});

test("an area source replaces the cohort area per glacier, keeps it as a cross-check, and says so in a mixed total", () => {
  const source = (area_km2: number) => ({ area_km2, observed_at: "2021-08-13", credit: "USGS test", url: "https://example.org/usgs",
    license: "CC0-1.0", license_url: "https://creativecommons.org/publicdomain/zero/1.0/", method: "test", files: {} });
  const inv = parseInventory(glims, rgi, split);
  const thunder = { id: "x", name: "Thunder Glacier", osm_key: "way:1", external_ids: {}, kind: "glacier" as const,
    boundary: { type: "MultiPolygon" as const, coordinates: [] } };
  const mixed = { ...split, area_sources: { "Thunder Glacier": source(9) } };
  assert.equal(inventoryFacts(inv, mixed, "colfax", thunder, "Thunder Glacier").observed_year, 2021, "Thunder alone takes the USGS year");
  const ctx = inventoryMountainContext(inv, mixed, "colfax");
  assert.equal(ctx.observed_year, 2015);
  assert.equal(ctx.area_km2, Number((9 + inv.areas.get("Bastile Glacier")!.area_km2).toFixed(3)));
  assert.match(ctx.scope, /2015 Portland State inventory cohort areas, except Thunder Glacier \(USGS test, 2021\)/);
  assert.match(ctx.source, /USGS test/);
  const config = { ...split, area_sources: { "Thunder Glacier": source(.1), "Bastile Glacier": source(.2) } };
  const f = inventoryFacts(inv, config, "colfax", thunder, "Thunder Glacier");
  assert.deepEqual([f.area_km2, f.observed_year, f.rank_on_mountain], [.1, 2021, 2]);
  const area = f.provenance.area as { credit: string; cohort_cross_check: { area_km2: number } };
  assert.equal(area.credit, "USGS test");
  assert.equal(area.cohort_cross_check.area_km2, inv.areas.get("Thunder Glacier")!.area_km2);
  assert.deepEqual(inventoryMountainContext(inv, config, "colfax"), { observed_year: 2021, named_glacier_count: 2, area_km2: .3,
    source: "USGS test", source_url: "https://example.org/usgs", scope: "Named glaciers of Colfax Peak, 2021 areas from USGS test; unnamed ice excluded" });
  assert.throws(() => parseInventory(glims, rgi, { ...split, area_sources: { "Nowhere Glacier": source(1) } }), /names no inventory glacier/);
  const m = loadRegionOsmPackage({ ...BAKER_SPEC, inventory: { ...BAKER_SPEC.inventory, area_sources: {} } });
  assert.equal(m.facts_credit, loadBakerPackage().facts_credit, "no source, no new credit");
});

test("USGS benchmark area: latest DEM year, checked against the geodetic area and the reviewed bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "usgs-"));
  try {
    const alt = "Year,1575,1625\n2015,1.0,0.8\n2021,0.9,0.85\n2025,0.8,0.8\n", geo = "Date,Area_max,Area_min\n2015/10/14,1800000,1800000\n2021/08/13,1800000,1750000\n";
    writeFileSync(join(dir, "alt.csv"), alt); writeFileSync(join(dir, "geo.csv"), geo);
    const files = { area_altitude: "alt.csv", geodetics: "geo.csv" }, release = { url: "https://doi.org/x", version: "ver 10.0" };
    const hashes = { area_altitude: sha256(Buffer.from(alt)), geodetics: sha256(Buffer.from(geo)) };
    const s = usgsBenchmarkArea(dir, files, hashes, release);
    assert.deepEqual([s.area_km2, s.observed_at], [1.75, "2021-08-13"], "the DEM year, not the later interpolated 2025 row");
    assert.throws(() => usgsBenchmarkArea(dir, files, { ...hashes, geodetics: "0".repeat(64) }, release), /Unreviewed USGS file/);
    const off = geo.replace("1750000", "1700000");
    writeFileSync(join(dir, "geo.csv"), off);
    assert.throws(() => usgsBenchmarkArea(dir, files, { ...hashes, geodetics: sha256(Buffer.from(off)) }, release), /disagrees/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a roster label correction renames the place, drops OSM's Wikidata tag and records the OSM name", () => {
  const base = loadRegionOsmPackage(BAKER_SPEC), before = base.places.find(p => p.osm_key === "relation:4778054")!;
  const relabel = (name: string, inventory: string | null = "Thunder Glacier", inventory_note?: string) => ({ ...BAKER_SPEC, roster: { ...BAKER_SPEC.roster,
    "relation:4778054": { ...BAKER_SPEC.roster["relation:4778054"], inventory, ...(inventory_note ? { inventory_note } : {}),
      label: { name, method: "GNIS point inside polygon" } } } });
  // Facts never follow a label across names on their own.
  assert.throws(() => loadRegionOsmPackage(relabel("Colfax Glacier")), /Colfax Glacier takes inventory facts named Thunder Glacier/);
  // A label without facts, or with a reviewed crosswalk, is allowed.
  const m = loadRegionOsmPackage(relabel("Colfax Glacier", null)), after = m.places.find(p => p.osm_key === "relation:4778054")!;
  assert.equal(before.name, "Thunder Glacier");
  assert.equal(after.name, "Colfax Glacier");
  assert.equal(after.facts.area_km2, null);
  assert.equal(after.id, before.id, "the destination id still follows the OSM element");
  assert.equal(after.external_ids.osm_relation, before.external_ids.osm_relation);
  assert.equal("wikidata" in after.external_ids, false);
  assert.deepEqual(after.facts.provenance.label, { corrected_from_osm_name: "Thunder Glacier",
    ...(before.external_ids.wikidata ? { dropped_osm_wikidata: before.external_ids.wikidata } : {}),
    method: "GNIS point inside polygon", note: 'Label corrected from OSM name "Thunder Glacier"; OpenStreetMap itself is unchanged' });
  assert.equal("label" in after, false, "the correction lives in provenance, not on the place");
  const note = "PSU name for this outline is Thunder Glacier; name follows the reviewed identity";
  const reviewed = loadRegionOsmPackage(relabel("Colfax Glacier", "Thunder Glacier", note)).places.find(p => p.osm_key === "relation:4778054")!;
  assert.equal(reviewed.facts.area_km2, before.facts.area_km2);
  assert.equal(reviewed.facts.provenance.inventory_crosswalk, note);
  assert.throws(() => loadRegionOsmPackage(relabel("Park Glacier", null)), /uniquely named/);
  assert.throws(() => loadRegionOsmPackage(relabel("Thunder Glacier")), /Invalid label correction/);
});

test("an inventory crosswalk note lands in provenance; keep_osm needs outline rule 2", () => {
  const note = "PSU/GNIS name for this outline is Bastile Glacier; name follows OSM";
  const spec = { ...BAKER_SPEC, roster: { ...BAKER_SPEC.roster,
    "relation:4778054": { ...BAKER_SPEC.roster["relation:4778054"], inventory_note: note } } };
  assert.equal(loadRegionOsmPackage(spec).places.find(p => p.osm_key === "relation:4778054")!.facts.provenance.inventory_crosswalk, note);
  const keep = { ...BAKER_SPEC, roster: { ...BAKER_SPEC.roster,
    "relation:4778054": { ...BAKER_SPEC.roster["relation:4778054"], keep_osm: "reviewed" } } };
  assert.throws(() => loadRegionOutlineReview({ ...keep, outline_rule: 1 }), /keep_osm needs outline rule 2/);
  // Keeping Thunder on OSM blocks the all-inventory option for Baker's one
  // touching group, so the switched Talum would be clipped against Squak; that
  // removes 17.5% of it, so the build holds instead.
  assert.throws(() => loadRegionOutlineReview({ ...keep, outline_rule: 2 }), /Talum Glaciers: clipping against Squak Glacier changes its area by 17\.5%/);
});

test("facts under another inventory name need a reviewed note even without a label", () => {
  const roster = (note?: string) => ({ ...BAKER_SPEC.roster,
    "relation:4778054": { ...BAKER_SPEC.roster["relation:4778054"], inventory: null } ,
    ...Object.fromEntries(Object.entries(BAKER_SPEC.roster).filter(([, r]) => r.inventory === "Coleman Glacier")
      .map(([k, r]) => [k, { ...r, inventory: "Coleman Glacier", ...(note ? { inventory_note: note } : {}) }])) });
  const key = Object.entries(BAKER_SPEC.roster).find(([, r]) => r.inventory === "Thunder Glacier")![0];
  const swap = (note?: string) => ({ ...BAKER_SPEC, roster: { ...roster(), [key]: { ...BAKER_SPEC.roster[key], inventory: null },
    ...Object.fromEntries(Object.entries(BAKER_SPEC.roster).filter(([, r]) => r.inventory === "Coleman Glacier")
      .map(([k, r]) => [k, { ...r, inventory: "Thunder Glacier", ...(note ? { inventory_note: note } : {}) }])) } });
  assert.throws(() => loadRegionOsmPackage(swap()), /Coleman Glacier takes inventory facts named Thunder Glacier/);
  const m = loadRegionOsmPackage(swap("reviewed"));
  assert.equal(m.places.find(p => p.name === "Coleman Glacier")!.facts.provenance.inventory_crosswalk, "reviewed");
});

test("a glacier whose area comes from another source carries that source as its facts credit", () => {
  const source = { area_km2: .2, observed_at: "2021-08-13", credit: "USGS test", url: "https://doi.org/x", license: "CC0-1.0",
    license_url: "https://creativecommons.org/publicdomain/zero/1.0/", method: "test", files: {} };
  const spec = { ...BAKER_SPEC, inventory: { ...BAKER_SPEC.inventory, area_sources: { "Thunder Glacier": source } } };
  const m = loadRegionOsmPackage(spec), thunder = m.places.find(p => p.name === "Thunder Glacier")!;
  assert.equal(thunder.facts_source_url, "https://doi.org/x");
  assert.match(thunder.facts_credit!, /^USGS test/);
  assert.ok(m.places.filter(p => p !== thunder).every(p => p.facts_credit === undefined));
});
