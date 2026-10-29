import type { GlacierManifestFacts } from "../import-glacier-manifest";
import type { GlacierCandidate } from "./osm";
import { inventoryFacts, inventoryMountainContext, parseInventory, type Inventory, type InventoryConfig } from "./psu-inventory";

export const SNAPSHOT_SHA256 = "908c236267128bfb6a190ba18a7f64d838c7a6db4b2c7953a7f0b31ff4eb18f2";
export const GLIMS_SHA256 = "03e51afd9b5722c848c77e05351195bb29a297dfa34f4b17f3709c9590e43e4d";
export const RGI_SHA256 = "d1de1ab2c836eeb8aa2e241298bc5356757b24f12748a77c28bc2e1090db2669";
/** The mirror's `osm3s.timestamp_osm_base`, not the 2026-10-29 fetch day. */
export const SNAPSHOT_DATE = "2026-06-01";
export const GEOMETRY_CREDIT = "© OpenStreetMap contributors";
export { FACTS_CREDIT, PSU_CREDIT, PSU_URL, RGI_CREDIT, RGI_URL } from "./psu-inventory";

/** Every named glacier of Mount Baker in the 2015 PSU cohort, with its part
 * count. Camp Kiser and Coleman Pinnacle name snow patches by nearby landmarks
 * on Ptarmigan Ridge, not glaciers of the volcano, so they stay out. Bastile
 * Glacier has no OSM polygon: it counts towards "of N" but is not a place. */
export const BAKER_INVENTORY: Record<string, number> = {
  "Bastile Glacier": 1, "Boulder Glacier": 1, "Coleman Glacier": 1, "Deming Glacier": 1, "Easton Glacier": 1,
  "Hadley Glacier": 5, "Mazama Glacier": 3, "No Name Glacier": 5, "Park Glacier": 1, "Rainbow Glacier": 3,
  "Roosevelt Glacier": 1, "Sholes Glacier": 4, "Squak Glacier": 1, "Talum Glaciers": 1, "Thunder Glacier": 2,
};
export const PSU_COHORT = { observed_at: "2015-09-09", submission_id: "814", chief_affl: "Portland State University" };
export const BAKER_INVENTORY_CONFIG: InventoryConfig = { cohort: PSU_COHORT, rgi_outline_years: "1974–75",
  mountains: { "mount-baker": { label: "Mount Baker", names: BAKER_INVENTORY } } };
export type BakerInventory = Inventory;

/** Reads the saved WFS bytes. Fails closed when the 2015 cohort or RGI 7.0
 * lacks a named Baker glacier, or a name's part count changes. */
export const parseBakerInventory = (glimsRaw: unknown, rgiRaw: unknown): Inventory => parseInventory(glimsRaw, rgiRaw, BAKER_INVENTORY_CONFIG);
export const bakerMountainContext = (inv: Inventory) => inventoryMountainContext(inv, BAKER_INVENTORY_CONFIG, "mount-baker");

/** Facts from published inventory attributes only (see psu-inventory.ts).
 * RGI's Mount Baker outlines date from 1974–75 maps with other ice divides
 * (Boulder would show −46% while Park gains), so no history is served. */
export function parseBakerFacts(inv: Inventory, candidates: GlacierCandidate[]): Record<string, GlacierManifestFacts> {
  return Object.fromEntries(candidates.map(c => {
    if (!inv.areas.has(c.name) || !inv.rgi.get(c.name)) throw new Error(`No inventory row for roster place ${c.name}`);
    return [c.name, inventoryFacts(inv, BAKER_INVENTORY_CONFIG, "mount-baker", c, c.name)];
  }));
}
