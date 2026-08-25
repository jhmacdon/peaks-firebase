import assert from "node:assert/strict";
import test from "node:test";
import {
  markerSignature,
  missingMultisetItems,
  normalizeMarkers,
  normalizePoints,
  stringIds,
  toDate,
} from "../firestore-sql-audit-model";

test("normalizes unique string ids", () => {
  assert.deepEqual(stringIds(["a", "a", 2, "", "b"]), ["a", "b"]);
  assert.deepEqual(stringIds(null), []);
});

test("reads Firestore, unix-second, and ISO dates", () => {
  const expected = new Date("2026-08-25T12:00:00.000Z");
  assert.equal(toDate({ toDate: () => expected })?.toISOString(), expected.toISOString());
  assert.equal(toDate(expected.getTime() / 1000)?.toISOString(), expected.toISOString());
  assert.equal(toDate(expected.toISOString())?.toISOString(), expected.toISOString());
  assert.equal(toDate("bad"), null);
});

test("points require finite 3D coordinates and unique integer times", () => {
  const result = normalizePoints("session", [
    { time: 10, lat: 47, lng: -122, elevation: 100 },
    { time: 10, lat: 47.1, lng: -122.1, elevation: 110 },
    { time: 11, lat: 47.2, lng: -122.2 },
  ]);

  assert.equal(result.points.length, 1);
  assert.equal(result.duplicateCount, 1);
  assert.deepEqual(result.errors, ["session:point:2:invalid time/lat/lng/elevation"]);
});

test("marker comparison preserves duplicate counts", () => {
  const { markers, errors } = normalizeMarkers("session", [{
    lat: 47,
    lng: -122,
    elevation: 100,
    created: "2026-08-25T12:00:00Z",
    name: "Camp",
  }, {
    lat: 47,
    lng: -122,
    elevation: 100,
    created: "2026-08-25T12:00:00Z",
    name: "Camp",
  }]);
  assert.deepEqual(errors, []);
  const signature = markerSignature(markers[0]);
  assert.equal(missingMultisetItems(markers, [signature], markerSignature).length, 1);
});
