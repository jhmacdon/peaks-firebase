import type { GlacierManifestFacts } from "../import-glacier-manifest";
import type { GlacierCandidate } from "./osm";
import { normalizeGlacierName } from "./outline-refresh";

/** Facts from the CC0 Portland State inventory (via GLIMS) and RGI 7.0
 * attributes (CC BY 4.0), shared by every builder that uses them. Area is one
 * PSU analysis cohort; head elevation is RGI `zmax_m`. RGI's US outlines come
 * from older maps with other ice divides, so its terminus, length, slope and
 * area stay in provenance and no per-glacier history is served. */
export const PSU_CREDIT = "Fountain, Glenn & McNeil (2023), via GLIMS";
export const PSU_URL = "https://doi.org/10.15760/geology-data.03";
export const RGI_CREDIT = "RGI 7.0 Consortium (2023), via GLIMS";
export const RGI_URL = "https://doi.org/10.5067/f6jmovy5navz";
export const FACTS_CREDIT = `${PSU_CREDIT}; ${RGI_CREDIT}`;

/** A cohort glac_name's expected part count (one GLIMS glacier), or the part
 * count plus the GLIMS glac_ids that belong here when its parts are several
 * GLIMS glaciers or the name recurs elsewhere in the box. */
export type InventoryName = number | { parts: number; glac_ids: string[] };
export type InventoryMountain = {
  /** Mountain name used in provenance text, e.g. "Mount Baker". */
  label: string;
  /** Every named cohort glacier on this mountain, including ones with no OSM
   * polygon: they count towards "of N". Names are unique across mountains. */
  names: Record<string, InventoryName>;
};
export type InventoryConfig = {
  cohort: { observed_at: string; submission_id: string; chief_affl: string };
  /** Keyed by the manifest parent key; the package `parent` uses any key. */
  mountains: Record<string, InventoryMountain>;
  /** RGI 7.0 rows by rgi_id when the RGI name differs or recurs. */
  rgi_ids?: Record<string, string>;
  /** Cohort names RGI 7.0 has no row for; their head elevation stays null. */
  rgi_absent?: string[];
  /** Map years of the region's RGI outlines, for provenance text ("1974–75"). */
  rgi_outline_years: string;
};
/** `glims_names` lists cohort spellings that differ from the config name. */
export type InventoryArea = { area_km2: number; analysis_ids: string[]; glacier_ids: string[]; glims_names: string[] };
export type RgiRow = { rgi_id: string; glims_id: string; year: number; area_km2: number; zmin_m: number; zmax_m: number;
  zmed_m: number; slope_deg: number; lmax_m: number; dem_source: string };
export type Inventory = { areas: Map<string, InventoryArea>; rgi: Map<string, RgiRow | null> };

type Feature = { properties: Record<string, unknown> };
const features = (raw: unknown, what: string): Feature[] => {
  const j = raw as { type?: string; features?: Feature[]; numberMatched?: number; numberReturned?: number; totalFeatures?: number };
  if (j?.type !== "FeatureCollection" || !Array.isArray(j.features) || j.numberReturned !== j.features.length
    || (j.numberMatched ?? j.totalFeatures) !== j.features.length) throw new Error(`Incomplete ${what} WFS snapshot`);
  return j.features;
};
const round = (x: number, digits: number) => Number(x.toFixed(digits));
const cohortYear = (c: InventoryConfig) => Number(c.cohort.observed_at.slice(0, 4));
export function inventoryNames(config: InventoryConfig): Map<string, { mountain: string; expected: InventoryName }> {
  const all = new Map<string, { mountain: string; expected: InventoryName }>();
  for (const [mountain, m] of Object.entries(config.mountains)) for (const [name, expected] of Object.entries(m.names)) {
    if (all.has(name)) throw new Error(`Inventory name on two mountains: ${name}`);
    all.set(name, { mountain, expected });
  }
  return all;
}

