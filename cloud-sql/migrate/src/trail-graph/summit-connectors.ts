import { hash, haversine, interpolate, length, unique, insidePolygon, lineIndex, midpoint } from './geo';
import { featureDistance } from './features';
import { segmentDistance } from './router';
import { placeKey } from './names';
import { refresh } from './topology';
import { peaksLegacyProvenance } from './source-provenance';
import { projection, routeLine } from './stretches';
import type { ComposedRoute, PeaksDestination, PlaceRef, Waypoint } from './catalog-types';
import type { Coord, NamedFeature, Segment } from './types';

export const SUMMIT_CONTACT_M = 5;
export const SUMMIT_CONNECTOR_LIMIT_M = 75;
/** A destination-kind route cannot publish against a Peaks summit objective.
 * Correct that resolved type conflict before considering endpoint geometry;
 * loops/traverses still follow their own objective/contact rules. */
export function alignSummitKind(row: ComposedRoute, destination?: PeaksDestination): void {
  if (row.kind === 'summit' && destination && row.objective?.peaks_id === destination.id && !destination.features.includes('summit') && destination.features.some(f => ['fire-lookout', 'lookout', 'hut'].includes(f))) {
    row.kind = 'destination'; row.notes = unique([...(row.notes ?? []), `Resolved Peaks objective ${destination.name} is a lookout/hut; use destination route kind.`]);
  }
  if (row.kind === 'destination' && destination?.features.includes('summit') && row.objective?.peaks_id === destination.id) {
    row.kind = 'summit'; row.notes = unique([...(row.notes ?? []), `Resolved Peaks objective ${destination.name} is a summit; use summit route kind instead of seed destination kind.`]);
  }
}
export function alignTraverseObjective(row: ComposedRoute): void {
  if (row.kind === 'traverse' && !row.objective && row.end_trailhead) {
    row.objective = row.end_trailhead;
    row.notes = unique([...(row.notes ?? []), 'Traverse objective is its contacted far trailhead.']);
  }
}
/** Only the objective can authorize a connector. Intermediate summit links are
 * filtered against the resulting path; they never authorize spurs. */
export function appendSummitConnector(row: ComposedRoute, byId: Map<string, Segment>, destination?: PeaksDestination): Segment | null {
  if (row.kind !== 'summit' || !destination?.features.includes('summit') || row.objective?.peaks_id !== destination.id || !row.segments.length) return null;
  const ref = row.segments.at(-1)!, parent = byId.get(ref.id)!, at = ref.direction === 'forward' ? parent.coords.length - 1 : 0;
  const from = parent.coords[at], to: Coord = [destination.lng, destination.lat], gap = haversine(from, to);
  if (gap <= SUMMIT_CONTACT_M) return null;
  if (gap > SUMMIT_CONNECTOR_LIMIT_M) {
    const reason = `summit connector refused: ${destination.name} end gap ${gap.toFixed(1)} m >75 m`;
    row.reasons = unique([...row.reasons, reason]); if (row.status === 'ok') row.status = 'review'; return null;
  }
  const end = `peaks-summit-${destination.id}`, start = parent.node_ids[at], coords: Coord[] = [[...from], interpolate(from, to, .5), to];
  const retrievedAt = [...row.segments].reverse().map(r => byId.get(r.id)!.provenance.retrieved_at).find(t => Number.isFinite(Date.parse(t))) ?? new Date().toISOString();
  const source = { ...peaksLegacyProvenance(retrievedAt), source_kind: 'peaks-derived' };
  const segment = refresh({ id: '', name: null, display_name: null, description: 'summit connector', description_source_url: null,
    trail_names: [], relation_names: [], relations: [], kind: 'xc', sac_scale: null, trail_visibility: null,
    coords, node_ids: [start, `peaks-derived-${hash(JSON.stringify([from, to]))}`, end], osm_way_ids: [], osm_edge_way_ids: [],
    start_node: '', end_node: '', length_m: 0, provenance: source, alt_sources: [],
    summit_connector: { destination_id: destination.id, destination_coord: to, from: [...from], gap_m: gap, note: 'summit connector' } });
  segment.id = `wa-summit-connector-${hash(JSON.stringify([destination.id, segment.coords, segment.node_ids]))}`;
  const existing = byId.get(segment.id); if (!existing) byId.set(segment.id, segment);
  row.segments.push({ id: segment.id, direction: segment.node_ids[0] === start ? 'forward' : 'reverse' });
  const total = row.length_m + segment.length_m;
  row.preferred_fraction *= row.length_m / total; row.road_fraction *= row.length_m / total;
  row.waypoints.forEach(w => { w.fraction *= row.length_m / total; });
  row.length_m = total; row.route_end = to;
  row.notes = unique([...(row.notes ?? []), `summit connector: ${gap.toFixed(1)} m to ${destination.name}; Peaks-derived straight line, elevation pending`]);
  return existing ?? segment;
}

export function legacyWaypoints(places: PeaksDestination[], trailhead: PlaceRef | null, objective: PlaceRef | null): Waypoint[] {
  return places.filter(p => p.id !== trailhead?.peaks_id && p.id !== objective?.peaks_id).map(p => ({ peaks_id: p.id, name: p.name,
    feature: p.features.includes('summit') ? 'summit' : p.features[0] ?? 'landform', lng: p.lng, lat: p.lat,
    fraction: 0, osm_id: `peaks/${p.id}`, distance_from_route_m: 0 }));
}
/** Route destination manifests describe contact with the new path. The legacy
 * links are audit inputs, never SQL links to preserve without checking. */
