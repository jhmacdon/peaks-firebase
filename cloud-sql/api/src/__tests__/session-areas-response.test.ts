import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildSessionAreasQuery } from "../routes/sessions";

test("session areas come from stored path tags and collapse area fragments", () => {
  const query = buildSessionAreasQuery("session-1", "user-1");

  assert.match(query.text, /FROM session_areas sa/);
  assert.match(query.text, /JOIN areas a ON a\.id = sa\.area_id/);
  assert.match(query.text, /DISTINCT ON \(a\.kind, a\.name\)/);
  assert.match(query.text, /'relation', sa\.relation/);
  assert.doesNotMatch(query.text, /a\.boundary/);
  assert.deepEqual(query.values, ["session-1", "user-1"]);
});

test("session areas require ownership or public access", () => {
  const query = buildSessionAreasQuery("session-1", "user-1");

  assert.match(query.text, /s\.user_id = \$2 OR s\.is_public = true/);
});
