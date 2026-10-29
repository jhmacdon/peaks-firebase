import { resolve } from "node:path";
import type { GlacierParent } from "./import-glacier-manifest";
import { importRegionGlaciers, loadRegionOsmPackage, loadRegionOutlineReview, type RegionSpec } from "./glaciers/region-builder";

/** Entiat and Chelan Mountains glaciers (Bonanza, North Star, Dark, Maude,
 * Chiwawa), PSU 2017-09-09 cohort: this part of the box is only in that cohort; see
 * docs/data-audits/north-cascades-gpw-alpine-glaciers-2026-10-29.md. */
export const DATA_DIR = resolve(__dirname, "../data/glaciers-entiat-chelan-2026-10-29");
export const OUTLINE_DATA_DIR = resolve(__dirname, "../data/glaciers-entiat-chelan-glims-2026-10-29");
const GPW = "glacier-peak-wilderness";
/** GNIS summit points; parents are the summits each glacier's DEM head lies on. */
const summit = (name: string, lat: number, lng: number): GlacierParent =>
  ({ name, features: ["summit"], country_code: "US", state_code: "WA", lat, lng, radius_m: 1500 });

/** Left out of the snapshot box: Glacier Peak's 16, Chickamin, and the Dakobed and Monte Cristo glaciers (their own 2015-cohort package). */
export const ENTIAT_CHELAN_SPEC: RegionSpec = {
  label: "Entiat and Chelan Mountains", data_dir: DATA_DIR, outline_dir: OUTLINE_DATA_DIR,
  files: { osm: "entiat-chelan-glaciers-overpass.json", rgi: "rgi7-wfs-entiat-chelan.json", glims: "glims-wfs-entiat-chelan.json" },
  sha256: {
    osm: "5a80174e769b67caa5cff3cb101baef4c2e92110801745077e17718811b83a3d",
    rgi: "6bb77ea53ce7217e0721685e98ecf2e48ec4f6c45e696c44cd0b9285e347bc6f",
    glims: "85ce8a2c5c971f5924d6aeb984e84f4a7f4cc0e3784dbae347d630ddec6d2bfc",
  },
  snapshot_date: "2026-07-28",
  roster: {
    "way:1086315498": { parent: "bonanza-peak", inventory: "Company Glacier", container: GPW }, // Company Glacier
    "way:1086315499": { parent: "bonanza-peak", inventory: "Mary Green Glacier", container: GPW }, // Mary Green Glacier
    "way:1086315504": { parent: "bonanza-peak", inventory: "Isella Glacier", container: GPW }, // Isella Glacier
    "way:1086316873": { parent: "north-star-mountain", inventory: "Grant Glacier", container: GPW }, // Grant Glacier
    "relation:14460212": { parent: "dark-peak", inventory: "Dark Glacier", container: GPW }, // Dark Glacier
    "way:360221165": { parent: "mount-maude", inventory: "Entiat Glacier", container: GPW }, // Entiat Glacier
    "relation:12999522": { parent: "chiwawa-mountain", inventory: "Lyman Glacier", container: GPW }, // Lyman Glacier
    "way:966029693": { parent: "chiwawa-mountain", inventory: null, container: GPW }, // Hanging Glacier
    "relation:13005722": { parent: "red-mountain", inventory: "Spider Glacier", container: GPW }, // Spider Glacier
  },
  default_parent: "bonanza-peak",
  parents: {
    "bonanza-peak": summit("Bonanza Peak", 48.2382, -120.8663),
    "north-star-mountain": summit("North Star Mountain", 48.2228, -120.9006),
    "dark-peak": summit("Dark Peak", 48.2546, -120.8818),
    "mount-maude": summit("Mount Maude", 48.1376, -120.8037),
    "chiwawa-mountain": summit("Chiwawa Mountain", 48.1634, -120.9075),
    "red-mountain": summit("Red Mountain", 48.1542, -120.8817),
  },
  container_areas: {
    [GPW]: { kind: "wilderness", name: "Glacier Peak Wilderness" },
  },
  inventory: {
    cohort: { observed_at: "2017-09-09", submission_id: "814", chief_affl: "Portland State University" },
    rgi_outline_years: "1958–84",
    mountains: {
      "bonanza-peak": { label: "Bonanza Peak", names: { "Company Glacier": 3, "Mary Green Glacier": 1, "Isella Glacier": 2 } },
      "north-star-mountain": { label: "North Star Mountain", names: { "Grant Glacier": 1 } },
      "dark-peak": { label: "Dark Peak", names: { "Dark Glacier": 3 } },
      "mount-maude": { label: "Mount Maude", names: { "Entiat Glacier": 4 } },
      "chiwawa-mountain": { label: "Chiwawa Mountain", names: { "Lyman Glacier": 1 } },
      "red-mountain": { label: "Red Mountain", names: { "Spider Glacier": 1 } },
    },
  },
  activities: ["outdoor-trek", "ski"],
};

export const loadEntiatChelanOsmPackage = () => loadRegionOsmPackage(ENTIAT_CHELAN_SPEC);
export const loadEntiatChelanOutlineReview = () => loadRegionOutlineReview(ENTIAT_CHELAN_SPEC);
export const importEntiatChelanGlaciers = (args: string[]) => importRegionGlaciers(ENTIAT_CHELAN_SPEC, args);
if (require.main === module) importEntiatChelanGlaciers(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
