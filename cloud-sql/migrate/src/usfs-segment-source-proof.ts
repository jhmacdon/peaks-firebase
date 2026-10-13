import { normalizeOfficialFeatureIds, reviewOfficialRouteGeometry, haversineMeters, type OfficialNetworkPath, type LatLng } from "./official-route-geometry";
import { getPublishableArcgisTrailSource, reviewOfficialTrailAccess } from "./official-trail-sources";
import { interpolateWorldPosition, pointToSegmentMeters } from "./route-world-geometry";

/** Independent proof against freshly parsed official features, including each feature's positive contribution. */
export function proveUsfsSourceSpan(points: LatLng[], paths: OfficialNetworkPath[], featureIds: string[]): { passed: boolean; errors: string[]; usedFeatureIds: string[]; coverage: number; maxOffsetM: number; p95OffsetM: number } {
  const source = getPublishableArcgisTrailSource("usfs-nfs-trails"), ids = normalizeOfficialFeatureIds(featureIds);
  const selected = paths.filter(path => ids.includes(path.featureId));
  const access = reviewOfficialTrailAccess(source, selected), errors = [...access.errors];
  const missing = ids.filter(id => !selected.some(path => path.featureId === id));
  if (missing.length) errors.push(`USFS source omitted cited features: ${missing.join(",")}`);
  const review = reviewOfficialRouteGeometry(points, selected, ids);
  if (!review.sourceTopologyValid) errors.push("USFS source topology does not support this span");
  if (review.startConnectorM > 0.1 || review.endConnectorM > 0.1 || review.internalConnectorMaxM > 0.1) errors.push("USFS span includes an unsupported connector");
  const edgeKey = (a: LatLng, b: LatLng) => [JSON.stringify([a.lng,a.lat]),JSON.stringify([b.lng,b.lat])].sort().join("|");
  const sourceEdges = new Map<string, Set<string>>();
  for (const path of selected) for (let i = 1; i < path.coordinates.length; i++) {
    const a = {lng:path.coordinates[i - 1][0],lat:path.coordinates[i - 1][1]}, b = {lng:path.coordinates[i][0],lat:path.coordinates[i][1]};
    if (a.lng === b.lng && a.lat === b.lat) continue;
    const key = edgeKey(a,b), featureIds = sourceEdges.get(key) ?? new Set<string>();
    featureIds.add(path.featureId); sourceEdges.set(key,featureIds);
  }
  const used = new Set<string>(), unmatched: number[] = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i - 1].lng === points[i].lng && points[i - 1].lat === points[i].lat) continue;
    const featureIds = sourceEdges.get(edgeKey(points[i - 1],points[i]));
    if (!featureIds) unmatched.push(i - 1);
    else for (const id of featureIds) used.add(id);
  }
  if (unmatched.length) errors.push(`USFS span edges do not match exact cited source edges: ${unmatched.slice(0,20).join(",")}${unmatched.length > 20 ? "…" : ""}`);
  const usedFeatureIds = [...used].sort(), unused = ids.filter(id => !used.has(id));
  if (unused.length) errors.push(`USFS features do not contribute positive geometry: ${unused.join(",")}`);
  const samples = [...points];
  for (let i = 1; i < points.length; i++) {
    const divisions = Math.ceil(haversineMeters(points[i - 1], points[i]) / 20);
    if (divisions > 10_000 || samples.length + divisions > 100_000) { errors.push("USFS source proof sample limit exceeded"); break; }
    for (let j = 1; j < divisions; j++) { const [lng,lat] = interpolateWorldPosition([points[i - 1].lng,points[i - 1].lat], [points[i].lng,points[i].lat], j/divisions); samples.push({lat,lng}); }
  }
  const segments = selected.flatMap(path => path.coordinates.slice(1).map((point, i) => ({ start: {lng:path.coordinates[i][0],lat:path.coordinates[i][1]}, end: {lng:point[0],lat:point[1]} })));
  const offsets = samples.map(point => segments.reduce((minimum, segment) => Math.min(minimum,pointToSegmentMeters(point,segment.start,segment.end)),Infinity)).sort((a,b) => a-b);
  const maxOffsetM = offsets.length ? offsets[offsets.length - 1] : Infinity, p95OffsetM = offsets.length ? offsets[Math.max(0,Math.ceil(offsets.length*0.95)-1)] : Infinity;
  const coverage = offsets.length ? offsets.filter(offset => offset <= 3).length/offsets.length : 0;
  if (maxOffsetM > 5) errors.push("USFS source maximum offset exceeds5m");
  if (p95OffsetM > 2) errors.push("USFS source p95 offset exceeds2m");
  if (coverage < 0.99) errors.push("USFS source coverage within3m is below99percent");
  return { passed: errors.length === 0, errors, usedFeatureIds, coverage, maxOffsetM, p95OffsetM };
}

export default { proveUsfsSourceSpan };
