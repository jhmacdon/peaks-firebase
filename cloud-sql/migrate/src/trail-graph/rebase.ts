import { createHash } from 'node:crypto';
import { haversine, interpolate, length, lineIndex, nearest, pointDistance, samples, unique } from './geo';
import { displayName } from './display-names';
import { normalizeName } from './names';
import { refresh } from './topology';
import { routeLine } from './stretches';
import type { TrailRouter, RouteStep } from './router';
import type { ComposedRoute, DraftRoute, PeaksRoute } from './catalog-types';
import type { Coord, Provenance, Segment } from './types';

const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export interface LegacyRoute {
  id: string; name: string; status: string; kind: ComposedRoute['kind'] | null; shape: ComposedRoute['shape'] | null;
  distance: number; gain: number | null; objective_destination_id: string | null; trailhead_destination_id: string | null;
  provenance_source: string | null; provenance?: Provenance; n_sessions: number; catalog_reviewed: boolean;
  factory_job: string | { state: string; lease_expires_at?: string | null } | null;
  segments: { id: string; ordinal: number; direction: string; shared_by: number }[] | null; coords: Coord[];
}
export interface RebasePlan {
  legacy: LegacyRoute; source_hash: string; status: 'ok' | 'review' | 'failed'; reasons: string[];
  frozen: boolean; row: ComposedRoute; hausdorff_m: number | null; deviation_fraction: number | null;
  tail_length_m: number; graph_length_m: number; plan_hash?: string;
}
export interface MergePlan {
  seed_index: number; legacy_id: string; legacy_name: string; catalog_name: string; status: 'ok' | 'review';
  reasons: string[]; shared_fraction: number; length_difference: number; same_endpoints: boolean; plan_hash: string;
}
export const legacyHash = (legacy: LegacyRoute): string => digest([legacy.id, legacy.name, legacy.status, legacy.coords, legacy.segments, legacy.objective_destination_id, legacy.trailhead_destination_id]);
export function leased(legacy: LegacyRoute, now = Date.now()): boolean {
  return !!legacy.factory_job && typeof legacy.factory_job === 'object' && !!legacy.factory_job.lease_expires_at && Date.parse(legacy.factory_job.lease_expires_at) >= now;
}
export function cutLine(coords: Coord[], from: number, to: number): Coord[] {
  const points: Coord[] = []; let offset = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversine(coords[i - 1], coords[i]), end = offset + d;
    if (end >= from && offset <= to && d > 0) {
      const a = interpolate(coords[i - 1], coords[i], Math.max(0, (from - offset) / d));
      const b = interpolate(coords[i - 1], coords[i], Math.min(1, (to - offset) / d));
      if (!points.length || haversine(points[points.length - 1], a) > 0.001) points.push(a);
      if (haversine(points[points.length - 1], b) > 0.001) points.push(b);
    }
    offset = end; if (offset > to) break;
  }
  return points.length ? points : [coords[0]];
}
function distanceTo(index: ReturnType<typeof lineIndex>, p: Coord, radius = 500): number {
  return Math.min(radius, ...index.near(p, radius).map(e => pointDistance(p, e.a, e.b)));
}
/** Symmetric sampled Hausdorff with <=10m spacing; trim each line's end 100m. */
export function trimmedHausdorff(a: Coord[], b: Coord[], trim = 100): number {
  const one = (x: Coord[], y: Coord[]) => {
    const total = length(x), cut = Math.min(trim, total / 4), index = lineIndex([{ coords: y }]); let max = 0;
    const part = cutLine(x, cut, total - cut);
    for (const s of samples(part, 10)) max = Math.max(max, distanceTo(index, s.point));
    for (const p of part) max = Math.max(max, distanceTo(index, p)); return max;
  };
  return Math.max(one(a, b), one(b, a));
}
function legacyRow(legacy: LegacyRoute, prior: PeaksRoute | undefined): ComposedRoute {
  const first = [...(prior?.destinations ?? [])].sort((a, b) => a.ordinal - b.ordinal)[0]?.id;
  const last = [...(prior?.destinations ?? [])].sort((a, b) => b.ordinal - a.ordinal)[0]?.id;
  return { seed_index: -1, name: legacy.name, aliases: [], kind: legacy.kind ?? 'summit', region: 'WA legacy', tier: 0,
    trailhead: legacy.trailhead_destination_id || first ? { peaks_id: legacy.trailhead_destination_id ?? first } : null,
    objective: legacy.objective_destination_id || last ? { peaks_id: legacy.objective_destination_id ?? last } : null,
    segments: [], length_m: 0, shape: legacy.shape ?? 'out_and_back', waypoints: [], wta_url: null, requires_permit: null, season: '',
    existing_route_match: null, existing_route_matches: [], name_duplicates: [], status: 'ok', reasons: [], expected_length_m: length(legacy.coords),
    deviation_fraction: null, preferred_fraction: 1, road_fraction: 0, approx_roundtrip_mi: 0,
    route_start: legacy.coords[0] ?? null, route_end: legacy.coords.at(-1) ?? null, segment_sources: [] };
}
/** Source labels are not rights evidence. Placeholder tails must bind to valid
 * live legacy provenance in the loader before any INSERT can succeed. */
