// src/__tests__/session-destinations-clobber.test.ts
//
// Regression tests for the "disappearing summit" bug: a server-side
// auto-detected destination (session_destinations.source = 'auto', written by
// processSession's matchDestinations) MUST survive a client write that does not
// include it. iOS `TrackingSession.toAPIBody()` always sends `destinations_reached`
// (often the empty/stale local list) on every createSession/updateSession PUT.
// The old handlers did `DELETE FROM session_destinations WHERE session_id=$1`
// (ALL rows) before reinserting the client list, which permanently deleted the
// auto-detected summit. The fix scopes that DELETE to client-owned ('manual')
// rows so auto detections are never clobbered by a client round-trip.
//
// Integration tests against the real schema. Requires $DATABASE_URL to gate
// (set it to any non-empty string when DB_HOST/DB_NAME/... point at a dev or
// proxied Postgres). Skips cleanly otherwise.

import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import request from "supertest";
import { app } from "../index";
import db from "../db";

const skipReason = process.env.DATABASE_URL
  ? null
  : "DATABASE_URL not set — skipping integration tests";

const runPrefix = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const user = `${runPrefix}-user`;
const autoDestId = `${runPrefix}-autoDest`;
const manualDestId = `${runPrefix}-manualDest`;

async function createSession(id: string): Promise<void> {
  await db.query(
    `INSERT INTO tracking_sessions (id, user_id, start_time, ended, processing_state)
     VALUES ($1, $2, $3, true, 'completed')`,
    [id, user, "2026-06-07T17:00:00Z"]
  );
}

async function createDestination(id: string, name: string): Promise<void> {
  // Remote location (near the South Pole) so the AFTER INSERT
  // link_sessions_on_destination_insert trigger can't match any real user's
  // tracking points — keeps these fixtures from touching production sessions.
  await db.query(
    `INSERT INTO destinations (id, name, search_name, location, owner, features)
     VALUES ($1, $2, $3, ST_MakePoint(0, -89.9, 100)::geography, 'peaks', '{summit}')
     ON CONFLICT (id) DO NOTHING`,
    [id, name, name.toLowerCase()]
  );
}

async function reachedRows(sessionId: string): Promise<Array<{ destination_id: string; source: string }>> {
  const res = await db.query(
    `SELECT destination_id, source FROM session_destinations
     WHERE session_id = $1 AND relation = 'reached' ORDER BY destination_id`,
    [sessionId]
  );
  return res.rows;
}

async function cleanupTestData(): Promise<void> {
  // tracking_sessions delete cascades to session_destinations; destinations are
  // independent so delete them explicitly. Both scoped to the unique prefix.
  await db.query(`DELETE FROM tracking_sessions WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
  await db.query(`DELETE FROM destinations WHERE id LIKE $1`, [`${runPrefix}-%`]);
}

describe("session_destinations auto-detection is not clobbered by client writes", { skip: skipReason ?? undefined }, () => {
  before(async () => {
    await cleanupTestData();
    await createDestination(autoDestId, "Auto Summit");
    await createDestination(manualDestId, "Manual Summit");
  });
  after(cleanupTestData);

  test("PUT /api/sessions/:id with empty destinations_reached preserves the auto row", async () => {
    const sid = `${runPrefix}-s1`;
    await createSession(sid);
    // Simulate processSession having auto-detected a summit.
    await db.query(
      `INSERT INTO session_destinations (session_id, destination_id, relation, source)
       VALUES ($1, $2, 'reached', 'auto')`,
      [sid, autoDestId]
    );

    // iOS pushes its (empty) local destinations list back.
    const res = await request(app)
      .put(`/api/sessions/${sid}`)
      .set("X-Test-User", user)
      .send({ destinations_reached: [], destination_goals: [] });
    assert.equal(res.status, 200);

    const rows = await reachedRows(sid);
    assert.deepEqual(rows, [{ destination_id: autoDestId, source: "auto" }],
      "auto-detected reached destination must survive an empty client write");
  });

  test("PUT keeps the auto row AND adds a client-supplied manual reached", async () => {
    const sid = `${runPrefix}-s2`;
    await createSession(sid);
    await db.query(
      `INSERT INTO session_destinations (session_id, destination_id, relation, source)
       VALUES ($1, $2, 'reached', 'auto')`,
      [sid, autoDestId]
    );

    const res = await request(app)
      .put(`/api/sessions/${sid}`)
      .set("X-Test-User", user)
      .send({ destinations_reached: [manualDestId] });
    assert.equal(res.status, 200);

    const rows = await reachedRows(sid);
    assert.deepEqual(rows, [
      { destination_id: autoDestId, source: "auto" },
      { destination_id: manualDestId, source: "manual" },
    ].sort((a, b) => a.destination_id.localeCompare(b.destination_id)),
      "auto row preserved; manual reached added");
  });

  test("POST /api/sessions/:id/destinations with empty reached preserves the auto row", async () => {
    const sid = `${runPrefix}-s3`;
    await createSession(sid);
    await db.query(
      `INSERT INTO session_destinations (session_id, destination_id, relation, source)
       VALUES ($1, $2, 'reached', 'auto')`,
      [sid, autoDestId]
    );

    const res = await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ reached: [], goals: [] });
    assert.equal(res.status, 200);

    const rows = await reachedRows(sid);
    assert.deepEqual(rows, [{ destination_id: autoDestId, source: "auto" }],
      "auto-detected reached destination must survive an empty client write");
  });

  test("a client can still remove a previously client-added manual reached", async () => {
    const sid = `${runPrefix}-s4`;
    await createSession(sid);
    await db.query(
      `INSERT INTO session_destinations (session_id, destination_id, relation, source)
       VALUES ($1, $2, 'reached', 'auto'), ($1, $3, 'reached', 'manual')`,
      [sid, autoDestId, manualDestId]
    );

    // Client pushes a list omitting the manual one (user removed it) — manual
    // goes away, auto stays.
    const res = await request(app)
      .put(`/api/sessions/${sid}`)
      .set("X-Test-User", user)
      .send({ destinations_reached: [] });
    assert.equal(res.status, 200);

    const rows = await reachedRows(sid);
    assert.deepEqual(rows, [{ destination_id: autoDestId, source: "auto" }],
      "manual reached removable by client; auto preserved");
  });
});
