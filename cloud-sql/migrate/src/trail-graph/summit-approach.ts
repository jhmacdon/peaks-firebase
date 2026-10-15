import { length } from './geo';
import type { RouteStep } from './router';
import type { Segment } from './types';

export const hasUnofficialPath = (s: Segment): boolean => s.provenance.contains_osm_geometry && (s.informal === 'yes' || ['bad', 'poor', 'horrible', 'no'].includes(s.trail_visibility ?? ''));
/** Retain only existing OSM edges. A summit point alone never supplies a line.
 * Add a vertex cut when a long source segment contains the final 400 m. */
export function summitApproach(walk: RouteStep[], byId: Map<string, Segment>): { walk: RouteStep[]; xc: RouteStep[] } {
  const result = [...walk], xc: RouteStep[] = []; let remaining = 400;
  for (let i = result.length - 1; i >= 0 && remaining > 0; i--) {
    const step = result[i], s = byId.get(step.segment_id)!; if (!hasUnofficialPath(s)) break;
    const forward = step.end_vertex > step.start_vertex, indices: number[] = [];
    for (let v = step.end_vertex; forward ? v >= step.start_vertex : v <= step.start_vertex; v += forward ? -1 : 1) indices.push(v);
    let used = 0, cut = step.end_vertex;
    for (let j = 1; j < indices.length; j++) {
      const n = length([s.coords[indices[j - 1]], s.coords[indices[j]]]); if (used + n > remaining) break; used += n; cut = indices[j];
    }
    if (cut === step.end_vertex) break;
    const tail = { ...step, start_vertex: cut, length_m: used }; xc.unshift(tail); remaining -= used;
    if (cut !== step.start_vertex) {
      result.splice(i, 1, { ...step, end_vertex: cut, length_m: step.length_m - used }, tail); break;
    }
  }
  return { walk: result, xc };
}
