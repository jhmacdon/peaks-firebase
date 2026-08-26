import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicSessionRoutesQuery } from "./public-session-routes";

test("public activity routes omit legacy links owned by another user", () => {
  const query = buildPublicSessionRoutesQuery("session-1");
  assert.match(query.text, /ts\.is_public = true/);
  assert.match(query.text, /r\.owner = 'peaks' OR r\.owner = ts\.user_id/);
  assert.match(query.text, /AS is_catalog/);
  assert.deepEqual(query.values, ["session-1"]);
});
