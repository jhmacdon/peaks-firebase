import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { union } from "polyclip-ts";
import { manifestSha256, placeGeometry, sha256, validateGlacierManifest, type GlacierGeometryProvenance,
  type GlacierManifest, type GlacierManifestPlace } from "../import-glacier-manifest";
import { outlineMetrics, stableMetric, stabilizeMetrics, type OutlineMetrics, type Outline, type Overlap } from "./outline-geometry";

export type OutlineFeature = { id: string; glacier_id: string; name: string; boundary: Outline };
export type OutlineSource = {
  key: string; geometry_source: string; source_url: string; source_sha256: string;
  observed_at: string; snapshot_at: string; credit: string; license: string; license_url: string;
  license_ok: boolean; submission_id: string; features: OutlineFeature[];
  unnamed_names?: string[];
};
type Metrics = OutlineMetrics;
/** Every ratio in a review is a stable metric, so band decisions and hashes agree across platforms. */
const ratioOf = (area: number, facts: number | null) => facts && facts > 0 ? stableMetric(area / facts) : null;
export type OutlineMatch = {
  place_id: string; name: string; feature_ids: string[]; glacier_ids: string[];
  parts_without_osm_overlap: string[]; boundary: Outline; area_km2: number; overlap: Overlap;
};
export type MatchIssue = { feature_ids: string[]; name: string; reason: string; place_ids?: string[] };
export type SourceMatches = { matches: OutlineMatch[]; unmatched: MatchIssue[]; ambiguous: MatchIssue[]; invalid: MatchIssue[] };
export const normalizeGlacierName = (name: string) => name.toLowerCase().normalize("NFKD").replace(/\bglaciers?\b/g, "")
  .replace(/[^a-z0-9]/g, "");

/** Assemble an inventory's named parts first, then require BOTH the name
 * crosswalk and measured spatial evidence. A single analysis cohort is an
 * input, never a per-glacier mix of observation dates/submissions. */
export function matchOutlineSource(places: GlacierManifestPlace[], source: OutlineSource, metrics: Metrics,
  aliases: Record<string, string[]> = {}, unnamed: string[] = source.unnamed_names ?? [""]): SourceMatches {
  const result: SourceMatches = { matches: [], unmatched: [], ambiguous: [], invalid: [] };
  const groups = new Map<string, OutlineFeature[]>(), seen = new Set<string>();
  for (const f of source.features) {
    if (seen.has(f.id)) throw new Error(`Duplicate outline feature ${f.id}`);
    seen.add(f.id);
    if (unnamed.includes(f.name.trim())) { result.unmatched.push({ feature_ids: [f.id], name: f.name, reason: "Unnamed inventory feature; no name crosswalk" }); continue; }
    const key = normalizeGlacierName(f.name), group = groups.get(key) ?? [];
    group.push(f); groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.id.localeCompare(b.id, "en"));
    const name = group[0].name, feature_ids = group.map(f => f.id);
    const issue = (reason: string) => ({ name, feature_ids, reason });
    let boundary: Outline;
    let area: number;
    try {
      for (const f of group) metrics.validate(f.boundary);
      // Valid source polygons may overlap or share an edge. Dissolve those
      // seams before assembling a valid MultiPolygon; never clip to OSM.
      boundary = { type: "MultiPolygon", coordinates: union(group[0].boundary.coordinates, ...group.slice(1).map(f => f.boundary.coordinates)) };
      area = metrics.area(boundary);
    } catch (e) { result.invalid.push(issue(String(e))); continue; }
    const byName = places.filter(p => [p.name, ...p.aliases, ...(aliases[p.name] ?? [])]
      .some(n => normalizeGlacierName(n) === normalizeGlacierName(name)));
    const spatial = byName.map(p => ({ place: p, overlap: metrics.overlap(p.boundary, boundary) }))
      .filter(m => m.overlap.intersection_km2 > 0 && (m.overlap.iou >= 0.1 || m.overlap.candidate_share >= 0.5));
    if (!spatial.length) { result.unmatched.push(issue(byName.length ? "Name matches but spatial overlap fails (IoU <0.1 and candidate share <0.5)" : "No name/alias crosswalk")); continue; }
    if (spatial.length !== 1) { result.ambiguous.push({ ...issue("Name and overlap match several places"), place_ids: spatial.map(m => m.place.id) }); continue; }
    const { place, overlap } = spatial[0];
    result.matches.push({ place_id: place.id, name, feature_ids, glacier_ids: [...new Set(group.map(f => f.glacier_id))].sort(),
      boundary, area_km2: area, overlap,
      parts_without_osm_overlap: group.filter(f => metrics.overlap(place.boundary, f.boundary).intersection_km2 < 1e-9).map(f => f.id) });
  }
  // Two independently named systems resolving to one place need a reviewed
  // crosswalk; never let iteration order choose one or silently merge them.
  const counts = new Map<string, number>();
  for (const m of result.matches) counts.set(m.place_id, (counts.get(m.place_id) ?? 0) + 1);
  result.matches = result.matches.filter(m => {
    if (counts.get(m.place_id) === 1) return true;
    result.ambiguous.push({ name: m.name, feature_ids: m.feature_ids, place_ids: [m.place_id], reason: "Several named systems match one place" });
    return false;
  });
  return result;
}

