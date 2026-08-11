import assert from "node:assert/strict";
import test from "node:test";
import { computeElevationStats } from "./elevation";

test("route elevation stats keep fractional source precision", () => {
  const result = computeElevationStats(
    [1234.567890123, 1240.123456789],
    { smooth: false, threshold: 0 }
  );

  assert.equal(result.min, 1234.567890123);
  assert.equal(result.max, 1240.123456789);
  assert.equal(result.gain, 1240.123456789 - 1234.567890123);
  assert.equal(result.loss, 0);
});
