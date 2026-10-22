import { Grid, hash, insidePolygon, interpolate, length, unique } from './geo';
import type { Coord, Glacier, GraphNode, Kind, Provenance, Segment, Way } from './types';
import { stateConfig, type StateCode } from './state';

export const SOURCES = {
  usfs: { url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0', credit: 'USDA Forest Service', license: 'Public domain', licenseUrl: 'https://www.fs.usda.gov/about-agency/disclaimers' },
  nps: { url: 'https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/FeatureServer/0', credit: 'National Park Service', license: 'Public domain', licenseUrl: 'https://www.nps.gov/aboutus/disclaimer.htm' },
  wa_state_parks: { url: 'https://services5.arcgis.com/4LKAHwqnBooVDUlX/ArcGIS/rest/services/Trails/FeatureServer/0', credit: 'Washington State Parks', license: 'WA State Parks open GIS data (retain source credit)', licenseUrl: 'https://parks.wa.gov/' },
};
export function provenance(wayIds: number[], retrievedAt: string, source: keyof typeof SOURCES = 'usfs', featureId?: string, state: StateCode = 'WA'): Provenance {
  if (wayIds.length) return {
    source_kind: 'openstreetmap', source_url: stateConfig(state).osmSourceUrl,
    license_name: 'Open Data Commons Open Database License (ODbL) 1.0', license_url: 'https://opendatacommons.org/licenses/odbl/1-0/',
    attribution: '© OpenStreetMap contributors', retrieved_at: retrievedAt, osm_way_ids: wayIds,
    osm_way_urls: wayIds.map(id => `https://www.openstreetmap.org/way/${id}`), contains_osm_geometry: true,
  };
  const s = SOURCES[source];
  return { source_kind: source, source_url: `${s.url}/query?objectIds=${encodeURIComponent(featureId ?? '')}&f=geojson`, license_name: s.license,
    license_url: s.licenseUrl, attribution: s.credit, retrieved_at: retrievedAt, osm_way_ids: [], osm_way_urls: [], contains_osm_geometry: false };
}
/** Canonical orientation makes the specified endpoint/way hash independent of source direction. */
export function refresh(segment: Segment): Segment {
  if (segment.node_ids[0] > segment.node_ids[segment.node_ids.length - 1]) { segment.node_ids.reverse(); segment.coords.reverse(); segment.osm_edge_way_ids.reverse(); }
  segment.start_node = segment.node_ids[0]; segment.end_node = segment.node_ids[segment.node_ids.length - 1];
  segment.osm_way_ids = [...new Set(segment.osm_edge_way_ids)].sort((a, b) => a - b);
  segment.length_m = length(segment.coords);
  const identity = [segment.start_node, segment.end_node, segment.osm_way_ids];
  const prefix = (segment.state_code ?? 'WA').toLowerCase();
  segment.id = segment.osm_way_ids.length ? `${prefix}-osm-${hash(JSON.stringify(identity))}` : `${prefix}-${segment.provenance.source_kind}-${hash(JSON.stringify([identity, segment.alt_sources, segment.coords]))}`;
  segment.provenance = { ...segment.provenance, osm_way_ids: segment.osm_way_ids,
    osm_way_urls: segment.osm_way_ids.map(id => `https://www.openstreetmap.org/way/${id}`) };
  return segment;
}
export function glacierIndex(glaciers: Glacier[]): Grid<Glacier> {
  const grid = new Grid<Glacier>(1000);
  for (const glacier of glaciers) for (const rings of glacier.polygons) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of rings[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    grid.add([minX, minY], [maxX, maxY], glacier);
  } return grid;
}
export function classify(way: Way, point: Coord, glaciers: Grid<Glacier>): Kind {
  for (const g of glaciers.near(point, 0)) if (g.polygons.some(rings => insidePolygon(point, rings))) return /snowfield/i.test(g.name) ? 'snowfield' : 'glacier';
  // sac_scale never sets a kind: mappers grade a whole way by its hardest move and grade glacier
  // routes by crevasse risk. It still splits segments (see the signature below) and feeds difficulty.
  if (way.tags.highway === 'track' && ['motor_vehicle', 'motorcar', 'vehicle', 'motorcycle'].some(k => ['yes', 'designated', 'permissive', 'destination'].includes(way.tags[k]))) return 'road';
  return 'trail';
}
export function buildTopology(ways: Way[], nodes: Map<number, Coord>, glaciers: Glacier[], retrievedAt: string, state: StateCode = 'WA'): Segment[] {
  const uses = new Map<number, number>(), grid = glacierIndex(glaciers);
  for (const w of ways) for (const id of new Set(w.nodes)) uses.set(id, (uses.get(id) ?? 0) + 1);
  const edges: Segment[] = [], signatures: string[] = [];
  for (const w of ways) {
    const repeated = new Map<number, number>(); w.nodes.forEach(id => repeated.set(id, (repeated.get(id) ?? 0) + 1));
    const kinds: Kind[] = [];
    for (let i = 1; i < w.nodes.length; i++) kinds.push(classify(w, interpolate(nodes.get(w.nodes[i - 1])!, nodes.get(w.nodes[i])!, 0.5), grid));
    const names = unique([w.tags.name, ...(w.tags.alt_name?.split(';') ?? []), ...(w.tags.official_name ? [w.tags.official_name] : [])].filter((s): s is string => !!s?.trim()));
    let start = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      if (i !== w.nodes.length - 1 && (uses.get(w.nodes[i]) ?? 0) < 2 && (repeated.get(w.nodes[i]) ?? 0) < 2 && kinds[i - 1] === kinds[i]) continue;
      const ids = w.nodes.slice(start, i + 1), coords = ids.map(id => nodes.get(id)!);
      const segment: Segment = { id: '', name: w.tags.name ?? null, trail_names: names, kind: kinds[start], state_code: state, sac_scale: w.tags.sac_scale ?? null,
        trail_visibility: w.tags.trail_visibility ?? null, informal: w.tags.informal ?? null, osm_access: Object.fromEntries(['access', 'foot'].filter(key => w.tags[key] !== undefined).map(key => [key, w.tags[key]])), osm_way_ids: [w.id], relation_names: unique(w.relations.map(r => r.name).filter((s): s is string => !!s)), relations: w.relations,
        start_node: '', end_node: '', node_ids: ids.map(String), osm_edge_way_ids: ids.slice(1).map(() => w.id), coords, length_m: 0, provenance: provenance([w.id], retrievedAt, 'usfs', undefined, state), alt_sources: [] };
      if (length(coords) > 0) { edges.push(refresh(segment)); signatures.push(JSON.stringify([names, w.tags.ref ?? null, w.relations, segment.kind, segment.sac_scale, segment.trail_visibility, segment.informal, segment.osm_access])); }
      start = i;
    }
  }
  return joinDegreeTwo(edges, signatures);
}
/** Walk maximal same-identity chains; a degree-3 junction always stops a chain. */
export function joinDegreeTwo(edges: Segment[], signatures?: string[]): Segment[] {
  const keys = signatures ?? edges.map(s => JSON.stringify([s.trail_names, s.relations, s.kind, s.sac_scale, s.trail_visibility, s.informal, s.osm_access]));
  const adjacency = new Map<string, number[]>();
  edges.forEach((s, i) => { for (const id of [s.start_node, s.end_node]) { const a = adjacency.get(id) ?? []; a.push(i); adjacency.set(id, a); } });
  const canContinue = (node: string, i: number) => { const a = adjacency.get(node)!; return a.length === 2 && a[0] !== a[1] && keys[a[0]] === keys[a[1]] && keys[a[0]] === keys[i]; };
  const used = new Set<number>(), result: Segment[] = [];
  const walk = (first: number, start: string) => {
    let i = first, cursor = start; const coords: Coord[] = [], ids: string[] = [], ways: number[] = [];
    while (!used.has(i)) {
      used.add(i); const edge = edges[i], forward = edge.start_node === cursor;
      const points = forward ? edge.coords : [...edge.coords].reverse(), nodes = forward ? edge.node_ids : [...edge.node_ids].reverse();
      coords.push(...(coords.length ? points.slice(1) : points)); ids.push(...(ids.length ? nodes.slice(1) : nodes)); ways.push(...(forward ? edge.osm_edge_way_ids : [...edge.osm_edge_way_ids].reverse()));
      cursor = nodes[nodes.length - 1];
      if (!canContinue(cursor, i)) break;
      const next = adjacency.get(cursor)!.find(e => e !== i)!; if (used.has(next)) break; i = next;
    }
    result.push(refresh({ ...edges[first], coords, node_ids: ids, osm_edge_way_ids: ways }));
  };
  edges.forEach((s, i) => { if (!used.has(i) && (!canContinue(s.start_node, i) || !canContinue(s.end_node, i))) walk(i, !canContinue(s.start_node, i) ? s.start_node : s.end_node); });
  edges.forEach((s, i) => { if (!used.has(i)) walk(i, s.start_node); }); // Pure cycles.
  return result;
}
export function prune(segments: Segment[]): { segments: Segment[]; dropped: { components: number; segments: number; length_m: number; unnamed_components: number; short_components: number }; components: number } {
  const adjacency = new Map<string, number[]>(); segments.forEach((s, i) => [s.start_node, s.end_node].forEach(id => { const a = adjacency.get(id) ?? []; a.push(i); adjacency.set(id, a); }));
  const visited = new Set<number>(), kept: Segment[] = [], dropped = { components: 0, segments: 0, length_m: 0, unnamed_components: 0, short_components: 0 }; let components = 0;
  for (let i = 0; i < segments.length; i++) {
    if (visited.has(i)) continue; components++; const queue = [i], group: Segment[] = []; visited.add(i);
    for (let q = 0; q < queue.length; q++) { const s = segments[queue[q]]; group.push(s);
      for (const id of [s.start_node, s.end_node]) for (const next of adjacency.get(id)!) if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
    const distance = group.reduce((n, s) => n + s.length_m, 0), named = group.some(s => s.trail_names.length || s.relations.length);
    if (named && distance >= 500) for (const s of group) kept.push(s);
    else { dropped.components++; dropped.segments += group.length; dropped.length_m += distance; if (!named) dropped.unnamed_components++; if (distance < 500) dropped.short_components++; }
  } return { segments: kept, dropped, components: components - dropped.components };
}
export function resolveIdCollisions(segments: Segment[]): { collisions: number; duplicates: number } {
  const groups = new Map<string, Segment[]>();
  for (const s of segments) { const group = groups.get(s.id) ?? []; group.push(s); groups.set(s.id, group); }
  let collisions = 0, duplicates = 0; const remove = new Set<Segment>();
  for (const [id, group] of groups) if (group.length > 1) {
    const signatures = new Set<string>();
    for (const s of group) {
      const signature = JSON.stringify([s.node_ids, s.coords]);
      if (signatures.has(signature)) { remove.add(s); duplicates++; continue; }
      signatures.add(signature); s.id = `${id}-${hash(signature).slice(0, 10)}`;
    }
    if (signatures.size > 1) collisions++;
  }
  for (let i = segments.length - 1; i >= 0; i--) if (remove.has(segments[i])) segments.splice(i, 1);
  return { collisions, duplicates };
}
export function graphNodes(segments: Segment[]): GraphNode[] {
  const nodes = new Map<string, GraphNode>();
  const endpoints = new Set(segments.flatMap(s => [s.start_node, s.end_node]));
  for (const s of segments) for (const i of s.node_ids.flatMap((id, i) => endpoints.has(id) ? [i] : [])) {
    const id = s.node_ids[i], previous = nodes.get(id), [lon, lat] = s.coords[i];
    if (previous && (Math.abs(previous.lon - lon) > 1e-9 || Math.abs(previous.lat - lat) > 1e-9)) throw new Error(`Conflicting node geometry: ${id}`);
    nodes.set(id, { id, lon, lat, degree: (previous?.degree ?? 0) + (i > 0 && i < s.coords.length - 1 ? 2 : 1) });
  } return [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
}
