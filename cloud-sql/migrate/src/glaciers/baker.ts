import type { GlacierManifestFacts } from "../import-glacier-manifest";
import type { GlacierCandidate } from "./osm";

export const SNAPSHOT_SHA256 = "908c236267128bfb6a190ba18a7f64d838c7a6db4b2c7953a7f0b31ff4eb18f2";
export const GLIMS_SHA256 = "03e51afd9b5722c848c77e05351195bb29a297dfa34f4b17f3709c9590e43e4d";
export const RGI_SHA256 = "d1de1ab2c836eeb8aa2e241298bc5356757b24f12748a77c28bc2e1090db2669";
/** The mirror's `osm3s.timestamp_osm_base`, not the 2026-10-29 fetch day. */
export const SNAPSHOT_DATE = "2026-06-01";
export const GEOMETRY_CREDIT = "© OpenStreetMap contributors";
export const PSU_CREDIT = "Fountain, Glenn & McNeil (2023), via GLIMS";
export const PSU_URL = "https://doi.org/10.15760/geology-data.03";
export const RGI_CREDIT = "RGI 7.0 Consortium (2023), via GLIMS";
export const RGI_URL = "https://doi.org/10.5067/f6jmovy5navz";
export const FACTS_CREDIT = `${PSU_CREDIT}; ${RGI_CREDIT}`;

/** Every named glacier of Mount Baker in the 2015 PSU cohort, with its part
 * count. Camp Kiser and Coleman Pinnacle name snow patches by nearby landmarks
 * on Ptarmigan Ridge, not glaciers of the volcano, so they stay out. Bastile
 * Glacier has no OSM polygon: it counts towards "of N" but is not a place. */
export const BAKER_INVENTORY: Record<string, number> = {
  "Bastile Glacier": 1, "Boulder Glacier": 1, "Coleman Glacier": 1, "Deming Glacier": 1, "Easton Glacier": 1,
  "Hadley Glacier": 5, "Mazama Glacier": 3, "No Name Glacier": 5, "Park Glacier": 1, "Rainbow Glacier": 3,
  "Roosevelt Glacier": 1, "Sholes Glacier": 4, "Squak Glacier": 1, "Talum Glaciers": 1, "Thunder Glacier": 2,
};
export const PSU_COHORT = { observed_at: "2015-09-09", submission_id: "814", chief_affl: "Portland State University" };

type Feature = { properties: Record<string, unknown> };
const features = (raw: unknown, what: string): Feature[] => {
  const j = raw as { type?: string; features?: Feature[]; numberMatched?: number; numberReturned?: number; totalFeatures?: number };
  if (j?.type !== "FeatureCollection" || !Array.isArray(j.features) || j.numberReturned !== j.features.length
    || (j.numberMatched ?? j.totalFeatures) !== j.features.length) throw new Error(`Incomplete ${what} WFS snapshot`);
  return j.features;
};
const round = (x: number, digits: number) => Number(x.toFixed(digits));

export type BakerInventory = {
  areas: Map<string, { area_km2: number; analysis_ids: string[]; glacier_ids: string[] }>;
  rgi: Map<string, { rgi_id: string; glims_id: string; year: number; area_km2: number; zmin_m: number; zmax_m: number;
    zmed_m: number; slope_deg: number; lmax_m: number; dem_source: string }>;
};

/** Reads the saved WFS bytes. Fails closed when the 2015 cohort or RGI 7.0
 * lacks a named Baker glacier, or a name's part count changes. */
export function parseBakerInventory(glimsRaw: unknown, rgiRaw: unknown): BakerInventory {
  const areas: BakerInventory["areas"] = new Map();
  for (const f of features(glimsRaw, "GLIMS")) {
    const p = f.properties, name = String(p.glac_name ?? "");
    if (p.line_type !== "glac_bound" || String(p.src_date).slice(0, 10) !== PSU_COHORT.observed_at
      || String(p.subm_id) !== PSU_COHORT.submission_id || p.chief_affl !== PSU_COHORT.chief_affl || !(name in BAKER_INVENTORY)) continue;
    if (typeof p.db_area !== "number" || !(p.db_area > 0)) throw new Error(`Invalid GLIMS db_area: ${name}`);
    const row = areas.get(name) ?? { area_km2: 0, analysis_ids: [], glacier_ids: [] };
    row.area_km2 += p.db_area; row.analysis_ids.push(String(p.anlys_id)); row.glacier_ids.push(String(p.glac_id));
    areas.set(name, row);
  }
  for (const [name, parts] of Object.entries(BAKER_INVENTORY)) {
    const row = areas.get(name);
    if (row?.analysis_ids.length !== parts) throw new Error(`Incomplete 2015 GLIMS cohort: ${name} has ${row?.analysis_ids.length ?? 0} of ${parts} parts`);
    row.area_km2 = round(row.area_km2, 6);
    row.analysis_ids.sort(); row.glacier_ids = [...new Set(row.glacier_ids)].sort();
  }
  const rgi: BakerInventory["rgi"] = new Map();
  for (const f of features(rgiRaw, "RGI 7.0")) {
    const p = f.properties, name = String(p.glac_name ?? "");
    if (!(name in BAKER_INVENTORY)) continue;
    if (rgi.has(name)) throw new Error(`Several RGI 7.0 rows named ${name}`);
    const year = Number(String(p.src_date).slice(0, 4));
    const values = [p.area_km2, p.zmin_m, p.zmax_m, p.zmed_m, p.slope_deg, p.lmax_m];
    if (!/^RGI2000-v7\.0-G-02-\d+$/.test(String(p.rgi_id)) || !(year >= 1900) || !values.every(v => typeof v === "number" && Number.isFinite(v)))
      throw new Error(`Invalid RGI 7.0 row: ${name}`);
    rgi.set(name, { rgi_id: String(p.rgi_id), glims_id: String(p.glims_id), year, area_km2: p.area_km2 as number,
      zmin_m: p.zmin_m as number, zmax_m: p.zmax_m as number, zmed_m: p.zmed_m as number, slope_deg: p.slope_deg as number,
      lmax_m: p.lmax_m as number, dem_source: String(p.dem_source) });
  }
  const missing = Object.keys(BAKER_INVENTORY).filter(n => !rgi.has(n));
  if (missing.length) throw new Error(`RGI 7.0 lacks: ${missing.join(", ")}`);
  return { areas, rgi };
}

