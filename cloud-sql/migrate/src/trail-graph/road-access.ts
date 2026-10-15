import { Grid, haversine, length } from './geo';
import { lines } from './io';
import { parseOpl } from './opl';
import type { Coord, Segment, Way } from './types';
import { buildTopology, refresh } from './topology';
import { MinHeap } from './router';
import type { AccessPoint } from './catalog-types';

/** The extract contains only roads/parking and their referenced nodes. Keep exact
 * road vertices near graph junctions/ends, and all parking features. Two streaming
 * passes retain parking way references rather than the million road ways. */
export async function readRoadAccess(path: string, segments: Segment[]) {
  const junctions = new Grid<Coord>(200), seen = new Set<string>();
  for (const s of segments) for (const i of [0, s.coords.length - 1]) if (!seen.has(s.node_ids[i])) {
    seen.add(s.node_ids[i]); junctions.add(s.coords[i], s.coords[i], s.coords[i]);
  }
  const points: AccessPoint[] = [], parkingWays: { id: number; name?: string; nodes: number[] }[] = [], roadWays: Way[] = [];
  const existingWays = new Set(segments.flatMap(s => s.osm_way_ids));
  const candidateNodes = new Set<string>(), publicNodes = new Set<string>();
  let inputNodes = 0, inputWays = 0;
  for await (const line of lines(path)) {
    if (line[0] === 'n') {
      inputNodes++;
      const x = / x(-?[\d.]+)(?: |$)/.exec(line), y = / y(-?[\d.]+)(?: |$)/.exec(line);
      if (!x || !y) continue;
      const coord: Coord = [Number(x[1]), Number(y[1])], parking = /(?: T|,)amenity=parking(?:,| |$)/.test(line);
      if (!parking && !junctions.near(coord, 160).some(p => haversine(p, coord) <= 150)) continue;
      const r = parseOpl(line);
      if (['private', 'no'].includes(r.tags.access)) continue;
      points.push({ osm_id: `node/${r.id}`, coord, parking, ...(r.tags.name ? { name: r.tags.name } : {}) });
      if (!parking) candidateNodes.add(String(r.id));
    } else if (line[0] === 'w') {
      inputWays++;
      const r = parseOpl(line);
      if (r.tags.highway && !['motorway', 'motorway_link'].includes(r.tags.highway) && !['private', 'no'].includes(r.tags.access) && !['private', 'no'].includes(r.tags.foot)) for (const n of r.nodes) if (candidateNodes.has(String(n))) publicNodes.add(String(n));
      if (!existingWays.has(r.id) && r.tags.highway && !['motorway', 'motorway_link', 'trunk', 'trunk_link', 'footway', 'path', 'steps', 'bridleway', 'cycleway'].includes(r.tags.highway) && !['private', 'no'].includes(r.tags.access) && !['private', 'no'].includes(r.tags.foot) && r.nodes.some(n => candidateNodes.has(String(n)))) roadWays.push({ id: r.id, nodes: r.nodes, tags: r.tags, relations: [] });
      if (r.tags.amenity !== 'parking') continue;
      if (!['private', 'no'].includes(r.tags.access)) parkingWays.push({ id: r.id, name: r.tags.name, nodes: r.nodes });
    }
  }
  const required = new Set([...parkingWays, ...roadWays].flatMap(w => w.nodes)), coords = new Map<number, Coord>();
  for await (const line of lines(path)) if (line[0] === 'n') {
    const id = Number(line.slice(1, line.indexOf(' '))); if (!required.has(id)) continue;
    const r = parseOpl(line); if (r.coord) coords.set(id, r.coord);
  }
  for (const w of parkingWays) {
    const ring = [...new Set(w.nodes)].map(n => coords.get(n)).filter((p): p is Coord => !!p);
    if (ring.length !== new Set(w.nodes).size || !ring.length) continue;
    const coord: Coord = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
    points.push({ osm_id: `way/${w.id}`, coord, parking: true, ...(w.name ? { name: w.name } : {}) });
  }
  const links = boundedRoadLinks(roadWays.filter(w => w.nodes.every(n => coords.has(n))), coords, seen);
  const indexed = points.filter(p => p.parking || publicNodes.has(p.osm_id.slice(5)));
  return { points: indexed, links, coords, stats: { input_nodes: inputNodes, input_ways: inputWays, indexed_road_vertices: indexed.filter(p => !p.parking).length, parking_features: indexed.filter(p => p.parking).length, named_parking: indexed.filter(p => p.parking && p.name).length, road_vertex_retention_radius_m: 150, source_road_links: links.length } };
}

