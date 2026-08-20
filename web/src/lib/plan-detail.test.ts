import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  buildPlanMapMarkers,
  buildPlanMapRoutes,
  buildPlanTopline,
  orderByIds,
  pickerNames,
  type PlanDestinationRow,
  type PlanRouteRow,
} from "./plan-detail";

function destination(overrides: Partial<PlanDestinationRow> = {}): PlanDestinationRow {
  return {
    id: "d1",
    name: "Mount Si",
    elevation: 1280,
    features: ["summit"],
    lat: 47.48,
    lng: -121.73,
    ...overrides,
  };
}

function route(overrides: Partial<PlanRouteRow> = {}): PlanRouteRow {
  return {
    id: "r1",
    name: "Old Trail",
    polyline6: "abc123",
    distance: 8000,
    gain: 900,
    status: "active",
    ...overrides,
  };
}

test("orderByIds restores the plan's saved order from an unordered ANY() result", () => {
  const rows = [{ id: "c" }, { id: "a" }, { id: "b" }];
  assert.deepEqual(orderByIds(rows, ["a", "b", "c"]).map((r) => r.id), ["a", "b", "c"]);
});

test("orderByIds drops ids that never resolved to a row (deleted catalog entry)", () => {
  const rows = [{ id: "a" }];
  assert.deepEqual(orderByIds(rows, ["a", "missing"]).map((r) => r.id), ["a"]);
});

test("orderByIds drops duplicate ids in the input list rather than repeating a row", () => {
  const rows = [{ id: "a" }];
  assert.deepEqual(orderByIds(rows, ["a", "a"]).map((r) => r.id), ["a"]);
});

test("buildPlanTopline is empty when the plan was never processed", () => {
  assert.deepEqual(buildPlanTopline(null), []);
  assert.deepEqual(buildPlanTopline({ distance: null, gain: null }), []);
});

test("buildPlanTopline renders only the fields that are actually populated", () => {
  const stats = buildPlanTopline({ distance: 15300, gain: null });
  assert.deepEqual(stats, [{ key: "distance", value: "9.5", unit: "mi", label: "Distance" }]);
});

test("buildPlanTopline renders both distance and gain when both are present", () => {
  const stats = buildPlanTopline({ distance: 1609.34, gain: 304.8 });
  assert.deepEqual(stats, [
    { key: "distance", value: "1.0", unit: "mi", label: "Distance" },
    { key: "gain", value: "1,000", unit: "ft", label: "Elevation gain" },
  ]);
});

test("buildPlanMapMarkers drops destinations with no coordinates", () => {
  const markers = buildPlanMapMarkers([
    destination({ id: "a" }),
    destination({ id: "b", lat: null }),
    destination({ id: "c", lng: null }),
  ]);
  assert.deepEqual(markers.map((m) => m.id), ["a"]);
});

test("buildPlanMapMarkers dedupes a destination that appears in more than one group", () => {
  const markers = buildPlanMapMarkers(
    [destination({ id: "a", name: "Chosen name" })],
    [destination({ id: "a", name: "Reached name" }), destination({ id: "b" })]
  );
  assert.equal(markers.length, 2);
  assert.equal(markers.find((m) => m.id === "a")?.name, "Chosen name");
});

test("buildPlanMapRoutes drops routes with no polyline", () => {
  const routes = buildPlanMapRoutes([route({ id: "a" }), route({ id: "b", polyline6: null })]);
  assert.deepEqual(routes.map((r) => r.id), ["a"]);
});

test("pickerNames falls back to Unnamed, matching the rest of the site's convention", () => {
  assert.deepEqual(pickerNames([{ id: "a", name: null }, { id: "b", name: "Camp Muir" }]), [
    { id: "a", name: "Unnamed" },
    { id: "b", name: "Camp Muir" },
  ]);
});
