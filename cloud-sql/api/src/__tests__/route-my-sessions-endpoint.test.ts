import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import request from "supertest";
import db from "../db";
import { app } from "../index";
import { dbSkipReason as skipReason } from "./helpers/test-db";

const prefix = `route-mine-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const owner = `${prefix}-owner`;
const other = `${prefix}-other`;
const route = `${prefix}-route`;
const otherRoute = `${prefix}-other-route`;
const older = `${prefix}-older`;
const newer = `${prefix}-newer`;
const theirs = `${prefix}-theirs`;
const elsewhere = `${prefix}-elsewhere`;

async function cleanup(): Promise<void> {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id = ANY($1)`, [[owner, other]]);
  await db.query(`DELETE FROM routes WHERE id = ANY($1)`, [[route, otherRoute]]);
}

describe("GET /api/routes/:id/sessions/mine", { skip: skipReason ?? undefined }, () => {
  before(async () => {
    await cleanup();
    await db.query(
      `INSERT INTO routes (id, name, status) VALUES ($1, 'Hoh River Trail', 'active'),
                                                    ($2, 'Elsewhere', 'active')`,
      [route, otherRoute]
    );
    await db.query(
      `INSERT INTO tracking_sessions (id, user_id, start_time, ended, processing_state)
       VALUES ($1, $2, '2026-05-02T15:00:00Z', true, 'completed'),
              ($3, $2, '2026-07-11T13:00:00Z', true, 'completed'),
              ($4, $5, '2026-06-01T13:00:00Z', true, 'completed'),
              ($6, $2, '2026-06-20T13:00:00Z', true, 'completed')`,
      [older, owner, newer, theirs, other, elsewhere]
    );
    await db.query(
      `INSERT INTO session_routes (session_id, route_id, source, coverage, covered_intervals)
       VALUES ($1, $3, 'auto', 0.15, '[[0, 0.15]]'::jsonb),
              ($2, $3, 'auto', 0.94, '[[0, 0.94]]'::jsonb),
              ($4, $3, 'auto', 0.88, '[[0, 0.88]]'::jsonb),
              ($5, $6, 'auto', 0.91, '[[0, 0.91]]'::jsonb)`,
      [older, newer, route, theirs, elsewhere, otherRoute]
    );
  });

  after(cleanup);

  test("unauthenticated requests are rejected", async () => {
    const response = await request(app).get(`/api/routes/${route}/sessions/mine`);
    assert.equal(response.status, 401);
  });

  test("returns only the caller's sessions on this route, newest first", async () => {
    const response = await request(app)
      .get(`/api/routes/${route}/sessions/mine`)
      .set("X-Test-User", owner);
    assert.equal(response.status, 200);
    assert.deepEqual(
      response.body.map((row: { sessionId: string }) => row.sessionId),
      [newer, older]
    );
  });

  test("a partial row keeps its coverage and its covered stretch", async () => {
    const response = await request(app)
      .get(`/api/routes/${route}/sessions/mine`)
      .set("X-Test-User", owner);
    const partial = response.body.find((row: { sessionId: string }) => row.sessionId === older);
    assert.equal(partial.coverage, 0.15);
    assert.deepEqual(partial.coveredIntervals, [[0, 0.15]]);
    // Epoch seconds for 2026-05-02T15:00:00Z, as a number not a string.
    assert.equal(typeof partial.startDate, "number");
    assert.equal(partial.startDate, Date.parse("2026-05-02T15:00:00Z") / 1000);
  });

  test("another user on the same route sees only their own row", async () => {
    // `theirs` is the other user's session on the SAME route, so this proves
    // the scoping in both directions at once: they get their row, not the
    // owner's two, and the owner's list above never held theirs.
    const response = await request(app)
      .get(`/api/routes/${route}/sessions/mine`)
      .set("X-Test-User", other);
    assert.equal(response.status, 200);
    assert.deepEqual(
      response.body.map((row: { sessionId: string }) => row.sessionId),
      [theirs]
    );
  });

  test("a route the caller has never done returns an empty list", async () => {
    const response = await request(app)
      .get(`/api/routes/${prefix}-nonexistent/sessions/mine`)
      .set("X-Test-User", owner);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, []);
  });
});
