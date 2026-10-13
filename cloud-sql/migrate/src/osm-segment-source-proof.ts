import { nearestOsmRouteSource, osmRouteHaversineMeters, reviewOsmRouteGeometry, reviewOsmRouteTopology, type OsmRouteGraphSegment, type OsmRoutePoint } from "./osm-route-geometry";
import { interpolateWorldPosition, normalizeLongitudeDelta, pointToSegmentMeters, projectPointToSegmentMeters } from "./route-world-geometry";

function exactSourceEdgeProof(points: readonly OsmRoutePoint[], sources: readonly OsmRouteGraphSegment[]): { usedWayIds: number[]; unmatchedEdgeIndices: number[] } {
  const pointKey = (point: OsmRoutePoint) => JSON.stringify([point.lng, point.lat]);
  const edgeKey = (a: OsmRoutePoint, b: OsmRoutePoint) => [pointKey(a), pointKey(b)].sort().join("|");
  const sourceEdges = new Map<string, Set<number>>();
  for (const source of sources) {
    if (pointKey(source.start) === pointKey(source.end)) continue;
    const key = edgeKey(source.start, source.end), ids = sourceEdges.get(key) ?? new Set<number>();
    ids.add(source.wayId); sourceEdges.set(key, ids);
  }
  const used = new Set<number>(), unmatchedEdgeIndices: number[] = [];
  for (let i = 1; i < points.length; i++) {
    if (pointKey(points[i - 1]) === pointKey(points[i])) continue;
    const ids = sourceEdges.get(edgeKey(points[i - 1], points[i]));
    if (!ids) unmatchedEdgeIndices.push(i - 1);
    else for (const id of ids) used.add(id);
  }
  return { usedWayIds: [...used].sort((a, b) => a - b), unmatchedEdgeIndices };
}

/** Catalog imports retain exact source edges. Legacy reviews retain their overlap tolerance. */
export function contributingOsmWayIds(points: readonly OsmRoutePoint[], sources: readonly OsmRouteGraphSegment[], options: { strictMappedGeometry?: boolean } = {}): number[] {
  if (options.strictMappedGeometry) return exactSourceEdgeProof(points, sources).usedWayIds;
  const used = new Set<number>();
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], distance = osmRouteHaversineMeters(a, b);
    if (distance <= 0) continue;
    for (const source of sources) {
      if (used.has(source.wayId)) continue;
      const scale = Math.cos((a.lat + b.lat + source.start.lat + source.end.lat) / 4 * Math.PI / 180);
      const ax = normalizeLongitudeDelta(b.lng - a.lng) * scale, ay = b.lat - a.lat;
      const bx = normalizeLongitudeDelta(source.end.lng - source.start.lng) * scale, by = source.end.lat - source.start.lat;
      const alignment = Math.abs(ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
      if (!(alignment >= 0.99)) continue;
      const start = projectPointToSegmentMeters(source.start, a, b), end = projectPointToSegmentMeters(source.end, a, b);
      const bounded = (start.distanceM <= 5 && end.distanceM <= 5) || (pointToSegmentMeters(a, source.start, source.end) <= 5 && pointToSegmentMeters(b, source.start, source.end) <= 5);
      if (bounded && Math.abs(end.fraction - start.fraction) * distance > 0.01) used.add(source.wayId);
    }
  }
  return [...used].sort((a, b) => a - b);
}

export interface OsmSpanProof {
  errors: string[]; usedWayIds: number[]; maxOffsetM: number; p95OffsetM: number; coverage: number; sampleCount: number;
  startConnectorM: number; endConnectorM: number; topologyValid: boolean;
}
/** Independent review uses live source edges; it does not call the candidate graph builder. */
export function proveOsmSegmentSource(points: OsmRoutePoint[], sources: OsmRouteGraphSegment[], options: { allowStartConnector?: boolean; allowEndConnector?: boolean; strictMappedGeometry?: boolean } = {}): OsmSpanProof {
  const errors: string[] = [];
  if (points.length < 2 || !sources.length) return { errors: ["segment or source geometry is empty"], usedWayIds: [], maxOffsetM: Infinity, p95OffsetM: Infinity, coverage: 0, sampleCount: 0, startConnectorM: Infinity, endConnectorM: Infinity, topologyValid: false };
  const geometry = reviewOsmRouteGeometry(points, sources), topology = reviewOsmRouteTopology(points, sources);
  const startConnectorM = Math.max(geometry.startConnectorM, topology.valid ? topology.startConnectorM : 0);
  const endConnectorM = Math.max(geometry.endConnectorM, topology.valid ? topology.endConnectorM : 0);
  if (!topology.valid) errors.push("segment changes cited ways outside shared source nodes");
  if (startConnectorM > (options.allowStartConnector ? 125 : 0.1) || geometry.startConnectorJoinOffsetM > 5) errors.push("segment start connector is unsupported");
  if (endConnectorM > (options.allowEndConnector ? 125 : 0.1) || geometry.endConnectorJoinOffsetM > 5) errors.push("segment end connector is unsupported");
  const samples = options.strictMappedGeometry ? [...points] : [...geometry.coreSamples];
  if (options.strictMappedGeometry) for (let i = 1; i < points.length; i++) {
    const divisions = Math.ceil(osmRouteHaversineMeters(points[i - 1], points[i]) / 20);
    if (divisions > 10_000 || samples.length + divisions > 100_000) { errors.push("source proof sample limit exceeded"); break; }
    for (let j = 1; j < divisions; j++) { const [lng, lat] = interpolateWorldPosition([points[i - 1].lng, points[i - 1].lat], [points[i].lng, points[i].lat], j / divisions); samples.push({ lat, lng }); }
  }
  const offsets = samples.map(p => nearestOsmRouteSource(p, sources).distance).sort((a, b) => a - b);
  const maxOffsetM = offsets.length ? offsets[offsets.length - 1] : Infinity;
  const p95OffsetM = offsets.length ? offsets[Math.max(0, Math.ceil(offsets.length * 0.95) - 1)] : Infinity;
  const coverage = offsets.length ? offsets.filter(offset => offset <= 3).length / offsets.length : 0;
  if (maxOffsetM > 5) errors.push(`segment maximum source offset is ${maxOffsetM.toFixed(2)} m`);
  if (p95OffsetM > 2) errors.push(`segment p95 source offset is ${p95OffsetM.toFixed(2)} m`);
  if (coverage < 0.99) errors.push(`segment source coverage within3m is ${(coverage * 100).toFixed(2)}%`);
  const exact = options.strictMappedGeometry ? exactSourceEdgeProof(points, sources) : null;
  if (exact?.unmatchedEdgeIndices.length) errors.push(`segment edges do not match exact cited source edges: ${exact.unmatchedEdgeIndices.slice(0, 20).join(",")}${exact.unmatchedEdgeIndices.length > 20 ? "…" : ""}`);
  const usedWayIds = exact?.usedWayIds ?? contributingOsmWayIds(points, sources), cited = [...new Set(sources.map(s => s.wayId))];
  const unused = cited.filter(id => !usedWayIds.includes(id));
  if (unused.length) errors.push(`segment cites ways without positive geometry: ${unused.join(",")}`);
  return { errors, usedWayIds, maxOffsetM, p95OffsetM, coverage, sampleCount: samples.length, startConnectorM, endConnectorM, topologyValid: topology.valid };
}

export default { contributingOsmWayIds, proveOsmSegmentSource };
