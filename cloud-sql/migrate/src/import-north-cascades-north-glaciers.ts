import { resolve } from "node:path";
import type { GlacierParent } from "./import-glacier-manifest";
import { importRegionGlaciers, loadRegionOsmPackage, loadRegionOutlineReview, type RegionSpec } from "./glaciers/region-builder";

/** North Cascades, north: Shuksan, the Pickets, Spickard, Redoubt, Jack and
 * Crater mountains, Bacon Peak, Ruth and Icy, Colonial, Table Mountain and the
 * Twin Sisters. Saved OSM, GLIMS (PSU 2015-09-09) and RGI 7.0 files; see
 * docs/data-audits/north-cascades-north-glaciers-2026-10-29.md. */
export const DATA_DIR = resolve(__dirname, "../data/glaciers-north-cascades-north-2026-10-29");
export const OUTLINE_DATA_DIR = resolve(__dirname, "../data/glaciers-north-cascades-north-glims-2026-10-29");
const PARK = "north-cascades-np", PASAYTEN = "pasayten-wilderness";
/** GNIS summit points; parents are the summits each glacier's DEM head lies
 * on (Copernicus GLO-30, analysis only). */
const summit = (name: string, lat: number, lng: number, radius_m = 1500): GlacierParent =>
  ({ name, features: ["summit"], country_code: "US", state_code: "WA", lat, lng, radius_m });

/** 23 of the 25 named OSM glaciers outside the Baker package (whose 14
 * share this box). Held back: "Noisy Creek Glacier" (relation:15353262) and
 * "Green Lake Glacier" (relation:15353766) — the inventory's Noisy Creek lies
 * 91% on OSM's Green Lake polygon and GNIS names neither, so no source settles
 * the names. Neve Glacier also reaches this box; it belongs to the south
 * package, whose GLIMS snapshot holds all three of its parts. */
