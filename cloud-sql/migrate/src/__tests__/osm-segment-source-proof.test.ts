import test from "node:test";
import assert from "node:assert/strict";
import { contributingOsmWayIds, proveOsmSegmentSource } from "../osm-segment-source-proof";
import type { OsmRouteGraphSegment, OsmRoutePoint } from "../osm-route-geometry";

const points: OsmRoutePoint[] = [{ lat: 47, lng: -121 }, { lat: 47, lng: -120.999 }, { lat: 47, lng: -120.998 }];
const edges: OsmRouteGraphSegment[] = [
  { wayId: 10, startNodeId: 1, endNodeId: 2, start: points[0], end: points[1] },
  { wayId: 11, startNodeId: 2, endNodeId: 3, start: points[1], end: points[2] },
];

test("each exact segment proves only its actual contributing way subset", () => {
  const lower = proveOsmSegmentSource(points.slice(0, 2), edges.slice(0, 1), { strictMappedGeometry: true });
  const upper = proveOsmSegmentSource(points.slice(1), edges.slice(1), { strictMappedGeometry: true });
  assert.deepEqual(lower.errors, []); assert.deepEqual(upper.errors, []);
  assert.deepEqual(lower.usedWayIds, [10]); assert.deepEqual(upper.usedWayIds, [11]);
  assert.equal(lower.coverage, 1); assert.equal(lower.maxOffsetM, 0);
  assert.ok(proveOsmSegmentSource(points.slice(0, 2), edges, { strictMappedGeometry: true }).errors.some(e => e.includes("without positive geometry: 11")));
});
test("a touching or crossing way does not contribute positive route geometry", () => {
  const crossing: OsmRouteGraphSegment = { wayId: 12, startNodeId: 4, endNodeId: 5, start: { lat: 46.999, lng: -120.9995 }, end: { lat: 47.001, lng: -120.9995 } };
  assert.deepEqual(contributingOsmWayIds(points.slice(0, 2), [...edges, crossing]), [10]);
});
test("directed reverse source geometry is valid without changing provenance", () => {
  const proof = proveOsmSegmentSource([...points].reverse(), edges, { strictMappedGeometry: true });
  assert.deepEqual(proof.errors, []); assert.deepEqual(proof.usedWayIds, [10, 11]);
});
test("strict source citations exclude parallel ways within the geometry tolerance", () => {
  const parallel = edges.map(edge => ({ ...edge, wayId: edge.wayId + 10, startNodeId: edge.startNodeId + 10, endNodeId: edge.endNodeId + 10, start: { ...edge.start, lat: edge.start.lat + 0.000018 }, end: { ...edge.end, lat: edge.end.lat + 0.000018 } }));
  const proof = proveOsmSegmentSource(points, [...edges, ...parallel], { strictMappedGeometry: true });
  assert.deepEqual(proof.usedWayIds, [10, 11]);
  assert.ok(proof.errors.some(error => error.includes("without positive geometry: 20,21")));
  assert.deepEqual(contributingOsmWayIds(points, [...edges, ...parallel], { strictMappedGeometry: true }), [10, 11]);
  assert.deepEqual(contributingOsmWayIds(points, [...edges, ...parallel]), [10, 11, 20, 21]);
});
test("strict source geometry cannot drift after one exact edge establishes contribution", () => {
  const source = edges.map(edge => ({ ...edge, wayId: 10 }));
  const drifted = [...points.slice(0, 2), { ...points[2], lat: points[2].lat + 0.000009 }];
  const proof = proveOsmSegmentSource(drifted, source, { strictMappedGeometry: true });
  assert.deepEqual(proof.usedWayIds, [10]);
  assert.ok(proof.maxOffsetM < 2);
  assert.equal(proof.coverage, 1);
  assert.ok(proof.errors.some(error => error.includes("do not match exact cited source edges: 1")));
});
test("strict source geometry rejects a shortcut that skips a live source vertex", () => {
  const proof = proveOsmSegmentSource([points[0], points[2]], edges, { strictMappedGeometry: true });
  assert.deepEqual(proof.usedWayIds, []);
  assert.ok(proof.errors.some(error => error.includes("do not match exact cited source edges")));
});
test("the source union cannot hide the wrong segment source IDs", () => {
  const proof = proveOsmSegmentSource(points.slice(0, 2), edges.slice(1), { strictMappedGeometry: true });
  assert.ok(proof.errors.length > 0); assert.equal(proof.topologyValid, false);
});
test("catalog geometry cannot use an invented 118m summit connector", () => {
  const extended = [...points, { lat: 47.00107, lng: -120.998 }];
  const proof = proveOsmSegmentSource(extended, edges, { strictMappedGeometry: true });
  assert.ok(proof.maxOffsetM > 118);
  assert.ok(proof.errors.some(e => e.includes("end connector")));
  assert.ok(proof.errors.some(e => e.includes("maximum source offset")));
});
test("legacy outer connectors retain the125m bound and internal connectors are refused", () => {
  const extended = [{ lat: 46.9995, lng: -121 }, ...points];
  const allowed = proveOsmSegmentSource(extended, edges, { allowStartConnector: true });
  assert.deepEqual(allowed.errors, []);
  assert.ok(allowed.startConnectorM > 50 && allowed.startConnectorM < 60);
  assert.ok(proveOsmSegmentSource(extended, edges).errors.some(e => e.includes("start connector")));
  const tooFar = [{ lat: 46.998, lng: -121 }, ...points];
  assert.ok(proveOsmSegmentSource(tooFar, edges, { allowStartConnector: true }).errors.some(e => e.includes("start connector")));
});
test("review preserves max5m, p952m and99percent within3m source thresholds", () => {
  const shifted = points.map(p => ({ ...p, lat: p.lat + 0.000027 }));
  const proof = proveOsmSegmentSource(shifted, edges, { strictMappedGeometry: true });
  assert.ok(proof.maxOffsetM > 3 && proof.maxOffsetM < 5);
  assert.ok(proof.errors.some(e => e.includes("p95")));
  assert.ok(proof.errors.some(e => e.includes("coverage within3m")));
});
