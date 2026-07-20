// Integration tests for the comparison endpoints. Requires DATABASE_URL.
import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import request from "supertest";
import { app } from "../index";
import db from "../db";
import { matchComparisons } from "../comparisons";

const skipReason = process.env.DATABASE_URL
  ? null
  : "DATABASE_URL not set — skipping integration tests";

const runPrefix = `cmpapi-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const user = `${runPrefix}-user`;
const stranger = `${runPrefix}-stranger`;
const DEG_25M = 25 / 111320;

/** Insert a session + points walking a straight/out-and-back line, then
 *  materialize its path the same way processSession Step 0 does. */
async function insertTrack(
  id: string,
  startISO: string,
  coords: Array<{ lat: number; lng: number }>,
  stepMs = 30_000,
  userId = user
): Promise<void> {
  const startMs = new Date(startISO).getTime();
  await db.query(
    `INSERT INTO tracking_sessions (id, user_id, start_time, ended, distance)
     VALUES ($1, $2, $3, true, $4)`,
    [id, userId, startISO, coords.length * 25]
  );
  const values: string[] = [];
  const params: unknown[] = [];
  coords.forEach((c, i) => {
    const base = params.length;
    values.push(
      `($${base + 1}, $${base + 2}, ST_GeomFromText($${base + 3}, 4326)::geography, $${base + 4}, 1.0)`
    );
    params.push(id, startMs + i * stepMs, `POINT Z(${c.lng} ${c.lat} 1000)`, 1000);
  });
  await db.query(
    `INSERT INTO tracking_points (session_id, time, location, elevation, speed)
     VALUES ${values.join(", ")}`,
    params
  );
  await db.query(
    `UPDATE tracking_sessions s SET path = (
       SELECT ST_MakeLine(tp.location::geometry ORDER BY tp.time)::geography
       FROM tracking_points tp WHERE tp.session_id = s.id
     ) WHERE s.id = $1`,
    [id]
  );
}

function line(n: number): Array<{ lat: number; lng: number }> {
  return Array.from({ length: n }, (_, i) => ({ lat: 45, lng: i * DEG_25M / Math.cos(45 * Math.PI / 180) }));
}

function outAndBack(n: number): Array<{ lat: number; lng: number }> {
  const out = line(n);
  return [...out, ...out.slice(0, -1).reverse()];
}

async function cleanup(): Promise<void> {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
}

describe("comparison endpoints", { skip: skipReason ?? undefined }, () => {
  before(async () => {
    await cleanup();
    await insertTrack(`${runPrefix}-old`, "2026-05-01T08:00:00Z", outAndBack(120));
    await insertTrack(`${runPrefix}-new`, "2026-06-01T08:00:00Z", outAndBack(120));
    await matchComparisons(db, `${runPrefix}-new`, user);
  });
  after(cleanup);

  test("lists prior efforts with oriented stats and a PB flag", async () => {
    const res = await request(app)
      .get(`/api/sessions/${runPrefix}-new/comparisons`)
      .set("X-Test-User", user);
    assert.equal(res.status, 200);
    assert.equal(res.body.comparisons.length, 1);
    const c = res.body.comparisons[0];
    assert.equal(c.session.id, `${runPrefix}-old`);
    assert.equal(c.scope, "full");
    assert.equal(typeof c.this.elapsed_s, "number");
    assert.equal(typeof c.other.elapsed_s, "number");
    assert.equal(c.delta_s, c.this.elapsed_s - c.other.elapsed_s);
    assert.equal(c.is_pb, true);
  });

  test("prior-only: the earlier session sees no comparisons", async () => {
    const res = await request(app)
      .get(`/api/sessions/${runPrefix}-old/comparisons`)
      .set("X-Test-User", user);
    assert.equal(res.status, 200);
    assert.equal(res.body.comparisons.length, 0);
  });

  test("owner-only: another user gets 404 even if the session were public", async () => {
    await db.query(`UPDATE tracking_sessions SET is_public = true WHERE id = $1`,
      [`${runPrefix}-new`]);
    const res = await request(app)
      .get(`/api/sessions/${runPrefix}-new/comparisons`)
      .set("X-Test-User", stranger);
    assert.equal(res.status, 404);
  });

  test("curves endpoint returns oriented stations", async () => {
    const res = await request(app)
      .get(`/api/sessions/${runPrefix}-new/comparisons/${runPrefix}-old`)
      .set("X-Test-User", user);
    assert.equal(res.status, 200);
    assert.ok(res.body.curves.stations.length >= 5);
    const st = res.body.curves.stations;
    assert.equal(st[0].m, 0);
    assert.equal(typeof st[0].this_s, "number");
    assert.equal(typeof st[0].other_s, "number");
  });

  test("curves endpoint 404s for a non-pair", async () => {
    const res = await request(app)
      .get(`/api/sessions/${runPrefix}-new/comparisons/nonexistent`)
      .set("X-Test-User", user);
    assert.equal(res.status, 404);
  });
});
