// The backfill rewrites session_routes across the whole history. These pins
// are the properties that make that safe to run twice, and safe to interrupt.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const script = readFileSync(
  resolve(__dirname, "../../scripts/backfill-route-coverage.ts"),
  "utf8"
);

test("the backfill reuses the live matching code rather than copying it", () => {
  assert.match(script, /from "\.\.\/src\/processing"/);
  assert.match(script, /measureSessionRouteCoverage/);
  assert.match(script, /upsertSessionRouteCoverage/);
  // No second copy of the merge or the gate.
  assert.doesNotMatch(script, /mergeCoveredIntervals/);
  assert.doesNotMatch(script, /ST_DumpPoints/);
});

test("the backfill is batched, resumable and gentle on a db-f1-micro", () => {
  assert.match(script, /--dry-run/);
  assert.match(script, /--limit/);
  assert.match(script, /--delay-ms/);
  assert.match(script, /--session/);
  assert.match(script, /s\.path IS NOT NULL/);
  assert.match(script, /s\.id = \$2/);
  assert.match(script, /ORDER BY s\.start_time ASC, s\.id ASC/);
});

test("the backfill never deletes and never overwrites a manual row", () => {
  assert.doesNotMatch(script, /DELETE FROM session_routes/);
  assert.doesNotMatch(script, /DELETE FROM tracking_sessions/);
  assert.doesNotMatch(script, /processing_state/);
});

test("the script says out loud that running it on prod is a separate decision", () => {
  assert.match(script, /separate, explicitly confirmed step/);
});

test("--delay-ms 0 is honoured; a delay of zero is a real choice", () => {
  // intFlag (copied from backfill-comparisons.ts) rejects 0 and silently
  // returns the 300 ms default, which would make "--delay-ms 0" a lie in the
  // run header. A limit of zero is meaningless; a delay of zero is not.
  assert.match(script, /function nonNegativeIntFlag/);
  assert.match(script, /nonNegativeIntFlag\("--delay-ms", 300\)/);
});

test("package.json exposes the backfill the way the other backfills are exposed", () => {
  const pkg = JSON.parse(
    readFileSync(resolve(__dirname, "../../package.json"), "utf8")
  ) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["backfill:route-coverage"], "tsx scripts/backfill-route-coverage.ts");
});
