import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildStuckSessionsSql, sweepStuckSessions, SWEEP_ADVISORY_LOCK_KEY } from "../processing";

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

// Fake pool: a connect() client whose pg_try_advisory_lock result is scripted,
// and a pool.query that returns candidate rows.
function fakePool(lockOk: boolean, rows: Array<{ id: string; user_id: string }>) {
  const calls: string[] = [];
  const client = {
    query: async (sql: string) => {
      calls.push(sql);
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ ok: lockOk }] };
      return { rows: [] }; // pg_advisory_unlock
    },
    release: () => calls.push("RELEASE"),
  };
  const pool = {
    connect: async () => client,
    query: async () => ({ rows }),
  } as unknown as import("pg").Pool;
  return { pool, calls };
}

test("sweepStuckSessions: no-op when advisory lock not acquired", async () => {
  const { pool, calls } = fakePool(false, [{ id: "a", user_id: "u" }]);
  let processed = 0;
  const res = await sweepStuckSessions(pool, {
    processFn: (async () => { processed++; return {} as never; }) as never,
  });
  assert.equal(res.locked, false);
  assert.equal(res.swept, 0);
  assert.equal(processed, 0, "must not process when lock not held");
  assert.ok(calls.includes("RELEASE"));
});

test("sweepStuckSessions: when locked, processes serially, honors limit, unlocks", async () => {
  const rows = [{ id: "a", user_id: "u" }, { id: "b", user_id: "u" }];
  const { pool, calls } = fakePool(true, rows);
  const order: string[] = [];
  const res = await sweepStuckSessions(pool, {
    limit: 5,
    processFn: (async (id: string) => { order.push(id); return { skipped: false } as never; }) as never,
  });
  assert.equal(res.locked, true);
  assert.equal(res.swept, 2);
  assert.deepEqual(order, ["a", "b"]);
  assert.ok(calls.some((c) => c.includes("pg_advisory_unlock")));
  assert.equal(SWEEP_ADVISORY_LOCK_KEY > 0, true);
});
