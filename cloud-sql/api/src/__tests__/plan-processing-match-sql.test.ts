import assert from "node:assert/strict";
import {test} from "node:test";
import {buildPlanDestinationMatchSql} from "../processing";

test("plan matching uses shared first-encounter placement and keeps goals separate",()=>{
 const q=buildPlanDestinationMatchSql("plan");
 assert.deepEqual(q.values,["plan"]);
 assert.match(q.text,/INSERT INTO plan_reached_destinations/);
 assert.match(q.text,/ORDER BY distance_along_m,id/);
 assert.match(q.text,/FROM unique_places/);
 assert.match(q.text,/plan_destinations pd/);
 assert.doesNotMatch(q.text,/DELETE FROM plan_destinations/);
 assert.match(q.text,/visit=1/);
});
test("plan matching keeps both exact feature thresholds and indexed prefilters",()=>{
 const {text}=buildPlanDestinationMatchSql("plan");
 assert.match(text,/ST_DWithin\(d.location,track.piece,200\)/);
 assert.match(text,/destination_match_radius\(d.features\)/);
 assert.match(text,/ST_DWithin\(bp.boundary_part,track.piece,50\)/);
 assert.match(text,/destination_boundary_match_radius\(d.features\)/);
 assert.match(text,/d.owner='peaks' OR d.owner=\(SELECT user_id FROM source\)/);
});
test("plan outlines use small indexed pieces and original segments, never whole polygons",()=>{
 const {text}=buildPlanDestinationMatchSql("plan");
 assert.match(text,/destination_boundary_parts bp/);
 assert.match(text,/OFFSET 0/);
 assert.match(text,/ST_Dump\(s.path::geometry\)/);
 assert.match(text,/PARTITION BY line ORDER BY vertex/);
 assert.doesNotMatch(text,/ST_Subdivide\(s.path/);
 assert.doesNotMatch(text,/ST_DWithin\(d.boundary/);
 assert.doesNotMatch(text,/ST_Distance\(d.boundary/);
});
