// The batch processing-status endpoint exists to kill the iOS poll storm.
// iOS used to fire one heavy `GET /api/sessions/:id` per pending session, all
// in parallel every 15s; with ~60 pending sessions that instantly drained the
// 4-connection pool and 503'd the whole API (search included). This endpoint
// returns just the scalar processing fields for many sessions in ONE query, so
// the poll becomes a single cheap request regardless of backlog size.
//
// No DB: `parseStatusIds` is pure, and `handleProcessingStatus` takes the pool
// as an injectable dependency (same pattern as runSearchQuery) so the full
// parse→query→respond behavior is verified with a fake pool.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  parseStatusIds,
  handleProcessingStatus,
} from "../routes/sessions";

class FakeResponse {
  statusCode?: number;
  jsonBody?: unknown;
  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  json(body: unknown): this {
    this.jsonBody = body;
    return this;
  }
}

test("parseStatusIds splits a comma list, trims, drops empties", () => {
  assert.deepEqual(parseStatusIds("a, b ,,c "), ["a", "b", "c"]);
});

test("parseStatusIds dedupes while preserving first-seen order", () => {
  assert.deepEqual(parseStatusIds("a,b,a,c,b"), ["a", "b", "c"]);
});

test("parseStatusIds returns [] for non-string or empty input", () => {
  assert.deepEqual(parseStatusIds(undefined), []);
  assert.deepEqual(parseStatusIds(""), []);
  assert.deepEqual(parseStatusIds("  , ,"), []);
});

test("parseStatusIds caps the number of ids (poll-storm guard)", () => {
  const raw = Array.from({ length: 300 }, (_, i) => `id${i}`).join(",");
  assert.equal(parseStatusIds(raw, 200).length, 200);
});

test("handleProcessingStatus 400s when no ids are supplied", async () => {
  let queries = 0;
  const pool = {
    async query() {
      queries++;
      return { rows: [] };
    },
  };
  const req = { query: {}, uid: "u1" } as any;
  const res = new FakeResponse();

  await handleProcessingStatus(req, res as any, pool);

  assert.equal(res.statusCode, 400);
  assert.equal(queries, 0, "must not touch the DB when there are no ids");
});

test("handleProcessingStatus runs ONE user-scoped query and returns the rows", async () => {
  let queries = 0;
  let capturedSql = "";
  let capturedParams: unknown[] = [];
  const rows = [
    { id: "a", processing_state: "completed", processing_error: null, processed_at: "t1", server_updated_at: "t2" },
    { id: "b", processing_state: "pending", processing_error: null, processed_at: null, server_updated_at: "t3" },
  ];
  const pool = {
    async query(sql: string, params: unknown[]) {
      queries++;
      capturedSql = sql;
      capturedParams = params;
      return { rows };
    },
  };
  const req = { query: { ids: "a,b" }, uid: "u1" } as any;
  const res = new FakeResponse();

  await handleProcessingStatus(req, res as any, pool);

  assert.equal(queries, 1, "exactly one query regardless of id count");
  assert.match(capturedSql, /id = ANY\(\$2\)/, "must batch ids via ANY($2)");
  assert.match(capturedSql, /user_id = \$1/, "must scope to the authenticated user");
  assert.doesNotMatch(capturedSql, /json_agg/i, "must NOT run the expensive destination/route subqueries");
  assert.deepEqual(capturedParams, ["u1", ["a", "b"]]);
  assert.deepEqual(res.jsonBody, rows);
});