export function finalizePlaceLinks(row: ComposedRoute, byId: Map<string, Segment>, peaks: Map<string, PeaksDestination>, legacyPlaces: PeaksDestination[] = [], features: NamedFeature[] = []): void {
  if (!row.segments.length) return;
  const line = routeLine(row, byId), total = length(line);
  const index = lineIndex([{ coords: line }]);
  const featureContact = (feature: NamedFeature, radius: number): { distance: number; along: number } => {
    if (!feature.boundary) return projection([feature.lon, feature.lat], line);
    let along = 0;
    for (let i = 0; i < line.length; i++) {
      if (i) along += haversine(line[i - 1], line[i]);
      if (feature.boundary.coordinates.some(rings => insidePolygon(line[i], rings))) return { distance: 0, along };
    }
    let best = { distance: Infinity, along: 0 };
    for (const polygon of feature.boundary.coordinates) for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i];
      for (const edge of index.near(midpoint([a, b]), haversine(a, b) / 2 + radius)) {
        const distance = segmentDistance(a, b, edge.a, edge.b);
        if (distance < best.distance) best = { distance, along: edge.offset_m + projection(a, [edge.a, edge.b]).along };
      }
    }
    return best;
  };
  const dropped = [...(row.dropped_links ?? [])];
  const drop = (id: string, name: string, gap: number, reason: string) => { if (!dropped.some(d => d.id === id)) dropped.push({ id, name, gap_m: gap, reason }); };
  const point = (ref: PlaceRef): Coord | undefined => { const p = ref.peaks_id ? peaks.get(ref.peaks_id) : ref.new; return p ? [p.lng, p.lat] : undefined; };
  const boundaryGap = (p: Coord, name: string): number => {
    const local = features.filter(f => f.boundary && f.name.toLowerCase() === name.toLowerCase() && haversine(p, [f.lon, f.lat]) < 5000);
    return Math.min(Infinity, ...local.flatMap(f => f.boundary!.coordinates.flatMap(poly => poly.map(ring => projection(p, ring).distance))));
  };
  const summit = (ref: PlaceRef, feature?: string) => feature === 'summit' || (ref.peaks_id ? peaks.get(ref.peaks_id)?.features.includes('summit') : ref.new?.feature === 'summit');
  row.waypoints = row.waypoints.filter(w => {
    const p = point(w) ?? [w.lng, w.lat] as Coord, isSummit = summit(w, w.feature), limit = isSummit ? 5 : ['campsite', 'glacier'].includes(w.feature) ? 35 : 30;
    let hit: { distance: number; along: number } = projection(p, line);
    // Source area footprints prove passage even when their centroids are far
    // away. A Peaks area with only has_boundary in the snapshot can use its
    // nearby, same-name mapped source place (e.g. Camp Muir). Summit contacts
    // always use the exact Peaks point and never this area/source fallback.
    if (!isSummit) {
      const area = w.peaks_id && peaks.get(w.peaks_id)?.has_boundary;
      const sources = features.filter(f => f.osm_id === w.osm_id || area && placeKey(f.name) === placeKey(w.name) && featureDistance(p, f, true) <= 300);
      for (const f of sources) { const contact = featureContact(f, limit); if (contact.distance < hit.distance) hit = contact; }
    }
    w.fraction = total ? hit.along / total : 0; w.distance_from_route_m = hit.distance;
    if (hit.distance <= limit) return true;
    drop(w.peaks_id ?? w.osm_id, w.name, hit.distance, `new path does not contact waypoint within ${limit} m`); return false;
  });
  const check = (key: 'trailhead' | 'objective' | 'end_trailhead', end: Coord) => {
    const ref = row[key]; if (!ref) return;
    const p = point(ref); if (!p) return;
    const d = ref.peaks_id ? peaks.get(ref.peaks_id) : ref.new, name = d?.name ?? ref.peaks_id!;
    const isSummit = summit(ref), limit = isSummit ? 5 : key === 'trailhead' || key === 'end_trailhead' ? 125 : 250;
    // Named area objectives use their available source boundary, rather than a
    // centroid which can lie kilometres beyond a shoreline route endpoint.
    const area = key === 'objective' && !isSummit && (ref.new?.boundary || ref.peaks_id && peaks.get(ref.peaks_id)?.has_boundary);
    const contact = key === 'objective' && ['loop', 'traverse'].includes(row.kind) ? projection(p, line).coord : end;
    const gap = area ? Math.min(haversine(p, contact), boundaryGap(contact, name)) : haversine(p, contact);
    if (gap <= limit) return;
    drop(ref.peaks_id ?? ref.new!.source.osm_id ?? name, name, gap, `new path does not contact ${key} within ${limit} m`);
    row[key] = null; const reason = `${key} contact ${name} ${gap.toFixed(1)} m >${limit} m`;
    row.reasons = unique([...row.reasons, reason]); if (row.status === 'ok') row.status = 'review';
  };
  check('trailhead', line[0]); check('objective', line.at(-1)!); if (row.end_trailhead) check('end_trailhead', line.at(-1)!);
  const retained = new Set([row.trailhead?.peaks_id, row.objective?.peaks_id, row.end_trailhead?.peaks_id, ...row.waypoints.map(w => w.peaks_id)]);
  for (const p of legacyPlaces) if (!retained.has(p.id)) drop(p.id, p.name, projection([p.lng, p.lat], line).distance, 'legacy link absent from contacted composition');
  if (dropped.length) row.dropped_links = dropped;
  row.waypoints.sort((a, b) => a.fraction - b.fraction || a.name.localeCompare(b.name));
}
