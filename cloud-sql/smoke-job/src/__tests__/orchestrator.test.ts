// Orchestrator DB seams: sample-cell collection (dedupe, CONUS filter,
// null-location skip) and the upsert SQL (conflict clause, newer-run guard,
// chunking). Fake pool, no live DB.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { collectSampleCells, upsertSmokeRows, SmokeRow } from "../index";

function fakePool(rows: any[]) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  return {
    calls,
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return { rows };
    },
  };
}

test("collectSampleCells dedupes to cells, skips nulls and non-CONUS", async () => {
  const pool = fakePool([
    { id: "p1", lat: 44.2701, lng: -71.3033 },
    { id: "p2", lat: 44.2703, lng: -71.3035 }, // same cell as p1
    { id: "p3", lat: null, lng: null },        // no destination, no path
    { id: "p4", lat: 60.0, lng: -150.0 },      // Alaska → out of domain
    { id: "p5", lat: 39.0, lng: -120.0 },
  ]);
  const cells = await collectSampleCells(pool);
  assert.deepEqual(
    cells.map((c) => c.cellKey).sort(),
    ["1300:-4000", "1476:-2377"]
  );
  // Date-window scoping and first-destination-then-path fallback in SQL:
  assert.match(pool.calls[0].sql, /p\.date BETWEEN now\(\) - interval '24 hours' AND now\(\) \+ interval '60 hours'/);
  assert.match(pool.calls[0].sql, /ST_PointOnSurface/);
  assert.match(pool.calls[0].sql, /ORDER BY pd\.ordinal/);
  // Must match the API's first-destination pick exactly (cloud-sql/api/src/routes/plans.ts):
  // skip region destinations with no point, and break ordinal ties by id.
  assert.match(pool.calls[0].sql, /d\.location IS NOT NULL/);
  assert.match(pool.calls[0].sql, /ORDER BY pd\.ordinal, pd\.destination_id/);
});

test("upsertSmokeRows writes conflict-guarded upserts in one chunk", async () => {
  const pool = fakePool([]);
  const rows: SmokeRow[] = [
    { cellKey: "1476:-2377", validAtSec: 1754481600, runAtSec: 1754460000, smokeUgM3: 12.5 },
    { cellKey: "1476:-2377", validAtSec: 1754485200, runAtSec: 1754460000, smokeUgM3: 14.1 },
  ];
  await upsertSmokeRows(pool, rows);
  assert.equal(pool.calls.length, 1);
  const { sql, params } = pool.calls[0];
  assert.match(sql, /INSERT INTO smoke_forecasts/);
  assert.match(sql, /ON CONFLICT \(cell_key, valid_at\) DO UPDATE/);
  assert.match(sql, /WHERE EXCLUDED\.run_at >= smoke_forecasts\.run_at/);
  assert.equal(params!.length, 8);
  assert.equal(params![0], "1476:-2377");
  assert.equal(params![3], 12.5);
});

test("upsertSmokeRows chunks big batches", async () => {
  const pool = fakePool([]);
  const rows: SmokeRow[] = Array.from({ length: 501 }, (_, i) => ({
    cellKey: "1:1",
    validAtSec: 1754481600 + i * 3600,
    runAtSec: 1754460000,
    smokeUgM3: 1,
  }));
  await upsertSmokeRows(pool, rows);
  assert.equal(pool.calls.length, 2);
  // Chunk 2 has exactly one row; its placeholders restart at $1.
  assert.equal(pool.calls[1].params!.length, 4);
  assert.match(pool.calls[1].sql, /\(\$1, to_timestamp\(\$2\)/);
});

test("upsertSmokeRows no-ops on empty input", async () => {
  const pool = fakePool([]);
  await upsertSmokeRows(pool, []);
  assert.equal(pool.calls.length, 0);
});
