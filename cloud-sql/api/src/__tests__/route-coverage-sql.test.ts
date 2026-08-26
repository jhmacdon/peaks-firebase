// Phase 2 of route matching. It measures three things per candidate route:
// how many vertices lie within 30 m of the track, how far along the route each
// covered vertex sits, and the route's own length. The merge into intervals
// happens in route-coverage.ts, not here. Pure builder, no live DB.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildRouteCoverageSql } from "../processing";

test("coverage SQL measures vertices against the session's stored track", () => {
  const { text, values } = buildRouteCoverageSql("sess1", ["route-a", "route-b"]);
  assert.match(text, /FROM tracking_sessions s WHERE s\.id = \$1/);
  assert.match(text, /ST_DumpPoints\(r\.path::geometry\)/);
  assert.match(text, /ST_DWithin\(rp\.pt::geography, st\.track, 30\)/);
  assert.deepEqual(values, ["sess1", ["route-a", "route-b"]]);
});

test("coverage SQL returns distance along the route for every covered vertex", () => {
  const { text } = buildRouteCoverageSql("sess1", ["route-a"]);
  // Cumulative metres from the previous vertex, in vertex order.
  assert.match(text, /lag\(rp\.pt\) OVER \(PARTITION BY rp\.route_id ORDER BY rp\.idx\)/);
  assert.match(text, /ST_Distance\(pt::geography, prev_pt::geography, false\)/);
  assert.match(text, /ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW/);
  assert.match(text, /array_agg\(along_m ORDER BY idx\) FILTER \(WHERE covered\)/);
  assert.match(text, /MAX\(along_m\) AS length_m/);
  assert.match(text, /COUNT\(\*\) FILTER \(WHERE covered\) AS matched_points/);
});

test("coverage SQL applies no gate of its own", () => {
  const { text } = buildRouteCoverageSql("sess1", ["route-a"]);
  // The 0.70 cutoff moved into selectRouteMatches; leaving one here too would
  // silently re-impose the old behaviour on partial rows.
  assert.doesNotMatch(text, /0\.70/);
  assert.doesNotMatch(text, /INSERT INTO/);
});
