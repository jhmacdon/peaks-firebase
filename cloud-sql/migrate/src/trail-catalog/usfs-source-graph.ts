import { buildOfficialArcgisQueryUrl, haversineMeters, isSimpleClosedRoute, normalizeOfficialFeatureIds, parseOfficialArcgisPaths, parseOfficialFeatureIdsFromSourceUrl, type OfficialNetworkPath, type LatLng } from "../official-route-geometry";
import { getPublishableArcgisTrailSource, reviewOfficialTrailAccess } from "../official-trail-sources";
import { readHashedJson } from "./source-files";
import { CandidateRejection, sha256, stableJson } from "./graph";
import type { SourceSnapshot, UsfsSourceEdge, UsfsVertex } from "./types";
export type { UsfsVertex } from "./types";

export type UsfsEdge = UsfsSourceEdge;
export interface UsfsGraphPath {
  sourceId: "usfs-nfs-trails";
  points: LatLng[];
  /** edges[i] binds precisely points[i] → points[i+1] to the source part. */
  edges: UsfsEdge[];
  usedFeatureIds: string[];
  requiredCutIndices: number[];
  distanceM: number;
  mappedFraction: 1;
  geometryHash: string;
  sourceUrl: string;
  attestation: { type: "usfs_trail"; names: string[] };
}

export function loadUsfsSnapshot(snapshot: SourceSnapshot, featureIds: string[], baseDir: string): { paths: OfficialNetworkPath[]; body: string } {
  const source = getPublishableArcgisTrailSource("usfs-nfs-trails");
  const ids = parseOfficialFeatureIdsFromSourceUrl(source.service, snapshot.url);
  if (stableJson(ids) !== stableJson(normalizeOfficialFeatureIds(featureIds))) throw new CandidateRejection("usfs_snapshot_feature_ids_mismatch");
  const time = Date.parse(snapshot.retrievedAt);
  if (!Number.isFinite(time) || time > Date.now() + 300_000) throw new CandidateRejection("invalid_source_retrieval_time");
  const data = readHashedJson(snapshot.path, snapshot.sha256, baseDir);
  const paths = parseOfficialArcgisPaths(data.value, source.service, ids);
  const access = reviewOfficialTrailAccess(source, paths);
  if (!access.passed) throw new CandidateRejection("usfs_access_rejected", access.errors.join("; "));
  return { paths, body: data.body };
}

/** Canonical query URLs carry official feature IDs within the existing provenance shape. */
export function usfsSpanSourceUrl(edges: readonly UsfsEdge[], start: number, end: number): string {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > edges.length || start >= end) throw new CandidateRejection("invalid_usfs_source_interval");
  const ids = [...new Set(edges.slice(start, end).map(edge => edge.featureId))];
  return buildOfficialArcgisQueryUrl(getPublishableArcgisTrailSource("usfs-nfs-trails").service, ids).toString();
}

