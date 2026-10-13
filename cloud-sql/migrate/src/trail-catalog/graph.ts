import { createHash } from "node:crypto";
import { osmRouteHaversineMeters } from "../osm-route-geometry";
import { pointToSegmentMeters } from "../route-world-geometry";
import { isSimpleClosedRoute } from "../official-route-geometry";
import type { BuiltCandidate, CatalogPlace, PilotCandidateInput, Point, SourceEdge } from "./types";

type Element = { type: string; id: number; lat?: number; lon?: number; nodes?: number[]; tags?: Record<string, string>; members?: { type: string; ref: number }[] };
type Edge = SourceEdge & { to: number; distance: number };
export class CandidateRejection extends Error {
  constructor(public readonly reason: string, detail?: string) { super(detail ? `${reason}: ${detail}` : reason); }
}
export function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function reject(reason: string, detail?: string): never { throw new CandidateRejection(reason, detail); }
function validPoint(point: Point): boolean { return Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180; }
function placeContact(place: CatalogPlace, points: Point[], metres: number): boolean {
  if (place.boundary && place.boundary.type !== "Polygon") reject("unsupported_objective_boundary");
  if (!place.boundary && !validPoint(place)) reject("objective_location_missing");
  if (place.boundary?.type === "Polygon" && !place.features.includes("summit")) {
    const rings = place.boundary.coordinates;
    const insideRing = (p: Point, ring: number[][]) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if (((yi > p.lat) !== (yj > p.lat)) && p.lng < (xj - xi) * (p.lat - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    if (points.some(p => rings.length && insideRing(p, rings[0]) && !rings.slice(1).some(r => insideRing(p, r)))) return true;
    return rings.some(ring => ring.some((coordinate, i) => i > 0 && points.some(point => pointToSegmentMeters(point, { lng: ring[i - 1][0], lat: ring[i - 1][1] }, { lng: coordinate[0], lat: coordinate[1] }) <= metres)));
  }
  return points.some((point, i) => osmRouteHaversineMeters(place, point) <= metres || (i > 0 && pointToSegmentMeters(place, points[i - 1], point) <= metres));
}
function allowedWay(way: Element): boolean {
  const t = way.tags ?? {};
  return ["path", "footway", "track"].includes(t.highway) && !["no", "private"].includes(t.access) && !["no", "private", "discouraged"].includes(t.foot);
}
function reviewTerrain(input: PilotCandidateInput, way: Element): void {
  const t = way.tags ?? {};
  const difficult = t.sac_scale && !["hiking", "mountain_hiking"].includes(t.sac_scale);
  const obscure = t.trail_visibility && !["excellent", "good", "intermediate"].includes(t.trail_visibility);
  if (!(difficult || obscure)) return;
  const review = input.terrainReviews?.find(r => r.wayId === way.id);
  if (!review?.note.trim() || !/^https:\/\//.test(review.sourceUrl) || !Number.isFinite(Date.parse(review.checkedAt))) reject("terrain_review_required", `way ${way.id}: ${t.sac_scale ?? ""} ${t.trail_visibility ?? ""}`);
}

function hasIdentity(input: PilotCandidateInput): boolean {
  const identity = input.identity;
  if (!identity?.name.trim() || identity.name.trim().toLowerCase() !== input.name.trim().toLowerCase()) return false;
  try {
    const url = new URL(identity.sourceUrl), host = url.hostname.replace(/^www\./, "");
    const allowed = identity.publisher === "usfs" ? ["fs.usda.gov", "fs.usda.gov"] : identity.publisher === "wta" ? ["wta.org"] : identity.publisher === "alltrails" ? ["alltrails.com"] : [];
    return url.protocol === "https:" && !url.username && !url.password && allowed.some(h => host === h || host.endsWith(`.${h}`));
  } catch { return false; }
}

/** Exact source nodes only. The shortest-path search follows the existing OSM builder's Dijkstra method. */
export function buildOsmCandidate(input: PilotCandidateInput, snapshots: unknown[], places: { trailhead: CatalogPlace; objective?: CatalogPlace | null; endTrailhead?: CatalogPlace | null }): BuiltCandidate {
  if (input.blockedReason) reject("research_source_gap", input.blockedReason);
  if (input.source.type !== "osm") reject("official_feature_proof_not_implemented");
  if (!input.name.trim() || !input.sourceKey.trim()) reject("missing_identity");
  if (input.access?.status === "closed") reject("access_closed", input.access.note);
  if (!places.trailhead || places.trailhead.id !== input.trailheadId || !places.trailhead.features.includes("trailhead")) reject("trailhead_identity_missing");
  if (!validPoint(places.trailhead)) reject("trailhead_location_missing");
  const objective = places.objective ?? null, endTrailhead = places.endTrailhead ?? null;
  if (input.kind !== "loop" && (!objective || objective.id !== input.objectiveId)) reject("objective_identity_missing");
  if (input.kind === "summit" && !objective?.features.includes("summit")) reject("summit_objective_required");
  if (input.kind === "destination" && (typeof objective?.name !== "string" || !objective.name.trim() || !objective.features.length || objective.features.some(f => ["trailhead", "summit"].includes(f)))) reject("named_natural_objective_required");
  if (input.kind === "traverse" && (!endTrailhead || endTrailhead.id !== input.endTrailheadId || endTrailhead.id === places.trailhead.id || !endTrailhead.features.includes("trailhead"))) reject("distinct_end_trailhead_required");
  if (endTrailhead && !validPoint(endTrailhead)) reject("end_trailhead_location_missing");
  const elements = new Map<string, Element>();
  for (const snapshot of snapshots) {
    if (!snapshot || typeof snapshot !== "object" || !Array.isArray((snapshot as { elements?: unknown }).elements)) reject("invalid_osm_snapshot");
    for (const raw of (snapshot as { elements: Element[] }).elements) {
      if (!raw || !Number.isSafeInteger(raw.id) || raw.id <= 0) reject("invalid_osm_element");
      const key = `${raw.type}/${raw.id}`, previous = elements.get(key);
      // Different timestamps are harmless; changed geometry/tags require a single fresh snapshot set.
      const comparable = (e: Element) => stableJson({ lat: e.lat, lon: e.lon, nodes: e.nodes, tags: e.tags, members: e.members });
      if (previous && comparable(previous) !== comparable(raw)) reject("conflicting_source_versions", key);
      elements.set(key, raw);
    }
  }
  const relation = input.source.relationId ? elements.get(`relation/${input.source.relationId}`) : undefined;
  const attestedRelation = relation?.tags?.type === "route" && ["hiking", "foot"].includes(relation.tags.route) && Boolean(relation.tags.name?.trim());
  const identity = input.identity;
  if (!attestedRelation && !hasIdentity(input)) reject("hike_attestation_missing");
  const normalizeName = (name: string) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const relationNames = [relation?.tags?.name, ...(relation?.tags?.alt_name?.split(";") ?? [])].filter((s): s is string => Boolean(s));
  const intendedNames = [input.name, ...(input.aliases ?? [])];
  if (attestedRelation && !relationNames.some(name => intendedNames.some(intended => normalizeName(name) === normalizeName(intended))) && !hasIdentity(input)) reject("route_name_attestation_missing");
  const memberIds = relation?.members?.filter(m => m.type === "way").map(m => m.ref) ?? [];
  const selectedIds = [...new Set(input.source.wayIds ?? memberIds)].sort((a, b) => a - b);
  if (!selectedIds.length || selectedIds.length > 5000) reject("invalid_way_selection");
  const nodes = new Map<number, Point>(), ways = new Map<number, Element>(), graph = new Map<number, Edge[]>(), sourceEdges = new Set<string>();
  const append = (id: number, edge: Edge) => graph.set(id, [...(graph.get(id) ?? []), edge]);
  for (const id of selectedIds) {
    const way = elements.get(`way/${id}`);
    if (!way?.nodes || way.nodes.length < 2) reject("source_way_missing", String(id));
    if (!allowedWay(way)) continue;
    ways.set(id, way);
    const names = [way.tags?.name, way.tags?.ref, ...(way.tags?.alt_name?.split(";") ?? [])].filter((s): s is string => Boolean(s?.trim()));
    for (const nodeId of way.nodes) {
      const raw = elements.get(`node/${nodeId}`), point = { lat: raw?.lat as number, lng: raw?.lon as number };
      if (!validPoint(point)) reject("source_node_missing", String(nodeId));
      nodes.set(nodeId, point);
      if (nodes.size > 100_000) reject("pilot_graph_limit");
    }
    for (let i = 1; i < way.nodes.length; i++) {
      const a = way.nodes[i - 1], b = way.nodes[i], distance = osmRouteHaversineMeters(nodes.get(a)!, nodes.get(b)!);
      const edgeKey = `${Math.min(a,b)}:${Math.max(a,b)}`;
      if (sourceEdges.has(edgeKey)) reject("ambiguous_source_edge", edgeKey);
      sourceEdges.add(edgeKey);
      if (!(distance > 0)) reject("zero_length_source_edge", String(id));
      append(a, { to: b, distance, wayId: id, startNodeId: a, endNodeId: b, names });
      append(b, { to: a, distance, wayId: id, startNodeId: b, endNodeId: a, names });
    }
  }
  const start = input.startNodeId, end = input.endNodeId;
  if (!start || !graph.has(start) || (input.kind !== "loop" && (!end || !graph.has(end)))) reject("source_endpoint_missing");
  let nodeIds: number[] = [start], routeEdges: Edge[] = [];
  if (input.kind === "loop") {
    if ([...graph.values()].some(edges => edges.length !== 2)) reject("loop_not_simple_closed_source_chain");
    const seen = new Set<number>([start]);
    let previous = -1, cursor = start;
    do {
      const choices = graph.get(cursor)!.filter(e => e.to !== previous).sort((a, b) => a.wayId - b.wayId || a.to - b.to);
      const edge = choices[0];
      if (!edge || (seen.has(edge.to) && edge.to !== start)) reject("loop_not_simple_closed_source_chain");
      routeEdges.push(edge); nodeIds.push(edge.to); previous = cursor; cursor = edge.to; seen.add(cursor);
    } while (cursor !== start && routeEdges.length <= graph.size);
    if (cursor !== start || seen.size !== graph.size) reject("disconnected_source_loop");
  } else {
    if (start === end) reject("zero_length_candidate");
    const distances = new Map<number, number>([[start, 0]]), previous = new Map<number, { from: number; edge: Edge }>();
    const queue = [{ id: start, distance: 0 }];
    while (queue.length) {
      queue.sort((a, b) => a.distance - b.distance || a.id - b.id);
      const current = queue.shift()!;
      if (current.distance !== distances.get(current.id)) continue;
      if (current.id === end) break;
      for (const edge of [...(graph.get(current.id) ?? [])].sort((a, b) => a.wayId - b.wayId || a.to - b.to)) {
        const distance = current.distance + edge.distance;
        if (distance >= (distances.get(edge.to) ?? Infinity)) continue;
        distances.set(edge.to, distance); previous.set(edge.to, { from: current.id, edge }); queue.push({ id: edge.to, distance });
      }
    }
    if (!previous.has(end!)) reject("disconnected_source_graph");
    const reverseEdges: Edge[] = []; let cursor = end!;
    while (cursor !== start) { const step = previous.get(cursor)!; reverseEdges.push(step.edge); cursor = step.from; }
    routeEdges = reverseEdges.reverse(); nodeIds = [start, ...routeEdges.map(e => e.to)];
  }
  const points = nodeIds.map(id => nodes.get(id)!), distanceM = routeEdges.reduce((sum, e) => sum + e.distance, 0);
  const usedWayIds = [...new Set(routeEdges.map(e => e.wayId))].sort((a, b) => a - b);
  const relationDistance = routeEdges.filter(edge => memberIds.includes(edge.wayId)).reduce((sum, edge) => sum + edge.distance, 0);
  if (attestedRelation && relationDistance / distanceM < 0.9 && !hasIdentity(input)) reject("insufficient_relation_attestation");
  if (input.kind === "loop" && distanceM < 3000) reject("loop_shorter_than_3km");
  if (input.kind === "loop" && (points.length > 10_000 || !isSimpleClosedRoute(points))) reject("loop_geometry_not_simple");
  if (!attestedRelation && distanceM > 20_000) reject("objective_beyond_20km");
  if (distanceM > 100_000 || points.length > 100_000) reject("pilot_route_limit");
  for (const id of usedWayIds) reviewTerrain(input, ways.get(id)!);
  if (osmRouteHaversineMeters(places.trailhead, points[0]) > 125) reject("trailhead_source_gap");
  if (input.kind === "traverse" && osmRouteHaversineMeters(endTrailhead!, points[points.length - 1]) > 125) reject("end_trailhead_source_gap");
  if (objective && !placeContact(objective, input.kind === "destination" || input.kind === "summit" ? [points[points.length - 1]] : points, objective.features.includes("summit") ? 5 : objective.features.includes("trailhead") ? 125 : 250)) reject("objective_source_gap");
  const requiredCutIndices = [0];
  for (let i = 1; i < nodeIds.length - 1; i++) if (graph.get(nodeIds[i])!.length !== 2 || routeEdges[i - 1].wayId !== routeEdges[i].wayId) requiredCutIndices.push(i);
  requiredCutIndices.push(points.length - 1);
  const edges = routeEdges.map(({ wayId, startNodeId, endNodeId, names }) => ({ wayId, startNodeId, endNodeId, names }));
  return { input, trailhead: places.trailhead, objective, endTrailhead, points, nodeIds, edges, requiredCutIndices, usedWayIds, distanceM, mappedFraction: 1, sourceHashes: input.source.snapshots.map(s => s.sha256), geometryHash: sha256(stableJson({ points, edges })), attestation: attestedRelation ? `osm-relation:${relation!.id}` : `${identity!.publisher}:${identity!.sourceUrl}`, shape: input.kind === "loop" ? "loop" : input.kind === "traverse" ? "point_to_point" : "out_and_back" };
}