export type ExtentEvidence = { observed_at: string; source_key: string; iou: number; candidate_iou: number; basis: string };
export type SelectionCandidate = { key: string; area_km2: number; observed_at: string; license_ok: boolean };
export function chooseOutline(osmArea: number, factsArea: number | null, candidates: SelectionCandidate[], evidence: ExtentEvidence | null) {
  const ratio = ratioOf(osmArea, factsArea);
  if (ratio === null) return { chosen_source: "osm", flagged: true, reason: "No individual facts area; retain OSM for review" };
  if (ratio >= 0.67 && ratio <= 1.5) return { chosen_source: "osm", flagged: false, reason: "OSM/facts ratio is within [0.67, 1.5]" };
  const error = (c: SelectionCandidate) => Math.abs(ratioOf(c.area_km2, factsArea)! - 1);
  const eligible = candidates.filter(c => c.license_ok && evidence && c.observed_at > evidence.observed_at
    && error(c) < Math.abs(ratio - 1))
    .sort((a, b) => b.observed_at.localeCompare(a.observed_at) || error(a) - error(b) || a.key.localeCompare(b.key));
  if (!eligible.length) return { chosen_source: "osm", flagged: true,
    reason: !evidence ? "OSM ratio outside band; no dated evidence that an alternative is newer than its evident extent"
      : "OSM ratio outside band; no licence-OK, newer candidate has a ratio closer to 1" };
  const selected = eligible[0], newRatio = ratioOf(selected.area_km2, factsArea)!;
  return { chosen_source: selected.key, flagged: newRatio < 0.67 || newRatio > 1.5,
    reason: "OSM ratio outside band; newest licence-OK candidate newer than evident OSM extent has a ratio closer to 1" +
      (newRatio < 0.67 || newRatio > 1.5 ? "; selected ratio still outside band" : "") };
}

