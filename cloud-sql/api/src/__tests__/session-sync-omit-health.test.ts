// `?omit=health_data` leaves heart-rate and calorie series out of the session
// list and sync feed. They were 14 MB of a 14.7 MB sync page (2026-10-09), and
// the app stalled about 47 s parsing and saving them while search waited. Only
// session detail shows them, and GET /api/sessions/:id still returns them.
// Clients that do not ask keep getting them.
//
// Integration tests gated on $TEST_DATABASE_URL.

import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import request from "supertest";
import { app } from "../index";
import db from "../db";
import { omitsHealthData } from "../routes/sessions";

import { dbSkipReason as skipReason } from "./helpers/test-db";

describe("omitsHealthData", () => {
  test("reads a single value, a comma list, or a repeated parameter", () => {
    assert.equal(omitsHealthData("health_data"), true);
    assert.equal(omitsHealthData("areas, health_data"), true);
    assert.equal(omitsHealthData(["areas", "health_data"]), true);
  });

  test("is false when absent or naming something else", () => {
    assert.equal(omitsHealthData(undefined), false);
    assert.equal(omitsHealthData(""), false);
    assert.equal(omitsHealthData("health"), false);
    assert.equal(omitsHealthData({ health_data: true }), false);
  });
});

const runPrefix = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const user = `${runPrefix}-user`;
const sid = `${runPrefix}-s1`;
const health = { heartRates: [{ date: "2026-06-07T17:00:00Z", heartRate: 120 }], calories: [] };

async function cleanup(): Promise<void> {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
}

describe("session lists honour omit=health_data", { skip: skipReason ?? undefined }, () => {
  before(async () => {
    await cleanup();
    await db.query(
      `INSERT INTO tracking_sessions (id, user_id, name, start_time, ended, processing_state, health_data)
       VALUES ($1, $2, 'Morning hike', '2026-06-07T17:00:00Z', true, 'completed', $3::jsonb)`,
      [sid, user, JSON.stringify(health)]
    );
  });
  after(cleanup);

  test("the sync feed keeps health data by default and drops the key when asked", async () => {
    const full = await request(app).get("/api/sessions/changes").set("X-Test-User", user);
    assert.equal(full.status, 200);
    assert.deepEqual(full.body.changes[0].session.health_data, health);

    const lean = await request(app).get("/api/sessions/changes?omit=health_data").set("X-Test-User", user);
    assert.equal(lean.status, 200);
    assert.equal(lean.body.changes[0].session.name, "Morning hike");
    assert.ok(!("health_data" in lean.body.changes[0].session), "key must be absent, not null");
  });

  test("the session list keeps health data by default and drops the key when asked", async () => {
    const full = await request(app).get("/api/sessions").set("X-Test-User", user);
    assert.deepEqual(full.body[0].health_data, health);

    const lean = await request(app).get("/api/sessions?omit=health_data").set("X-Test-User", user);
    assert.equal(lean.status, 200);
    assert.ok(!("health_data" in lean.body[0]));
  });

  test("session detail still returns health data", async () => {
    const detail = await request(app).get(`/api/sessions/${sid}`).set("X-Test-User", user);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.health_data, health);
  });
});
