import assert from "node:assert/strict";
import test from "node:test";
import { splitSegmentAtVertices, splitSegmentPieceIndices } from "./segment-geometry";

const points = Array.from({ length: 6 }, (_, index) =>
  ({ lat: 47 + index * 0.0000123456789, lng: -121, ele: 101.123456789 + index, dist: index * 1.375 }));
const split = { vertexIndices: [1, 3], originalPointCount: 6 };

test("exact split pieces preserve every source XYZ and share boundary objects", () => {
  const parts = splitSegmentAtVertices(points, split);
  assert.deepEqual(parts, [points.slice(0, 2), points.slice(1, 4), points.slice(3)]);
  assert.equal(parts[0][1], parts[1][0]);
  assert.deepEqual(parts.flatMap((part, index) => index ? part.slice(1) : part), points);
});

test("exact intervals select all pieces and reverse only their reference order", () => {
  assert.deepEqual(splitSegmentPieceIndices(split, 1, 5, "forward"), [1, 2]);
  assert.deepEqual(splitSegmentPieceIndices(split, 1, 5, "reverse"), [2, 1]);
  assert.deepEqual(splitSegmentPieceIndices(split, 0, 1, "forward"), [0]);
});

test("stale, absent, unsorted, endpoint and fractional split indices fail loudly", () => {
  assert.throws(() => splitSegmentAtVertices(points.slice(1), split), /geometry_changed/);
  assert.throws(() => splitSegmentAtVertices(points.map(point => ({ ...point, ele: NaN })), split), /geometry_invalid/);
  for (const vertexIndices of [[3, 1], [1, 1], [0], [5], [1.5], undefined]) {
    assert.throws(() => splitSegmentAtVertices(points, { ...split, vertexIndices: vertexIndices! }), /indices_invalid/);
  }
  assert.throws(() => splitSegmentPieceIndices(split, 2, 5, "forward"), /interval_invalid/);
  assert.throws(() => splitSegmentPieceIndices(split, undefined, 5, "forward"), /interval_invalid/);
});