export type RefreshDecision = {
  id: string; glacier: string; osm_area_km2: number; glims_area_km2: number | null; facts_area_km2: number | null;
  osm_ratio: number | null; glims_ratio: number | null;
  candidates: { source_key: string; area_km2: number; ratio: number | null; observed_at: string; license_ok: boolean; overlap: Overlap;
    feature_ids: string[]; parts_without_osm_overlap: string[] }[];
  extent_evidence: ExtentEvidence | null; chosen_source: string; reason: string; flagged: boolean;
};
export type OutlineRefreshReport = {
  schema_version: 1; rule: string; crs: string; input_manifest_sha256: string; output_manifest_sha256: string;
  sources: { key: string; observed_at: string; submission_id: string; source_sha256: string;
    source_url: string; credit: string; license: string; license_ok: boolean; purpose: string;
    audit: Omit<SourceMatches, "matches"> & { matches: Omit<OutlineMatch, "boundary">[] } }[];
  decisions: RefreshDecision[];
};
/** `rawMetrics` exists for tests; outputs are always rounded to METRIC_DECIMALS. */
export function refreshGlacierOutlines(manifest: GlacierManifest, sources: OutlineSource[], references: OutlineSource[] = [],
  aliases: Record<string, string[]> = {}, rawMetrics: Metrics = outlineMetrics(manifest.parent)) {
  validateGlacierManifest(manifest);
  if (manifest.places.some(p => p.geometry && p.geometry.geometry_source !== manifest.geometry_source))
    throw new Error("Outline refresh requires the original default-source manifest, not an already mixed-source output");
  if (new Set([...sources, ...references].map(s => s.key)).size !== sources.length + references.length || [...sources, ...references].some(s => s.key === "osm"))
    throw new Error("Duplicate/reserved outline source key");
  const metrics = stabilizeMetrics(rawMetrics);
  const audits = [...sources, ...references].map(source => ({ source, audit: matchOutlineSource(manifest.places, source, metrics, aliases) }));
  const report: OutlineRefreshReport = { schema_version: 1,
    rule: "Keep OSM in inclusive [0.67,1.5]; otherwise choose newest licence-OK candidate, closer to facts area and newer than evidenced OSM extent. Historical inference: IoU >=0.3, historical candidate share >=0.5, IoU advantage >=0.1 over newest candidate. Names AND overlap required (IoU >=0.1 OR candidate share >=0.5).",
    crs: metrics.crs, input_manifest_sha256: manifestSha256(manifest), output_manifest_sha256: "",
    sources: audits.map(({ source: s, audit }) => ({ key: s.key, observed_at: s.observed_at, submission_id: s.submission_id,
      source_sha256: s.source_sha256, source_url: s.source_url, credit: s.credit, license: s.license, license_ok: s.license_ok,
      purpose: sources.includes(s) ? "candidate" : "historical_reference",
      audit: { ...audit, matches: audit.matches.map(({ boundary: _boundary, ...match }) => match) } })), decisions: [] };
  const places = manifest.places.map(p => {
    const osmArea = metrics.area(p.boundary), factsArea = p.facts.area_km2;
    const candidates = audits.filter(a => sources.includes(a.source)).flatMap(a => {
      const match = a.audit.matches.find(m => m.place_id === p.id);
      return match ? [{ source: a.source, match }] : [];
    });
    // A geometry edit date never supplies this evidence. A dated older
    // inventory fitting substantially better supplies an explicit inference,
    // kept separate from an actual OSM survey/imagery date (which stays null).
    const newest = candidates.slice().sort((a, b) => b.source.observed_at.localeCompare(a.source.observed_at))[0];
    const old = audits.filter(a => references.includes(a.source)).flatMap(a => {
      const match = a.audit.matches.find(m => m.place_id === p.id);
      return match && newest && a.source.observed_at < newest.source.observed_at && match.overlap.iou >= 0.3 && match.overlap.candidate_share >= 0.5
        && match.overlap.iou >= newest.match.overlap.iou + 0.1 ? [{ source: a.source, match }] : [];
    }).sort((a, b) => b.match.overlap.iou - a.match.overlap.iou)[0];
    const knownOsmDate = placeGeometry(manifest, p).observed_at;
    const evidence: ExtentEvidence | null = knownOsmDate ? { observed_at: knownOsmDate, source_key: "osm",
      iou: 1, candidate_iou: newest?.match.overlap.iou ?? 0, basis: "Verified OSM imagery observation date from per-place provenance" }
      : old ? { observed_at: old.source.observed_at, source_key: old.source.key,
      iou: old.match.overlap.iou, candidate_iou: newest.match.overlap.iou,
      basis: "Inferred older extent: OSM fits the dated historical inventory substantially better than the newer inventory; not a verified OSM observation date" } : null;
    const choice = chooseOutline(osmArea, factsArea, candidates.map(({ source, match }) => ({ key: source.key,
      area_km2: match.area_km2, observed_at: source.observed_at, license_ok: source.license_ok })), evidence);
    const decisionCandidates = candidates.map(({ source, match }) => ({ source_key: source.key, area_km2: match.area_km2,
      ratio: ratioOf(match.area_km2, factsArea), observed_at: source.observed_at, license_ok: source.license_ok,
      overlap: match.overlap, feature_ids: match.feature_ids, parts_without_osm_overlap: match.parts_without_osm_overlap }));
    const glims = candidates.find(c => c.source.geometry_source.startsWith("GLIMS"));
    report.decisions.push({ id: p.id, glacier: p.name, osm_area_km2: osmArea, glims_area_km2: glims?.match.area_km2 ?? null,
      facts_area_km2: factsArea, osm_ratio: ratioOf(osmArea, factsArea), glims_ratio: glims ? ratioOf(glims.match.area_km2, factsArea) : null,
      candidates: decisionCandidates, extent_evidence: evidence, ...choice });
    const selected = candidates.find(c => c.source.key === choice.chosen_source);
    const boundary = selected?.match.boundary ?? p.boundary;
    const geometry: GlacierGeometryProvenance = selected ? {
      schema_version: 1, geometry_source: selected.source.geometry_source, source_url: selected.source.source_url,
      source_sha256: selected.source.source_sha256, observed_at: selected.source.observed_at, snapshot_at: selected.source.snapshot_at,
      credit: selected.source.credit, license: selected.source.license, license_url: selected.source.license_url,
      method: "Independent inventory geometry; named parts dissolved with polyclip-ts 0.16.8, without clipping to OSM",
      geometry_sha256: sha256(JSON.stringify(boundary)), analysis_ids: selected.match.feature_ids,
      glacier_ids: selected.match.glacier_ids, submission_id: selected.source.submission_id,
    } : { ...placeGeometry(manifest, p) };
    geometry.review = { rule_version: 1, chosen_source: choice.chosen_source, flagged: choice.flagged,
      reason: choice.reason, osm_area_km2: osmArea, facts_area_km2: factsArea,
      candidates: decisionCandidates, extent_evidence: evidence };
    return { ...p, boundary, geometry, facts: { ...p.facts, provenance: { ...p.facts.provenance, outline: geometry } } };
  });
  // The review hash uses an empty output_manifest_sha256 to avoid a cycle.
  const refreshed = validateGlacierManifest({ ...manifest, outline_refresh: { schema_version: 1,
    input_manifest_sha256: report.input_manifest_sha256, review_sha256: sha256(JSON.stringify(report)) }, places });
  report.output_manifest_sha256 = manifestSha256(refreshed);
  return { manifest: { ...refreshed, manifest_sha256: report.output_manifest_sha256 }, report };
}

