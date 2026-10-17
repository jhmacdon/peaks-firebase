import { createHash } from 'node:crypto';
import { displayName, assertDisplayName } from './display-names';
import { featureDistance } from './features';
import { hash, haversine, length, unique } from './geo';
import { cleanTrail, normalizeName, trailKey } from './names';
import { repeatedEdgesAllowed } from './compose-validate';
import { alignSummitKind, appendSummitConnector } from './summit-connectors';
import type { DiscoveryDestinations } from './discovery-destinations';
import { refresh } from './topology';
import type { AccessPoint, ComposedRoute, DraftRoute, PlaceRef } from './catalog-types';
import type { DiscoveryCandidate } from './discovery';
import { discoveryName } from './discovery';
import { rankDiscovery, popularityTier, type RankingContext } from './discovery-ranking';
import { cleanDiscoveryName, usableTrailheadName } from './discovery-names';
import type { Coord, NamedFeature, Segment } from './types';
import type { RouteStep } from './router';

export const digestValue = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const routeDistance = (row: Pick<ComposedRoute, 'length_m' | 'shape'>): number => row.length_m * (row.shape === 'out_and_back' ? 2 : 1);
export function routeTitle(value: string): string {
  const name = displayName(value)!; assertDisplayName(name); return name;
}
export function placeRef(place: NamedFeature | AccessPoint, fallback: string, segments: Map<string, Segment>): PlaceRef {
  const isFeature = 'feature' in place, coord: Coord = isFeature ? [place.lon, place.lat] : place.coord;
  const isTrailhead = !isFeature || place.feature === 'trailhead';
  const safeName = isTrailhead ? usableTrailheadName(place) : cleanDiscoveryName(place.name, { kind: 'objective' }).name;
  const official = isFeature && place.feature === 'trailhead' && !place.osm_id.startsWith('graph/') && !!safeName;
  const graphSource = [...segments.values()].find(s => s.kind !== 'road')?.provenance;
  const osm = /^(node|way|relation)\/(\d+)$/.exec(place.osm_id), wayIds = osm?.[1] === 'way' ? [Number(osm[2])] : [];
  const source = osm ? { source_kind: 'openstreetmap', source_url: `https://www.openstreetmap.org/${place.osm_id}`,
    license_name: 'Open Data Commons Open Database License (ODbL) 1.0', license_url: 'https://opendatacommons.org/licenses/odbl/1-0/', attribution: '© OpenStreetMap contributors',
    retrieved_at: graphSource?.retrieved_at ?? '', osm_way_ids: wayIds, osm_way_urls: wayIds.map(id => `https://www.openstreetmap.org/way/${id}`), contains_osm_geometry: wayIds.length > 0 } : graphSource;
  return { new: { name: routeTitle(safeName || fallback), feature: isFeature ? place.feature : 'trailhead', lng: coord[0], lat: coord[1],
    ...(isFeature && place.ele !== undefined ? { ele: place.ele } : {}), ...(isFeature && place.boundary ? { boundary: place.boundary } : {}),
    source: osm ? { kind: 'osm', osm_id: place.osm_id, provenance: source, ...(official ? { official_name: true } : {}), ...(!safeName ? { name_is_fallback: true } : {}) } : { kind: 'graph', node_id: place.osm_id.replace(/^graph\//, ''), provenance: source, ...(!safeName ? { name_is_fallback: true } : {}) } } };
}
export function namedSegment(s: Segment): boolean {
  return s.kind !== 'road' && [...s.trail_names, ...s.relation_names].some(n => !!discoveryName(n));
}
export function popularity(candidate: DiscoveryCandidate, byId: Map<string, Segment>, junctionNames = 0, context?: RankingContext): number {
  return rankDiscovery(candidate, byId, junctionNames, context).popularity;
}
export function composeDiscovery(candidate: DiscoveryCandidate, index: number, state: NonNullable<ComposedRoute['state_code']>, byId: Map<string, Segment>, junctionNames = 0, rankingContext?: RankingContext, destinations?: DiscoveryDestinations): DraftRoute {
  const walk = candidate.walk.map(s => ({ ...s })), total = walk.reduce((n, s) => n + s.length_m, 0);
  const preferred = candidate.preferredNames.map(n => trailKey(discoveryName(n) ?? n));
  const isPreferred = (s: Segment) => namedSegment(s) && (!preferred.length || [...s.trail_names, ...s.relation_names].some(n => preferred.includes(trailKey(discoveryName(n) ?? ''))));
  const preferredM = walk.reduce((n, s) => n + (isPreferred(byId.get(s.segment_id)!) ? s.length_m : 0), 0);
  const road = walk.reduce((n, s) => n + (byId.get(s.segment_id)!.kind === 'road' ? s.length_m : 0), 0);
  const unnamed = walk.reduce((n, s) => n + (namedSegment(byId.get(s.segment_id)!) ? 0 : s.length_m), 0);
  const last = walk.at(-1), end = last ? byId.get(last.segment_id)!.coords[last.end_vertex] : candidate.trailheadCoord;
  const startStep = walk[0], start = startStep ? byId.get(startStep.segment_id)!.coords[startStep.start_vertex] : candidate.trailheadCoord;
  const used = new Map(walk.map(s => [s.segment_id, byId.get(s.segment_id)!]));
  const cleanedTitle = cleanDiscoveryName(candidate.name, { kind: 'route' });
  const sourceNames = [...used.values()].flatMap(s => [...s.trail_names, ...s.relation_names]).filter(n => preferred.includes(trailKey(discoveryName(n) ?? ''))).map(n => cleanDiscoveryName(n, { kind: 'trail' }));
  const objectiveName = cleanDiscoveryName(candidate.objective?.name, { kind: 'objective' });
  const objectiveAliases = [...(candidate.objective?.aliases ?? []), ...(candidate.endTrailhead && 'aliases' in candidate.endTrailhead ? candidate.endTrailhead.aliases ?? [] : [])].flatMap(n => {
    const cleaned = cleanDiscoveryName(n, { kind: 'objective' }); return cleaned.name ? [cleaned.name, ...cleaned.aliases] : [];
  });
  const aliases = unique([...cleanedTitle.aliases, ...sourceNames.flatMap(n => n.aliases), ...objectiveName.aliases, ...objectiveAliases]);
  const flags = unique([...cleanedTitle.flags, ...sourceNames.flatMap(n => n.flags), ...objectiveName.flags]);
  const ranking = rankDiscovery(candidate, byId, junctionNames, rankingContext);
  const row: ComposedRoute = { seed_index: index, state_code: state, discovery_source: candidate.source, discovery_identity: candidate.identity,
    name: routeTitle(cleanedTitle.name ?? candidate.name), aliases, ...(flags.length ? { flags } : {}), kind: candidate.shape === 'loop' ? 'loop' : candidate.shape === 'point_to_point' ? 'traverse' : candidate.objective?.feature === 'summit' ? 'summit' : 'destination',
    region: state, tier: popularityTier(ranking.popularity), trailhead: placeRef(candidate.trailhead, `${candidate.name} Trailhead`, used), objective: candidate.objective ? placeRef(candidate.objective, candidate.objective.name, used) : null,
    ...(candidate.endTrailhead ? { end_trailhead: placeRef(candidate.endTrailhead, 'Trailhead', used) } : {}),
    segments: walk.map(s => ({ id: s.segment_id, direction: s.direction })), length_m: total, shape: candidate.shape, waypoints: [], wta_url: null, requires_permit: null, season: '',
    existing_route_match: null, existing_route_matches: [], name_duplicates: [], status: 'ok', reasons: [...(candidate.reasons ?? [])],
    expected_length_m: total, deviation_fraction: null, preferred_fraction: total ? preferredM / total : 0, road_fraction: total ? road / total : 0,
    approx_roundtrip_mi: (candidate.shape === 'out_and_back' ? total * 2 : total) / 1609.344, route_start: start, route_end: end, segment_sources: [], popularity_score: ranking.popularity, popularity: ranking.popularity, popularity_signals: ranking.signals };
  if (candidate.trailheadEvidence) {
    const evidence = candidate.trailheadEvidence, place = row.trailhead!.new!;
    place.name = `${cleanTrail(row.name).replace(/\s+Trail$/i, '')} Trailhead`;
    place.source = { ...place.source, kind: 'inferred_road_contact', node_id: evidence.node_id, access_name: evidence.access.name, access_gap_m: evidence.gap_m,
      note: 'Named-trail end at a public road or parking contact.' };
    row.notes = [`Inferred trailhead from public road or parking contact, ${evidence.gap_m.toFixed(1)} m from the mapped trail end.`];
  }
  if (!row.objective && row.shape === 'point_to_point' && row.end_trailhead) row.objective = row.end_trailhead;
  if (!row.objective && row.shape === 'out_and_back' && last) {
    const segment = byId.get(last.segment_id)!;
    row.objective = { new: { name: `${row.name} End`, feature: 'landform', lng: end[0], lat: end[1], source: { kind: 'trail_end', node_id: segment.node_ids[last.end_vertex], provenance: segment.provenance, note: 'Mapped named-trail end; no named natural objective.' } } };
  }
  const source_places = destinations?.resolveRow(row);
  const resolvedObjective = destinations?.byId.get(row.objective?.peaks_id ?? '');
  alignSummitKind(row, resolvedObjective);
  const review = (reason: string) => { row.reasons.push(reason); if (row.status === 'ok') row.status = 'review'; };
  if (!cleanedTitle.name) review('route title lacks a usable trail or objective name');
  if (candidate.objective && !objectiveName.name) review('objective name is a road or lacks a useful name');
  if (!walk.length || !(total > 0)) { row.status = 'failed'; row.reasons.push('empty route'); }
  for (let i = 0; i < walk.length; i++) {
    const step = walk[i], s = byId.get(step.segment_id)!;
    if (step.start_vertex < 0 || step.end_vertex < 0 || step.start_vertex >= s.coords.length || step.end_vertex >= s.coords.length || step.start_vertex === step.end_vertex) { row.status = 'failed'; row.reasons.push('invalid source vertex interval'); }
    if (s.frozen_catalog && (Math.min(step.start_vertex, step.end_vertex) > 0 || Math.max(step.start_vertex, step.end_vertex) < s.coords.length - 1)) review('partial frozen catalog geometry');
    if (i) { const prev = walk[i - 1], p = byId.get(prev.segment_id)!;
      if (p.node_ids[prev.end_vertex] !== s.node_ids[step.start_vertex] || haversine(p.coords[prev.end_vertex], s.coords[step.start_vertex]) > .1) { row.status = 'failed'; row.reasons.push('disconnected walk'); }
    }
  }
  if (road / total > .1 + 1e-9) review('road share exceeds 10%');
  if (preferred.length && preferredM / total < .6 - 1e-9) review('preferred-name share below 60%');
  if (candidate.source === 'objective' && unnamed / total > .3 + 1e-9) review('unnamed path or road share exceeds 30%');
  if (candidate.source === 'objective' && total > 15000 + 1e-6) review('objective beyond 15 km one way');
  if (candidate.source === 'objective' && total < 100) review('objective approach shorter than 100 m');
  if (!repeatedEdgesAllowed(row.kind, walk, byId)) review('repeated edges outside a loop stem');
  if (candidate.shape === 'loop' && haversine(start, end) > .1) { row.status = 'failed'; row.reasons.push('open loop'); }
  const th = row.trailhead?.new ?? destinations?.byId.get(row.trailhead?.peaks_id ?? '');
  if (th && 'features' in th && !th.features.includes('trailhead')) review('resolved start destination is not a trailhead');
  if (th && haversine(start, [th.lng, th.lat]) > 125) review('trailhead contact exceeds 125 m');
  if (/\b(?:road|highway|freeway|motorway)\b/i.test(row.name) && !candidate.objective) review('route title names a road');
  if ((candidate.objective?.feature === 'summit' || resolvedObjective?.features.includes('summit')) && walk.length) {
    // Reuse the existing 75 m summit connector and exact 5 m contact rule.
    const original = candidate.objective!;
    const f = resolvedObjective ? { ...original, lon: resolvedObjective.lng, lat: resolvedObjective.lat, name: resolvedObjective.name, boundary: undefined } : original;
    const id = resolvedObjective?.id ?? f.osm_id, originalRef = row.objective;
    row.objective = { peaks_id: id };
    const step = walk.at(-1)!, parent = byId.get(step.segment_id)!, low = Math.min(step.start_vertex, step.end_vertex), high = Math.max(step.start_vertex, step.end_vertex);
    // The shared helper expects whole segments; expose the exact traversed interval.
    byId.set(parent.id, { ...parent, coords: parent.coords.slice(low, high + 1), node_ids: parent.node_ids.slice(low, high + 1) });
    let connector: Segment | null; const kind = row.kind; row.kind = 'summit';
    try { connector = appendSummitConnector(row, byId, { id, name: f.name, features: ['summit'], lng: f.lon, lat: f.lat }); }
    finally { byId.set(parent.id, parent); row.kind = kind; }
    row.objective = originalRef;
    if (connector) {
      if (destinations) destinations.stats.summit_connectors++;
      const oldId = connector.id, stateId = connector.id.replace(/^wa-/, `${state.toLowerCase()}-`);
      connector.id = stateId; byId.delete(oldId); byId.set(stateId, connector);
      row.segments[row.segments.length - 1].id = stateId;
      const parent = byId.get(walk.at(-1)!.segment_id)!, from = parent.node_ids[walk.at(-1)!.end_vertex], forward = connector.node_ids[0] === from;
      walk.push({ segment_id: connector.id, direction: forward ? 'forward' : 'reverse', start_vertex: forward ? 0 : connector.coords.length - 1, end_vertex: forward ? connector.coords.length - 1 : 0, length_m: connector.length_m });
      connector.state_code = state;
    }
    if (featureDistance(row.route_end!, f, true) > 5 + 1e-6) { review('summit end contact exceeds 5 m'); if (destinations) destinations.stats.summit_refused++; }
  } else if (candidate.objective) {
    const original = candidate.objective;
    const f = resolvedObjective && !original.boundary ? { ...original, lon: resolvedObjective.lng, lat: resolvedObjective.lat } : original;
    const limit = ['campsite', 'glacier'].includes(f.feature) ? 35 : 30;
    if (featureDistance(end, f, true) > limit + 1e-6) review(`${f.feature} objective contact exceeds ${limit} m`);
  }
  if (candidate.source === 'objective' && row.length_m > 15000 + 1e-6 && !row.reasons.includes('objective beyond 15 km one way')) review('objective beyond 15 km one way');
  const endTrailhead = row.end_trailhead?.new ?? destinations?.byId.get(row.end_trailhead?.peaks_id ?? '');
  if (row.kind === 'traverse' && (!endTrailhead || ('features' in endTrailhead ? !endTrailhead.features.includes('trailhead') : endTrailhead.feature !== 'trailhead'))) review('traverse requires a real far trailhead');
  if (endTrailhead && row.route_end && haversine(row.route_end, [endTrailhead.lng, endTrailhead.lat]) > 125) review('far trailhead contact exceeds 125 m');
  if (candidate.source === 'objective' && (unnamed + row.length_m - total) / row.length_m > .3 + 1e-9 && !row.reasons.includes('unnamed path or road share exceeds 30%')) review('unnamed path or road share exceeds 30%');
  if (preferred.length && row.preferred_fraction < .6 - 1e-9 && !row.reasons.includes('preferred-name share below 60%')) review('preferred-name share below 60%');
  if (row.reasons.length && row.status === 'ok') row.status = 'review';
  row.approx_roundtrip_mi = routeDistance(row) / 1609.344;
  return { row, walk, ...(source_places ? { source_places } : {}) };
}

export interface DiscoverySummary {
  index: number; name: string; objective: string | null; start: Coord; trailhead: string; walk: RouteStep[]; length: number; quality: number;
  trail?: string; trailheadLabel?: string; endLabel?: string; section?: boolean; realTrailhead?: boolean; loadable?: boolean;
}
export function discoverySummary(draft: DraftRoute): DiscoverySummary {
  const r = draft.row, p = draft.source_places?.objective ?? r.objective?.new, th = draft.source_places?.trailhead ?? r.trailhead?.new;
  const far = draft.source_places?.end_trailhead ?? r.end_trailhead?.new;
  const safeEndpoint = (place: typeof p): string | undefined => place && place.source.kind !== 'trail_end' && !place.source.name_is_fallback
    ? cleanDiscoveryName(place.name, { kind: place.feature === 'trailhead' ? 'trailhead' : 'objective', officialTrailhead: place.source.official_name }).name ?? undefined : undefined;
  return { index: r.seed_index, name: r.name, objective: r.objective?.peaks_id ?? (p ? p.source.osm_id ?? (p.source.node_id ? `graph/${p.source.node_id}` : `${normalizeName(p.name)}:${p.lng.toFixed(5)},${p.lat.toFixed(5)}`) : null),
    start: r.route_start!, trailhead: th?.source.osm_id ?? (th?.source.node_id ? `graph/${th.source.node_id}` : th?.name ?? ''), walk: draft.walk, length: r.length_m,
    trail: trailKey(r.name.split(/\s+via\s+/i)[1] ?? r.name), endLabel: safeEndpoint(far ?? p),
    section: ['named_trail', 'relation'].includes(r.discovery_source ?? '') && r.shape === 'point_to_point',
    trailheadLabel: th && th.source.kind !== 'inferred_road_contact' && !th.source.name_is_fallback ? cleanDiscoveryName(th.name, { kind: 'trailhead', officialTrailhead: th.source.official_name }).name ?? undefined : undefined,
    realTrailhead: th?.source.official_name === true,
    loadable: r.status === 'ok',
    quality: ({ ok: 1000, review: 100, failed: 0, needs_geometry: 0 })[r.status] + (th?.source.official_name ? 10 : 0) + (r.popularity_score ?? 0) * 5 + r.preferred_fraction - r.road_fraction - Math.min(r.length_m, 1000000) / 10000000 };
}
export function sharedLength(a: DiscoverySummary, b: DiscoverySummary, source?: Map<string, Segment>): number {
  let shared = 0;
  const grouped = new Map<string, RouteStep[]>(); for (const s of b.walk) { const g = grouped.get(s.segment_id) ?? []; g.push(s); grouped.set(s.segment_id, g); }
  for (const s of a.walk) for (const t of grouped.get(s.segment_id) ?? []) {
    const low = Math.max(Math.min(s.start_vertex, s.end_vertex), Math.min(t.start_vertex, t.end_vertex)), high = Math.min(Math.max(s.start_vertex, s.end_vertex), Math.max(t.start_vertex, t.end_vertex));
    if (high > low) shared += source ? length(source.get(s.segment_id)!.coords.slice(low, high + 1)) : s.length_m * (high - low) / Math.max(1, Math.abs(s.end_vertex - s.start_vertex));
  }
  return Math.min(shared, a.length, b.length);
}
/** Stores compact walk manifests; full rows and feature polygons remain on disk. */
export class DiscoveryDeduper {
  constructor(private source?: Map<string, Segment>) {}
  readonly kept = new Map<number, DiscoverySummary>();
  readonly counts: Record<string, number> = {};
  private objectives = new Map<string, Set<number>>();
  private names = new Map<string, Set<number>>();
  private sameTrail(a: DiscoverySummary, b: DiscoverySummary): boolean { return !!a.trail && a.trail === b.trail; }
  private distinguishable(a: DiscoverySummary, b: DiscoverySummary): boolean {
    return a.objective !== null && a.objective === b.objective && this.sameTrail(a, b) && !!a.trailheadLabel && !!b.trailheadLabel
      && normalizeName(a.trailheadLabel) !== normalizeName(b.trailheadLabel);
  }
  distinctTrailheadName(next: DiscoverySummary): boolean {
    return [...(this.names.get(normalizeName(next.name)) ?? [])].some(i => { const r = this.kept.get(i)!; return r.objective !== null && r.objective === next.objective && haversine(r.start, next.start) > .1 ; });
  }
  consider(next: DiscoverySummary): boolean {
    const key = normalizeName(next.name), conflicts = new Set<number>();
    for (const i of this.names.get(key) ?? []) {
      const old = this.kept.get(i)!;
      if (haversine(old.start, next.start) <= 5000 && !this.distinguishable(old, next)
        && !(old.section && next.section && old.trailheadLabel && old.endLabel && next.trailheadLabel && next.endLabel)) conflicts.add(i);
    }
    if (next.objective) for (const i of this.objectives.get(next.objective) ?? []) {
      const old = this.kept.get(i)!;
      const share = sharedLength(old, next, this.source), shorter = Math.min(old.length, next.length);
      // The same named approach remains one hike even when parking contacts
      // differ. Distinct trails keep their separate approaches.
      if (this.sameTrail(old, next) && share >= .6 * shorter - 1e-6
        || (old.trailhead === next.trailhead || haversine(old.start, next.start) <= .1) && share >= .8 * shorter - 1e-6) conflicts.add(i);
    }
    if ([...conflicts].some(i => this.kept.get(i)!.quality >= next.quality)) { this.counts.suppressed = (this.counts.suppressed ?? 0) + 1; return false; }
    for (const i of conflicts) {
      const old = this.kept.get(i)!; this.kept.delete(i); this.names.get(normalizeName(old.name))?.delete(i); if (old.objective) this.objectives.get(old.objective)?.delete(i);
      this.counts.replaced = (this.counts.replaced ?? 0) + 1;
    }
    this.kept.set(next.index, next);
    const names = this.names.get(key) ?? new Set<number>(); names.add(next.index); this.names.set(key, names);
    if (next.objective) { const objectives = this.objectives.get(next.objective) ?? new Set<number>(); objectives.add(next.index); this.objectives.set(next.objective, objectives); }
    return true;
  }
  /** Name supported sections, then enforce one ok display name per state. */
  finalNames(): Map<number, string> {
    const result = new Map<number, string>();
    const groups = new Map<string, DiscoverySummary[]>();
    for (const item of this.kept.values()) {
      const group = groups.get(normalizeName(item.name)) ?? []; group.push(item); groups.set(normalizeName(item.name), group);
    }
    for (const group of groups.values()) for (const item of group) {
      const alternatives = group.filter(other => other.index !== item.index && (item.loadable === false || other.loadable !== false));
      let name = item.name;
      if (alternatives.some(other => this.distinguishable(item, other)) && item.trailheadLabel) name = `${name} from ${item.trailheadLabel}`;
      else if (alternatives.length && item.section && item.trailheadLabel && item.endLabel
        && normalizeName(item.trailheadLabel) !== normalizeName(item.endLabel)) name = `${name}: ${item.trailheadLabel} to ${item.endLabel}`;
      result.set(item.index, name);
    }
    const used = new Map<string, DiscoverySummary>();
    const ordered = [...this.kept.values()].sort((a, b) => b.quality - a.quality || a.index - b.index);
    for (const item of ordered) {
      if (item.loadable === false) continue;
      const key = normalizeName(result.get(item.index)!);
      if (!used.has(key)) { used.set(key, item); continue; }
      this.kept.delete(item.index); result.delete(item.index);
      this.names.get(normalizeName(item.name))?.delete(item.index);
      if (item.objective) this.objectives.get(item.objective)?.delete(item.index);
      this.counts.name_collision_suppressed = (this.counts.name_collision_suppressed ?? 0) + 1;
    }
    return result;
  }
}
export class DiscoveryPieces {
  private cuts = new Map<string, Set<number>>();
  private parts = new Map<string, { low: number; high: number; segment: Segment; forward: boolean }[]>();
  readonly segments = new Map<string, Segment>();
  add(walk: RouteStep[]): void { for (const s of walk) { const cuts = this.cuts.get(s.segment_id) ?? new Set<number>(); cuts.add(s.start_vertex); cuts.add(s.end_vertex); this.cuts.set(s.segment_id, cuts); } }
  build(source: Map<string, Segment>, state: NonNullable<ComposedRoute['state_code']>): void {
    for (const [id, cuts] of this.cuts) {
      const parent = source.get(id)!, sorted = [...cuts].sort((a, b) => a - b), parts: { low: number; high: number; segment: Segment; forward: boolean }[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const low = sorted[i - 1], high = sorted[i];
        let segment = parent;
        if (low || high !== parent.coords.length - 1) {
          segment = refresh({ ...parent, frozen_catalog: undefined, coords: parent.coords.slice(low, high + 1), node_ids: parent.node_ids.slice(low, high + 1), osm_edge_way_ids: parent.osm_edge_way_ids.slice(low, high), source_segment_ids: unique([parent.id, ...(parent.source_segment_ids ?? [])]) });
          segment.id = `${state.toLowerCase()}-span-${hash(JSON.stringify([id, segment.node_ids]))}`;
        }
        segment = { ...segment, state_code: state, name: segment.name ? routeTitle(segment.name) : null,
          trail_names: segment.trail_names.map(routeTitle), relation_names: segment.relation_names.map(routeTitle),
          relations: segment.relations.map(r => ({ ...r, ...(r.name ? { name: routeTitle(r.name) } : {}) })),
          display_name: displayName(segment.display_name ?? segment.trail_names[0] ?? segment.relation_names[0] ?? null) };
        this.segments.set(segment.id, segment); parts.push({ low, high, segment, forward: segment.node_ids[0] === parent.node_ids[low] });
      }
      this.parts.set(id, parts);
    }
  }
  materialize(walk: RouteStep[]): ComposedRoute['segments'] {
    return walk.flatMap(s => { const parts = this.parts.get(s.segment_id)!.filter(p => p.low >= Math.min(s.start_vertex, s.end_vertex) && p.high <= Math.max(s.start_vertex, s.end_vertex));
      if (s.direction === 'reverse') parts.reverse(); return parts.map(p => ({ id: p.segment.id, direction: ((s.direction === 'forward') === p.forward ? 'forward' : 'reverse') as 'forward' | 'reverse' })); });
  }
}
