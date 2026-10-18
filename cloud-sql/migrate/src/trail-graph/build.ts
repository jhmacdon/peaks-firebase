import { mkdir, stat, writeFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { args, option, writeNdjson } from './io';
import { readOsm } from './opl';
import { buildTopology, graphNodes, prune, resolveIdCollisions } from './topology';
import { readFeatures, attachFeatures } from './features';
import { conflate, readAgencies } from './agency';
import { length } from './geo';
import { attachRoadLinks, readRoadAccess } from './road-access';
import { adoptFrozenSegments, readFrozenSegments } from './frozen-segments';
import type { Segment } from './types';
import { parseState, stateConfig, statePaths, type StateCode } from './state';

export async function build(input: string, out: string, stateCode: StateCode = 'WA'): Promise<void> {
  const state = stateConfig(stateCode);
  const started = Date.now(); await mkdir(out, { recursive: true });
  const featureInput = await readFeatures(join(input, 'extract/features.geojsonseq'), state.bbox);
  console.log(`Features: ${featureInput.input} records; ${featureInput.records.length} named features; ${featureInput.glaciers.length} glacier areas`);
  const osmPath = join(input, 'extract/trails.opl'), retrieved = (await stat(osmPath)).mtime.toISOString();
  let osm: Awaited<ReturnType<typeof readOsm>> | null = await readOsm(osmPath, state.bbox); const osmStats = osm.stats;
  const connectorWays = osm.connectors.filter(w => length(w.nodes.map(n => osm!.nodes.get(n)!)) <= 400);
  osmStats.recovered_connector_ways = connectorWays.length;
  osmStats.recovered_connector_length_m = connectorWays.reduce((n, w) => n + length(w.nodes.map(id => osm!.nodes.get(id)!)), 0);
  // Include before topology so source node identity splits the kept trails too.
  const topology = buildTopology([...osm.ways, ...connectorWays], osm.nodes, featureInput.glaciers, retrieved, state.code); osm = null; connectorWays.length = 0;
  console.log(`Topology: ${topology.length} joined segments`);
  const pruned = prune(topology); topology.length = 0;
  console.log(`Pruned: ${pruned.dropped.segments} segments, ${(pruned.dropped.length_m / 1000).toFixed(1)} km; ${pruned.components} components kept`);
  const agencies = await readAgencies(join(input, 'raw/agency'), state.bbox);
  const conflated = conflate(pruned.segments, agencies.lines, featureInput.glaciers); pruned.segments.length = 0; agencies.lines.length = 0;
  console.log('Road access: streaming road vertices and parking areas');
  const access = await readRoadAccess(join(input, 'extract/roads-parking.opl'), conflated.segments);
  const withRoadLinks = attachRoadLinks(conflated.segments, access.links, access.coords, (await stat(join(input, 'extract/roads-parking.opl'))).mtime.toISOString());
  conflated.segments.length = 0;
  for (const segment of withRoadLinks) {
    segment.state_code = state.code;
    segment.id = segment.id.replace(/^(?:wa|or|ca|id)-/, `${state.code.toLowerCase()}-`);
    if (segment.provenance.contains_osm_geometry) segment.provenance.source_url = state.osmSourceUrl;
  }
  const idStats = resolveIdCollisions(withRoadLinks);
  const fixed = adoptFrozenSegments(withRoadLinks, state.code === 'WA' ? await readFrozenSegments(input) : []);
  const segments = fixed.segments;
  const ids = new Set<string>();
  for (const s of segments) { if (ids.has(s.id)) throw new Error(`Duplicate stable segment ID: ${s.id}`); ids.add(s.id); }
  console.log(`Features: snapping to ${segments.length} final segments`);
  const features = attachFeatures(featureInput.records, segments), nodes = graphNodes(segments);
  const summarize = (getKey: (s: Segment) => string) => {
    const result: Record<string, { count: number; length_m: number }> = {};
    for (const s of segments) { const key = getKey(s), row = result[key] ?? { count: 0, length_m: 0 }; row.count++; row.length_m += s.length_m; result[key] = row; } return result;
  };
  const names = new Map<string, number>();
  for (const s of segments) for (const name of s.trail_names) names.set(name, (names.get(name) ?? 0) + s.length_m);
  const stats = { built_at: new Date().toISOString(), state_code: state.code, bbox: state.bbox, input_dir: input, retrieval_time_basis: 'Local source file mtime (upstream retrieval manifests unavailable)',
    segments: segments.length, nodes: nodes.length, geometry_vertices: segments.reduce((n, s) => n + s.coords.length, 0), features: features.length,
    snapped_features: features.filter(f => f.graph_node).length, length_m: segments.reduce((n, s) => n + s.length_m, 0), by_kind: summarize(s => s.kind),
    by_source: summarize(s => s.provenance.source_kind), osm: osmStats, dropped: pruned.dropped, osm_components_kept: pruned.components,
    agency_inputs: agencies.counts, conflation: conflated.stats, stable_id_collisions: idStats, road_access: access.stats, frozen_catalog: fixed.audit,
    top_30_trail_names_by_length: [...names].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([name, length_m]) => ({ name, length_m })),
    elapsed_seconds: (Date.now() - started) / 1000, peak_rss_mib: process.resourceUsage().maxRSS / 1024 };
  // Stage all files before replacing outputs; publish stats.json last.
  const staging = join(out, `.build-${process.pid}`); await mkdir(staging);
  try {
    await writeNdjson(join(staging, 'segments.ndjson'), segments);
    await writeNdjson(join(staging, 'nodes.ndjson'), nodes);
    await writeNdjson(join(staging, 'features.ndjson'), features);
    await writeNdjson(join(staging, 'access.ndjson'), access.points);
    await writeFile(join(staging, 'stats.json'), JSON.stringify(stats, null, 2) + '\n');
    for (const name of ['segments.ndjson', 'nodes.ndjson', 'features.ndjson', 'access.ndjson', 'stats.json']) await rename(join(staging, name), join(out, name));
  } finally { await rm(staging, { recursive: true, force: true }); }
  console.log(JSON.stringify(stats, null, 2));
}
if (require.main === module) {
  const options = args(), state = parseState(option(options, 'state', 'WA')), defaults = statePaths(state);
  build(resolve(option(options, 'input', defaults.input)), resolve(option(options, 'out', defaults.graph)), state).catch(e => { console.error(e); process.exitCode = 1; });
}
