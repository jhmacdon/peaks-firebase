import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SESSION_UPSERT_SQL } from "../routes/sessions";

test("session upsert cannot update a row owned by another user", () => {
  assert.match(SESSION_UPSERT_SQL, /ON CONFLICT \(id\) DO UPDATE/);
  assert.match(
    SESSION_UPSERT_SQL,
    /WHERE tracking_sessions\.user_id = EXCLUDED\.user_id/
  );
  assert.match(SESSION_UPSERT_SQL, /RETURNING id/);
});
