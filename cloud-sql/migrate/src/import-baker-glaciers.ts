import { resolve } from "node:path";
import { GLIMS_SHA256, RGI_SHA256, SNAPSHOT_DATE, SNAPSHOT_SHA256, BAKER_INVENTORY_CONFIG } from "./glaciers/baker";
import { importRegionGlaciers, loadRegionOsmPackage, loadRegionOutlineReview, type RegionPlace, type RegionSpec } from "./glaciers/region-builder";

/** Builds the Mount Baker manifest from saved OSM, GLIMS and RGI 7.0 files.
 * Everything Baker-specific stays here and in glaciers/baker.ts. */
export const DATA_DIR = resolve(__dirname, "../data/glaciers-baker-2026-10-29");
export const OUTLINE_DATA_DIR = resolve(__dirname, "../data/glaciers-baker-glims-2026-10-29");
const WILDERNESS = "mount-baker-wilderness";
const place = (inventory: string, container: string | null, aliases?: string[]): RegionPlace =>
  ({ parent: "mount-baker", inventory, container, ...(aliases ? { aliases } : {}) });
/** Glaciers that flow from Mount Baker. The snapshot box also holds Table
 * Mountain Glacier (way:303268527) and Sisters Glacier on the Twin Sisters
 * (way:427944613); they have other parents and wait for the North Cascades
 * package. Containers were checked against the USFS EDW wilderness boundary
 * with a 50 m margin, using each place's final outline. Deming, Easton and
 * Squak cross into the Mount Baker National Recreation Area; Talum's outline
 * lies within 50 m of the line. Those keep no container rather than a
 * boundary that may not cover them. */
export const BAKER_SPEC: RegionSpec = {
  label: "Mount Baker", data_dir: DATA_DIR, outline_dir: OUTLINE_DATA_DIR,
  files: { osm: "baker-glaciers-overpass.json", rgi: "rgi7-wfs-baker.json", glims: "glims-wfs-baker.json" },
  sha256: { osm: SNAPSHOT_SHA256, rgi: RGI_SHA256, glims: GLIMS_SHA256 },
  snapshot_date: SNAPSHOT_DATE,
  roster: {
    "relation:2439493": place("Park Glacier", WILDERNESS), "relation:2439502": place("Boulder Glacier", WILDERNESS),
    "relation:4733048": place("Deming Glacier", null), "relation:4773340": place("Roosevelt Glacier", WILDERNESS),
    "relation:4773341": place("Coleman Glacier", WILDERNESS), "relation:4773345": place("Easton Glacier", null),
    "relation:4773346": place("Talum Glaciers", null, ["Talum Glacier"]), "relation:4773347": place("Squak Glacier", null),
    "relation:4777569": place("Mazama Glacier", WILDERNESS), "relation:4777570": place("Rainbow Glacier", WILDERNESS),
    "relation:4777572": place("No Name Glacier", WILDERNESS), "relation:4778054": place("Thunder Glacier", WILDERNESS),
    "relation:5668120": place("Hadley Glacier", WILDERNESS), "relation:15310454": place("Sholes Glacier", WILDERNESS),
  },
  default_parent: "mount-baker",
  parents: { "mount-baker": { name: "Mount Baker", features: ["summit", "volcano"], country_code: "US", state_code: "WA", lat: 48.7768, lng: -121.8144, radius_m: 3000 } },
  container_areas: { [WILDERNESS]: { kind: "wilderness", name: "Mount Baker Wilderness" } },
  inventory: BAKER_INVENTORY_CONFIG,
  activities: ["outdoor-trek", "ski"],
};
export const ROSTER = Object.keys(BAKER_SPEC.roster);

export const loadBakerOsmPackage = () => loadRegionOsmPackage(BAKER_SPEC);
export const loadBakerOutlineReview = () => loadRegionOutlineReview(BAKER_SPEC);
export const loadBakerPackage = () => loadBakerOutlineReview().manifest;
/** Dry run by default. `--write-manifest=FILE` saves the reviewed manifest for import-glacier-manifest. */
export const importBakerGlaciers = (args: string[]) => importRegionGlaciers(BAKER_SPEC, args);
if (require.main === module) importBakerGlaciers(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
