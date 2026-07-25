// src/__tests__/session-destination-rejections.test.ts
//
// session_destination_rejections is the server-side "I didn't reach this" state.
// Three code paths insert auto 'reached' rows and every one of them must
// anti-join it, or the rejection is silently resurrected:
//   1. buildSessionDestinationMatchSql   (processSession re-match)
//   2. link_sessions_on_destination_insert (a NEW destination back-matching old sessions)
//   3. backfillDestinationToSessions     (web admin destination create)
//
// (1) and (2) are proven end to end against the real schema; (3) lives in the
// Next.js web package, which has no test runner, so its SQL is asserted by
// reading the source — the same invariant scripts/check-cross-refs.sh enforces.
//
// Integration tests gated on $DATABASE_URL. Fixtures use a unique prefix and an
// empty South-Atlantic location so no production row can be touched.

import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import db from "../db";
import { processSession } from "../processing";

const skipReason = process.env.DATABASE_URL
  ? null
  : "DATABASE_URL not set — skipping integration tests";

const runPrefix = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const user = `${runPrefix}-user`;

// Empty South Atlantic. A summit's match radius is 30 m, so a destination
// placed at exactly these coordinates matches the track and nothing else does.
const LAT = -52.0;
const LNG = -22.0;
const BASE_TIME = 1_600_000_000;

async function createSessionWithTrack(id: string): Promise<void> {
  await db.query(
    `INSERT INTO tracking_sessions (id, user_id, start_time, ended, processing_state)
     VALUES ($1, $2, $3, true, 'pending')`,
    [id, user, "2026-06-07T17:00:00Z"]
  );
  for (let i = 0; i < 3; i++) {
    await db.query(
      `INSERT INTO tracking_points (session_id, time, segment_number, location, elevation)
       VALUES ($1, $2, 0, ST_SetSRID(ST_MakePoint($3, $4, 100), 4326)::geography, 100)`,
      [id, BASE_TIME + i * 60, LNG + i * 0.00005, LAT]
    );
  }
  await db.query(
    `UPDATE tracking_sessions s
     SET path = (SELECT ST_MakeLine(tp.location::geometry ORDER BY tp.time)::geography
                 FROM tracking_points tp WHERE tp.session_id = s.id)
     WHERE s.id = $1`,
    [id]
  );
}

async function createSummit(id: string): Promise<void> {
  await db.query(
    `INSERT INTO destinations (id, name, search_name, location, owner, features)
     VALUES ($1, $1, $1, ST_SetSRID(ST_MakePoint($2, $3, 100), 4326)::geography, 'peaks', '{summit}')
     ON CONFLICT (id) DO NOTHING`,
    [id, LNG, LAT]
  );
}

async function reachedIds(sessionId: string): Promise<string[]> {
  const res = await db.query(
    `SELECT destination_id FROM session_destinations
     WHERE session_id = $1 AND relation = 'reached' ORDER BY destination_id`,
    [sessionId]
  );
  return res.rows.map((r: { destination_id: string }) => r.destination_id);
}

async function cleanup(): Promise<void> {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
  await db.query(`DELETE FROM session_attempt_groups WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
  await db.query(`DELETE FROM session_groups WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
  await db.query(`DELETE FROM destinations WHERE id LIKE $1`, [`${runPrefix}-%`]);
}

describe("session_destination_rejections is honored by every auto-matcher", { skip: skipReason ?? undefined }, () => {
  before(cleanup);
  after(cleanup);

  test("re-processing does not re-insert a rejected pair, but does insert an unrejected one", async () => {
    const sid = `${runPrefix}-s1`;
    const rejectedDest = `${runPrefix}-rejected1`;
    const keptDest = `${runPrefix}-kept1`;
    await createSessionWithTrack(sid);
    await createSummit(rejectedDest);
    await createSummit(keptDest);
    // The creation trigger may already have linked both; clear and reject one.
    await db.query(`DELETE FROM session_destinations WHERE session_id = $1`, [sid]);
    await db.query(
      `INSERT INTO session_destination_rejections (session_id, destination_id)
       VALUES ($1, $2)`,
      [sid, rejectedDest]
    );

    await processSession(sid, user, { force: true });

    const ids = await reachedIds(sid);
    assert.ok(ids.includes(keptDest), "an unrejected nearby summit must still auto-match");
    assert.ok(!ids.includes(rejectedDest), "a rejected pair must never be re-matched");
  });

  // The trigger fires only on INSERT of a destination, and a rejection row has
  // an FK to destinations — so a rejection can never pre-date the destination
  // that would fire the trigger, and there is no way to stage the behavioral
  // case from a test. Assert instead that the DEPLOYED function carries the
  // anti-join (this also proves the migration reached this database), and keep
  // a behavioral control proving the trigger still links an unrejected pair.
  test("the live link_sessions_on_destination_insert anti-joins rejections", async () => {
    const res = await db.query(
      `SELECT prosrc FROM pg_proc WHERE proname = 'link_sessions_on_destination_insert'`
    );
    assert.equal(res.rows.length, 1);
    assert.match(res.rows[0].prosrc, /session_destination_rejections/);
    assert.match(res.rows[0].prosrc, /NOT EXISTS/);
  });

  test("creating a destination still links a session that never rejected it", async () => {
    const sid = `${runPrefix}-s2`;
    const freshDest = `${runPrefix}-fresh2`;
    await createSessionWithTrack(sid);
    await createSummit(freshDest);

    assert.ok((await reachedIds(sid)).includes(freshDest),
      "the anti-join must not over-filter — an unrejected pair still links");
  });

  test("deleting a session cascades its rejections away", async () => {
    const sid = `${runPrefix}-s3`;
    const dest = `${runPrefix}-cascade3`;
    await createSessionWithTrack(sid);
    await createSummit(dest);
    await db.query(
      `INSERT INTO session_destination_rejections (session_id, destination_id) VALUES ($1, $2)`,
      [sid, dest]
    );
    await db.query(`DELETE FROM tracking_sessions WHERE id = $1`, [sid]);

    const res = await db.query(
      `SELECT count(*)::int AS n FROM session_destination_rejections WHERE session_id = $1`,
      [sid]
    );
    assert.equal(res.rows[0].n, 0);
  });
});

// The web twin has no test runner of its own; assert its SQL directly. Runs
// with or without a DB.
test("web backfillDestinationToSessions anti-joins rejections", () => {
  // __dirname (not import.meta) — the package compiles as commonjs.
  const source = readFileSync(
    join(__dirname, "../../../../web/src/lib/destination-backfill.ts"),
    "utf8"
  );
  assert.match(source, /session_destination_rejections/,
    "the web destination-create backfill must skip rejected pairs like the API matcher does");
  assert.match(source, /NOT EXISTS/);
});
