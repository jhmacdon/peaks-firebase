// The write gate's floors, end to end through processSession against a live
// database. Fixtures use a fixed metres-per-degree of latitude so the intended
// lengths are readable in the test rather than derived from geodesy; that puts
// them about 0.1% off PostGIS's own measure, which is why the partial
// assertion below is a range rather than an exact fraction.
//
// Every fixture sits on the same meridian on purpose, so a session is a
// candidate for every route created before it. Each assertion reads one
// (session, route) pair, so the extra rows that produces are harmless.

import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import db from "../db";
import { processSession } from "../processing";
import { dbSkipReason as skipReason } from "./helpers/test-db";

const prefix = `route-gate-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const user = `${prefix}-user`;

// One degree of latitude is ~111_320 m; longitude is held constant so every
// fixture line runs due north and its length is exactly metres / 111_320.
const M_PER_DEG = 111_320;
const BASE_LAT = 47;
const BASE_LNG = -121.5;

function lineWkt(fromM: number, toM: number, steps: number): string {
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const m = fromM + ((toM - fromM) * i) / steps;
    points.push(`${BASE_LNG} ${BASE_LAT + m / M_PER_DEG} 1000`);
  }
  return `SRID=4326;LINESTRING Z (${points.join(", ")})`;
}

async function makeRoute(id: string, lengthM: number, steps: number): Promise<void> {
  await db.query(
    `INSERT INTO routes (id, name, status, path)
     VALUES ($1, $2, 'active', ST_GeogFromText($3))`,
    [id, id, lineWkt(0, lengthM, steps)]
  );
}

/** A session whose track runs from `fromM` to `toM` along the same line. */
async function makeSession(id: string, fromM: number, toM: number, steps: number): Promise<void> {
  await db.query(
    `INSERT INTO tracking_sessions (id, user_id, start_time, ended, processing_state)
     VALUES ($1, $2, '2026-05-02T15:00:00Z', true, 'pending')`,
    [id, user]
  );
  for (let i = 0; i <= steps; i++) {
    const m = fromM + ((toM - fromM) * i) / steps;
    await db.query(
      `INSERT INTO tracking_points (session_id, time, location, segment_number)
       VALUES ($1, $2, ST_GeogFromText($3), 0)`,
      [
        id,
        1_746_200_000 + i * 60,
        `SRID=4326;POINT Z (${BASE_LNG} ${BASE_LAT + m / M_PER_DEG} 1000)`,
      ]
    );
  }
}

async function storedRow(sessionId: string, routeId: string) {
  const result = await db.query(
    `SELECT coverage, covered_intervals FROM session_routes
     WHERE session_id = $1 AND route_id = $2`,
    [sessionId, routeId]
  );
  return result.rows[0] ?? null;
}

async function cleanup(): Promise<void> {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id = $1`, [user]);
  await db.query(`DELETE FROM routes WHERE id LIKE $1`, [`${prefix}-%`]);
}

describe("route write gate", { skip: skipReason ?? undefined }, () => {
  before(cleanup);
  after(cleanup);

  test("a short clip of a long route writes no row", async () => {
    const route = `${prefix}-long`;
    const session = `${prefix}-clip`;
    await makeRoute(route, 10_000, 100);          // 10 km, a vertex every 100 m
    await makeSession(session, 0, 200, 20);       // 200 m covered
    await processSession(session, user);
    assert.equal(await storedRow(session, route), null, "200 m must not earn a row");
  });

  test("a 500 m partial writes a row with the covered stretch", async () => {
    const route = `${prefix}-partial-route`;
    const session = `${prefix}-partial`;
    await makeRoute(route, 10_000, 100);
    await makeSession(session, 0, 1_500, 60);     // 1.5 km of a 10 km route
    await processSession(session, user);
    const row = await storedRow(session, route);
    assert.ok(row, "1.5 km of a 10 km route must earn a row");
    assert.ok(row.coverage < 0.7, `expected a partial coverage, got ${row.coverage}`);
    assert.equal(row.covered_intervals.length, 1);
    assert.equal(row.covered_intervals[0][0], 0);
    assert.ok(
      row.covered_intervals[0][1] > 0.12 && row.covered_intervals[0][1] < 0.18,
      `expected the first ~15% of the route, got ${JSON.stringify(row.covered_intervals)}`
    );
  });

  test("a completed short route writes a row despite the metre floor", async () => {
    const route = `${prefix}-short-route`;
    const session = `${prefix}-short`;
    await makeRoute(route, 400, 20);              // 400 m, under the 500 m floor
    await makeSession(session, 0, 400, 40);       // walked end to end
    await processSession(session, user);
    const row = await storedRow(session, route);
    assert.ok(row, "a completed 400 m route must earn a row via the coverage floor");
    assert.equal(row.coverage, 1);
    assert.deepEqual(row.covered_intervals, [[0, 1]]);
  });

  test("re-processing is idempotent", async () => {
    const session = `${prefix}-partial`;
    const route = `${prefix}-partial-route`;
    const first = await storedRow(session, route);
    assert.ok(first, "the partial test above must have run first");
    await processSession(session, user, { force: true });
    assert.deepEqual(await storedRow(session, route), first);
  });
});
