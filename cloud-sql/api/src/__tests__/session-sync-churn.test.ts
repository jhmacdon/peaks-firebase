// A PUT that resends what the server already holds must not mark the session
// changed. The app resends sessions it already synced (2026-10-09: 70-150 PUTs
// per launch); when each one bumped server_updated_at, the next
// /api/sessions/changes downloaded them all again with their heart-rate
// series (83 sessions, 14.5 MB, 14 s). Two writers did the bumping:
// update_tracking_session_timestamps on any UPDATE, and the session_destinations
// touch trigger when reconcileClientDestinations deleted and re-inserted an
// unchanged manual list (migrations/20261009_session_timestamp_on_change.sql).
//
// Integration tests gated on $TEST_DATABASE_URL, fixtures prefixed + in empty
// South Atlantic water.

import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import request from "supertest";
import { app } from "../index";
import db from "../db";

import { dbSkipReason as skipReason } from "./helpers/test-db";

const runPrefix = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const user = `${runPrefix}-user`;

async function createSession(id: string): Promise<void> {
  await db.query(
    `INSERT INTO tracking_sessions (id, user_id, name, start_time, ended, processing_state)
     VALUES ($1, $2, 'Morning hike', $3, true, 'completed')`,
    [id, user, "2026-06-07T17:00:00Z"]
  );
}

async function createDistantSummit(id: string): Promise<void> {
  await db.query(
    `INSERT INTO destinations (id, name, search_name, location, owner, features)
     VALUES ($1, $1, $1, ST_SetSRID(ST_MakePoint(-19, -49, 100), 4326)::geography, 'peaks', '{summit}')
     ON CONFLICT (id) DO NOTHING`,
    [id]
  );
}

async function timestamps(sessionId: string): Promise<{ updated: Date; server: Date }> {
  const res = await db.query(
    `SELECT updated_at, server_updated_at FROM tracking_sessions WHERE id = $1`,
    [sessionId]
  );
  return { updated: res.rows[0].updated_at, server: res.rows[0].server_updated_at };
}

async function cleanup(): Promise<void> {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
  await db.query(`DELETE FROM destinations WHERE id LIKE $1`, [`${runPrefix}-%`]);
}

const healthData = {
  heartRates: [
    { date: "2026-06-07T17:00:00Z", heartRate: 120 },
    { date: "2026-06-07T17:01:00Z", heartRate: 125 },
  ],
  calories: [],
};

describe("unchanged session writes keep the sync timestamp", { skip: skipReason ?? undefined }, () => {
  before(cleanup);
  after(cleanup);

  test("a PUT resending the same fields, health data and destinations bumps nothing", async () => {
    const sid = `${runPrefix}-s1`;
    const dest = `${runPrefix}-dest1`;
    await createSession(sid);
    await createDistantSummit(dest);
    const body = { name: "Morning hike", health_data: healthData, destinations_reached: [dest] };

    const first = await request(app).put(`/api/sessions/${sid}`).set("X-Test-User", user).send(body);
    assert.equal(first.status, 200);
    const afterFirst = await timestamps(sid);

    const again = await request(app).put(`/api/sessions/${sid}`).set("X-Test-User", user).send(body);
    assert.equal(again.status, 200);
    const afterAgain = await timestamps(sid);

    assert.equal(afterAgain.server.getTime(), afterFirst.server.getTime(),
      "an identical PUT must not move server_updated_at");
    assert.equal(afterAgain.updated.getTime(), afterFirst.updated.getTime(),
      "an identical PUT must not move updated_at");
  });

  test("a real change still bumps the sync timestamp", async () => {
    const sid = `${runPrefix}-s2`;
    await createSession(sid);
    const before = await timestamps(sid);

    const res = await request(app).put(`/api/sessions/${sid}`).set("X-Test-User", user)
      .send({ name: "Evening hike" });
    assert.equal(res.status, 200);
    assert.ok((await timestamps(sid)).server > before.server, "a renamed session must sync");
  });

  test("dropping a manual destination still bumps the sync timestamp", async () => {
    const sid = `${runPrefix}-s3`;
    const dest = `${runPrefix}-dest3`;
    await createSession(sid);
    await createDistantSummit(dest);
    await request(app).put(`/api/sessions/${sid}`).set("X-Test-User", user)
      .send({ destinations_reached: [dest] });
    const before = await timestamps(sid);

    const res = await request(app).put(`/api/sessions/${sid}`).set("X-Test-User", user)
      .send({ destinations_reached: [] });
    assert.equal(res.status, 200);
    assert.ok((await timestamps(sid)).server > before.server,
      "removing a reached row must reach other devices");
  });

  test("a touch from session_destinations still bumps the timestamp", async () => {
    const sid = `${runPrefix}-s4`;
    await createSession(sid);
    const before = await timestamps(sid);
    await db.query(`UPDATE tracking_sessions SET server_updated_at = now() WHERE id = $1`, [sid]);
    assert.ok((await timestamps(sid)).server > before.server);
  });
});
