// process-all must drain not just pending/failed but ALSO sessions wedged at
// 'processing' by a storm whose process step died. The original predicate
// skipped 'processing' rows entirely, so those stuck sessions could never be
// re-processed (the points endpoint only re-triggers on NEW points). The SQL is
// pure/exported so the predicate is pinned without a DB.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildProcessAllCandidateSql } from "../routes/sessions";
import { STALE_PROCESSING_MINUTES } from "../processing";

test("candidate SQL selects pending and failed sessions", () => {
  const sql = buildProcessAllCandidateSql();
  assert.match(sql, /processing_state IN \('pending', 'failed'\)/);
});

test("candidate SQL also recovers STALE 'processing' claims", () => {
  const sql = buildProcessAllCandidateSql();
  assert.match(sql, /processing_state = 'processing'/, "must include processing rows");
  assert.match(
    sql,
    /processing_started_at IS NULL\s+OR s\.processing_started_at < now\(\) - make_interval/,
    "stale gate: null or older than the stale window"
  );
  assert.match(
    sql,
    new RegExp(`make_interval\\(mins => ${STALE_PROCESSING_MINUTES}\\)`),
    "stale window must match STALE_PROCESSING_MINUTES so a live run is never stolen"
  );
});

test("candidate SQL scopes to the user, requires ended + points", () => {
  const sql = buildProcessAllCandidateSql();
  assert.match(sql, /user_id = \$1/, "must scope to the authenticated user");
  assert.match(sql, /s\.ended = true/);
  assert.match(sql, /EXISTS \(SELECT 1 FROM tracking_points/, "must have points to process");
});
