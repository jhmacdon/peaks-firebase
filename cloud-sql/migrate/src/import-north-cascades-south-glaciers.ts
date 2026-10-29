import { resolve } from "node:path";
import type { GlacierParent } from "./import-glacier-manifest";
import { importRegionGlaciers, loadRegionOsmPackage, loadRegionOutlineReview, type RegionSpec } from "./glaciers/region-builder";

/** North Cascades, south: the national park's south unit, Lake Chelan and the
 * Dome/Chickamin and Snowking groups. Saved OSM, GLIMS (PSU 2015-09-09) and
 * RGI 7.0 files; see docs/data-audits/north-cascades-south-glaciers-2026-10-29.md. */
export const DATA_DIR = resolve(__dirname, "../data/glaciers-north-cascades-south-2026-10-29");
export const OUTLINE_DATA_DIR = resolve(__dirname, "../data/glaciers-north-cascades-south-glims-2026-10-29");
const PARK = "north-cascades-np", GPW = "glacier-peak-wilderness";
/** GNIS summit points; parents are the summits each glacier's DEM head lies
 * on (Copernicus GLO-30, analysis only). */
const summit = (name: string, lat: number, lng: number): GlacierParent =>
  ({ name, features: ["summit"], country_code: "US", state_code: "WA", lat, lng, radius_m: 1500 });

/** All 42 named OSM glaciers in the box. Containers from the NPS and USFS
 * EDW boundaries (50 m margin); Cache (8 m), S and Sandalee (split) and Lyall
 * (outside both) keep none. */
