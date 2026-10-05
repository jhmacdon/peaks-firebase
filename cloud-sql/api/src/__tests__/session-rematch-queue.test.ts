// src/__tests__/session-rematch-queue.test.ts
//
// A catalog change (destination moved or retyped, route added or changed)
// queues the sessions near it, and the sweep re-runs processSession on them.
// The first half drives drainSessionRematchQueue with a fake pool; the second
// half proves the migration's triggers against the test database.

import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import db from "../db";
import { buildClaimRematchSql, drainSessionRematchQueue, processSession } from "../processing";
import { dbSkipReason as skipReason } from "./helpers/test-db";

// Fake pool: each claim hands out the next queued row. It has no connect(),
// so a drain that tried to hold a lock connection would throw.
function fakePool(queue: Array<{ id: string; user_id: string }>) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes("DELETE FROM session_rematch_queue")) {
        const next = queue.shift();
        return { rows: next ? [next] : [] };
      }
      return { rows: [] };
    },
  } as unknown as import("pg").Pool;
  return { pool, calls };
}

test("buildClaimRematchSql: claims the oldest row, skipping rows another drain holds", () => {
  const sql = buildClaimRematchSql();
  assert.match(sql, /DELETE FROM session_rematch_queue q/);
  assert.match(sql, /ORDER BY queued_at ASC/);
  assert.match(sql, /LIMIT 1/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /RETURNING q\.session_id AS id, s\.user_id/);
});

test("drain: forces a re-process of each claimed session, until the queue is empty", async () => {
  const { pool } = fakePool([{ id: "a", user_id: "u1" }, { id: "b", user_id: "u2" }]);
  const seen: Array<[string, string, boolean | undefined]> = [];
  const res = await drainSessionRematchQueue(pool, {
    processFn: (async (id: string, user: string, opts: { force?: boolean }) => {
      seen.push([id, user, opts.force]);
      return {} as never;
    }) as never,
  });
  assert.deepEqual(res, { rematched: 2 });
  assert.deepEqual(seen, [["a", "u1", true], ["b", "u2", true]]);
});

test("drain: stops at its limit", async () => {
  const { pool } = fakePool([{ id: "a", user_id: "u" }, { id: "b", user_id: "u" }]);
  const res = await drainSessionRematchQueue(pool, {
    limit: 1,
    processFn: (async () => ({}) as never) as never,
  });
  assert.equal(res.rematched, 1);
});

test("drain: starts no new re-match once its time budget is spent", async () => {
  const { pool } = fakePool([{ id: "a", user_id: "u" }, { id: "b", user_id: "u" }]);
  let clock = 0;
  const seen: string[] = [];
  const res = await drainSessionRematchQueue(pool, {
    budgetMs: 1000,
    now: () => clock,
    processFn: (async (id: string) => { seen.push(id); clock += 1500; return {} as never; }) as never,
  });
  assert.deepEqual(seen, ["a"]);
  assert.equal(res.rematched, 1);
});

test("drain: re-queues a session a live run owns; lets a failed one go to the stuck sweep", async () => {
  const { pool, calls } = fakePool([
    { id: "busy", user_id: "u" },
    { id: "broken", user_id: "u" },
  ]);
  const res = await drainSessionRematchQueue(pool, {
    processFn: (async (id: string) => {
      throw new Error(id === "busy" ? "already_processing" : "boom");
    }) as never,
  });
  assert.equal(res.rematched, 0);
  const requeued = calls
    .filter((c) => c.sql.includes("INSERT INTO session_rematch_queue"))
    .map((c) => (c.values as unknown[])[0]);
  assert.deepEqual(requeued, ["busy"]);
});

// ---------------------------------------------------------------------------
// Triggers, against the test database.

const runPrefix = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const user = `${runPrefix}-user`;
const otherUser = `${runPrefix}-other`;

// Empty South Atlantic, away from the rejection suite's fixtures.
const LAT = -53.0;
const LNG = -23.0;
const BASE_TIME = 1_600_000_000;
// ~150 m east of the track: inside a viewpoint's 200 m, outside a summit's 30 m.
const NEAR_LNG = LNG + 150 / (111_320 * Math.cos((LAT * Math.PI) / 180));
const FAR_LNG = LNG + 0.05;

