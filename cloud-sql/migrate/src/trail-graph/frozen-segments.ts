import { join } from 'node:path';
import { ndjson } from './io';
import { Grid, hash, haversine, length, lineIndex, midpoint, pointDistance, samples, unique } from './geo';
import { refresh } from './topology';
import type { Coord, Provenance, Segment } from './types';
import { onlyWaPilots } from './pilot-routes';

export interface FrozenSegment {
  id: string; name: string | null; trail_names: string[]; provenance: Provenance;
  route_ids: string[]; coords: number[][];
}
export interface FrozenAudit {
  fixed_segments: number; ignored_pilot_segments: number; removed_length_m: number; changed_segments: number;
  fixed: { id: string; length_m: number; replaced_ids: string[] }[];
}
export async function readFrozenSegments(input: string): Promise<FrozenSegment[]> {
  const result: FrozenSegment[] = [];
  try { for await (const row of ndjson<FrozenSegment>(join(input, 'peaks-snapshot/wa-reviewed-catalog-segments.ndjson'))) result.push(row); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  return result;
}
const fixedNode = (p: Coord) => `fixed-${hash(JSON.stringify(p))}`;
const xy = (p: number[]): Coord => [p[0], p[1]];
/** Frozen lines are whole, directed assets. Remove their covered graph spans,
 * cut the remaining lines at their exact endpoints, and never refresh/reverse
 * the fixed geometry or its provenance. The router may traverse internal
 * junctions for review, but those partial traversals cannot become load plans. */
export function adoptFrozenSegments(source: Segment[], frozen: FrozenSegment[]): { segments: Segment[]; audit: FrozenAudit } {
  const ignored = frozen.filter(f => onlyWaPilots(f.route_ids)).length;
  frozen = frozen.filter(f => !onlyWaPilots(f.route_ids));
  // A prior fixed piece has no per-edge way lineage. Recover original graph
  // cuts from the raw inputs rather than treating its whole-source claim as
  // per-edge provenance or reusing a retired ID.
  if (source.some(s => s.frozen_catalog && onlyWaPilots(s.frozen_catalog.route_ids))) throw new Error('Graph cache contains retired pilot pieces; rebuild the graph from raw inputs before composing');
  const audit: FrozenAudit = { fixed_segments: frozen.length, ignored_pilot_segments: ignored, removed_length_m: 0, changed_segments: 0, fixed: [] };
  if (!frozen.length) return { segments: source, audit };
  const ids = new Set<string>();
  for (const f of frozen) {
    if (ids.has(f.id) || f.coords.length < 2 || f.coords.some(p => p.length !== 3 || !p.every(Number.isFinite))) throw new Error(`Invalid/duplicate frozen segment ${f.id}`);
    ids.add(f.id);
  }
  const lines = frozen.map(f => ({ coords: f.coords.map(xy) })), index = lineIndex(lines), ends = new Grid<{ coord: Coord; id: string }>(), vertices = new Grid<{ coord: Coord; id: string }>();
  for (const line of lines) for (const coord of [line.coords[0], line.coords.at(-1)!]) ends.add(coord, coord, { coord, id: fixedNode(coord) });
  for (const line of lines) for (const coord of line.coords) vertices.add(coord, coord, { coord, id: fixedNode(coord) });
  const snap = (p: Coord, id: string) => {
    const candidates = ends.near(p, 1).map(e => ({ ...e, d: haversine(p, e.coord) })).filter(e => e.d <= 1).sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));
    const interior = vertices.near(p, 1).map(e => ({ ...e, d: haversine(p, e.coord) })).filter(e => e.d <= 1).sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));
    return candidates[0] ?? interior[0] ?? { coord: p, id };
  };
  const replaced = frozen.map(() => new Set<string>()), result: Segment[] = [];
  const covered = (a: Coord, b: Coord): number | undefined => {
    const possible = unique(index.near(midpoint([a, b]), length([a, b]) / 2 + 1).map(e => e.owner));
    return possible.find(owner => [...samples([a, b], 5), { point: a }, { point: b }].every(s =>
      index.near(s.point, 1).some(e => e.owner === owner && pointDistance(s.point, e.a, e.b) <= 1)));
  };
  for (const parent of source) {
    if (ids.has(parent.id)) continue;
    const coords: Coord[] = [], nodes: string[] = [], ways: number[] = [], owners: (number | undefined)[] = [];
    for (let edge = 1; edge < parent.coords.length; edge++) {
      const a = parent.coords[edge - 1], b = parent.coords[edge], d = haversine(a, b);
      const first = snap(a, parent.node_ids[edge - 1]), last = snap(b, parent.node_ids[edge]);
      const cuts: { t: number; coord: Coord; id: string }[] = [{ t: 0, ...first }, { t: 1, ...last }];
      for (const end of ends.near(midpoint([a, b]), d / 2 + 1)) {
        const cos = Math.cos(a[1] * Math.PI / 180), dx = (b[0] - a[0]) * cos, dy = b[1] - a[1];
        const t = (((end.coord[0] - a[0]) * cos) * dx + (end.coord[1] - a[1]) * dy) / (dx * dx + dy * dy || 1);
        if (t > 0 && t < 1 && pointDistance(end.coord, a, b) <= 1 && end.id !== first.id && end.id !== last.id) cuts.push({ t, ...end });
      }
      cuts.sort((x, y) => x.t - y.t || x.id.localeCompare(y.id));
      if (!coords.length) { coords.push(first.coord); nodes.push(first.id); }
      for (let i = 1; i < cuts.length; i++) {
        if (haversine(coords.at(-1)!, cuts[i].coord) < .000001) continue;
        const owner = covered(cuts[i - 1].coord, cuts[i].coord);
        coords.push(cuts[i].coord); nodes.push(cuts[i].id); ways.push(parent.osm_edge_way_ids[edge - 1]); owners.push(owner);
        if (owner !== undefined) { audit.removed_length_m += haversine(cuts[i - 1].coord, cuts[i].coord); replaced[owner].add(parent.id); }
      }
    }
    if (owners.every(o => o === undefined) && JSON.stringify(coords) === JSON.stringify(parent.coords) && JSON.stringify(nodes) === JSON.stringify(parent.node_ids)) { result.push(parent); continue; }
    audit.changed_segments++;
    for (let from = 0; from < owners.length;) {
      if (owners[from] !== undefined) { from++; continue; }
      let to = from + 1; while (to < owners.length && owners[to] === undefined) to++;
      const part = refresh({ ...parent, coords: coords.slice(from, to + 1), node_ids: nodes.slice(from, to + 1), osm_edge_way_ids: parent.osm_edge_way_ids.length ? ways.slice(from, to) : [],
        source_segment_ids: unique([parent.id, ...(parent.source_segment_ids ?? [])]) });
      if (!parent.osm_edge_way_ids.length) part.provenance = parent.provenance;
      if (part.length_m > .001) result.push(part); from = to;
    }
  }
  frozen.forEach((f, i) => {
    const coords = lines[i].coords, node_ids = coords.map(fixedNode), previous = source.find(s => s.id === f.id);
    const segment: Segment = { id: f.id, name: f.name, trail_names: [...f.trail_names], display_name: f.name, kind: 'trail', description: null, description_source_url: null,
      coords, node_ids, start_node: node_ids[0], end_node: node_ids.at(-1)!, length_m: length(coords),
      sac_scale: null, trail_visibility: null, relation_names: [], relations: [], osm_way_ids: [...f.provenance.osm_way_ids], osm_edge_way_ids: coords.slice(1).map(() => f.provenance.osm_way_ids[0]),
      provenance: structuredClone(f.provenance), alt_sources: [], source_segment_ids: unique([...(previous?.source_segment_ids ?? []), ...replaced[i]]),
      frozen_catalog: { route_ids: [...f.route_ids], coords_xyz: f.coords.map(p => [...p]) } };
    result.push(segment); audit.fixed.push({ id: f.id, length_m: segment.length_m, replaced_ids: [...replaced[i]].sort() });
  });
  return { segments: result.sort((a, b) => a.id.localeCompare(b.id)), audit };
}