export const NORTH_CASCADES_SOUTH_SPEC: RegionSpec = {
  label: "North Cascades (south)", data_dir: DATA_DIR, outline_dir: OUTLINE_DATA_DIR,
  files: { osm: "north-cascades-south-glaciers-overpass.json", rgi: "rgi7-wfs-north-cascades-south.json",
    glims: "glims-wfs-north-cascades-south.json" },
  sha256: {
    osm: "fb3cf82b72db7f436595fde4e4d521101237d9aca9d920c797cb5706121a2c4a",
    rgi: "ec1beba965eac28f2cea7105d2a0799a05735465eebf39213679805798f64f47",
    glims: "0a5424ceb8e0666b0737a55ce0e25cc9956133bcefa2331f456f733691082284",
  },
  snapshot_date: "2026-06-01",
  roster: {
    "relation:4068766": { parent: "eldorado-peak", inventory: null, container: PARK }, // Backbone Glacier
    "relation:13235737": { parent: "mount-logan", inventory: "Banded Glacier", container: PARK }, // Banded Glacier
    "relation:13215942": { parent: "gunsight-peak", inventory: "Blue Glacier", container: GPW }, // Blue Glacier
    "relation:13238166": { parent: "primus-peak", inventory: "Borealis Glacier", container: PARK }, // Borealis Glacier
    "way:305191555": { parent: "boston-peak", inventory: "Boston Glacier", container: PARK }, // Boston Glacier
    "relation:15579927": { parent: "buckner-mountain", inventory: "Buckner Glacier", container: PARK }, // Buckner Glacier
    "way:1088322971": { parent: "mix-up-peak", inventory: null, container: null }, // Cache Glacier
    "relation:13213215": { parent: "dome-peak", inventory: "Chickamin Glacier", container: GPW }, // Chickamin Glacier
    "relation:13218759": { parent: "dome-peak", inventory: "Dana Glacier", container: GPW }, // Dana Glacier
    "way:563967730": { parent: "boston-peak", inventory: "Davenport Glacier", container: PARK }, // Davenport Glacier
    "way:305205271": { parent: "dome-peak", inventory: "Dome Glacier", container: GPW }, // Dome Glacier
    "relation:13235735": { parent: "mount-logan", inventory: "Douglas Glacier", container: PARK }, // Douglas Glacier
    "relation:8052695": { parent: "eldorado-peak", inventory: "Eldorado Glacier", container: PARK }, // Eldorado Glacier
    "relation:8052666": { parent: "forbidden-peak", inventory: "Forbidden Glacier", container: PARK }, // Forbidden Glacier
    "way:305189538": { parent: "mount-logan", inventory: "Fremont Glacier", container: PARK }, // Fremont Glacier
    "relation:15525556": { parent: "mount-buckindy", inventory: null, container: GPW }, // Goat Creek Glacier
    "relation:14496306": { parent: "goode-mountain", inventory: null, container: PARK }, // Goode Glacier
    "relation:4066857": { parent: "eldorado-peak", inventory: "Inspiration Glacier", container: PARK }, // Inspiration Glacier
    "way:305188569": { parent: "katsuk-peak", inventory: "Katsuk Glacier", container: PARK }, // Katsuk Glacier
    "way:305188593": { parent: "kimtah-peak", inventory: "Kimtah Glacier", container: PARK }, // Kimtah Glacier
    "relation:4068751": { parent: "mount-buckindy", inventory: null, container: GPW }, // Kindy Glacier
    "way:305096148": { parent: "klawatti-peak", inventory: "Klawatti Glacier", container: PARK }, // Klawatti Glacier
    "relation:13218786": { parent: "old-guard-peak", inventory: null, container: GPW }, // Le Conte Glacier
    "way:508039930": { parent: "frisco-mountain", inventory: "Lyall Glacier", container: null }, // Lyall Glacier
    "relation:8052697": { parent: "austera-peak", inventory: "McAllister Glacier", container: PARK }, // McAllister Glacier
    "way:305188585": { parent: "mesahchie-peak", inventory: "Mesahchie Glacier", container: PARK }, // Mesahchie Glacier
    "relation:4068711": { parent: "spider-mountain", inventory: "Middle Cascade Glacier", container: GPW }, // Middle Cascade Glacier
    "relation:15429837": { parent: "snowking-mountain", inventory: null, container: GPW }, // Mutchler Glacier
    "relation:2459944": { parent: "snowfield-peak", inventory: "Neve Glacier", container: PARK }, // Neve Glacier
    "relation:15593331": { parent: "austera-peak", inventory: "North Klawatti Glacier", container: PARK }, // North Klawatti Glacier
    "way:1144528211": { parent: "eldorado-peak", inventory: null, container: PARK }, // Perdition Glacier
    "way:302952419": { parent: "sahale-mountain", inventory: "Quien Sabe Glacier", container: PARK }, // Quien Sabe Glacier
    "relation:14488138": { parent: "hurry-up-peak", inventory: "S Glacier", container: null }, // S Glacier
    "way:373139306": { parent: "sahale-mountain", inventory: "Sahale Glacier", container: PARK }, // Sahale Glacier
    "relation:14488195": { parent: "mcgregor-mountain", inventory: null, container: null }, // Sandalee Glacier
    "relation:13223395": { parent: "snowking-mountain", inventory: null, container: GPW }, // Snowking Glacier
    "relation:15567191": { parent: "lizard-mountain", inventory: null, container: GPW }, // South Cascade Glacier
    "relation:13325689": { parent: "spider-mountain", inventory: "Spider Glacier", container: GPW }, // Spider Glacier
    "way:305203925": { parent: "dome-peak", inventory: "Spire Glacier", container: GPW }, // Spire Glacier
    "relation:9954625": { parent: "buckner-mountain", inventory: "Thunder Glacier", container: PARK }, // Thunder Glacier
    "relation:14496307": { parent: "storm-king", inventory: "Wyeth Glacier", container: PARK }, // Wyeth Glacier
    "relation:14488137": { parent: "magic-mountain", inventory: "Yawning Glacier", container: PARK }, // Yawning Glacier
  },
  default_parent: "eldorado-peak",
  parents: {
    "austera-peak": summit("Austera Peak", 48.5685, -121.1014),
    "boston-peak": summit("Boston Peak", 48.4958, -121.0358),
    "buckner-mountain": summit("Buckner Mountain", 48.4952, -120.9979),
    "dome-peak": summit("Dome Peak", 48.3035, -121.0291),
    "eldorado-peak": summit("Eldorado Peak", 48.5376, -121.1343),
    "forbidden-peak": summit("Forbidden Peak", 48.5117, -121.0584),
    "frisco-mountain": summit("Frisco Mountain", 48.4887, -120.7568),
    "goode-mountain": summit("Goode Mountain", 48.4832, -120.9115),
    "gunsight-peak": summit("Gunsight Peak", 48.3067, -120.9946),
    "hurry-up-peak": summit("Hurry-up Peak", 48.4340, -121.0379),
    "katsuk-peak": summit("Katsuk Peak", 48.5784, -120.8888),
    "kimtah-peak": summit("Kimtah Peak", 48.5850, -120.9106),
    "klawatti-peak": summit("Klawatti Peak", 48.5543, -121.1046),
    "lizard-mountain": summit("Lizard Mountain", 48.3456, -121.0433),
    "magic-mountain": summit("Magic Mountain", 48.4457, -121.0411),
    "mcgregor-mountain": summit("McGregor Mountain", 48.4082, -120.7981),
    "mesahchie-peak": summit("Mesahchie Peak", 48.5785, -120.8804),
    "mix-up-peak": summit("Mix-up Peak", 48.4540, -121.0603),
    "mount-buckindy": summit("Mount Buckindy", 48.3515, -121.2061),
    "mount-logan": summit("Mount Logan", 48.5368, -120.9526),
    "old-guard-peak": summit("Old Guard Peak", 48.3560, -121.0358),
    "primus-peak": summit("Primus Peak", 48.5819, -121.0918),
    "sahale-mountain": summit("Sahale Mountain", 48.4911, -121.0385),
    "snowfield-peak": summit("Snowfield Peak", 48.6353, -121.1387),
    "snowking-mountain": summit("Snowking Mountain", 48.4082, -121.2780),
    "spider-mountain": summit("Spider Mountain", 48.4094, -121.0361),
    "storm-king": summit("Storm King", 48.4912, -120.9303),
  },
  container_areas: {
    [PARK]: { kind: "national_park", name: "North Cascades National Park" },
    [GPW]: { kind: "wilderness", name: "Glacier Peak Wilderness" },
  },
  inventory: {
    cohort: { observed_at: "2015-09-09", submission_id: "814", chief_affl: "Portland State University" },
    rgi_outline_years: "1958–85",
    /** Cohort names ending in Glacier per parent. Lewis and South Glacier have
     * no OSM polygon and count with the nearest parent's glaciers. Goode,
     * Le Conte, Sandalee and South Cascade are only in the 2017-09-09 cohort,
     * which this package does not use (one cohort per region). */
    mountains: {
      "austera-peak": { label: "Austera Peak", names: { "McAllister Glacier": 2, "North Klawatti Glacier": 2 } },
      "boston-peak": { label: "Boston Peak", names: { "Boston Glacier": 1, "Davenport Glacier": 1 } },
      "buckner-mountain": { label: "Buckner Mountain", names: { "Buckner Glacier": 2, "Thunder Glacier": 3 } },
      "dome-peak": { label: "Dome Peak", names: { "Chickamin Glacier": 1, "Dana Glacier": 3, "Dome Glacier": 2, "Spire Glacier": 1 } },
      "eldorado-peak": { label: "Eldorado Peak", names: { "Eldorado Glacier": 1, "Inspiration Glacier": 3 } },
      "forbidden-peak": { label: "Forbidden Peak", names: { "Forbidden Glacier": 2 } },
      "frisco-mountain": { label: "Frisco Mountain", names: { "Lewis Glacier": 1, "Lyall Glacier": 2 } },
      "gunsight-peak": { label: "Gunsight Peak", names: { "Blue Glacier": 1 } },
      "hurry-up-peak": { label: "Hurry-up Peak", names: { "S Glacier": 3, "South Glacier": 1 } },
      "katsuk-peak": { label: "Katsuk Peak", names: { "Katsuk Glacier": 1 } },
      "kimtah-peak": { label: "Kimtah Peak", names: { "Kimtah Glacier": 3 } },
      "klawatti-peak": { label: "Klawatti Peak", names: { "Klawatti Glacier": 1 } },
      "magic-mountain": { label: "Magic Mountain", names: { "Yawning Glacier": 2 } },
      "mesahchie-peak": { label: "Mesahchie Peak", names: { "Mesahchie Glacier": 1 } },
      "mount-logan": { label: "Mount Logan", names: { "Banded Glacier": 1, "Douglas Glacier": 3, "Fremont Glacier": 2 } },
      "primus-peak": { label: "Primus Peak", names: { "Borealis Glacier": 4 } },
      "sahale-mountain": { label: "Sahale Mountain", names: { "Quien Sabe Glacier": 1, "Sahale Glacier": 1 } },
      "snowfield-peak": { label: "Snowfield Peak", names: { "Neve Glacier": 3 } },
      "spider-mountain": { label: "Spider Mountain", names: { "Middle Cascade Glacier": 2, "Spider Glacier": 2 } },
      "storm-king": { label: "Storm King", names: { "Wyeth Glacier": 3 } },
    },
    /** RGI 1958 splits Thunder and Yawning; the highest row gives the head. Banded has no RGI row. */
    rgi_ids: { "Thunder Glacier": "RGI2000-v7.0-G-02-14320", "Yawning Glacier": "RGI2000-v7.0-G-02-14541" },
    rgi_absent: ["Banded Glacier"],
  },
  activities: ["outdoor-trek", "ski"],
};

export const loadNorthCascadesSouthOsmPackage = () => loadRegionOsmPackage(NORTH_CASCADES_SOUTH_SPEC);
export const loadNorthCascadesSouthOutlineReview = () => loadRegionOutlineReview(NORTH_CASCADES_SOUTH_SPEC);
export const importNorthCascadesSouthGlaciers = (args: string[]) => importRegionGlaciers(NORTH_CASCADES_SOUTH_SPEC, args);
if (require.main === module) importNorthCascadesSouthGlaciers(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
