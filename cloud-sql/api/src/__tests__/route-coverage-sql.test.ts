// Phase 2 of route matching. It measures three things per candidate route:
// how many vertices lie within 30 m of the track, how far along the route each
// covered vertex sits, and the route's own length. The merge into intervals
// happens in route-coverage.ts, not here. Pure builder, no live DB.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  TRIPLE_CROWN_INDEXED_ROUTE_IDS,
  buildRouteCoverageSql,
  measureSessionRouteCoverage,
} from "../processing";

test("coverage SQL measures vertices against the session's stored track", () => {
  const { text, values } = buildRouteCoverageSql("sess1", ["route-a", "route-b"]);
  assert.match(text, /FROM tracking_sessions s WHERE s\.id = \$1/);
  assert.match(text, /ST_Expand\(ST_Envelope\(s\.path::geometry\), 0\.005\) AS track_bbox/);
  assert.match(text, /FROM triple_crown_route_points/);
  assert.match(text, /rp\.pt && st\.track_bbox/);
  assert.match(text, /ST_DWithin\(rp\.pt::geography, st\.track, 30\)/);
  assert.deepEqual(values, ["sess1", ["route-a", "route-b"], TRIPLE_CROWN_INDEXED_ROUTE_IDS]);
});

test("coverage SQL returns distance along the route for every covered vertex", () => {
  const { text } = buildRouteCoverageSql("sess1", ["route-a"]);
  assert.match(text, /MAX\(along_m\) AS length_m/);
  assert.match(text, /COUNT\(\*\) AS total_points/);
  assert.match(text, /COUNT\(c\.idx\) AS matched_points/);
  assert.match(text, /array_agg\(c\.along_m ORDER BY c\.idx\)/);
  assert.match(text, /ST_DumpPoints\(r\.path::geometry\)/);
  assert.match(text, /ST_Distance\(pt::geography, prev_pt::geography, false\)/);
  assert.match(text, /NOT \(r\.id = ANY\(\$3::text\[\]\)\)/);
});

test("a missing Triple Crown point index fails instead of using the standard path", async () => {
  let query = 0;
  const q = {
    query: async () => query++ === 0
      ? { rows: [{ id: "triple-crown-pct" }] }
      : { rows: [] },
  };
  await assert.rejects(
    () => measureSessionRouteCoverage(q as never, "sess1"),
    /triple_crown_route_points_missing:triple-crown-pct/
  );
});

test("coverage SQL applies no gate of its own", () => {
  const { text } = buildRouteCoverageSql("sess1", ["route-a"]);
  // The 0.70 cutoff moved into selectRouteMatches; leaving one here too would
  // silently re-impose the old behaviour on partial rows.
  assert.doesNotMatch(text, /0\.70/);
  assert.doesNotMatch(text, /INSERT INTO/);
});
