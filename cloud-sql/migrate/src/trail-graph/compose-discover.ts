import { createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { join, resolve } from 'node:path';
import { args, ndjson, option, writeNdjson } from './io';
import { stateConfig, statePaths, parseState, type StateCode } from './state';
import { discover } from './discovery';
import { createDiscoverySolver } from './discovery-solver';
import { loadDiscoveryDestinations, discoverySnapshotPath } from './discovery-destinations';
import { loadExcludedDiscoverySegments, loadRestrictedDiscoverySegments } from './discovery-eligibility';
import { DiscoveryAccess } from './discovery-access';
import { loadRankingContext, popularityThresholds, popularityTier, comparePopularity } from './discovery-ranking';
import { catalogSegment } from './catalog-output';
import { composeDiscovery, DiscoveryDeduper, DiscoveryPieces, discoverySummary, digestValue, routeDistance, routeTitle } from './discovery-catalog';
import { catalogRouteId, compositionHash, finalizeRows } from './compose';
import { haversine } from './geo';
import { placeKey, tokenMatch, trailKey } from './names';
import type { AccessPoint, ComposedRoute, DraftRoute, PeaksDestination, PlaceRef, Seed } from './catalog-types';
import type { NamedFeature, Segment } from './types';

async function readRows<T>(path: string): Promise<T[]> { const rows: T[] = []; for await (const row of ndjson<T>(path)) rows.push(row); return rows; }
const namedPlace = (p: PlaceRef | null | undefined, peaks?: Map<string, PeaksDestination>) => p?.new?.name ?? peaks?.get(p?.peaks_id ?? '')?.name ?? p?.peaks_id ?? '—';
interface DraftReceipt { offset: number; bytes: number; seed_index: number; popularity: number; status: ComposedRoute['status'] }
async function* rankedDrafts(path: string, receipts: DraftReceipt[]): AsyncGenerator<DraftRoute> {
  const file = await open(path, 'r');
  try {
    for (const receipt of receipts.sort(comparePopularity)) {
      const buffer = Buffer.allocUnsafe(receipt.bytes); let read = 0;
      while (read < buffer.length) {
        const next = await file.read(buffer, read, buffer.length - read, receipt.offset + read);
        if (!next.bytesRead) throw new Error('Incomplete discovery draft spool');
        read += next.bytesRead;
      }
      yield JSON.parse(buffer.toString('utf8')) as DraftRoute;
    }
  } finally { await file.close(); }
}
const tableSafe = (s: string) => s.replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
export function countRoute(counts: Record<string, Record<string, number>>, r: ComposedRoute): void {
  for (const key of [`kind:${r.kind}`, `source:${r.discovery_source}`, `shape:${r.shape}`]) { const group = counts[key] ?? {}; group[r.status] = (group[r.status] ?? 0) + 1; counts[key] = group; }
}
export function seedOverlap(seeds: Seed[], rows: ComposedRoute[], features: NamedFeature[] = []) {
  const matched: { seed: string; discovery: string; status: string; method: string }[] = [], missing: string[] = [];
  const nameOnly: { seed: string; discoveries: number }[] = [];
  const keys = (s: string) => trailKey(routeTitle(s.replace(/\s+via\s+.*/i, '')));
  for (const seed of seeds) {
    const names = new Set([seed.name, ...(seed.aliases ?? []), ...(seed.objective ? [seed.objective.name] : [])].map(keys));
    const named = rows.filter(r => {
      const th = r.trailhead?.new;
      if (!th) return false;
      const nameMatch = [r.name, ...(r.aliases ?? []), r.objective?.new?.name ?? ''].some(n => n && names.has(keys(n)));
      return nameMatch;
    });
    const anchors = features.filter(f => f.feature === 'trailhead' && (placeKey(f.name) === placeKey(seed.trailhead.name) || tokenMatch(seed.trailhead.name, f.name)));
    const found = named.filter(r => tokenMatch(seed.trailhead.name, r.trailhead?.new?.name ?? '') || r.route_start && anchors.some(f => haversine(r.route_start!, f.graph_coord ?? [f.lon, f.lat]) <= 150))
      .sort((a, b) => Number(b.status === 'ok') - Number(a.status === 'ok'));
    if (found.length) matched.push({ seed: seed.name, discovery: found[0].name, status: found[0].status, method: 'normalized route/alias/objective match plus named start or mapped seed trailhead within 150 m' });
    else { missing.push(seed.name); if (named.length) nameOnly.push({ seed: seed.name, discoveries: named.length }); }
  }
  return { total: seeds.length, found: matched.length, ok: matched.filter(m => m.status === 'ok').length, name_matches: matched.length + nameOnly.length,
    method: 'Route/alias/objective names plus a compatible named start or mapped seed trailhead within 150 m. This is an approach match, not full geometry equivalence.', matched, name_only: nameOnly, missing };
}
export async function composeDiscover(state: StateCode, graph: string, out: string, input = statePaths(state).input, solverCallLimit?: number): Promise<void> {
  const started = Date.now(); await mkdir(out, { recursive: true });
  const solver = createDiscoverySolver(join(out, 'solver'), { timeLimitSeconds: 10, reuseLimitedAttempts: true, maxNewCalls: solverCallLimit });
  console.log(`${state}: reading graph NDJSON`);
  const segments = await readRows<Segment>(join(graph, 'segments.ndjson'));
  const features = await readRows<NamedFeature>(join(graph, 'features.ndjson'));
  const access = await readRows<AccessPoint>(join(graph, 'access.ndjson'));
  const destinations = await loadDiscoveryDestinations(state, input);
  const resolvedContacts = destinations.graphContacts(features, access);
  const excludedSegmentIds = await loadExcludedDiscoverySegments(input, segments);
  const discoveryAccess = new DiscoveryAccess(access, features, await loadRestrictedDiscoverySegments(input, segments));
  const rankingContext = await loadRankingContext(input, access);
  const byId = new Map(segments.map(s => [s.id, s])), deduper = new DiscoveryDeduper(byId);
  const staging = join(out, `.discover-${process.pid}`); await mkdir(staging);
  const draftsPath = join(staging, 'drafts.ndjson'), stream = createWriteStream(draftsPath), done = finished(stream); done.catch(() => {});
  let candidates = 0, random = 0x5eed, seenOk = 0, draftOffset = 0;
  const draftReceipts: DraftReceipt[] = [];
  const tierCounts: Record<string, number> = {}, topPopular: { name: string; popularity: number; tier: number; length_km: number }[] = [];
  const rawCounts: Record<string, Record<string, number>> = {}, counts: Record<string, Record<string, number>> = {}, reasons: Record<string, number> = {};
  const samples: ComposedRoute[] = [], bad: ComposedRoute[] = [], overlapRows: ComposedRoute[] = [];
  const badReasons = new Set<string>(), qualityDemotions: Record<string, number> = {}, rawQualityDemotions: Record<string, number> = {};
  try {
    for (const candidate of discover({ segments, features, access }, message => console.log(`${state}: ${message}`), { hardGoalSolver: solver.solve, excludedSegmentIds, resolvedContacts })) {
      const names = new Set<string>();
      // Local source names at the start contribute to the popularity score.
      for (const s of candidate.walk.slice(0, 3)) { const segment = byId.get(s.segment_id)!; if (segment.coords.some(p => haversine(p, candidate.trailheadCoord) <= 30)) for (const n of segment.trail_names) names.add(trailKey(n)); }
      const draft = composeDiscovery(candidate, candidates++, state, byId, candidate.junctionNameCount ?? names.size, rankingContext, destinations, discoveryAccess);
      for (const reason of draft.quality_demotions ?? []) rawQualityDemotions[reason] = (rawQualityDemotions[reason] ?? 0) + 1;
      const summary = discoverySummary(draft);
      deduper.consider(summary); countRoute(rawCounts, draft.row);
      const line = JSON.stringify(draft) + '\n', bytes = Buffer.byteLength(line);
      draftReceipts.push({ offset: draftOffset, bytes, seed_index: draft.row.seed_index, popularity: draft.row.popularity ?? 0, status: draft.row.status }); draftOffset += bytes;
      if (!stream.write(line)) await once(stream, 'drain');
      if (candidates % 5000 === 0) console.log(`${state}: ${candidates} candidates, ${deduper.kept.size} retained; RSS ${(process.memoryUsage().rss / 1048576).toFixed(0)} MiB`);
    }
    stream.end(); await done;
    const finalNames = deduper.finalNames();
    const longAlternatives = deduper.longAlternatives();
    const retainedReceipts = draftReceipts.filter(r => deduper.kept.has(r.seed_index));
    for (const receipt of retainedReceipts) if (longAlternatives.has(receipt.seed_index)) receipt.status = 'review';
    const tierThresholds = popularityThresholds(retainedReceipts.filter(r => r.status === 'ok').map(r => r.popularity));
    console.log(`${state}: ${candidates} candidates; collecting shared segment cuts`);
    const pieces = new DiscoveryPieces();
    for (const d of deduper.kept.values()) pieces.add(d.walk);
    pieces.build(byId, state);
    let catalogSegmentsCleaned = 0;
    for (const [id, segment] of pieces.segments) {
      const cleaned = catalogSegment(segment);
      if (cleaned !== segment) catalogSegmentsCleaned++;
      pieces.segments.set(id, cleaned);
    }
    const routes = createWriteStream(join(staging, 'routes.ndjson')), routesDone = finished(routes); routesDone.catch(() => {});
    const places = createWriteStream(join(staging, 'places.ndjson')), placesDone = finished(places); placesDone.catch(() => {});
    const placeIds = new Set<string>(), usedSegments = new Set<string>();
    let retained = 0, ok = 0;
    for await (const draft of rankedDrafts(draftsPath, retainedReceipts)) {
      for (const reason of draft.quality_demotions ?? []) qualityDemotions[reason] = (qualityDemotions[reason] ?? 0) + 1;
      const row = draft.row, finalName = finalNames.get(row.seed_index);
      if (longAlternatives.has(row.seed_index)) { row.status = 'review'; row.reasons.push('a route under half this length reaches the same objective'); }
      if (finalName && finalName !== row.name) { row.aliases = [...new Set([...row.aliases, row.name])]; row.name = finalName; }
      row.tier = popularityTier(row.popularity ?? 0, tierThresholds);
      row.segments = pieces.materialize(draft.walk);
      const consumed = [...new Set(row.segments.map(s => s.id))].map(id => pieces.segments.get(id)!);
      finalizeRows([row], consumed);
      row.route_id = catalogRouteId(row); row.composition_hash = compositionHash(row);
      countRoute(counts, row); retained++;
      for (const r of row.reasons) reasons[r] = (reasons[r] ?? 0) + 1;
      if (row.status === 'ok') {
        tierCounts[row.tier] = (tierCounts[row.tier] ?? 0) + 1;
        if (topPopular.length < 25) topPopular.push({ name: row.name, popularity: row.popularity ?? 0, tier: row.tier, length_km: routeDistance(row) / 1000 });
        ok++; seenOk++; random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        if (samples.length < 30) samples.push(row); else { const i = random % seenOk; if (i < 30) samples[i] = row; }
      } else if (bad.length < 100 && row.reasons.some(reason => !badReasons.has(reason))) { bad.push(row); row.reasons.forEach(reason => badReasons.add(reason)); }
      if (state === 'WA') overlapRows.push({ ...row,
        ...(draft.source_places?.trailhead ? { trailhead: { new: draft.source_places.trailhead } } : {}),
        ...(draft.source_places?.objective ? { objective: { new: draft.source_places.objective } } : {}),
        segment_sources: [], segments: [], waypoints: [] });
      for (const ref of [row.trailhead, row.objective, row.end_trailhead]) if (ref?.new) {
        const id = ref.new.source.osm_id ?? digestValue(ref.new); if (!placeIds.has(id)) { placeIds.add(id); if (!places.write(JSON.stringify({ ...ref.new, id, state_code: state }) + '\n')) await once(places, 'drain'); }
      }
      row.segments.forEach(s => usedSegments.add(s.id));
      if (!routes.write(JSON.stringify(row) + '\n')) await once(routes, 'drain');
    }
    routes.end(); places.end(); await Promise.all([routesDone, placesDone]);
    await writeNdjson(join(staging, 'segments.ndjson'), (function* () { for (const id of [...usedSegments].sort()) yield pieces.segments.get(id); })());
    let overlap: ReturnType<typeof seedOverlap> | null = null;
    if (state === 'WA') {
      let seeds: Seed[] | undefined;
      try { seeds = JSON.parse(await readFile(join(input, 'seed/wa-hike-seed.json'), 'utf8')) as Seed[]; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (seeds) overlap = seedOverlap(seeds, overlapRows, features);
      await writeFile(join(staging, 'seed-overlap.json'), JSON.stringify(overlap ?? { available: false, reason: 'Optional WA seed file absent; discovery does not use seeds.' }, null, 2) + '\n');
    }
    qualityDemotions['a route under half this length reaches the same objective'] = longAlternatives.size;
    const summary = { state, candidates, retained, ok, quality_demotions: qualityDemotions, raw_quality_demotions: rawQualityDemotions, by_kind_status: counts, raw_candidates_by_kind_status: rawCounts, dedupe: deduper.counts, reasons,
      segments: usedSegments.size, places: placeIds.size, catalog_segments_cleaned: catalogSegmentsCleaned,
      peaks_snapshot: discoverySnapshotPath(state, input), destination_resolution: { ...destinations.stats, graph_contacts: resolvedContacts.size }, excluded_motorized_or_highway_segments: excludedSegmentIds.size,
      popularity: { tier_thresholds: tierThresholds, ok_by_tier: tierCounts, min: Math.min(...retainedReceipts.filter(r => r.status === 'ok').map(r => r.popularity), 1), max: Math.max(0, ...retainedReceipts.filter(r => r.status === 'ok').map(r => r.popularity)), distinct_scores: new Set(retainedReceipts.filter(r => r.status === 'ok').map(r => r.popularity)).size, source_files: rankingContext.source_files, top_25: topPopular },
      elapsed_seconds: (Date.now() - started) / 1000, max_rss_mib: process.resourceUsage().maxRSS / 1024,
      solver: solver.stats, solver_call_limit: solverCallLimit ?? null, combined_reported_rss_mib: process.resourceUsage().maxRSS / 1024 + solver.stats.peak_rss_mib,
      rss_measurement_incomplete: solver.stats.hard_timeouts > 0,
      heap_limit_mib: 6144, wa_seed_overlap: overlap && { total: overlap.total, found: overlap.found, ok: overlap.ok, name_matches: overlap.name_matches, method: overlap.method }, samples: samples.slice(0, 10).map(r => ({ name: r.name, length_km: routeDistance(r) / 1000, trailhead: namedPlace(r.trailhead, destinations.byId), objective: namedPlace(r.objective, destinations.byId) })) };
    const report = [`# ${stateConfig(state).name} discovery`, '', `Candidates: ${candidates}. Retained: ${retained}. Ok: ${ok}.`, '',
      `Runtime: ${summary.elapsed_seconds.toFixed(1)} seconds. Peak RSS: ${summary.max_rss_mib.toFixed(1)} MiB.`, '',
      `Optional local solver: ${solver.stats.calls} calls, ${solver.stats.cached} cached results, ${solver.stats.cached_limited} reused advisory limits, ${solver.stats.infeasible} infeasible proofs, ${solver.stats.optimal} optimal paths, ${solver.stats.feasible} feasible paths without a cost-optimality proof. Advisory limits continue the bounded TypeScript search and never prove infeasibility. Every accepted path passes the same quality gates. Reported solver peak RSS: ${solver.stats.peak_rss_mib.toFixed(1)} MiB; parent plus returned-child RSS sum: ${summary.combined_reported_rss_mib.toFixed(1)} MiB. The two peaks may occur at different times.`, '',
      ...(solverCallLimit !== undefined ? [`New native solves capped at ${solverCallLimit}; ${solver.stats.budget_skipped} further calls used the bounded TypeScript fallback. Cached paths and proofs remain eligible. Unresolved walks stay review-only.`, ''] : []),
      ...(summary.rss_measurement_incomplete ? [`${solver.stats.hard_timeouts} hard-killed children could not return final RSS measurements; their peaks are missing from the reported sum.`, ''] : []),
      'Out-and-back NDJSON stores the outbound path and length, as the existing composer does. Tables show full hiking distance. Only ok rows are loadable. Expected length comes from discovered geometry; no independent length check is available.', '',
      'OSM geometry: © OpenStreetMap contributors, Open Data Commons Open Database License (ODbL) 1.0. USFS and NPS lines: public domain, with agency credit retained on each segment. WA State Parks keeps its source credit.', '',
      '| Group | ok | review | failed |', '| --- | ---: | ---: | ---: |', ...Object.entries(counts).map(([key, c]) => `| ${key} | ${c.ok ?? 0} | ${c.review ?? 0} | ${c.failed ?? 0} |`), '',
      ...(overlap ? [`WA seed overlap: ${overlap.found}/${overlap.total} approach matches; ${overlap.ok} matched to ok discoveries. ${overlap.name_matches} have a name match. ${overlap.method}`, 'Full matched and missing lists: seed-overlap.json.', ''] : []),
      '## Loading priority', '', 'Rows are written in descending numeric popularity. Tier 1 is the top score tercile among ok rows, tier 2 the middle, and tier 3 the rest; equal scores keep the same tier. Scores combine source tags and mapped facilities, not measured visits. Paths over 25 km one way receive a length penalty. Source tags unavailable in the local inputs cannot contribute.', '', '| Route | Popularity | Tier | Full km |', '| --- | ---: | ---: | ---: |', ...topPopular.map(r => `| ${tableSafe(r.name)} | ${r.popularity.toFixed(6)} | ${r.tier} | ${r.length_km.toFixed(2)} |`), '',
      '## 30 random ok samples', '', '| Name | Full km | Trailhead | Objective |', '| --- | ---: | --- | --- |', ...samples.map(r => `| ${tableSafe(r.name)} | ${(routeDistance(r) / 1000).toFixed(2)} | ${tableSafe(namedPlace(r.trailhead, destinations.byId))} | ${tableSafe(namedPlace(r.objective, destinations.byId))} |`), '',
      '## Suspect discoveries', '', 'These failed a quality gate; this list is a local rule check, not a map review.', '', ...bad.slice(0, 30).map(r => `- ${r.name}: ${r.reasons.join('; ')}`), '',
      '## Quality demotions', '', 'Counts include each new rule that failed an otherwise ok retained route. A route can fail more than one rule.', '', ...Object.entries(qualityDemotions).map(([reason, n]) => `- ${n}: ${reason}`), '', '## Quality reasons', '', ...Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([reason, n]) => `- ${n}: ${reason}`), '',
      'Objective approaches shorter than 100 m require review. Two-trail lollipops use a cycle basis for each pair of names meeting at a junction; this does not enumerate every possible circuit.', '',
      'Feature coverage depends on the supplied extraction tags. Meadow records missing from the extract cannot be discovered. Local popularity is a score from tags, not a visit count.', ''].join('\n');
    await writeFile(join(staging, 'report.md'), report); await writeFile(join(staging, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    for (const file of ['routes.ndjson', 'segments.ndjson', 'places.ndjson', 'report.md', ...(state === 'WA' ? ['seed-overlap.json'] : []), 'summary.json']) await rename(join(staging, file), join(out, file));
    console.log(JSON.stringify(summary, null, 2));
  } finally { stream.destroy(); await rm(staging, { recursive: true, force: true }); }
}
if (require.main === module) {
  const options = args(); for (const key of options.keys()) if (!['state', 'graph', 'out', 'input', 'solver-call-limit'].includes(key)) throw new Error(`Unknown --${key}`);
  const state = parseState(option(options, 'state', 'WA')), paths = statePaths(state);
  const solverCallLimit = options.has('solver-call-limit') ? Number(option(options, 'solver-call-limit', '')) : undefined;
  if (solverCallLimit !== undefined && (!Number.isSafeInteger(solverCallLimit) || solverCallLimit < 0)) throw new Error('--solver-call-limit must be a nonnegative safe integer');
  composeDiscover(state, resolve(option(options, 'graph', paths.graph)), resolve(option(options, 'out', paths.compose)), resolve(option(options, 'input', paths.input)), solverCallLimit).catch(e => { console.error(e); process.exitCode = 1; });
}
