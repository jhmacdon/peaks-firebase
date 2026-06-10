// src/__tests__/processing-stale-claim.test.ts
//
// Sessions used to wedge at processing_state='processing' forever: if a
// processSession run died between the claim and Step 6 (e.g. Cloud Run killed
// the worker), the concurrency guard then rejected every retry with
// 'already_processing'. A claim timestamp (processing_started_at) lets a claim
// older than STALE_PROCESSING_MINUTES be recovered, while a fresh claim is still
// protected from a genuinely concurrent run.
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

describe("stale 'processing' claim recovery", { skip: skipReason ?? undefined }, () => {
  before(cleanup);
  after(cleanup);

  test("a stale 'processing' claim is re-claimable and completes", async () => {
    const sid = `${runPrefix}-stale`;
    await db.query(
      `INSERT INTO tracking_sessions
        (id, user_id, start_time, ended, processing_state, processing_started_at)
       VALUES ($1, $2, $3, true, 'processing', now() - INTERVAL '30 minutes')`,
      [sid, user, "2026-01-01T00:00:00Z"]
    );

    // Must NOT throw 'already_processing' — the dead claim is recoverable.
    await processSession(sid, user);

    const row = await db.query(
      `SELECT processing_state FROM tracking_sessions WHERE id = $1`,
      [sid]
    );
    assert.equal(row.rows[0].processing_state, "completed");
  });

  test("a fresh 'processing' claim is protected (already_processing)", async () => {
    const sid = `${runPrefix}-fresh`;
    await db.query(
      `INSERT INTO tracking_sessions
        (id, user_id, start_time, ended, processing_state, processing_started_at)
       VALUES ($1, $2, $3, true, 'processing', now())`,
      [sid, user, "2026-01-01T00:00:00Z"]
    );

    await assert.rejects(() => processSession(sid, user), /already_processing/);

    const row = await db.query(
      `SELECT processing_state FROM tracking_sessions WHERE id = $1`,
      [sid]
    );
    assert.equal(row.rows[0].processing_state, "processing", "fresh claim left untouched");
  });
});
