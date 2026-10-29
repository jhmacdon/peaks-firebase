import { resolve } from "node:path";
import type { GlacierParent } from "./import-glacier-manifest";
import { importRegionGlaciers, loadRegionOsmPackage, loadRegionOutlineReview, type RegionSpec } from "./glaciers/region-builder";

/** Goat Rocks: saved OSM, GLIMS (PSU 2015 cohort) and RGI 7.0 files; see
 * docs/data-audits/goat-rocks-glaciers-2026-10-29.md. */
export const DATA_DIR = resolve(__dirname, "../data/glaciers-goat-rocks-2026-10-29");
export const OUTLINE_DATA_DIR = resolve(__dirname, "../data/glaciers-goat-rocks-glims-2026-10-29");
const WILDERNESS = "goat-rocks-wilderness";
/** GNIS summit points; parents are the summits each glacier's DEM head lies
 * on (Copernicus GLO-30, analysis only). */
const summit = (name: string, lat: number, lng: number): GlacierParent =>
  ({ name, features: ["summit"], country_code: "US", state_code: "WA", lat, lng, radius_m: 1500 });

/** The four named OSM glaciers in the box, all inside Goat Rocks Wilderness
 * (USFS EDW boundary, 50 m margin). The fifth OSM glacier is unnamed. */
export const GOAT_ROCKS_SPEC: RegionSpec = {
  label: "Goat Rocks", data_dir: DATA_DIR, outline_dir: OUTLINE_DATA_DIR,
  files: { osm: "goat-rocks-glaciers-overpass.json", rgi: "rgi7-wfs-goat-rocks.json", glims: "glims-wfs-goat-rocks.json" },
  sha256: {
    osm: "c71051d9377615249c514be93411386ad54f75e336245e77221a4b636b02f197",
    rgi: "e1af554ed9cdbe6197d3d1ceff5103947d0427bfa4057d3aa4e48678e28dbf27",
    glims: "50e7c718b76e54db908ed471d34d65029cfac281ee15bb0bd3405257d3b2e12b",
  },
  snapshot_date: "2026-07-15",
  roster: {
    "relation:16244619": { parent: "gilbert-peak", inventory: "Conrad Glacier", container: WILDERNESS },
    "relation:16568992": { parent: "gilbert-peak", inventory: "Meade Glacier", container: WILDERNESS },
    "relation:16568990": { parent: "old-snowy-mountain", inventory: "McCall Glacier", container: WILDERNESS },
    "relation:16568991": { parent: "old-snowy-mountain", inventory: "Packwood Glacier", container: WILDERNESS },
  },
  default_parent: "gilbert-peak",
  parents: {
    "gilbert-peak": summit("Gilbert Peak", 46.4883, -121.4083),
    "old-snowy-mountain": summit("Old Snowy Mountain", 46.5121, -121.4543),
  },
  container_areas: { [WILDERNESS]: { kind: "wilderness", name: "Goat Rocks Wilderness" } },
  inventory: {
    cohort: { observed_at: "2015-09-09", submission_id: "814", chief_affl: "Portland State University" },
    rgi_outline_years: "1959–69",
    /** Every named cohort glacier in the box; the cohort's other 20 rows are unnamed or "WA". */
    mountains: {
      "gilbert-peak": { label: "Gilbert Peak", names: { "Conrad Glacier": 3, "Meade Glacier": 5 } },
      "old-snowy-mountain": { label: "Old Snowy Mountain", names: { "McCall Glacier": 6, "Packwood Glacier": 1 } },
    },
  },
  activities: ["outdoor-trek", "ski"],
  country_code: "US", state_code: "WA",
  outline_rule: 2,
};

export const loadGoatRocksOsmPackage = () => loadRegionOsmPackage(GOAT_ROCKS_SPEC);
export const loadGoatRocksOutlineReview = () => loadRegionOutlineReview(GOAT_ROCKS_SPEC);
export const loadGoatRocksPackage = () => loadGoatRocksOutlineReview().manifest;
export const importGoatRocksGlaciers = (args: string[]) => importRegionGlaciers(GOAT_ROCKS_SPEC, args);
if (require.main === module) importGoatRocksGlaciers(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
