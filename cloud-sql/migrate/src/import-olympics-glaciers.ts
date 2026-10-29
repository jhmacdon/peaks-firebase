import { resolve } from "node:path";
import type { GlacierParent } from "./import-glacier-manifest";
import { importRegionGlaciers, loadRegionOsmPackage, loadRegionOutlineReview, type RegionSpec } from "./glaciers/region-builder";

/** Olympic Mountains glaciers: saved OSM, GLIMS (PSU 2015 cohort) and RGI 7.0
 * files; see docs/data-audits/olympics-glaciers-2026-10-29.md. */
export const DATA_DIR = resolve(__dirname, "../data/glaciers-olympics-2026-10-29");
export const OUTLINE_DATA_DIR = resolve(__dirname, "../data/glaciers-olympics-glims-2026-10-29");
const PARK = "olympic-national-park";
const summit = (name: string, lat: number, lng: number): GlacierParent =>
  ({ name, features: ["summit"], country_code: "US", state_code: "WA", lat, lng, radius_m: 1500 });

/** 12 of the 14 named OSM glaciers; all inside Olympic National Park (NPS
 * boundary, smallest margin 8 km). OSM's "Fairchild" polygon
 * (relation:13754230) holds the GNIS Carrie Glacier point and the inventory's
 * "Carrie Glacier" rows, so it is imported as Carrie Glacier. Left out:
 * White Glacier (relation:18773387, an inner ring shares two edges with the
 * outer ring: invalid geometry) and way:1027283192 (OSM "Carrie"; the
 * inventory's "Carrie Glacier WA"; unidentified: the GNIS Fairchild Glacier
 * point lies in no OSM polygon). Parents are the
 * summits each glacier's DEM head lies on (Copernicus GLO-30, analysis only);
 * Olympus' Middle and East peaks count as Mount Olympus. */
export const OLYMPICS_SPEC: RegionSpec = {
  label: "Olympic Mountains", data_dir: DATA_DIR, outline_dir: OUTLINE_DATA_DIR,
  files: { osm: "olympics-glaciers-overpass.json", rgi: "rgi7-wfs-olympics.json", glims: "glims-wfs-olympics.json" },
  sha256: {
    osm: "71d883509500fe4d61741290b68f5e84db522c36ab8ece1d7c8db2b24bf7814c",
    rgi: "e2f822e96aee484857ffaf687c374cccbfaa19f7cc3fa41e720e6457ea0f1e0e",
    glims: "da7180a719b166e591262d3485ef49e8bcc6101560befb614b733bffaf1834b8",
  },
  snapshot_date: "2026-07-15",
  roster: {
    "relation:16150627": { parent: "mount-olympus", inventory: "Blue Glacier", container: PARK },
    "way:371943495": { parent: "mount-olympus", inventory: "Hoh Glacier", container: PARK },
    "way:371943496": { parent: "mount-olympus", inventory: "Hubert Glacier", container: PARK },
    "way:371943497": { parent: "mount-olympus", inventory: "Humes Glacier", container: PARK },
    "way:371943498": { parent: "mount-olympus", inventory: "Ice River Glacier", container: PARK },
    "way:371943499": { parent: "mount-olympus", inventory: "Jeffers Glacier", container: PARK },
    "way:371943500": { parent: "mount-queets", inventory: "Queets Glacier", container: PARK },
    "way:1287314978": { parent: "mount-anderson", inventory: "Anderson Glacier", container: PARK },
    "way:1093654800": { parent: "mount-anderson", inventory: "Eel Glacier", container: PARK },
    "way:1093657603": { parent: "mount-anderson", inventory: "Hanging Glacier", container: PARK },
    "relation:14569855": { parent: "mount-cameron", inventory: "Cameron Glaciers", container: PARK, aliases: ["Cameron Glacier"] },
    "relation:13754230": { parent: "mount-carrie", inventory: "Carrie Glacier", container: PARK,
      label: { name: "Carrie Glacier", method: "GNIS Carrie Glacier (1531450, 47.89103,-123.63640) lies inside this polygon; "
        + "the GNIS Fairchild Glacier point (1529151) lies in no OSM polygon; PSU 2015 \"Carrie Glacier\" rows lie 79–80% inside it" } },
  },
  default_parent: "mount-olympus",
  parents: {
    "mount-olympus": { ...summit("Mount Olympus", 47.8013, -123.7106), radius_m: 3000 },
    "mount-queets": summit("Mount Queets", 47.7623, -123.5950),
    "mount-anderson": summit("Mount Anderson", 47.7212, -123.3315),
    "mount-cameron": summit("Mount Cameron", 47.8254, -123.3285),
    "mount-carrie": summit("Mount Carrie", 47.8942, -123.6491),
  },
  container_areas: { [PARK]: { kind: "national_park", name: "Olympic National Park" } },
  inventory: {
    cohort: { observed_at: "2015-09-09", submission_id: "814", chief_affl: "Portland State University" },
    rgi_outline_years: "1985–87",
    /** Named cohort glaciers per parent. White (Mount Tom) and Fairchild have
     * no place in this package; "… WA" names are not counted. */
    mountains: {
      "mount-olympus": { label: "Mount Olympus", names: { "Blue Glacier": 2, "Hoh Glacier": 1, "Hubert Glacier": 1, "Humes Glacier": 1,
        "Ice River Glacier": 1, "Jeffers Glacier": 1 } },
      "mount-queets": { label: "Mount Queets", names: { "Queets Glacier": 1 } },
      "mount-anderson": { label: "Mount Anderson", names: { "Anderson Glacier": 1, "Eel Glacier": 2, "Hanging Glacier": 1 } },
      "mount-cameron": { label: "Mount Cameron", names: { "Cameron Glaciers": 4 } },
      "mount-carrie": { label: "Mount Carrie", names: { "Carrie Glacier": 2 } },
    },
    /** RGI splits Cameron Glaciers into four rows; the highest (zmax 2,124 m) gives the head. */
    rgi_ids: { "Cameron Glaciers": "RGI2000-v7.0-G-02-13848" },
  },
  activities: ["outdoor-trek", "ski"],
  country_code: "US", state_code: "WA",
};

export const loadOlympicsOsmPackage = () => loadRegionOsmPackage(OLYMPICS_SPEC);
export const loadOlympicsOutlineReview = () => loadRegionOutlineReview(OLYMPICS_SPEC);
export const loadOlympicsPackage = () => loadOlympicsOutlineReview().manifest;
export const importOlympicsGlaciers = (args: string[]) => importRegionGlaciers(OLYMPICS_SPEC, args);
if (require.main === module) importOlympicsGlaciers(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
