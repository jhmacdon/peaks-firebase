import assert from "node:assert/strict";
import test from "node:test";

import {
  getRouteTraversalMetrics,
  summarizeRouteGuide,
} from "./route-guide";

test("out-and-back metrics describe the full return trip", () => {
  const route = {
    distance: 5_000,
    gain: 1_200,
    gain_loss: 100,
    shape: "out_and_back",
    completion: "none",
    destination_count: 2,
  };

  assert.deepEqual(getRouteTraversalMetrics(route), {
    distanceMeters: 10_000,
    gainMeters: 1_300,
    lossMeters: 1_300,
  });

  const guide = summarizeRouteGuide(route);
  assert.ok(guide.distanceMiles);
  assert.ok(Math.abs(guide.distanceMiles - 6.2137) < 0.001);
  assert.ok(guide.gainFeet);
  assert.ok(Math.abs(guide.gainFeet - 4_265.092) < 0.001);
  assert.equal(guide.gainFeet, guide.lossFeet);
});

test("point-to-point metrics keep the stored one-way values", () => {
  const route = {
    distance: 5_000,
    gain: 1_200,
    gain_loss: 100,
    shape: "point_to_point",
  };

  assert.deepEqual(getRouteTraversalMetrics(route), {
    distanceMeters: 5_000,
    gainMeters: 1_200,
    lossMeters: 100,
  });
});

test("missing out-and-back vertical stats stay unknown", () => {
  assert.deepEqual(
    getRouteTraversalMetrics({
      distance: null,
      gain: null,
      gain_loss: null,
      shape: "out_and_back",
    }),
    {
      distanceMeters: null,
      gainMeters: null,
      lossMeters: null,
    }
  );
});
