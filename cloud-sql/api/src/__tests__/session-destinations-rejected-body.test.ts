// src/__tests__/session-destinations-rejected-body.test.ts
//
// POST /api/sessions/:id/destinations gains `rejected: [destinationId]` — the
// wire form of "I didn't reach this". Rejecting must (a) record the veto so no
// matcher re-adds the pair, (b) delete the live session_destinations row
// whatever its source, and (c) bump server_updated_at so the change reaches
// other devices through the sync feed. Re-adding the destination as a manual
// `reached` clears the veto.
//
// An id sent in BOTH `reached` and `rejected` is a client bug, not a precedence
// question: the request is rejected with 400 rather than silently picking a
// winner. That guard is pure request validation, so it runs before any database
// work and is asserted without the rejections table.
//
// Integration tests gated on $DATABASE_URL, fixtures prefixed + placed in empty
// South Atlantic water.

import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import request from "supertest";
import { app } from "../index";
import db from "../db";
import { processSession } from "../processing";
import { overlappingDestinationIds } from "../routes/sessions";

const skipReason = process.env.DATABASE_URL
  ? null
  : "DATABASE_URL not set — skipping integration tests";

const runPrefix = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const user = `${runPrefix}-user`;

// Empty South Atlantic. A summit's match radius is 30 m, so a destination
// placed at exactly these coordinates matches the fixture track and nothing
// else — no production session can be touched.
const LAT = -50.0;
const LNG = -20.0;
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

