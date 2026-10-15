import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { args, DEFAULT_INPUT, DEFAULT_OUT, ndjson, option, writeNdjson } from './io';
import { hash, haversine, lineIndex, midpoint, nearest, pointDistance, unique } from './geo';
import { featureDistance, vertexIndex } from './features';
import { accessIndex, resolveAccessTrailhead } from './compose-access';
import { namedOsm, namedPeaks, osmRef, resolveObjective, resolveTrailhead } from './compose-resolve';
import { cleanTrail, distinctiveTokens, featureCompatible, normalizeName, placeKey, tokenMatch, trailKey } from './names';
import { expectedLength, repeatedEdgesAllowed, validateRoute } from './compose-validate';
import { addLoopVia, composeLoop } from './compose-loops';
import { TrailRouter, type RouteStep } from './router';
import { summitApproach } from './summit-approach';
import { RESOLUTION_HINTS } from './resolution-hints';
import { applyCuration, reviewData, type Curation } from './stretches';
import { refresh, provenance } from './topology';
import type { AccessPoint, CatalogInputs, ComposedRoute, DraftRoute, ExistingMatch, PeaksDestination, PeaksRoute, ResolvedPlace, Seed, Waypoint } from './catalog-types';
import type { Coord, NamedFeature, Provenance, Segment } from './types';

