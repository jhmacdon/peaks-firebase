// Synthetic Rainier-area polygons. These function-level cases require PostGIS;
// TEST_DATABASE_URL is both the gate and the sole connection source.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import db from "../db";
import { dbSkipReason } from "./helpers/test-db";
import { buildGlacierDetailQuery, buildGlacierFactsQuery } from "../lib/glacier-detail";
import { buildRankedDestinationSearchQuery } from "../routes/search";
import { buildRouteDetailQuery } from "../routes/routes";
import { buildSessionDetailQuery, applyDestinationRejections } from "../routes/sessions";

after(async()=>{await db.end();});
const xy=(x:number,y:number)=>[-121.76+x*.001,46.85+y*.001];
const ring=(x0=0,y0=0,x1=4,y1=4)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]].map(([x,y])=>xy(x,y));
const shape=(polygons:number[][][][])=>JSON.stringify({type:"MultiPolygon",coordinates:polygons});
const vertex=(x:number,y=2,z:number|null=100,t:number|null=1700000000,s=0)=>({x:xy(x,y)[0],y:xy(x,y)[1],z,t,s});
const close=(actual:number,expected:number,tolerance=1e-5)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);

test("shared glacier engine: clipping, gaps, interpolation, write maintenance, search and privacy",{skip:dbSkipReason??undefined},async(t)=>{
  const c=await db.connect(), token=randomUUID(), parent=`glacier-parent-${token}`, glacier=`glacier-${token}`;
  const route=`glacier-route-${token}`, session=`glacier-session-${token}`, owner=`glacier-owner-${token}`;
  const setShape=async(polygons:number[][][][])=>{
    await c.query(`UPDATE destinations SET boundary=(SELECT geom::geography
      FROM ST_Dump(ST_SetSRID(ST_GeomFromGeoJSON($2),4326)) ORDER BY ST_Area(geom::geography) DESC,path LIMIT 1)
      WHERE id=$1`,[glacier,shape(polygons)]);
    return c.query(`UPDATE destination_glacier_facts SET outline=ST_SetSRID(ST_GeomFromGeoJSON($2),4326)::geography
      WHERE destination_id=$1`,[glacier,shape(polygons)]);
  };
  const match=async(vertices:ReturnType<typeof vertex>[],recording=false)=>
    (await c.query(`SELECT * FROM glacier_crossing_intervals(glacier_edges($1::jsonb,$2))
      WHERE destination_id=$3 ORDER BY entered_distance_m,pass_index`,[JSON.stringify(vertices),recording,glacier])).rows;
  try {
    await c.query("BEGIN");
    await c.query(`INSERT INTO destinations(id,name,search_name,owner,features,location)
      VALUES($1,'Synthetic Parent','synthetic parent','peaks','{summit}',ST_SetSRID(ST_MakePoint(-121.76,46.85,0),4326)::geography)`,[parent]);
    await c.query(`INSERT INTO destinations(id,name,search_name,owner,type,features,location,boundary)
      VALUES($1,'Inter Glacier','inter glacier','peaks','region','{glacier}',
        ST_SetSRID(ST_MakePoint(-121.759,46.851,0),4326)::geography,ST_SetSRID(ST_GeomFromGeoJSON($2),4326)::geography)`,
      [glacier,JSON.stringify({type:"Polygon",coordinates:[ring()]})]);
    await c.query(`INSERT INTO destination_glacier_facts(destination_id,parent_mountain_id,kind,outline_observed_at,outline_source_url,outline_source_sha256,outline)
      VALUES($1,$2,'glacier','2026-10-28','https://example.test/synthetic',repeat('a',64),ST_SetSRID(ST_GeomFromGeoJSON($3),4326)::geography)`,
      [glacier,parent,shape([[ring()]])]);

    await t.test("both endpoints outside, directed entry/exit and repeat passes",async()=>{
      const rows=await match([vertex(-1,2,100,1700000000),vertex(5,2,400,1700000600),vertex(-1,2,800,1700001200)],true);
      assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.pass_index),[0,1]);
      assert.ok(rows[0].exited_distance_m<rows[1].entered_distance_m);
      close(rows[0].entry_elevation_m,150);close(rows[0].exit_elevation_m,350);
      close(rows[0].min_elevation_m,150);close(rows[0].max_elevation_m,350);
      assert.ok(Math.abs(rows[0].entered_at.valueOf()-Date.parse("2023-11-14T22:15:00.000Z"))<=1);
      assert.ok(Math.abs(rows[0].exited_at.valueOf()-Date.parse("2023-11-14T22:21:40.000Z"))<=1);
      assert.equal(rows[0].starts_inside,false);assert.equal(rows[1].ends_inside,false);
    });
    await t.test("complete containment includes interior elevation vertices",async()=>{
      const rows=await match([vertex(1,2,100),vertex(2,2,500),vertex(3,2,200)]);
      assert.equal(rows.length,1);assert.equal(rows[0].starts_inside,true);assert.equal(rows[0].ends_inside,true);
      assert.equal(rows[0].min_elevation_m,100);assert.equal(rows[0].max_elevation_m,500);
    });
    await t.test("holes and disconnected components create separate ordered spans",async()=>{
      await setShape([[ring(),ring(1,1,3,3)],[ring(6,0,8,4)]]);
      const rows=await match([vertex(-1),vertex(9)]);
      assert.equal(rows.length,3);assert.deepEqual(rows.map(r=>r.pass_index),[0,1,2]);
      const legacy=(await c.query(`SELECT GeometryType(boundary::geometry) AS type,
        ST_NumInteriorRings(boundary::geometry) AS holes FROM destinations WHERE id=$1`,[glacier])).rows[0];
      assert.equal(legacy.type,"POLYGON");assert.equal(legacy.holes,1);
      for (const q of [buildGlacierDetailQuery(glacier,owner),buildGlacierFactsQuery(glacier,owner)]) {
        const detail=(await c.query(q.text,q.values)).rows[0];
        assert.equal(detail.boundary.type,"MultiPolygon");assert.equal(detail.boundary.coordinates.length,2);
        assert.equal(detail.boundary.coordinates[0].length,2);assert.equal(detail.glacier.outline,undefined);
      }
      await setShape([[ring()]]);
    });
    await t.test("smaller parts maintain route/session crossings and queue old and new footprints on outline-only edits",async()=>{
      await setShape([[ring(),ring(1,1,3,3)],[ring(6,1,7,3)]]);
      const contained=await match([vertex(6.2),vertex(6.8)],true);
      assert.equal(contained.length,1);assert.equal(contained[0].starts_inside,true);assert.equal(contained[0].ends_inside,true);
      const ids=[`${route}-small-old`,`${route}-small-new`],sessions=[`${session}-small-old`,`${session}-small-new`];
      const paths=[[[5.5,2],[7.5,2]],[[9.5,2],[11.5,2]]].map(points=>JSON.stringify({type:"LineString",
        coordinates:points.map(([x,y])=>[...xy(x,y),100])}));
      for (let i=0;i<2;i++) {
        await c.query(`INSERT INTO routes(id,name,owner,path) VALUES($1,'Small part route',$2,
          ST_SetSRID(ST_GeomFromGeoJSON($3),4326)::geography)`,[ids[i],owner,paths[i]]);
        await c.query(`INSERT INTO tracking_sessions(id,user_id,start_time,ended,path) VALUES($1,$2,to_timestamp(1700000000),true,
          ST_SetSRID(ST_GeomFromGeoJSON($3),4326)::geography)`,[sessions[i],owner,paths[i]]);
        for (const [j,[x,y]] of [[5.5+i*4,2],[7.5+i*4,2]].entries()) {
          const v=vertex(x,y,100,1700000000+j*100);
          await c.query(`INSERT INTO tracking_points(session_id,time,segment_number,elevation,location)
            VALUES($1,$2,0,100,ST_SetSRID(ST_MakePoint($3,$4,100),4326)::geography)`,[sessions[i],v.t,v.x,v.y]);
        }
        await c.query("SELECT refresh_session_glacier_crossings($1)",[sessions[i]]);
        assert.equal((await c.query("SELECT count(*)::int n FROM route_glacier_crossings WHERE route_id=$1",[ids[i]])).rows[0].n,1-i);
        assert.equal((await c.query("SELECT count(*)::int n FROM session_glacier_crossings WHERE session_id=$1",[sessions[i]])).rows[0].n,1-i);
        assert.equal((await c.query(`SELECT ST_Intersects(d.boundary,r.path) AS hit FROM destinations d
          JOIN routes r ON r.id=$2 WHERE d.id=$1`,[glacier,ids[i]])).rows[0].hit,false);
      }
      const before=(await c.query(`SELECT ST_AsEWKB(d.boundary::geometry) AS boundary,gf.outline_revision AS revision
        FROM destinations d JOIN destination_glacier_facts gf ON gf.destination_id=d.id WHERE d.id=$1`,[glacier])).rows[0];
      await c.query("DELETE FROM route_glacier_rematch_queue WHERE route_id=ANY($1)",[ids]);
      await c.query("DELETE FROM session_rematch_queue WHERE session_id=ANY($1)",[sessions]);
      await setShape([[ring(),ring(1,1,3,3)],[ring(10,1,11,3)]]);
      const after=(await c.query(`SELECT ST_AsEWKB(d.boundary::geometry) AS boundary,gf.outline_revision AS revision
        FROM destinations d JOIN destination_glacier_facts gf ON gf.destination_id=d.id WHERE d.id=$1`,[glacier])).rows[0];
      assert.deepEqual(after.boundary,before.boundary);assert.equal(after.revision,before.revision+1);
      assert.equal((await c.query("SELECT count(*)::int n FROM route_glacier_rematch_queue WHERE route_id=ANY($1)",[ids])).rows[0].n,2);
      assert.equal((await c.query("SELECT count(*)::int n FROM session_rematch_queue WHERE session_id=ANY($1) AND reason=$2",[sessions,`glacier:${glacier}`])).rows[0].n,2);
      for (let i=0;i<2;i++) {
        assert.equal((await c.query("SELECT glacier_match_input_hash FROM routes WHERE id=$1",[ids[i]])).rows[0].glacier_match_input_hash,null);
        assert.equal((await c.query("SELECT glacier_match_input_hash FROM tracking_sessions WHERE id=$1",[sessions[i]])).rows[0].glacier_match_input_hash,null);
        await c.query("SELECT refresh_route_glacier_crossings($1)",[ids[i]]);
        await c.query("SELECT refresh_session_glacier_crossings($1)",[sessions[i]]);
        assert.equal((await c.query("SELECT count(*)::int n FROM route_glacier_crossings WHERE route_id=$1",[ids[i]])).rows[0].n,i);
        assert.equal((await c.query("SELECT count(*)::int n FROM session_glacier_crossings WHERE session_id=$1",[sessions[i]])).rows[0].n,i);
      }
      const revision=after.revision;
      await setShape([[ring(),ring(1,1,3,3)],[ring(10,1,11,3)]]);
      assert.equal((await c.query("SELECT outline_revision FROM destination_glacier_facts WHERE destination_id=$1",[glacier])).rows[0].outline_revision,revision);
      assert.equal((await c.query("SELECT count(*)::int n FROM route_glacier_rematch_queue WHERE route_id=ANY($1)",[ids])).rows[0].n,0);
      await c.query("DELETE FROM tracking_sessions WHERE id=ANY($1)",[sessions]);
      await c.query("DELETE FROM routes WHERE id=ANY($1)",[ids]);
      await setShape([[ring()]]);
    });
    await t.test("recording segments and 20 minute/1 km gaps are never connected",async()=>{
      assert.equal((await match([vertex(-1,2,100,null,0),vertex(5,2,100,null,1)],true)).length,0);
      assert.equal((await match([vertex(-1,2,100,1700000000),vertex(5,2,100,1700001201)],true)).length,0);
      assert.equal((await match([vertex(-10),vertex(10)],true)).length,0);
      assert.equal((await match([vertex(-10),vertex(10)],false)).length,1,"catalog edges have no GPS gap cap");
      const rows=await match([vertex(1,2,100,1700000000,0),vertex(3,2,200,1700000100,0),
        vertex(1,2,300,1700000200,1),vertex(3,2,400,1700000300,1)],true);
      assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.segment_number),[0,1]);
    });
    await t.test("tangent and border-only contact are excluded; piece seams are not borders",async()=>{
      assert.equal((await match([vertex(-1,0),vertex(5,0)])).length,0);
      assert.equal((await match([vertex(-1,1),vertex(1,-1)])).length,0);
      // Collinear border followed by interior: discard only the border span.
      const notched=[[0,0],[2,0],[2,-1],[4,-1],[4,4],[0,4],[0,0]].map(([x,y])=>xy(x,y));
      await setShape([[notched]]);
      const partial=await match([vertex(-1,0,100),vertex(5,0,700)]);
      assert.equal(partial.length,1);close(partial[0].entry_elevation_m,400);
      await setShape([[ring()]]);
      await c.query("DELETE FROM glacier_outline_parts WHERE destination_id=$1",[glacier]);
      for (const [i,r] of [ring(0,0,2,4),ring(2,0,4,4)].entries())
        await c.query(`INSERT INTO glacier_outline_parts(destination_id,ordinal,outline_part)
          VALUES($1,$2,ST_SetSRID(ST_GeomFromGeoJSON($3),4326)::geography)`,[glacier,i,JSON.stringify({type:"Polygon",coordinates:[r]})]);
      assert.equal((await match([vertex(-1),vertex(5)])).length,1);
      assert.equal((await match([vertex(2,-1),vertex(2,5)])).length,1);
    });
    await t.test("missing time/Z remains null, duplicate timestamps are valid, duplicate points do not split a pass",async()=>{
      const untimed=await match([vertex(-1,2,null,0),vertex(5,2,null,null)],true);
      assert.equal(untimed[0].entered_at,null);assert.equal(untimed[0].exited_at,null);
      assert.equal(untimed[0].min_elevation_m,null);assert.equal(untimed[0].max_elevation_m,null);
      const duplicate=await match([vertex(1),vertex(2),vertex(2),vertex(3)],true);
      assert.equal(duplicate.length,1);assert.equal(duplicate[0].entered_at.valueOf(),1700000000000);
      const stationary=await match([vertex(1,2,100),vertex(2,2,200),vertex(2,2,900),vertex(2,2,300),vertex(3,2,400)],true);
      assert.equal(stationary.length,1);assert.equal(stationary[0].max_elevation_m,900,"retain intermediate Z at stationary positions");
    });
    await t.test("route path writes maintain crossings and narrow search terms, without changing objectives",async()=>{
      const line={type:"LineString",coordinates:[[-1,2,100],[5,2,400],[-1,2,800]].map(([x,y,z])=>[...xy(x,y),z])};
      await c.query(`INSERT INTO routes(id,name,owner,path) VALUES($1,'Synthetic ice route',$2,ST_SetSRID(ST_GeomFromGeoJSON($3),4326)::geography)`,[route,owner,JSON.stringify(line)]);
      assert.equal((await c.query("SELECT count(*)::int n FROM route_glacier_crossings WHERE route_id=$1",[route])).rows[0].n,2);
      assert.equal((await c.query("SELECT count(*)::int n FROM route_destinations WHERE route_id=$1",[route])).rows[0].n,0);
      const terms=(await c.query("SELECT term,weight FROM route_search_terms WHERE route_id=$1",[route])).rows;
      assert.ok(terms.some(r=>r.term==="inter glacier" && Math.abs(r.weight-.8)<.001));
      assert.ok(terms.some(r=>r.term==="interglacier"));
      const q=buildRouteDetailQuery(route,owner,{glaciers:true});
      assert.equal((await c.query(q.text,q.values)).rows[0].glacier_crossings.length,2);
      const stamp=(await c.query("SELECT updated_at FROM routes WHERE id=$1",[route])).rows[0].updated_at.valueOf();
      await c.query("SELECT refresh_route_glacier_crossings($1)",[route]);
      assert.equal((await c.query("SELECT updated_at FROM routes WHERE id=$1",[route])).rows[0].updated_at.valueOf(),stamp);
      const dense={type:"LineString",coordinates:Array.from({length:1001},(_,i)=>[...xy(-2+i*.01,2),100+i*.1])};
      await c.query("UPDATE routes SET path=ST_SetSRID(ST_GeomFromGeoJSON($2),4326)::geography WHERE id=$1",[route,JSON.stringify(dense)]);
      assert.equal((await c.query("SELECT count(*)::int n FROM route_glacier_crossings WHERE route_id=$1",[route])).rows[0].n,1,"a 512-edge window seam must not split a crossing");
      // Later windows offset by 2D edge lengths; a 3D length would shift them by the climb.
      const span=(await c.query(`SELECT c.entered_distance_m,c.crossed_distance_m,
          ST_Distance(ST_SetSRID(ST_MakePoint($2::float8,$3::float8),4326)::geography,ST_SetSRID(ST_MakePoint($4::float8,$3::float8),4326)::geography) AS width
        FROM route_glacier_crossings c WHERE route_id=$1`,[route,xy(0,2)[0],xy(0,2)[1],xy(4,2)[0]])).rows[0];
      close(span.crossed_distance_m,span.width,1e-3);close(span.entered_distance_m,span.width/2,1e-3);
      await c.query("UPDATE routes SET path=ST_SetSRID(ST_GeomFromGeoJSON($2),4326)::geography WHERE id=$1",[route,JSON.stringify(line)]);
    });
    await t.test("track crossings need no primary route, obey rejections, and count a session once",async()=>{
      await c.query(`INSERT INTO tracking_sessions(id,user_id,name,start_time,ended) VALUES($1,$2,'Synthetic ice recording',to_timestamp(1700000000),true)`,[session,owner]);
      for (const v of [vertex(-1,2,100,1700000000),vertex(5,2,400,1700000600),vertex(-1,2,800,1700001200)])
        await c.query(`INSERT INTO tracking_points(session_id,time,segment_number,elevation,location)
          VALUES($1,$2,0,$3,ST_SetSRID(ST_MakePoint($4,$5,$3),4326)::geography)`,[session,v.t,v.z,v.x,v.y]);
      await c.query("SELECT refresh_session_glacier_crossings($1)",[session]);
      const detail=buildSessionDetailQuery(session,owner,{glaciers:true});
      const row=(await c.query(detail.text,detail.values)).rows[0];
      assert.deepEqual(row.segments,[]);assert.equal(row.glacier_crossings.length,2);
      assert.equal(row.glacier_crossings[0].entered_at,"2023-11-14T22:15:00.000Z","UTC millisecond ISO, whatever the server zone");
      const glacierDetail=buildGlacierDetailQuery(glacier,owner);
      const own=(await c.query(glacierDetail.text,glacierDetail.values)).rows[0];
      assert.equal(own.session_count,1);assert.equal(own.route_count,1);assert.equal(own.sessions.length,1);
      const signedOut=buildGlacierDetailQuery(glacier,"");
      const publicRow=(await c.query(signedOut.text,signedOut.values)).rows[0];
      assert.equal(publicRow.session_count,0);assert.equal(publicRow.route_count,0);
      const privateRead=buildSessionDetailQuery(session,"stranger",{glaciers:true});
      assert.equal((await c.query(privateRead.text,privateRead.values)).rows.length,0);
      await applyDestinationRejections(c,session,undefined,[glacier]);
      assert.equal((await c.query(detail.text,detail.values)).rows[0].glacier_crossings.length,0);
      await c.query("SELECT refresh_session_glacier_crossings($1,true)",[session]);
      assert.equal((await c.query("SELECT count(*)::int n FROM session_glacier_crossings WHERE session_id=$1",[session])).rows[0].n,0);
      await applyDestinationRejections(c,session,[glacier],undefined);
      await c.query("SELECT refresh_session_glacier_crossings($1)",[session]);
      assert.equal((await c.query(detail.text,detail.values)).rows[0].glacier_crossings.length,2);
    });
    await t.test("point edits invalidate once; unchanged metadata and unchanged point writes preserve the match",async()=>{
      const hash=(await c.query("SELECT glacier_match_input_hash FROM tracking_sessions WHERE id=$1",[session])).rows[0].glacier_match_input_hash;
      await c.query("UPDATE tracking_points SET segment_number=segment_number WHERE session_id=$1",[session]);
      await c.query("UPDATE tracking_points SET azimuth=42 WHERE session_id=$1",[session]);
      assert.equal((await c.query("SELECT glacier_match_input_hash FROM tracking_sessions WHERE id=$1",[session])).rows[0].glacier_match_input_hash,hash);
      await c.query("UPDATE tracking_points SET segment_number=1 WHERE session_id=$1 AND time=1700001200",[session]);
      assert.equal((await c.query("SELECT glacier_match_input_hash FROM tracking_sessions WHERE id=$1",[session])).rows[0].glacier_match_input_hash,null);
      await c.query("SELECT refresh_session_glacier_crossings($1)",[session]);
      assert.equal((await c.query("SELECT count(*)::int n FROM session_glacier_crossings WHERE session_id=$1",[session])).rows[0].n,1);
      await c.query("UPDATE tracking_points SET segment_number=0 WHERE session_id=$1",[session]);
      await c.query("SELECT refresh_session_glacier_crossings($1)",[session]);
    });
    await t.test("glacier owner changes remove borrowed search terms before repair and preserve private access",async()=>{
      await c.query("UPDATE destinations SET owner='someone-else' WHERE id=$1",[glacier]);
      assert.equal((await c.query("SELECT count(*)::int n FROM route_search_terms WHERE route_id=$1 AND term='inter glacier'",[route])).rows[0].n,0);
      const q=buildGlacierDetailQuery(glacier,owner);
      assert.equal((await c.query(q.text,q.values)).rows.length,0);
      await c.query("SELECT refresh_route_glacier_crossings($1)",[route]);
      assert.equal((await c.query("SELECT count(*)::int n FROM route_glacier_crossings WHERE route_id=$1",[route])).rows[0].n,0);
      await c.query("UPDATE destinations SET owner='peaks' WHERE id=$1",[glacier]);
      await c.query("SELECT refresh_route_glacier_crossings($1)",[route]);
      await c.query("SELECT refresh_session_glacier_crossings($1)",[session]);
    });
    await t.test("destination search includes glacier rows without geometry in candidate tables",async()=>{
      assert.equal((await c.query("SELECT count(*)::int n FROM destination_search_rows WHERE id=$1 AND 'glacier'=ANY(features)",[glacier])).rows[0].n,1);
      const q=buildRankedDestinationSearchQuery({normalizedQuery:"inter glacier",rawQuery:"inter glacier",limit:100,glaciers:true});
      assert.ok((await c.query(q.text,q.values)).rows.some(r=>r.id===glacier));
      const old=buildRankedDestinationSearchQuery({normalizedQuery:"inter glacier",rawQuery:"inter glacier",limit:100,glaciers:false});
      assert.ok(!(await c.query(old.text,old.values)).rows.some(r=>r.id===glacier));
    });
    await t.test("changed outlines invalidate both caches; removing a path clears its spans",async()=>{
      await setShape([[ring(10,10,14,14)]]);
      assert.equal((await c.query("SELECT glacier_match_input_hash FROM routes WHERE id=$1",[route])).rows[0].glacier_match_input_hash,null);
      assert.equal((await c.query("SELECT glacier_match_input_hash FROM tracking_sessions WHERE id=$1",[session])).rows[0].glacier_match_input_hash,null);
      await c.query("SELECT refresh_route_glacier_crossings($1)",[route]);
      await c.query("SELECT refresh_session_glacier_crossings($1)",[session]);
      assert.equal((await c.query("SELECT count(*)::int n FROM route_glacier_crossings WHERE route_id=$1",[route])).rows[0].n,0);
      await c.query("UPDATE routes SET path=NULL WHERE id=$1",[route]);
      assert.equal((await c.query("SELECT count(*)::int n FROM route_glacier_crossings WHERE route_id=$1",[route])).rows[0].n,0);
      await c.query("DELETE FROM destinations WHERE id=$1",[glacier]);
      assert.equal((await c.query("SELECT count(*)::int n FROM destination_glacier_facts WHERE destination_id=$1",[glacier])).rows[0].n,0);
    });
  } finally {await c.query("ROLLBACK");c.release();}
});