export const NORTH_CASCADES_NORTH_SPEC: RegionSpec = {
  label: "North Cascades (north)", data_dir: DATA_DIR, outline_dir: OUTLINE_DATA_DIR,
  files: { osm: "north-cascades-north-glaciers-overpass.json", rgi: "rgi7-wfs-north-cascades-north.json",
    glims: "glims-wfs-north-cascades-north.json" },
  sha256: {
    osm: "8749a8cde314c09a38dbdba319f713a9d33d3403181faa49f30f130136d7ba0c",
    rgi: "5ec768cbde193052c92f85da9d66427345f259856bed61290b4b6306c5011a4e",
    glims: "33ecc358a0d58bfbb7a65b4fc3a61ef3a4ab76b028c22390c1319dd17866a02e",
  },
  snapshot_date: "2026-06-01",
  roster: {
    "relation:4131349": { parent: "shuksan", inventory: "Sulphide Glacier", container: PARK },
    "relation:11638945": { parent: "shuksan", inventory: "Hanging Glacier", container: PARK },
    "relation:11638946": { parent: "shuksan", inventory: "Upper Curtis Glacier", container: PARK },
    "relation:11638951": { parent: "shuksan", inventory: "Crystal Glacier", container: PARK },
    "relation:11638947": { parent: "shuksan", inventory: "Price Glacier", container: PARK },
    "relation:14592703": { parent: "shuksan", inventory: null, container: PARK },
    "relation:11638950": { parent: "shuksan", inventory: "East Nooksack Glacier", container: PARK },
    "way:848700210": { parent: "shuksan", inventory: "West Nooksack Glacier", container: PARK },
    "relation:11643322": { parent: "shuksan", inventory: "White Salmon Glacier", container: null },
    "relation:11638944": { parent: "shuksan", inventory: "Lower Curtis Glacier", container: null },
    "way:1280723679": { parent: "ruth", inventory: null, container: null },
    "relation:11643324": { parent: "icy", inventory: null, container: PARK },
    "way:296776769": { parent: "redoubt", inventory: "Redoubt Glacier", container: PARK },
    "relation:14569903": { parent: "spickard", inventory: "Silver Glacier", container: PARK },
    "way:372063596": { parent: "challenger", inventory: "Challenger Glacier", container: PARK },
    "way:372063600": { parent: "whatcom", inventory: "Whatcom Glacier", container: PARK },
    "way:372063599": { parent: "degenhardt", inventory: "Terror Glacier", container: PARK },
    "way:184105839": { parent: "jack", inventory: "Nohokomeen Glacier", container: PASAYTEN },
    "relation:14488217": { parent: "crater", inventory: "Jerry Glacier", container: PASAYTEN },
    "relation:2468999": { parent: "bacon", inventory: null, container: PARK },
    "relation:8052701": { parent: "colonial", inventory: "Colonial Glacier", container: PARK },
    "way:303268527": { parent: "table", inventory: null, container: null },
    "way:427944613": { parent: "twin-sisters", inventory: null, container: null },
  },
  default_parent: "shuksan",
  parents: {
    shuksan: summit("Mount Shuksan", 48.8311, -121.6030, 3000), ruth: summit("Ruth Mountain", 48.8600, -121.5328),
    icy: summit("Icy Peak", 48.8364, -121.5281), redoubt: summit("Mount Redoubt", 48.9578, -121.3010),
    spickard: summit("Mount Spickard", 48.9695, -121.2405), challenger: summit("Mount Challenger", 48.8364, -121.3421),
    whatcom: summit("Whatcom Peak", 48.8576, -121.3742), degenhardt: summit("Mount Degenhardt", 48.7715, -121.2946),
    jack: summit("Jack Mountain", 48.7728, -120.9565), crater: summit("Crater Mountain", 48.7391, -120.9202),
    bacon: summit("Bacon Peak", 48.6641, -121.5192), colonial: summit("Colonial Peak", 48.6615, -121.1221),
    table: summit("Table Mountain", 48.8480, -121.7133), "twin-sisters": summit("South Twin", 48.7049, -121.9876),
  },
  container_areas: {
    [PARK]: { kind: "national_park", name: "North Cascades National Park" },
    [PASAYTEN]: { kind: "wilderness", name: "Pasayten Wilderness" },
  },
  inventory: {
    cohort: { observed_at: "2015-09-09", submission_id: "814", chief_affl: "Portland State University" },
    rgi_outline_years: "1958–85",
    /** Cohort names ending in Glacier(s) per parent. Landmark-named patches
     * (Mount Watson East, West Sulphide) and "Watson Glacier WA" are not counted. */
    mountains: {
      shuksan: { label: "Mount Shuksan", names: { "Sulphide Glacier": 1, "Hanging Glacier": 2, "Upper Curtis Glacier": 1,
        "Crystal Glacier": 1, "Price Glacier": 4, "East Nooksack Glacier": 5, "West Nooksack Glacier": 1,
        "White Salmon Glacier": 2, "Lower Curtis Glacier": 1 } },
      redoubt: { label: "Mount Redoubt", names: { "Redoubt Glacier": 2 } },
      spickard: { label: "Mount Spickard", names: { "Silver Glacier": 1 } },
      challenger: { label: "Mount Challenger", names: { "Challenger Glacier": 1 } },
      whatcom: { label: "Whatcom Peak", names: { "Whatcom Glacier": 1 } },
      degenhardt: { label: "Mount Degenhardt", names: { "Terror Glacier": 1 } },
      jack: { label: "Jack Mountain", names: { "Nohokomeen Glacier": 2 } },
      crater: { label: "Crater Mountain", names: { "Jerry Glacier": 2 } },
      /** Noisy Creek (on OSM's "Green Lake" polygon) counts here; neither OSM place is imported. */
      bacon: { label: "Bacon Peak", names: { "Noisy Creek Glacier": 1 } },
      colonial: { label: "Colonial Peak", names: { "Colonial Glacier": 1 } },
    },
  },
  activities: ["outdoor-trek", "ski"],
};

export const loadNorthCascadesNorthOsmPackage = () => loadRegionOsmPackage(NORTH_CASCADES_NORTH_SPEC);
export const loadNorthCascadesNorthOutlineReview = () => loadRegionOutlineReview(NORTH_CASCADES_NORTH_SPEC);
export const importNorthCascadesNorthGlaciers = (args: string[]) => importRegionGlaciers(NORTH_CASCADES_NORTH_SPEC, args);
if (require.main === module) importNorthCascadesNorthGlaciers(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
