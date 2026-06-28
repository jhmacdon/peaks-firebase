// src/__tests__/processing-idempotency.test.ts
//
// processSession must be a no-op on an already-completed session unless forced.
// iOS's upload step 3 (and stray re-process triggers) otherwise re-claim and
// re-run the expensive PostGIS matching on sessions that are already done —
// the redundant heavy work that 503'd the whole API under a re-upload storm.
//
// Integration tests; gated on $DATABASE_URL like the other DB suites.

import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import { processSession } from "../processing";
import db from "../db";

const skipReason = process.env.DATABASE_URL
  ? null
  : "DATABASE_URL not set — skipping integration tests";

const runPrefix = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const user = `${runPrefix}-user`;

async function cleanup(): Promise<void> {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
}

describe("processSession idempotency", { skip: skipReason ?? undefined }, () => {
  before(cleanup);
  after(cleanup);

  test("an already-completed session is skipped, not re-claimed", async () => {
    const sid = `${runPrefix}-done`;
    await db.query(
      `INSERT INTO tracking_sessions
        (id, user_id, start_time, ended, processing_state, processed_at)
       VALUES ($1, $2, $3, true, 'completed', now())`,
      [sid, user, "2026-01-01T00:00:00Z"]
    );

    const result = await processSession(sid, user);
    assert.equal(result.skipped, true, "completed session returns skipped");

    // The claim UPDATE sets processing_started_at; a true skip never reaches it.
    const row = await db.query(
      `SELECT processing_state, processing_started_at
       FROM tracking_sessions WHERE id = $1`,
      [sid]
    );
    assert.equal(row.rows[0].processing_state, "completed");
    assert.equal(
      row.rows[0].processing_started_at,
      null,
      "completed session must not be re-claimed"
    );
  });

  test("force=true re-processes a completed session", async () => {
    const sid = `${runPrefix}-force`;
    await db.query(
      `INSERT INTO tracking_sessions
        (id, user_id, start_time, ended, processing_state, processed_at)
       VALUES ($1, $2, $3, true, 'completed', now())`,
      [sid, user, "2026-01-01T00:00:00Z"]
    );

    const result = await processSession(sid, user, { force: true });
    assert.notEqual(result.skipped, true, "force bypasses the skip");

    const row = await db.query(
      `SELECT processing_state, processing_started_at
       FROM tracking_sessions WHERE id = $1`,
      [sid]
    );
    assert.equal(row.rows[0].processing_state, "completed");
    assert.notEqual(
      row.rows[0].processing_started_at,
      null,
      "force re-claims (matching actually ran)"
    );
  });

  test("a pending session (new points) still processes", async () => {
    const sid = `${runPrefix}-pending`;
    await db.query(
      `INSERT INTO tracking_sessions
        (id, user_id, start_time, ended, processing_state)
       VALUES ($1, $2, $3, true, 'pending')`,
      [sid, user, "2026-01-01T00:00:00Z"]
    );

    const result = await processSession(sid, user);
    assert.notEqual(result.skipped, true, "a non-completed session is not skipped");

    const row = await db.query(
      `SELECT processing_state FROM tracking_sessions WHERE id = $1`,
      [sid]
    );
    assert.equal(row.rows[0].processing_state, "completed");
  });
});
