import { resolve } from "node:path";
import type { GlacierParent } from "./import-glacier-manifest";
import { importRegionGlaciers, loadRegionOsmPackage, loadRegionOutlineReview, type RegionSpec } from "./glaciers/region-builder";

/** Alpine Lakes Wilderness glaciers (Stuart Range, Daniel and Hinman,
 * Overcoat and Chimney Rock), PSU 2015-09-09 cohort; see
 * docs/data-audits/north-cascades-gpw-alpine-glaciers-2026-10-29.md. */
export const DATA_DIR = resolve(__dirname, "../data/glaciers-alpine-lakes-2026-10-29");
export const OUTLINE_DATA_DIR = resolve(__dirname, "../data/glaciers-alpine-lakes-glims-2026-10-29");
const ALW = "alpine-lakes-wilderness";
/** GNIS summit points; parents are the summits each glacier's DEM head lies on. */
const summit = (name: string, lat: number, lng: number): GlacierParent =>
  ({ name, features: ["summit"], country_code: "US", state_code: "WA", lat, lng, radius_m: 1500 });

/** Left out of the snapshot box: none. */
export const ALPINE_LAKES_SPEC: RegionSpec = {
  label: "Alpine Lakes and Stuart Range", data_dir: DATA_DIR, outline_dir: OUTLINE_DATA_DIR,
  files: { osm: "alpine-lakes-glaciers-overpass.json", rgi: "rgi7-wfs-alpine-lakes.json", glims: "glims-wfs-alpine-lakes.json" },
  sha256: {
    osm: "68783a5749c113a4e308e23c291a9f86c20046f1893d540113c278c562d79c74",
    rgi: "b44e64e1480e63b46d72f6fd2f72b4aa7740ac0016b54b7fc73cf2b03d56f430",
    glims: "ffaa087a8e901be261637548150b0d735d282c7b3ba134de326f5f72674a79c6",
  },
  snapshot_date: "2026-07-24",
  roster: {
    "way:575387156": { parent: "mount-stuart", inventory: "Stuart Glacier", container: ALW }, // Stuart Glacier
    "way:575387157": { parent: "mount-stuart", inventory: "Ice Cliff Glacier", container: ALW }, // Ice Cliff Glacier
    "way:575387154": { parent: "sherpa-peak", inventory: "Sherpa Glacier", container: ALW }, // Sherpa Glacier
    "way:201703035": { parent: "colchuck-peak", inventory: "Colchuck Glacier", container: ALW }, // Colchuck Glacier
    "relation:11524603": { parent: "little-annapurna", inventory: "Snow Creek Glacier", container: ALW }, // Snow Creek Glacier
    "relation:13209365": { parent: "mount-hinman", inventory: "Hinman Glacier", container: ALW }, // Hinman Glacier
    "relation:16664543": { parent: "mount-hinman", inventory: null, container: ALW }, // Foss Glacier
    "relation:13209479": { parent: "mount-daniel", inventory: "Lynch Glacier", container: ALW }, // Lynch Glacier
    "relation:13331823": { parent: "chimney-rock", inventory: null, container: ALW }, // Chimney Glacier
    "relation:13331822": { parent: "overcoat-peak", inventory: null, container: ALW }, // Overcoat Glacier
  },
  default_parent: "mount-stuart",
  parents: {
    "mount-stuart": summit("Mount Stuart", 47.4750, -120.9022),
    "sherpa-peak": summit("Sherpa Peak", 47.4717, -120.8886),
    "colchuck-peak": summit("Colchuck Peak", 47.4782, -120.8464),
    "little-annapurna": summit("Little Annapurna", 47.4683, -120.8143),
    "mount-hinman": summit("Mount Hinman", 47.5688, -121.2146),
    "mount-daniel": summit("Mount Daniel", 47.5626, -121.1719),
    "chimney-rock": summit("Chimney Rock", 47.5090, -121.2858),
    "overcoat-peak": summit("Overcoat Peak", 47.5138, -121.2921),
  },
  container_areas: {
    [ALW]: { kind: "wilderness", name: "Alpine Lakes Wilderness" },
  },
  inventory: {
    cohort: { observed_at: "2015-09-09", submission_id: "814", chief_affl: "Portland State University" },
    rgi_outline_years: "1957–63",
    mountains: {
      "mount-stuart": { label: "Mount Stuart", names: { "Stuart Glacier": 1, "Ice Cliff Glacier": 1 } },
      "sherpa-peak": { label: "Sherpa Peak", names: { "Sherpa Glacier": 1 } },
      "colchuck-peak": { label: "Colchuck Peak", names: { "Colchuck Glacier": 2 } },
      "little-annapurna": { label: "Little Annapurna", names: { "Snow Creek Glacier": 2 } },
      "mount-hinman": { label: "Mount Hinman", names: { "Hinman Glacier": 4 } },
      "mount-daniel": { label: "Mount Daniel", names: { "Lynch Glacier": 1, "Ice Worm Glacier": 1 } },
    },
    /** RGI splits Snow Creek into two rows of equal zmax; the eastern one holds the OSM head. */
    rgi_ids: { "Snow Creek Glacier": "RGI2000-v7.0-G-02-15282" },
    /** Ice Worm Glacier (no OSM polygon) counts at Mount Daniel; RGI 7.0 has no row for it. */
    rgi_absent: ["Ice Worm Glacier"],
  },
  activities: ["outdoor-trek", "ski"],
  country_code: "US", state_code: "WA",
};

export const loadAlpineLakesOsmPackage = () => loadRegionOsmPackage(ALPINE_LAKES_SPEC);
export const loadAlpineLakesOutlineReview = () => loadRegionOutlineReview(ALPINE_LAKES_SPEC);
export const importAlpineLakesGlaciers = (args: string[]) => importRegionGlaciers(ALPINE_LAKES_SPEC, args);
if (require.main === module) importAlpineLakesGlaciers(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
