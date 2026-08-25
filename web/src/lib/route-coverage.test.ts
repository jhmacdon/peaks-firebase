import assert from "node:assert/strict";
import test from "node:test";
import { ROUTE_DONE_COVERAGE, routeDoneCoverageSql } from "./route-coverage";

test("the web predicate matches the API's, NULL coverage included", () => {
  assert.equal(ROUTE_DONE_COVERAGE, 0.7);
  assert.equal(routeDoneCoverageSql("sr"), "(sr.coverage IS NULL OR sr.coverage >= 0.7)");
});
