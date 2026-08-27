// Phase-1 route candidate selection timed out (30s) on long tracks: the exact
// GEOGRAPHY ST_DWithin against a 71km / 7000-point line didn't use the GIST
// index and the planner seq-scanned every route. The fix selects candidates
// with cheap PLANAR ops (bbox && + planar ST_DWithin), leaving the precise
// 30m/70% coverage to Phase 2. Pure builder so the shape is asserted without a
// live DB.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { TRIPLE_CROWN_INDEXED_ROUTE_IDS, buildRouteCandidateSql } from "../processing";

test("buildRouteCandidateSql selects active routes for the session", () => {
  const { text, values } = buildRouteCandidateSql("sess1");
  assert.match(text, /FROM routes r, tracking_sessions s/);
  assert.match(text, /r\.status = 'active'/);
  assert.match(text, /r\.owner = 'peaks' OR r\.owner = s\.user_id/);
  assert.deepEqual(values, ["sess1", TRIPLE_CROWN_INDEXED_ROUTE_IDS]);
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

test("buildRouteCandidateSql subdivides continent-scale route lines", () => {
  const { text } = buildRouteCandidateSql("sess1");
  assert.match(text, /WHEN ST_NPoints\(r\.path::geometry\) <= 8192/);
  assert.match(text, /ST_Subdivide\(r\.path::geometry, 512\) AS route_part\(geom\)/);
  assert.match(text, /route_part\.geom && ST_Expand\(s\.path::geometry, 0\.005\)/);
  assert.match(text, /ST_DWithin\(route_part\.geom, s\.path::geometry, 0\.005\)/);
});

test("buildRouteCandidateSql uses the scoped Triple Crown point index", () => {
  const { text } = buildRouteCandidateSql("sess1");
  assert.match(text, /WHEN r\.id = ANY\(\$2::text\[\]\)/);
  assert.match(text, /FROM triple_crown_route_points tcp/);
  assert.match(text, /tcp\.route_id = r\.id/);
  assert.match(text, /ST_DWithin\(tcp\.pt, s\.path::geometry, 0\.005\)/);
});
