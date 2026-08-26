import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAllPlanRoutesAccessible,
  buildPlanRouteAccessQuery,
  normalizePlanRouteIds,
} from "./plan-route-access";

test("plan route access accepts only catalog or caller-owned rows", () => {
  const query = buildPlanRouteAccessQuery("user-1", ["catalog", "mine"]);
  assert.match(query.text, /r\.owner = 'peaks' OR r\.owner = \$2/);
  assert.match(query.text, /FOR SHARE/);
  assert.deepEqual(query.values, [["catalog", "mine"], "user-1"]);
  assert.doesNotThrow(() =>
    assertAllPlanRoutesAccessible(["catalog", "mine"], [
      { id: "catalog" },
      { id: "mine" },
    ])
  );
});

test("plan route access rejects a missing or foreign-owned id", () => {
  assert.throws(
    () => assertAllPlanRoutesAccessible(["catalog", "foreign"], [{ id: "catalog" }]),
    /routes are unavailable/
  );
});

test("plan route ids reject malformed input and deduplicate in order", () => {
  assert.deepEqual(normalizePlanRouteIds(["one", "one", "two"]), ["one", "two"]);
  assert.throws(() => normalizePlanRouteIds(["one", 2]), /Invalid routes/);
  assert.throws(() => normalizePlanRouteIds("one"), /Invalid routes/);
});
