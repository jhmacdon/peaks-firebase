import type { ComposeStatus, Seed } from './catalog-types';
import type { RouteStep } from './router';
import type { Segment } from './types';

export function expectedLength(seed: Pick<Seed, 'kind' | 'approx_roundtrip_mi'>): number {
  // The seed explicitly calls traverse distances one-way despite its field name.
  return seed.approx_roundtrip_mi * 1609.344 / (['loop', 'traverse'].includes(seed.kind) ? 1 : 2);
}
export function validateRoute(kind: Seed['kind'], actual: number, expected: number, preferred: number, road: number, repeatsAllowed: boolean): { status: ComposeStatus; reasons: string[]; deviation: number | null } {
  const reasons: string[] = []; let status: ComposeStatus = 'ok';
  const deviation = expected > 0 ? Math.abs(actual - expected) / expected : null;
  if (!(actual > 0)) return { status: 'failed', reasons: ['empty route'], deviation };
  if (deviation === null) { status = 'review'; reasons.push('approximate length missing'); }
  else if (deviation > 0.5 + 1e-9) { status = 'failed'; reasons.push(`length differs by ${(deviation * 100).toFixed(1)}% (>50%)`); }
  else if (deviation > 0.25 + 1e-9) { status = 'review'; reasons.push(`length differs by ${(deviation * 100).toFixed(1)}% (25–50%)`); }
  if (preferred < 0.6 - 1e-9) reasons.push(`only ${(preferred * 100).toFixed(1)}% on preferred trails (<60%)`);
  if (road > 0.1 + 1e-9) reasons.push(`road share ${(road * 100).toFixed(1)}% (>10%)`);
  if (!repeatsAllowed) reasons.push(kind === 'loop' ? 'repeated edges outside the shared start/end stem' : 'repeated edges on a one-way walk');
  if (status === 'ok' && reasons.length) status = 'review';
  return { status, reasons, deviation };
}
export function repeatedEdgesAllowed(kind: Seed['kind'], walk: RouteStep[], byId: Map<string, Segment>): boolean {
  const edges: string[] = [];
  for (const step of walk) {
    const low = Math.min(step.start_vertex, step.end_vertex), high = Math.max(step.start_vertex, step.end_vertex), ids: string[] = [];
    for (let i = low; i < high; i++) ids.push(`${step.segment_id}:${i}`);
    // A loop, not push(...ids): one long step can exceed the argument limit (Wyoming, 2026-10-21).
    for (const id of step.direction === 'forward' ? ids : ids.reverse()) edges.push(id);
  }
  const counts = new Map<string, number>(); edges.forEach(e => counts.set(e, (counts.get(e) ?? 0) + 1));
  if (![...counts.values()].some(n => n > 1)) return true;
  if (kind !== 'loop') return false;
  let stem = 0; while (stem < edges.length / 2 && edges[stem] === edges[edges.length - 1 - stem]) stem++;
  const middle = edges.slice(stem, edges.length - stem);
  return new Set(middle).size === middle.length && new Set(edges.slice(0, stem)).size === stem && middle.length > 0;
}
