import { Grid, haversine, interpolate, nearest, pointDistance, type Vertex } from './geo';
import { nearestFeatureVertex, vertexIndex } from './features';
import { displayName } from './display-names';
import { trailKey } from './names';
import { MinHeap, type RouteStep } from './router';
import type { AccessPoint } from './catalog-types';
import type { Coord, NamedFeature, Relation, Segment } from './types';

export interface DiscoveryCandidate {
  source: 'relation' | 'objective' | 'named_trail' | 'lollipop';
  identity: string; name: string; shape: 'out_and_back' | 'loop' | 'point_to_point';
  /** Out-and-back walks contain the outbound leg, as the catalog loader expects. */
  walk: RouteStep[]; trailhead: NamedFeature | AccessPoint; trailheadCoord: Coord;
  objective?: NamedFeature; endTrailhead?: NamedFeature | AccessPoint;
  preferredNames: string[]; reasons?: string[]; relation?: Relation; junctionNameCount?: number;
  trailheadEvidence?: { access: AccessPoint; gap_m: number; node_id: string };
}
export interface HardGoalRequest {
  start: string;
  edges: { id: number; from: string; to: string; length: number; named: boolean; road: boolean }[];
  contacts: { node: string; connector: number }[];
  maxDistance: number;
}
export interface HardGoalResult {
  status: 'optimal' | 'feasible' | 'infeasible' | 'limit' | 'unavailable' | 'error';
  path?: { edge: number; reverse: boolean }[];
  reason?: string; message?: string; max_rss_mib?: number; elapsed_seconds?: number; solver_version?: string;
  [key: string]: unknown;
}
export type HardGoalSolver = (request: HardGoalRequest) => HardGoalResult;
export interface DiscoveryOptions { hardGoalSolver?: HardGoalSolver; hardGoalAfterStates?: number; maxObjectiveStates?: number }
interface Attachment { node: string; coord: Coord; vertex: Vertex }
interface Start extends Attachment { place: NamedFeature | AccessPoint }
interface Edge { id: number; segment: number; from: string; to: string; a: number; b: number; length: number }
interface Arc { edge: Edge; to: string; reverse: boolean }
interface Label { node: string; distance: number; bad: number; road: number; cost: number; previous?: Label; arc?: Arc; active: boolean; visitedMask?: bigint; remainingNamed?: number }
interface Search { labels: Map<string, Label[]>; best: Map<string, Label> }
interface ObjectiveSearch { goals: Map<NamedFeature, Label>; review: Map<NamedFeature, string[]>; scalarNodes: number; scalarSettled: number; unresolved: number; expanded: number; budgetExhausted: number; resourceInfeasible: number; namedInfeasible: number; maskGoals: number; ancestorGoals: number; offTargetNodes: number; costExcludedEdges: number; badExcludedEdges: number; physicalExcludedNodes: number; physicalExcludedEdges: number; couplingPasses: number; capacityPruned: number; priorityPruned: number }
interface GoalSearch { label?: Label; exhausted?: boolean; expanded: number; capacityPruned: number; priorityPruned: number }
const OBJECTIVES = new Set(['summit', 'lake', 'waterfall', 'viewpoint', 'lookout', 'hut', 'pass', 'saddle', 'hot_spring', 'arch', 'meadow']);
const objectiveOrder = ['summit', 'lookout', 'waterfall', 'lake', 'viewpoint', 'hut', 'pass', 'saddle', 'hot_spring', 'arch', 'meadow'];
/** Lower bound on weighted trail cost plus the physical terminal connector.
 * Ratio gates force extra distance even when the shortest bad shortcut is short. */
export function objectiveCostLowerBound(input: { distance: number; bad: number; road: number; physicalRemainder: number; badRemainder: number; roadRemainder: number; weightedCost: number; weightedRemainder: number; maxConnector: number }): number {
  const bad = input.bad + input.badRemainder, road = input.road + input.roadRemainder;
  const distance = Math.max(input.distance + input.physicalRemainder, bad / .3, road / .1);
  return Math.max(input.weightedCost + input.weightedRemainder, distance + .6 * bad + 1.5 * road - .6 * input.maxConnector);
}
const coord = (place: NamedFeature | AccessPoint): Coord => 'coord' in place ? place.coord : [place.lon, place.lat];
const placeId = (place: NamedFeature | AccessPoint): string => place.osm_id;
const reversed = (walk: RouteStep[]): RouteStep[] => [...walk].reverse().map(s => ({ ...s, direction: s.direction === 'forward' ? 'reverse' : 'forward', start_vertex: s.end_vertex, end_vertex: s.start_vertex }));

