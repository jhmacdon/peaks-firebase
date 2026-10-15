import { Grid, haversine, nearest } from './geo';
import { vertexIndex } from './features';
import { namedOsm, namedPeaks, osmRef } from './compose-resolve';
import { tokenMatch, trailKey } from './names';
import type { AccessPoint, CatalogInputs, ResolvedPlace, Seed } from './catalog-types';
import type { Coord, Segment } from './types';
import type { TrailRouter } from './router';

export function accessIndex(points: AccessPoint[]): Grid<AccessPoint> {
  const index = new Grid<AccessPoint>(150); for (const p of points) index.add(p.coord, p.coord, p); return index;
}
export function resolveAccessTrailhead(seed: Seed, input: CatalogInputs, segments: Segment[], road: Grid<AccessPoint>, router: TrailRouter, target: Coord | null, wide: boolean, anchor: Coord | null = null, firstIds?: Set<string>): ResolvedPlace | null {
  if (!segments.length) return null;
  const vertices = vertexIndex(segments), hit = (p: Coord, radius = 150) => nearest(vertices, p, radius);
  const targetHit = target ? hit(target, 5000) : null;
  const reachable = targetHit ? router.networkDistances(targetHit.value.coord) : null;
  type Candidate = { place: ResolvedPlace; rank: number; gap: number; support: number };
  const candidates: Candidate[] = [];
  const add = (place: ResolvedPlace, rank: number) => {
    const choices = vertices.near(place.coord, 150).map(v => ({ value: v, distance: haversine(place.coord, v.coord) })).filter(h => h.distance <= 150);
    // A named parking spur can be closer than the connected hiking path.
    const connected = choices.filter(h => !reachable || reachable.has(h.value.id) || reachable.has(segments[h.value.segment].start_node));
    const pool = connected.length ? connected : choices;
    const weight = (h: typeof pool[number]) => router.componentWeight(router.snap(h.value.coord).value.segment);
    const largest = pool.reduce((n, h) => Math.max(n, weight(h)), 0);
    const h = pool.filter(h => reachable || weight(h) >= largest * 0.5).sort((a, b) => a.distance - b.distance)[0]; if (!h) return;
    const support = seed.trails.filter(n => segments.some(s => [...s.trail_names, ...s.relation_names].some(a => trailKey(a) === trailKey(n)) && s.coords.some(p => haversine(p, place.coord) <= 500))).length;
    if (anchor && rank >= 4 && haversine(anchor, place.coord) > 500) return;
    candidates.push({ place: { ...place, route_coord: h.value.coord, gap_m: h.distance }, rank, support, gap: anchor ? haversine(h.value.coord, anchor) : target ? haversine(h.value.coord, target) : h.distance });
  };
  for (const d of input.destinations.filter(d => d.features.includes('trailhead'))) {
    const exact = namedPeaks(seed.trailhead.name, 'trailhead', [d]).length > 0;
    const shared = tokenMatch(seed.trailhead.name, d.name), coord: Coord = [d.lng, d.lat];
    if (hit(coord, exact ? 3000 : shared ? 5000 : 500)) add({ ref: { peaks_id: d.id }, name: d.name, feature: 'trailhead', coord, route_coord: coord, gap_m: 0 }, exact ? 0 : shared ? 2 : 4);
  }
  for (const f of input.features.filter(f => f.feature === 'trailhead')) {
    const exact = namedOsm(seed.trailhead.name, 'trailhead', [f]).length > 0, shared = tokenMatch(seed.trailhead.name, f.name), coord: Coord = [f.lon, f.lat];
    if (hit(coord, exact ? 3000 : shared ? 5000 : 500)) add({ ref: osmRef(f), name: f.name, feature: 'trailhead', coord, route_coord: coord, gap_m: 0, osm: f }, exact ? 1 : shared ? 3 : 5);
  }
  for (const p of input.access ?? []) if (p.parking && p.name && tokenMatch(seed.trailhead.name, p.name) && hit(p.coord, 5000)) {
    add({ ref: { new: { name: seed.trailhead.name, feature: 'trailhead', lng: p.coord[0], lat: p.coord[1], source: { kind: 'inferred_road_contact', osm_id: p.osm_id, access_name: p.name } } }, name: seed.trailhead.name, feature: 'trailhead', coord: p.coord, route_coord: p.coord, gap_m: 0 }, 3);
  }
  candidates.sort((a, b) => a.rank - b.rank || b.support - a.support || a.gap - b.gap);
  if (candidates.length) return candidates[0].place;
  const ids = new Set(segments.map(s => s.id)), distances = targetHit ? router.networkDistances(targetHit.value.coord, ids) : new Map<string, number>();
  const contacts: { coord: Coord; id: string; source: Segment; access: AccessPoint; parking: AccessPoint | null; distance: number; network: number }[] = [], seen = new Set<string>();
  for (const s of segments) for (const vertex of [0, s.coords.length - 1]) {
    if (wide && !anchor && firstIds && !firstIds.has(s.id)) continue;
    const id = s.node_ids[vertex]; if (seen.has(id)) continue; seen.add(id);
    const coord = s.coords[vertex], p = nearest(road, coord, 150); if (!p) continue;
    const parking = road.near(coord, 150).filter(a => a.parking && haversine(a.coord, coord) <= 150).sort((a, b) => haversine(a.coord, coord) - haversine(b.coord, coord))[0] ?? null;
    const network = distances.get(id) ?? Infinity; if (targetHit && !Number.isFinite(network)) continue;
    if (anchor && haversine(coord, anchor) > 3000) continue;
    contacts.push({ coord, id, source: s, access: p.value, parking, distance: parking ? haversine(coord, parking.coord) : p.distance, network });
  }
  contacts.sort((a, b) => anchor ? haversine(a.coord, anchor) - haversine(b.coord, anchor) || a.distance - b.distance : target ? (wide ? a.network - b.network : b.network - a.network) || Number(!!b.parking) - Number(!!a.parking) || a.distance - b.distance : Number(!!b.parking) - Number(!!a.parking) || a.distance - b.distance);
  const c = contacts[0]; if (!c) return null;
  const p = c.parking ?? c.access;
  return { ref: { new: { name: seed.trailhead.name, feature: 'trailhead', lng: p.coord[0], lat: p.coord[1], source: { kind: 'inferred_road_contact', osm_id: p.osm_id, node_id: c.id, access_name: p.name, access_gap_m: haversine(p.coord, c.coord), provenance: c.source.provenance } } }, name: seed.trailhead.name, feature: 'trailhead', coord: p.coord, route_coord: c.coord, gap_m: haversine(p.coord, c.coord) };
}
