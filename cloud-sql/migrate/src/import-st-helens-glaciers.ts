import { resolve } from "node:path";
import { importRegionGlaciers, loadRegionOsmPackage, loadRegionOutlineReview, type RegionSpec } from "./glaciers/region-builder";

/** Mount St. Helens: Crater Glacier only. The parent row is named "Mount
 * Saint Helens" in Peaks (the apply step checks the exact name). The same Adams + St. Helens
 * snapshots, with the PSU 2019-09-09 cohort (Crater's only cohort); see
 * docs/data-audits/adams-st-helens-glaciers-2026-10-29.md. */
export const DATA_DIR = resolve(__dirname, "../data/glaciers-st-helens-2026-10-29");
export const OUTLINE_DATA_DIR = resolve(__dirname, "../data/glaciers-st-helens-glims-2026-10-29");
const MONUMENT = "mount-st-helens-nvm";

/** Crater Glacier is the mountain's only current glacier. OSM still tags nine
 * older names here (Ape, Dryer, Forsyth, Nelson, Shoestring, Swift, two
 * Talus, Toutle), and the PSU 2015 cohort still maps Dryer, Swift, Talus and
 * Toutle remnants; none is imported (listed for review in the packet). */
export const ST_HELENS_SPEC: RegionSpec = {
  label: "Mount St. Helens", data_dir: DATA_DIR, outline_dir: OUTLINE_DATA_DIR,
  files: { osm: "st-helens-glaciers-overpass.json", rgi: "rgi7-wfs-st-helens.json", glims: "glims-wfs-st-helens.json" },
  sha256: {
    osm: "695902c6d6b8bf1211e58135a8751cd98c5d80748439c26497929764487884de",
    rgi: "905edd550a3cbb9e09f89375da8a7b05ca7afe5694d62c8696b6c21f21f80c96",
    glims: "cc0dea77d7a1968aa524ab051a894141be3db7a2978a89d2ca772d774f7d5ad7",
  },
  snapshot_date: "2026-05-31",
  roster: { "relation:6695149": { parent: "mount-st-helens", inventory: "Crater Glacier", container: MONUMENT, aliases: ["Tulutson Glacier"] } }, // OSM alt_name
  default_parent: "mount-st-helens",
  parents: { "mount-st-helens": { name: "Mount Saint Helens", features: ["summit", "volcano"], country_code: "US", state_code: "WA",
    lat: 46.1912, lng: -122.1944, radius_m: 3000 } },
  container_areas: { [MONUMENT]: { kind: "national_monument", name: "Mount St. Helens National Volcanic Monument" } },
  inventory: {
    cohort: { observed_at: "2019-09-09", submission_id: "814", chief_affl: "Portland State University" },
    rgi_outline_years: "1980",
    mountains: { "mount-st-helens": { label: "Mount St. Helens", names: { "Crater Glacier": 1 } } },
    /** RGI 7.0 maps St. Helens from 1980; Crater Glacier formed later. */
    rgi_absent: ["Crater Glacier"],
  },
  activities: ["outdoor-trek", "ski"],
  country_code: "US", state_code: "WA",
  outline_rule: 2,
};

export const loadStHelensOsmPackage = () => loadRegionOsmPackage(ST_HELENS_SPEC);
export const loadStHelensOutlineReview = () => loadRegionOutlineReview(ST_HELENS_SPEC);
export const loadStHelensPackage = () => loadStHelensOutlineReview().manifest;
export const importStHelensGlaciers = (args: string[]) => importRegionGlaciers(ST_HELENS_SPEC, args);
if (require.main === module) importStHelensGlaciers(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
