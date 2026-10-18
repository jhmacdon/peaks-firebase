import { strict as assert } from "node:assert";
import { test } from "node:test";
import { TRIPLE_CROWN_INDEXED_ROUTE_IDS, buildRouteCandidateSql } from "../processing";

test("route candidates scope active routes to the session owner", () => {
  const { text, values } = buildRouteCandidateSql("sess1");
  assert.match(text, /^WITH session_track AS MATERIALIZED/);
  assert.match(text, /r.status = 'active'/);
  assert.match(text, /r.owner = 'peaks' OR r.owner = st.user_id/);
  assert.deepEqual(values, ["sess1", TRIPLE_CROWN_INDEXED_ROUTE_IDS]);
});

test("the geography path index prunes with a box wider than the planar tests", () => {
  const { text } = buildRouteCandidateSql("s");
  assert.match(text, /ST_Expand\(s.path::geometry, 0.01\)::geography AS index_box/);
  assert.match(text, /r.path && st.index_box/);
  assert.match(text, /r.path::geometry && st.box/);
  assert.match(text, /ST_Expand\(s.path::geometry, 0.005\) AS box/);
  assert.ok(text.indexOf("r.path && st.index_box") < text.indexOf("r.path::geometry && st.box"));
});

test("CASE keeps Triple Crown routes on their point index and splits long paths", () => {
  const { text } = buildRouteCandidateSql("s");
  assert.match(text, /WHEN r.id = ANY\(\$2::text\[\]\)\s+THEN EXISTS/);
  assert.match(text, /tcp.pt && st.box/);
  assert.match(text, /ST_DWithin\(tcp.pt, st.track, 0.005\)/);
  assert.match(text, /WHEN ST_NPoints\(r.path::geometry\) <= 8192\s+THEN ST_DWithin\(r.path::geometry, st.track, 0.005\)/);
  assert.match(text, /ST_Subdivide\(r.path::geometry, 512\)/);
  assert.doesNotMatch(text, /ST_DWithin\(r.path, /);
});