export const DEFAULT_COMPOSE = resolve(__dirname, '../../../../.cache/compose');
export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const catalogRouteId = (r: ComposedRoute): string => `wa-catalog-${digest([r.name, r.kind, r.trailhead, r.objective, r.end_trailhead, r.shape, r.segments, r.geometry_hash, r.segment_manifest_hash]).slice(0, 24)}`;
export const segmentManifestHash = (ids: string[], byId: Map<string, Segment>): string => digest(unique(ids).map(id => byId.get(id)));
export class Composer {
  readonly router: TrailRouter;
  readonly byId: Map<string, Segment>;
  private trails = new Map<string, Segment[]>();
  private roads;
  private access;
  private parking;
  constructor(public readonly input: CatalogInputs) {
    this.router = new TrailRouter(input.segments, input.features); this.byId = new Map(input.segments.map(s => [s.id, s]));
    for (const s of input.segments) for (const key of unique([...s.trail_names, ...s.relation_names].map(trailKey))) this.trails.set(key, [...(this.trails.get(key) ?? []), s]);
    this.roads = lineIndex(input.segments.filter(s => s.kind === 'road'));
    this.access = accessIndex(input.access ?? []);
    this.parking = (input.access ?? []).filter(p => p.parking && p.name);
  }
  groups(seed: Seed): Segment[][] { return seed.trails.map(n => {
    const key = trailKey(n);
    if (key === 'ozette coast') return [...(this.trails.get(trailKey('North Coast Beach Travelway')) ?? []), ...(this.trails.get(trailKey('Ozette River to Sand Pt Beach Travelway')) ?? [])];
    return [...new Map([...(this.trails.get(key) ?? []), ...[...this.trails].filter(([k]) => tokenMatch(key, k) && (k.includes(key) || key.includes(k))).flatMap(([, g]) => g)].map(s => [s.id, s])).values()];
  }); }
  private ends(segments: Segment[], deadEndsOnly = false): Coord[] {
    const degree = new Map<string, number>(), coords = new Map<string, Coord>();
    for (const s of segments) for (const i of [0, s.coords.length - 1]) { const id = s.node_ids[i]; degree.set(id, (degree.get(id) ?? 0) + 1); coords.set(id, s.coords[i]); }
    const leaves = [...coords].filter(([id]) => degree.get(id) === 1).map(([, p]) => p);
    return leaves.length || deadEndsOnly ? leaves : [...coords.values()];
  }
  private newTrailhead(seed: Seed, segments: Segment[]): ResolvedPlace | null {
    let best: { p: Coord; id: string; distance: number; segment: Segment } | null = null;
    for (const s of segments) for (const i of [0, s.coords.length - 1]) for (const road of this.roads.near(s.coords[i], 150)) {
      const distance = pointDistance(s.coords[i], road.a, road.b);
      if (distance <= 15 && (!best || distance < best.distance)) best = { p: s.coords[i], id: s.node_ids[i], distance, segment: s };
    }
    if (!best) return null;
    return { ref: { new: { name: seed.trailhead.name, feature: 'trailhead', lng: best.p[0], lat: best.p[1], source: { kind: 'graph', node_id: best.id, provenance: best.segment.provenance } } },
      name: seed.trailhead.name, feature: 'trailhead', coord: best.p, route_coord: best.p, gap_m: 0 };
  }
  private traverseEnd(seed: Seed, ends: Coord[], start: ResolvedPlace): ResolvedPlace | null {
    if (!seed.notes) return null;
    // Restrict to text after the final destination marker. A bare trailhead
    // name elsewhere in notes is not evidence of the far endpoint.
    const notes = normalizeName(seed.notes), marker = notes.lastIndexOf(' to '); if (marker < 0) return null;
    const tail = notes.slice(marker + 4);
    const candidates = [
      ...this.input.destinations.filter(d => d.features.includes('trailhead')).map(d => ({ name: d.name, p: [d.lng, d.lat] as Coord })),
      ...this.input.features.filter(f => f.feature === 'trailhead').map(f => ({ name: f.name, p: [f.lon, f.lat] as Coord })),
    ].filter(c => haversine(c.p, start.coord) > 500 && (` ${tail} `).includes(` ${placeKey(c.name)} `)).sort((a, b) => placeKey(b.name).length - placeKey(a.name).length);
    for (const c of candidates) { const found = resolveTrailhead(c.name, this.input.destinations, this.input.features, ends, this.router.vertices); if (found && haversine(found.coord, start.coord) > 500) return found; }
    return null;
  }
  compose(seed: Seed, seedIndex: number): DraftRoute {
    const row: ComposedRoute = { seed_index: seedIndex, name: seed.name, aliases: seed.aliases ?? [], kind: seed.kind, region: seed.region, tier: seed.tier,
      trailhead: null, objective: null, segments: [], length_m: 0, shape: seed.kind === 'loop' ? 'loop' : seed.kind === 'traverse' ? 'point_to_point' : 'out_and_back', waypoints: [],
      wta_url: seed.wta_url, requires_permit: seed.requires_permit, season: seed.season, existing_route_match: null, existing_route_matches: [], name_duplicates: [],
      status: 'needs_geometry', reasons: [], expected_length_m: expectedLength(seed), deviation_fraction: null, preferred_fraction: 0, road_fraction: 0,
      approx_roundtrip_mi: seed.approx_roundtrip_mi, route_start: null, route_end: null, segment_sources: [] };
    row.name_duplicates = [
      ...this.input.routes.filter(r => placeKey(r.name ?? '') === placeKey(seed.name) || seed.aliases.some(a => placeKey(a) === placeKey(r.name ?? ''))).map(r => ({ type: 'prod' as const, id: r.id, name: r.name })),
      ...this.input.seeds.map((s, i) => ({ s, i })).filter(x => x.i !== seedIndex && normalizeName(x.s.name) === normalizeName(seed.name)).map(x => ({ type: 'seed' as const, id: String(x.i), name: x.s.name })),
    ];
    if (seed.name === 'Olallie Lake via Talapus Lake Trail') row.wta_url = null;
    const hint = RESOLUTION_HINTS[seed.name];
    if (hint) { row.notes = [hint.note]; seed = { ...seed, trailhead: hint.trailhead ? { ...seed.trailhead, name: hint.trailhead } : seed.trailhead, objective: hint.objective ?? seed.objective, trails: hint.trails ?? seed.trails }; }
    const finish = (reason: string) => { row.status = 'needs_geometry'; row.reasons.push(reason); return { row, walk: [] }; };
    let groups = this.groups(seed); const preferences = seed.trails.map(cleanTrail);
    // The seed notes specify the glacier leg, while trails[] omits its name.
    if (/Emmons.Winthrop/i.test(seed.name)) {
      groups.push(this.trails.get(trailKey('Emmons Glacier Route')) ?? []); preferences.push('Emmons Glacier Route');
    }
    const goalHints = seed.objective ? [seed.objective.name, ...seed.aliases].flatMap(n => [...namedPeaks(n, seed.objective!.feature, this.input.destinations).map(d => [d.lng, d.lat] as Coord), ...namedOsm(n, seed.objective!.feature, this.input.features).map(f => [f.lon, f.lat] as Coord)]) : [];
    const objectiveHints = goalHints.filter((p, i) => !goalHints.slice(0, i).some(q => haversine(p, q) < 500));
    const rawHints = [...namedPeaks(seed.trailhead.name, 'trailhead', this.input.destinations).map(d => [d.lng, d.lat] as Coord), ...namedOsm(seed.trailhead.name, 'trailhead', this.input.features).map(f => [f.lon, f.lat] as Coord)].filter(p => (objectiveHints.length !== 1 || haversine(p, objectiveHints[0]) <= Math.max(15000, row.expected_length_m * 3)) && (!groups[0]?.length || groups[0].some(s => s.coords.some(q => haversine(p, q) <= 3000))));
    const hints = rawHints.filter((p, i) => !rawHints.slice(0, i).some(q => haversine(p, q) < 500));
    // A unique known objective also locates a trailhead whose seed name is a
    // visitor centre or campground rather than its mapped trailhead name.
    const inContext = (d: PeaksDestination) => (objectiveHints.length !== 1 || haversine([d.lng, d.lat], objectiveHints[0]) <= Math.max(15000, row.expected_length_m * 3)) && (!groups[0]?.length || groups[0].some(s => s.coords.some(p => haversine([d.lng, d.lat], p) <= 3000)));
    const prefix = this.input.destinations.filter(d => inContext(d) && d.features.includes('trailhead') && placeKey(d.name).length >= 7 && normalizeName(seed.trailhead.name).startsWith(placeKey(d.name) + ' '));
    const exactPlaces = this.input.destinations.filter(d => inContext(d) && placeKey(d.name) === placeKey(seed.trailhead.name));
    const namedPlaces = exactPlaces.length ? exactPlaces : this.input.destinations.filter(d => inContext(d) && d.features.some(f => ['trailhead', 'campsite'].includes(f)) && tokenMatch(seed.trailhead.name, d.name) && tokenMatch(d.name, seed.trailhead.name) && (objectiveHints.length !== 1 || haversine([d.lng, d.lat], objectiveHints[0]) <= Math.max(15000, row.expected_length_m * 3)));
    const accessHints = (this.input.access ?? []).filter(p => p.name && tokenMatch(seed.trailhead.name, p.name) && groups[0]?.some(s => s.coords.some(q => haversine(p.coord, q) <= 3000))).map(p => p.coord);
    const tokenHints = [...this.input.destinations.filter(d => d.features.includes('trailhead') && tokenMatch(seed.trailhead.name, d.name)).map(d => [d.lng, d.lat] as Coord), ...this.input.features.filter(f => f.feature === 'trailhead' && tokenMatch(seed.trailhead.name, f.name)).map(f => [f.lon, f.lat] as Coord), ...accessHints];
    const nearbyTokenHints = tokenHints.filter(p => (objectiveHints.length !== 1 || haversine(p, objectiveHints[0]) <= Math.max(15000, row.expected_length_m * 3)) && groups[0]?.some(s => s.coords.some(q => haversine(p, q) <= 3000)));
    const localHints = nearbyTokenHints.filter((p, i) => !nearbyTokenHints.slice(0, i).some(q => haversine(p, q) < 500));
    const extraAnchor = localHints.length === 1 ? localHints[0] : null;
    const context = hints.length === 1 ? hints[0] : !hints.length && extraAnchor ? extraAnchor : !hints.length && namedPlaces.length === 1 ? [namedPlaces[0].lng, namedPlaces[0].lat] as Coord : !hints.length && objectiveHints.length === 1 ? objectiveHints[0] : !hints.length && prefix.length === 1 ? [prefix[0].lng, prefix[0].lat] as Coord : extraAnchor;
    const radius = Math.max(15000, row.expected_length_m * 1.75);
    if (context) groups = groups.map(g => g.filter(s => s.coords.some(p => haversine(p, context) <= radius)));
    let starts = this.ends(groups.find(g => g.length) ?? []);
    const firstIds = new Set((groups.find(g => g.length) ?? []).map(s => s.id));
    for (const hint of hints) { const snap = nearest(this.router.vertices, hint, 150); if (snap && firstIds.has(this.input.segments[snap.value.segment].id)) starts.push(snap.value.coord); }
    if (!starts.length) starts = hints;
    const network = [...new Map(groups.flat().map(s => [s.id, s])).values()], localVertices = network.length ? vertexIndex(network) : this.router.vertices;
    const lastGroup = groups.filter(g => g.length).slice(-1)[0] ?? [];
    const ends = this.ends(lastGroup);
    if (context) for (const s of lastGroup) for (const p of [s.coords[0], s.coords[s.coords.length - 1]]) if (haversine(p, context) <= radius) ends.push(p);
    const provisional = seed.objective ? resolveObjective(seed.objective.name, seed.objective.feature, this.input.destinations, this.input.features, ends, context ?? starts[0] ?? [0, 0], localVertices, seed.aliases) : null;
    const wide = !!groups[0]?.some(s => s.coords.some(p => starts.length && haversine(p, starts[0]) > Math.max(15000, row.expected_length_m * 2))) || /\b(PCT|Pacific Crest|Commonwealth)\b/i.test(seed.trailhead.name + ' ' + seed.trails[0]);
    const startAnchor = hints.length === 1 ? hints[0] : extraAnchor ? extraAnchor : namedPlaces.length === 1 ? [namedPlaces[0].lng, namedPlaces[0].lat] as Coord : extraAnchor;
    const approach = [...network], approachIds = new Set(network.map(s => s.id)), approachNodes = new Set(network.flatMap(s => [s.start_node, s.end_node]));
    if (startAnchor) for (let pass = 0; pass < 3; pass++) for (const s of this.input.segments) if (!approachIds.has(s.id) && s.length_m <= 400 && (approachNodes.has(s.start_node) || approachNodes.has(s.end_node)) && s.coords.some(p => haversine(p, startAnchor) <= 500)) {
      approach.push(s); approachIds.add(s.id); approachNodes.add(s.start_node); approachNodes.add(s.end_node);
    }
    let th = resolveAccessTrailhead(seed, { ...this.input, access: this.parking }, approach, this.access, this.router, seed.kind === 'loop' ? null : provisional?.route_coord ?? context, wide, startAnchor, new Set(groups[0]?.map(s => s.id) ?? []));
    th ??= resolveTrailhead(seed.trailhead.name, this.input.destinations, this.input.features, starts, this.router.vertices);
    if (th && network.length && th.gap_m > 150) {
      const snap = nearest(localVertices, th.coord, 150); if (snap) { th.route_coord = snap.value.coord; th.gap_m = snap.distance; }
    }
    th ??= this.newTrailhead(seed, groups.flat());
    if (!th) return finish('trailhead unresolved: no named/nearby trailhead or named-trail/road junction');
    row.trailhead = th.ref; row.route_start = th.route_coord;
    if (th.gap_m > 150) return finish(`trailhead graph gap ${formatGap(th.gap_m)} (>150 m)`);
    let objective: ResolvedPlace | null = null, end: ResolvedPlace | null = null;
    const resolutionNotes: string[] = [];
    if (seed.objective) {
      objective = resolveObjective(seed.objective.name, seed.objective.feature, this.input.destinations, this.input.features, ends, th.coord, this.router.vertices, seed.aliases);
      if (!objective && ['destination', 'summit'].includes(seed.kind)) {
        const last = groups.filter(g => g.length).slice(-1)[0] ?? [], lastName = seed.trails[seed.trails.length - 1] ?? '';
        if (distinctiveTokens(seed.objective.name).some(t => distinctiveTokens(lastName).includes(t))) {
          const p = this.ends(last, true).sort((a, b) => haversine(b, th!.route_coord) - haversine(a, th!.route_coord))[0];
          if (p) { const source = last.find(s => s.coords.some(q => q === p)) ?? last[0], snap = nearest(localVertices, p, 1)!;
            objective = { ref: { new: { name: seed.objective.name, feature: seed.objective.feature, lng: p[0], lat: p[1], source: { kind: 'trail_end', node_id: snap.value.id, provenance: source.provenance } } }, name: seed.objective.name, feature: seed.objective.feature, coord: p, route_coord: p, gap_m: 0 };
            resolutionNotes.push('objective at trail end');
          }
        }
      }
      if (!objective) return finish(`objective unresolved: ${seed.objective.name} (${seed.objective.feature})`);
      row.objective = objective.ref;
      if (objective.gap_m > (seed.objective.feature === 'summit' ? 400 : 150)) return finish(`objective graph gap ${formatGap(objective.gap_m)} (>${seed.objective.feature === 'summit' ? 400 : 150} m)`);
      if (objective.gap_m > 150) resolutionNotes.push(`summit off trail end ${Math.round(objective.gap_m)}m`);
      // Select a reachable boundary/point vertex on the preferred trail network.
      // A nearby parking spur must not send a lake hike around a mountain.
      const limit = seed.objective.feature === 'summit' ? 400 : 150;
      const points = network.flatMap(s => s.coords.map((p, i) => ({ p, id: s.node_ids[i], gap: objective!.osm?.boundary ? featureDistance(p, objective!.osm) : haversine(p, objective!.coord) }))).filter(p => p.gap <= limit);
      const uniquePoints = [...new Map(points.map(p => [p.id, p])).values()].sort((a, b) => a.gap - b.gap);
      // Boundary vertices within 15 m are preferable to stopping short of shore.
      const bestGap = uniquePoints[0]?.gap ?? Infinity, shortlist = uniquePoints.filter(p => p.gap <= bestGap + (objective!.osm?.boundary ? 15 : 30)).sort((a, b) => haversine(a.p, th!.route_coord) - haversine(b.p, th!.route_coord)).slice(0, 12);
      let best: { p: Coord; cost: number; gap: number } | null = null;
      for (const p of shortlist) try {
        const r = this.router.route(th.route_coord, p.p, { preferNames: preferences, includeFeatures: false });
        const cost = r.total_length_m + p.gap * 3;
        if (!best || cost < best.cost) best = { p: p.p, cost, gap: p.gap };
      } catch (e) { if (!/Disconnected graph/.test((e as Error).message)) throw e; }
      if (best) { objective.route_coord = best.p; objective.gap_m = best.gap; }
    } else if (seed.kind !== 'loop' && seed.kind !== 'traverse') return finish('seed has no objective');
    if (seed.kind === 'traverse') {
      end = this.traverseEnd(seed, ends, th); row.end_trailhead = end?.ref ?? null;
      if (!end) return finish('far trailhead unresolved from traverse notes');
      if (end.gap_m > 150) return finish(`far trailhead graph gap ${formatGap(end.gap_m)} (>150 m)`);
    }
    let walk: RouteStep[];
    try {
      const local = groups.map(g => g.filter(s => s.coords.some(p => haversine(p, th!.coord) <= radius)));
      const vias = local.filter(g => g.length).map(g => {
        // Pick a point on each named trail in order, near the trailhead/objective corridor.
        const target = objective?.route_coord ?? end?.route_coord ?? th!.route_coord;
        const chosen = [...g].sort((a, b) => haversine(midpoint(a.coords), th!.route_coord) + haversine(midpoint(a.coords), target) - haversine(midpoint(b.coords), th!.route_coord) - haversine(midpoint(b.coords), target))[0];
        return chosen.coords[Math.floor(chosen.coords.length / 2)];
      });
      if (seed.kind === 'loop') {
        // This seed explicitly says Second Burroughs; touching the lower loop
        // alone misses that objective by almost a kilometre.
        const second = /Burroughs Mountain Loop/.test(seed.name) ? resolveObjective('Second Burroughs Mountain', 'summit', this.input.destinations, this.input.features, ends, th.coord, this.router.vertices) : null;
        if (second && second.gap_m > 400) return finish(`Second Burroughs graph gap ${formatGap(second.gap_m)} (>400 m)`);
        let loop = composeLoop(this.router, local, th.route_coord, row.expected_length_m, preferences, second ? [second.route_coord] : []);
        if (!loop && second) {
          const base = composeLoop(this.router, local, th.route_coord, row.expected_length_m, preferences);
          if (base) { loop = addLoopVia(this.router, base, second.route_coord, preferences); resolutionNotes.push('Second Burroughs from seed notes requires a mapped summit spur'); }
        }
        if (!loop) return finish('no closed route following the ordered named trails; missing connector or trail name');
        if (second && second.gap_m > 150) resolutionNotes.push(`Second Burroughs off trail end ${Math.round(second.gap_m)}m`);
        walk = loop;
      } else {
        const forced: Coord[] = /Emmons.Winthrop/i.test(seed.name) ? ['Inter Glacier Route', 'Emmons Glacier Route'].map(n => {
          const g = this.trails.get(trailKey(n)) ?? []; const s = g.sort((a, b) => b.length_m - a.length_m)[0]; return s?.coords[Math.floor(s.coords.length / 2)];
        }).filter((p): p is Coord => !!p) : seed.kind === 'traverse' ? vias : [];
        for (const name of hint?.via ?? []) {
          const f = this.input.features.filter(f => placeKey(f.name) === placeKey(name)).sort((a, b) => haversine([a.lon, a.lat], th!.coord) - haversine([b.lon, b.lat], th!.coord))[0];
          if (!f) return finish(`required source waypoint unresolved: ${name}`);
          const hit = nearest(this.router.vertices, [f.lon, f.lat], 150); if (!hit) return finish(`required source waypoint graph gap: ${name}`); forced.push(hit.value.coord);
        }
        const mailbox = /Mailbox Peak/.test(seed.name), old = /Old Trail/.test(seed.name);
        const allowed = mailbox ? new Set(this.input.segments.filter(s => !s.trail_names.some(n => old ? /^Mailbox Peak Trail$/.test(n) && s.length_m > 1000 : /Mailbox Peak Old Trail/.test(n))).map(s => s.id)) : undefined;
        walk = this.router.route(th.route_coord, (objective ?? end)!.route_coord, { preferNames: preferences, via: forced, includeFeatures: false, allowedSegmentIds: allowed }).segments;
      }
      const initialLength = walk.reduce((n, s) => n + s.length_m, 0), preferredIds = new Set(network.map(s => s.id));
      const initialPreferred = walk.filter(s => preferredIds.has(s.segment_id)).reduce((n, s) => n + s.length_m, 0) / (initialLength || 1);
      if (seed.kind !== 'loop' && seed.kind !== 'traverse' && !hint?.via && initialPreferred < 0.6 && objective) {
        const allowed = new Set(preferredIds), nodes = new Set(network.flatMap(s => [s.start_node, s.end_node]));
        for (let pass = 0; pass < 4; pass++) for (const s of this.input.segments) if (!allowed.has(s.id) && s.length_m <= 400 && (nodes.has(s.start_node) || nodes.has(s.end_node)) && ((!s.trail_names.length && !s.relation_names.length) || s.coords.some(p => haversine(p, th!.route_coord) <= 500 || haversine(p, objective!.route_coord) <= 400))) {
          allowed.add(s.id); nodes.add(s.start_node); nodes.add(s.end_node);
        }
        try {
          const alternative = this.router.route(th.route_coord, objective.route_coord, { allowedSegmentIds: allowed, preferNames: preferences, includeFeatures: false }).segments;
          const metres = alternative.reduce((n, s) => n + s.length_m, 0), fraction = alternative.filter(s => preferredIds.has(s.segment_id)).reduce((n, s) => n + s.length_m, 0) / (metres || 1);
          if (fraction > initialPreferred && Math.abs(metres / row.expected_length_m - 1) <= Math.abs(initialLength / row.expected_length_m - 1)) {
            walk = alternative; row.notes = [...(row.notes ?? []), 'Follow the named trail network rather than the shorter off-network branch.'];
          }
        } catch (e) { if (!/Disconnected graph/.test((e as Error).message)) throw e; }
      }
      const approach = objective?.feature === 'summit' ? summitApproach(walk, this.byId) : { walk, xc: [] }; walk = approach.walk;
      if (approach.xc.length) row.notes = [...(row.notes ?? []), 'Final xc approach follows existing OSM informal/poor-visibility path geometry; no straight-line summit connector.'];
      const route = this.router.summarize(walk, { campsite: 35, glacier: 35 });
      row.length_m = route.total_length_m;
      row.route_end = walk.length ? this.byId.get(walk[walk.length - 1].segment_id)!.coords[walk[walk.length - 1].end_vertex] : th.route_coord;
      const preferred = new Set(groups.flat().map(s => s.id));
      row.preferred_fraction = walk.filter(s => preferred.has(s.segment_id)).reduce((n, s) => n + s.length_m, 0) / (row.length_m || 1);
      row.road_fraction = walk.filter(s => this.byId.get(s.segment_id)!.kind === 'road').reduce((n, s) => n + s.length_m, 0) / (row.length_m || 1);
      const checked = validateRoute(seed.kind, row.length_m, row.expected_length_m, row.preferred_fraction, row.road_fraction, repeatedEdgesAllowed(seed.kind, walk, this.byId));
      row.status = checked.status; row.reasons = checked.reasons; row.deviation_fraction = checked.deviation;
      const review = (reason: string) => { row.reasons.push(reason); if (row.status === 'ok') row.status = 'review'; };
      const missing = seed.trails.filter((_, i) => !groups[i].length); if (missing.length) review(`unmatched seed trails: ${missing.join('; ')}`);
      for (const note of resolutionNotes) review(note);
      if (th.ref.new?.source.kind === 'inferred_road_contact' || th.ref.new?.source.kind === 'graph') row.reasons.push('inferred trailhead');
      row.waypoints = route.features.map(f => this.waypoint(f, row.length_m, th!, objective));
      row.existing_route_matches = this.existingMatches(row, objective);
      row.existing_route_match = row.existing_route_matches[0] ?? null;
      return { row, walk, xc: approach.xc };
    } catch (error) {
      if (!/Disconnected graph|No graph node|Invalid endpoint/.test((error as Error).message)) throw error;
      return finish(`routing failed: ${(error as Error).message}`);
    }
  }
  private waypoint(f: NamedFeature & { distance_along_m: number; distance_from_route_m: number }, total: number, th: ResolvedPlace, objective: ResolvedPlace | null): Waypoint {
    const matches = this.input.destinations.filter(d => placeKey(d.name) === placeKey(f.name) && haversine([d.lng, d.lat], [f.lon, f.lat]) <= 300).sort((a, b) => haversine([a.lng, a.lat], [f.lon, f.lat]) - haversine([b.lng, b.lat], [f.lon, f.lat]));
    const ref = objective?.osm?.osm_id === f.osm_id ? objective.ref : th.osm?.osm_id === f.osm_id ? th.ref : matches[0] ? { peaks_id: matches[0].id } : osmRef(f);
    return { ...ref, name: f.name, feature: f.feature, lng: f.lon, lat: f.lat, fraction: total ? Math.min(1, f.distance_along_m / total) : 0, osm_id: f.osm_id, distance_from_route_m: f.distance_from_route_m };
  }
  private existingMatches(row: ComposedRoute, objective: ResolvedPlace | null): ExistingMatch[] {
    return this.input.routes.filter(r => r.status !== 'superseded').flatMap(r => {
      if (!r.start || !row.route_start) return [];
      const startGap = haversine(row.route_start, r.start.coordinates.slice(0, 2) as Coord);
      const endGap = r.end && row.route_end ? haversine(row.route_end, r.end.coordinates.slice(0, 2) as Coord) : null;
      const sameObjective = objective?.ref.peaks_id && (r.destinations ?? []).some(d => d.id === objective.ref.peaks_id);
      if (startGap > 500 || !sameObjective && (endGap === null || endGap > 300)) return [];
      const popularity = this.input.popularity.find(p => p.route_id === r.id);
      return [{ id: r.id, name: r.name, catalog_reviewed: r.catalog_reviewed, n_sessions: popularity?.n ?? r.n_sessions, start_gap_m: startGap, end_gap_m: endGap }];
    }).sort((a, b) => Number(b.catalog_reviewed) - Number(a.catalog_reviewed) || (a.end_gap_m ?? 0) - (b.end_gap_m ?? 0) || b.n_sessions - a.n_sessions);
  }
}
const formatGap = (n: number) => Number.isFinite(n) ? `${n.toFixed(1)} m` : '>20,000 m';

