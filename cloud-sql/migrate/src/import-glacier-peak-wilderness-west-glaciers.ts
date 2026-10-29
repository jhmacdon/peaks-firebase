import { resolve } from "node:path";
import type { GlacierParent } from "./import-glacier-manifest";
import { importRegionGlaciers, loadRegionOsmPackage, loadRegionOutlineReview, type RegionSpec } from "./glaciers/region-builder";

/** Dakobed Range (Clark and Tenpeak mountains) and Monte Cristo (Kyes and
 * Columbia peaks) glaciers, PSU 2015-09-09 cohort; see
 * docs/data-audits/north-cascades-gpw-alpine-glaciers-2026-10-29.md. */
export const DATA_DIR = resolve(__dirname, "../data/glaciers-glacier-peak-wilderness-west-2026-10-29");
export const OUTLINE_DATA_DIR = resolve(__dirname, "../data/glaciers-glacier-peak-wilderness-west-glims-2026-10-29");
const GPW = "glacier-peak-wilderness";
const HMJ = "henry-m-jackson-wilderness";
/** GNIS summit points (Luahna Peak and Neyah Point are not in GNIS: OSM
 * nodes 8826387283 and 8826387492); parents are the summits each glacier's
 * DEM head lies on, checked against the reviewed identities. */
const summit = (name: string, lat: number, lng: number): GlacierParent =>
  ({ name, features: ["summit"], country_code: "US", state_code: "WA", lat, lng, radius_m: 1500 });

/** Left out of the snapshot box: Glacier Peak's 16 (applied package) and Chickamin (north-cascades-south). */
export const GLACIER_PEAK_WILDERNESS_WEST_SPEC: RegionSpec = {
  label: "Glacier Peak Wilderness (Dakobed and Monte Cristo)", data_dir: DATA_DIR, outline_dir: OUTLINE_DATA_DIR,
  files: { osm: "glacier-peak-wilderness-west-glaciers-overpass.json", rgi: "rgi7-wfs-glacier-peak-wilderness-west.json", glims: "glims-wfs-glacier-peak-wilderness-west.json" },
  sha256: {
    osm: "5a80174e769b67caa5cff3cb101baef4c2e92110801745077e17718811b83a3d",
    rgi: "6bb77ea53ce7217e0721685e98ecf2e48ec4f6c45e696c44cd0b9285e347bc6f",
    glims: "85ce8a2c5c971f5924d6aeb984e84f4a7f4cc0e3784dbae347d630ddec6d2bfc",
  },
  snapshot_date: "2026-07-28",
  roster: {
    "relation:12840881": { parent: "clark-mountain", inventory: "Clark Glacier", container: GPW }, // Clark Glacier
    "relation:12840880": { parent: "clark-mountain", inventory: "Richardson Glacier", container: GPW }, // Richardson Glacier
    "relation:12840900": { parent: "luahna-peak", inventory: "Pilz Glacier", container: GPW }, // Pilz Glacier
    "relation:12844798": { parent: "luahna-peak", inventory: "Butterfly Glacier", container: GPW }, // Butterfly Glacier
    "relation:12848893": { parent: "tenpeak-mountain", inventory: null, container: GPW }, // Tenpeak Glaciers
    "relation:16022870": { parent: "neyah-point", inventory: null, container: GPW }, // Moth Glacier (parent inferred)
    "relation:13102186": { parent: "kyes-peak", inventory: null, container: HMJ }, // Pride Glacier
    "relation:13048943": { parent: "columbia-peak", inventory: "Columbia Glacier", container: HMJ }, // Columbia Glacier
  },
  default_parent: "clark-mountain",
  parents: {
    "clark-mountain": summit("Clark Mountain", 48.0501, -120.9685),
    "tenpeak-mountain": summit("Tenpeak Mountain", 48.0772, -121.0343),
    "luahna-peak": summit("Luahna Peak", 48.0606, -120.9849),
    "neyah-point": summit("Neyah Point", 48.0779, -121.0237),
    "kyes-peak": summit("Kyes Peak", 47.9647, -121.3337),
    "columbia-peak": summit("Columbia Peak", 47.9616, -121.3614),
  },
  container_areas: {
    [GPW]: { kind: "wilderness", name: "Glacier Peak Wilderness" },
    [HMJ]: { kind: "wilderness", name: "Henry M. Jackson Wilderness" },
  },
  inventory: {
    cohort: { observed_at: "2015-09-09", submission_id: "814", chief_affl: "Portland State University" },
    rgi_outline_years: "1958–84",
    mountains: {
      "clark-mountain": { label: "Clark Mountain", names: { "Clark Glacier": 1, "Richardson Glacier": 2 } },
      "luahna-peak": { label: "Luahna Peak", names: { "Pilz Glacier": 3, "Butterfly Glacier": 4 } },
      "columbia-peak": { label: "Columbia Peak", names: { "Columbia Glacier": 1 } },
    },
  },
  activities: ["outdoor-trek", "ski"],
  country_code: "US", state_code: "WA",
};

export const loadGlacierPeakWildernessWestOsmPackage = () => loadRegionOsmPackage(GLACIER_PEAK_WILDERNESS_WEST_SPEC);
export const loadGlacierPeakWildernessWestOutlineReview = () => loadRegionOutlineReview(GLACIER_PEAK_WILDERNESS_WEST_SPEC);
export const importGlacierPeakWildernessWestGlaciers = (args: string[]) => importRegionGlaciers(GLACIER_PEAK_WILDERNESS_WEST_SPEC, args);
if (require.main === module) importGlacierPeakWildernessWestGlaciers(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
