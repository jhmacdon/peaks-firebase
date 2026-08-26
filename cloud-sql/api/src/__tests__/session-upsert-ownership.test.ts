import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  assertSessionRoutesAccessible,
  normalizeSessionRouteIds,
  SESSION_UPSERT_SQL,
} from "../routes/sessions";

test("session upsert cannot update a row owned by another user", () => {
  assert.match(SESSION_UPSERT_SQL, /ON CONFLICT \(id\) DO UPDATE/);
  assert.match(
    SESSION_UPSERT_SQL,
    /WHERE tracking_sessions\.user_id = EXCLUDED\.user_id/
  );
  assert.match(SESSION_UPSERT_SQL, /RETURNING id, is_public/);
});

test("normalizes session route ids and rejects malformed route lists", () => {
  assert.deepEqual(normalizeSessionRouteIds(["one", "one", "two"]), ["one", "two"]);
  assert.equal(normalizeSessionRouteIds(undefined), undefined);
  assert.equal(normalizeSessionRouteIds(["one", 2]), null);
});

test("session route access allows only catalog or caller-owned rows", async () => {
  let sql = "";
  const client = {
    async query(nextSql: string) {
      sql = nextSql;
      return { rows: [{ id: "catalog" }, { id: "mine" }] };
    },
  };
  await assertSessionRoutesAccessible(client as never, "user-1", ["catalog", "mine"]);
  assert.match(sql, /r\.owner = 'peaks' OR r\.owner = \$2/);
  assert.match(sql, /FOR SHARE/);
});

test("session route access rejects a missing or foreign-owned row", async () => {
  await assert.rejects(
    assertSessionRoutesAccessible(
      { async query() { return { rows: [{ id: "catalog" }] }; } } as never,
      "user-1",
      ["catalog", "foreign"]
    ),
    /routes are unavailable/
  );
});