/** Keep raw WFS bytes immutable. Filter the whole packet to one explicit
 * src_date/subm_id cohort before grouping parts; db_area is only metadata. */
export function parseGlimsFeatures(raw: unknown, cohort: { observed_at: string; submission_id: string; chief_affl: string }): OutlineFeature[] {
  const j = raw as { type?: string; features?: { id?: string; geometry: { type: string; coordinates: number[][][] | number[][][][] };
    properties: Record<string, unknown> }[]; numberMatched?: number; numberReturned?: number; totalFeatures?: number };
  if (j?.type !== "FeatureCollection" || !Array.isArray(j.features) || j.numberReturned !== j.features.length
    || (j.numberMatched ?? j.totalFeatures) !== j.features.length) throw new Error("Incomplete GLIMS WFS snapshot");
  const features = j.features.filter(f => f.properties.line_type === "glac_bound" && String(f.properties.src_date).slice(0, 10) === cohort.observed_at
    && String(f.properties.subm_id) === cohort.submission_id && f.properties.chief_affl === cohort.chief_affl).map(f => {
    const p = f.properties;
    if (!["Polygon", "MultiPolygon"].includes(f.geometry?.type) || p.anlys_id == null || !p.glac_id) throw new Error("Invalid GLIMS polygon/identity");
    return { id: String(p.anlys_id), glacier_id: String(p.glac_id), name: String(p.glac_name ?? ""),
      boundary: { type: "MultiPolygon" as const, coordinates: f.geometry.type === "Polygon" ? [f.geometry.coordinates as number[][][]] : f.geometry.coordinates as number[][][][] } };
  });
  if (!features.length) throw new Error("Empty GLIMS analysis cohort");
  // The WFS can return one multi-part analysis as several rows with the same
  // anlys_id. Keep each analysis as one feature with all its polygons, in WFS
  // order; rows that disagree on glacier or name are not one analysis.
  const byId = new Map<string, OutlineFeature>();
  for (const f of features) {
    const seen = byId.get(f.id);
    if (!seen) { byId.set(f.id, f); continue; }
    if (seen.glacier_id !== f.glacier_id || seen.name !== f.name) throw new Error(`Conflicting GLIMS rows for analysis ${f.id}`);
    seen.boundary = { type: "MultiPolygon", coordinates: [...seen.boundary.coordinates, ...f.boundary.coordinates] };
  }
  return [...byId.values()];
}
export type OutlineRefreshConfig = {
  aliases?: Record<string, string[]>;
  /** `expected_features` counts analyses: WFS rows sharing an anlys_id are one feature. */
  sources: (Omit<OutlineSource, "features"> & { file: string; chief_affl: string; purpose: "candidate" | "historical_reference"; expected_features: number })[];
};
export function loadOutlineSources(configPath: string) {
  const config: OutlineRefreshConfig = JSON.parse(readFileSync(configPath, "utf8"));
  const sources: OutlineSource[] = [], references: OutlineSource[] = [];
  for (const entry of config.sources) {
    const bytes = readFileSync(resolve(dirname(configPath), entry.file));
    if (sha256(bytes) !== entry.source_sha256) throw new Error(`Unreviewed outline snapshot SHA-256: ${entry.key}`);
    const features = parseGlimsFeatures(JSON.parse(bytes.toString("utf8")), entry);
    if (features.length !== entry.expected_features) throw new Error(`Unexpected GLIMS cohort count: ${entry.key}`);
    const source: OutlineSource = { ...entry, features };
    if (entry.purpose === "candidate") sources.push(source);
    else if (entry.purpose === "historical_reference") references.push(source);
    else throw new Error("Unknown outline source purpose");
  }
  return { sources, references, aliases: config.aliases ?? {} };
}
export function outlineReportMarkdown(report: OutlineRefreshReport): string {
  const n = (x: number | null) => x === null ? "—" : x.toFixed(3);
  const escape = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const rows = report.decisions.map(d => {
    const c = d.candidates[0];
    return `| ${escape(d.glacier)} | ${n(d.osm_area_km2)} | ${n(d.glims_area_km2)} | ${n(d.facts_area_km2)} | ${n(d.osm_ratio)} | ${n(d.glims_ratio)} | ${n(c?.overlap.iou ?? null)} / ${n(c?.overlap.candidate_share ?? null)} | ${d.chosen_source}${d.flagged ? " ⚑" : ""} | ${escape(d.reason)} |`;
  });
  const audits = report.sources.map(s => `- ${s.key}: ${s.audit.matches.length} matched systems; ${s.audit.unmatched.length} unmatched groups/features; ${s.audit.ambiguous.length} ambiguous; ${s.audit.invalid.length} invalid. Full identities and reasons are in JSON.`);
  return `# Glacier outline decisions\n\n${report.rule}\n\nAreas in km², measured in WGS84 ellipsoidal Lambert equal-area projection. Overlap is IoU / candidate share. ⚑ means review remains due. Historical fits infer extent age; they do not date OSM imagery.\n\nInput manifest: \`${report.input_manifest_sha256}\`\n\nOutput manifest: \`${report.output_manifest_sha256}\`\n\n| Glacier | OSM | GLIMS | Facts | OSM/facts | GLIMS/facts | Overlap | Chosen source | Reason |\n| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |\n${rows.join("\n")}\n\n${audits.join("\n")}\n`;
}
