// Phase-1 route candidate selection timed out (30s) on long tracks: the exact
// GEOGRAPHY ST_DWithin against a 71km / 7000-point line didn't use the GIST
// index and the planner seq-scanned every route. The fix selects candidates
// with cheap PLANAR ops (bbox && + planar ST_DWithin), leaving the precise
// 30m/70% coverage to Phase 2. Pure builder so the shape is asserted without a
// live DB.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildRouteCandidateSql } from "../processing";

test("buildRouteCandidateSql selects active routes for the session", () => {
  const { text, values } = buildRouteCandidateSql("sess1");
  assert.match(text, /FROM routes r, tracking_sessions s/);
  assert.match(text, /r\.status = 'active'/);
  assert.deepEqual(values, ["sess1"]);
});

// The regression guard: Phase 1 must be PLANAR (geometry) — a cheap bbox
// prefilter plus a planar distance. An exact GEOGRAPHY ST_DWithin here is what
// timed out, so it must NOT appear.
test("buildRouteCandidateSql uses a planar bbox + planar distance prefilter", () => {
  const { text } = buildRouteCandidateSql("sess1");
  assert.match(text, /r\.path::geometry && ST_Expand\(s\.path::geometry, 0\.005\)/);
  assert.match(text, /ST_DWithin\(r\.path::geometry, s\.path::geometry, 0\.005\)/);
  // No exact geography line-to-line distance in Phase 1 (the slow path).
  assert.doesNotMatch(text, /ST_DWithin\(r\.path, s\.path/);
});