export function bakerMountainContext(inv: BakerInventory) {
  return { observed_year: 2015, named_glacier_count: Object.keys(BAKER_INVENTORY).length,
    area_km2: round([...inv.areas.values()].reduce((s, r) => s + r.area_km2, 0), 3),
    source: PSU_CREDIT, source_url: PSU_URL,
    scope: "Named glaciers of Mount Baker in the 2015 Portland State inventory cohort; unnamed ice excluded" };
}

/** Facts from published inventory attributes only. Area is the 2015 PSU
 * cohort; head elevation comes from RGI 7.0, whose Mount Baker outlines date
 * from 1974–75 maps. Terminus, length, slope and the 1974–75 area describe
 * that older extent with other ice divides (Boulder would show −46% while
 * Park gains), so they stay in provenance and are not served as facts. */
export function parseBakerFacts(inv: BakerInventory, candidates: GlacierCandidate[]): Record<string, GlacierManifestFacts> {
  const ranked = [...inv.areas.entries()].sort((a, b) => b[1].area_km2 - a[1].area_km2 || a[0].localeCompare(b[0], "en"));
  const result: Record<string, GlacierManifestFacts> = {};
  for (const c of candidates) {
    const a = inv.areas.get(c.name), r = inv.rgi.get(c.name);
    if (!a || !r) throw new Error(`No inventory row for roster place ${c.name}`);
    result[c.name] = {
      kind: c.kind, inventory_name: c.name, observed_year: 2015,
      area_km2: a.area_km2, area_uncertainty_km2: null,
      rank_on_mountain: ranked.findIndex(([n]) => n === c.name) + 1,
      head_elevation_m: Math.round(r.zmax_m), terminus_elevation_m: null, elevation_range_m: null, length_km: null,
      average_slope_deg: null, flow_direction_deg: null, flow_direction_label: null, type_code: null, type_label: null,
      estimated_volume_km3: null, volume_uncertainty_km3: null,
      area_history: [], area_history_scope: null, percent_change_since_earliest: null,
      description: null, description_source_url: null,
      provenance: {
        area: { credit: PSU_CREDIT, url: PSU_URL, license: "CC0-1.0", observed_year: 2015,
          cohort: { src_date: PSU_COHORT.observed_at, submission_id: PSU_COHORT.submission_id, chief_affl: PSU_COHORT.chief_affl },
          method: "Sum of GLIMS db_area (km²) over the cohort's parts with this glac_name; rounded to 6 decimals",
          date_note: "GLIMS stores a nominal 2015-09-09 date; the inventory used 2013–2020 imagery, mostly 2015",
          analysis_ids: a.analysis_ids, glims_ids: a.glacier_ids },
        head_elevation: { credit: RGI_CREDIT, url: RGI_URL, license: "CC-BY-4.0", license_url: "https://creativecommons.org/licenses/by/4.0/",
          rgi_id: r.rgi_id, field: "zmax_m", dem_source: r.dem_source, outline_year: r.year,
          method: "RGI 7.0 maximum DEM elevation inside its outline, rounded to whole metres" },
        history: { served: false,
          note: "No individual history: the 1974–75 (USGS maps) and 2015 (imagery) inventories draw different ice divides, so per-glacier change is not comparable" },
        rank_method: `Rank by 2015 area among ${ranked.length} named Mount Baker glaciers in the PSU cohort`,
        rgi_older_extent: { credit: RGI_CREDIT, license: "CC-BY-4.0", rgi_id: r.rgi_id, outline_year: r.year, area_km2: r.area_km2,
          zmin_m: r.zmin_m, zmed_m: r.zmed_m, slope_deg: r.slope_deg, lmax_m: r.lmax_m,
          note: "Describes the 1974–75 outline; not served as area history, terminus, length or slope" },
        note: null,
      },
    };
  }
  return result;
}