/** Parts of one named glacier further apart than this need listed glac_ids. */
export const PART_GAP_M = 1000;
type Box = [number, number, number, number];
function bbox(geometry: unknown, name: string): Box {
  const g = geometry as { type?: string; coordinates?: unknown };
  const points = (g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : null) as number[][][][] | null;
  if (!Array.isArray(points) || !points.length) throw new Error(`Missing GLIMS geometry: ${name}`);
  const xs = points.flat(2).map(p => p[0]), ys = points.flat(2).map(p => p[1]);
  if (!xs.length || ![...xs, ...ys].every(Number.isFinite)) throw new Error(`Invalid GLIMS geometry: ${name}`);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
/** Groups of parts whose boxes chain within PART_GAP_M (local metres). */
function clusters(boxes: Box[]): number {
  const gap = (a: Box, b: Box) => {
    const k = 111_320 * Math.cos((a[1] + a[3]) / 2 * Math.PI / 180);
    const dx = Math.max(0, a[0] - b[2], b[0] - a[2]) * k, dy = Math.max(0, a[1] - b[3], b[1] - a[3]) * 110_574;
    return Math.hypot(dx, dy);
  };
  const group = boxes.map((_, i) => i), find = (i: number): number => group[i] === i ? i : find(group[i]);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
    if (gap(boxes[i], boxes[j]) <= PART_GAP_M) group[find(i)] = find(j);
  return new Set(boxes.map((_, i) => find(i))).size;
}

/** Reads the saved WFS bytes. Fails closed when the cohort lacks a named
 * glacier, a name's part count changes, or RGI 7.0 lacks an unlisted name. */
export function parseInventory(glimsRaw: unknown, rgiRaw: unknown, config: InventoryConfig): Inventory {
  const names = inventoryNames(config), cohort = config.cohort;
  // Cohort names match config names as the outline matcher does: case,
  // spacing, punctuation and "Glacier(s)" are ignored ("White Salmon  Glacier").
  const byKey = new Map<string, string>();
  for (const name of names.keys()) {
    const key = normalizeGlacierName(name);
    if (byKey.has(key)) throw new Error(`Inventory names ${byKey.get(key)} and ${name} normalise alike`);
    byKey.set(key, name);
  }
  const areas = new Map<string, InventoryArea>();
  // WFS rows that share an anlys_id are pieces of one analysis and repeat its
  // db_area: count it once, and only when the pieces agree.
  const analyses = new Map<string, { name: string; glac_id: string; db_area: unknown }>();
  const boxes = new Map<string, Box[]>();
  for (const f of features(glimsRaw, "GLIMS")) {
    const p = f.properties, glimsName = String(p.glac_name ?? ""), name = byKey.get(normalizeGlacierName(glimsName)) ?? "";
    const entry = names.get(name);
    if (p.line_type !== "glac_bound" || String(p.src_date).slice(0, 10) !== cohort.observed_at
      || String(p.subm_id) !== cohort.submission_id || p.chief_affl !== cohort.chief_affl || !entry) continue;
    if (typeof entry.expected === "object" && !entry.expected.glac_ids.includes(String(p.glac_id))) continue;
    if (typeof p.db_area !== "number" || !(p.db_area > 0)) throw new Error(`Invalid GLIMS db_area: ${name}`);
    const id = String(p.anlys_id), seen = analyses.get(id);
    if (seen) {
      if (seen.name !== name || seen.glac_id !== String(p.glac_id) || seen.db_area !== p.db_area)
        throw new Error(`GLIMS rows of analysis ${id} disagree`);
      continue;
    }
    analyses.set(id, { name, glac_id: String(p.glac_id), db_area: p.db_area });
    boxes.set(name, [...boxes.get(name) ?? [], bbox((f as { geometry?: unknown }).geometry, name)]);
    const row = areas.get(name) ?? { area_km2: 0, analysis_ids: [], glacier_ids: [], glims_names: [] };
    row.area_km2 += p.db_area; row.analysis_ids.push(id); row.glacier_ids.push(String(p.glac_id));
    if (glimsName !== name && !row.glims_names.includes(glimsName)) row.glims_names.push(glimsName);
    areas.set(name, row);
  }
  for (const [name, { expected }] of names) {
    const parts = typeof expected === "number" ? expected : expected.parts, row = areas.get(name);
    if (row?.analysis_ids.length !== parts)
      throw new Error(`Incomplete ${cohortYear(config)} GLIMS cohort: ${name} has ${row?.analysis_ids.length ?? 0} of ${parts} parts`);
    // A name can recur on unrelated ice in the same box. Parts are summed
    // when the config lists their glac_ids, or when they lie together.
    if (typeof expected === "number" && clusters(boxes.get(name)!) > 1)
      throw new Error(`${name} parts lie more than ${PART_GAP_M} m apart; list the glac_ids that belong here`);
    row.area_km2 = round(row.area_km2, 6);
    row.analysis_ids.sort(); row.glacier_ids = [...new Set(row.glacier_ids)].sort(); row.glims_names.sort();
  }
  const byId = new Map(Object.entries(config.rgi_ids ?? {}).map(([name, id]) => [id, name]));
  const rgi = new Map<string, RgiRow | null>();
  for (const f of features(rgiRaw, "RGI 7.0")) {
    const p = f.properties, id = String(p.rgi_id);
    const name = byId.get(id) ?? String(p.glac_name ?? "");
    if (!names.has(name) || (config.rgi_ids?.[name] !== undefined && config.rgi_ids[name] !== id)) continue;
    if (rgi.has(name)) throw new Error(`Several RGI 7.0 rows named ${name}`);
    const year = Number(String(p.src_date).slice(0, 4));
    const values = [p.area_km2, p.zmin_m, p.zmax_m, p.zmed_m, p.slope_deg, p.lmax_m];
    if (!/^RGI2000-v7\.0-G-02-\d+$/.test(id) || !(year >= 1900) || !values.every(v => typeof v === "number" && Number.isFinite(v)))
      throw new Error(`Invalid RGI 7.0 row: ${name}`);
    rgi.set(name, { rgi_id: id, glims_id: String(p.glims_id), year, area_km2: p.area_km2 as number,
      zmin_m: p.zmin_m as number, zmax_m: p.zmax_m as number, zmed_m: p.zmed_m as number, slope_deg: p.slope_deg as number,
      lmax_m: p.lmax_m as number, dem_source: String(p.dem_source) });
  }
  const absent = new Set(config.rgi_absent ?? []);
  for (const name of absent) {
    if (!names.has(name)) throw new Error(`rgi_absent names no inventory glacier: ${name}`);
    if (rgi.has(name)) throw new Error(`RGI 7.0 has a row for rgi_absent ${name}`);
    rgi.set(name, null);
  }
  const missing = [...names.keys()].filter(n => !rgi.has(n));
  if (missing.length) throw new Error(`RGI 7.0 lacks: ${missing.join(", ")}`);
  return { areas, rgi };
}

export function inventoryMountainContext(inv: Inventory, config: InventoryConfig, mountain: string) {
  const m = config.mountains[mountain], year = cohortYear(config);
  if (!m) throw new Error(`Unknown inventory mountain ${mountain}`);
  return { observed_year: year, named_glacier_count: Object.keys(m.names).length,
    area_km2: round(Object.keys(m.names).reduce((s, n) => s + inv.areas.get(n)!.area_km2, 0), 3),
    source: PSU_CREDIT, source_url: PSU_URL,
    scope: `Named glaciers of ${m.label} in the ${year} Portland State inventory cohort; unnamed ice excluded` };
}

/** One place's facts. `inventoryName` is the cohort name (null when the
 * cohort has no individual row for the place: every fact stays null). */
export function inventoryFacts(inv: Inventory, config: InventoryConfig, mountain: string, c: GlacierCandidate,
  inventoryName: string | null): GlacierManifestFacts {
  const empty = { area_uncertainty_km2: null, terminus_elevation_m: null, elevation_range_m: null, length_km: null,
    average_slope_deg: null, flow_direction_deg: null, flow_direction_label: null, type_code: null, type_label: null,
    estimated_volume_km3: null, volume_uncertainty_km3: null, area_history: [], area_history_scope: null,
    percent_change_since_earliest: null, description: null, description_source_url: null };
  const m = config.mountains[mountain], year = cohortYear(config);
  if (inventoryName === null) return { kind: c.kind, inventory_name: null, observed_year: null, area_km2: null, rank_on_mountain: null,
    head_elevation_m: null, ...empty, provenance: { note: `No individual glacier with this name in the ${year} Portland State cohort; facts unknown` } };
  if (!m || !(inventoryName in m.names)) throw new Error(`${inventoryName} is not an inventory glacier of ${m?.label ?? mountain}`);
  const a = inv.areas.get(inventoryName)!, r = inv.rgi.get(inventoryName)!;
  const ranked = Object.keys(m.names).sort((x, y) => inv.areas.get(y)!.area_km2 - inv.areas.get(x)!.area_km2 || x.localeCompare(y, "en"));
  return {
    kind: c.kind, inventory_name: inventoryName, observed_year: year,
    area_km2: a.area_km2, area_uncertainty_km2: null,
    rank_on_mountain: ranked.indexOf(inventoryName) + 1,
    head_elevation_m: r ? Math.round(r.zmax_m) : null, terminus_elevation_m: null, elevation_range_m: null, length_km: null,
    average_slope_deg: null, flow_direction_deg: null, flow_direction_label: null, type_code: null, type_label: null,
    estimated_volume_km3: null, volume_uncertainty_km3: null,
    area_history: [], area_history_scope: null, percent_change_since_earliest: null,
    description: null, description_source_url: null,
    provenance: {
      area: { credit: PSU_CREDIT, url: PSU_URL, license: "CC0-1.0", observed_year: year,
        cohort: { src_date: config.cohort.observed_at, submission_id: config.cohort.submission_id, chief_affl: config.cohort.chief_affl },
        method: "Sum of GLIMS db_area (km²) over the cohort's parts with this glac_name; rounded to 6 decimals",
        date_note: `GLIMS stores a nominal ${config.cohort.observed_at} date; the inventory used 2013–2020 imagery, mostly 2015`,
        analysis_ids: a.analysis_ids, glims_ids: a.glacier_ids, ...(a.glims_names.length ? { glims_names: a.glims_names } : {}) },
      head_elevation: r ? { credit: RGI_CREDIT, url: RGI_URL, license: "CC-BY-4.0", license_url: "https://creativecommons.org/licenses/by/4.0/",
        rgi_id: r.rgi_id, field: "zmax_m", dem_source: r.dem_source, outline_year: r.year,
        method: "RGI 7.0 maximum DEM elevation inside its outline, rounded to whole metres" } : null,
      history: { served: false,
        note: `No individual history: the ${config.rgi_outline_years} (USGS maps) and ${year} (imagery) inventories draw different ice divides, so per-glacier change is not comparable` },
      rank_method: `Rank by ${year} area among ${ranked.length} named ${m.label} glaciers in the PSU cohort`,
      rgi_older_extent: r ? { credit: RGI_CREDIT, license: "CC-BY-4.0", rgi_id: r.rgi_id, outline_year: r.year, area_km2: r.area_km2,
        zmin_m: r.zmin_m, zmed_m: r.zmed_m, slope_deg: r.slope_deg, lmax_m: r.lmax_m,
        note: `Describes the ${config.rgi_outline_years} outline; not served as area history, terminus, length or slope` } : null,
      note: r ? null : "RGI 7.0 has no row for this glacier; head elevation unknown",
    },
  };
}
