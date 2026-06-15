// Unit tests for the JSON-array streaming framing used by the points/elevation
// endpoints. These are the load-bearing guarantee of the streaming refactor:
// the incrementally-written bytes MUST be byte-identical to what
// `res.json(rows)` (i.e. `JSON.stringify(rows)`) would have produced, so the
// iOS client keeps parsing a plain JSON array of row objects unchanged.
//
// No DB required: writeJsonArray is source-agnostic, so we feed it a fake row
// source and capture the writes. The DB-backed streamQueryAsJsonArray path is
// exercised by integration tests that skip without DATABASE_URL.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { writeJsonArray } from "../lib/stream-json";

// Minimal res.write capture: concatenates everything written, exactly as it
// would land on the wire.
function captureRes(): { res: { write(chunk: string): boolean }; body(): string } {
  let buf = "";
  return {
    res: {
      write(chunk: string): boolean {
        buf += chunk;
        return true;
      },
    },
    body: () => buf,
  };
}

// async-iterable wrapper so we exercise the same `for await` path a live
// pg-query-stream takes (QueryStream is an async-iterable Readable).
async function* asAsync<T>(rows: T[]): AsyncGenerator<T> {
  for (const row of rows) {
    yield row;
  }
}

async function streamedBody(rows: unknown[]): Promise<string> {
  const cap = captureRes();
  const count = await writeJsonArray(cap.res, asAsync(rows));
  assert.equal(count, rows.length, "writeJsonArray must report the row count");
  return cap.body();
}

test("multiple rows: streamed output == res.json(rows) output", async () => {
  const rows = [
    { time: 1625071243, segment_number: 0, elevation: 1234.5, speed: 1.2, azimuth: 90, lat: 44.1, lng: -121.7 },
    { time: 1625071244, segment_number: 0, elevation: 1235.0, speed: 1.3, azimuth: 91, lat: 44.10001, lng: -121.70001 },
    { time: 1625071245, segment_number: 1, elevation: null, speed: 0, azimuth: null, lat: 44.10002, lng: -121.70002 },
  ];

  const streamed = await streamedBody(rows);

  // JSON.stringify(rows) is precisely what Express's res.json(rows) serializes.
  assert.equal(streamed, JSON.stringify(rows));
});

test("single row: streamed output == res.json(rows) output", async () => {
  const rows = [{ time: 1625071243, elevation: 1234.5, speed: 1.2 }];

  const streamed = await streamedBody(rows);

  assert.equal(streamed, JSON.stringify(rows));
  assert.equal(streamed, '[{"time":1625071243,"elevation":1234.5,"speed":1.2}]');
});

test("zero rows: streamed output is the empty array []", async () => {
  const rows: unknown[] = [];

  const streamed = await streamedBody(rows);

  assert.equal(streamed, JSON.stringify(rows));
  assert.equal(streamed, "[]");
});

test("BIGINT time stays a Number in the framing (matches db.ts parser)", async () => {
  // db.ts registers types.setTypeParser(20, parseInt) so tracking_points.time
  // arrives as a JS Number from QueryStream just like pool.query. We assert the
  // framing emits a bare numeric (no quotes) for a Number-typed time field —
  // the exact wire shape iOS reads via `d["time"] as? Int`.
  const rows = [{ time: 1776023712, elevation: 100 }];

  const streamed = await streamedBody(rows);

  assert.equal(streamed, JSON.stringify(rows));
  assert.match(streamed, /"time":1776023712/);
  assert.doesNotMatch(streamed, /"time":"1776023712"/);
});

test("synchronous (non-async) iterable is also supported", async () => {
  // writeJsonArray accepts plain arrays too; `for await` falls back to sync
  // iteration. Guards against a regression where only async sources work.
  const rows = [{ a: 1 }, { a: 2 }];
  const cap = captureRes();

  const count = await writeJsonArray(cap.res, rows);

  assert.equal(count, 2);
  assert.equal(cap.body(), JSON.stringify(rows));
});
