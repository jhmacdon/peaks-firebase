// Memory-bounded JSON-array streaming for unbounded result sets.
//
// `GET /api/sessions/:id/points` and `/elevation` previously ran an unbounded
// `SELECT ... FROM tracking_points` and did `res.json(result.rows)`. A long
// recording is tens of thousands of rows; node-postgres buffered the ENTIRE
// set into `result.rows`, and `res.json` then built the whole JSON string as a
// SECOND copy in memory. iOS session-sync fires many of these concurrently,
// which OOM'd the Cloud Run container.
//
// The fix: a server-side cursor (pg-query-stream) yields rows in small batches
// (default ~100) and we write them out incrementally as a JSON array. Per-request
// memory is ~constant regardless of session size.
//
// CRITICAL: the emitted bytes MUST be identical to `res.json(rows)` for the same
// rows — the iOS client parses a plain JSON array of row objects and must keep
// working unchanged. We write `[`, then each row as `JSON.stringify(row)`
// comma-separated, then `]`. That is exactly what `JSON.stringify(rows)` (and
// therefore Express's `res.json(rows)`) produces. The global pg type parsers
// from db.ts (notably BIGINT → Number) apply to QueryStream rows just as they
// do to `pool.query`, so `tracking_points.time` stays a Number on the wire.

import type { Response } from "express";
import type { Pool } from "pg";
import QueryStream from "pg-query-stream";

/**
 * Write an array of row objects to `res` as a JSON array, exactly matching the
 * bytes that `JSON.stringify(allRows)` would produce. Source-agnostic: works
 * with any async-iterable of rows (a live QueryStream, or a fake array in a
 * unit test), so the array framing can be verified without a real database.
 *
 * Returns the number of rows written.
 */
export async function writeJsonArray(
  res: Pick<Response, "write">,
  rows: AsyncIterable<unknown> | Iterable<unknown>
): Promise<number> {
  res.write("[");
  let first = true;
  let count = 0;
  for await (const row of rows as AsyncIterable<unknown>) {
    res.write((first ? "" : ",") + JSON.stringify(row));
    first = false;
    count += 1;
  }
  res.write("]");
  return count;
}

/**
 * Stream the rows of `sql` (with bound `params`) to `res` as a JSON array,
 * using a server-side cursor so memory stays bounded regardless of row count.
 *
 * Behavior contract:
 *  - Output is byte-equivalent to `res.json(rows)` for the same rows.
 *  - On a query/stream error BEFORE any bytes are sent, responds 500 with a
 *    JSON error body (headers not yet sent).
 *  - On an error AFTER streaming has begun, the status line is already on the
 *    wire and cannot be changed, so we log and destroy the connection so the
 *    client sees a truncated/aborted response rather than a silently-complete
 *    but partial body.
 *  - The pooled client is released exactly once, in `finally`.
 *
 * Callers MUST perform any auth/ownership checks (and send 404/500) BEFORE
 * calling this, because once we start writing the headers are committed.
 */
export async function streamQueryAsJsonArray(
  res: Response,
  pool: Pool,
  sql: string,
  params: unknown[]
): Promise<void> {
  const client = await pool.connect();
  // batchSize controls the server-side cursor fetch size; the default (~100)
  // keeps each `read` small so memory stays bounded.
  const stream = client.query(new QueryStream(sql, params));

  // If the client disconnects before we finish (iOS request timeout, user
  // navigated away), stop draining the cursor immediately. Otherwise the
  // `for await` keeps fetching every remaining row into a closed socket while
  // holding one of the pool's few connections hostage — which is exactly how a
  // session-sync fan-out starved the pool and 503'd the whole API. Destroying
  // the stream ends the iterator, so the `finally` runs and the connection
  // returns to the pool.
  const onClose = () => {
    stream.destroy();
  };
  res.on("close", onClose);

  try {
    res.setHeader("Content-Type", "application/json");
    await writeJsonArray(res, stream);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      // Nothing committed yet — a normal JSON error response is still possible.
      res.status(500).json({ error: "Failed to stream results" });
    } else {
      // Mid-stream failure: the 200 status + an opening `[` (and possibly rows)
      // are already on the wire. We can't change the status, and finishing the
      // array would imply success, so abort the connection to signal failure.
      console.error("streamQueryAsJsonArray: error after headers sent", err);
      res.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  } finally {
    res.off("close", onClose);
    client.release();
  }
}
