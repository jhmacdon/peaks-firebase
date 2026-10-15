import { strict as assert } from "node:assert";
import { test } from "node:test";
import { enqueueAllSessions, parseRematchArgs, REMATCH_BATCH_SQL } from "../rematch-all-sessions";

test("rematch backfill defaults to dry-run and validates batch bounds", () => {
  assert.deepEqual(parseRematchArgs([]), { apply: false, batchSize: 100, after: "" });
  assert.deepEqual(parseRematchArgs(["--apply", "--batch-size", "2", "--after", "a"]), { apply: true, batchSize: 2, after: "a" });
  for (const size of ["0", "1001", "1.5", "NaN"]) {
    assert.throws(() => parseRematchArgs(["--batch-size", size]));
  }
  assert.throws(() => parseRematchArgs(["--unknown"]));
});

for (const apply of [false, true]) {
  test(`${apply ? "apply queues" : "dry-run only reads"} in resumable batches`, async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const batches = [[{ id: "a" }, { id: "b" }], [{ id: "c" }], []];
    const q = { async query(sql: string, values: unknown[]) {
      calls.push({ sql, values });
      return { rows: sql === REMATCH_BATCH_SQL ? batches.shift()! : [] };
    } };
    assert.equal(await enqueueAllSessions(q as never, { apply, batchSize: 2, after: "" }), 3);
    const reads = calls.filter((c) => c.sql === REMATCH_BATCH_SQL);
    assert.deepEqual(reads.map((c) => c.values), [["", 2], ["b", 2], ["c", 2]]);
    const writes = calls.filter((c) => c.sql !== REMATCH_BATCH_SQL);
    assert.equal(writes.length, apply ? 2 : 0);
    if (apply) assert.deepEqual(writes.map((c) => c.values), [[["a", "b"]], [["c"]]]);
  });
}
