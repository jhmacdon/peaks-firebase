import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { union } from "polyclip-ts";
import { deterministicLakeDestinationId, type OverpassElement } from "./osm-lake-coverage";
import { parseOsmPolygon } from "./glaciers/osm";
import { outlineMetrics, stableMetric, type Outline } from "./glaciers/outline-geometry";
import { loadCountryBoundaries } from "./glaciers/country-boundaries";
import { assignGlacierCountries } from "./glaciers/countries";
import { individualInventoryRows, inventoryMemberCounts, type CombinedInventoryRow } from "./glaciers/combined-inventory";
import { refreshGlacierOutlines, outlineReportMarkdown, type OutlineSource } from "./glaciers/outline-refresh";
import { applyGlacierManifest, manifestSha256, sha256, validateGlacierManifest, type GlacierManifest, type GlacierManifestFacts, type GlacierParent } from "./import-glacier-manifest";

export const DATA_DIR = resolve(__dirname, "../data/glaciers-mont-blanc-2026-10-29");
export const SNAPSHOT_SHA256 = "2d591ac91326122989ead78bab828375c1c695e07b8ece2b1fe9aa7dace0f979";
export const INPUTS_SHA256 = "f54827d4128cdfdd7f7c9b3b64192f121274b56b3ea5f9f82301a0211b186511";
const ORIGIN = { lat: 45.9, lng: 6.9 }, DATE = "2026-10-29";
const SOURCE = {
  alps2015: { key: "alps2015", geometry_source: "Paul et al. Alps Sentinel-2 inventory", observed_at: "2015-08-29", snapshot_at: DATE,
    source_url: "https://doi.org/10.1594/PANGAEA.909133", source_sha256: "7ab160fb022cc4fca45620d169dfe19d5fb17d4d1b9b0462650c948f87138991",
    credit: "Paul et al. (2019/2020), PANGAEA.909133", submission_id: "c3s_gi_rgi11_s2_2015_v2" },
  sgi2023: { key: "sgi2023", geometry_source: "GLAMOS Swiss Glacier Inventory 2023", observed_at: "2023", snapshot_at: DATE,
    source_url: "https://doi.glamos.ch/data/inventory/inventory_sgi2023_r2026.html", source_sha256: "ecef353d4b70f760eda83c6131e5345a2fd999527ea560b0bda4b7c27823f9fb",
    credit: "GLAMOS (2026), Swiss Glacier Inventory 2023", submission_id: "inventory_sgi2023_r2026" },
};
type Input = { osm_key: string; osm_keys: string[]; name: string; aliases: string[]; head: Record<string, unknown>;
  parent_candidates: { osm_key: string; name: string; lat: number; lng: number }[]; inclusion: Record<string, unknown>[]; unnamed_route_exception?: boolean };
type Row = { key: string; cohort: keyof typeof SOURCE; properties: Record<string, string | number>; geometry: Outline;
  members: string[]; hits: { osm_key: string; name: string; area: number; place_share: number; row_share: number }[] };
type ParentInput = { osm_key: string; name: string; lat: number; lng: number; status: string; search_file: string;
  match: Omit<GlacierParent, "radius_m"> | null };
const emptyFacts = (): GlacierManifestFacts => ({ kind: "glacier", inventory_name: null, observed_year: null, area_km2: null,
  area_uncertainty_km2: null, head_elevation_m: null, terminus_elevation_m: null, elevation_range_m: null, length_km: null,
  average_slope_deg: null, flow_direction_deg: null, flow_direction_label: null, type_code: null, type_label: null,
  estimated_volume_km3: null, volume_uncertainty_km3: null, rank_on_mountain: null, area_history: [], area_history_scope: null,
  percent_change_since_earliest: null, description: null, description_source_url: null, provenance: {} });

