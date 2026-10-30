import { resolve } from "node:path";
import { importRegionGlaciers, loadRegionOsmPackage, loadRegionOutlineReview, type RegionPlace, type RegionSpec } from "./glaciers/region-builder";

/** Glacier Peak's glaciers: saved OSM, GLIMS (PSU 2015 cohort) and RGI 7.0
 * files; see docs/data-audits/glacier-peak-glaciers-2026-10-29.md. */
export const DATA_DIR = resolve(__dirname, "../data/glaciers-glacier-peak-2026-10-29");
export const OUTLINE_DATA_DIR = resolve(__dirname, "../data/glaciers-glacier-peak-glims-2026-10-29");
const WILDERNESS = "glacier-peak-wilderness";
const place = (inventory: string | null): RegionPlace => ({ parent: "glacier-peak", inventory, container: WILDERNESS });

/** The 16 named OSM glaciers of Glacier Peak, all deep inside Glacier Peak
 * Wilderness (USFS EDW boundary, smallest margin 7.5 km). The snapshot box
 * also holds six Dakobed Range glaciers 8–14 km east (Butterfly, Clark, Moth,
 * Pilz, Richardson, Tenpeak), whose parents are other summits; they wait for
 * the North Cascades package. Gerdine Glacier has no cohort row. */
export const GLACIER_PEAK_SPEC: RegionSpec = {
  label: "Glacier Peak", data_dir: DATA_DIR, outline_dir: OUTLINE_DATA_DIR,
  files: { osm: "glacier-peak-glaciers-overpass.json", rgi: "rgi7-wfs-glacier-peak.json", glims: "glims-wfs-glacier-peak.json" },
  sha256: {
    osm: "79eb769ac96254eb3b292923d8d9406dec1a7f65af856eefd4f716f9baedc5cd",
    rgi: "5ed6a040a49e081cc0d346efa1c1791085813a41b81612699654e65551850e60",
    glims: "dd31135f1fe53607133c46ac3a294a47344ca8b10ec3fb1e218059e594b2b9cb",
  },
  snapshot_date: "2026-07-15",
  roster: {
    "relation:3998942": place("Chocolate Glacier"), "relation:11867912": place("Cool Glacier"),
    "relation:11870906": place("Dusty Glacier"), "relation:11870911": place("Ermine Glacier"),
    "relation:16019635": place(null), "relation:11862973": place("Honeycomb Glacier"),
    "relation:3998943": place("Kennedy Glacier"), "relation:3998950": place("Milk Lake Glacier"),
    "relation:11870907": place("North Guardian Glacier"), "relation:3998944": place("Ptarmigan Glacier"),
    "relation:11868878": place("Scimitar Glacier"), "relation:3998945": place("Sitkum Glacier"),
    "relation:3998948": place("Suiattle Glacier"), "relation:3998949": place("Vista Glacier"),
    "relation:11863065": place("White Chuck Glacier"), "way:300757887": place("White River Glacier"),
  },
  default_parent: "glacier-peak",
  parents: { "glacier-peak": { name: "Glacier Peak", features: ["summit", "volcano"], country_code: "US", state_code: "WA",
    lat: 48.1125, lng: -121.1139, radius_m: 3000 } },
  container_areas: { [WILDERNESS]: { kind: "wilderness", name: "Glacier Peak Wilderness" } },
  inventory: {
    cohort: { observed_at: "2015-09-09", submission_id: "814", chief_affl: "Portland State University" },
    rgi_outline_years: "1984",
    /** Every named cohort glacier of Glacier Peak. East White River (0.075 km²,
     * south of White River Glacier) has no OSM polygon and no RGI row; it
     * counts towards "of 16". Butterfly, Pilz and Richardson are Dakobed. */
    mountains: { "glacier-peak": { label: "Glacier Peak", names: {
      "Chocolate Glacier": 1, "Cool Glacier": 2, "Dusty Glacier": 2, "East White River": 1, "Ermine Glacier": 1,
      "Honeycomb Glacier": 3, "Kennedy Glacier": 1, "Milk Lake Glacier": 1, "North Guardian Glacier": 1,
      "Ptarmigan Glacier": 2, "Scimitar Glacier": 3, "Sitkum Glacier": 4, "Suiattle Glacier": 2, "Vista Glacier": 1,
      "White Chuck Glacier": 5, "White River Glacier": 1,
    } } },
    rgi_ids: { "Milk Lake Glacier": "RGI2000-v7.0-G-02-14041" },
    rgi_absent: ["East White River"],
  },
  activities: ["outdoor-trek", "ski"],
  country_code: "US", state_code: "WA",
  outline_rule: 2,
};

export const loadGlacierPeakOsmPackage = () => loadRegionOsmPackage(GLACIER_PEAK_SPEC);
export const loadGlacierPeakOutlineReview = () => loadRegionOutlineReview(GLACIER_PEAK_SPEC);
export const loadGlacierPeakPackage = () => loadGlacierPeakOutlineReview().manifest;
export const importGlacierPeakGlaciers = (args: string[]) => importRegionGlaciers(GLACIER_PEAK_SPEC, args);
if (require.main === module) importGlacierPeakGlaciers(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
