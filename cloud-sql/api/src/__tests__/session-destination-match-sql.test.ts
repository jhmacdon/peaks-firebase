// matchDestinations is the session-processing step that 30s-timed-out on the
// production db-f1-micro: it scanned EVERY global destination because the
// per-row destination_match_radius() distance is not GIST-index-usable. The
// fix adds a constant-distance pre-filter (MAX_DESTINATION_MATCH_RADIUS_M) that
// the index CAN use, pruning to the handful of destinations near the track
// before the exact, per-feature radius is applied. The query is a pure builder
// so its shape is asserted without a live DB, mirroring buildPlanDestinationMatchSql.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildSessionDestinationMatchSql,
  MAX_DESTINATION_MATCH_RADIUS_M,
} from "../processing";

test("buildSessionDestinationMatchSql inserts auto reached destinations", () => {
  const { text, values } = buildSessionDestinationMatchSql("sess1");
  assert.match(text, /INSERT INTO session_destinations/);
  assert.match(text, /'reached', 'auto'/);
  assert.match(text, /ON CONFLICT \(session_id, destination_id\) DO NOTHING/);
  assert.deepEqual(values, ["sess1"]);
});

test("buildSessionDestinationMatchSql scopes destinations to system + session owner", () => {
  const { text } = buildSessionDestinationMatchSql("sess1");
  assert.match(text, /d\.owner = 'peaks' OR d\.owner = s\.user_id/);
});

test("buildSessionDestinationMatchSql keeps the exact per-feature radius", () => {
  const { text } = buildSessionDestinationMatchSql("sess1");
  assert.match(text, /ST_DWithin\(d\.location, s\.path, destination_match_radius\(d\.features\)\)/);
});

test("buildSessionDestinationMatchSql uses boundary 10m match for polygon destinations", () => {
  const { text } = buildSessionDestinationMatchSql("sess1");
  assert.match(text, /d\.boundary IS NOT NULL/);
  assert.match(text, /ST_DWithin\(d\.boundary, s\.path, 10\)/);
});

// The regression guard: without a CONSTANT-distance ST_DWithin, the GIST index
// on destinations.location cannot prune and the query falls back to an exact
// distance check against every destination — the 30s statement_timeout that
// wedged ~all of one user's sessions at 'failed'/'processing'.
test("buildSessionDestinationMatchSql has a constant-distance index pre-filter", () => {
  const { text } = buildSessionDestinationMatchSql("sess1");
  assert.equal(MAX_DESTINATION_MATCH_RADIUS_M, 200, "must cover the widest per-feature radius");
  assert.match(
    text,
    new RegExp(`ST_DWithin\\(d\\.location, s\\.path, ${MAX_DESTINATION_MATCH_RADIUS_M}\\)`),
    "point destinations must be GIST-pruned by a constant max radius before the exact filter"
  );
  // The point branch must be gated on boundary IS NULL so a boundary
  // destination is matched ONLY by its polygon (preserves the old CASE).
  assert.match(text, /d\.boundary IS NULL/);
});
