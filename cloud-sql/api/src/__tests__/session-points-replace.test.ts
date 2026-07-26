// src/__tests__/session-points-replace.test.ts
//
// PUT /api/sessions/:id/points has REPLACE semantics. POST /:id/points is
// insert-only (ON CONFLICT DO NOTHING), so a client edit that deletes or
// modifies points cannot propagate through it — the next GET resurrects the old
// track. Session auto-fix (DEM elevation reseed, gap fill, vehicle-tail trim)
// rewrites the point set in place and needs this endpoint.
//
// Integration tests against the real schema, gated on $TEST_DATABASE_URL. Fixtures
// use a unique prefix and a remote South-Atlantic / South-Pole location so the
// destination-insert and area-linking triggers cannot touch production rows.

import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import request from "supertest";
import { app } from "../index";
import db from "../db";
import { STALE_PROCESSING_MINUTES } from "../processing";

import { dbSkipReason as skipReason } from "./helpers/test-db";

const runPrefix = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const user = `${runPrefix}-user`;
const otherUser = `${runPrefix}-other`;
const manualDestId = `${runPrefix}-manualDest`;

// Empty South Atlantic — no real destination or tracking point within hundreds of km.
const LAT = -55.0;
const LNG = -25.0;
const BASE_TIME = 1_600_000_000; // unix seconds, well clear of the 1970 sentinel

async function createSession(id: string): Promise<void> {
  await db.query(
    `INSERT INTO tracking_sessions (id, user_id, start_time, ended, processing_state)
     VALUES ($1, $2, $3, true, 'completed')`,
    [id, user, "2026-06-07T17:00:00Z"]
  );
}

async function insertPoints(sessionId: string, times: number[]): Promise<void> {
  for (let i = 0; i < times.length; i++) {
    await db.query(
      `INSERT INTO tracking_points (session_id, time, segment_number, location, elevation)
       VALUES ($1, $2, 0,
               ST_SetSRID(ST_MakePoint($3, $4, $5), 4326)::geography, $5)
       ON CONFLICT (session_id, time) DO NOTHING`,
      [sessionId, times[i], LNG + i * 0.001, LAT, 100 + i]
    );
  }
}

function body(times: number[]) {
  return {
    points: times.map((t, i) => ({
      lat: LAT,
      lng: LNG + i * 0.001,
      elevation: 900 + i,
      time: t,
      segment_number: 0,
      speed: 1.2,
      azimuth: 90,
      hdop: 4,
    })),
  };
}

async function pointTimes(sessionId: string): Promise<number[]> {
  const res = await db.query(
    `SELECT time FROM tracking_points WHERE session_id = $1 ORDER BY time`,
    [sessionId]
  );
  return res.rows.map((r: { time: number }) => r.time);
}

async function sessionRow(sessionId: string) {
  const res = await db.query(
    `SELECT processing_state, processed_at,
            ST_NPoints(path::geometry) AS path_points
     FROM tracking_sessions WHERE id = $1`,
    [sessionId]
  );
  return res.rows[0];
}

async function createDestination(id: string, name: string): Promise<void> {
  await db.query(
    `INSERT INTO destinations (id, name, search_name, location, owner, features)
     VALUES ($1, $2, $3, ST_MakePoint(0, -89.9, 100)::geography, 'peaks', '{summit}')
     ON CONFLICT (id) DO NOTHING`,
    [id, name, name.toLowerCase()]
  );
}