/** Route exact source vertices; this does not project, bridge gaps, or alter the stored route matcher. */
export function buildUsfsSourceGraphPath(paths: OfficialNetworkPath[], options: { start: UsfsVertex; end?: UsfsVertex; endCandidates?: UsfsVertex[]; loop?: boolean; loopPoints?: LatLng[]; maxDistanceM?: number }): UsfsGraphPath {
  const source = getPublishableArcgisTrailSource("usfs-nfs-trails"), access = reviewOfficialTrailAccess(source, paths);
  if (!access.passed) throw new CandidateRejection("usfs_access_rejected", access.errors.join("; "));
  if (paths.length > 5000) throw new CandidateRejection("usfs_graph_limit");
  type Edge = UsfsEdge & { to: string; distanceM: number };
  const nodes = new Map<string, LatLng>(), graph = new Map<string, Edge[]>(), byRef = new Map<string, string>(), parts = new Map<string, number>(), seenEdges = new Set<string>();
  const refKey = (ref: UsfsVertex) => `${ref.featureId}:${ref.part}:${ref.vertex}`;
  const nodeKey = (coordinate: number[]) => JSON.stringify(coordinate.slice(0, 2));
  const append = (from: string, edge: Edge) => graph.set(from, [...(graph.get(from) ?? []), edge]);
  for (const path of paths) {
    const part = parts.get(path.featureId) ?? 0; parts.set(path.featureId, part + 1);
    if (!path.featureId.trim() || path.coordinates.length < 2) throw new CandidateRejection("invalid_usfs_source_path");
    for (let i = 0; i < path.coordinates.length; i++) {
      const coordinate = path.coordinates[i], key = nodeKey(coordinate);
      if (coordinate.length !== 2 || !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1]) || Math.abs(coordinate[0]) > 180 || Math.abs(coordinate[1]) > 90) throw new CandidateRejection("invalid_usfs_source_vertex");
      nodes.set(key, { lng: coordinate[0], lat: coordinate[1] }); byRef.set(refKey({ featureId: path.featureId, part, vertex: i }), key);
      if (nodes.size > 50_000) throw new CandidateRejection("usfs_graph_limit");
      if (!i) continue;
      const prior = nodeKey(path.coordinates[i - 1]), edgeKey = [prior, key].sort().join("|");
      if (seenEdges.has(edgeKey)) throw new CandidateRejection("ambiguous_usfs_source_edge", `${path.featureId}:${part}:${i - 1}`);
      seenEdges.add(edgeKey);
      const distanceM = haversineMeters(nodes.get(prior)!, nodes.get(key)!);
      if (!(distanceM > 0)) throw new CandidateRejection("zero_length_usfs_source_edge");
      append(prior, { to: key, distanceM, featureId: path.featureId, part, startVertex: i - 1, endVertex: i, names: path.names });
      append(key, { to: prior, distanceM, featureId: path.featureId, part, startVertex: i, endVertex: i - 1, names: path.names });
    }
  }
  const start = byRef.get(refKey(options.start));
  let end = options.end ? byRef.get(refKey(options.end)) : undefined;
  const endNodes = new Set((options.endCandidates ?? (options.end ? [options.end] : [])).map(ref=>byRef.get(refKey(ref))).filter((id):id is string=>Boolean(id && graph.has(id) && id!==start)));
  if (!start || !graph.has(start) || (!options.loop && !endNodes.size)) throw new CandidateRejection("usfs_source_endpoint_missing");
  let edges: Edge[] = [];
  if (options.loop && options.loopPoints) {
    const cycle=options.loopPoints.map(point=>JSON.stringify([point.lng,point.lat]));
    if (cycle.length<4 || cycle.length>10_000 || cycle[0]!==start || cycle[cycle.length-1]!==start || new Set(cycle.slice(0,-1)).size!==cycle.length-1) throw new CandidateRejection("usfs_loop_not_closed_source_chain");
    for (let i=1;i<cycle.length;i++) {
      const choices=(graph.get(cycle[i-1])??[]).filter(edge=>edge.to===cycle[i]);
      if (choices.length!==1) throw new CandidateRejection("usfs_loop_source_edge_missing");
      edges.push(choices[0]);
    }
  } else if (options.loop) {
    if ([...graph.values()].some(values => values.length !== 2)) throw new CandidateRejection("usfs_loop_not_closed_source_chain");
    const seen = new Set<string>([start]); let previous = "", cursor = start;
    do {
      const next = graph.get(cursor)!.filter(edge => edge.to !== previous).sort((a,b) => a.featureId.localeCompare(b.featureId) || a.to.localeCompare(b.to))[0];
      if (!next || (seen.has(next.to) && next.to !== start)) throw new CandidateRejection("usfs_loop_not_closed_source_chain");
      edges.push(next); previous = cursor; cursor = next.to; seen.add(cursor);
    } while (cursor !== start && edges.length <= graph.size);
    if (cursor !== start || seen.size !== graph.size) throw new CandidateRejection("usfs_loop_disconnected");
  } else {
    const distances = new Map<string, number>([[start, 0]]), previous = new Map<string, { from: string; edge: Edge }>(), queue = [{ id: start, distance: 0 }];
    while (queue.length) {
      queue.sort((a,b) => a.distance - b.distance || a.id.localeCompare(b.id));
      const current = queue.shift()!;
      if (current.distance !== distances.get(current.id)) continue;
      if (endNodes.has(current.id)) { end=current.id; break; }
      for (const edge of [...(graph.get(current.id) ?? [])].sort((a,b) => a.featureId.localeCompare(b.featureId) || a.to.localeCompare(b.to))) {
        const distance = current.distance + edge.distanceM;
        if (distance > (options.maxDistanceM ?? 20_000) || distance >= (distances.get(edge.to) ?? Infinity)) continue;
        distances.set(edge.to, distance); previous.set(edge.to, { from: current.id, edge }); queue.push({ id: edge.to, distance });
      }
    }
    if (!end || !endNodes.has(end) || !previous.has(end)) throw new CandidateRejection("usfs_source_disconnected_or_beyond_limit");
    let cursor = end!;
    while (cursor !== start) { const step = previous.get(cursor)!; edges.push(step.edge); cursor = step.from; }
    edges.reverse();
  }
  const nodeIds = [start, ...edges.map(edge => edge.to)], points = nodeIds.map(id => nodes.get(id)!);
  const distanceM = edges.reduce((sum, edge) => sum + edge.distanceM, 0);
  if (options.loop && (distanceM < 3000 || points.length > 10_000 || !isSimpleClosedRoute(points))) throw new CandidateRejection("usfs_loop_geometry_invalid");
  const requiredCutIndices = [0];
  for (let i = 1; i < points.length - 1; i++) if (graph.get(nodeIds[i])!.length !== 2 || edges[i - 1].featureId !== edges[i].featureId || edges[i - 1].part !== edges[i].part) requiredCutIndices.push(i);
  requiredCutIndices.push(points.length - 1);
  const usedFeatureIds = [...new Set(edges.map(edge => edge.featureId))].sort(), names = [...new Set(edges.flatMap(edge => edge.names))].sort();
  if (!names.length) throw new CandidateRejection("usfs_trail_name_missing");
  const spans = edges.map(({ featureId, part, startVertex, endVertex, names }) => ({ featureId, part, startVertex, endVertex, names }));
  return { sourceId: "usfs-nfs-trails", points, edges: spans, usedFeatureIds, requiredCutIndices, distanceM, mappedFraction: 1, geometryHash: sha256(stableJson({ points, edges: spans })), sourceUrl: usfsSpanSourceUrl(spans, 0, spans.length), attestation: { type: "usfs_trail", names } };
}

export { proveUsfsSourceSpan } from "../usfs-segment-source-proof";
