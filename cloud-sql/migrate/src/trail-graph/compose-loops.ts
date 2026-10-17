import { haversine, length } from './geo';
import { TrailRouter, type RouteStep } from './router';
import { repeatedEdgesAllowed } from './compose-validate';
import type { Coord, Segment } from './types';

export function wholeStep(s: Segment, from: string): RouteStep {
  const forward = s.start_node === from;
  return { segment_id: s.id, direction: forward ? 'forward' : 'reverse', start_vertex: forward ? 0 : s.coords.length - 1,
    end_vertex: forward ? s.coords.length - 1 : 0, length_m: s.length_m };
}
export const reverseWalk = (walk: RouteStep[]): RouteStep[] => [...walk].reverse().map(s => ({ ...s, direction: s.direction === 'forward' ? 'reverse' : 'forward', start_vertex: s.end_vertex, end_vertex: s.start_vertex }));
/** Fundamental cycles in the named subgraph; bridges form shared stems, not loops. */
export function namedCycles(segments: Segment[]): RouteStep[][] {
  const parent = new Map<string, string>(), tree = new Map<string, { to: string; segment: Segment }[]>(), cycles: RouteStep[][] = [];
  const root = (id: string): string => { let x = id; while (parent.has(x)) x = parent.get(x)!; return x; };
  for (const s of segments) {
    const a = root(s.start_node), b = root(s.end_node);
    if (a !== b) {
      parent.set(a, b);
      for (const [from, to] of [[s.start_node, s.end_node], [s.end_node, s.start_node]]) tree.set(from, [...(tree.get(from) ?? []), { to, segment: s }]);
      continue;
    }
    const queue = [s.start_node], previous = new Map<string, { from: string; segment: Segment }>(), seen = new Set(queue);
    for (let q = 0; q < queue.length && !seen.has(s.end_node); q++) for (const e of tree.get(queue[q]) ?? []) if (!seen.has(e.to)) {
      seen.add(e.to); queue.push(e.to); previous.set(e.to, { from: queue[q], segment: e.segment });
    }
    if (!seen.has(s.end_node)) continue;
    const path: RouteStep[] = []; let cursor = s.end_node;
    while (cursor !== s.start_node) { const p = previous.get(cursor)!; path.push(wholeStep(p.segment, p.from)); cursor = p.from; }
    cycles.push([...path.reverse(), wholeStep(s, s.end_node)]);
  } return cycles;
}
export function composeLoop(router: TrailRouter, groups: Segment[][], start: Coord, expected: number, preferNames: string[], via: Coord[] = []): RouteStep[] | null {
  const selected = [...new Map(groups.flat().filter(s => s.coords.some(p => haversine(p, start) <= Math.max(5000, expected * 0.8))).map(s => [s.id, s])).values()];
  if (selected.length > 5000) return null;
  // Short source links can cross a campground/parking area or join two names.
  // Keep the search on the listed trails plus bounded, unnamed connectors.
  const nodes = new Set(selected.flatMap(s => [s.start_node, s.end_node])), chosen = new Set(selected.map(s => s.id));
  for (let pass = 0; pass < 4; pass++) for (const s of router.segments) if (!chosen.has(s.id) && !s.trail_names.length && !s.relation_names.length && s.length_m <= 400 && (nodes.has(s.start_node) || nodes.has(s.end_node))) {
    if (!s.coords.some(p => haversine(p, start) <= Math.max(5000, expected * 0.8))) continue;
    selected.push(s); chosen.add(s.id); nodes.add(s.start_node); nodes.add(s.end_node);
  }
  // The ordered list can omit a mapped connecting trail (e.g. Equestrian
  // between Hamilton and Hardy Creek). Add only bounded source paths between
  // open ends; never substitute an unrestricted start-to-start route.
  const degree = new Map<string, number>(), positions = new Map<string, Coord>();
  for (const s of selected) for (const i of [0, s.coords.length - 1]) { const id = s.node_ids[i]; degree.set(id, (degree.get(id) ?? 0) + 1); positions.set(id, s.coords[i]); }
  const joins = [...positions].map(([id, p]) => ({ id, p }));
  const maxConnector = Math.min(5000, Math.max(400, expected * 0.35));
  const other = new Set(router.segments.filter(s => !chosen.has(s.id) && s.coords.some(p => haversine(p, start) <= Math.max(5000, expected))).map(s => s.id));
  if (joins.length <= 250) for (let i = 0; i < joins.length; i++) {
    const reachable = router.networkDistances(joins[i].p, other);
    for (const join of joins.slice(i + 1)) {
    if (haversine(joins[i].p, join.p) > maxConnector || (reachable.get(join.id) ?? Infinity) > maxConnector) continue;
    try {
      const link = router.route(joins[i].p, join.p, { allowedSegmentIds: other, includeFeatures: false });
      if (link.total_length_m > maxConnector) continue;
      for (const step of link.segments) if (!chosen.has(step.segment_id)) {
        const s = router.segments.find(s => s.id === step.segment_id)!;
        selected.push(s); chosen.add(s.id);
      }
    } catch (e) { if (!/Disconnected graph/.test((e as Error).message)) throw e; }
    }
  }
  const byId = new Map(selected.map(s => [s.id, s])); let best: { score: number; walk: RouteStep[] } | null = null;
  const startNode = router.snap(start).value.id;
  const viaNodes = via.map(p => router.snap(p).value.id);
  const cycles = namedCycles(selected).slice(0, 100), candidates = [...cycles];
  const adjacency = new Map<string, Segment[]>(), nodeCoords = new Map<string, Coord>();
  for (const s of selected) for (const i of [0, s.coords.length - 1]) {
    const id = s.node_ids[i]; adjacency.set(id, [...(adjacency.get(id) ?? []), s]); nodeCoords.set(id, s.coords[i]);
  }
  const signatures = new Set<string>(); let explored = 0;
  // A cycle basis alone can miss the outer circuit of several small loops.
  // Enumerate bounded simple circuits near the start, preserving source edges.
  for (const root of [...nodeCoords.keys()].sort((a, b) => haversine(nodeCoords.get(a)!, start) - haversine(nodeCoords.get(b)!, start)).slice(0, 24)) {
    const visit = (node: string, walk: RouteStep[], used: Set<string>, visited: Set<string>, distance: number): void => {
      if (++explored > 40000 || distance > expected * 1.6 || walk.length > 150) return;
      for (const s of adjacency.get(node) ?? []) {
        if (used.has(s.id)) continue;
        const step = wholeStep(s, node), next = s.node_ids[step.end_vertex], path = [...walk, step];
        if (next === root) {
          const signature = path.map(p => p.segment_id).sort().join(',');
          if (!signatures.has(signature)) { signatures.add(signature); candidates.push(path); }
        } else if (!visited.has(next)) { used.add(s.id); visited.add(next); visit(next, path, used, visited, distance + s.length_m); visited.delete(next); used.delete(s.id); }
      }
    };
    visit(root, [], new Set(), new Set([root]), 0);
    if (explored > 40000) break;
  }
  // Adjacent basis cycles can share an edge. Their symmetric difference is
  // the outer loop, which often contains all three ordered seed trails.
  for (let i = 0; i < cycles.length; i++) for (let j = i + 1; j < cycles.length; j++) {
    const ids = new Set(cycles[i].map(s => s.segment_id));
    for (const s of cycles[j]) if (ids.has(s.segment_id)) ids.delete(s.segment_id); else ids.add(s.segment_id);
    const edges = [...ids].map(id => byId.get(id)!), adj = new Map<string, Segment[]>();
    for (const s of edges) for (const id of [s.start_node, s.end_node]) adj.set(id, [...(adj.get(id) ?? []), s]);
    if (!edges.length || [...adj.values()].some(a => a.length !== 2)) continue;
    const walk: RouteStep[] = []; let cursor = edges[0].start_node; const used = new Set<string>();
    while (walk.length < edges.length) { const s = adj.get(cursor)?.find(s => !used.has(s.id)); if (!s) break; const step = wholeStep(s, cursor); walk.push(step); used.add(s.id); cursor = s.node_ids[step.end_vertex]; }
    if (walk.length === edges.length && cursor === edges[0].start_node) candidates.push(walk);
  }
  const groupIds = groups.filter(g => g.length).map(g => ({ ids: new Set(g.map(s => s.id)), nodes: new Set(g.flatMap(s => [s.start_node, s.end_node])) }));
  for (const cycle of candidates) {
    const positions = cycle.map((step, i) => ({ i, point: byId.get(step.segment_id)!.coords[step.start_vertex] })).sort((a, b) => haversine(start, a.point) - haversine(start, b.point));
    const join = positions[0]; if (!join) continue;
    let stem: RouteStep[] = [], forward = [...cycle.slice(join.i), ...cycle.slice(0, join.i)];
    const contains = cycle.findIndex(step => byId.get(step.segment_id)!.node_ids.includes(startNode));
    if (contains >= 0) {
      const step = cycle[contains], source = byId.get(step.segment_id)!, v = source.node_ids.indexOf(startNode);
      const part = (from: number, to: number): RouteStep => ({ ...step, start_vertex: from, end_vertex: to, length_m: length(source.coords.slice(Math.min(from, to), Math.max(from, to) + 1)) });
      forward = [part(v, step.end_vertex), ...cycle.slice(contains + 1), ...cycle.slice(0, contains), part(step.start_vertex, v)].filter(s => s.length_m > 0);
    } else {
      try { stem = router.route(start, join.point, { preferNames, allowedSegmentIds: chosen, includeFeatures: false }).segments; } catch { continue; }
    }
    for (const around of [forward, reverseWalk(forward)]) {
      // Require an ordered subsequence, as ordered via points do. A short
      // approach can share the final trail's name before the loop proper.
      const outgoing = [...stem, ...around];
      const events = outgoing.flatMap(step => {
        const s = byId.get(step.segment_id)!;
        return [{ node: s.node_ids[step.start_vertex], segment: step.segment_id }, { node: s.node_ids[step.end_vertex], segment: step.segment_id }];
      });
      let cursor = 0, missing = 0;
      for (const group of groupIds) {
        // A junction on the named trail is a valid via point even if the walk
        // turns there. It need not walk out and back on that trail's spur.
        const index = events.findIndex((event, i) => i >= cursor && (group.ids.has(event.segment) || group.nodes.has(event.node)));
        if (index < 0) { missing++; break; } cursor = index;
      }
      if (missing) continue;
      const walk = [...stem, ...around, ...reverseWalk(stem)], distance = walk.reduce((n, s) => n + s.length_m, 0);
      if (!repeatedEdgesAllowed('loop', walk, byId)) continue;
      if (viaNodes.some(id => !walk.some(step => byId.get(step.segment_id)!.node_ids.slice(Math.min(step.start_vertex, step.end_vertex), Math.max(step.start_vertex, step.end_vertex) + 1).includes(id)))) continue;
      const score = Math.abs(distance - expected) / Math.max(1, expected);
      if (!best || score < best.score) best = { score, walk };
    }
  }
  return best?.walk ?? null;
}

