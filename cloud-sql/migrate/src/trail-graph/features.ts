import { Grid, haversine, insidePolygon, midpoint, nearest, pointDistance, type Vertex } from './geo';
import { ndjson } from './io';
import type { Coord, Glacier, NamedFeature, Segment, Tags } from './types';

export interface SourceFeature { type: string; id?: number | string; properties: Record<string, any>; geometry: { type: string; coordinates: any } | null }
interface FeatureRecord { feature: NamedFeature; geometry: NonNullable<SourceFeature['geometry']> }
export function featureType(t: Tags): NamedFeature['feature'] | null {
  if (t.highway === 'trailhead') return 'trailhead';
  if (t.mountain_pass === 'yes') return 'pass';
  if (t.natural === 'peak') return 'summit';
  if (t.natural === 'saddle') return 'saddle';
  if (['camp_site', 'camp_pitch'].includes(t.tourism)) return 'campsite';
  if (t.tourism === 'viewpoint') return 'viewpoint';
  if (['alpine_hut', 'wilderness_hut'].includes(t.tourism) || t.building === 'hut') return 'hut';
  if (t.waterway === 'waterfall' || t.natural === 'waterfall') return 'waterfall';
  if (t.natural === 'glacier') return 'glacier';
  if (['ridge', 'arete'].includes(t.natural)) return 'ridge';
  if (t.natural === 'water' || t.water === 'lake') return 'lake';
  return null;
}
function boundaryLines(g: NonNullable<SourceFeature['geometry']>): Coord[][] {
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString' || g.type === 'Polygon') return g.coordinates;
  if (g.type === 'MultiPolygon') return g.coordinates.flat();
  return [];
}
function representative(g: NonNullable<SourceFeature['geometry']>): Coord {
  if (g.type === 'Point') return g.coordinates.slice(0, 2);
  const first = boundaryLines(g)[0];
  if (g.type.includes('LineString')) return midpoint(first);
  // Area-weighted centroid of the exterior, with a safe fallback for degenerate rings.
  let area = 0, x = 0, y = 0;
  for (let i = 1; i < first.length; i++) { const a = first[i - 1], b = first[i], c = a[0] * b[1] - b[0] * a[1]; area += c; x += (a[0] + b[0]) * c; y += (a[1] + b[1]) * c; }
  return Math.abs(area) > 1e-12 ? [x / (3 * area), y / (3 * area)] : midpoint(first);
}
export async function readFeatures(path: string): Promise<{ records: FeatureRecord[]; glaciers: Glacier[]; input: number }> {
  const records = new Map<string, FeatureRecord>(), glaciers: Glacier[] = []; let input = 0;
  for await (const f of ndjson<SourceFeature>(path)) {
    input++; const t = f.properties, g = f.geometry; if (!g) continue;
    if (t.natural === 'glacier' && ['Polygon', 'MultiPolygon'].includes(g.type)) glaciers.push({ name: t.name ?? '', polygons: g.type === 'Polygon' ? [g.coordinates] : g.coordinates });
    const feature = featureType(t); if (!feature || !t.name?.trim()) continue;
    const id = `${t['@type'] ?? (g.type === 'Point' ? 'node' : 'way')}/${t['@id'] ?? f.id}`;
    // Osmium emits both a closed way and its area. Keep its area footprint once.
    if (records.has(id) && !['Polygon', 'MultiPolygon'].includes(g.type)) continue;
    const [lon, lat] = representative(g), rawEle = String(t.ele ?? ''), parsed = parseFloat(rawEle.replace(/,/g, ''));
    const ele = Number.isFinite(parsed) ? parsed * (/ft|feet/i.test(rawEle) ? 0.3048 : 1) : undefined;
    records.set(id, { feature: { osm_id: id, name: t.name, aliases: [...new Set([t['name:en'], ...(t.alt_name?.split(';') ?? [])].filter((s): s is string => !!s && s !== t.name))], feature, lon, lat, ...(ele !== undefined ? { ele } : {}), graph_node: null, graph_distance_m: null,
      ...(['Polygon', 'MultiPolygon'].includes(g.type) ? { boundary: { type: 'MultiPolygon' as const, coordinates: g.type === 'Polygon' ? [g.coordinates] : g.coordinates } } : {}),
      location_method: g.type === 'Point' ? 'osm_point' : g.type.includes('LineString') ? 'line_midpoint' : 'area_centroid' }, geometry: g });
  }
  return { records: [...records.values()], glaciers, input };
}
export function vertexIndex(segments: Segment[]): Grid<Vertex> {
  const grid = new Grid<Vertex>();
  segments.forEach((s, segment) => s.coords.forEach((coord, vertex) => grid.add(coord, coord, { id: s.node_ids[vertex], coord, segment, vertex })));
  return grid;
}
export function featureDistance(point: Coord, f: Pick<NamedFeature, 'lon' | 'lat' | 'boundary'>, includeInterior = false): number {
  if (!f.boundary) return haversine(point, [f.lon, f.lat]);
  if (includeInterior && f.boundary.coordinates.some(rings => insidePolygon(point, rings))) return 0;
  let best = Infinity;
  for (const polygon of f.boundary.coordinates) for (const ring of polygon) for (let i = 1; i < ring.length; i++) best = Math.min(best, pointDistance(point, ring[i - 1], ring[i]));
  return best;
}
export function nearestFeatureVertex(f: Pick<NamedFeature, 'lon' | 'lat' | 'boundary'>, vertices: Grid<Vertex>, radius: number): { value: Vertex; distance: number } | null {
  if (!f.boundary) return nearest(vertices, [f.lon, f.lat], radius);
  let best: { value: Vertex; distance: number } | null = null;
  for (const polygon of f.boundary.coordinates) for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i], centre = midpoint([a, b]);
    for (const value of vertices.near(centre, haversine(a, b) / 2 + radius)) {
      const distance = pointDistance(value.coord, a, b);
      if (distance <= radius && (!best || distance < best.distance || distance === best.distance && value.id < best.value.id)) best = { value, distance };
    }
  } return best;
}
export function attachFeatures(records: FeatureRecord[], segments: Segment[]): NamedFeature[] {
  const vertices = vertexIndex(segments);
  return records.map(({ feature, geometry }) => {
    const f = { ...feature }; let hit = nearest(vertices, [f.lon, f.lat], 50);
    if (geometry.type !== 'Point') {
      // Choose the graph vertex closest to the footprint, rather than a lake's centre.
      let best: { value: Vertex; distance: number } | null = null;
      for (const coords of boundaryLines(geometry)) for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1], b = coords[i], radius = haversine(a, b) / 2 + 50;
        for (const value of vertices.near(midpoint([a, b]), radius)) {
          const distance = pointDistance(value.coord, a, b);
          if (distance <= 50 && (!best || distance < best.distance)) best = { value, distance };
        }
      }
      if (best) { hit = best; f.graph_coord = best.value.coord; f.location_method = 'boundary_nearest_graph'; }
      else if (['Polygon', 'MultiPolygon'].includes(geometry.type)) {
        const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
        const inside = vertices.near([f.lon, f.lat], 50).find(v => polygons.some((rings: Coord[][]) => insidePolygon(v.coord, rings)));
        if (inside) hit = { value: inside, distance: 0 };
      }
    }
    if (hit) { f.graph_node = hit.value.id; f.graph_distance_m = hit.distance; f.graph_coord = hit.value.coord; }
    return f;
  });
}
