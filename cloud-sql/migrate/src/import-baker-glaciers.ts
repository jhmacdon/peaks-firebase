import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseOsmGlaciers } from "./glaciers/osm";
import { bakerMountainContext, parseBakerFacts, parseBakerInventory, FACTS_CREDIT, GEOMETRY_CREDIT, GLIMS_SHA256, PSU_URL,
  RGI_SHA256, SNAPSHOT_DATE, SNAPSHOT_SHA256 } from "./glaciers/baker";
import { applyGlacierManifest, manifestSha256, sha256, validateGlacierManifest, type GlacierManifest } from "./import-glacier-manifest";
import { loadOutlineSources, outlineReportMarkdown, refreshGlacierOutlines } from "./glaciers/outline-refresh";

/** Builds the Mount Baker manifest from saved OSM, GLIMS and RGI 7.0 files.
 * Everything Baker-specific stays here and in glaciers/baker.ts. */
export const DATA_DIR = resolve(__dirname, "../data/glaciers-baker-2026-10-29");
export const OUTLINE_DATA_DIR = resolve(__dirname, "../data/glaciers-baker-glims-2026-10-29");
/** Glaciers that flow from Mount Baker. The snapshot box also holds Table
 * Mountain Glacier (way:303268527) and Sisters Glacier on the Twin Sisters
 * (way:427944613); they have other parents and wait for the North Cascades
 * package. */
export const ROSTER = ["relation:2439493", "relation:2439502", "relation:4733048", "relation:4773340", "relation:4773341",
  "relation:4773345", "relation:4773346", "relation:4773347", "relation:4777569", "relation:4777570", "relation:4777572",
  "relation:4778054", "relation:5668120", "relation:15310454"];
const ALIASES: Record<string, string[]> = { "Talum Glaciers": ["Talum Glacier"] };
const WILDERNESS = "mount-baker-wilderness";
/** Checked against the USFS EDW wilderness boundary with a 50 m margin, using
 * each place's final outline. Deming, Easton and Squak cross into the Mount
 * Baker National Recreation Area; Talum's outline lies within 50 m of the
 * line. Those keep no container rather than a boundary that may not cover them. */
const CONTAINERS: Record<string, string | null> = {
  "Boulder Glacier": WILDERNESS, "Coleman Glacier": WILDERNESS, "Deming Glacier": null, "Easton Glacier": null,
  "Hadley Glacier": WILDERNESS, "Mazama Glacier": WILDERNESS, "No Name Glacier": WILDERNESS, "Park Glacier": WILDERNESS,
  "Rainbow Glacier": WILDERNESS, "Roosevelt Glacier": WILDERNESS, "Sholes Glacier": WILDERNESS, "Squak Glacier": null,
  "Talum Glaciers": null, "Thunder Glacier": WILDERNESS,
};

export function loadBakerOsmPackage(dir = DATA_DIR, outlineDir = OUTLINE_DATA_DIR) {
  const snapshot = readFileSync(join(dir, "baker-glaciers-overpass.json"));
  if (sha256(snapshot) !== SNAPSHOT_SHA256) throw new Error("Unreviewed OSM snapshot SHA-256");
  const candidates = parseOsmGlaciers(JSON.parse(snapshot.toString("utf8")), { roster: ROSTER });
  if (candidates.length !== 14 || new Set(candidates.map(c => c.name)).size !== 14) throw new Error("Expected 14 named Mount Baker glaciers");
  const glims = readFileSync(join(outlineDir, "glims-wfs-baker.json")), rgi = readFileSync(join(dir, "rgi7-wfs-baker.json"));
  if (sha256(glims) !== GLIMS_SHA256 || sha256(rgi) !== RGI_SHA256) throw new Error("Unreviewed GLIMS/RGI snapshot SHA-256");
  const inventory = parseBakerInventory(JSON.parse(glims.toString("utf8")), JSON.parse(rgi.toString("utf8")));
  const facts = parseBakerFacts(inventory, candidates);
  const manifest: GlacierManifest & { glims_sha256: string; rgi_sha256: string } = {
    source_sha256: SNAPSHOT_SHA256, glims_sha256: GLIMS_SHA256, rgi_sha256: RGI_SHA256,
    geometry_observed_at: SNAPSHOT_DATE, geometry_source: "OpenStreetMap", geometry_credit: GEOMETRY_CREDIT, geometry_license: "ODbL-1.0",
    facts_credit: FACTS_CREDIT, facts_source_url: PSU_URL,
    description_source_name: null, description_source_license: null,
    country_code: "US", state_code: "WA", activities: ["outdoor-trek", "ski"],
    parent: { name: "Mount Baker", features: ["summit", "volcano"], country_code: "US", state_code: "WA", lat: 48.7768, lng: -121.8144, radius_m: 3000 },
    container_areas: { [WILDERNESS]: { kind: "wilderness", name: "Mount Baker Wilderness" } },
    mountain_context: bakerMountainContext(inventory),
    places: candidates.map(c => {
      if (!(c.name in CONTAINERS)) throw new Error(`No container decision for ${c.name}`);
      return { ...c, aliases: ALIASES[c.name] ?? [], container_area_key: CONTAINERS[c.name],
        facts: { ...facts[c.name], provenance: { ...facts[c.name].provenance, glims_sha256: GLIMS_SHA256, rgi_sha256: RGI_SHA256 } } };
    }),
  };
  validateGlacierManifest(manifest);
  return { ...manifest, manifest_sha256: manifestSha256(manifest) };
}

export function loadBakerOutlineReview(dir = DATA_DIR, outlineDir = OUTLINE_DATA_DIR) {
  const { manifest_sha256: _hash, ...osm } = loadBakerOsmPackage(dir, outlineDir);
  const { sources, references, aliases } = loadOutlineSources(join(outlineDir, "outline-sources.json"));
  return refreshGlacierOutlines(osm, sources, references, aliases);
}
export function loadBakerPackage(dir = DATA_DIR, outlineDir = OUTLINE_DATA_DIR) {
  return loadBakerOutlineReview(dir, outlineDir).manifest;
}

/** Dry run by default. `--write-manifest=FILE` saves the reviewed manifest for import-glacier-manifest. */
export async function importBakerGlaciers(args: string[]) {
  const dir = args.find(a => a.startsWith("--data-dir="))?.slice("--data-dir=".length);
  const outlineDir = args.find(a => a.startsWith("--outline-data-dir="))?.slice("--outline-data-dir=".length);
  const review = args.includes("--osm-only") ? null : loadBakerOutlineReview(dir, outlineDir);
  const pkg = review?.manifest ?? loadBakerOsmPackage(dir, outlineDir);
  const prefix = args.find(a => a.startsWith("--report-prefix="))?.slice("--report-prefix=".length);
  if (prefix && review) {
    writeFileSync(`${prefix}.json`, JSON.stringify(review.report, null, 2) + "\n");
    writeFileSync(`${prefix}.md`, outlineReportMarkdown(review.report));
  }
  const out = args.find(a => a.startsWith("--write-manifest="))?.slice("--write-manifest=".length);
  if (out) { const { manifest_sha256: _hash, ...body } = pkg; writeFileSync(out, JSON.stringify(body)); }
  await applyGlacierManifest(pkg, args);
}
if (require.main === module) importBakerGlaciers(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
