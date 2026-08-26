import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildSessionDetailQuery,
  buildSessionMarkersQuery,
} from "../routes/sessions";

test("public session detail strips owner-only health and import fields", () => {
  const query = buildSessionDetailQuery("session-1", "viewer-1");

  assert.match(
    query.text,
    /CASE WHEN s\.user_id = \$2 THEN s\.health_data ELSE NULL END AS health_data/
  );
  assert.match(
    query.text,
    /CASE WHEN s\.user_id = \$2 THEN s\.external_id ELSE NULL END AS external_id/
  );
  assert.match(
    query.text,
    /CASE WHEN s\.user_id = \$2 THEN s\.source ELSE NULL END AS source/
  );
  assert.match(
    query.text,
    /CASE WHEN s\.user_id = \$2\s+THEN s\.source_contributions\s+ELSE '\[\]'::jsonb/
  );
  assert.match(
    query.text,
    /CASE WHEN s\.user_id = \$2 THEN s\.user_id ELSE '' END AS user_id/
  );
  assert.match(
    query.text,
    /CASE WHEN s\.user_id = \$2 THEN s\.group_id ELSE NULL END AS group_id/
  );
  assert.match(
    query.text,
    /THEN s\.processing_error\s+ELSE NULL\s+END AS processing_error/
  );
  assert.match(query.text, /s\.user_id = \$2 OR s\.is_public = true/);
  assert.deepEqual(query.values, ["session-1", "viewer-1"]);
});

test("session marker names and coordinates remain owner-only", () => {
  const query = buildSessionMarkersQuery("session-1", "viewer-1");
  assert.match(query.text, /s\.user_id = \$2/);
  assert.doesNotMatch(query.text, /s\.is_public/);
  assert.deepEqual(query.values, ["session-1", "viewer-1"]);
});