/** Split all consumed parent segments at the union of route cuts, so routes
 * share the same pieces and route_segments never silently includes extra line. */
export function materialize(drafts: DraftRoute[], source: Map<string, Segment>): Segment[] {
  const cuts = new Map<string, Set<number>>();
  for (const d of drafts) for (const s of d.walk) { const set = cuts.get(s.segment_id) ?? new Set([0, source.get(s.segment_id)!.coords.length - 1]); set.add(s.start_vertex); set.add(s.end_vertex); cuts.set(s.segment_id, set); }
  const pieces = new Map<string, { from: number; to: number; segment: Segment; forward: boolean }[]>(), all: Segment[] = [];
  for (const [id, positions] of cuts) {
    const parent = source.get(id)!, sorted = [...positions].sort((a, b) => a - b), parts: { from: number; to: number; segment: Segment; forward: boolean }[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const from = sorted[i - 1], to = sorted[i]; let segment = parent;
      if (from || to !== parent.coords.length - 1) {
        segment = refresh({ ...parent, coords: parent.coords.slice(from, to + 1), node_ids: parent.node_ids.slice(from, to + 1), osm_edge_way_ids: parent.osm_edge_way_ids.slice(from, to), source_segment_ids: unique([parent.id, ...(parent.source_segment_ids ?? [])]) });
        segment.id = `wa-span-${hash(JSON.stringify([parent.id, segment.node_ids]))}`;
      }
      if (drafts.some(d => d.xc?.some(step => step.segment_id === id && from >= Math.min(step.start_vertex, step.end_vertex) && to <= Math.max(step.start_vertex, step.end_vertex)))) segment.kind = 'xc';
      parts.push({ from, to, segment, forward: segment.node_ids[0] === parent.node_ids[from] }); all.push(segment);
    } pieces.set(id, parts);
  }
  const allById = new Map(all.map(s => [s.id, s]));
  for (const d of drafts) {
    d.row.segments = d.walk.flatMap(step => {
      const selected = pieces.get(step.segment_id)!.filter(p => p.from >= Math.min(step.start_vertex, step.end_vertex) && p.to <= Math.max(step.start_vertex, step.end_vertex));
      if (step.direction === 'reverse') selected.reverse();
      return selected.map(p => ({ id: p.segment.id, direction: (step.direction === 'forward') === p.forward ? 'forward' as const : 'reverse' as const }));
    });
  }
  finalizeRows(drafts.map(d => d.row), all);
  return all.sort((a, b) => a.id.localeCompare(b.id));
}
/** Hash only after all global cuts, labels and curated destinations are final. */
export function finalizeRows(rows: ComposedRoute[], segments: Segment[]): void {
  const allById = new Map(segments.map(s => [s.id, s]));
  for (const row of rows) {
    row.segment_sources = unique(row.segments.map(s => s.id)).map(id => ({ id, provenance: allById.get(id)!.provenance }));
    if (!row.segments.length) continue;
    row.provenance = routeProvenance(row.segment_sources.map(s => s.provenance));
    row.geometry_hash = digest(row.segments.map(ref => [ref.direction, allById.get(ref.id)!.coords]));
    row.segment_manifest_hash = segmentManifestHash(row.segments.map(s => s.id), allById);
    row.composition_hash = digest({ ...row, route_id: undefined, composition_hash: undefined });
    row.route_id = catalogRouteId(row);
  }
}
export function routeProvenance(sources: Provenance[]): Provenance {
  const ways = [...new Set(sources.flatMap(s => s.osm_way_ids))].sort((a, b) => a - b);
  if (ways.length) return provenance(ways, sources.map(s => s.retrieved_at).sort().slice(-1)[0]);
  return { ...sources[0] };
}
async function readRows<T>(path: string): Promise<T[]> { const rows: T[] = []; for await (const row of ndjson<T>(path)) rows.push(row); return rows; }
export async function composeCatalog(input: string, graph: string, out: string, indices?: number[]): Promise<void> {
  await mkdir(out, { recursive: true });
  const inputs: CatalogInputs = { seeds: JSON.parse(await readFile(join(input, 'seed/wa-hike-seed.json'), 'utf8')), destinations: await readRows<PeaksDestination>(join(input, 'peaks-snapshot/wa-destinations.ndjson')),
    routes: await readRows<PeaksRoute>(join(input, 'peaks-snapshot/wa-routes.ndjson')), popularity: await readRows(join(input, 'peaks-snapshot/wa-route-popularity.ndjson')),
    segments: await readRows<Segment>(join(graph, 'segments.ndjson')), features: await readRows<NamedFeature>(join(graph, 'features.ndjson')), access: await readRows<AccessPoint>(join(graph, 'access.ndjson')) };
  const composer = new Composer(inputs), drafts: DraftRoute[] = [];
  for (let i = 0; i < inputs.seeds.length; i++) {
    if (indices && !indices.includes(i)) continue;
    const draft = composer.compose(inputs.seeds[i], i); drafts.push(draft);
    console.log(`${i + 1}/${inputs.seeds.length} ${draft.row.status}: ${draft.row.name} (${Math.round(draft.row.length_m)} m) ${draft.row.reasons.join('; ')}`);
  }
  const segments = materialize(drafts, composer.byId), rows = drafts.map(d => d.row);
  let previous: Segment[] = [];
  try { previous = await readRows<Segment>(join(out, 'segments.ndjson')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  let curation: Curation = { routes: [] };
  try { curation = JSON.parse(await readFile(join(input, 'seed/curated-stretches.json'), 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const audit = applyCuration(rows, segments, curation, inputs.destinations, inputs.features, new Map(previous.map(s => [s.id, s])));
  finalizeRows(rows, segments);
  await writeFile(join(out, 'stretch-audit.json'), JSON.stringify(audit, null, 2) + '\n');
  const review = join(out, '../review'); await mkdir(review, { recursive: true });
  const data = reviewData(rows, segments);
  await writeFile(join(review, 'data.json'), JSON.stringify(data) + '\n');
  // The existing review page embeds its data for file:// use. Refresh that
  // payload too, without fetching any scripts or map tiles during this task.
  try {
    let html = await readFile(join(review, 'index.html'), 'utf8');
    html = html.replace(/const D=.*?;\nconst map=/s, 'const D=' + JSON.stringify(data).replace(/</g, '\\u003c') + ';\nconst map=');
    if (!html.includes('r.sn||[]')) html = html.replace("+(r.rs||'')+'</div>'", "+(r.rs||'')+'</div><div class=m>'+((r.sn||[]).filter(Boolean).join(' → '))+'</div>'");
    await writeFile(join(review, 'index.html'), html);
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  await writeNdjson(join(out, 'segments.ndjson'), segments); await writeNdjson(join(out, 'routes.ndjson'), rows);
  const summary = summarize(rows);
  await writeFile(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  await writeFile(join(out, 'report.md'), composeReport(rows, summary));
  console.log(JSON.stringify(summary, null, 2));
}
export function summarize(rows: ComposedRoute[]) {
  const tally = (key: (r: ComposedRoute) => string) => { const counts: Record<string, Record<string, number>> = {}; for (const r of rows) { const k = key(r); counts[k] ??= { ok: 0, review: 0, needs_geometry: 0, failed: 0 }; counts[k][r.status]++; } return counts; };
  return { total: rows.length, by_status: tally(() => 'all').all, by_region: tally(r => r.region), by_tier: tally(r => String(r.tier)),
    new_trailheads: rows.filter(r => r.trailhead?.new).length, inferred_trailheads: rows.filter(r => r.trailhead?.new?.source.kind === 'inferred_road_contact').length, existing_route_matches: rows.filter(r => r.existing_route_match).length, reviewed_matches: rows.filter(r => r.existing_route_match?.catalog_reviewed).length };
}
export function composeReport(rows: ComposedRoute[], summary: ReturnType<typeof summarize>): string {
  let report = '# Washington composition report\n\nLocal snapshots only; no network or database access.\n\n```json\n' + JSON.stringify(summary, null, 2) + '\n```\n';
  const detail = (r: ComposedRoute) => `| ${r.seed_index} | ${r.name} | ${r.tier} | ${r.region} | ${r.status} | ${r.reasons.join('; ').replace(/\|/g, '/')} |\n`;
  report += '\nTier 1 entries that are not ok:\n\n| Index | Name | Tier | Region | Status | Reason |\n| ---: | --- | ---: | --- | --- | --- |\n';
  for (const r of rows.filter(r => r.tier === 1 && r.status !== 'ok')) report += detail(r);
  report += '\nRainier checks:\n\n| Route | Status | km | Expected km | Segments | Preferred | Reason |\n| --- | --- | ---: | ---: | ---: | ---: | --- |\n';
  for (const r of rows.filter(r => /Camp Muir via|Disappointment Cleaver|Emmons-Winthrop/.test(r.name))) report += `| ${r.name} | ${r.status} | ${(r.length_m / 1000).toFixed(3)} | ${(r.expected_length_m / 1000).toFixed(3)} | ${r.segments.length} | ${(r.preferred_fraction * 100).toFixed(1)}% | ${r.reasons.join('; ')} |\n`;
  const random = rows.filter(r => r.status === 'ok'); let state = 20261016;
  for (let i = random.length - 1; i > 0; i--) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; const j = state % (i + 1); [random[i], random[j]] = [random[j], random[i]]; }
  report += '\nTen random ok entries (fixed random seed 20261016):\n\n| Index | Route | Shape | km | Expected km | Seed approximate miles | Difference |\n| ---: | --- | --- | ---: | ---: | ---: | ---: |\n';
  for (const r of random.slice(0, 10)) report += `| ${r.seed_index} | ${r.name} | ${r.shape} | ${(r.length_m / 1000).toFixed(3)} | ${(r.expected_length_m / 1000).toFixed(3)} | ${r.approx_roundtrip_mi} | ${((r.deviation_fraction ?? 0) * 100).toFixed(1)}% |\n`;
  report += '\nExpected distance is half the seed round-trip distance for out-and-back routes and the full distance for loops. Traverse seed distances explicitly describe one-way trips and stay full.\n';
  report += '\nEvery non-ok entry:\n\n| Index | Name | Tier | Region | Status | Reason |\n| ---: | --- | ---: | --- | --- | --- |\n';
  for (const r of rows.filter(r => r.status !== 'ok')) report += `| ${r.seed_index} | ${r.name} | ${r.tier} | ${r.region} | ${r.status} | ${r.reasons.join('; ').replace(/\|/g, '/')} |\n`;
  report += '\nDuplicate names and endpoint matches:\n\n';
  for (const r of rows.filter(r => r.name_duplicates.length || r.existing_route_matches.length > 1)) report += `- ${r.seed_index} ${r.name}: ${r.name_duplicates.map(d => `${d.type} ${d.id} (${d.name})`).join('; ')}; endpoint matches ${r.existing_route_matches.map(m => `${m.id}${m.catalog_reviewed ? ' [catalog reviewed]' : ''}`).join(', ')}.\n`;
  return report;
}
if (require.main === module) { const options = args(); composeCatalog(option(options, 'input', DEFAULT_INPUT), option(options, 'graph', DEFAULT_OUT), option(options, 'out', DEFAULT_COMPOSE), options.has('indices') ? option(options, 'indices', '').split(',').map(Number) : undefined).catch(e => { console.error(e); process.exitCode = 1; }); }
