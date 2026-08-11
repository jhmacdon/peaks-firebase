import assert from "node:assert/strict";
import test from "node:test";
import { isFiniteNumber, isOptionalFiniteNumber } from "../lib/finite-number";
import { isValidMarkerPoint, isValidTrackingPoint } from "../routes/sessions";

test("finite elevation input keeps fractions and zero", () => {
  assert.equal(isFiniteNumber(1234.567890123), true);
  assert.equal(isFiniteNumber(0), true);
  assert.equal(isOptionalFiniteNumber(null), true);
  assert.equal(isOptionalFiniteNumber(undefined), true);
});

test("non-numeric and non-finite elevation input is rejected", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "1234", {}]) {
    assert.equal(isFiniteNumber(value), false);
    assert.equal(isOptionalFiniteNumber(value), false);
  }
});

test("tracking PointZ input requires finite lat, lng, time, and elevation", () => {
  const point = { lat: 47, lng: -121, time: 1_700_000_000, elevation: 1234.567890123 };
  assert.equal(isValidTrackingPoint(point), true);
  assert.equal(isValidTrackingPoint({ ...point, elevation: 0 }), true);
  assert.equal(isValidTrackingPoint({ ...point, elevation: null }), false);
  assert.equal(isValidTrackingPoint({ ...point, elevation: Number.NaN }), false);
  assert.equal(isValidTrackingPoint({ ...point, lat: Number.POSITIVE_INFINITY }), false);
});

test("marker PointZ input keeps zero and fractions but rejects missing Z", () => {
  assert.equal(isValidMarkerPoint(47, -121, 1234.567890123), true);
  assert.equal(isValidMarkerPoint(47, -121, 0), true);
  assert.equal(isValidMarkerPoint(47, -121, null), false);
  assert.equal(isValidMarkerPoint(47, -121, Number.NEGATIVE_INFINITY), false);
});
