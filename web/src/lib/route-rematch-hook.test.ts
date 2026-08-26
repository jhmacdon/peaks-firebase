// A route's line moved, so every auto-matched recording on it now carries
// coverage and covered_intervals measured against the old geometry. The fix is
// to hand those recordings back to the API's existing stuck-session sweep
// rather than recompute here: processSession owns the one implementation of
// the coverage maths, and the sweep already runs inside a Cloud Scheduler
// request (no timer, no always-on CPU, no new cost).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = readFileSync(
  join(fileURLToPath(new URL(".", import.meta.url)), "actions", "segment-matcher.ts"),
  "utf8"
);

const rematerialize = source.slice(source.indexOf("async function rematerializeRoute"));

test("a geometry recompute queues its recordings for rematching", () => {
  assert.match(rematerialize, /UPDATE routes SET path = ST_GeomFromText/);
  assert.match(rematerialize, /UPDATE tracking_sessions/);
  assert.match(rematerialize, /SET processing_state = 'pending'/);
  assert.match(rematerialize, /FROM session_routes sr/);
  assert.match(rematerialize, /sr\.route_id = \$1 AND sr\.source = 'auto'/);
});

test("the hook never steals a live processing claim or touches manual rows", () => {
  assert.match(rematerialize, /processing_state <> 'processing'/);
  assert.match(rematerialize, /ended = true/);
  assert.doesNotMatch(rematerialize, /DELETE FROM session_routes/);
});

test("the hook adds no timer and computes no coverage itself", () => {
  assert.doesNotMatch(rematerialize, /setInterval|setTimeout/);
  // It may NAME covered_intervals while explaining why it defers; what it must
  // never do is write one, or measure geometry, behind processSession's back.
  assert.doesNotMatch(rematerialize, /INSERT INTO session_routes/);
  assert.doesNotMatch(rematerialize, /covered_intervals\s*=/);
  assert.doesNotMatch(rematerialize, /ST_DumpPoints|ST_DWithin/);
});
