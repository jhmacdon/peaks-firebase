import assert from "node:assert/strict";
import test from "node:test";
import { handlePlanVisibility } from "../routes/plans";

class FakeResponse {
  statusCode = 200;
  body: unknown;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): this {
    this.body = body;
    return this;
  }
}

test("plan owner can change visibility with an owner-scoped update", async () => {
  let sql = "";
  let params: unknown[] = [];
  const pool = {
    async query(nextSql: string, nextParams: unknown[]) {
      sql = nextSql;
      params = nextParams;
      return { rows: [{ id: "plan-1", is_public: true }] };
    },
  };
  const response = new FakeResponse();

  await handlePlanVisibility(
    { uid: "owner-1", params: { id: "plan-1" }, body: { is_public: true } } as any,
    response as any,
    pool
  );

  assert.match(sql, /WHERE id = \$1 AND user_id = \$2/);
  assert.match(sql, /RETURNING id, is_public/);
  assert.deepEqual(params, ["plan-1", "owner-1", true]);
  assert.deepEqual(response.body, { id: "plan-1", is_public: true });
});

test("plan visibility rejects non-booleans before querying", async () => {
  let called = false;
  const pool = {
    async query() {
      called = true;
      return { rows: [] };
    },
  };
  const response = new FakeResponse();

  await handlePlanVisibility(
    { uid: "owner-1", params: { id: "plan-1" }, body: { is_public: "true" } } as any,
    response as any,
    pool
  );

  assert.equal(called, false);
  assert.equal(response.statusCode, 400);
});

test("plan visibility hides missing and non-owned routes behind 404", async () => {
  const response = new FakeResponse();
  await handlePlanVisibility(
    { uid: "other-1", params: { id: "plan-1" }, body: { is_public: false } } as any,
    response as any,
    { async query() { return { rows: [] }; } }
  );

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: "Route not found" });
});
