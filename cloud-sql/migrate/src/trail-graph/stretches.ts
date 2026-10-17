import { displayName } from './display-names';
import { hash, haversine, interpolate, length, pointDistance, samples, unique } from './geo';
import { featureCompatible, placeKey } from './names';
import { refresh } from './topology';
import type { ComposedRoute, PeaksDestination, Waypoint } from './catalog-types';
import type { Coord, Kind, NamedFeature, Segment } from './types';

export interface CuratedStretch { display_name: string; kind: Kind; description?: string; segments: string[]; split_at?: string; part?: 'before' | 'after' }
export interface CuratedPoint { name: string; feature: string; match: 'existing' | 'new'; place_at?: string; note?: string }
export interface CuratedRoute { route: string; also_applies_to?: string[]; approximate?: boolean; note?: string; stretches: CuratedStretch[]; points?: CuratedPoint[]; deferred?: string[] }
export interface Curation { routes: CuratedRoute[] }
export interface NamingConflict { segment_id: string; selected: string | null; votes: { name: string | null; routes: string[] }[]; curated?: string }
export interface StretchAudit { conflicts: NamingConflict[]; splits: { parent: string; parts: string[]; waypoint: string; gap_m: number }[]; remapped: { requested: string; resolved: string[] }[]; deferred: string[] }
export const DESTINATION_FEATURES = new Set(['volcano', 'fire-lookout', 'summit', 'trailhead', 'hut', 'lookout', 'lake', 'landform', 'viewpoint', 'waterfall', 'campsite']);
export const principalName = (s: Segment): string | null => s.legacy_tail ? null : s.trail_names[0] || s.relation_names[0] || null;

/** Work on whole runs: several short segments together can exceed 300 m. */
export function smoothNames(refs: ComposedRoute['segments'], byId: Map<string, Segment>): (string | null)[] {
  const names = refs.map(r => principalName(byId.get(r.id)!));
  let changed = true;
  while (changed) {
    changed = false;
    for (let from = 0; from < names.length;) {
      let to = from + 1, metres = byId.get(refs[from].id)!.length_m;
      while (to < names.length && names[to] === names[from]) metres += byId.get(refs[to++].id)!.length_m;
      if (names[from] && from > 0 && to < names.length && metres < 300 && names[from - 1] === names[to] && names[to]) {
        names.fill(names[to], from, to); changed = true;
      }
      from = to;
    }
  }
  return names;
}
export function assignNames(rows: ComposedRoute[], segments: Segment[]): NamingConflict[] {
  const byId = new Map(segments.map(s => [s.id, s])), votes = new Map<string, Map<string | null, Set<string>>>();
  for (const r of rows) {
    const names = smoothNames(r.segments, byId);
    r.segments.forEach((ref, i) => { const choices = votes.get(ref.id) ?? new Map<string | null, Set<string>>(), voters = choices.get(names[i]) ?? new Set<string>();
      voters.add(`${r.seed_index}: ${r.name}`); choices.set(names[i], voters); votes.set(ref.id, choices); });
  }
  const conflicts: NamingConflict[] = [];
  for (const s of segments) {
    if (s.frozen_catalog) continue;
    const options = [...(votes.get(s.id) ?? new Map<string | null, Set<string>>())].sort((a, b) => b[1].size - a[1].size || Number(b[0] === principalName(s)) - Number(a[0] === principalName(s)) || String(a[0]).localeCompare(String(b[0])));
    s.display_name = options[0]?.[0] ?? principalName(s); s.description ??= null; s.description_source_url = null;
    if (options.length > 1) conflicts.push({ segment_id: s.id, selected: s.display_name, votes: options.map(([name, voters]) => ({ name, routes: [...voters].sort() })) });
  }
  return conflicts;
}
export function projection(p: Coord, coords: Coord[]): { coord: Coord; edge: number; t: number; distance: number; along: number } {
  let best = { coord: coords[0], edge: 0, t: 0, distance: Infinity, along: 0 }, offset = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i], x = Math.cos(p[1] * Math.PI / 180), dx = (b[0] - a[0]) * x, dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, (((p[0] - a[0]) * x) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const coord = interpolate(a, b, t), distance = haversine(p, coord), metres = haversine(a, b);
    if (distance < best.distance) best = { coord, edge: i - 1, t, distance, along: offset + metres * t };
    offset += metres;
  }
  return best;
}
/** Split at the projected point, not the closest old vertex. Parts follow the
 * supplied route direction; each part itself keeps canonical node orientation. */
