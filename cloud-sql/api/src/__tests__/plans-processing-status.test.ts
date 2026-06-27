// Plan batch processing-status endpoint — same poll-storm-safe contract as the
// sessions one: ONE user-scoped batched query returning only scalar processing
// fields. Verified against a fake pool, no live DB.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { handlePlanProcessingStatus } from "../routes/plans";

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

test("handlePlanProcessingStatus 400s when no ids supplied", async () => {
  let queries = 0;
  const pool = {
    async query() {
      queries++;
      return { rows: [] };
    },
  };
  const req = { query: {}, uid: "u1" } as any;
  const res = new FakeResponse();
  await handlePlanProcessingStatus(req, res as any, pool);
  assert.equal(res.statusCode, 400);
  assert.equal(queries, 0, "must not touch the DB when there are no ids");
});

test("handlePlanProcessingStatus runs ONE user-scoped batched query", async () => {
  let queries = 0;
  let capturedSql = "";
  let capturedParams: unknown[] = [];
  const rows = [
    { id: "a", processing_state: "completed", processing_error: null, processed_at: "t1", server_updated_at: "t2" },
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
  await handlePlanProcessingStatus(req, res as any, pool);
  assert.equal(queries, 1, "exactly one query regardless of id count");
  assert.match(capturedSql, /FROM plans/);
  assert.match(capturedSql, /id = ANY\(\$2\)/, "must batch ids via ANY($2)");
  assert.match(capturedSql, /user_id = \$1/, "must scope to the authenticated user");
  assert.doesNotMatch(capturedSql, /json_agg/i, "must NOT run expensive subqueries");
  assert.deepEqual(capturedParams, ["u1", ["a", "b"]]);
  assert.deepEqual(res.jsonBody, rows);
});
