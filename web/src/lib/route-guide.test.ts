import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRouteAbout,
  describeRouteShape,
  formatDistanceMeters,
  getRouteTraversalMetrics,
  shouldShowElevationLoss,
  summarizeRouteGuide,
} from "./route-guide";

test("route About copy omits facts already shown in the stat row", () => {
  assert.deepEqual(buildRouteAbout({ shape: "out_and_back", completion: "none" }), []);
  assert.deepEqual(
    buildRouteAbout({ shape: "point_to_point", completion: "straight" }),
    ["Recommended in the forward direction."]
  );
});

test("formatDistanceMeters uses feet below 0.19 mi, then miles at one decimal", () => {
  assert.equal(formatDistanceMeters(150), "492 ft");
  assert.equal(formatDistanceMeters(305), "1,001 ft");
  assert.equal(formatDistanceMeters(516), "0.3 mi");
  assert.equal(formatDistanceMeters(1441), "0.9 mi");
  assert.equal(formatDistanceMeters(5471), "3.4 mi");
});

test("formatDistanceMeters falls back to an em dash for missing input", () => {
  assert.equal(formatDistanceMeters(null), "—");
  assert.equal(formatDistanceMeters(undefined), "—");
  assert.equal(formatDistanceMeters(NaN), "—");
});

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

test("describeRouteShape returns null instead of an 'Unknown shape' placeholder", () => {
  assert.equal(describeRouteShape(null), null);
  assert.equal(describeRouteShape(undefined), null);
  assert.equal(describeRouteShape("out_and_back"), "out and back");
});

test("shouldShowElevationLoss hides 0/null loss on a non-loop route", () => {
  assert.equal(shouldShowElevationLoss(0, "point_to_point"), false);
  assert.equal(shouldShowElevationLoss(null, "point_to_point"), false);
  assert.equal(shouldShowElevationLoss(320, "point_to_point"), true);
  assert.equal(shouldShowElevationLoss(0, null), false);
});

test("shouldShowElevationLoss always shows loop routes, even 0/null", () => {
  assert.equal(shouldShowElevationLoss(0, "loop"), true);
  assert.equal(shouldShowElevationLoss(null, "loop"), true);
});

test("summarizeRouteGuide hides an implausible 'Moderate' grade above 3000 ft of gain", () => {
  const steepRoute = {
    distance: 6_000, // ~3.7 mi, low density so the raw score lands on Moderate
    gain: 1_100, // ~3,609 ft
    gain_loss: 1_100,
    shape: "loop",
    completion: "none",
    destination_count: 1,
  };
  const guide = summarizeRouteGuide(steepRoute);
  assert.ok(guide.gainFeet && guide.gainFeet > 3000);
  assert.equal(guide.difficultyLabel, null);
});

test("summarizeRouteGuide keeps a plausible Moderate grade under 3000 ft of gain", () => {
  const moderateRoute = {
    distance: 7_000,
    gain: 650,
    gain_loss: 650,
    shape: "loop",
    completion: "none",
    destination_count: 1,
  };
  const guide = summarizeRouteGuide(moderateRoute);
  assert.ok(guide.gainFeet && guide.gainFeet < 3000);
  assert.equal(guide.difficultyLabel, "Moderate");
});