async function cleanupTestData(): Promise<void> {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
  await db.query(`DELETE FROM session_attempt_groups WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
  await db.query(`DELETE FROM session_groups WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
  await db.query(`DELETE FROM destinations WHERE id LIKE $1`, [`${runPrefix}-%`]);
}

describe("PUT /api/sessions/:id/points replaces the point set", { skip: skipReason ?? undefined }, () => {
  before(async () => {
    await cleanupTestData();
    await createDestination(manualDestId, "Manual Summit Replace");
  });
  after(cleanupTestData);

  test("replaces every point — old times gone, new times present", async () => {
    const sid = `${runPrefix}-s1`;
    await createSession(sid);
    await insertPoints(sid, [BASE_TIME, BASE_TIME + 60, BASE_TIME + 120]);

    const res = await request(app)
      .put(`/api/sessions/${sid}/points`)
      .set("X-Test-User", user)
      .send(body([BASE_TIME + 900, BASE_TIME + 960]));

    assert.equal(res.status, 200);
    assert.equal(res.body.replaced, 2);
    assert.deepEqual(await pointTimes(sid), [BASE_TIME + 900, BASE_TIME + 960]);
  });

  test("re-materializes tracking_sessions.path and re-processes the session", async () => {
    const sid = `${runPrefix}-s2`;
    await createSession(sid);
    await insertPoints(sid, [BASE_TIME, BASE_TIME + 60, BASE_TIME + 120, BASE_TIME + 180]);
    const before = await sessionRow(sid);

    const res = await request(app)
      .put(`/api/sessions/${sid}/points`)
      .set("X-Test-User", user)
      .send(body([BASE_TIME + 900, BASE_TIME + 960]));

    assert.equal(res.status, 200);
    assert.equal(res.body.processing_state, "completed");

    const after = await sessionRow(sid);
    assert.equal(Number(after.path_points), 2, "path must be rebuilt from the NEW points");
    assert.ok(
      after.processed_at && (!before.processed_at || after.processed_at > before.processed_at),
      "processed_at must advance — the session was genuinely re-processed"
    );
  });

  test("rejects a non-owner with 404 and leaves the points untouched", async () => {
    const sid = `${runPrefix}-s3`;
    await createSession(sid);
    await insertPoints(sid, [BASE_TIME, BASE_TIME + 60]);

    // Two valid points, so a 404 can only come from the ownership check — a
    // one-point body would trip the up-front validation instead and the test
    // would pass without ever exercising the thing it names.
    const res = await request(app)
      .put(`/api/sessions/${sid}/points`)
      .set("X-Test-User", otherUser)
      .send(body([BASE_TIME + 900, BASE_TIME + 960]));

    assert.equal(res.status, 404);
    assert.equal(res.body.error, "Session not found");
    assert.deepEqual(await pointTimes(sid), [BASE_TIME, BASE_TIME + 60]);
  });

  test("rejects an empty points array with 400 and leaves the points untouched", async () => {
    const sid = `${runPrefix}-s4`;
    await createSession(sid);
    await insertPoints(sid, [BASE_TIME, BASE_TIME + 60]);

    const res = await request(app)
      .put(`/api/sessions/${sid}/points`)
      .set("X-Test-User", user)
      .send({ points: [] });

    assert.equal(res.status, 400);
    assert.deepEqual(await pointTimes(sid), [BASE_TIME, BASE_TIME + 60]);
  });

  // A replace deletes first. Anything the insert would silently drop — a point
  // missing a coordinate, a time repeated inside the body — would commit a track
  // the client never sent and still answer 200. These reject before BEGIN.
  test("rejects a point with a null coordinate with 400, points untouched", async () => {
    const sid = `${runPrefix}-s6`;
    await createSession(sid);
    await insertPoints(sid, [BASE_TIME, BASE_TIME + 60]);

    const payload = body([BASE_TIME + 900, BASE_TIME + 960, BASE_TIME + 1020]);
    payload.points[1].lat = null as unknown as number;

    const res = await request(app)
      .put(`/api/sessions/${sid}/points`)
      .set("X-Test-User", user)
      .send(payload);

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid_points");
    assert.equal(res.body.invalid, 1);
    assert.deepEqual(await pointTimes(sid), [BASE_TIME, BASE_TIME + 60]);
  });

  test("rejects a duplicated time within the body with 400, points untouched", async () => {
    const sid = `${runPrefix}-s7`;
    await createSession(sid);
    await insertPoints(sid, [BASE_TIME, BASE_TIME + 60]);

    const res = await request(app)
      .put(`/api/sessions/${sid}/points`)
      .set("X-Test-User", user)
      .send(body([BASE_TIME + 900, BASE_TIME + 960, BASE_TIME + 900]));

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid_points");
    assert.equal(res.body.duplicates, 1);
    assert.deepEqual(await pointTimes(sid), [BASE_TIME, BASE_TIME + 60]);
  });

  test("rejects a single-point body with 400 — ST_MakeLine needs two", async () => {
    const sid = `${runPrefix}-s8`;
    await createSession(sid);
    await insertPoints(sid, [BASE_TIME, BASE_TIME + 60]);

    const res = await request(app)
      .put(`/api/sessions/${sid}/points`)
      .set("X-Test-User", user)
      .send(body([BASE_TIME + 900]));

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "too_few_points");
    assert.deepEqual(await pointTimes(sid), [BASE_TIME, BASE_TIME + 60]);
  });

  test("rejects a replace while processing is in flight with 409, points untouched", async () => {
    const sid = `${runPrefix}-s9`;
    await createSession(sid);
    await insertPoints(sid, [BASE_TIME, BASE_TIME + 60]);
    await db.query(
      `UPDATE tracking_sessions
       SET processing_state = 'processing', processing_started_at = now()
       WHERE id = $1`,
      [sid]
    );

    const res = await request(app)
      .put(`/api/sessions/${sid}/points`)
      .set("X-Test-User", user)
      .send(body([BASE_TIME + 900, BASE_TIME + 960]));

    assert.equal(res.status, 409);
    assert.equal(res.body.error, "processing_in_flight");
    assert.deepEqual(await pointTimes(sid), [BASE_TIME, BASE_TIME + 60]);
  });

  test("a STALE processing claim does not block a replace", async () => {
    const sid = `${runPrefix}-s10`;
    await createSession(sid);
    await insertPoints(sid, [BASE_TIME, BASE_TIME + 60]);
    await db.query(
      `UPDATE tracking_sessions
       SET processing_state = 'processing',
           processing_started_at = now() - make_interval(mins => $2)
       WHERE id = $1`,
      [sid, STALE_PROCESSING_MINUTES + 5]
    );

    const res = await request(app)
      .put(`/api/sessions/${sid}/points`)
      .set("X-Test-User", user)
      .send(body([BASE_TIME + 900, BASE_TIME + 960]));

    assert.equal(res.status, 200);
    assert.equal(res.body.replaced, 2);
    assert.deepEqual(await pointTimes(sid), [BASE_TIME + 900, BASE_TIME + 960]);
  });

  test("manual session_destinations rows survive a replace + re-process", async () => {
    const sid = `${runPrefix}-s5`;
    await createSession(sid);
    await insertPoints(sid, [BASE_TIME, BASE_TIME + 60]);
    await db.query(
      `INSERT INTO session_destinations (session_id, destination_id, relation, source)
       VALUES ($1, $2, 'reached', 'manual')`,
      [sid, manualDestId]
    );

    const res = await request(app)
      .put(`/api/sessions/${sid}/points`)
      .set("X-Test-User", user)
      .send(body([BASE_TIME + 900, BASE_TIME + 960]));
    assert.equal(res.status, 200);

    const rows = await db.query(
      `SELECT destination_id, source FROM session_destinations WHERE session_id = $1`,
      [sid]
    );
    assert.deepEqual(rows.rows, [{ destination_id: manualDestId, source: "manual" }],
      "a user's manual ascent must never be collateral damage of a point rewrite");
  });
});
