import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPlanRoutesAccessible,
  normalizePlanRouteIds,
  parsePlanRouteRecords,
} from "../routes/plans";

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

test("normalizes valid route ids and rejects malformed route lists", () => {
  assert.deepEqual(normalizePlanRouteIds(["one", "one", "two"]), ["one", "two"]);
  assert.equal(normalizePlanRouteIds(undefined), undefined);
  assert.equal(normalizePlanRouteIds(["one", 2]), null);
  assert.equal(normalizePlanRouteIds("one"), null);
});

test("plan route access is limited to catalog or caller-owned rows", async () => {
  let sql = "";
  let values: unknown[] = [];
  const client = {
    async query(nextSql: string, nextValues: unknown[]) {
      sql = nextSql;
      values = nextValues;
      return { rows: [{ id: "catalog" }, { id: "mine" }] };
    },
  };

  await assertPlanRoutesAccessible(client as never, "user-1", ["catalog", "mine"]);
  assert.match(sql, /r\.owner = 'peaks' OR r\.owner = \$2/);
  assert.match(sql, /FOR SHARE/);
  assert.deepEqual(values, [["catalog", "mine"], "user-1"]);
});

test("plan route access rejects a missing or foreign-owned id", async () => {
  await assert.rejects(
    assertPlanRoutesAccessible(
      { async query() { return { rows: [{ id: "catalog" }] }; } } as never,
      "user-1",
      ["catalog", "foreign"]
    ),
    /routes are unavailable/
  );
});
