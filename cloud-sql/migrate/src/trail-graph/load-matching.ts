import { Grid, hash, haversine, lineIndex, pointDistance, samples } from './geo';
import { normalizeName, databaseFeature } from './names';
import { expandNameAbbreviations } from '../lib/place-names';
import type { ComposedRoute, PeaksDestination, PeaksRoute, PlaceRef } from './catalog-types';
import type { Coord } from './types';

export const IMPORT_MARKER = 'wa-trail-graph-v2';
export function osmExternalIds(osmId?: string): Record<string, string> {
  const m = /^(node|way|relation)\/(\d+)$/.exec(osmId ?? ''); return m ? { [`osm_${m[1]}`]: m[2] } : {};
}
const placeName = (n: string) => normalizeName(expandNameAbbreviations(n)).replace(/\b(?:mount|mountain|peak|trailhead|trail|parking|lot)\b/g, '').replace(/\s+/g, ' ').trim();
function nearName(a: string, b: string): boolean {
  const x = new Set(placeName(a).split(' ')), y = new Set(placeName(b).split(' '));
  const extra = [...x].filter(t => !y.has(t)).concat([...y].filter(t => !x.has(t)));
  return !!placeName(a) && [...x].some(t => y.has(t)) && extra.every(t => ['central', 'main'].includes(t));
}
export function forbiddenPlace(ref: PlaceRef): boolean {
  const p = ref.new; return !!p && p.source.kind !== 'curated' && (['pass', 'saddle', 'glacier'].includes(p.feature) || ['landform', 'other'].includes(p.feature) && /\b(?:pass|saddle|glacier|snowfield)\b/i.test(p.name));
}
export interface DedupeEvent { from: string; name: string; to: string; reason: string }
export class DestinationResolver {
  readonly events: DedupeEvent[] = [];
  private grid = new Grid<PeaksDestination & { coord: Coord }>(400);
  private osm = new Map<string, string>();
  private inserted = new Set<string>();
  private refs = new Map<string, PlaceRef>();
  private cache = new Map<string, PlaceRef>();
  constructor(destinations: PeaksDestination[]) { for (const d of destinations) this.add(d); }
  private add(d: PeaksDestination): void {
    const coord: Coord = [d.lng, d.lat]; this.grid.add(coord, coord, { ...d, coord });
    for (const [key, value] of Object.entries(d.external_ids ?? {})) if (/^osm_(node|way|relation)$/.test(key)) this.osm.set(`${key}:${value}`, d.id);
  }
  resolve(ref: PlaceRef): PlaceRef {
    if (ref.peaks_id || !ref.new) return ref;
    const key = JSON.stringify(ref); const cached = this.cache.get(key); if (cached) return cached;
    const p = ref.new, feature = databaseFeature(p.feature), coord: Coord = [p.lng, p.lat], external = Object.entries(osmExternalIds(p.source.osm_id))[0];
    const osmId = external && this.osm.get(`${external[0]}:${external[1]}`);
    const limit = ['trailhead', 'campsite'].includes(feature) || /\b(?:pass|saddle)\b/i.test(p.name) ? 400 : 30;
    const candidates = this.grid.near(coord, 400).map(d => ({ d, gap: haversine(coord, d.coord) })).filter(x => x.d.features.includes(feature) && ((placeName(x.d.name) === placeName(p.name) && x.gap <= limit) || x.gap <= 30 && nearName(x.d.name, p.name))).sort((a, b) => a.gap - b.gap || a.d.id.localeCompare(b.d.id));
    const id = osmId ?? candidates[0]?.d.id;
    if (id) { this.events.push({ from: placeIdentity(ref), name: p.name, to: id, reason: osmId ? this.inserted.has(id) ? 'within-load OSM id' : 'snapshot OSM external id' : this.inserted.has(id) ? 'within-load name/location' : 'snapshot name/location' }); const resolved = this.refs.get(id) ?? { peaks_id: id }; this.cache.set(key, resolved); return resolved; }
    if (forbiddenPlace(ref)) return ref; // The route planner reports the blocked creation.
    const idNew = placeIdentity(ref); this.inserted.add(idNew); this.refs.set(idNew, ref);
    this.add({ id: idNew, name: p.name, features: [feature], lng: p.lng, lat: p.lat, external_ids: osmExternalIds(p.source.osm_id) }); this.cache.set(key, ref); return ref;
  }
}
export function placeIdentity(ref: PlaceRef): string {
  if (ref.peaks_id) return ref.peaks_id;
  if (!ref.new) throw new Error('Unresolved destination reference');
  const p = ref.new;
  return p.source.osm_id ? `wa-osm-${p.source.osm_id.replace('/', '-')}` : `wa-place-${hash(JSON.stringify([databaseFeature(p.feature), p.source.node_id, p.lng, p.lat]))}`;
}
const routeWords = new Set('via trail route climb glacier standard normal the of to and mount mountain peak summit'.split(' '));
function variantWords(name: string, objectiveName: string): string[] {
  const objective = new Set(normalizeName(objectiveName).split(' '));
  return normalizeName(name).split(' ').filter(t => !routeWords.has(t) && !objective.has(t));
}
export function compatibleRouteNames(row: ComposedRoute, legacyName: string, objectiveName: string): boolean {
  const name = row.name + (/\bold\b/i.test(row.name) ? '' : row.aliases.some(n => /\bnew trail\b/i.test(n)) ? ' new' : '');
  const a = variantWords(name, objectiveName), b = variantWords(legacyName, objectiveName);
  if (a.includes('old') !== b.includes('old') || a.includes('new') !== b.includes('new')) return false;
  if (a.length || b.length) return a.length > 0 && b.length > 0 && a.some(t => b.includes(t));
  const tokens = normalizeName(row.name).split(' ').filter(t => !routeWords.has(t));
  return tokens.some(t => normalizeName(legacyName).split(' ').includes(t));
}
export function coveredFraction(oldCoords: Coord[], newCoords: Coord[], metres: number): number {
  const grid = lineIndex([{ coords: newCoords }]); let total = 0, near = 0;
  for (const s of samples(oldCoords, 10)) { total += s.weight; if (grid.near(s.point, metres).some(e => pointDistance(s.point, e.a, e.b) <= metres)) near += s.weight; }
  return total ? near / total : 0;
}
export interface SupersedeDecision { seed_index: number; name: string; legacy_id: string; legacy_name: string; eligible: boolean; reasons: string[]; overlap: number | null; start_gap_m: number | null; end_gap_m: number | null }
export function checkSupersede(row: ComposedRoute, legacy: PeaksRoute, newCoords: Coord[], objectiveName: string, objectiveId: string | null): SupersedeDecision {
  const reasons: string[] = row.status === 'ok' ? [] : [`composer status ${row.status}: not supersede eligible`], last = [...legacy.destinations].sort((a, b) => b.ordinal - a.ordinal)[0]?.id;
  const start = legacy.start && newCoords.length ? haversine(newCoords[0], legacy.start.coordinates.slice(0, 2) as Coord) : null;
  const end = legacy.end && newCoords.length ? haversine(newCoords[newCoords.length - 1], legacy.end.coordinates.slice(0, 2) as Coord) : null;
  if (legacy.id === row.route_id) reasons.push('same route id');
  if (legacy.catalog_reviewed) reasons.push('catalog reviewed: use trail-catalog supersede path');
  if (!objectiveId || (legacy.objective_destination_id ?? last) !== objectiveId) reasons.push('different or missing objective destination');
  if (start === null || start > 300) reasons.push(`start gap ${start === null ? 'unknown' : start.toFixed(1) + ' m'} (>300 m)`);
  if (end === null || end > 150) reasons.push(`end gap ${end === null ? 'unknown' : end.toFixed(1) + ' m'} (>150 m)`);
  if (!compatibleRouteNames(row, legacy.name, objectiveName)) reasons.push('incompatible named route variant');
  const overlap = legacy.path ? coveredFraction(legacy.path.coordinates.map(c => c.slice(0, 2) as Coord), newCoords, 30) : null;
  if (overlap === null) reasons.push('legacy path unavailable: 80% within 30 m unverified'); else if (overlap < 0.8 - 1e-9) reasons.push(`legacy overlap ${(overlap * 100).toFixed(1)}% (<80%)`);
  return { seed_index: row.seed_index, name: row.name, legacy_id: legacy.id, legacy_name: legacy.name, eligible: reasons.length === 0, reasons, overlap, start_gap_m: start, end_gap_m: end };
}
export function claimSupersedes(decisions: SupersedeDecision[]): Map<number, string> {
  const result = new Map<number, string>(), claimed = new Set<string>();
  for (const d of [...decisions].sort((a, b) => Number(b.eligible) - Number(a.eligible) || (b.overlap ?? 0) - (a.overlap ?? 0) || (a.start_gap_m ?? Infinity) - (b.start_gap_m ?? Infinity) || a.seed_index - b.seed_index)) {
    if (!d.eligible) continue;
    if (claimed.has(d.legacy_id) || result.has(d.seed_index)) { d.eligible = false; d.reasons.push('legacy or new route already assigned to another supersede'); continue; }
    claimed.add(d.legacy_id); result.set(d.seed_index, d.legacy_id);
  } return result;
}
