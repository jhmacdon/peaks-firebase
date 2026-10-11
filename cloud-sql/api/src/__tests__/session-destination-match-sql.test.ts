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
  MAX_BOUNDARY_MATCH_RADIUS_M,
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

// Outlined places match on a per-feature distance from the outline: 50 m for
// lakes, 10 m otherwise. A hiker stops at a lake's shore, often on slabs or
// cliffs above the water, and never walks into it.
test("buildSessionDestinationMatchSql uses the per-feature boundary distance", () => {
  const { text } = buildSessionDestinationMatchSql("sess1");
  assert.match(text, /d\.boundary IS NOT NULL/);
  assert.match(
    text,
    /ST_DWithin\(bp\.boundary_part, track\.piece, destination_boundary_match_radius\(d\.features\)\)/
  );
});

// Same index rule as the point branch: the per-row distance cannot use the
// GIST index on the pieces, so a constant at least as wide prunes first.
test("buildSessionDestinationMatchSql prunes boundary pieces by a constant distance", () => {
  const { text } = buildSessionDestinationMatchSql("sess1");
  assert.equal(MAX_BOUNDARY_MATCH_RADIUS_M, 50, "must cover the widest boundary distance");
  assert.match(
    text,
    new RegExp(`ST_DWithin\\(bp\\.boundary_part, track\\.piece, ${MAX_BOUNDARY_MATCH_RADIUS_M}\\)`)
  );
});

// A lake outline can hold 475k points. A distance check against the whole
// polygon took a 16-point session over 150 s in production; the indexed
// pieces in destination_boundary_parts take under a second.
test("buildSessionDestinationMatchSql never measures distance to a whole boundary", () => {
  const { text } = buildSessionDestinationMatchSql("sess1");
  assert.match(text, /JOIN destination_boundary_parts bp/);
  assert.doesNotMatch(text, /ST_DWithin\(d\.boundary/);
  assert.doesNotMatch(text, /ST_Distance\(d\.boundary/);
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

// A rejected (session, destination) pair must never be re-inserted by
// re-processing. The rejection lives in its own table because Step 1 of
// processSession deletes every source='auto' row before re-matching, so a
// rejection recorded on session_destinations itself would be erased.
test("buildSessionDestinationMatchSql anti-joins session_destination_rejections", () => {
  const { text } = buildSessionDestinationMatchSql("sess1");
  assert.match(text, /NOT EXISTS/);
  assert.match(text, /session_destination_rejections/);
  assert.match(text, /r\.session_id = s\.id AND r\.destination_id = d\.id/);
});

// A long track measured whole against each nearby outline piece cost about
// 0.5 s per piece: a 103 km, 4,441-point hike took 95 s at 10 m and passed the
// 120 s processing limit at 50 m (2026-10-11). Short track pieces take 4 s.
test("buildSessionDestinationMatchSql measures outlines against short track pieces", () => {
  const { text } = buildSessionDestinationMatchSql("sess1");
  assert.match(text, /ST_DumpPoints\(s\.path::geometry\)/);
  assert.match(text, /ST_MakeLine\(pt\.geom ORDER BY pt\.i\)::geography AS piece/);
  // ST_Subdivide hung on a track that doubles back, and its cut points leave
  // the geodesic on long segments.
  assert.doesNotMatch(text, /ST_Subdivide\(s\.path/);
  assert.doesNotMatch(text, /ST_DWithin\(bp\.boundary_part, s\.path/);
});
