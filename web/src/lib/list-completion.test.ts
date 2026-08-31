import assert from "node:assert/strict";
import test from "node:test";

import {
  buildListProgress,
  effectiveListCompletionTarget,
} from "./list-completion";

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

test("progress keeps total as the full roster and uses the target as its goal", () => {
  assert.deepEqual(buildListProgress(18, 13, 13), {
    total: 18,
    member_count: 18,
    completion_target: 13,
    completed: 13,
    is_complete: true,
  });
});

test("progress bounds stale values without changing the total contract", () => {
  assert.deepEqual(buildListProgress(18, 19, 20), {
    total: 18,
    member_count: 18,
    completion_target: 18,
    completed: 18,
    is_complete: true,
  });
  assert.deepEqual(buildListProgress(0, 1, 1), {
    total: 0,
    member_count: 0,
    completion_target: 0,
    completed: 0,
    is_complete: false,
  });
});