function roadName(name: string): boolean {
  return /\bforest\s+(?:(?:development|develop|dev\.?|service)\s+)?(?:road|rd)(?=\b|\d)/i.test(name)
    || /\b(?:road|rd\.?|street|st\.?|avenue|ave\.?|highway|hwy\.?|drive|dr\.?|boulevard|blvd\.?|lane|ln\.?|place|pl\.?)\s*(?:#?\s*\d+[a-z]?(?:\s*[-./]\s*\d+[a-z]?|\s+\d+[a-z]?)*)?(?:\s+(?:north(?:east|west)?|south(?:east|west)?|east|west|n|s|e|w|ne|nw|se|sw))?$/i.test(name)
    || /\b(?:nfdr|ndfr|nfr|fsr|fdr|fr)\s*[-#]?\s*\d+[a-z]?\b/i.test(name)
    || /^(?:(?:nfd|nf|fs|usfs)\s*[-#]?\s*|forest\s+service\s+)\d+[a-z]?(?:[.-]\d+[a-z]?)*(?:\s*\((?:abandoned|closed|decommissioned)\))?$/i.test(name)
    || /^(?:north|south|east|west|northeast|northwest|southeast|southwest|n|s|e|w|ne|nw|se|sw)\s*\d+(?:st|nd|rd|th)?\s*(?:north|south|east|west|n|s|e|w|way)$/i.test(name)
    || /\b(?:road|rd\.?)\s+(?:nfdr|ndfr|nfr|nfd|nf|fsr|fs|fdr|fr|usfs)\s*[-#]?\s*\d+[a-z]?(?:[.-]\d+[a-z]?)*\b/i.test(name);
}
/** Use the same expanded display names as the graph. Road names cannot become hike titles. */
export function discoveryName(value: string | null | undefined): string | null {
  const name = displayName(value ?? null);
  if (!name || roadName(name) || name.includes('/') && name.split('/').some(part => roadName(part.trim()))) return null;
  if (/^#?\s*\d+(?:\s*[-./]\s*\d+|\s+\d+)*$/.test(name) || /^\d+\s*(?:north|south|east|west|n|s|e|w|ne|nw|se|sw)$/i.test(name)) return null;
  return name;
}
function trailNames(s: Segment): string[] {
  if (s.kind === 'road') return [];
  return [...new Set(s.trail_names.map(discoveryName).filter((n): n is string => !!n))];
}
function preferences(walk: RouteStep[], namesById: Map<string, string[]>): string[] {
  const weights = new Map<string, { name: string; length: number }>();
  for (const step of walk) {
    const names = namesById.get(step.segment_id)!;
    for (const name of names) { const key = trailKey(name), old = weights.get(key); weights.set(key, { name: old?.name ?? name, length: (old?.length ?? 0) + step.length_m }); }
  }
  return [...weights.values()].sort((a, b) => b.length - a.length || a.name.localeCompare(b.name)).map(v => v.name);
}
function syntheticStart(node: string, p: Coord, name: string): NamedFeature {
  return { osm_id: `graph/${node}`, name: `${name} Trailhead`, feature: 'trailhead', lon: p[0], lat: p[1], graph_node: node, graph_distance_m: 0, graph_coord: p, location_method: 'osm_point' };
}
function featureRadius(f: NamedFeature): number {
  return f.feature === 'trailhead' ? 150 : f.feature === 'summit' ? 75 : 30;
}
function eligibleObjective(f: NamedFeature): boolean {
  if (!OBJECTIVES.has(f.feature) || !f.name?.trim()) return false;
  if (f.feature !== 'lake') return true;
  // The legacy graph classifier also labels artificial and flowing water as
  // lakes. Keep sparse lake tags, but exclude these explicit other types.
  const t = f.tags ?? {};
  return t.amenity !== 'fountain' && !['fountain', 'swimming_pool', 'wastewater', 'river', 'canal', 'stream', 'ditch', 'drain', 'moat'].includes(t.water)
    && t.leisure !== 'swimming_pool' && t.substance !== 'wastewater' && !['sewage_treatment_pond', 'wastewater_basin', 'clarifier'].includes(t.man_made);
}

/** A compressed graph cut at junctions and every attached feature/access vertex. */
class DiscoveryGraph {
  readonly adjacency = new Map<string, Arc[]>();
  readonly positions = new Map<string, Coord>();
  readonly edges: Edge[] = [];
  readonly edgesBySegment = new Map<string, Edge[]>();
  readonly featureAt = new Map<NamedFeature, Attachment>();
  readonly accessAt = new Map<AccessPoint, Attachment>();
  readonly starts: Start[] = [];
  readonly startsAt = new Map<string, Start[]>();
  readonly contacts = new Map<string, Start[]>();
  readonly objectives = new Map<string, NamedFeature[]>();
  private readonly objectiveNodes = new Map<NamedFeature, Set<string>>();
  readonly byId: Map<string, Segment>;
  readonly namesBySegment: string[][];
  readonly keysBySegment: string[][];
  readonly namesById: Map<string, string[]>;
  readonly isNamed: boolean[];
  private readonly accessIndex = new Grid<AccessPoint>(200);
  constructor(readonly segments: Segment[], features: NamedFeature[], access: AccessPoint[], private readonly hardGoalSolver?: HardGoalSolver, private readonly hardGoalAfterStates = 5000, private readonly maxObjectiveStates = 25000) {
    this.byId = new Map(segments.map(s => [s.id, s]));
    this.namesBySegment = segments.map(trailNames);
    this.keysBySegment = this.namesBySegment.map(names => names.map(trailKey));
    this.namesById = new Map(segments.map((s, i) => [s.id, s.kind === 'road' ? [] : [...this.namesBySegment[i], ...s.relation_names.map(discoveryName).filter((n): n is string => !!n)]]));
    this.isNamed = segments.map(s => this.namesById.get(s.id)!.length > 0);
    // The temporary vertex index is released after attachment; routing retains only cuts.
    const vertices = vertexIndex(segments.filter(s => s.kind !== 'road'));
    // vertexIndex numbers its filtered input; convert back to original segment indices.
    const sourceIndices = segments.flatMap((s, i) => s.kind !== 'road' ? [i] : []);
    const attachment = (hit: { value: Vertex; distance: number } | null): Attachment | null => hit ? { node: hit.value.id, coord: hit.value.coord, vertex: { ...hit.value, segment: sourceIndices[hit.value.segment] } } : null;
    const cuts = new Set<string>();
    for (const s of segments) { cuts.add(s.start_node); cuts.add(s.end_node); }
    const road = this.accessIndex;
    for (const a of access) road.add(a.coord, a.coord, a);
    const contact = (p: Coord): boolean => road.near(p, 150).some(a => haversine(p, a.coord) <= 150);
    const knownAttachment = (f: NamedFeature): Attachment | null => {
      const radius = featureRadius(f);
      if (f.graph_coord && f.graph_node && (f.graph_distance_m ?? Infinity) <= radius) {
        const hit = nearest(vertices, f.graph_coord, 0.1);
        if (hit?.value.id === f.graph_node) return attachment(hit);
      }
      return null;
    };
    const attach = (f: NamedFeature): Attachment | null => knownAttachment(f) ?? attachment(nearestFeatureVertex(f, vertices, featureRadius(f)));
    const areaAttachments = (f: NamedFeature): Attachment[] => {
      const found = new Map<string, Attachment>(), known = knownAttachment(f), radius = 30;
      if (known && (f.graph_distance_m ?? Infinity) <= radius) found.set(known.node, known);
      // Small boundary queries avoid scanning the whole lake's bounding box.
      // Keep all contacted source nodes, including nearby vertices inside the
      // footprint, so disconnected shore approaches share the same objective.
      for (const polygon of f.boundary!.coordinates) for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1], b = ring[i], distance = haversine(a, b), parts = Math.max(1, Math.ceil(distance / 100));
        for (let j = 0; j < parts; j++) {
          const from = interpolate(a, b, j / parts), to = interpolate(a, b, (j + 1) / parts), centre = interpolate(from, to, .5);
          for (const value of vertices.near(centre, distance / parts / 2 + radius)) {
            if (found.has(value.id)) continue;
            const gap = pointDistance(value.coord, from, to); if (gap > radius + 1e-6) continue;
            const at = attachment({ value, distance: gap })!; found.set(at.node, at);
          }
        }
      }
      return [...found.values()];
    };
    for (const f of features) {
      if (f.feature !== 'trailhead' && !eligibleObjective(f)) continue;
      const attached = f.boundary && f.feature !== 'trailhead' ? areaAttachments(f) : [attach(f)].filter((at): at is Attachment => !!at);
      if (!attached.length) continue;
      const at = attached[0]; this.featureAt.set(f, at);
      if (f.feature === 'trailhead') {
        cuts.add(at.node);
        const start = { ...at, place: f }; this.starts.push(start);
        if (contact(at.coord)) this.addStart(this.contacts, start);
      } else for (const contact of attached) { cuts.add(contact.node); const list = this.objectives.get(contact.node) ?? []; list.push(f); this.objectives.set(contact.node, list); const nodes = this.objectiveNodes.get(f) ?? new Set<string>(); nodes.add(contact.node); this.objectiveNodes.set(f, nodes); }
    }
    for (const a of access) {
      const at = attachment(nearest(vertices, a.coord, 150)); if (!at) continue;
      cuts.add(at.node); this.accessAt.set(a, at);
      const start = { ...at, place: a }; this.addStart(this.contacts, start);
      if (a.parking && a.name?.trim()) this.starts.push(start);
    }
    this.starts.sort((a, b) => placeId(a.place).localeCompare(placeId(b.place)));
    for (const start of this.starts) this.addStart(this.startsAt, start);
    for (const list of this.contacts.values()) list.sort((a, b) => this.contactRank(a) - this.contactRank(b) || haversine(coord(a.place), a.coord) - haversine(coord(b.place), b.coord) || placeId(a.place).localeCompare(placeId(b.place)));
    segments.forEach((s, segment) => {
      let from = 0, distance = 0;
      for (let i = 1; i < s.coords.length; i++) {
        distance += haversine(s.coords[i - 1], s.coords[i]);
        if (!cuts.has(s.node_ids[i]) && i !== s.coords.length - 1) continue;
        if (distance > 0) {
          const e: Edge = { id: this.edges.length, segment, from: s.node_ids[from], to: s.node_ids[i], a: from, b: i, length: distance };
          this.edges.push(e); const edgeList = this.edgesBySegment.get(s.id) ?? []; edgeList.push(e); this.edgesBySegment.set(s.id, edgeList);
          this.add(e.from, { edge: e, to: e.to, reverse: false }); this.add(e.to, { edge: e, to: e.from, reverse: true });
          this.positions.set(e.from, s.coords[from]); this.positions.set(e.to, s.coords[i]);
        }
        from = i; distance = 0;
      }
    });
  }
  private contactRank(s: Start): number { return 'feature' in s.place ? 0 : s.place.parking && s.place.name ? 1 : s.place.parking ? 2 : 3; }
  private addStart(map: Map<string, Start[]>, start: Start): void { const list = map.get(start.node) ?? []; list.push(start); map.set(start.node, list); }
  private add(node: string, arc: Arc): void { const list = this.adjacency.get(node) ?? []; list.push(arc); this.adjacency.set(node, list); }
  step(arc: Arc): RouteStep {
    const e = arc.edge; return { segment_id: this.segments[e.segment].id, direction: arc.reverse ? 'reverse' : 'forward', start_vertex: arc.reverse ? e.b : e.a, end_vertex: arc.reverse ? e.a : e.b, length_m: e.length };
  }
  junctionNameCount(node: string): number {
    const keys = new Set<string>();
    for (const arc of this.adjacency.get(node) ?? []) for (const key of this.keysBySegment[arc.edge.segment]) if (key) keys.add(key);
    return keys.size;
  }
  findContact(node: string, radius = 125): NonNullable<DiscoveryCandidate['trailheadEvidence']> | null {
    const point = this.positions.get(node); if (!point) return null;
    const contacts = this.accessIndex.near(point, radius).map(access => ({ access, gap_m: haversine(point, access.coord), node_id: node })).filter(c => c.gap_m <= radius + 1e-6);
    const rank = (access: AccessPoint) => access.parking && access.name?.trim() ? 0 : access.parking ? 1 : 2;
    contacts.sort((a, b) => rank(a.access) - rank(b.access) || a.gap_m - b.gap_m || a.access.osm_id.localeCompare(b.access.osm_id));
    return contacts[0] ?? null;
  }
  walk(label: Label): RouteStep[] {
    const walk: RouteStep[] = []; for (let p = label; p.previous; p = p.previous) walk.push(this.step(p.arc!));
    return mergeSteps(walk.reverse());
  }
  private edgeCost(edge: Edge): number {
    return edge.length * (1 + (this.isNamed[edge.segment] ? 0 : .6) + (this.segments[edge.segment].kind === 'road' ? 1.5 : 0));
  }
  private connectorLength(objective: NamedFeature, node: string): number | null {
    if (objective.feature !== 'summit') return 0;
    const gap = haversine(this.positions.get(node)!, [objective.lon, objective.lat]);
    return gap <= 5 + 1e-6 ? 0 : gap <= 75 + 1e-6 ? gap : null;
  }
  private goalValid(label: Label, connector: number): boolean {
    const finalLength = label.distance + connector;
    return label.distance > 0 && finalLength <= 15000 + 1e-6 && label.bad + connector <= .3 * finalLength + 1e-6
      && label.road <= .1 * label.distance + 1e-6 && label.road <= .1 * finalLength + 1e-6 && label.distance - label.bad >= .6 * finalLength - 1e-6;
  }
  /** Physical routing does not count named/road resources. Rebuild its label
   * chain before applying the catalog gates or comparing weighted costs. */
  private measuredPath(label: Label, cache: Map<Label, Label>): Label {
    const chain: Label[] = []; let first = label;
    while (first.previous && !cache.has(first)) { chain.push(first); first = first.previous; }
    let current = cache.get(first) ?? { node: first.node, distance: 0, bad: 0, road: 0, cost: 0, active: true };
    cache.set(first, current);
    for (const next of chain.reverse()) { const arc = next.arc!; current = { node: arc.to, distance: current.distance + arc.edge.length, bad: current.bad + (this.isNamed[arc.edge.segment] ? 0 : arc.edge.length), road: current.road + (this.segments[arc.edge.segment].kind === 'road' ? arc.edge.length : 0), cost: current.cost + this.edgeCost(arc.edge), previous: current, arc, active: true }; cache.set(next, current); }
    return current;
  }
  /** Unconstrained scalar costs settle the common, already suitable routes.
   * A physical prefix cap here would hide shorter, higher-cost alternatives.
   * 19,950 bounds weighted trail cost plus the terminal connector of any ok
   * 15 km route (4,500 m bad and 1,500 m road absolute budgets). */
  private scalarPaths(start: string): Map<string, Label> {
    const first: Label = { node: start, distance: 0, bad: 0, road: 0, cost: 0, active: true }, best = new Map([[start, first]]), heap = new MinHeap<Label>(); heap.push(0, first);
    while (heap.size) {
      const current = heap.pop().value; if (best.get(current.node) !== current) continue;
      for (const arc of this.adjacency.get(current.node) ?? []) {
        const s = this.segments[arc.edge.segment], distance = current.distance + arc.edge.length, bad = current.bad + (this.isNamed[arc.edge.segment] ? 0 : arc.edge.length), road = current.road + (s.kind === 'road' ? arc.edge.length : 0), cost = current.cost + this.edgeCost(arc.edge);
        if (cost > 19950 + 1e-6 || cost >= (best.get(arc.to)?.cost ?? Infinity) - 1e-7) continue;
        const next: Label = { node: arc.to, distance, bad, road, cost, previous: current, arc, active: true }; best.set(arc.to, next); heap.push(cost, next);
      }
    }
    return best;
  }
  /** Reverse lower bounds use a virtual terminal edge for each shore/summit
   * contact. Both cost and physical bounds include its connector length. */
  private goalBounds(contacts: Map<string, number>, weighted: boolean, allowedNodes?: Map<string, Label>): Map<string, number> {
    const distances = new Map<string, number>(), heap = new MinHeap<string>(), cap = weighted ? 19950 : 15000;
    for (const [node, gap] of contacts) { distances.set(node, gap); heap.push(gap, node); }
    while (heap.size) {
      const { value: node, cost } = heap.pop(); if (distances.get(node) !== cost) continue;
      for (const arc of this.adjacency.get(node) ?? []) {
        if (allowedNodes && !allowedNodes.has(arc.to)) continue;
        const next = cost + (weighted ? this.edgeCost(arc.edge) : arc.edge.length);
        if (next > cap + 1e-6 || next >= (distances.get(arc.to) ?? Infinity) - 1e-7) continue;
        distances.set(arc.to, next); heap.push(next, arc.to);
      }
    }
    return distances;
  }
  /** Zero-resource edges stay inside the physical/source corridor rather than
   * spreading across the state. Every feasible continuation is in this graph. */
  private resourceBounds(contacts: Map<string, number>, corridor: Set<string>, allowed: Set<number>, roadOnly: boolean): Map<string, number> {
    const distances = new Map<string, number>(), heap = new MinHeap<string>(), cap = roadOnly ? 1500 : 4500;
    for (const [node, connector] of contacts) if (corridor.has(node)) { const initial = roadOnly ? 0 : connector; distances.set(node, initial); heap.push(initial, node); }
    while (heap.size) {
      const { value: node, cost } = heap.pop(); if (distances.get(node) !== cost) continue;
      for (const arc of this.adjacency.get(node) ?? []) {
        if (!corridor.has(arc.to) || !allowed.has(arc.edge.id)) continue;
        const counts = roadOnly ? this.segments[arc.edge.segment].kind === 'road' : !this.isNamed[arc.edge.segment], next = cost + (counts ? arc.edge.length : 0);
        if (next > cap + 1e-6 || next >= (distances.get(arc.to) ?? Infinity) - 1e-7) continue;
        distances.set(arc.to, next); heap.push(next, arc.to);
      }
    }
    return distances;
  }
  private namedUpperBound(corridor: Set<string>, allowed: Set<number>): number {
    const seen = new Set<number>(); let total = 0;
    for (const node of corridor) for (const arc of this.adjacency.get(node) ?? []) if (this.isNamed[arc.edge.segment] && allowed.has(arc.edge.id) && corridor.has(arc.to) && !seen.has(arc.edge.id)) { seen.add(arc.edge.id); total += arc.edge.length; }
    return total;
  }
  /** Solver proofs never bypass graph, direction, simplicity or final gates. */
  private solverPath(path: HardGoalResult['path'], start: string, contacts: Map<string, number>, allowed: Set<number>): Label | null {
    if (!Array.isArray(path) || !path.length) return null;
    let current: Label = { node: start, distance: 0, bad: 0, road: 0, cost: 0, active: true }, previousCoord = this.positions.get(start)!;
    const seen = new Set([start]);
    for (const step of path) {
      if (!step || !Number.isInteger(step.edge) || typeof step.reverse !== 'boolean' || !allowed.has(step.edge)) return null;
      const edge = this.edges[step.edge], from = step.reverse ? edge.to : edge.from, to = step.reverse ? edge.from : edge.to;
      if (from !== current.node || seen.has(to)) return null;
      const arc: Arc = { edge, to, reverse: step.reverse }, s = this.segments[edge.segment], sourceStep = this.step(arc);
      if (haversine(previousCoord, s.coords[sourceStep.start_vertex]) > .1) return null;
      previousCoord = s.coords[sourceStep.end_vertex]; seen.add(to);
      current = { node: to, distance: current.distance + edge.length, bad: current.bad + (this.isNamed[edge.segment] ? 0 : edge.length), road: current.road + (s.kind === 'road' ? edge.length : 0), cost: current.cost + this.edgeCost(edge), previous: current, arc, active: true };
      if (current.distance > 15000 + 1e-6) return null;
    }
    const connector = contacts.get(current.node);
    return connector !== undefined && this.goalValid(current, connector) ? current : null;
  }
  /** Off-target articulation branches require revisiting their attachment to
   * reach any goal, so no simple source-to-goal path can use them. */
  private pruneOffTarget(start: string, contacts: Map<string, number>, corridor: Set<string>, allowed: Set<number>): number {
    if (!corridor.has(start)) return 0;
    const discovered = new Map<string, number>(), low = new Map<string, number>(), targets = new Map<string, number>(), order: string[] = [], intervals: [number, number][] = [];
    interface Frame { node: string; parent?: string; parentEdge?: number; next: number }
    const frames: Frame[] = [{ node: start, next: 0 }]; discovered.set(start, 0); low.set(start, 0); targets.set(start, contacts.has(start) ? 1 : 0); order.push(start);
    while (frames.length) {
      const frame = frames[frames.length - 1], arcs = this.adjacency.get(frame.node) ?? [];
      if (frame.next < arcs.length) {
        const arc = arcs[frame.next++];
        if (!corridor.has(arc.to) || !allowed.has(arc.edge.id) || arc.edge.id === frame.parentEdge) continue;
        if (!discovered.has(arc.to)) { const index = order.length; discovered.set(arc.to, index); low.set(arc.to, index); targets.set(arc.to, contacts.has(arc.to) ? 1 : 0); order.push(arc.to); frames.push({ node: arc.to, parent: frame.node, parentEdge: arc.edge.id, next: 0 }); }
        else low.set(frame.node, Math.min(low.get(frame.node)!, discovered.get(arc.to)!));
        continue;
      }
      frames.pop();
      if (frame.parent !== undefined) {
        if (low.get(frame.node)! >= discovered.get(frame.parent)! && targets.get(frame.node) === 0) intervals.push([discovered.get(frame.node)!, order.length]);
        low.set(frame.parent, Math.min(low.get(frame.parent)!, low.get(frame.node)!)); targets.set(frame.parent, targets.get(frame.parent)! + targets.get(frame.node)!);
      }
    }
    const excluded = new Int32Array(order.length + 1);
    for (const [from, to] of intervals) { excluded[from]++; excluded[to]--; }
    const before = corridor.size; let nesting = 0;
    for (let i = 0; i < order.length; i++) { nesting += excluded[i]; if (nesting > 0) corridor.delete(order[i]); }
    for (const node of corridor) if (!discovered.has(node)) corridor.delete(node);
    for (const id of allowed) { const e = this.edges[id]; if (!corridor.has(e.from) || !corridor.has(e.to)) allowed.delete(id); }
    return before - corridor.size;
  }
  objectivePaths(start: string, diagnostic: (message: string) => void): ObjectiveSearch {
    const scalar = this.scalarPaths(start), reached = new Map<NamedFeature, Map<string, number>>(), goals = new Map<NamedFeature, Label>();
    for (const node of scalar.keys()) {
      if (node === start) continue;
      for (const objective of this.objectives.get(node) ?? []) {
        const gap = this.connectorLength(objective, node); if (gap === null) continue;
        const contacts = reached.get(objective) ?? new Map<string, number>(); contacts.set(node, gap); reached.set(objective, contacts);
      }
    }
    const result: ObjectiveSearch = { goals, review: new Map(), scalarNodes: scalar.size, scalarSettled: 0, unresolved: 0, expanded: 0, budgetExhausted: 0, resourceInfeasible: 0, namedInfeasible: 0, maskGoals: 0, ancestorGoals: 0, offTargetNodes: 0, costExcludedEdges: 0, badExcludedEdges: 0, physicalExcludedNodes: 0, physicalExcludedEdges: 0, couplingPasses: 0, capacityPruned: 0, priorityPruned: 0 };
    let fromPhysical: Map<string, number> | undefined;
    let physicalWalks: Map<string, Label> | undefined;
    const measuredPhysical = new Map<Label, Label>();
    goalLoop: for (const [objective, contacts] of reached) {
      const hits = [...contacts].map(([node, gap]) => ({ label: scalar.get(node)!, gap })).sort((a, b) => a.label.cost + a.gap - b.label.cost - b.gap || a.label.distance + a.gap - b.label.distance - b.gap || a.label.node.localeCompare(b.label.node));
      if (this.goalValid(hits[0].label, hits[0].gap)) { goals.set(objective, hits[0].label); result.scalarSettled++; continue; }
      result.unresolved++;
      const incumbent = hits.find(hit => this.goalValid(hit.label, hit.gap))?.label;
      fromPhysical ??= this.goalBounds(new Map([[start, 0]]), false, scalar);
      const physical = this.goalBounds(contacts, false), cost = this.goalBounds(contacts, true), corridor = new Set<string>(), allowed = new Set<number>(), considered = new Set<number>();
      for (const [node, remainder] of physical) if (scalar.has(node)) {
        if ((fromPhysical.get(node) ?? Infinity) + remainder <= 15000 + 1e-6) corridor.add(node); else result.physicalExcludedNodes++;
      }
      if (!corridor.has(start) || !cost.has(start)) { result.resourceInfeasible++; continue; }
      for (const node of corridor) for (const arc of this.adjacency.get(node) ?? []) {
        if (!corridor.has(arc.to) || considered.has(arc.edge.id)) continue;
        considered.add(arc.edge.id); const edgeCost = this.edgeCost(arc.edge);
        if ((fromPhysical.get(node) ?? Infinity) + arc.edge.length + (physical.get(arc.to) ?? Infinity) > 15000 + 1e-6 && (fromPhysical.get(arc.to) ?? Infinity) + arc.edge.length + (physical.get(node) ?? Infinity) > 15000 + 1e-6) result.physicalExcludedEdges++;
        else if (scalar.get(node)!.cost + edgeCost + (cost.get(arc.to) ?? Infinity) > 19950 + 1e-6 && scalar.get(arc.to)!.cost + edgeCost + (cost.get(node) ?? Infinity) > 19950 + 1e-6) result.costExcludedEdges++;
        else allowed.add(arc.edge.id);
      }
      result.offTargetNodes += this.pruneOffTarget(start, contacts, corridor, allowed);
      let minBad = this.resourceBounds(contacts, corridor, allowed, false), minRoad = this.resourceBounds(contacts, corridor, allowed, true);
      if (!minBad.has(start) || !minRoad.has(start)) { result.resourceInfeasible++; continue; }
      // A simple path uses each named edge at most once. If even all named
      // metres cannot offset the least possible bad metres, no path passes30%.
      let namedUpper = this.namedUpperBound(corridor, allowed);
      if (namedUpper < 7 / 3 * minBad.get(start)! - 1e-6) { result.namedInfeasible++; continue; }
      // The available named metres also bound total bad metres. Remove edges
      // whose least possible bad approach+departure exceeds that bound in
      // both directions. Every pass deletes edges or reaches a fixed point.
      while (true) {
        const forwardBad = this.resourceBounds(new Map([[start, 0]]), corridor, allowed, false), badBudget = Math.min(4500, 3 / 7 * namedUpper); let badExcluded = 0;
        result.couplingPasses++;
        for (const id of allowed) {
          const edge = this.edges[id], edgeBad = this.isNamed[edge.segment] ? 0 : edge.length;
          if ((forwardBad.get(edge.from) ?? Infinity) + edgeBad + (minBad.get(edge.to) ?? Infinity) > badBudget + 1e-6 && (forwardBad.get(edge.to) ?? Infinity) + edgeBad + (minBad.get(edge.from) ?? Infinity) > badBudget + 1e-6) { allowed.delete(id); badExcluded++; }
        }
        result.badExcludedEdges += badExcluded;
        if (!badExcluded) break;
        result.offTargetNodes += this.pruneOffTarget(start, contacts, corridor, allowed);
        minBad = this.resourceBounds(contacts, corridor, allowed, false); minRoad = this.resourceBounds(contacts, corridor, allowed, true); namedUpper = this.namedUpperBound(corridor, allowed);
        if (!minBad.has(start) || !minRoad.has(start)) { result.resourceInfeasible++; continue goalLoop; }
        if (namedUpper < 7 / 3 * minBad.get(start)! - 1e-6) { result.namedInfeasible++; continue goalLoop; }
      }
      diagnostic(`Objective fallback ${objective.name} (${objective.osm_id}): ${contacts.size} contacts, ${corridor.size} nodes, ${allowed.size} edges; named upper ${namedUpper.toFixed(1)} m, minimum bad ${minBad.get(start)!.toFixed(1)} m, bad budget ${Math.min(4500, 3 / 7 * namedUpper).toFixed(1)} m`);
      const fallback = this.goalPath(start, objective, contacts, corridor, allowed, physical, cost, minBad, minRoad, namedUpper, incumbent, diagnostic);
      if (corridor.size <= 4096) result.maskGoals++; else result.ancestorGoals++;
      result.expanded += fallback.expanded;
      result.capacityPruned += fallback.capacityPruned; result.priorityPruned += fallback.priorityPruned;
      if (fallback.label) goals.set(objective, fallback.label);
      else if (fallback.exhausted) {
        result.budgetExhausted++;
        // Use the original graph, including shortcuts excluded from the
        // qualifying-path corridor. Every shoreline contact remains eligible.
        physicalWalks ??= this.search([start], 15000, undefined, false).best;
        const hits = [...this.objectiveNodes.get(objective) ?? []].flatMap(node => { const physical = physicalWalks!.get(node), gap = this.connectorLength(objective, node); if (!physical || !(physical.distance > 0) || gap === null || physical.distance + gap > 15000 + 1e-6) return []; const label = this.measuredPath(physical, measuredPhysical); return [{ label, gap, valid: this.goalValid(label, gap) }]; }).sort((a, b) => Number(b.valid) - Number(a.valid) || (a.valid ? a.label.cost + a.gap - b.label.cost - b.gap : a.label.distance + a.gap - b.label.distance - b.gap) || a.label.distance + a.gap - b.label.distance - b.gap || a.label.node.localeCompare(b.label.node));
        if (hits.length) {
          const { label } = hits[0]; goals.set(objective, label);
          if (!hits[0].valid) result.review.set(objective, ['objective search budget exhausted; qualifying named alternative unresolved']);
          diagnostic(`Objective search budget exhausted ${objective.name} (${objective.osm_id}): ${fallback.expanded} states; shortest physical walk ${(label.distance + hits[0].gap).toFixed(1)} m; ${result.review.has(objective) ? 'review required' : 'qualifying physical approach'}`);
        }
      }
    }
    return result;
  }
  /** Goal-directed search for simple paths; exhaustion returns review. Ratio deficits preserve
   * longer named bypasses that repair a fixed unnamed approach. A prefix can
   * dominate another only if its visited nodes are also a subset, so it cannot
   * remove a path whose remaining simple continuation it would block. */
  private goalPath(start: string, objective: NamedFeature, contacts: Map<string, number>, corridor: Set<string>, allowed: Set<number>, physical: Map<string, number>, lowerCost: Map<string, number>, minBad: Map<string, number>, minRoad: Map<string, number>, namedUpper: number, incumbent: Label | undefined, diagnostic: (message: string) => void): GoalSearch {
    const first: Label = { node: start, distance: 0, bad: 0, road: 0, cost: 0, active: true, remainingNamed: namedUpper }, labels = new Map<string, Label[]>([[start, [first]]]), heap = new MinHeap<Label>();
    let maxConnector = 0; for (const gap of contacts.values()) maxConnector = Math.max(maxConnector, gap);
    const priority = (label: Label): number => objectiveCostLowerBound({ distance: label.distance, bad: label.bad, road: label.road, physicalRemainder: physical.get(label.node) ?? Infinity, badRemainder: minBad.get(label.node) ?? Infinity, roadRemainder: minRoad.get(label.node) ?? Infinity, weightedCost: label.cost, weightedRemainder: lowerCost.get(label.node) ?? Infinity, maxConnector });
    heap.push(priority(first), first);
    // This threshold changes representation only, never the explored states.
    // Small exact masks replace repeated ancestor Set construction; large
    // corridors keep ancestor checks rather than storing huge masks per label.
    const bits = corridor.size <= 4096 ? new Map([...corridor].map((node, index) => [node, 1n << BigInt(index)])) : null;
    if (bits) first.visitedMask = bits.get(start)!;
    let best = incumbent, bestCost = best ? best.cost + contacts.get(best.node)! : Infinity, expanded = 0, capacityPruned = 0, priorityPruned = 0, solverCalled = false;
    const badBudget = Math.min(4500, 3 / 7 * namedUpper);
    const visited = (label: Label, node: string): boolean => { if (bits) return (label.visitedMask! & bits.get(node)!) !== 0n; for (let p: Label | undefined = label; p; p = p.previous) if (p.node === node) return true; return false; };
    const subset = (a: Label, b: Label): boolean => {
      if (bits) return (a.visitedMask! & b.visitedMask!) === a.visitedMask;
      const nodes = new Set<string>(); for (let p: Label | undefined = b; p; p = p.previous) nodes.add(p.node);
      for (let p: Label | undefined = a; p; p = p.previous) if (!nodes.has(p.node)) return false;
      return true;
    };
    const dominates = (a: Label, b: Label): boolean => a.distance <= b.distance + 1e-7 && a.cost <= b.cost + 1e-7
      && a.bad - .3 * a.distance <= b.bad - .3 * b.distance + 1e-7 && a.road - .1 * a.distance <= b.road - .1 * b.distance + 1e-7 && subset(a, b);
    while (heap.size) {
      const entry = heap.pop(), current = entry.value; if (entry.cost > bestCost + 1e-7) break; if (!current.active) continue;
      expanded++;
      const gap = contacts.get(current.node);
      if (gap !== undefined && this.goalValid(current, gap)) {
        const terminalCost = current.cost + gap;
        if (terminalCost < bestCost - 1e-7 || Math.abs(terminalCost - bestCost) <= 1e-7 && (!best || current.distance + gap < best.distance + contacts.get(best.node)! - 1e-7 || Math.abs(current.distance + gap - best.distance - contacts.get(best.node)!) <= 1e-7 && current.node < best.node)) { best = current; bestCost = terminalCost; }
      }
      if (!solverCalled && this.hardGoalSolver && expanded >= this.hardGoalAfterStates) {
        solverCalled = true;
        const request: HardGoalRequest = { start, edges: [...allowed].sort((a, b) => a - b).map(id => { const edge = this.edges[id]; return { id, from: edge.from, to: edge.to, length: edge.length, named: this.isNamed[edge.segment], road: this.segments[edge.segment].kind === 'road' }; }), contacts: [...contacts].filter(([node]) => corridor.has(node)).map(([node, connector]) => ({ node, connector })), maxDistance: 15000 };
        diagnostic(`Hard objective solver ${objective.name} (${objective.osm_id}): starting after ${expanded} states; ${request.edges.length} edges, ${request.contacts.length} contacts`);
        try {
          const result = this.hardGoalSolver(request);
          if (!result || !['optimal', 'feasible', 'infeasible', 'limit', 'unavailable', 'error'].includes(result.status)) throw new Error('Invalid hard-goal solver status');
          diagnostic(`Hard objective solver ${objective.name} (${objective.osm_id}): ${result.status}; elapsed ${result.elapsed_seconds ?? '?'}s; RSS ${result.max_rss_mib ?? '?'} MiB${result.reason || result.message ? `; ${String(result.reason ?? result.message).slice(0, 500)}` : ''}`);
          if (result.status === 'infeasible') {
            if (!best && !result.path?.length) return { expanded, capacityPruned, priorityPruned };
            diagnostic(`Hard objective solver ${objective.name}: infeasibility contradicts an available path; continuing exact search`);
          } else if (result.status === 'optimal' || result.status === 'feasible' || result.status === 'limit') {
            const solved = this.solverPath(result.path, start, contacts, allowed);
            if (!solved) diagnostic(`Hard objective solver ${objective.name}: invalid or unsuitable path; continuing exact search`);
            else {
              const solvedCost = solved.cost + contacts.get(solved.node)!;
              if (!best || solvedCost < bestCost - 1e-7 || Math.abs(solvedCost - bestCost) <= 1e-7 && (solved.distance + contacts.get(solved.node)! < best.distance + contacts.get(best.node)! - 1e-7 || Math.abs(solved.distance + contacts.get(solved.node)! - best.distance - contacts.get(best.node)!) <= 1e-7 && solved.node < best.node)) best = solved;
              // Discovery needs one qualifying approach. A verified feasible
              // solver walk avoids the extra search to prove minimum cost.
              return { label: best, expanded, capacityPruned, priorityPruned };
            }
          }
        } catch (error) { diagnostic(`Hard objective solver ${objective.name}: ${error instanceof Error ? error.message : String(error)}; continuing exact search`); }
      }
      if (expanded >= this.maxObjectiveStates) return { ...(best ? { label: best } : { exhausted: true }), expanded, capacityPruned, priorityPruned };
      if (expanded % 100000 === 0) diagnostic(`Slow objective fallback ${objective.name} (${objective.osm_id}): ${expanded} states, ${heap.size} queued, ${capacityPruned} named-capacity prunes, ${priorityPruned} resource-cost prunes; RSS ${(process.memoryUsage().rss / 1048576).toFixed(0)} MiB`);
      // Once the walk leaves this node, every unused named edge incident to it
      // becomes unavailable to a simple continuation. Past-past edges already
      // left the capacity when their first endpoint became a past node.
      let leavingNamed = 0;
      for (const arc of this.adjacency.get(current.node) ?? []) if (allowed.has(arc.edge.id) && this.isNamed[arc.edge.segment] && !visited(current, arc.to)) leavingNamed += arc.edge.length;
      const remainingNamed = Math.max(0, current.remainingNamed! - leavingNamed);
      for (const arc of this.adjacency.get(current.node) ?? []) {
        const remainder = physical.get(arc.to), remainingCost = lowerCost.get(arc.to), remainingBad = minBad.get(arc.to), remainingRoad = minRoad.get(arc.to); if (!allowed.has(arc.edge.id) || !corridor.has(arc.to) || remainder === undefined || remainingCost === undefined || remainingBad === undefined || remainingRoad === undefined || visited(current, arc.to)) continue;
        const s = this.segments[arc.edge.segment], distance = current.distance + arc.edge.length, bad = current.bad + (this.isNamed[arc.edge.segment] ? 0 : arc.edge.length), road = current.road + (s.kind === 'road' ? arc.edge.length : 0), cost = current.cost + this.edgeCost(arc.edge);
        if (distance + remainder > 15000 + 1e-6 || bad + remainingBad > badBudget + 1e-6 || road + remainingRoad > 1500 + 1e-6 || cost + remainingCost > Math.min(bestCost, 19950) + 1e-7) continue;
        if (bad + remainingBad > 3 / 7 * (distance - bad + remainingNamed) + 1e-6) { capacityPruned++; continue; }
        const next: Label = { node: arc.to, distance, bad, road, cost, previous: current, arc, active: true, remainingNamed }, list = labels.get(arc.to) ?? [], estimate = priority(next);
        if (estimate > Math.min(bestCost, 19950) + 1e-7) { priorityPruned++; continue; }
        if (bits) next.visitedMask = current.visitedMask! | bits.get(arc.to)!;
        if (list.some(old => old.active && dominates(old, next))) continue;
        const remaining = list.filter(old => { if (dominates(next, old)) { old.active = false; return false; } return true; }); remaining.push(next); labels.set(arc.to, remaining); heap.push(estimate, next);
      }
    }
    return { ...(best ? { label: best } : {}), expanded, capacityPruned, priorityPruned };
  }
  /** Pareto labels preserve shorter alternatives under the physical distance cap.
   * The bad/road dimensions also retain a longer, clean approach when a short
   * unnamed or road shortcut would fail a catalog gate. */
  search(sources: string[], limit: number, allowed?: (e: Edge) => boolean, preferNamed = true, budgets: { bad: number; road: number } = { bad: Infinity, road: Infinity }): Search {
    const labels = new Map<string, Label[]>(), best = new Map<string, Label>(), heap = new MinHeap<Label>();
    for (const node of sources) { const label: Label = { node, distance: 0, bad: 0, road: 0, cost: 0, active: true }; labels.set(node, [label]); best.set(node, label); heap.push(0, label); }
    while (heap.size) {
      const current = heap.pop().value; if (!current.active) continue;
      for (const arc of this.adjacency.get(current.node) ?? []) {
        if (allowed && !allowed(arc.edge)) continue;
        const s = this.segments[arc.edge.segment], distance = current.distance + arc.edge.length;
        if (distance > limit + 1e-6) continue;
        const road = current.road + (preferNamed && s.kind === 'road' ? arc.edge.length : 0);
        const bad = current.bad + (preferNamed && !this.isNamed[arc.edge.segment] ? arc.edge.length : 0);
        if (bad > budgets.bad + 1e-6 || road > budgets.road + 1e-6) continue;
        const cost = distance + bad * 0.6 + road * 1.5;
        const list = labels.get(arc.to) ?? [];
        const dominates = (a: Pick<Label, 'distance' | 'bad' | 'road'>, b: Pick<Label, 'distance' | 'bad' | 'road'>) => a.distance <= b.distance + 1e-7 && a.bad <= b.bad + 1e-7 && a.road <= b.road + 1e-7;
        if (list.some(l => l.active && dominates(l, { distance, bad, road }))) continue;
        const label: Label = { node: arc.to, distance, bad, road, cost, previous: current, arc, active: true };
        const remaining = list.filter(l => { if (dominates(label, l)) { l.active = false; return false; } return true; });
        remaining.push(label); labels.set(arc.to, remaining); heap.push(cost, label);
        if (!best.has(arc.to) || cost < best.get(arc.to)!.cost) best.set(arc.to, label);
      }
    }
    return { labels, best };
  }
  fallback(node: string, name: string): Start { const p = this.positions.get(node)!; return { node, coord: p, vertex: { id: node, coord: p, segment: 0, vertex: 0 }, place: syntheticStart(node, p, name) }; }
}

function mergeSteps(walk: RouteStep[]): RouteStep[] {
  const merged: RouteStep[] = [];
  for (const step of walk) {
    const previous = merged[merged.length - 1];
    if (previous && previous.segment_id === step.segment_id && previous.direction === step.direction && previous.end_vertex === step.start_vertex) { previous.end_vertex = step.end_vertex; previous.length_m += step.length_m; }
    else merged.push({ ...step });
  }
  return merged;
}
function adjacency(edges: Edge[]): Map<string, Arc[]> {
  const map = new Map<string, Arc[]>();
  for (const edge of edges) for (const [from, to, reverse] of [[edge.from, edge.to, false], [edge.to, edge.from, true]] as [string, string, boolean][]) { const list = map.get(from) ?? []; list.push({ edge, to, reverse }); map.set(from, list); }
  return map;
}
function components(edges: Edge[]): Edge[][] {
  const map = adjacency(edges), seen = new Set<number>(), result: Edge[][] = [];
  for (const first of edges) {
    if (seen.has(first.id)) continue;
    const selected: Edge[] = [], queue = [first.from], nodes = new Set(queue);
    for (let i = 0; i < queue.length; i++) for (const arc of map.get(queue[i]) ?? []) {
      if (!seen.has(arc.edge.id)) { seen.add(arc.edge.id); selected.push(arc.edge); }
      if (!nodes.has(arc.to)) { nodes.add(arc.to); queue.push(arc.to); }
    }
    result.push(selected);
  }
  return result.sort((a, b) => b.reduce((n, e) => n + e.length, 0) - a.reduce((n, e) => n + e.length, 0));
}
function chain(graph: DiscoveryGraph, edges: Edge[], start: string): RouteStep[] {
  const map = adjacency(edges), used = new Set<number>(), walk: RouteStep[] = []; let node = start;
  while (used.size < edges.length) { const arc = map.get(node)?.find(a => !used.has(a.edge.id)); if (!arc) break; used.add(arc.edge.id); walk.push(graph.step(arc)); node = arc.to; }
  return mergeSteps(walk);
}
function bestObjective(graph: DiscoveryGraph, node: string): NamedFeature | undefined {
  return [...(graph.objectives.get(node) ?? [])].sort((a, b) => objectiveOrder.indexOf(a.feature) - objectiveOrder.indexOf(b.feature) || a.name.localeCompare(b.name))[0];
}
function routeType(relation: Relation): string | undefined { return (relation as Relation & { route?: string; tags?: Record<string, string> }).route ?? (relation as Relation & { tags?: Record<string, string> }).tags?.route; }

/** Deterministic, seedless enumeration. Searches are local and released between
 * trailheads, and candidates stream to the serializer instead of accumulating. */
export function* discover(input: { segments: Segment[]; features: NamedFeature[]; access: AccessPoint[] }, progress: (message: string) => void = () => {}, options: DiscoveryOptions = {}): Generator<DiscoveryCandidate> {
  progress('Attaching trailheads and objectives');
  const hardGoalAfterStates = options.hardGoalAfterStates ?? 5000;
  if (!Number.isInteger(hardGoalAfterStates) || hardGoalAfterStates < 0) throw new Error('hardGoalAfterStates must be a nonnegative integer');
  const maxObjectiveStates = options.maxObjectiveStates ?? 25000;
  if (!Number.isInteger(maxObjectiveStates) || maxObjectiveStates < 1) throw new Error('maxObjectiveStates must be a positive integer');
  const graph = new DiscoveryGraph(input.segments, input.features, input.access, options.hardGoalSolver, hardGoalAfterStates, maxObjectiveStates), covered = new Set<number>();
  progress(`Discovery graph: ${graph.edges.length} edges, ${graph.starts.length} trailheads, ${graph.featureAt.size} attached features`);
  const markCovered = (walk: RouteStep[]) => {
    const ranges = new Map<string, [number, number][]>();
    for (const s of walk) { const list = ranges.get(s.segment_id) ?? []; list.push([Math.min(s.start_vertex, s.end_vertex), Math.max(s.start_vertex, s.end_vertex)]); ranges.set(s.segment_id, list); }
    for (const [id, intervals] of ranges) for (const e of graph.edgesBySegment.get(id) ?? []) if (intervals.some(([a, b]) => a <= e.a && b >= e.b)) covered.add(e.id);
  };
  const relations = new Map<number, { relation: Relation; edges: Edge[] }>();
  for (const e of graph.edges) for (const r of input.segments[e.segment].relations) {
    if (!r.name?.trim() || (routeType(r) && !['hiking', 'foot'].includes(routeType(r)!)) || !discoveryName(r.name)) continue;
    const entry = relations.get(r.id) ?? { relation: r, edges: [] }; entry.edges.push(e); relations.set(r.id, entry);
  }
  let count = 0;
  for (const { relation, edges } of [...relations.values()].sort((a, b) => a.relation.id - b.relation.id)) {
    const name = discoveryName(relation.name)!, groups = components(edges), reasons: string[] = [];
    if (groups.length > 1) reasons.push(`relation is disconnected (${groups.length} components); only its largest connected component is shown`);
    const selected = groups[0], map = adjacency(selected), ends = [...map].filter(([, arcs]) => arcs.length === 1).map(([node]) => node), branched = [...map.values()].some(arcs => arcs.length > 2);
    if (branched) reasons.push('relation branches; its longest connected approach needs review');
    const loop = !branched && ends.length === 0, candidates = (loop ? [...map.keys()] : ends).flatMap(node => (graph.contacts.get(node) ?? []).map(start => ({ start, node })));
    candidates.sort((a, b) => Number('coord' in a.start.place && !a.start.place.parking) - Number('coord' in b.start.place && !b.start.place.parking) || placeId(a.start.place).localeCompare(placeId(b.start.place)));
    const start = candidates[0]?.start ?? graph.fallback((ends[0] ?? selected[0].from), name);
    if (!candidates.length) reasons.push(loop ? 'closed relation has no road or parking contact' : 'open relation has no road or parking contact at an end');
    let walk: RouteStep[], end: string;
    if (branched) {
      const ids = new Set(selected.map(e => e.id)), search = graph.search([start.node], Infinity, e => ids.has(e.id), false);
      const farthest = [...search.best.values()].sort((a, b) => b.distance - a.distance || a.node.localeCompare(b.node))[0];
      walk = graph.walk(farthest); end = farthest.node;
    } else { walk = chain(graph, selected, start.node); const last = walk[walk.length - 1]; end = last ? graph.byId.get(last.segment_id)!.node_ids[last.end_vertex] : start.node; }
    const objective = loop ? undefined : bestObjective(graph, end), endContact = graph.contacts.get(end)?.[0];
    const shape = loop ? 'loop' : endContact && end !== start.node ? 'point_to_point' : 'out_and_back';
    if (!reasons.length) markCovered(walk);
    yield { source: 'relation', identity: `relation/${relation.id}`, name, shape, walk, trailhead: start.place, trailheadCoord: start.coord, ...(objective ? { objective } : {}), ...(shape === 'point_to_point' ? { endTrailhead: endContact!.place } : {}), preferredNames: [name], relation, junctionNameCount: graph.junctionNameCount(start.node), ...(reasons.length ? { reasons } : {}) };
    if (++count % 250 === 0) progress(`Named relations: ${count}/${relations.size}`);
  }
  progress(`Named relations complete: ${count}`);
  let th = 0, objectives = 0;
  for (const start of graph.starts) {
    const searchStart = Date.now(), junctionNameCount = graph.junctionNameCount(start.node);
    progress(`Objective search ${th + 1}/${graph.starts.length}: ${start.place.name || placeId(start.place)} (${placeId(start.place)}; node ${start.node})`);
    const search = graph.objectivePaths(start.node, progress), elapsed = (Date.now() - searchStart) / 1000;
    if (th % 10 === 0 || elapsed > 5) progress(`Objective search ${th + 1} complete in ${elapsed.toFixed(2)}s: ${search.scalarNodes} scalar nodes, ${search.scalarSettled} scalar settled, ${search.unresolved} fallback goals, ${search.expanded} fallback states, ${search.resourceInfeasible} resource-infeasible, ${search.namedInfeasible} named-infeasible, ${search.maskGoals} mask goals, ${search.ancestorGoals} ancestor goals, ${search.offTargetNodes} off-target nodes, ${search.costExcludedEdges} cost-excluded edges, ${search.badExcludedEdges} bad-excluded edges, ${search.physicalExcludedNodes} physical-excluded nodes, ${search.physicalExcludedEdges} physical-excluded edges, ${search.couplingPasses} coupling passes, ${search.capacityPruned} named-capacity prunes, ${search.priorityPruned} resource-cost prunes, ${search.budgetExhausted} exhausted budgets, ${search.review.size} budget reviews; RSS ${(process.memoryUsage().rss / 1048576).toFixed(0)} MiB`);
    for (const [objective, label] of [...search.goals].sort(([a], [b]) => a.osm_id.localeCompare(b.osm_id))) {
      const walk = graph.walk(label), preferredNames = preferences(walk, graph.namesById), reasons = search.review.get(objective); if (!reasons?.length) markCovered(walk);
      const name = displayName(objective.name)!; if (!name) continue;
      yield { source: 'objective', identity: `${placeId(start.place)}/${objective.osm_id}`, name: preferredNames[0] ? `${name} via ${preferredNames[0]}` : name, shape: 'out_and_back', walk, trailhead: start.place, trailheadCoord: start.coord, objective, preferredNames, junctionNameCount, ...(reasons?.length ? { reasons } : {}) };
      objectives++;
    }
    if (++th % 100 === 0) progress(`Objective approaches: ${th}/${graph.starts.length} trailheads, ${objectives} candidates`);
  }
  progress(`Objective approaches complete: ${objectives}`);
  const namedGroups = new Map<string, { name: string; edges: Edge[] }>();
  for (const e of graph.edges) for (const name of graph.namesBySegment[e.segment]) { const key = trailKey(name); if (!key) continue; const group = namedGroups.get(key) ?? { name, edges: [] }; group.edges.push(e); namedGroups.set(key, group); }
  let trails = 0;
  for (const [key, group] of [...namedGroups].sort(([a], [b]) => a.localeCompare(b))) for (const selected of components(group.edges)) {
    if (selected.reduce((n, e) => n + e.length, 0) < 2000) continue;
    const map = adjacency(selected), ends = [...map].filter(([, arcs]) => arcs.length === 1).map(([node]) => node), ids = new Set(selected.map(e => e.id));
    for (const node of ends) {
      const explicit = graph.startsAt.get(node) ?? [], inferred = explicit.length ? null : graph.findContact(node, 125);
      const starts = explicit.length ? explicit : inferred ? [{ ...graph.fallback(node, group.name), place: inferred.access }] : [];
      for (const start of starts) {
      const search = graph.search([node], Infinity, e => ids.has(e.id), false);
      const destination = ends.filter(n => n !== node).map(n => search.best.get(n)).filter((l): l is Label => !!l).sort((a, b) => b.distance - a.distance || a.node.localeCompare(b.node))[0];
      if (!destination || destination.distance < 2000) continue;
      const walk = graph.walk(destination), used = selected.filter(e => walk.some(s => s.segment_id === input.segments[e.segment].id && Math.min(s.start_vertex, s.end_vertex) <= e.a && Math.max(s.start_vertex, s.end_vertex) >= e.b));
      if (used.reduce((n, e) => n + (covered.has(e.id) ? e.length : 0), 0) >= destination.distance * 0.8) continue;
      const reasons = [...map.values()].some(arcs => arcs.length > 2) ? ['named trail branches; its longest approach needs review'] : [];
      yield { source: 'named_trail', identity: `${key}/${placeId(start.place)}/${destination.node}`, name: group.name, shape: 'out_and_back', walk, trailhead: start.place, trailheadCoord: start.coord, preferredNames: [group.name], junctionNameCount: graph.junctionNameCount(start.node), ...(inferred ? { trailheadEvidence: inferred } : {}), ...(reasons.length ? { reasons } : {}) };
      trails++;
      }
    }
  }
  progress(`Named trails complete: ${trails}`);
  yield* discoverLollipops(graph, progress);
}

/** Build a separate basis for each pair meeting at a junction. A third named
 * trail can otherwise enter the spanning tree and hide a valid two-name loop.
 * Name indexes keep each pair local; its graph is released before the next. */
function* discoverLollipops(graph: DiscoveryGraph, progress: (message: string) => void): Generator<DiscoveryCandidate> {
  const primaryKeys = graph.keysBySegment.map(names => names[0] ?? ''), edgesByName = new Map<string, Edge[]>(), displayNames = new Map<string, string>();
  for (const edge of graph.edges) {
    const key = primaryKeys[edge.segment]; if (!key) continue;
    const list = edgesByName.get(key) ?? []; list.push(edge); edgesByName.set(key, list); displayNames.set(key, graph.namesBySegment[edge.segment][0]);
  }
  const pairs = new Map<string, [string, string]>();
  for (const arcs of graph.adjacency.values()) {
    const keys = [...new Set(arcs.map(arc => primaryKeys[arc.edge.segment]).filter(Boolean))].sort();
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) pairs.set(JSON.stringify([keys[i], keys[j]]), [keys[i], keys[j]]);
  }
  let count = 0, checked = 0, pairCount = 0;
  progress(`Two-trail loop search: ${pairs.size} named pairs`);
  for (const [first, second] of [...pairs.values()].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))) {
    const selected = [...edgesByName.get(first)!, ...edgesByName.get(second)!], map = adjacency(selected);
    for (const around of boundedCycleBasis(map)) {
      checked++;
      if (!around.some(a => primaryKeys[a.edge.segment] === first) || !around.some(a => primaryKeys[a.edge.segment] === second)) continue;
      const cycleLength = around.reduce((n, arc) => n + arc.edge.length, 0), cycleIds = new Set(around.map(arc => arc.edge.id)), cycleNodes = around.map(arc => arc.to), limit = (30000 - cycleLength) / 2;
      const search = graph.search(cycleNodes, limit, e => !cycleIds.has(e.id) && (primaryKeys[e.segment] === first || primaryKeys[e.segment] === second));
      for (const [node, label] of search.best) {
        const starts = graph.startsAt.get(node); if (!starts || label.distance <= 0 || cycleLength + label.distance * 2 < 3000) continue;
        const outward = reversed(graph.walk(label)), join = rootLabel(label).node;
        const index = around.findIndex(arc => (arc.reverse ? arc.edge.to : arc.edge.from) === join); if (index < 0) continue;
        const circuit = [...around.slice(index), ...around.slice(0, index)].map(arc => graph.step(arc));
        const walk = mergeSteps([...outward, ...circuit, ...reversed(outward)]), preferredNames = [displayNames.get(first)!, displayNames.get(second)!].sort((a, b) => a.localeCompare(b));
        const joined = preferredNames.join(' and '), name = /\bloop$/i.test(joined) ? joined : `${joined} Loop`;
        for (const start of starts) {
          yield { source: 'lollipop', identity: `cycle/${[...cycleIds].sort((a, b) => a - b).join(',')}/${placeId(start.place)}`, name, shape: 'loop', walk, trailhead: start.place, trailheadCoord: start.coord, preferredNames, junctionNameCount: graph.junctionNameCount(start.node) };
          count++;
        }
      }
    }
    if (++pairCount % 100 === 0) progress(`Two-trail loops: ${pairCount}/${pairs.size} pairs, ${checked} bounded basis cycles, ${count} lollipops`);
  }
  progress(`Two-trail lollipops complete: ${count}`);
}
/** Fundamental cycles are finite even in dense networks; long parent paths
 * stop as soon as the 30 km whole-loop limit cannot be met. */
function* boundedCycleBasis(map: Map<string, Arc[]>): Generator<Arc[]> {
  const parent = new Map<string, { node: string; arc: Arc }>(), depth = new Map<string, number>(), seenEdges = new Set<number>(), cycles: Edge[] = [];
  for (const root of map.keys()) {
    if (depth.has(root)) continue;
    depth.set(root, 0); const stack = [root];
    while (stack.length) {
      const node = stack.pop()!;
      for (const arc of map.get(node) ?? []) {
        if (seenEdges.has(arc.edge.id)) continue;
        seenEdges.add(arc.edge.id);
        if (depth.has(arc.to)) { cycles.push(arc.edge); continue; }
        depth.set(arc.to, depth.get(node)! + 1); parent.set(arc.to, { node, arc }); stack.push(arc.to);
      }
    }
  }
  for (const closing of cycles) {
    let a = closing.from, b = closing.to, pathLength = closing.length; const left: Arc[] = [], right: Arc[] = [];
    while (a !== b && pathLength <= 30000) {
      if (depth.get(a)! >= depth.get(b)!) { const p = parent.get(a); if (!p) break; left.push({ edge: p.arc.edge, to: p.node, reverse: !p.arc.reverse }); a = p.node; pathLength += p.arc.edge.length; }
      else { const p = parent.get(b); if (!p) break; right.push(p.arc); b = p.node; pathLength += p.arc.edge.length; }
    }
    if (a === b && pathLength <= 30000) yield [...left, ...right.reverse(), { edge: closing, to: closing.from, reverse: true }];
  }
}
function rootLabel(label: Label): Label { let root = label; while (root.previous) root = root.previous; return root; }
