import { resolve } from "node:path";
import { importRegionGlaciers, loadRegionOsmPackage, loadRegionOutlineReview, type RegionPlace, type RegionSpec } from "./glaciers/region-builder";

/** Mount Adams glaciers: saved OSM, GLIMS (PSU 2019-08-31 cohort) and RGI 7.0
 * files from one Adams + St. Helens box; see
 * docs/data-audits/adams-st-helens-glaciers-2026-10-29.md. */
export const DATA_DIR = resolve(__dirname, "../data/glaciers-adams-2026-10-29");
export const OUTLINE_DATA_DIR = resolve(__dirname, "../data/glaciers-adams-glims-2026-10-29");
const WILDERNESS = "mount-adams-wilderness";
const place = (inventory: string, container: string | null): RegionPlace => ({ parent: "mount-adams", inventory, container });

/** 10 of the 13 named OSM glaciers. Containers from the USFS EDW wilderness
 * boundary: the eastern glaciers lie on Yakama Nation land, and Adams and
 * Gotchen Glaciers cross the line, so they keep no container. Held back for
 * an OSM fix: "Avalanche Glacier" (relation:4104274) and "White Salmon
 * Glacier" (relation:4104279) carry each other's names (GNIS points and the
 * inventory agree), and a second "Mazama Glacier" (relation:18735239, same
 * GNIS id, no overlap with the inventory's Mazama). */
export const ADAMS_SPEC: RegionSpec = {
  label: "Mount Adams", data_dir: DATA_DIR, outline_dir: OUTLINE_DATA_DIR,
  files: { osm: "adams-glaciers-overpass.json", rgi: "rgi7-wfs-adams.json", glims: "glims-wfs-adams.json" },
  sha256: {
    osm: "695902c6d6b8bf1211e58135a8751cd98c5d80748439c26497929764487884de",
    rgi: "905edd550a3cbb9e09f89375da8a7b05ca7afe5694d62c8696b6c21f21f80c96",
    glims: "cc0dea77d7a1968aa524ab051a894141be3db7a2978a89d2ca772d774f7d5ad7",
  },
  snapshot_date: "2026-05-31",
  roster: {
    "relation:4104273": place("Adams Glacier", null), "relation:18735198": place("Crescent Glacier", WILDERNESS), "relation:18735182": place("Gotchen Glacier", null),
    "relation:4104275": place("Klickitat Glacier", null), "relation:4104276": place("Lava Glacier", WILDERNESS),
    "relation:4104277": place("Lyman Glacier", null), "relation:18735240": place("Mazama Glacier", null),
    "relation:18735485": place("Pinnacle Glacier", WILDERNESS), "relation:4104278": place("Rusk Glacier", null),
    "relation:4104280": place("Wilson Glacier", null),
  },
  default_parent: "mount-adams",
  parents: { "mount-adams": { name: "Mount Adams", features: ["summit", "volcano"], country_code: "US", state_code: "WA",
    lat: 46.2024, lng: -121.4908, radius_m: 3000 } },
  container_areas: { [WILDERNESS]: { kind: "wilderness", name: "Mount Adams Wilderness" } },
  inventory: {
    cohort: { observed_at: "2019-08-31", submission_id: "814", chief_affl: "Portland State University" },
    rgi_outline_years: "1969",
    /** Every named cohort glacier of Mount Adams, including Avalanche and
     * White Salmon (held back above): they count towards "of 12".
     * "White Salmon  Glacier" (double space) is a third White Salmon part. */
    mountains: { "mount-adams": { label: "Mount Adams", names: {
      "Adams Glacier": 4, "Avalanche Glacier": 1, "Crescent Glacier": 2, "Gotchen Glacier": 2, "Klickitat Glacier": 2,
      "Lava Glacier": 3, "Lyman Glacier": 1, "Mazama Glacier": 1, "Pinnacle Glacier": 3, "Rusk Glacier": 1,
      "White Salmon Glacier": 3, "Wilson Glacier": 1,
    } } },
    /** RGI 1969 maps Avalanche only inside "White Salmon-Avalanche Glacier WA" fragments. */
    rgi_absent: ["Avalanche Glacier"],
  },
  activities: ["outdoor-trek", "ski"],
};

export const loadAdamsOsmPackage = () => loadRegionOsmPackage(ADAMS_SPEC);
export const loadAdamsOutlineReview = () => loadRegionOutlineReview(ADAMS_SPEC);
export const loadAdamsPackage = () => loadAdamsOutlineReview().manifest;
export const importAdamsGlaciers = (args: string[]) => importRegionGlaciers(ADAMS_SPEC, args);
if (require.main === module) importAdamsGlaciers(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
