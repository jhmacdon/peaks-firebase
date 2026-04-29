// src/__tests__/session-groups.test.ts
//
// Integration tests against the real `session_groups` and `tracking_sessions`
// tables. Requires $DATABASE_URL to point at a development Postgres with the
// schema applied. Skips cleanly if not configured.
//
// When DATABASE_URL IS set, run with:
//   DATABASE_URL=postgres://... npm test
//
// The db module uses individual env vars (DB_HOST, DB_NAME, DB_USER, DB_PASS)
// by default, but DATABASE_URL is used here as the gate because it's the
// conventional "I have a test DB" signal. If your test DB uses the individual
// vars, set DATABASE_URL to any non-empty string to un-skip the suite.

import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import request from "supertest";
import { app } from "../index";
import db from "../db";

const skipReason = process.env.DATABASE_URL
  ? null
  : "DATABASE_URL not set — skipping integration tests";

const runPrefix = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const userA = `${runPrefix}-userA`;
const userB = `${runPrefix}-userB`;

async function createSession(id: string, userId: string, startISO: string): Promise<void> {
  await db.query(
    `INSERT INTO tracking_sessions (id, user_id, start_time)
     VALUES ($1, $2, $3)`,
    [id, userId, startISO]
  );
}

async function cleanupTestData(): Promise<void> {
  // Delete in dependency order: tracking_sessions first (they reference
  // session_groups via group_id FK), then session_groups. The LIKE pattern
  // targets only rows created by this test run, never touching real data.
  await db.query(
    `DELETE FROM tracking_sessions WHERE user_id LIKE $1`,
    [`${runPrefix}-%`]
  );
  await db.query(
    `DELETE FROM session_groups WHERE user_id LIKE $1`,
    [`${runPrefix}-%`]
  );
}

