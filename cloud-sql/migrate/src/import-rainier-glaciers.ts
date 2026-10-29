import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseGlaciers, parseRainierFacts, sha256, SNAPSHOT_SHA256, SNAPSHOT_DATE, GEOMETRY_CREDIT, FACTS_CREDIT, REPORT_URL } from "./glaciers/rainier";
import { applyGlacierManifest, manifestSha256, validateGlacierManifest, type GlacierManifest } from "./import-glacier-manifest";
import { loadOutlineSources, outlineReportMarkdown, refreshGlacierOutlines } from "./glaciers/outline-refresh";

/** Builds the Rainier manifest from its saved OSM, NPS report and page files.
 * Everything Rainier-specific stays in this builder and glaciers/rainier.ts;
 * import-glacier-manifest.ts writes any mountain's manifest.
 */
export const DATA_DIR = resolve(__dirname, "../data/glaciers-rainier-2026-10-28");
export const OUTLINE_DATA_DIR = resolve(__dirname, "../data/glaciers-rainier-glims-2026-10-28");
const ALIASES: Record<string, string[]> = { "Inter Glacier": ["Interglacier"] };
export function loadRainierOsmPackage(dir = DATA_DIR) {
  const snapshot = readFileSync(join(dir, "rainier-glaciers-overpass.json"));
  if (sha256(snapshot) !== SNAPSHOT_SHA256) throw new Error("Unreviewed OSM snapshot SHA-256");
  const candidates = parseGlaciers(JSON.parse(snapshot.toString("utf8")));
  if (candidates.length !== 29 || candidates.filter(c => c.kind === "glacier").length !== 28 || new Set(candidates.map(c => c.name)).size !== 29)
    throw new Error("Expected 28 named OSM glaciers and Muir Snowfield");
  const report = readFileSync(join(dir, "nps-beason-2023-report.txt"), "utf8");
  const pages: Record<string, string> = {};
  for (const file of readdirSync(join(dir, "nps-place-pages")).filter(f => f.endsWith(".txt")).sort())
    pages[file.slice(0,-4)] = readFileSync(join(dir,"nps-place-pages",file), "utf8");
  const facts = parseRainierFacts(report, candidates, pages);
  const report_sha256 = sha256(report), pages_sha256 = sha256(JSON.stringify(pages));
  const manifest: GlacierManifest & { report_sha256: string; pages_sha256: string } = {
    source_sha256: SNAPSHOT_SHA256, report_sha256, pages_sha256,
    geometry_observed_at: SNAPSHOT_DATE, geometry_source: "OpenStreetMap", geometry_credit: GEOMETRY_CREDIT, geometry_license: "ODbL-1.0",
    facts_credit: FACTS_CREDIT, facts_source_url: REPORT_URL,
    description_source_name: "National Park Service", description_source_license: "U.S. Government work",
    country_code: "US", state_code: "WA", activities: ["outdoor-trek","ski"],
    parent: { name: "Mount Rainier", features: ["summit","volcano"], country_code: "US", state_code: "WA", lat: 46.8523, lng: -121.7603, radius_m: 3000 },
    container_area: { kind: "national_park", name: "Mount Rainier National Park" },
    mountain_context: { observed_year: 2021, named_glacier_count: 28, area_km2: 75.496, area_uncertainty_km2: 4.109,
      history_start_year: 1896, percent_change_since_history_start: -41.6 },
    places: candidates.map(c => ({ ...c, aliases: ALIASES[c.name] ?? [],
      facts: { ...facts[c.name], provenance: { ...facts[c.name].provenance, report_sha256 } } })),
  };
  validateGlacierManifest(manifest);
  return { ...manifest, manifest_sha256: manifestSha256(manifest) };
}

export function loadRainierOutlineReview(dir = DATA_DIR, outlineDir = OUTLINE_DATA_DIR) {
  const { manifest_sha256: _hash, ...osm } = loadRainierOsmPackage(dir);
  const { sources, references, aliases } = loadOutlineSources(join(outlineDir, "outline-sources.json"));
  return refreshGlacierOutlines(osm, sources, references, aliases);
}
export function loadRainierPackage(dir = DATA_DIR, outlineDir = OUTLINE_DATA_DIR) {
  return loadRainierOutlineReview(dir, outlineDir).manifest;
}

/** Dry run by default. `--write-manifest=FILE` saves the reviewed manifest for import-glacier-manifest. */
export async function importRainierGlaciers(args: string[]) {
  const dir = args.find(a => a.startsWith("--data-dir="))?.slice("--data-dir=".length);
  const outlineDir = args.find(a => a.startsWith("--outline-data-dir="))?.slice("--outline-data-dir=".length);
  const review = args.includes("--osm-only") ? null : loadRainierOutlineReview(dir, outlineDir);
  const pkg = review?.manifest ?? loadRainierOsmPackage(dir);
  const prefix = args.find(a => a.startsWith("--report-prefix="))?.slice("--report-prefix=".length);
  if (prefix && review) {
    writeFileSync(`${prefix}.json`, JSON.stringify(review.report, null, 2) + "\n");
    writeFileSync(`${prefix}.md`, outlineReportMarkdown(review.report));
  }
  const out = args.find(a => a.startsWith("--write-manifest="))?.slice("--write-manifest=".length);
  if (out) { const { manifest_sha256: _hash, ...body } = pkg; writeFileSync(out, JSON.stringify(body)); }
  await applyGlacierManifest(pkg, args);
}
if (require.main === module) importRainierGlaciers(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode=1; });