/** Every input is local and hash-pinned; no fetch or production ID discovery at build/apply time. */
export function loadMontBlancOutlineReview(dataDir = DATA_DIR) {
  const index = readFileSync(join(dataDir, "builder-inputs.sha256.json"));
  if (sha256(index) !== INPUTS_SHA256) throw new Error("Unreviewed builder input index SHA-256");
  const checks: Record<string, string> = JSON.parse(index.toString());
  const read = <T>(file: string): T => {
    const bytes = readFileSync(join(dataDir, file));
    if (!checks[file] || sha256(bytes) !== checks[file]) throw new Error(`Unreviewed Mont Blanc input SHA-256: ${file}`);
    return JSON.parse(bytes.toString());
  };
  const snapshot = read<{ elements: OverpassElement[]; osm3s: { timestamp_osm_base: string }; remark?: string }>("mont-blanc-glaciers-overpass-de.json");
  if (checks["mont-blanc-glaciers-overpass-de.json"] !== SNAPSHOT_SHA256 || snapshot.remark || snapshot.osm3s.timestamp_osm_base.slice(0, 10) !== DATE)
    throw new Error("Incomplete Mont Blanc OSM snapshot");
  const inputs = read<{ places: Input[] }>("derived/place-inputs.json").places;
  const finalHeads = read<Record<string, { head: Record<string, unknown> }>>("derived/final-heads.json");
  const parentInputs = read<ParentInput[]>("derived/parents.json");
  const crosswalk = read<Row[]>("derived/inventory-crosswalk.json");
  const sourceRows = new Map<string, { properties: Record<string, string | number>; geometry: Outline }>();
  for (const [cohort, file] of [["alps2015", "derived/alps-inventory-valid.geojson"], ["sgi2023", "derived/sgi2023.geojson"]]) {
    const raw = read<{ features: { properties: Record<string, string | number>; geometry: Outline }[] }>(file);
    for (const f of raw.features) sourceRows.set(`${cohort}:${f.properties.GLACIER_NR ?? f.properties["sgi-id"]}`, f);
  }
  if (sourceRows.size !== crosswalk.length || new Set(crosswalk.map(r => r.key)).size !== crosswalk.length)
    throw new Error("Incomplete or duplicate inventory crosswalk");
  for (const r of crosswalk) {
    const raw = sourceRows.get(r.key);
    if (!raw || JSON.stringify(raw.properties) !== JSON.stringify(r.properties) || JSON.stringify(raw.geometry) !== JSON.stringify(r.geometry))
      throw new Error(`Crosswalk changes a source row: ${r.key}`);
  }
  const metrics = outlineMetrics(ORIGIN);
  const countrySnapshot = loadCountryBoundaries(join(dataDir, "countries-overpass.json"),
    "402066c755cdbe84a4ede02da33936cb04216671ce42e60d19f7e7182ce4aa99", "https://overpass-api.de/api/interpreter", [6.5, 45.5, 7.4, 46.3], ["FR", "IT", "CH"]);
  const byKey = new Map(snapshot.elements.map(e => [`${e.type}:${e.id}`, e]));
  const members = new Set(snapshot.elements.filter(e => e.type === "relation").flatMap(e => (e.members ?? []).filter(m => m.type === "way").map(m => String(m.ref))));
  const rawPlaces = snapshot.elements.filter(e => e.tags?.natural === "glacier" && (e.type !== "way" || !members.has(String(e.id)))).map(e => ({
    id: deterministicLakeDestinationId(e.type, e.id), osm_key: `${e.type}:${e.id}`, name: e.tags?.name ?? `Unnamed glacier (${e.type} ${e.id})`,
    boundary: { type: "MultiPolygon" as const, coordinates: parseOsmPolygon(e) } }));
  const places = inputs.map(p => {
    const parts = p.osm_keys.map(key => { const e = byKey.get(key); if (!e) throw new Error(`Missing OSM part ${key}`); return parseOsmPolygon(e); });
    const e = byKey.get(p.osm_key)!;
    const boundary: Outline = { type: "MultiPolygon", coordinates: union(parts[0], ...parts.slice(1)) };
    metrics.validate(boundary);
    const external_ids: Record<string, string> = { [e.type === "way" ? "osm_way" : "osm_relation"]: String(e.id) };
    if (e.tags?.wikidata) external_ids.wikidata = e.tags.wikidata;
    return { id: deterministicLakeDestinationId(e.type, e.id), osm_key: p.osm_key, osm_keys: p.osm_keys, name: p.name,
      kind: "glacier" as const, boundary, external_ids, aliases: p.aliases, parent_key: p.parent_candidates[0].osm_key.replace(":", "-"),
      container_area_key: null, facts: { ...emptyFacts(), provenance: { inclusion: p.inclusion, osm_parts: p.osm_keys, parent_head: finalHeads[p.osm_key].head,
        parent_search_status: parentInputs.find(r => r.osm_key === p.parent_candidates[0].osm_key)?.status,
        container: "No OSM protected-area container verified in Peaks; no container assigned" } } as GlacierManifestFacts };
  });
  if (places.length !== 91) throw new Error("Expected 91 reviewed Mont Blanc places");
  const parentPointCountry = (p: ParentInput) => {
    const d = 0.00001, x = p.lng, y = p.lat;
    return assignGlacierCountries({ type: "MultiPolygon", coordinates: [[[[x-d,y-d],[x+d,y-d],[x+d,y+d],[x-d,y+d],[x-d,y-d]]]] }, countrySnapshot, ORIGIN).country_code;
  };
  const parents = Object.fromEntries(parentInputs.filter(p => places.some(v => v.parent_key === p.osm_key.replace(":", "-"))).map(p => {
    const match = p.match ? { ...p.match, features: typeof p.match.features === "string" ? String(p.match.features).replace(/[{}]/g, "").split(",") : p.match.features }
      : { name: p.name, lat: p.lat, lng: p.lng, country_code: parentPointCountry(p), state_code: null, features: ["summit"] };
    return [p.osm_key.replace(":", "-"), { ...match, radius_m: 300 }];
  }));
  for (const p of places) if (!parents[p.parent_key]) throw new Error(`Parent search missing for ${p.name}`);
  const sources: OutlineSource[] = Object.values(SOURCE).map(s => ({ ...s, license: "CC-BY-4.0", license_url: "https://creativecommons.org/licenses/by/4.0/", license_ok: true, features: [] }));
  const branchSearch = read<Record<string, { source: string; result: string }[]>>("derived/branch-fact-search.json");
  // Replace raw separate OSM parts by their one catalog place in coverage checks.
  const used = new Set(inputs.flatMap(p => p.osm_keys));
  const snapshotPlaces = [...places, ...rawPlaces.filter(p => !used.has(p.osm_key))];
  const rows: CombinedInventoryRow[] = crosswalk.filter(r => r.members.length).map(r => {
    const d = r.properties, source = sources.find(s => s.key === r.cohort)!;
    const boundary: Outline = r.geometry.type === "MultiPolygon" ? r.geometry : { type: "MultiPolygon", coordinates: [(r.geometry as unknown as { coordinates: number[][][] }).coordinates] };
    const nonmembers = Object.fromEntries(snapshotPlaces.filter(p => !r.members.includes(p.osm_key)).map(p => [p.osm_key,
      r.key === "alps2015:3175" && p.osm_key === "relation:106239"
        ? "Dated Taconnaz/Bossons divide differs from OSM; named RGI 2003 Taconnaz confirms this catchment. Neighbour rule evaluates both whole outlines; no clipping."
        : "Outside the reviewed row/place crosswalk: dated margin or divide overlap with a separately mapped place, or unnamed ice with no qualifying route. All such overlaps and residuals remain in the decision table; no outline is clipped." ]));
    return { key: r.key, inventory_id: String(d.GLACIER_NR ?? d["sgi-id"]), area_km2: Number(d.AREA_KM2 ?? d.area_km2),
      observed_at: String(d.Date ?? d.year_acq), source: { key: source.key, source_url: source.source_url, source_sha256: source.source_sha256,
        credit: source.credit, license: source.license, license_url: source.license_url, license_ok: source.license_ok }, boundary, members: r.members, nonmembers,
      coverage_review: { reason: "Whole dated inventory compared with every source-snapshot polygon, including unnamed ice. The roster keeps all linked branches and route exceptions; remaining differences are saved as residual areas, not removed or assigned to a branch.",
        evidence: ["derived/inventory-crosswalk.json", "derived/route-relevance.json", "derived/branch-fact-search.json"] },
      branch_fact_search: Object.fromEntries(r.members.map(k => [k, branchSearch[k]])),
      candidates: [{ key: source.key, area_km2: metrics.area(boundary), observed_at: String(d.Date ?? d.year_acq), license_ok: true, boundary }] };
  });
  for (const row of individualInventoryRows(rows)) {
    const r = crosswalk.find(r => r.key === row.key)!, d = r.properties, p = places.find(p => p.osm_key === row.members[0])!;
    const head = Number(d.ELEV_MAX ?? d.masl_max), toe = Number(d.ELEV_MIN ?? d.masl_min);
    p.facts = { ...p.facts, inventory_name: row.inventory_id, observed_year: Number(row.observed_at.slice(0, 4)), area_km2: row.area_km2,
      head_elevation_m: head, terminus_elevation_m: toe, elevation_range_m: stableMetric(head - toe),
      average_slope_deg: Number(d.SLOPE_MEAN ?? d.slope_deg), length_km: d.length_km === undefined ? null : Number(d.length_km),
      provenance: { ...p.facts.provenance, inventory: { source: row.source, row_id: row.inventory_id, observed_at: row.observed_at,
        elevation_source: r.cohort === "sgi2023" ? "swissALTI3D release 2025 (outline acquisition 2023)" : "ALOS AW3D30; Paul et al. inventory attributes",
        flow_direction: "null: source aspect is not ice-flow direction" } } };
    const source = sources.find(s => s.key === r.cohort)!;
    source.features.push({ id: row.inventory_id, glacier_id: row.inventory_id, name: p.name, boundary: row.boundary });
  }
  // A different split gives Tour one named, independent RGI row. The newer
  // two-row Alps total still governs the group outline check, not its facts.
  const rgi = read<{ features: { properties: Record<string, string | number>; geometry: Outline }[] }>("rgi7-wfs-mont-blanc.json");
  const branch = rgi.features.find(f => f.properties.rgi_id === "RGI2000-v7.0-G-11-00738")!;
  const independentRows: CombinedInventoryRow[] = [];
  const alternativeGraph = read<{ properties: { rgi_id: string }; hits: { osm_key: string }[] }[]>("derived/rgi-branch-search.json");
  const tourRows = alternativeGraph.filter(r => r.hits.some(h => h.osm_key === "relation:106731"));
  if (tourRows.length !== 1 || tourRows[0].hits.length !== 1 || tourRows[0].properties.rgi_id !== branch.properties.rgi_id)
    throw new Error("RGI Tour must be a one-row/one-place component");
  if (!branch || branch.properties.glac_name !== "FR4N01234A01 du Tour") throw new Error("Independent Tour RGI crosswalk changed");
  const tour = places.find(p => p.osm_key === "relation:106731")!, rd = branch.properties;
  const rgiSource = { key: "rgi7-2003", source_url: "https://doi.org/10.5067/F6JMOVY5NAVZ", source_sha256: checks["rgi7-wfs-mont-blanc.json"],
    license: "CC-BY-4.0", license_url: "https://creativecommons.org/licenses/by/4.0/", license_ok: true, credit: "RGI Consortium (2023), RGI 7.0" };
  independentRows.push({ key: String(rd.rgi_id), inventory_id: String(rd.rgi_id), area_km2: Number(rd.area_km2), observed_at: String(rd.src_date).slice(0, 10),
    source: rgiSource, boundary: branch.geometry, members: [tour.osm_key], branch_fact_search: branchSearch });
  tour.facts = { ...tour.facts, inventory_name: String(rd.glac_name), observed_year: 2003, area_km2: Number(rd.area_km2),
    head_elevation_m: Number(rd.zmax_m), terminus_elevation_m: Number(rd.zmin_m), elevation_range_m: stableMetric(Number(rd.zmax_m)-Number(rd.zmin_m)),
    length_km: Number(rd.lmax_m)/1000, average_slope_deg: Number(rd.slope_deg),
    provenance: { ...tour.facts.provenance, independent_inventory_row: { ...rgiSource, inventory_id: rd.rgi_id,
      observed_at: String(rd.src_date).slice(0,10), dem_source: rd.dem_source, branch_search: branchSearch[tour.osm_key] } } };
  // Search notes accompany every null fact set, including small places without a row.
  for (const p of places) if (p.facts.area_km2 === null) Object.assign(p.facts.provenance, { branch_fact_search: branchSearch[p.osm_key] });
  for (const p of places) {
    const provenance = p.facts.provenance as Record<string, { source?: CombinedInventoryRow["source"]; credit?: string; source_url?: string }>;
    const source = provenance.inventory?.source ?? provenance.independent_inventory_row;
    Object.assign(p, { facts_credit: source?.credit ?? "No independent inventory facts", facts_source_url: source?.source_url ?? null });
  }
  const counts = inventoryMemberCounts(places, "default");
  const defaultParent: GlacierParent = { name: "Mont Blanc", features: ["summit"], country_code: "FR", state_code: null, lat: 45.832704, lng: 6.864797, radius_m: 300 };
  const manifest: GlacierManifest = { source_sha256: SNAPSHOT_SHA256, geometry_observed_at: DATE, geometry_source: "OpenStreetMap",
    geometry_credit: "© OpenStreetMap contributors", geometry_license: "ODbL-1.0", facts_credit: "Paul et al. (2019/2020); GLAMOS (2026)",
    facts_source_url: SOURCE.alps2015.source_url, description_source_name: null, description_source_license: null,
    country_code: "FR", state_code: null, activities: ["outdoor-trek", "ski"], parent: defaultParent,
    parents: Object.fromEntries(Object.entries(parents).map(([key, p]) => [key, { ...p, mountain_context: counts[key] }])),
    container_areas: {}, mountain_context: {}, places };
  const result = refreshGlacierOutlines(manifest, sources, [], {}, metrics, { rule: 2, neighbourFallback: "all-osm", independentFactRows: independentRows, combinedInventory: { rows, snapshot_places: snapshotPlaces } });
  for (const p of result.manifest.places) Object.assign(p, assignGlacierCountries(p.boundary, countrySnapshot, ORIGIN));
  validateGlacierManifest(result.manifest);
  result.manifest.manifest_sha256 = manifestSha256(result.manifest);
  result.report.output_manifest_sha256 = result.manifest.manifest_sha256;
  return result;
}
export const loadMontBlancPackage = () => loadMontBlancOutlineReview().manifest;
export async function importMontBlancGlaciers(args: string[]) {
  const data = args.find(a => a.startsWith("--data-dir="))?.slice(11), review = loadMontBlancOutlineReview(data);
  const prefix = args.find(a => a.startsWith("--report-prefix="))?.slice(16);
  if (prefix) { writeFileSync(`${prefix}.json`, JSON.stringify(review.report, null, 2)+"\n"); writeFileSync(`${prefix}.md`, outlineReportMarkdown(review.report)); }
  const out = args.find(a => a.startsWith("--write-manifest="))?.slice(17);
  if (out) writeFileSync(out, JSON.stringify(review.manifest, null, 2)+"\n");
  await applyGlacierManifest(review.manifest, args);
}
if (require.main === module) importMontBlancGlaciers(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
