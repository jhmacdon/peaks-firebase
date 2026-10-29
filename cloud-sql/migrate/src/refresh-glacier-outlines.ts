import { writeFileSync } from "node:fs";
import { readGlacierManifest } from "./import-glacier-manifest";
import { loadOutlineSources, outlineReportMarkdown, refreshGlacierOutlines } from "./glaciers/outline-refresh";

/** Offline only: emits a review packet and manifest, with no DB or network mode. */
export function refreshOutlineManifest(args: string[]) {
  const value = (key: string) => args.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
  const input = value("manifest"), config = value("config"), prefix = value("report-prefix");
  if (!input || !config || !prefix) throw new Error("--manifest=OSM.json --config=sources.json --report-prefix=PATH are required");
  const { manifest_sha256: _hash, ...body } = readGlacierManifest(input);
  const { sources, references, aliases } = loadOutlineSources(config);
  const rule = value("outline-rule") ?? "1";
  if (rule !== "1" && rule !== "2") throw new Error("--outline-rule must be 1 or 2");
  const result = refreshGlacierOutlines(body, sources, references, aliases, undefined, { rule: rule === "2" ? 2 : 1 });
  writeFileSync(`${prefix}.json`, JSON.stringify(result.report, null, 2) + "\n");
  writeFileSync(`${prefix}.md`, outlineReportMarkdown(result.report));
  const output = value("write-manifest");
  if (output) { const { manifest_sha256: _ignored, ...manifest } = result.manifest; writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n"); }
  console.log(JSON.stringify({ manifest_sha256: result.manifest.manifest_sha256, report: prefix,
    changed: result.report.decisions.filter(d => d.chosen_source !== "osm").map(d => d.glacier) }, null, 2));
}
if (require.main === module) try { refreshOutlineManifest(process.argv.slice(2)); } catch (e) { console.error(e); process.exitCode = 1; }