async function createSession(id: string, owner = user): Promise<void> {
  await db.query(
    `INSERT INTO tracking_sessions (id, user_id, start_time, ended, processing_state)
     VALUES ($1, $2, $3, true, 'pending')`,
    [id, owner, "2026-06-07T17:00:00Z"]
  );
  for (let i = 0; i < 3; i++) {
    await db.query(
      `INSERT INTO tracking_points (session_id, time, segment_number, location, elevation)
       VALUES ($1, $2, 0, ST_SetSRID(ST_MakePoint($3, $4, 100), 4326)::geography, 100)`,
      [id, BASE_TIME + i * 60, LNG, LAT + i * 0.00005]
    );
  }
  await processSession(id, owner, { force: true });
}

async function createDestination(
  id: string,
  lng: number,
  features: string,
  owner = "peaks"
): Promise<void> {
  await db.query(
    `INSERT INTO destinations (id, name, search_name, location, owner, features)
     VALUES ($1, $1, $1, ST_SetSRID(ST_MakePoint($2, $3, 100), 4326)::geography, $4, $5::destination_feature[])`,
    [id, lng, LAT, owner, features]
  );
}

async function queued(sessionId: string): Promise<boolean> {
  const res = await db.query(`SELECT 1 FROM session_rematch_queue WHERE session_id = $1`, [sessionId]);
  return res.rows.length > 0;
}

async function clearQueue(): Promise<void> {
  await db.query(`DELETE FROM session_rematch_queue WHERE session_id LIKE $1`, [`${runPrefix}-%`]);
}

async function reached(sessionId: string): Promise<string[]> {
  const res = await db.query(
    `SELECT destination_id FROM session_destinations
     WHERE session_id = $1 AND relation = 'reached' ORDER BY destination_id`,
    [sessionId]
  );
  return res.rows.map((r: { destination_id: string }) => r.destination_id);
}

async function drainOurs(): Promise<void> {
  // Process only this run's rows, so a shared test database's other suites
  // are left alone.
  const rows = await db.query(
    `SELECT q.session_id, s.user_id FROM session_rematch_queue q
     JOIN tracking_sessions s ON s.id = q.session_id WHERE q.session_id LIKE $1`,
    [`${runPrefix}-%`]
  );
  for (const row of rows.rows) {
    await processSession(row.session_id, row.user_id, { force: true });
  }
  await clearQueue();
}

