import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildSessionAreasQuery, SESSION_AREAS_SQL } from "../routes/sessions";

test("session areas come from stored path tags and collapse area fragments", () => {
  const query = buildSessionAreasQuery("session-1", "user-1");

  assert.match(query.text, /FROM session_areas sa/);
  assert.match(query.text, /JOIN areas a ON a\.id = sa\.area_id/);
  assert.match(query.text, /DISTINCT ON \(a\.kind, a\.name\)/);
  assert.match(query.text, /'relation', sa\.relation/);
  // Sub-areas (e.g. an NPS wilderness inside a national park) carry their
  // parent so clients can demote them in favor of the park.
  assert.match(query.text, /'parent_id', a\.parent_area_id/);
  assert.doesNotMatch(query.text, /a\.boundary/);
  assert.deepEqual(query.values, ["session-1", "user-1"]);
});

test("session areas require ownership or public access", () => {
  const query = buildSessionAreasQuery("session-1", "user-1");

  assert.match(query.text, /s\.user_id = \$2 OR s\.is_public = true/);
});

test("session area JSON can be embedded in every session response", () => {
  assert.match(SESSION_AREAS_SQL, /FROM session_areas sa/);
  assert.match(SESSION_AREAS_SQL, /WHERE sa\.session_id = s\.id/);
  assert.match(SESSION_AREAS_SQL, /'parent_id', a\.parent_area_id/);
  assert.match(SESSION_AREAS_SQL, /'\[\]'::json/);
  assert.doesNotMatch(SESSION_AREAS_SQL, /a\.boundary/);
});
