import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseOsmGlaciers } from "./osm";
import { FACTS_CREDIT, PSU_URL, inventoryFacts, inventoryMountainContext, parseInventory, type InventoryConfig } from "./psu-inventory";
import { applyGlacierManifest, manifestSha256, sha256, validateGlacierManifest, type GlacierContainerArea, type GlacierManifest,
  type GlacierParent } from "../import-glacier-manifest";
import { loadOutlineSources, outlineReportMarkdown, refreshGlacierOutlines } from "./outline-refresh";

/** One roster place: an OSM element chosen for this package. */
export type RegionPlace = {
  /** Parent key from `parents`. */
  parent: string;
  /** Cohort glac_name, or null when the cohort has no individual row. */
  inventory: string | null;
  /** Container key from `container_areas`, or null for none. */
  container: string | null;
  aliases?: string[];
  kind?: "glacier" | "snowfield";
};
/** Everything one region package needs. A region is a spec plus saved data;
 * the writer, schema, API and app stay unchanged. */
export type RegionSpec = {
  label: string;
  data_dir: string;
  outline_dir: string;
  files: { osm: string; rgi: string; glims: string };
  sha256: { osm: string; rgi: string; glims: string };
  /** The snapshot's `osm3s.timestamp_osm_base` day, not the fetch day. */
  snapshot_date: string;
  /** Keyed by `osm_key`. Every other named glacier in the snapshot is left out. */
  roster: Record<string, RegionPlace>;
  /** The package `parent` (the default parent key) and any others. */
  default_parent: string;
  parents: Record<string, GlacierParent>;
  container_areas: Record<string, GlacierContainerArea>;
  /** Cohort glaciers per parent key; parents without one get no "of N". */
  inventory: InventoryConfig;
  activities: string[];
};

export function loadRegionOsmPackage(spec: RegionSpec) {
  const read = (dir: string, file: string, hash: string) => {
    const bytes = readFileSync(join(dir, file));
    if (sha256(bytes) !== hash) throw new Error(`Unreviewed snapshot SHA-256: ${file}`);
    return JSON.parse(bytes.toString("utf8"));
  };
  const keys = Object.keys(spec.roster);
  const snowfields = new Set(keys.filter(k => spec.roster[k].kind === "snowfield"));
  const candidates = parseOsmGlaciers(read(spec.data_dir, spec.files.osm, spec.sha256.osm), { roster: keys })
    .map(c => ({ ...c, kind: snowfields.has(c.osm_key) ? "snowfield" as const : "glacier" as const }));
  if (candidates.length !== keys.length || new Set(candidates.map(c => c.name)).size !== keys.length)
    throw new Error(`Expected ${keys.length} uniquely named ${spec.label} places`);
  const inventory = parseInventory(read(spec.outline_dir, spec.files.glims, spec.sha256.glims),
    read(spec.data_dir, spec.files.rgi, spec.sha256.rgi), spec.inventory);
  if (!spec.parents[spec.default_parent]) throw new Error("Unknown default parent");
  const context = (key: string) => spec.inventory.mountains[key] ? inventoryMountainContext(inventory, spec.inventory, key) : {};
  const others = Object.keys(spec.parents).filter(k => k !== spec.default_parent);
  const used = new Set<string>();
  const manifest: GlacierManifest & { glims_sha256: string; rgi_sha256: string } = {
    source_sha256: spec.sha256.osm, glims_sha256: spec.sha256.glims, rgi_sha256: spec.sha256.rgi,
    geometry_observed_at: spec.snapshot_date, geometry_source: "OpenStreetMap", geometry_credit: "© OpenStreetMap contributors",
    geometry_license: "ODbL-1.0", facts_credit: FACTS_CREDIT, facts_source_url: PSU_URL,
    description_source_name: null, description_source_license: null,
    country_code: "US", state_code: "WA", activities: spec.activities,
    parent: spec.parents[spec.default_parent],
    ...(others.length ? { parents: Object.fromEntries(others.map(k => [k, { ...spec.parents[k], mountain_context: context(k) }])) } : {}),
    container_areas: spec.container_areas,
    mountain_context: context(spec.default_parent),
    places: candidates.map(c => {
      const r = spec.roster[c.osm_key];
      if (!spec.parents[r.parent]) throw new Error(`Unknown parent for ${c.name}`);
      if (r.inventory !== null && used.has(r.inventory)) throw new Error(`Inventory glacier on two places: ${r.inventory}`);
      if (r.inventory !== null) used.add(r.inventory);
      if (r.inventory !== null && !(r.inventory in (spec.inventory.mountains[r.parent]?.names ?? {})))
        throw new Error(`${c.name}: ${r.inventory} is not listed under its parent ${r.parent}`);
      const facts = inventoryFacts(inventory, spec.inventory, r.parent, c, r.inventory);
      return { ...c, aliases: r.aliases ?? [], ...(r.parent === spec.default_parent ? {} : { parent_key: r.parent }),
        container_area_key: r.container,
        facts: { ...facts, provenance: { ...facts.provenance, glims_sha256: spec.sha256.glims, rgi_sha256: spec.sha256.rgi } } };
    }),
  };
  validateGlacierManifest(manifest);
  return { ...manifest, manifest_sha256: manifestSha256(manifest) };
}

export function loadRegionOutlineReview(spec: RegionSpec) {
  const { manifest_sha256: _hash, ...osm } = loadRegionOsmPackage(spec);
  const { sources, references, aliases } = loadOutlineSources(join(spec.outline_dir, "outline-sources.json"));
  return refreshGlacierOutlines(osm, sources, references, aliases);
}

/** Dry run by default; the same flags as the Rainier and Baker builders. */
export async function importRegionGlaciers(spec: RegionSpec, args: string[]) {
  const review = args.includes("--osm-only") ? null : loadRegionOutlineReview(spec);
  const pkg = review?.manifest ?? loadRegionOsmPackage(spec);
  const prefix = args.find(a => a.startsWith("--report-prefix="))?.slice("--report-prefix=".length);
  if (prefix && review) {
    writeFileSync(`${prefix}.json`, JSON.stringify(review.report, null, 2) + "\n");
    writeFileSync(`${prefix}.md`, outlineReportMarkdown(review.report));
  }
  const out = args.find(a => a.startsWith("--write-manifest="))?.slice("--write-manifest=".length);
  if (out) { const { manifest_sha256: _hash, ...body } = pkg; writeFileSync(out, JSON.stringify(body)); }
  await applyGlacierManifest(pkg, args);
}
