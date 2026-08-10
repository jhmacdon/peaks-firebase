import assert from "node:assert/strict";
import test from "node:test";
import { parsePlanRouteRecords } from "../routes/plans";

const geometry = {
  type: "LineString",
  coordinates: [
    [-121.8, 46.8, 1234.567890123],
    [-121.7, 46.9, 1200.125],
  ],
};

test("accepts a complete route record linked by the plan", () => {
  const result = parsePlanRouteRecords([
    {
      id: "user-route",
      geometry,
      name: "Tamanos Mountain",
      destinations: ["peak"],
      distance: 1200,
      completion: "none",
    },
  ], ["user-route"]);

  assert.equal(result?.length, 1);
  assert.equal(result?.[0].id, "user-route");
});

test("rejects route records not listed on the plan", () => {
  assert.equal(parsePlanRouteRecords([
    { id: "other-route", geometry },
  ], ["user-route"]), null);
});

test("rejects missing geometry and invalid numeric fields", () => {
  assert.equal(parsePlanRouteRecords([{ id: "user-route" }], ["user-route"]), null);
  assert.equal(parsePlanRouteRecords([
    { id: "user-route", geometry, gain: "a lot" },
  ], ["user-route"]), null);
  assert.equal(parsePlanRouteRecords([
    { id: "user-route", geometry: { ...geometry, coordinates: [[0, 0], [1, 1]] } },
  ], ["user-route"]), null);
  assert.equal(parsePlanRouteRecords([
    { id: "user-route", geometry, gain: Number.POSITIVE_INFINITY },
  ], ["user-route"]), null);
});
