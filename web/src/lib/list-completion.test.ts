import assert from "node:assert/strict";
import test from "node:test";

import { effectiveListCompletionTarget } from "./list-completion";

test("keeps valid any-N keeper rules", () => {
  assert.equal(effectiveListCompletionTarget(13, 18), 13);
  assert.equal(effectiveListCompletionTarget(10, 23), 10);
});

test("missing or invalid targets require the whole roster", () => {
  for (const target of [null, undefined, 0, -1, 19, 13.5, "13"]) {
    assert.equal(effectiveListCompletionTarget(target, 18), 18);
  }
});

test("an empty or invalid roster cannot be complete", () => {
  assert.equal(effectiveListCompletionTarget(1, 0), 0);
  assert.equal(effectiveListCompletionTarget(1, -1), 0);
  assert.equal(effectiveListCompletionTarget(1, 2.5), 0);
});
