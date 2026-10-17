import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
const migration=readFileSync(resolve(__dirname,"../../../migrations/20261015_segment_model_v2.sql"),"utf8");

test("link and segment rematches use transition tables and distinct affected routes",()=>{
  assert.match(migration,/OLD TABLE AS old_links/);
  assert.match(migration,/NEW TABLE AS new_links/);
  assert.match(migration,/FOR EACH STATEMENT EXECUTE FUNCTION queue_rematch_on_route_link_change/);
  assert.match(migration,/REFERENCING OLD TABLE AS old_segments NEW TABLE AS new_segments/);
  assert.match(migration,/array_agg\(DISTINCT rs.route_id\)/);
  assert.doesNotMatch(migration,/FOR EACH ROW EXECUTE FUNCTION queue_rematch_on_(?:route_link|segment_path)_change/);
  assert.match(migration,/JOIN triple_crown_route_points p/);
});

test("rebuild uses the publish check's elevation functions and joint tolerance",()=>{
  assert.match(migration,/ST_DWithin\(previous_pt::geography, pt::geography, 0.1\)/);
  assert.match(migration,/route_elevation_stats\(assembled::geography\)/);
  assert.match(migration,/elevation_string = encode_route_elevation_profile\(assembled::geography\)/);
  assert.match(migration,/gain = elevation_gain, gain_loss = elevation_loss/);
});