/** Keep a documented loop objective when the mapped route needs a spur.
 * Validation reports its repeated edges; they cannot silently become ok. */
export function addLoopVia(router: TrailRouter, walk: RouteStep[], via: Coord, preferNames: string[]): RouteStep[] {
  const byId = new Map(router.segments.map(s => [s.id, s])); let nearest: { step: number; vertex: number; gap: number } | null = null;
  const distances = router.networkDistances(via);
  walk.forEach((step, i) => { const source = byId.get(step.segment_id)!;
    for (let v = Math.min(step.start_vertex, step.end_vertex); v <= Math.max(step.start_vertex, step.end_vertex); v++) {
      const gap = distances.get(source.node_ids[v]) ?? Infinity; if (Number.isFinite(gap) && (!nearest || gap < nearest.gap)) nearest = { step: i, vertex: v, gap };
    }
  });
  if (!nearest) return walk;
  const at = nearest as { step: number; vertex: number; gap: number }, step = walk[at.step], source = byId.get(step.segment_id)!;
  const spur = router.route(source.coords[at.vertex], via, { preferNames, includeFeatures: false }).segments; if (!spur.length) return walk;
  const part = (from: number, to: number): RouteStep => ({ ...step, start_vertex: from, end_vertex: to, length_m: length(source.coords.slice(Math.min(from, to), Math.max(from, to) + 1)) });
  return [...walk.slice(0, at.step), part(step.start_vertex, at.vertex), ...spur, ...reverseWalk(spur), part(at.vertex, step.end_vertex), ...walk.slice(at.step + 1)].filter(s => s.length_m > 0);
}
