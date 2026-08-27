// Regression tests for the disappearing partial-route bug. Backend processing
// owns `source = 'auto'` rows. A client session update may replace its manual
// route list, but must never erase those measured rows.

import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import request from "supertest";
import db from "../db";
import { app } from "../index";
import { dbSkipReason as skipReason } from "./helpers/test-db";

const prefix = `session-route-clobber-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const user = `${prefix}-user`;
const autoRoute = `${prefix}-auto`;
const manualRoute = `${prefix}-manual`;

async function cleanup(): Promise<void> {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id = $1`, [user]);
  await db.query(`DELETE FROM routes WHERE id = ANY($1)`, [[autoRoute, manualRoute]]);
}

async function createSession(id: string): Promise<void> {
  await db.query(
    `INSERT INTO tracking_sessions (id, user_id, start_time, ended, processing_state)
     VALUES ($1, $2, '2026-07-23T07:18:27Z', true, 'completed')`,
    [id, user]
  );
}

async function routeRows(sessionId: string): Promise<Array<{
  route_id: string;
  source: string;
  coverage: number | null;
  covered_intervals: Array<[number, number]> | null;
}>> {
  const result = await db.query(
    `SELECT route_id, source, coverage, covered_intervals
     FROM session_routes WHERE session_id = $1 ORDER BY route_id`,
    [sessionId]
  );
  return result.rows;
}

describe("client route lists do not clobber backend matches", { skip: skipReason ?? undefined }, () => {
  before(async () => {
    await cleanup();
    await db.query(
      `INSERT INTO routes (id, name, status)
       VALUES ($1, 'Measured Trail', 'active'), ($2, 'Manual Trail', 'active')`,
      [autoRoute, manualRoute]
    );
  });

  after(cleanup);

  test("an empty client route list preserves an auto partial match", async () => {
    const sessionId = `${prefix}-empty`;
    await createSession(sessionId);
    await db.query(
      `INSERT INTO session_routes
         (session_id, route_id, source, coverage, covered_intervals)
       VALUES ($1, $2, 'auto', 0.0002, '[[0.9439, 0.9441]]'::jsonb)`,
      [sessionId, autoRoute]
    );

    const response = await request(app)
      .put(`/api/sessions/${sessionId}`)
      .set("X-Test-User", user)
      .send({ routes: [] });

    assert.equal(response.status, 200);
    assert.deepEqual(await routeRows(sessionId), [{
      route_id: autoRoute,
      source: "auto",
      coverage: 0.0002,
      covered_intervals: [[0.9439, 0.9441]],
    }]);
  });

  test("manual reconciliation removes old manual rows and keeps auto rows", async () => {
    const sessionId = `${prefix}-manual`;
    await createSession(sessionId);
    await db.query(
      `INSERT INTO session_routes
         (session_id, route_id, source, coverage, covered_intervals)
       VALUES ($1, $2, 'auto', 0.0002, '[[0.9439, 0.9441]]'::jsonb),
              ($1, $3, 'manual', NULL, NULL)`,
      [sessionId, autoRoute, manualRoute]
    );

    const response = await request(app)
      .put(`/api/sessions/${sessionId}`)
      .set("X-Test-User", user)
      .send({ routes: [] });

    assert.equal(response.status, 200);
    assert.deepEqual(await routeRows(sessionId), [{
      route_id: autoRoute,
      source: "auto",
      coverage: 0.0002,
      covered_intervals: [[0.9439, 0.9441]],
    }]);
  });

  test("echoing an auto route id keeps its measured intervals", async () => {
    const sessionId = `${prefix}-echo`;
    await createSession(sessionId);
    await db.query(
      `INSERT INTO session_routes
         (session_id, route_id, source, coverage, covered_intervals)
       VALUES ($1, $2, 'auto', 0.0002, '[[0.9439, 0.9441]]'::jsonb)`,
      [sessionId, autoRoute]
    );

    const response = await request(app)
      .put(`/api/sessions/${sessionId}`)
      .set("X-Test-User", user)
      .send({ routes: [autoRoute] });

    assert.equal(response.status, 200);
    assert.deepEqual(await routeRows(sessionId), [{
      route_id: autoRoute,
      source: "auto",
      coverage: 0.0002,
      covered_intervals: [[0.9439, 0.9441]],
    }]);
  });
});