/** Recover <=400 m source road stretches between trail contacts, even when
 * the OSM way containing the stretch is much longer. */
export function boundedRoadLinks(ways: Way[], coords: Map<number, Coord>, contacts: Set<string>): Way[] {
  type Edge = { to: number; way: number; index: number; length: number };
  const adjacency = new Map<number, Edge[]>();
  ways.forEach((w, way) => { for (let i = 1; i < w.nodes.length; i++) {
    const a = w.nodes[i - 1], b = w.nodes[i], length = haversine(coords.get(a)!, coords.get(b)!);
    adjacency.set(a, [...(adjacency.get(a) ?? []), { to: b, way, index: i - 1, length }]); adjacency.set(b, [...(adjacency.get(b) ?? []), { to: a, way, index: i - 1, length }]);
  } });
  const used = new Map<number, Set<number>>();
  for (const source of adjacency.keys()) {
    if (!contacts.has(String(source))) continue;
    const distances = new Map([[source, 0]]), previous = new Map<number, { from: number; edge: Edge }>(), heap = new MinHeap<number>(); heap.push(0, source);
    while (heap.size) {
      const { value: n, cost } = heap.pop(); if (cost !== distances.get(n)) continue;
      if (n !== source && contacts.has(String(n))) {
        let cursor = n;
        while (cursor !== source) { const p = previous.get(cursor)!, set = used.get(p.edge.way) ?? new Set<number>(); set.add(p.edge.index); used.set(p.edge.way, set); cursor = p.from; }
        continue;
      }
      for (const e of adjacency.get(n) ?? []) { const next = cost + e.length;
        if (next > 400 || next >= (distances.get(e.to) ?? Infinity)) continue;
        distances.set(e.to, next); previous.set(e.to, { from: n, edge: e }); heap.push(next, e.to);
      }
    }
  }
  const links: Way[] = [];
  for (const [i, indices] of used) {
    const w = ways[i]; let start = -1;
    for (let j = 0; j < w.nodes.length; j++) {
      if (indices.has(j)) { if (start < 0) start = j; }
      else if (start >= 0) { links.push({ ...w, nodes: w.nodes.slice(start, j + 1) }); start = -1; }
    }
  }
  return links;
}

export function attachRoadLinks(segments: Segment[], links: Way[], nodes: Map<number, Coord>, retrieved: string): Segment[] {
  // No straight gap lines: every metre here comes from a public source way.
  const added = buildTopology(links, nodes, [], retrieved); for (const s of added) s.kind = 'road';
  const cuts = new Set(added.flatMap(s => s.node_ids)), split: Segment[] = [];
  const originalContacts = new Set<string>();
  for (const s of segments) for (const id of s.node_ids) if (cuts.has(id)) originalContacts.add(id);
  for (const s of segments) {
    const positions = s.node_ids.flatMap((id, i) => i === 0 || i === s.node_ids.length - 1 || cuts.has(id) ? [i] : []);
    for (let i = 1; i < positions.length; i++) { const a = positions[i - 1], b = positions[i];
      split.push(refresh({ ...s, coords: s.coords.slice(a, b + 1), node_ids: s.node_ids.slice(a, b + 1), osm_edge_way_ids: s.osm_edge_way_ids.slice(a, b) }));
    }
  }
  for (const s of added) {
    const positions = s.node_ids.flatMap((id, i) => i === 0 || i === s.node_ids.length - 1 || originalContacts.has(id) ? [i] : []);
    for (let i = 1; i < positions.length; i++) { const a = positions[i - 1], b = positions[i];
      split.push(refresh({ ...s, coords: s.coords.slice(a, b + 1), node_ids: s.node_ids.slice(a, b + 1), osm_edge_way_ids: s.osm_edge_way_ids.slice(a, b) }));
    }
  }
  return split;
}
