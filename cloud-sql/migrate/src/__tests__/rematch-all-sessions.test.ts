import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  enqueueAllSessions, parseRematchArgs, QUEUE_DEPTH_SQL, QUEUE_POLL_MS, REMATCH_BATCH_SQL, REMATCH_COUNT_SQL,
  REMATCH_INSERT_SQL, waitForQueueRoom,
} from "../rematch-all-sessions";

test("rematch backfill defaults to dry-run and validates its bounds", () => {
  assert.deepEqual(parseRematchArgs([]), { apply: false, batchSize: 100, after: "", maxQueue: 200 });
  assert.deepEqual(parseRematchArgs(["--apply", "--batch-size", "2", "--after", "a", "--max-queue", "50"]),
    { apply: true, batchSize: 2, after: "a", maxQueue: 50 });
  for (const size of ["0", "1001", "1.5", "NaN"]) assert.throws(() => parseRematchArgs(["--batch-size", size]));
  for (const size of ["0", "-1", "2.5"]) assert.throws(() => parseRematchArgs(["--max-queue", size]));
  assert.throws(() => parseRematchArgs(["--unknown"]));
});

test("selection is keyset order over ended sessions with paths, with no route test", () => {
  assert.match(REMATCH_BATCH_SQL, /s.id > \$1 AND s.ended AND s.path IS NOT NULL/);
  assert.match(REMATCH_BATCH_SQL, /ORDER BY s.id LIMIT \$2/);
  assert.doesNotMatch(REMATCH_BATCH_SQL, /routes|ST_DWithin|ST_Subdivide|session_routes/);
  assert.match(REMATCH_INSERT_SQL, /'matching-v2-backfill'/);
  assert.match(REMATCH_INSERT_SQL, /ON CONFLICT \(session_id\) DO UPDATE SET reason = EXCLUDED.reason, queued_at = now\(\)/);
});

const clock = () => {
  let t = 0;
  const sleeps: number[] = [];
  return { sleeps, now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; } };
};

test("dry-run only counts", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const q = { async query(sql: string, values?: unknown[]) { calls.push({ sql, values }); return { rows: [{ n: 1214 }] }; } };
  assert.equal(await enqueueAllSessions(q as never, { apply: false, batchSize: 200, after: "", maxQueue: 200 }), 1214);
  assert.deepEqual(calls, [{ sql: REMATCH_COUNT_SQL, values: [""] }]);
});

test("apply queues resumable batches, waiting for room before each insert", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const batches = [[{ id: "a" }, { id: "b" }], [{ id: "c" }], []];
  const depths = [0, 250, 199];
  const c = clock();
  const q = { async query(sql: string, values?: unknown[]) {
    calls.push({ sql, values });
    if (sql === REMATCH_BATCH_SQL) return { rows: batches.shift()! };
    if (sql === QUEUE_DEPTH_SQL) return { rows: [{ n: depths.shift() }] };
    return { rows: [] };
  } };
  assert.equal(await enqueueAllSessions(q as never, { apply: true, batchSize: 2, after: "", maxQueue: 200 }, c), 3);
  assert.deepEqual(calls.filter((x) => x.sql === REMATCH_BATCH_SQL).map((x) => x.values), [["", 2], ["b", 2], ["c", 2]]);
  assert.deepEqual(calls.filter((x) => x.sql === REMATCH_INSERT_SQL).map((x) => x.values), [[["a", "b"]], [["c"]]]);
  assert.deepEqual(calls.map((x) => x.sql === REMATCH_BATCH_SQL ? "read" : x.sql === QUEUE_DEPTH_SQL ? "depth" : "insert"),
    ["read", "depth", "insert", "read", "depth", "depth", "insert", "read"]);
  assert.deepEqual(c.sleeps, [QUEUE_POLL_MS]);
});

test("waiting for queue room gives up after 30 minutes", async () => {
  const c = clock();
  const q = { async query() { return { rows: [{ n: 500 }] }; } };
  await assert.rejects(waitForQueueRoom(q as never, 200, c), /still holds 500 rows/);
  assert.equal(c.sleeps.length, 60);
});
