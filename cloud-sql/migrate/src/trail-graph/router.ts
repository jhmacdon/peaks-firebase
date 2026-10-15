import { Grid, haversine, insidePolygon, length, lineIndex, midpoint, nearest, pointDistance, type Vertex } from './geo';
import { nearestFeatureVertex, vertexIndex } from './features';
import { trailKey } from './names';
import type { Coord, Kind, NamedFeature, Segment } from './types';

export interface RouteOptions { preferNames?: string[]; via?: Endpoint[]; avoidKinds?: Kind[]; featureRadii?: Partial<Record<NamedFeature['feature'], number>>; includeFeatures?: boolean; allowedSegmentIds?: Set<string> }
export type Endpoint = Coord | { lon: number; lat: number; boundary?: NamedFeature['boundary'] } | string;
export interface RouteStep { segment_id: string; direction: 'forward' | 'reverse'; start_vertex: number; end_vertex: number; length_m: number }
interface Edge { to: string; segment: number; start: number; end: number; length: number }
export class MinHeap<T> {
  private entries: { cost: number; value: T }[] = [];
  get size(): number { return this.entries.length; }
  push(cost: number, value: T): void {
    const entry = { cost, value }; let i = this.entries.length; this.entries.push(entry);
    while (i > 0) { const p = (i - 1) >> 1; if (this.entries[p].cost <= cost) break; this.entries[i] = this.entries[p]; i = p; } this.entries[i] = entry;
  }
  pop(): { cost: number; value: T } {
    const first = this.entries[0], last = this.entries.pop()!;
    if (this.entries.length) { let i = 0;
      while (i * 2 + 1 < this.entries.length) { let child = i * 2 + 1;
        if (child + 1 < this.entries.length && this.entries[child + 1].cost < this.entries[child].cost) child++;
        if (this.entries[child].cost >= last.cost) break; this.entries[i] = this.entries[child]; i = child;
      } this.entries[i] = last;
    } return first;
  }
}
const normalize = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export class TrailRouter {
  private graph = new Map<string, Edge[]>();
  private costCache = new Map<string, number[]>();
  private componentWeights: number[] = [];
  public readonly vertices;
  private featureIndex = new Grid<NamedFeature>(1000);
  constructor(public readonly segments: Segment[], public readonly features: NamedFeature[] = []) {
    this.vertices = vertexIndex(segments);
    for (const f of features) {
      const points = f.boundary ? f.boundary.coordinates.flatMap(p => p[0]) : [[f.lon, f.lat]];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
      this.featureIndex.add([minX, minY], [maxX, maxY], f);
    }
    segments.forEach((s, i) => this.add(this.graph, i, 0, s.coords.length - 1));
    const parent = new Map<string, string>();
    const root = (id: string): string => { const p = parent.get(id); if (!p) return id; const r = root(p); parent.set(id, r); return r; };
    for (const s of segments) { const a = root(s.start_node), b = root(s.end_node); if (a !== b) parent.set(a, b); }
    const totals = new Map<string, number>(); for (const s of segments) { const r = root(s.start_node); totals.set(r, (totals.get(r) ?? 0) + s.length_m); }
    this.componentWeights = segments.map(s => totals.get(root(s.start_node))!);
  }
  componentWeight(segment: number): number { return this.componentWeights[segment]; }
  resolve(endpoint: Endpoint): Coord {
    if (Array.isArray(endpoint)) return endpoint;
    if (typeof endpoint === 'object') return [endpoint.lon, endpoint.lat];
    if (/^-?[\d.]+,-?[\d.]+$/.test(endpoint)) return endpoint.split(',').map(Number) as Coord;
    const exact = this.features.filter(f => f.osm_id === endpoint || normalize(f.name) === normalize(endpoint));
    const suggestions = exact.length ? exact : this.features.filter(f => normalize(f.name).includes(normalize(endpoint)));
    if (exact.length !== 1) throw new Error(`Endpoint ${JSON.stringify(endpoint)}: ${exact.length ? 'ambiguous' : 'not found'}; candidates: ${suggestions.slice(0, 15).map(f => `${f.name} (${f.osm_id}; ${f.lon},${f.lat})`).join('; ')}`);
    return [exact[0].lon, exact[0].lat];
  }
  snap(endpoint: Endpoint): { value: Vertex; distance: number } {
    const named = typeof endpoint === 'string' ? this.features.filter(f => f.osm_id === endpoint || normalize(f.name) === normalize(endpoint)) : [];
    const area = typeof endpoint === 'object' && !Array.isArray(endpoint) ? endpoint : named.length === 1 ? named[0] : null;
    if (area?.boundary) {
      const hit = nearestFeatureVertex(area, this.vertices, 150);
      if (!hit) throw new Error('No graph node within 150 m of feature boundary');
      return hit;
    }
    const point = this.resolve(endpoint);
    if (!point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error('Invalid endpoint coordinates');
    const hit = nearest(this.vertices, point, 150);
    if (!hit) throw new Error(`No graph node within 150 m of ${JSON.stringify(endpoint)} (${point.join(',')})`);
    return hit;
  }
  private add(graph: Map<string, Edge[]>, segment: number, start: number, end: number): void {
    const s = this.segments[segment], a = s.node_ids[start], b = s.node_ids[end], m = length(s.coords.slice(start, end + 1));
    const append = (id: string, edge: Edge) => graph.set(id, [...(graph.get(id) ?? []), edge]);
    append(a, { to: b, segment, start, end, length: m }); append(b, { to: a, segment, start: end, end: start, length: m });
  }
  /** Length distances to graph junctions, with an interior source vertex split. */
  networkDistances(from: Endpoint, allowed?: Set<string>): Map<string, number> {
    const snap = this.snap(from).value, distances = new Map<string, number>(), heap = new MinHeap<string>(), source = this.segments[snap.segment];
    if (!allowed || allowed.has(source.id)) for (const i of [0, source.coords.length - 1]) {
      const cost = length(source.coords.slice(Math.min(i, snap.vertex), Math.max(i, snap.vertex) + 1));
      if (cost < (distances.get(source.node_ids[i]) ?? Infinity)) { distances.set(source.node_ids[i], cost); heap.push(cost, source.node_ids[i]); }
    }
    distances.set(snap.id, 0);
    heap.push(0, snap.id);
    while (heap.size) {
      const { value: id, cost } = heap.pop(); if (distances.get(id) !== cost) continue;
      for (const e of this.graph.get(id) ?? []) {
        if (allowed && !allowed.has(this.segments[e.segment].id)) continue;
        const next = cost + e.length; if (next >= (distances.get(e.to) ?? Infinity)) continue;
        distances.set(e.to, next); heap.push(next, e.to);
      }
    }
    return distances;
  }
  route(from: Endpoint, to: Endpoint, options: RouteOptions = {}) {
    const snapped = [from, ...(options.via ?? []), to].map(p => this.snap(p));
    let graph = this.graph; const cuts = new Map<number, Set<number>>();
    for (const { value: v } of snapped) { const set = cuts.get(v.segment) ?? new Set<number>(); set.add(v.vertex); cuts.set(v.segment, set); }
    for (const [i, indices] of cuts) {
      const s = this.segments[i], positions = [...new Set([0, ...indices, s.coords.length - 1])].sort((a, b) => a - b);
      if (positions.length === 2) continue;
      if (graph === this.graph) graph = new Map(this.graph);
      for (const id of [s.start_node, s.end_node]) graph.set(id, (graph.get(id) ?? []).filter(e => e.segment !== i));
      for (let j = 1; j < positions.length; j++) this.add(graph, i, positions[j - 1], positions[j]);
    }
    const steps: RouteStep[] = [], avoid = new Set(options.avoidKinds ?? []), preferences = (options.preferNames ?? []).map(trailKey);
    const key = JSON.stringify(preferences); let multipliers = this.costCache.get(key);
    if (!multipliers) {
      multipliers = this.segments.map(s => {
        const names = preferences.length ? [...s.trail_names, ...s.relation_names].map(trailKey) : [];
        const preferred = !preferences.length || preferences.some(p => names.some(n => n === p || (` ${n} `).includes(` ${p} `)));
        return (preferred ? 1 : 1.6) * (s.kind === 'road' ? 2.5 : 1);
      });
      if (this.costCache.size >= 32) this.costCache.delete(this.costCache.keys().next().value!);
      this.costCache.set(key, multipliers);
    }
    for (let leg = 1; leg < snapped.length; leg++) {
      const start = snapped[leg - 1].value.id, end = snapped[leg].value.id;
      if (start === end) continue;
      const distances = new Map([[start, 0]]), previous = new Map<string, { from: string; edge: Edge }>(), heap = new MinHeap<string>(); heap.push(0, start);
      let reached = false;
      while (heap.size) {
        const { value: id, cost } = heap.pop(); if (cost !== distances.get(id)) continue;
        if (id === end) { reached = true; break; }
        for (const edge of graph.get(id) ?? []) {
          if (avoid.has(this.segments[edge.segment].kind)) continue;
          if (options.allowedSegmentIds && !options.allowedSegmentIds.has(this.segments[edge.segment].id)) continue;
          const next = cost + edge.length * multipliers[edge.segment];
          if (next >= (distances.get(edge.to) ?? Infinity)) continue;
          distances.set(edge.to, next); previous.set(edge.to, { from: id, edge }); heap.push(next, edge.to);
        }
      }
      if (!reached) throw new Error(`Disconnected graph on leg ${leg}: ${start} -> ${end} (${distances.size} reachable nodes)`);
      const reverse: RouteStep[] = []; let cursor = end;
      while (cursor !== start) { const step = previous.get(cursor)!, e = step.edge;
        reverse.push({ segment_id: this.segments[e.segment].id, direction: e.start < e.end ? 'forward' : 'reverse', start_vertex: e.start, end_vertex: e.end, length_m: e.length }); cursor = step.from;
      }
      for (const step of reverse.reverse()) {
        const previous = steps[steps.length - 1];
        if (previous && previous.segment_id === step.segment_id && previous.direction === step.direction && previous.end_vertex === step.start_vertex) {
          previous.end_vertex = step.end_vertex; previous.length_m += step.length_m;
        } else steps.push(step);
      }
    }
    return this.summarize(steps, options.featureRadii, snapped.map(s => ({ node: s.value.id, distance_m: s.distance })), options.includeFeatures !== false);
  }
  summarize(steps: RouteStep[], radii: RouteOptions['featureRadii'] = {}, snaps: { node: string; distance_m: number }[] = [], includeFeatures = true) {
    if (!includeFeatures) return { segments: steps, total_length_m: steps.reduce((n, s) => n + s.length_m, 0), features: [] as (NamedFeature & { distance_along_m: number; distance_from_route_m: number })[], snaps };
    const byId = new Map(this.segments.map(s => [s.id, s]));
    const lines = steps.map(s => {
      const coords = byId.get(s.segment_id)!.coords.slice(Math.min(s.start_vertex, s.end_vertex), Math.max(s.start_vertex, s.end_vertex) + 1);
      return { coords: s.direction === 'forward' ? coords : coords.reverse() };
    });
    const index = lineIndex(lines), offsets: number[] = []; let total = 0;
    const candidates = new Set<NamedFeature>();
    for (let i = 0; i < steps.length; i++) {
      offsets.push(total); total += steps[i].length_m;
      for (const p of lines[i].coords) for (const f of this.featureIndex.near(p, 150)) candidates.add(f);
    }
    const passed: (NamedFeature & { distance_along_m: number; distance_from_route_m: number })[] = [];
    for (const f of candidates) {
      const radius = radii[f.feature] ?? 30; let best = radius + 0.000001, along = Infinity;
      const consider = (distance: number, position: number) => {
        if (distance < best - 0.001 || Math.abs(distance - best) <= 0.001 && position < along) { best = distance; along = position; }
      };
      if (f.boundary) {
        lines.forEach((line, owner) => { let before = offsets[owner];
          for (let i = 0; i < line.coords.length; i++) {
            if (i) before += haversine(line.coords[i - 1], line.coords[i]);
            if (f.boundary!.coordinates.some(rings => insidePolygon(line.coords[i], rings))) { consider(0, before); break; }
          }
        });
        for (const polygon of f.boundary.coordinates) for (const ring of polygon) for (let j = 1; j < ring.length; j++) {
          const a = ring[j - 1], b = ring[j];
          for (const edge of index.near(midpoint([a, b]), haversine(a, b) / 2 + radius)) {
            consider(segmentDistance(a, b, edge.a, edge.b), offsets[edge.owner] + edge.offset_m + haversine(edge.a, edge.b) * projection(a, edge.a, edge.b));
          }
        }
      } else {
        const point: Coord = [f.lon, f.lat];
        for (const edge of index.near(point, radius)) consider(pointDistance(point, edge.a, edge.b), offsets[edge.owner] + edge.offset_m + haversine(edge.a, edge.b) * projection(point, edge.a, edge.b));
      }
      if (best <= radius) passed.push({ ...f, distance_along_m: Math.max(0, Math.min(total, along)), distance_from_route_m: best });
    }
    passed.sort((a, b) => a.distance_along_m - b.distance_along_m || a.name.localeCompare(b.name));
    return { segments: steps, total_length_m: total, features: passed, snaps };
  }
}
function projection(p: Coord, a: Coord, b: Coord): number {
  const cos = Math.cos(p[1] * Math.PI / 180), dx = (b[0] - a[0]) * cos, dy = b[1] - a[1];
  return Math.max(0, Math.min(1, (((p[0] - a[0]) * cos) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
}
function segmentDistance(a: Coord, b: Coord, c: Coord, d: Coord): number {
  const cross = (p: Coord, q: Coord, r: Coord) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return 0;
  return Math.min(pointDistance(a, c, d), pointDistance(b, c, d), pointDistance(c, a, b), pointDistance(d, a, b));
}
