import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BAKER_SPEC, DATA_DIR, OUTLINE_DATA_DIR, loadBakerPackage } from "../import-baker-glaciers";
import { BAKER_INVENTORY } from "../glaciers/baker";
import { inventoryFacts, inventoryMountainContext, parseInventory, type InventoryConfig } from "../glaciers/psu-inventory";
import { loadRegionOsmPackage, loadRegionOutlineReview, type RegionSpec } from "../glaciers/region-builder";
import { placeParent } from "../import-glacier-manifest";

const glims = JSON.parse(readFileSync(join(OUTLINE_DATA_DIR, "glims-wfs-baker.json"), "utf8"));
const rgi = JSON.parse(readFileSync(join(DATA_DIR, "rgi7-wfs-baker.json"), "utf8"));
const { "Thunder Glacier": _thunder, "Bastile Glacier": _bastile, ...rest } = BAKER_INVENTORY;
/** Baker's data split across two synthetic mountains exercises per-parent ranks and contexts. */
const split: InventoryConfig = { cohort: BAKER_SPEC.inventory.cohort, rgi_outline_years: "1974–75",
  mountains: { "mount-baker": { label: "Mount Baker", names: rest },
    colfax: { label: "Colfax Peak", names: { "Thunder Glacier": 2, "Bastile Glacier": 1 } } } };

test("Baker built through the generic region builder keeps its applied facts and stable hash", () => {
  assert.equal(loadBakerPackage().manifest_sha256, "ecca694dbab15a7614ad06a83c963e8827a8d65fd9d9eeaba0f3be410c20c833");
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

