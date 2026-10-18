import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

// Autovacuum and ANALYZE evaluate index expressions with an empty search_path.
// If peaks_search_names cannot resolve its helper there, every autoanalyze of
// routes and segments fails, planner stats go stale, and search times out.
test("peaks_search_names works with an empty search_path", {
  skip: process.env.TEST_DATABASE_URL ? false : "TEST_DATABASE_URL not set",
}, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.match(url.pathname, /_test$/, "requires a disposable *_test database");
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = ''");
    const row = (await client.query(
      "SELECT public.peaks_search_names(ARRAY['Mt Si', 'LK  Serene']) AS names")).rows[0];
    assert.equal(row.names, "mount si lake serene");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
