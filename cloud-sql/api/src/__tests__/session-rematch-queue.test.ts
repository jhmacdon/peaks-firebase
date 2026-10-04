// src/__tests__/session-rematch-queue.test.ts
//
// A catalog change (destination moved or retyped, route added or changed)
// queues the sessions near it, and the sweep re-runs processSession on them.
// The first half drives drainSessionRematchQueue with a fake pool; the second
// half proves the migration's triggers against the test database.

import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";
import db from "../db";
import {
  buildRematchQueueSql,
  drainSessionRematchQueue,
  processSession,
  REMATCH_ADVISORY_LOCK_KEY,
  SWEEP_ADVISORY_LOCK_KEY,
} from "../processing";
import { dbSkipReason as skipReason } from "./helpers/test-db";

type Row = { id: string; user_id: string; queued_at: Date };

function fakePool(lockOk: boolean, rows: Row[]) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: async (sql: string) => {
      calls.push({ sql });
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ ok: lockOk }] };
      return { rows: [] };
    },
    release: () => calls.push({ sql: "RELEASE" }),
  };
  const pool = {
    connect: async () => client,
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return sql.includes("FROM session_rematch_queue q") ? { rows } : { rows: [] };
    },
  } as unknown as import("pg").Pool;
  return { pool, calls };
}

test("buildRematchQueueSql: oldest first, with the owner", () => {
  const sql = buildRematchQueueSql();
  assert.match(sql, /FROM session_rematch_queue q/);
  assert.match(sql, /JOIN tracking_sessions s ON s\.id = q\.session_id/);
  assert.match(sql, /s\.user_id/);
  assert.match(sql, /ORDER BY q\.queued_at ASC/);
});

test("the drain has its own advisory lock", () => {
  assert.notEqual(REMATCH_ADVISORY_LOCK_KEY, SWEEP_ADVISORY_LOCK_KEY);
});

test("drain: no-op without the lock", async () => {
  const { pool, calls } = fakePool(false, [{ id: "a", user_id: "u", queued_at: new Date() }]);
  let processed = 0;
  const res = await drainSessionRematchQueue(pool, {
    processFn: (async () => { processed++; return {} as never; }) as never,
  });
  assert.deepEqual(res, { rematched: 0, locked: false });
  assert.equal(processed, 0);
  assert.ok(!calls.some((c) => c.sql.includes("pg_advisory_unlock")));
});

test("drain: forces a re-process and deletes only the row it read", async () => {
  const queuedAt = new Date("2026-10-04T12:00:00Z");
  const { pool, calls } = fakePool(true, [
    { id: "a", user_id: "u1", queued_at: queuedAt },
    { id: "b", user_id: "u2", queued_at: queuedAt },
  ]);
  const seen: Array<[string, string, boolean | undefined]> = [];
  const res = await drainSessionRematchQueue(pool, {
    processFn: (async (id: string, user: string, opts: { force?: boolean }) => {
      seen.push([id, user, opts.force]);
      return {} as never;
    }) as never,
  });
  assert.deepEqual(res, { rematched: 2, locked: true });
  assert.deepEqual(seen, [["a", "u1", true], ["b", "u2", true]]);
  const deletes = calls.filter((c) => c.sql.includes("DELETE FROM session_rematch_queue"));
  assert.equal(deletes.length, 2);
  assert.match(deletes[0].sql, /queued_at = \$2/, "a re-queue during the run must survive");
  assert.deepEqual(deletes[0].values, ["a", queuedAt]);
  assert.ok(calls.some((c) => c.sql.includes("pg_advisory_unlock")));
});

test("drain: starts no new re-match once its time budget is spent", async () => {
  const { pool } = fakePool(true, [
    { id: "a", user_id: "u", queued_at: new Date() },
    { id: "b", user_id: "u", queued_at: new Date() },
  ]);
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

test("drain: keeps a row a live run owns, drops one that failed", async () => {
  const { pool, calls } = fakePool(true, [
    { id: "busy", user_id: "u", queued_at: new Date() },
    { id: "broken", user_id: "u", queued_at: new Date() },
  ]);
  const res = await drainSessionRematchQueue(pool, {
    processFn: (async (id: string) => {
      throw new Error(id === "busy" ? "already_processing" : "boom");
    }) as never,
  });
  assert.equal(res.rematched, 0);
  const deleted = calls
    .filter((c) => c.sql.includes("DELETE FROM session_rematch_queue"))
    .map((c) => (c.values as unknown[])[0]);
  assert.deepEqual(deleted, ["broken"]);
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
