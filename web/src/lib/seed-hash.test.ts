import assert from "node:assert/strict";
import test from "node:test";

import { hashSeed } from "./seed-hash";

test("hashSeed is deterministic for the same input", () => {
  assert.equal(hashSeed("washington"), hashSeed("washington"));
});

test("hashSeed differs across distinct slugs", () => {
  const seeds = new Set(
    ["washington", "colorado", "hiking", "peak-bagging", "skiing", "trail-running"].map(
      hashSeed
    )
  );
  assert.equal(seeds.size, 6);
});

test("hashSeed always returns a non-negative uint32", () => {
  for (const slug of ["a", "washington", "", "north-carolina", "🏔️"]) {
    const seed = hashSeed(slug);
    assert.ok(Number.isInteger(seed));
    assert.ok(seed >= 0);
    assert.ok(seed <= 0xffffffff);
  }
});
