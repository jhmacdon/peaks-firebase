import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** OSM still maps some glaciers that melted away. The reviewed list lives in
 * data/stale-glacier-outlines.json; code never names a glacier.
 * - gone: the outline is ignored for trail terrain, ice names and places.
 * - remnant: never a glacier; a trail way wholly inside it is a snowfield
 *   named by `remnant_label`. */
export type StaleOutlineStatus = "gone" | "remnant";
export interface StaleOutline {
  osm_id: string; name: string; status: StaleOutlineStatus; remnant_label?: string;
  reason: string; sources: string[]; reviewedAt: string;
}
export const STALE_GLACIER_OUTLINES_PATH = resolve(__dirname, "../../data/stale-glacier-outlines.json");

export function parseStaleOutlines(raw: unknown): Map<string, StaleOutline> {
  const file = raw as { schemaVersion?: unknown; outlines?: unknown };
  if (file?.schemaVersion !== 1 || !Array.isArray(file.outlines)) throw new Error("Stale glacier outlines: expected schemaVersion 1 and an outlines array");
  const byId = new Map<string, StaleOutline>();
  for (const o of file.outlines as StaleOutline[]) {
    const where = `Stale glacier outline ${JSON.stringify(o?.osm_id)}`;
    if (typeof o?.osm_id !== "string" || !/^(?:way|relation)\/[1-9][0-9]*$/.test(o.osm_id)) throw new Error(`${where}: osm_id must look like relation/123 or way/123`);
    if (byId.has(o.osm_id)) throw new Error(`${where}: listed twice`);
    if (typeof o.name !== "string" || !o.name.trim()) throw new Error(`${where}: missing name`);
    if (o.status !== "gone" && o.status !== "remnant") throw new Error(`${where}: status must be gone or remnant`);
    if (o.status === "remnant") {
      const label = o.remnant_label?.trim();
      if (!label) throw new Error(`${where}: a remnant needs remnant_label`);
      // "Swift Glacier" alone would claim a glacier that is not there.
      if (/\bglacier$/i.test(label)) throw new Error(`${where}: remnant_label must not end in "Glacier"`);
    } else if (o.remnant_label !== undefined) throw new Error(`${where}: only a remnant takes remnant_label`);
    if (typeof o.reason !== "string" || !o.reason.trim()) throw new Error(`${where}: missing reason`);
    if (!Array.isArray(o.sources) || !o.sources.length || o.sources.some(s => typeof s !== "string" || !/^https:\/\//.test(s))) throw new Error(`${where}: sources must be https URLs`);
    if (typeof o.reviewedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.reviewedAt)) throw new Error(`${where}: reviewedAt must be YYYY-MM-DD`);
    byId.set(o.osm_id, o);
  }
  return byId;
}

let cached: Map<string, StaleOutline> | null = null;
/** Read once per process. */
export function staleGlacierOutlines(): Map<string, StaleOutline> {
  return cached ??= parseStaleOutlines(JSON.parse(readFileSync(STALE_GLACIER_OUTLINES_PATH, "utf8")));
}

/** Accepts `relation/1`, `relation:1` (place import keys) and OSM URLs. */
export function staleOutline(osmId: string | undefined | null, list = staleGlacierOutlines()): StaleOutline | undefined {
  if (!osmId) return undefined;
  const m = /(way|relation)[/:]([0-9]+)$/.exec(osmId);
  return m ? list.get(`${m[1]}/${m[2]}`) : undefined;
}