async function rejectionCount(sessionId: string, destId: string): Promise<number> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM session_destination_rejections
     WHERE session_id = $1 AND destination_id = $2`,
    [sessionId, destId]
  );
  return res.rows[0].n;
}

async function serverUpdatedAt(sessionId: string): Promise<Date> {
  const res = await db.query(
    `SELECT server_updated_at FROM tracking_sessions WHERE id = $1`,
    [sessionId]
  );
  return res.rows[0].server_updated_at;
}

async function cleanup(): Promise<void> {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
  await db.query(`DELETE FROM session_attempt_groups WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
  await db.query(`DELETE FROM session_groups WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
  await db.query(`DELETE FROM destinations WHERE id LIKE $1`, [`${runPrefix}-%`]);
}

// The contradiction guard itself is pure, so its edges are pinned without a DB.
describe("overlappingDestinationIds", () => {
  test("finds the ids named in both lists, once each", () => {
    assert.deepEqual(overlappingDestinationIds(["a", "b", "a"], ["a", "c"]), ["a"]);
  });

  test("is empty when the lists are disjoint, missing, or not arrays", () => {
    assert.deepEqual(overlappingDestinationIds(["a"], ["b"]), []);
    assert.deepEqual(overlappingDestinationIds(undefined, ["b"]), []);
    assert.deepEqual(overlappingDestinationIds(["a"], undefined), []);
    assert.deepEqual(overlappingDestinationIds("a", "a"), []);
  });

  // iOS resends whatever its local list holds; junk entries must not become a
  // contradiction, and an empty-string id must never reach the SQL.
  test("ignores non-string and empty entries", () => {
    assert.deepEqual(overlappingDestinationIds(["", null, 7], ["", null, 7]), []);
  });
});

describe("POST /api/sessions/:id/destinations rejected list", { skip: skipReason ?? undefined }, () => {
  before(cleanup);
  after(cleanup);

  test("rejecting removes the auto row, records the veto, and bumps the sync feed", async () => {
    const sid = `${runPrefix}-s1`;
    const dest = `${runPrefix}-dest1`;
    await createSessionWithTrack(sid);
    await createSummit(dest);
    await processSession(sid, user, { force: true });
    assert.ok((await reachedIds(sid)).includes(dest), "precondition: auto-matched");
    const before = await serverUpdatedAt(sid);

    const res = await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ rejected: [dest] });

    assert.equal(res.status, 200);
    assert.ok(!(await reachedIds(sid)).includes(dest), "live row must be gone");
    assert.equal(await rejectionCount(sid, dest), 1);
    assert.ok(await serverUpdatedAt(sid) > before,
      "the delete must bump server_updated_at through trg_session_destinations_touch_session");
  });

  test("a rejected destination survives a forced re-process", async () => {
    const sid = `${runPrefix}-s2`;
    const dest = `${runPrefix}-dest2`;
    await createSessionWithTrack(sid);
    await createSummit(dest);
    await processSession(sid, user, { force: true });

    await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ rejected: [dest] })
      .expect(200);

    await processSession(sid, user, { force: true });
    assert.ok(!(await reachedIds(sid)).includes(dest),
      "re-processing must not overrule the user's veto");
  });

  test("re-adding the destination as a manual reached clears the rejection", async () => {
    const sid = `${runPrefix}-s3`;
    const dest = `${runPrefix}-dest3`;
    await createSessionWithTrack(sid);
    await createSummit(dest);
    await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ rejected: [dest] })
      .expect(200);
    assert.equal(await rejectionCount(sid, dest), 1);

    const res = await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ reached: [dest] });

    assert.equal(res.status, 200);
    assert.equal(await rejectionCount(sid, dest), 0, "manual re-add is the un-reject path");
    assert.ok((await reachedIds(sid)).includes(dest));
  });

  // Control: an unrejected destination must still auto-match and stay matched.
  // Without it, an over-broad delete or a rejection filter that swallows every
  // pair would pass the tests above just as happily as the correct code.
  test("a destination that was never rejected is untouched by a rejection request", async () => {
    const sid = `${runPrefix}-s6`;
    const kept = `${runPrefix}-dest6-kept`;
    const dropped = `${runPrefix}-dest6-dropped`;
    await createSessionWithTrack(sid);
    await createSummit(kept);
    await createSummit(dropped);
    await processSession(sid, user, { force: true });
    assert.ok((await reachedIds(sid)).includes(kept), "precondition: both auto-matched");
    assert.ok((await reachedIds(sid)).includes(dropped), "precondition: both auto-matched");

    await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ rejected: [dropped] })
      .expect(200);

    const after = await reachedIds(sid);
    assert.ok(after.includes(kept), "the unrejected summit must survive");
    assert.ok(!after.includes(dropped));
    assert.equal(await rejectionCount(sid, kept), 0, "no veto for a destination nobody rejected");
  });

  // The two request-shape guards below never reach the rejections table, so
  // they run green ahead of the migration.
  test("sending an id in both reached and rejected is a 400, and writes nothing", async () => {
    const sid = `${runPrefix}-s4`;
    const dest = `${runPrefix}-dest4`;
    await createSessionWithTrack(sid);
    await createSummit(dest);
    const before = await reachedIds(sid);

    const res = await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", user)
      .send({ reached: [dest], rejected: [dest] });

    assert.equal(res.status, 400, "same id in both lists is a client bug, not a precedence call");
    assert.match(res.body.error, /reached/);
    assert.match(res.body.error, /rejected/);
    assert.deepEqual(await reachedIds(sid), before, "a refused request must not half-apply");
  });

  test("a non-owner cannot reject", async () => {
    const sid = `${runPrefix}-s5`;
    const dest = `${runPrefix}-dest5`;
    await createSessionWithTrack(sid);
    await createSummit(dest);
    const before = await reachedIds(sid);

    const res = await request(app)
      .post(`/api/sessions/${sid}/destinations`)
      .set("X-Test-User", `${runPrefix}-intruder`)
      .send({ rejected: [dest] });

    assert.equal(res.status, 404);
    assert.equal(await rejectionCount(sid, dest), 0, "an intruder cannot veto someone else's ascent");
    assert.deepEqual(await reachedIds(sid), before, "and cannot delete their live rows either");
  });
});
