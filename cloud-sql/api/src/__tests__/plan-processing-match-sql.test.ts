// processPlan matches reached destinations against plans.path (client-supplied
// geometry) — the route-import / plan-detail clockless timeline source. The
// match query is a pure builder so its shape is asserted without a live DB,
// mirroring buildLinkReachedSummitsToAreasSql's test.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildPlanDestinationMatchSql, MAX_DESTINATION_MATCH_RADIUS_M } from "../processing";

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

test("buildPlanDestinationMatchSql uses boundary 10m match for polygon destinations", () => {
  const { text } = buildPlanDestinationMatchSql("plan1");
  assert.match(text, /d\.boundary IS NOT NULL/);
  assert.match(text, /ST_DWithin\(d\.boundary, p\.path, 10\)/);
});

// Same 30s-timeout fix as the session match: a constant-distance ST_DWithin
// the GIST index can prune with, applied before the per-row exact radius.
test("buildPlanDestinationMatchSql has a constant-distance index pre-filter", () => {
  const { text } = buildPlanDestinationMatchSql("plan1");
  assert.match(text, new RegExp(`ST_DWithin\\(d\\.location, p\\.path, ${MAX_DESTINATION_MATCH_RADIUS_M}\\)`));
  assert.match(text, /d\.boundary IS NULL/);
});
