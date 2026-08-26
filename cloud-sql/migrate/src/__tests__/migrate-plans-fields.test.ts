import assert from "node:assert/strict";
import test from "node:test";
import {
  firestorePlanDate,
  firestorePlanDestinationIds,
  firestorePlanIsPublic,
  resolveMigratedPlanRouteId,
} from "../migrate-plan-fields";

test("reads current iOS plan fields", () => {
  const plannedDate = new Date("2026-07-14T12:00:00Z");
  const data = {
    goals: ["peak", "trailhead"],
    destinations: ["legacy-wrong-value"],
    plannedDate,
    date: new Date("2020-01-01T00:00:00Z"),
  };

  assert.deepEqual(firestorePlanDestinationIds(data), ["peak", "trailhead"]);
  assert.equal(firestorePlanDate(data), plannedDate);
});

test("keeps legacy plan field aliases for the one-time backfill", () => {
  const date = new Date("2020-01-01T00:00:00Z");
  const data = {
    destinations: ["legacy-peak"],
    date,
  };

  assert.deepEqual(firestorePlanDestinationIds(data), ["legacy-peak"]);
  assert.equal(firestorePlanDate(data), date);
});

test("migrates plan visibility and fails closed for missing or malformed values", () => {
  assert.equal(firestorePlanIsPublic({ isPublic: true }), true);
  assert.equal(firestorePlanIsPublic({ is_public: true }), true);
  assert.equal(firestorePlanIsPublic({ isPublic: false }), false);
  assert.equal(firestorePlanIsPublic({}), false);
  assert.equal(firestorePlanIsPublic({ isPublic: "true" }), false);
});

test("recovers stale generated segment ids through a parent route", () => {
  const available = new Set(["catalog-route", "legacy-parent"]);

  assert.equal(resolveMigratedPlanRouteId("catalog-route", available), "catalog-route");
  assert.equal(
    resolveMigratedPlanRouteId("legacy-parent_segment1", available),
    "legacy-parent"
  );
  assert.equal(resolveMigratedPlanRouteId("missing-route", available), null);
});
