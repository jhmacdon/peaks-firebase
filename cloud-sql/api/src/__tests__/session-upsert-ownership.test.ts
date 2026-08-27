import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  assertSessionRoutesAccessible,
  normalizeSessionRouteIds,
  replaceSessionRoutes,
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

test("client route replacement preserves auto rows", async () => {
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes("FROM routes r") && sql.includes("FOR SHARE")) {
        return { rows: [{ id: "route-1" }] };
      }
      if (sql.includes("RETURNING route_id")) {
        return { rows: [{ route_id: "route-1" }] };
      }
      return { rows: [] };
    },
  };

  await replaceSessionRoutes(client as never, "session-1", "user-1", ["route-1"]);

  const deletion = statements.find((sql) => sql.includes("DELETE FROM session_routes"));
  const insertion = statements.find((sql) => sql.includes("INSERT INTO session_routes"));
  assert.match(deletion ?? "", /source = 'manual'/);
  assert.match(insertion ?? "", /SELECT \$1, id, 'manual' FROM allowed/);
  assert.match(insertion ?? "", /ON CONFLICT \(session_id, route_id\) DO NOTHING/);
  assert.doesNotMatch(insertion ?? "", /coverage = NULL/);
  assert.doesNotMatch(deletion ?? "", /source = 'auto'/);
});