async function cleanup(): Promise<void> {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
  await db.query(`DELETE FROM session_attempt_groups WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
  await db.query(`DELETE FROM session_groups WHERE user_id LIKE $1`, [`${runPrefix}-%`]);
  await db.query(`DELETE FROM routes WHERE id LIKE $1`, [`${runPrefix}-%`]);
  await db.query(`DELETE FROM destinations WHERE id LIKE $1`, [`${runPrefix}-%`]);
}

// One test at a time: the fixtures share a spot and the queue.
describe("catalog changes re-match nearby sessions", { skip: skipReason ?? undefined, concurrency: 1 }, () => {
  before(cleanup);
  after(cleanup);

  test("a new viewpoint is reached at once, at its own 200 m radius", async () => {
    const sid = `${runPrefix}-s-viewpoint`;
    const view = `${runPrefix}-viewpoint`;
    await createSession(sid);
    await createDestination(view, NEAR_LNG, "{viewpoint}");
    assert.ok((await reached(sid)).includes(view));
  });

  test("a user's own new place never tags someone else's session", async () => {
    const mine = `${runPrefix}-s-mine`;
    const theirs = `${runPrefix}-s-theirs`;
    const place = `${runPrefix}-private`;
    await createSession(mine, otherUser);
    await createSession(theirs);
    await createDestination(place, LNG, "{viewpoint}", otherUser);
    assert.ok((await reached(mine)).includes(place));
    assert.ok(!(await reached(theirs)).includes(place));
  });

  test("retyping a place re-matches at the new radius, both ways", async () => {
    const sid = `${runPrefix}-s-retype`;
    const spot = `${runPrefix}-retype`;
    await createSession(sid);
    await createDestination(spot, NEAR_LNG, "{summit}");
    assert.ok(!(await reached(sid)).includes(spot), "150 m is outside a summit's 30 m");
    await clearQueue();

    await db.query(`UPDATE destinations SET features = '{viewpoint}' WHERE id = $1`, [spot]);
    assert.ok(await queued(sid));
    await drainOurs();
    assert.ok((await reached(sid)).includes(spot), "and inside a viewpoint's 200 m");

    await db.query(`UPDATE destinations SET features = '{summit}' WHERE id = $1`, [spot]);
    await drainOurs();
    assert.ok(!(await reached(sid)).includes(spot), "a stale auto reach is removed");
  });

  test("moving a place re-matches the sessions at both ends", async () => {
    const sid = `${runPrefix}-s-move`;
    const spot = `${runPrefix}-move`;
    await createSession(sid);
    await createDestination(spot, FAR_LNG, "{viewpoint}");
    assert.ok(!(await reached(sid)).includes(spot));
    await clearQueue();

    await db.query(
      `UPDATE destinations SET location = ST_SetSRID(ST_MakePoint($2, $3, 100), 4326)::geography WHERE id = $1`,
      [spot, LNG, LAT]
    );
    assert.ok(await queued(sid));
    await drainOurs();
    assert.ok((await reached(sid)).includes(spot));

    await db.query(
      `UPDATE destinations SET location = ST_SetSRID(ST_MakePoint($2, $3, 100), 4326)::geography WHERE id = $1`,
      [spot, FAR_LNG, LAT]
    );
    assert.ok(await queued(sid), "the old position's sessions are queued too");
    await drainOurs();
    assert.ok(!(await reached(sid)).includes(spot));
  });

  test("an elevation-only edit queues nothing", async () => {
    const sid = `${runPrefix}-s-z`;
    const spot = `${runPrefix}-z`;
    await createSession(sid);
    await createDestination(spot, LNG, "{viewpoint}");
    await clearQueue();
    await db.query(
      `UPDATE destinations SET elevation = 101,
         location = ST_SetSRID(ST_MakePoint($2, $3, 101), 4326)::geography WHERE id = $1`,
      [spot, LNG, LAT]
    );
    assert.ok(!(await queued(sid)));
  });

  test("a rejection survives a re-match triggered by an edit", async () => {
    const sid = `${runPrefix}-s-reject`;
    const spot = `${runPrefix}-reject`;
    await createSession(sid);
    await createDestination(spot, LNG, "{viewpoint}");
    await db.query(`DELETE FROM session_destinations WHERE session_id = $1 AND destination_id = $2`, [sid, spot]);
    await db.query(
      `INSERT INTO session_destination_rejections (session_id, destination_id) VALUES ($1, $2)`,
      [sid, spot]
    );
    await db.query(`UPDATE destinations SET features = '{waterfall}' WHERE id = $1`, [spot]);
    await drainOurs();
    assert.ok(!(await reached(sid)).includes(spot));
  });

  test("the drain completes through a two-connection pool, like production's", async () => {
    // processSession takes one connection for its transaction and one for its
    // post-commit steps. A drain that also held a lock connection starved it.
    const sid = `${runPrefix}-s-pool`;
    const spot = `${runPrefix}-pool`;
    await createSession(sid);
    await createDestination(spot, FAR_LNG, "{viewpoint}");
    await db.query(`DELETE FROM session_rematch_queue`);
    await db.query(
      `UPDATE destinations SET location = ST_SetSRID(ST_MakePoint($2, $3, 100), 4326)::geography WHERE id = $1`,
      [spot, LNG, LAT]
    );
    assert.ok(await queued(sid));

    const { Pool } = await import("pg");
    const twoConnections = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 5_000,
    });
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      await drainSessionRematchQueue(twoConnections);
    } finally {
      console.error = originalError;
      await twoConnections.end();
    }

    assert.ok(!(await queued(sid)), "the claimed row leaves the queue");
    assert.ok((await reached(sid)).includes(spot));
    assert.deepEqual(errors, [], "no step may time out waiting for a connection");
  });

  test("an active route queues the sessions along it; a pending one does not", async () => {
    const sid = `${runPrefix}-s-route`;
    await createSession(sid);
    await clearQueue();
    const line = `ST_SetSRID(ST_MakeLine(ST_MakePoint(${LNG}, ${LAT}, 100), ST_MakePoint(${LNG}, ${LAT + 0.001}, 100)), 4326)::geography`;

    await db.query(
      `INSERT INTO routes (id, name, owner, status, path) VALUES ($1, $1, $2, 'pending', ${line})`,
      [`${runPrefix}-route`, user]
    );
    assert.ok(!(await queued(sid)), "a pending route cannot be matched");

    await db.query(`UPDATE routes SET status = 'active' WHERE id = $1`, [`${runPrefix}-route`]);
    assert.ok(await queued(sid), "activation queues the sessions along it");
  });
});
