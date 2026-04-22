// Pins the `BIGINT` (INT8, OID 20) → JS `Number` type-parser registration in
// `db.ts`. If this registration is removed or reverted, `node-postgres` goes
// back to returning BIGINT as a JS string, which silently zeroes every
// `tracking_points.time` on the iOS side (`d["time"] as? Int` fails on a
// numeric string) and collapses the entire session timeline + flyover
// day/night pipeline. This test will fail loudly if anyone drops the parser.

import { strict as assert } from "node:assert";
import { test, before } from "node:test";
import { types } from "pg";

// Importing db.ts has the side-effect of registering the parser at
// module load time. That's exactly the behaviour we want to pin — the
// import below is the production entrypoint, not test-only scaffolding.
//
// We *don't* touch the pool itself, because that would try to connect
// to the Cloud SQL socket. The parser is registered at top-level of
// `db.ts` before the `new Pool(...)` call, so it runs on import.
//
// We use a dynamic `import()` inside `before` rather than a static
// `import` at top-level because esbuild/tsx's CJS output can elide
// side-effect-only imports; the dynamic form guarantees `db.ts` runs.
before(async () => {
  await import("../db");
});

test("BIGINT (INT8, oid 20) parses to a JS number, not a string", () => {
  const parse = types.getTypeParser(20);
  const numeric = parse("1625071243");
  assert.equal(typeof numeric, "number",
    "pg must return BIGINT as a JS number — iOS reads time via `as? Int`, " +
    "which silently fails on a string and zeros every tracking point.");
  assert.equal(numeric, 1625071243);
});

test("BIGINT parser tolerates full 13-digit unix-ms values", () => {
  const parse = types.getTypeParser(20);
  const ms = parse("1776023712123");
  assert.equal(typeof ms, "number");
  assert.equal(ms, 1776023712123);
  assert.ok(ms < Number.MAX_SAFE_INTEGER,
    "Unix millisecond timestamps must remain below 2^53 to survive the " +
    "Number conversion without precision loss.");
});

test("BIGINT parser preserves null", () => {
  const parse = types.getTypeParser(20);
  // node-postgres calls type parsers with null values for NULL columns.
  assert.equal(parse(null as unknown as string), null);
});
