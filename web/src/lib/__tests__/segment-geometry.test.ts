import assert from "node:assert/strict";
import test from "node:test";
import { extractSubPoints } from "../segment-geometry";
import type { TrackPoint } from "../route-utils";

const points: TrackPoint[] = [
  { lat: 0, lng: 0, ele: 100, dist: 0 },
  { lat: 1, lng: 1, ele: 200, dist: 100 },
  { lat: 2, lng: 2, ele: 300, dist: 200 },
];

test("extractSubPoints interpolates both split boundaries", () => {
  const result = extractSubPoints(points, 25, 175);

  assert.deepEqual(result, [
    { lat: 0.25, lng: 0.25, ele: 125, dist: 25 },
    points[1],
    { lat: 1.75, lng: 1.75, ele: 275, dist: 175 },
  ]);
});

test("adjacent split parts share the same boundary point", () => {
  const first = extractSubPoints(points, 0, 80);
  const second = extractSubPoints(points, 80, 200);

  assert.deepEqual(first.at(-1), second[0]);
  assert.equal(first.at(-1)?.dist, 80);
});