export function splitSegment(parent: Segment, point: Coord, direction: 'forward' | 'reverse'): { segments: Segment[]; refs: ComposedRoute['segments']; gap: number } {
  if (parent.frozen_catalog) throw new Error(`Cannot split frozen catalog segment ${parent.id}`);
  const p = projection(point, parent.coords);
  if (p.along < 0.1 || parent.length_m - p.along < 0.1) throw new Error(`split_at falls at an endpoint of ${parent.id}`);
  const atVertex = p.t < 1e-8 ? p.edge : p.t > 1 - 1e-8 ? p.edge + 1 : null;
  const node = atVertex === null ? `curated-${hash(JSON.stringify([parent.id, p.coord]))}` : parent.node_ids[atVertex];
  const coords = atVertex === null ? [...parent.coords.slice(0, p.edge + 1), p.coord, ...parent.coords.slice(p.edge + 1)] : [...parent.coords];
  const ids = atVertex === null ? [...parent.node_ids.slice(0, p.edge + 1), node, ...parent.node_ids.slice(p.edge + 1)] : [...parent.node_ids];
  const ways = !parent.osm_edge_way_ids.length ? [] : atVertex === null ? [...parent.osm_edge_way_ids.slice(0, p.edge), parent.osm_edge_way_ids[p.edge], ...parent.osm_edge_way_ids.slice(p.edge)] : [...parent.osm_edge_way_ids];
  const cut = atVertex ?? p.edge + 1;
  const parts = [[0, cut], [cut, coords.length - 1]].map(([a, b]) => {
    const s = refresh({ ...parent, coords: coords.slice(a, b + 1), node_ids: ids.slice(a, b + 1), osm_edge_way_ids: ways.slice(a, b), source_segment_ids: unique([parent.id, ...(parent.source_segment_ids ?? [])]) });
    s.id = `wa-stretch-${hash(JSON.stringify([parent.id, s.node_ids]))}`;
    return { segment: s, forward: s.node_ids[0] === ids[a] };
  });
  if (direction === 'reverse') parts.reverse();
  return { segments: parts.map(p => p.segment), refs: parts.map(p => ({ id: p.segment.id, direction: (direction === 'forward') === p.forward ? 'forward' : 'reverse' })), gap: p.distance };
}
function existingPoint(point: CuratedPoint, peaks: PeaksDestination[], anchor?: Coord): PeaksDestination | undefined {
  const names = point.name === 'Columbia Crest' ? ['Columbia Crest', 'Mount Rainier'] : [point.name];
  return peaks.filter(d => names.some(n => placeKey(n) === placeKey(d.name)) && featureCompatible(point.feature, d.features))
    .sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name) || (anchor ? haversine(anchor, [a.lng, a.lat]) - haversine(anchor, [b.lng, b.lat]) : a.id.localeCompare(b.id)))[0];
}
export function applyCuration(rows: ComposedRoute[], segments: Segment[], curation: Curation, peaks: PeaksDestination[], features: NamedFeature[], previous: Map<string, Segment> = new Map()): StretchAudit {
  const audit: StretchAudit = { conflicts: assignNames(rows, segments), splits: [], remapped: [], deferred: [] }, byId = new Map(segments.map(s => [s.id, s]));
  const assigned = new Map<string, string>();
  for (const rule of curation.routes) {
    const primary = rows.find(r => r.name === rule.route); if (!primary?.segments.length) continue;
    const affected = rows.filter(r => [rule.route, ...(rule.also_applies_to ?? [])].includes(r.name));
    const mapped = new Map<string, string[]>();
    const resolve = (id: string): string[] => {
      if (mapped.has(id)) return mapped.get(id)!;
      let found = primary.segments.filter(r => r.id === id || byId.get(r.id)?.source_segment_ids?.includes(id)).map(r => r.id);
      // Old IDs are hints. Reuse the previous route geometry as a position
      // reference when topology IDs change. Never assign by kind alone.
      const old = [...previous.values()].filter(s => s.id === id || s.source_segment_ids?.includes(id));
      if (!found.length && old.length) found = primary.segments.filter(r => {
        const s = byId.get(r.id)!; let total = 0, matched = 0;
        if (s.summit_connector) return false;
        for (const sample of samples(s.coords, 25)) { total += sample.weight; if (old.some(line => line.coords.slice(1).some((b, i) => pointDistance(sample.point, line.coords[i], b) <= 15))) matched += sample.weight; }
        return matched / total >= 0.8;
      }).map(r => r.id);
      found = [...new Set(found)];
      if (!found.length) throw new Error(`Curated segment ${id} unresolved on ${rule.route}; retain a previous segments.ndjson or update the ordered segment hints`);
      if (found.length !== 1 || found[0] !== id) audit.remapped.push({ requested: id, resolved: found });
      mapped.set(id, found); return found;
    };
    // Resolve all original hints before mutations change route references.
    for (const stretch of rule.stretches) stretch.segments.forEach(resolve);
    const splitRefs = new Map<string, { before: string[]; after: string[] }>();
    for (const stretch of rule.stretches.filter(s => s.split_at)) {
      const splitKey = `${stretch.segments.join(',')}@${stretch.split_at}`; if (splitRefs.has(splitKey)) continue;
      const hints = stretch.segments.flatMap(resolve);
      const pointRule = rule.points?.find(p => p.name === stretch.split_at), destination = pointRule ? existingPoint(pointRule, peaks, primary.route_start ?? undefined) : undefined;
      const f = features.find(f => placeKey(f.name) === placeKey(stretch.split_at!));
      const coord: Coord | undefined = destination ? [destination.lng, destination.lat] : f ? [f.lon, f.lat] : undefined;
      if (!coord) throw new Error(`Missing split waypoint ${stretch.split_at}`);
      const chosen = hints.map(id => ({ id, p: projection(coord, byId.get(id)!.coords) })).sort((a, b) => a.p.distance - b.p.distance)[0];
      if (!chosen || chosen.p.distance > 150) throw new Error(`split_at ${stretch.split_at} is more than 150 m from its stretch`);
      const ref = primary.segments.find(r => r.id === chosen.id)!, parent = byId.get(ref.id)!, split = splitSegment(parent, coord, ref.direction);
      for (const row of rows) row.segments = row.segments.flatMap(r => r.id !== ref.id ? [r] : r.direction === ref.direction ? split.refs : [...split.refs].reverse().map(p => ({ id: p.id, direction: p.direction === 'forward' ? 'reverse' as const : 'forward' as const })));
      byId.delete(parent.id); split.segments.forEach(s => byId.set(s.id, s));
      const at = hints.indexOf(parent.id); splitRefs.set(splitKey, { before: [...hints.slice(0, at), split.refs[0].id], after: [split.refs[1].id, ...hints.slice(at + 1)] });
      audit.splits.push({ parent: parent.id, parts: split.refs.map(r => r.id), waypoint: stretch.split_at!, gap_m: split.gap });
    }
    for (const stretch of rule.stretches) {
      if (!['trail', 'road', 'snowfield', 'glacier', 'scramble', 'climb', 'xc'].includes(stretch.kind)) throw new Error(`Invalid curated kind ${stretch.kind}`);
      const ids = stretch.split_at ? splitRefs.get(`${stretch.segments.join(',')}@${stretch.split_at}`)![stretch.part ?? 'before'] : stretch.segments.flatMap(resolve);
      for (const id of ids) {
        const s = byId.get(id); if (!s) throw new Error(`Overlapping split assignment ${id}`);
        if (s.frozen_catalog) continue;
        const identity = JSON.stringify([stretch.display_name, stretch.kind, stretch.description ?? null]);
        if (assigned.has(id) && assigned.get(id) !== identity) throw new Error(`Conflicting curated stretch assignments for ${id}`);
        assigned.set(id, identity); s.display_name = stretch.display_name; s.kind = stretch.kind; s.description = stretch.description ?? null; s.description_source_url = null;
        const conflict = audit.conflicts.find(c => c.segment_id === id); if (conflict) conflict.curated = stretch.display_name;
      }
    }
    for (const row of affected) {
      row.approximate = rule.approximate ?? false; row.notes = unique([...(row.notes ?? []), ...(rule.note ? [rule.note] : []), ...(rule.points ?? []).flatMap(p => p.note ? [`${p.name}: ${p.note}`] : [])]);
      const line = routeLine(row, byId), total = length(line);
      for (const point of rule.points ?? []) {
        if (!DESTINATION_FEATURES.has(point.feature)) throw new Error(`Invalid curated destination feature ${point.feature}`);
        let coord: Coord | undefined, segment: Segment | undefined;
        const name = point.place_at?.match(/^end of stretch (.+)$/)?.[1];
        if (point.place_at && !name) throw new Error(`Unsupported place_at ${point.place_at}`);
        if (name) {
          const index = row.segments.map(r => byId.get(r.id)!.display_name).lastIndexOf(name);
          if (index < 0) continue; // Camp Muir ends below the upper stretches.
          const ref = row.segments[index]; segment = byId.get(ref.id)!; coord = segment.coords[ref.direction === 'forward' ? segment.coords.length - 1 : 0];
        }
        const destination = point.match === 'existing' ? existingPoint(point, peaks, row.route_end ?? undefined) : undefined;
        if (point.match === 'existing' && !destination) throw new Error(`Existing curated destination missing: ${point.name}`);
        coord ??= destination ? [destination.lng, destination.lat] : undefined;
        if (!coord) throw new Error(`New curated destination needs place_at: ${point.name}`);
        const p = projection(coord, line);
        if (p.distance > 400) continue; // Do not link DC's summit to Camp Muir.
        const waypoint: Waypoint = { ...(destination ? { peaks_id: destination.id } : { new: { name: point.name, feature: point.feature, lng: coord[0], lat: coord[1], source: { kind: 'curated' as const, node_id: segment?.node_ids[segment.coords.indexOf(coord)], provenance: segment?.provenance, note: point.note } } }),
          name: point.name, feature: point.feature, lng: coord[0], lat: coord[1], fraction: total ? p.along / total : 0, osm_id: `curated/${hash(point.name)}`, distance_from_route_m: p.distance };
        row.waypoints = row.waypoints.filter(w => placeKey(w.name) !== placeKey(point.name) && (!destination || w.peaks_id !== destination.id)); row.waypoints.push(waypoint);
      }
      row.waypoints.sort((a, b) => a.fraction - b.fraction || a.name.localeCompare(b.name));
    }
    audit.deferred.push(...(rule.deferred ?? []).map(n => `${rule.route}: ${n}`));
  }
  segments.splice(0, segments.length, ...[...byId.values()].sort((a, b) => a.id.localeCompare(b.id)));
  for (const r of rows) {
    r.stretches = [];
    for (const ref of r.segments) { const s = byId.get(ref.id)!, last = r.stretches[r.stretches.length - 1];
      if (last && (s.summit_connector || s.legacy_tail && !s.display_name || last.display_name === s.display_name && last.kind === s.kind)) { last.length_m += s.length_m; last.segment_ids.push(s.id); }
      else r.stretches.push({ display_name: s.display_name ?? null, kind: s.kind, length_m: s.length_m, segment_ids: [s.id] });
    }
  }
  for (const s of segments) s.display_name = displayName(s.display_name ?? null);
  for (const row of rows) for (const stretch of row.stretches ?? []) stretch.display_name = displayName(stretch.display_name);
  for (const c of audit.conflicts) { c.selected = displayName(c.selected); if (c.curated) c.curated = displayName(c.curated)!; }
  return audit;
}
export function routeLine(row: ComposedRoute, byId: Map<string, Segment>): Coord[] {
  return row.segments.flatMap((ref, i) => { const points = byId.get(ref.id)!.coords, ordered = ref.direction === 'forward' ? points : [...points].reverse(); return i ? ordered.slice(1) : ordered; });
}
export function reviewData(rows: ComposedRoute[], segments: Segment[]) {
  const byId = new Map(segments.map(s => [s.id, s])), round = (n: number, digits = 2) => +n.toFixed(digits);
  return rows.filter(r => r.segments.length).map(r => ({ n: r.name, st: r.status, t: r.tier, rg: r.region, km: round(r.length_m / 1000), ex: round(r.expected_length_m / 1000), rs: r.reasons.join('; '), wta: r.wta_url,
    th: r.trailhead?.peaks_id ? 'peaks' : r.trailhead?.new?.source ?? null,
    wp: r.waypoints.map(w => [w.name, round(w.lat, 5), round(w.lng, 5), w.feature]), ln: routeLine(r, byId).map(([lng, lat]) => [round(lat, 5), round(lng, 5)]),
    sk: r.segments.map(ref => byId.get(ref.id)!.kind), sn: r.stretches?.map(s => s.display_name) ?? [] }));
}