describe("session group endpoints", { skip: skipReason ?? undefined }, () => {

  before(cleanupTestData);
  after(cleanupTestData);

  test("POST /groups creates a group from two owned sessions", async () => {
    const s1 = `${runPrefix}-s1a`;
    const s2 = `${runPrefix}-s2a`;
    await createSession(s1, userA, "2026-04-01T00:00:00Z");
    await createSession(s2, userA, "2026-04-02T00:00:00Z");

    const res = await request(app)
      .post("/api/sessions/groups")
      .set("X-Test-User", userA)
      .send({ session_ids: [s1, s2], manually_linked: true });

    assert.equal(res.status, 200);
    assert.equal(typeof res.body.id, "string");
    assert.equal(res.body.id.length > 0, true);
    assert.equal(res.body.manually_linked, true);
    assert.deepEqual(res.body.member_ids, [s1, s2]);

    const rows = await db.query(
      `SELECT id, group_id FROM tracking_sessions WHERE id = ANY($1) ORDER BY id`,
      [[s1, s2]]
    );
    assert.equal(rows.rows.length, 2);
    assert.equal(rows.rows[0].group_id, res.body.id);
    assert.equal(rows.rows[1].group_id, res.body.id);
  });

  test("POST /groups rejects sessions from different users", async () => {
    const s1 = `${runPrefix}-s1b`;
    const s2 = `${runPrefix}-s2b`;
    await createSession(s1, userA, "2026-04-01T00:00:00Z");
    await createSession(s2, userB, "2026-04-02T00:00:00Z");

    const res = await request(app)
      .post("/api/sessions/groups")
      .set("X-Test-User", userA)
      .send({ session_ids: [s1, s2] });

    assert.equal(res.status, 403);
    // Route returns "One or more sessions not owned or not found"
    assert.match(res.body.error, /not owned or not found/i);

    const rows = await db.query(
      `SELECT group_id FROM tracking_sessions WHERE id = ANY($1)`,
      [[s1, s2]]
    );
    for (const r of rows.rows) {
      assert.equal(r.group_id, null);
    }
  });

  test("DELETE /:id/group sets link_opt_out and dissolves empty group", async () => {
    const s1 = `${runPrefix}-s1c`;
    const s2 = `${runPrefix}-s2c`;
    await createSession(s1, userA, "2026-04-01T00:00:00Z");
    await createSession(s2, userA, "2026-04-02T00:00:00Z");

    const create = await request(app)
      .post("/api/sessions/groups")
      .set("X-Test-User", userA)
      .send({ session_ids: [s1, s2] });
    assert.equal(create.status, 200);
    const groupId = create.body.id as string;

    // Both members leave → group should dissolve
    const del1 = await request(app)
      .delete(`/api/sessions/${s1}/group`)
      .set("X-Test-User", userA);
    assert.equal(del1.status, 200);

    const del2 = await request(app)
      .delete(`/api/sessions/${s2}/group`)
      .set("X-Test-User", userA);
    assert.equal(del2.status, 200);

    const flags = await db.query(
      `SELECT id, link_opt_out FROM tracking_sessions WHERE id = ANY($1) ORDER BY id`,
      [[s1, s2]]
    );
    assert.equal(flags.rows.length, 2);
    for (const r of flags.rows) {
      assert.equal(r.link_opt_out, true);
    }

    const remaining = await db.query(
      `SELECT id FROM session_groups WHERE id = $1`,
      [groupId]
    );
    assert.equal(remaining.rows.length, 0, "group row should be deleted after all members leave");
  });

  test("POST /groups/:id/merge keeps survivor with older created_at", async () => {
    const s1 = `${runPrefix}-s1d`;
    const s2 = `${runPrefix}-s2d`;
    const s3 = `${runPrefix}-s3d`;
    const s4 = `${runPrefix}-s4d`;
    await createSession(s1, userA, "2026-04-01T00:00:00Z");
    await createSession(s2, userA, "2026-04-02T00:00:00Z");
    await createSession(s3, userA, "2026-04-05T00:00:00Z");
    await createSession(s4, userA, "2026-04-06T00:00:00Z");

    // Create group A first (will have older created_at → will be the survivor)
    const g1Res = await request(app)
      .post("/api/sessions/groups")
      .set("X-Test-User", userA)
      .send({ session_ids: [s1, s2] });
    assert.equal(g1Res.status, 200);
    const groupAId = g1Res.body.id as string;

    // Wait 50ms so group B is strictly newer
    await new Promise((r) => setTimeout(r, 50));

    // Create group B with manually_linked: true (this bit should OR-merge to survivor)
    const g2Res = await request(app)
      .post("/api/sessions/groups")
      .set("X-Test-User", userA)
      .send({ session_ids: [s3, s4], manually_linked: true });
    assert.equal(g2Res.status, 200);
    const groupBId = g2Res.body.id as string;

    // Merge: group A absorbs group B (A is older → survivor)
    const merge = await request(app)
      .post(`/api/sessions/groups/${groupAId}/merge`)
      .set("X-Test-User", userA)
      .send({ other_group_id: groupBId });

    assert.equal(merge.status, 200);
    assert.equal(merge.body.survivor_id, groupAId, "older group should survive");
    assert.equal(merge.body.manually_linked, true, "manually_linked should be OR-merged from loser");

    // All four members must now point to the survivor
    const members = await db.query(
      `SELECT id, group_id FROM tracking_sessions WHERE id = ANY($1) ORDER BY id`,
      [[s1, s2, s3, s4]]
    );
    assert.equal(members.rows.length, 4);
    for (const r of members.rows) {
      assert.equal(r.group_id, groupAId, `session ${r.id} should have group_id = ${groupAId}`);
    }

    // Loser group row must be gone
    const loser = await db.query(
      `SELECT id FROM session_groups WHERE id = $1`,
      [groupBId]
    );
    assert.equal(loser.rows.length, 0, "loser group row should be deleted after merge");
  });

});