const pendingProvenance: Provenance = { source_kind: 'legacy_unverified', source_url: '', license_name: '', license_url: '', attribution: '', retrieved_at: '', osm_way_ids: [], osm_way_urls: [], contains_osm_geometry: false };
export function rebaseDraft(legacy: LegacyRoute, router: TrailRouter, byId: Map<string, Segment>, prior?: PeaksRoute): { plan: RebasePlan; draft: DraftRoute } {
  const row = legacyRow(legacy, prior), walk: RouteStep[] = [], source_hash = legacyHash(legacy);
  const plan: RebasePlan = { legacy, source_hash, status: 'ok', reasons: [], frozen: legacy.catalog_reviewed, row, hausdorff_m: null, deviation_fraction: null, tail_length_m: 0, graph_length_m: 0 };
  const finish = () => { row.status = plan.status === 'failed' ? 'failed' : plan.status; row.reasons = [...plan.reasons]; return { plan, draft: { row, walk } }; };
  if (legacy.catalog_reviewed) { plan.status = 'review'; plan.reasons.push('catalog_reviewed: frozen'); return finish(); }
  if (leased(legacy)) { plan.status = 'review'; plan.reasons.push('live factory lease: skip'); return finish(); }
  if (legacy.coords.length < 2 || legacy.coords.some(p => !p.every(Number.isFinite))) { plan.status = 'failed'; plan.reasons.push('invalid legacy geometry'); return finish(); }
  const originalLength = length(legacy.coords), index = lineIndex([{ coords: legacy.coords }]), penalties = new Map<string, number>();
  const penalty = (s: Segment) => {
    if (!penalties.has(s.id)) { let weight = 0, cost = 0;
      for (const sample of samples(s.coords, 40)) { const d = distanceTo(index, sample.point, 100); weight += sample.weight; cost += sample.weight * (d > 50 ? 10 : d > 25 ? 3 : 1); }
      penalties.set(s.id, cost / (weight || 1)); }
    return penalties.get(s.id)!;
  };
  const anchors = [0]; for (let m = 400; m < originalLength; m += 400) anchors.push(m); anchors.push(originalLength);
  const hits = anchors.map(m => { const p = cutLine(legacy.coords, m, m)[0]; return { m, p, hit: nearest(router.vertices, p, 40) }; });
  const tail = (from: number, to: number, a?: typeof hits[number]['hit'], b?: typeof hits[number]['hit']) => {
    let points = cutLine(legacy.coords, from, to);
    if (a && haversine(a.value.coord, points[0]) > 0.001) points.unshift(a.value.coord);
    if (b && haversine(b.value.coord, points.at(-1)!) > 0.001) points.push(b.value.coord);
    points = points.filter((p, i) => !i || haversine(points[i - 1], p) > 0.001);
    if (points.length < 2 || length(points) < 0.1) return;
    const node_ids = points.map(p => `legacy-${digest([legacy.id, p]).slice(0, 20)}`); if (a) node_ids[0] = a.value.id; if (b) node_ids[node_ids.length - 1] = b.value.id;
    const start = node_ids[0], s = refresh({ id: '', name: legacy.name, display_name: displayName(legacy.name), trail_names: [legacy.name], kind: /glacier/i.test(legacy.name) ? 'glacier' : 'xc',
      sac_scale: null, trail_visibility: null, osm_way_ids: [], relation_names: [], relations: [], start_node: '', end_node: '', coords: points, node_ids, osm_edge_way_ids: [], length_m: 0,
      provenance: legacy.provenance ?? { ...pendingProvenance }, alt_sources: [], legacy_tail: { route_id: legacy.id, source_hash, attachment_gap_m: Math.max(a?.distance ?? 0, b?.distance ?? 0) } });
    s.provenance = legacy.provenance ?? { ...pendingProvenance };
    s.id = `wa-legacy-tail-${digest([legacy.id, s.coords]).slice(0, 20)}`; byId.set(s.id, s);
    const forward = s.node_ids[0] === start; walk.push({ segment_id: s.id, direction: forward ? 'forward' : 'reverse', start_vertex: forward ? 0 : s.coords.length - 1, end_vertex: forward ? s.coords.length - 1 : 0, length_m: s.length_m });
    plan.tail_length_m += s.length_m;
  };
  let previous = -1;
  for (let i = 0; i < hits.length; i++) {
    if (!hits[i].hit) continue;
    if (previous < 0) { tail(0, hits[i].m, undefined, hits[i].hit); previous = i; continue; }
    const a = hits[previous], b = hits[i];
    if (i > previous + 1) tail(a.m, b.m, a.hit, b.hit);
    else try {
      const routed = router.route(a.hit!.value.coord, b.hit!.value.coord, { preferNames: [legacy.name.replace(/^.*\bvia\s+/i, '')], includeFeatures: false, segmentPenalty: penalty });
      const points = routed.segments.flatMap((step, j) => { const s = byId.get(step.segment_id)!, p = s.coords.slice(Math.min(step.start_vertex, step.end_vertex), Math.max(step.start_vertex, step.end_vertex) + 1); if (step.direction === 'reverse') p.reverse(); return j ? p.slice(1) : p; });
      if (!points.length || trimmedHausdorff(cutLine(legacy.coords, a.m, b.m), points, 0) > 50) {
        tail(a.m, b.m, a.hit, b.hit);
        if (b.m === originalLength) plan.reasons.push(`legacy end approach retained at ${Math.round(a.m)} m`);
        else { plan.status = 'review'; plan.reasons.push(`mapped leg at ${Math.round(a.m)} m exceeds 50 m: retained legacy span`); }
      } else { walk.push(...routed.segments); plan.graph_length_m += routed.total_length_m; }
    } catch (e) { tail(a.m, b.m, a.hit, b.hit); if (b.m === originalLength) plan.reasons.push(`legacy end approach retained at ${Math.round(a.m)} m`); else { plan.status = 'review'; plan.reasons.push(`graph gap at ${Math.round(a.m)} m: ${(e as Error).message}`); } }
    previous = i;
  }
  if (previous >= 0) tail(hits[previous].m, originalLength, hits[previous].hit); else tail(0, originalLength);
  // A via on an interior vertex must not create a segment boundary on its own.
  for (let i = walk.length - 1; i > 0; i--) { const a = walk[i - 1], b = walk[i]; if (a.segment_id === b.segment_id && a.direction === b.direction && a.end_vertex === b.start_vertex) { a.end_vertex = b.end_vertex; a.length_m += b.length_m; walk.splice(i, 1); } }
  row.length_m = walk.reduce((n, s) => n + s.length_m, 0);
  if (!plan.graph_length_m) { plan.status = 'failed'; plan.reasons.push('no legacy stretch could be mapped onto the graph'); }
  else if (plan.tail_length_m > row.length_m * .8) { plan.status = 'review'; plan.reasons.push('more than 80% remains legacy geometry'); }
  return finish();
}
export function finalizeRebases(plans: RebasePlan[], segments: Segment[]): void {
  const byId = new Map(segments.map(s => [s.id, s]));
  for (const p of plans) {
    if (!p.row.segments.length) continue;
    const line = routeLine(p.row, byId), oldLength = length(p.legacy.coords);
    p.hausdorff_m = trimmedHausdorff(p.legacy.coords, line); p.deviation_fraction = Math.abs(length(line) / oldLength - 1); p.row.length_m = length(line);
    if (p.hausdorff_m > 50) { p.status = 'review'; p.reasons.push(`Hausdorff ${p.hausdorff_m.toFixed(1)} m >50 m`); }
    if (p.deviation_fraction > .07) { p.status = 'review'; p.reasons.push(`length difference ${(p.deviation_fraction * 100).toFixed(1)}% >7%`); }
    if (haversine(line[0], p.legacy.coords[0]) > .1 || haversine(line.at(-1)!, p.legacy.coords.at(-1)!) > .1) { p.status = 'failed'; p.reasons.push('legacy endpoints changed'); }
    p.reasons = unique(p.reasons); p.row.status = p.status === 'failed' ? 'failed' : p.status;
    p.plan_hash = rebasePlanHash(p);
  }
}
export const rebasePlanHash = (p: RebasePlan): string => digest({ ...p, plan_hash: undefined });
export function mergePlans(rows: ComposedRoute[], rebases: RebasePlan[], segments: Segment[]): MergePlan[] {
  const byId = new Map(segments.map(s => [s.id, s])), candidates: Omit<MergePlan, 'plan_hash'>[] = [];
  const weights = (r: ComposedRoute) => { const m = new Map<string, number>(); for (const ref of r.segments) m.set(ref.id, (m.get(ref.id) ?? 0) + byId.get(ref.id)!.length_m); return m; };
  for (const r of rows.filter(r => r.segments.length)) for (const p of rebases.filter(p => !p.frozen && p.row.segments.length)) {
    if (/\bold\b/i.test(r.name) !== /\bold\b/i.test(p.legacy.name)) continue;
    const a = weights(r), b = weights(p.row); let shared = 0; for (const [id, metres] of a) shared += Math.min(metres, b.get(id) ?? 0);
    const fraction = Math.min(shared, r.length_m, p.row.length_m) / Math.max(r.length_m, p.row.length_m), delta = Math.abs(r.length_m / p.row.length_m - 1);
    const endpoints = !!r.trailhead?.peaks_id && r.trailhead.peaks_id === p.row.trailhead?.peaks_id && !!r.objective?.peaks_id && r.objective.peaks_id === p.row.objective?.peaks_id;
    if (fraction < .9 && !(endpoints && delta <= .05)) continue;
    const reasons: string[] = []; if (p.status !== 'ok') reasons.push(`rebase ${p.status}: ${p.reasons.join('; ')}`); if (r.status !== 'ok') reasons.push(`composer ${r.status}`);
    if (normalizeName(r.name) !== normalizeName(p.legacy.name)) reasons.push(`keep legacy name ${JSON.stringify(p.legacy.name)}; composer suggests ${JSON.stringify(r.name)}`);
    candidates.push({ seed_index: r.seed_index, legacy_id: p.legacy.id, legacy_name: p.legacy.name, catalog_name: r.name, status: p.status === 'ok' && r.status === 'ok' ? 'ok' : 'review', reasons, shared_fraction: fraction, length_difference: delta, same_endpoints: endpoints });
  }
  const seeds = new Set<number>(), ids = new Set<string>(), result: MergePlan[] = [];
  for (const c of candidates.sort((a, b) => Number(b.status === 'ok') - Number(a.status === 'ok') || b.shared_fraction - a.shared_fraction || a.length_difference - b.length_difference || a.legacy_id.localeCompare(b.legacy_id))) {
    if (seeds.has(c.seed_index) || ids.has(c.legacy_id)) continue; seeds.add(c.seed_index); ids.add(c.legacy_id); result.push({ ...c, plan_hash: digest(c) });
  }
  // Competing seed aliases must not fall back to creating duplicate routes.
  for (const c of candidates) if (!seeds.has(c.seed_index)) {
    seeds.add(c.seed_index); const blocked = { ...c, status: 'review' as const, reasons: [...c.reasons, 'legacy ID already assigned to another catalog row; suppress duplicate creation'] };
    result.push({ ...blocked, plan_hash: digest(blocked) });
  }
  return result.sort((a, b) => a.seed_index - b.seed_index);
}
