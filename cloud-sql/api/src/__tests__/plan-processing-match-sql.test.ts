// processPlan matches reached destinations against plans.path (client-supplied
// geometry) — the route-import / plan-detail clockless timeline source. The
// match query is a pure builder so its shape is asserted without a live DB,
// mirroring buildLinkReachedSummitsToAreasSql's test.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildPlanDestinationMatchSql,
  MAX_BOUNDARY_MATCH_RADIUS_M,
  MAX_DESTINATION_MATCH_RADIUS_M,
} from "../processing";

test("buildPlanDestinationMatchSql matches against plans.path with feature radius", () => {
  const { text, values } = buildPlanDestinationMatchSql("plan1");
  assert.match(text, /INSERT INTO plan_reached_destinations/);
  assert.match(text, /destination_match_radius\(d\.features\)/);
  assert.match(text, /ST_DWithin/);
  assert.match(text, /'auto'/);
  assert.match(text, /ON CONFLICT \(plan_id, destination_id\) DO NOTHING/);
  assert.deepEqual(values, ["plan1"]);
});

test("buildPlanDestinationMatchSql orders reached destinations along the path", () => {
  const { text } = buildPlanDestinationMatchSql("plan1");
  // ordinal is assigned by position along the path, not arbitrary
  assert.match(text, /ST_LineLocatePoint/);
  assert.match(text, /row_number\(\) OVER/i);
});

test("buildPlanDestinationMatchSql scopes destinations to system + plan owner", () => {
  const { text } = buildPlanDestinationMatchSql("plan1");
  assert.match(text, /d\.owner = 'peaks' OR d\.owner = p\.user_id/);
});

// Outlined places match on a per-feature distance from the outline: 50 m for
// lakes, 10 m otherwise. A hiker stops at a lake's shore, often on slabs or
// cliffs above the water, and never walks into it.
test("buildPlanDestinationMatchSql uses the per-feature boundary distance", () => {
  const { text } = buildPlanDestinationMatchSql("plan1");
  assert.match(text, /d\.boundary IS NOT NULL/);
  assert.match(
    text,
    /ST_DWithin\(bp\.boundary_part, p\.path, destination_boundary_match_radius\(d\.features\)\)/
  );
});

// Same index rule as the point branch: the per-row distance cannot use the
// GIST index on the pieces, so a constant at least as wide prunes first.
test("buildPlanDestinationMatchSql prunes boundary pieces by a constant distance", () => {
  const { text } = buildPlanDestinationMatchSql("plan1");
  assert.equal(MAX_BOUNDARY_MATCH_RADIUS_M, 50, "must cover the widest boundary distance");
  assert.match(
    text,
    new RegExp(`ST_DWithin\\(bp\\.boundary_part, p\\.path, ${MAX_BOUNDARY_MATCH_RADIUS_M}\\)`)
  );
});

// A lake outline can hold 475k points. A distance check against the whole
// polygon took a 16-point session over 150 s in production; the indexed
// pieces in destination_boundary_parts take under a second.
test("buildPlanDestinationMatchSql never measures distance to a whole boundary", () => {
  const { text } = buildPlanDestinationMatchSql("plan1");
  assert.match(text, /FROM destination_boundary_parts bp/);
  assert.doesNotMatch(text, /ST_DWithin\(d\.boundary/);
  assert.doesNotMatch(text, /ST_Distance\(d\.boundary/);
});

// Same 30s-timeout fix as the session match: a constant-distance ST_DWithin
// the GIST index can prune with, applied before the per-row exact radius.
test("buildPlanDestinationMatchSql has a constant-distance index pre-filter", () => {
  const { text } = buildPlanDestinationMatchSql("plan1");
  assert.match(text, new RegExp(`ST_DWithin\\(d\\.location, p\\.path, ${MAX_DESTINATION_MATCH_RADIUS_M}\\)`));
  assert.match(text, /d\.boundary IS NULL/);
});
