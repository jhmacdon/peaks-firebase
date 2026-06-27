// isValidPlanGeometry guards the plan create/update DB call from malformed or
// wrong-type GeoJSON (which would otherwise 500 inside the transaction or fail
// the geography column type). Geometry is optional, so absent is valid.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isValidPlanGeometry } from "../routes/plans";

test("absent geometry is valid (optional field)", () => {
  assert.equal(isValidPlanGeometry(undefined), true);
  assert.equal(isValidPlanGeometry(null), true);
});

test("a well-formed LineString is valid", () => {
  assert.equal(
    isValidPlanGeometry({ type: "LineString", coordinates: [[-121.7, 46.85], [-121.71, 46.86]] }),
    true
  );
});

test("non-LineString geometry types are rejected", () => {
  assert.equal(isValidPlanGeometry({ type: "Point", coordinates: [-121.7, 46.85] }), false);
  assert.equal(isValidPlanGeometry({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }), false);
});

test("a Feature wrapper (not a raw geometry) is rejected", () => {
  assert.equal(
    isValidPlanGeometry({ type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } }),
    false
  );
});

test("fewer than 2 points is rejected", () => {
  assert.equal(isValidPlanGeometry({ type: "LineString", coordinates: [[0, 0]] }), false);
});

test("NaN / non-finite coordinates are rejected", () => {
  assert.equal(isValidPlanGeometry({ type: "LineString", coordinates: [[0, 0], [NaN, 1]] }), false);
});

test("non-object input is rejected", () => {
  assert.equal(isValidPlanGeometry("LineString"), false);
  assert.equal(isValidPlanGeometry(42), false);
});
