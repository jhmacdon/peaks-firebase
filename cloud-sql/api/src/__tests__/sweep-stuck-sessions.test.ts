import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildStuckSessionsSql,
  MAX_SWEEP_ATTEMPTS,
  sweepStuckSessions,
  SWEEP_ADVISORY_LOCK_KEY,
} from "../processing";

test("buildStuckSessionsSql: all users, ended+has-points, stuck states, oldest first", () => {
  const sql = buildStuckSessionsSql();
  assert.match(sql, /FROM tracking_sessions s/);
  assert.match(sql, /s\.ended = true/);
  assert.match(sql, /processing_state IN \('pending', 'failed'\)/);
  assert.match(sql, /processing_state = 'processing'/);
  assert.match(sql, /EXISTS \(SELECT 1 FROM tracking_points/);
  assert.match(sql, /ORDER BY s\.server_updated_at ASC/);
  assert.doesNotMatch(sql, /user_id = \$/); // all users, not scoped
});

test("buildStuckSessionsSql skips sessions that used up their sweep attempts", () => {
  assert.equal(MAX_SWEEP_ATTEMPTS, 5);
  assert.match(buildStuckSessionsSql(), /s\.processing_attempts < 5/);
});

// Fake pool and lock client: the lock connection's pg_try_advisory_lock result
// is scripted, and pool.query returns candidate rows. pool.connect() throws:
// the sweep must never take a processing-pool connection for its lock.
function fakePool(lockOk: boolean, rows: Array<{ id: string; user_id: string }>) {
  const calls: string[] = [];
  const lockClient = {
    query: async (sql: string) => {
      calls.push(sql);
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ ok: lockOk }] };
      return { rows: [] }; // pg_advisory_unlock
    },
    close: async () => { calls.push("CLOSE"); },
  };
  const pool = {
    connect: async () => { throw new Error("sweep took a processing-pool connection"); },
    query: async () => ({ rows }),
  } as unknown as import("pg").Pool;
  return { pool, calls, connectLock: async () => lockClient };
}

test("sweepStuckSessions: no-op when advisory lock not acquired", async () => {
  const { pool, calls, connectLock } = fakePool(false, [{ id: "a", user_id: "u" }]);
  let processed = 0;
  const res = await sweepStuckSessions(pool, {
    connectLock,
    processFn: (async () => { processed++; return {} as never; }) as never,
  });
  assert.equal(res.locked, false);
  assert.equal(res.swept, 0);
  assert.equal(processed, 0, "must not process when lock not held");
  assert.ok(calls.includes("CLOSE"));
  // Must NOT unlock a lock it never acquired (guards the `if (locked)` branch).
  assert.ok(!calls.some((c) => c.includes("pg_advisory_unlock")), "no unlock when lock not held");
});

test("sweepStuckSessions: when locked, processes serially, honors limit, unlocks", async () => {
  const rows = [{ id: "a", user_id: "u" }, { id: "b", user_id: "u" }];
  const { pool, calls, connectLock } = fakePool(true, rows);
  const order: string[] = [];
  const res = await sweepStuckSessions(pool, {
    connectLock,
    limit: 5,
    processFn: (async (id: string) => { order.push(id); return { skipped: false } as never; }) as never,
  });
  assert.equal(res.locked, true);
  assert.equal(res.swept, 2);
  assert.deepEqual(order, ["a", "b"]);
  assert.ok(calls.some((c) => c.includes("pg_advisory_unlock")));
  assert.ok(calls.includes("CLOSE"));
  assert.equal(SWEEP_ADVISORY_LOCK_KEY > 0, true);
});

// Production, 2026-10-08: with the lock on one of the processing pool's two
// connections, a timed-out processSession could not record its failure, and
// the sweep re-ran the same sessions forever. processSession gets the whole pool.
test("sweepStuckSessions leaves both processing-pool connections to processSession", async () => {
  const { pool, connectLock } = fakePool(true, [{ id: "a", user_id: "u" }]);
  let seenPool: unknown;
  await sweepStuckSessions(pool, {
    connectLock,
    processFn: (async (_id: string, _user: string, opts: { pool: unknown }) => {
      seenPool = opts.pool;
      return { skipped: false } as never;
    }) as never,
  });
  assert.equal(seenPool, pool);
});
