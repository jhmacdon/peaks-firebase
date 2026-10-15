import { featureDistance, nearestFeatureVertex } from './features';
import { haversine, nearest, type Vertex, type Grid } from './geo';
import { featureCompatible, normalizeName, placeKey, tokenMatch } from './names';
import type { PeaksDestination, PlaceRef, ResolvedPlace } from './catalog-types';
import type { Coord, NamedFeature } from './types';

export function namedPeaks(name: string, feature: string, peaks: PeaksDestination[]): PeaksDestination[] {
  const key = (value: string) => feature === 'lookout' ? placeKey(value).replace(/\s+lookout$/, '').replace(/\s+(ridge|mountain|peak)$/, '') : placeKey(value);
  return peaks.filter(d => key(d.name) === key(name) && featureCompatible(feature, d.features));
}
export function namedOsm(name: string, feature: string, features: NamedFeature[]): NamedFeature[] {
  return features.filter(f => [f.name, ...(f.aliases ?? [])].some(n => placeKey(n) === placeKey(name)) && featureCompatible(feature, [f.feature]));
}
export function osmRef(f: NamedFeature): PlaceRef {
  return { new: { name: f.name, feature: f.feature, lng: f.lon, lat: f.lat, source: { kind: 'osm', osm_id: f.osm_id }, ...(f.ele === undefined ? {} : { ele: f.ele }), ...(f.boundary ? { boundary: f.boundary } : {}) } };
}
const minGap = (p: Coord, anchors: Coord[]) => anchors.length ? Math.min(...anchors.map(a => haversine(p, a))) : Infinity;
export function resolveTrailhead(name: string, peaks: PeaksDestination[], features: NamedFeature[], starts: Coord[], vertices: Grid<Vertex>): ResolvedPlace | null {
  const named = namedPeaks(name, 'trailhead', peaks).map(d => ({ d, gap: minGap([d.lng, d.lat], starts) })).filter(x => x.gap <= 3000).sort((a, b) => a.gap - b.gap);
  const nearby = peaks.filter(d => d.features.includes('trailhead')).map(d => ({ d, gap: minGap([d.lng, d.lat], starts) })).filter(x => x.gap <= 500).sort((a, b) => a.gap - b.gap);
  const chosen = named[0]?.d ?? nearby[0]?.d;
  if (chosen) {
    const coord: Coord = [chosen.lng, chosen.lat], hit = nearest(vertices, coord, 150);
    return { ref: { peaks_id: chosen.id }, name: chosen.name, feature: 'trailhead', coord, route_coord: hit?.value.coord ?? coord, gap_m: hit?.distance ?? minGraphGap(vertices, coord) };
  }
  const exact = namedOsm(name, 'trailhead', features).filter(f => minGap([f.lon, f.lat], starts) <= 3000);
  const fallback = features.filter(f => f.feature === 'trailhead' && minGap([f.lon, f.lat], starts) <= 500);
  const f = [...exact, ...fallback].sort((a, b) => (exact.includes(a) ? 0 : 1) - (exact.includes(b) ? 0 : 1) || minGap([a.lon, a.lat], starts) - minGap([b.lon, b.lat], starts))[0];
  if (!f) return null;
  const coord: Coord = [f.lon, f.lat], hit = nearest(vertices, coord, 150);
  return { ref: osmRef(f), name: f.name, feature: 'trailhead', coord, route_coord: hit?.value.coord ?? coord, osm: f, gap_m: hit?.distance ?? minGraphGap(vertices, coord) };
}
export function minGraphGap(vertices: Grid<Vertex>, coord: Coord): number {
  for (const radius of [300, 1000, 5000, 20000]) { const hit = nearest(vertices, coord, radius); if (hit) return hit.distance; } return Infinity;
}
export function resolveObjective(name: string, feature: string, peaks: PeaksDestination[], features: NamedFeature[], ends: Coord[], trailhead: Coord, vertices: Grid<Vertex>, aliases: string[] = []): ResolvedPlace | null {
  const matches = (query: string, value: string) => placeKey(query) === placeKey(value) || (feature === 'other' ? normalizeName(value).includes(normalizeName(query)) : tokenMatch(query, value));
  const names = [name, ...aliases], local = features.filter(f => featureCompatible(feature, [f.feature]) && names.some(n => [f.name, ...(f.aliases ?? [])].some(a => matches(n, a))) && (ends.length ? minGap([f.lon, f.lat], ends) <= 5000 : haversine(trailhead, [f.lon, f.lat]) <= 50000));
  const exactOsm = local.filter(f => names.some(n => namedOsm(n, feature, [f]).length));
  const allOsm = (exactOsm.length ? exactOsm : local.filter(f => names.some(n => [f.name, ...(f.aliases ?? [])].some(a => matches(n, a))))).sort((a, b) => haversine(trailhead, [a.lon, a.lat]) - haversine(trailhead, [b.lon, b.lat]));
  // A distant homonym cannot qualify a Peaks row for a different local lake.
  const osm = allOsm.filter(f => !allOsm.length || haversine([f.lon, f.lat], [allOsm[0].lon, allOsm[0].lat]) <= 5000);
  const localPeaks = peaks.filter(d => featureCompatible(feature, d.features) && names.some(n => namedPeaks(n, feature, [d]).length || matches(n, d.name)) && Math.min(minGap([d.lng, d.lat], ends), ...osm.map(f => featureDistance([d.lng, d.lat], f, true))) <= 5000);
  const exactPeaks = localPeaks.filter(d => names.some(n => namedPeaks(n, feature, [d]).length));
  const candidates = (exactPeaks.length ? exactPeaks : localPeaks.filter(d => names.some(n => matches(n, d.name)))).map(d => {
    const p: Coord = [d.lng, d.lat], sourceGap = Math.min(minGap(p, ends), ...osm.map(f => featureDistance(p, f, true)));
    return { d, sourceGap, distance: haversine(trailhead, p) };
  }).filter(x => x.sourceGap <= 5000).sort((a, b) => a.distance - b.distance);
  const d = candidates[0]?.d;
  const f = d ? osm.filter(f => featureDistance([d.lng, d.lat], f, true) <= 5000).sort((a, b) => featureDistance([d.lng, d.lat], a, true) - featureDistance([d.lng, d.lat], b, true))[0] : osm[0];
  if (!d && !f) return null;
  const coord: Coord = d ? [d.lng, d.lat] : [f!.lon, f!.lat];
  const sourceCoord: Coord = f ? [f.lon, f.lat] : coord;
  const hit = f?.boundary ? nearestFeatureVertex(f, vertices, 150) : nearest(vertices, sourceCoord, feature === 'summit' ? 400 : 150);
  const gap = hit?.distance ?? (f?.boundary ? boundaryGap(f, vertices) : minGraphGap(vertices, sourceCoord));
  return { ref: d ? { peaks_id: d.id } : osmRef(f!), name: d?.name ?? f!.name, feature, coord,
    route_coord: hit?.value.coord ?? coord, ...(f ? { osm: f } : {}), gap_m: gap };
}
function boundaryGap(f: NamedFeature, vertices: Grid<Vertex>): number {
  for (const radius of [300, 1000, 5000]) { const hit = nearestFeatureVertex(f, vertices, radius); if (hit) return hit.distance; } return Infinity;
}
