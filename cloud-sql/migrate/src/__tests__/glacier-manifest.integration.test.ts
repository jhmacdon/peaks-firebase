import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { applyGlacierManifest, manifestSha256, sha256, type GlacierManifest } from "../import-glacier-manifest";
import { loadRainierOsmPackage } from "../import-rainier-glaciers";

const url=process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must name a database ending in _test");

test("import replay preserves timestamps; outline-only source change refreshes parts and queues both footprints",{skip:!url},async()=>{
  const token=randomUUID(), parent=`glacier-import-parent-${token}`, id=`glacier-import-${token}`, area=`glacier-import-area-${token}`;
  const routes=[`glacier-import-old-${token}`,`glacier-import-new-${token}`], sessions=routes.map(r=>`${r}-session`);
  const pool=new Pool({connectionString:url,max:1}), c=await pool.connect();
  const previous=process.env.GLACIER_DATABASE_URL;
  const ring=(x:number,y:number,w=1)=>[[x,y],[x+w,y],[x+w,y+w],[x,y+w],[x,y]].map(([a,b])=>[-121.76+a*.001,46.85+b*.001]);
  const shape=(x:number)=>({type:"MultiPolygon" as const,coordinates:[[ring(0,0,4)],[ring(x,1)]]});
  const base=loadRainierOsmPackage();
  const manifest: GlacierManifest={...base,parent:{...base.parent,name:parent,lat:46.85,lng:-121.76,features:["summit"]},
    container_area:{kind:"national_park",name:area},places:[{...base.places[0],id,name:`Fixture Glacier ${token}`,
      osm_key:`way:${Date.now()}${Math.floor(Math.random()*10000)}`,external_ids:{},aliases:[],boundary:shape(6)}]};
  const apply=async(m:GlacierManifest)=>{
    const hash=manifestSha256(m);
    await applyGlacierManifest({...m,manifest_sha256:hash},["--apply",`--expected-manifest-sha256=${hash}`,`--parent-mountain-id=${parent}`,`--park-area-id=${area}`]);
  };
  const state=async()=>(await c.query(`SELECT d.updated_at AS destination_updated,gf.updated_at AS facts_updated,gf.outline_revision,
    ST_AsEWKB(d.boundary::geometry) AS boundary,ST_AsEWKB(gf.outline::geometry) AS outline,
    (SELECT jsonb_agg(jsonb_build_array(route_id,queued_at) ORDER BY route_id) FROM route_glacier_rematch_queue WHERE route_id=ANY($2::text[])) AS route_queue,
    (SELECT jsonb_agg(jsonb_build_array(session_id,queued_at,reason) ORDER BY session_id) FROM session_rematch_queue WHERE session_id=ANY($3::text[])) AS session_queue
    FROM destinations d JOIN destination_glacier_facts gf ON gf.destination_id=d.id WHERE d.id=$1`,[id,routes,sessions])).rows[0];
  try {
    process.env.GLACIER_DATABASE_URL=url;
    await c.query(`INSERT INTO destinations(id,name,search_name,owner,features,country_code,state_code,location)
      VALUES($1,$1,$1,'peaks','{summit}','US','WA',ST_SetSRID(ST_MakePoint(-121.76,46.85,0),4326)::geography)`,[parent]);
    await c.query(`INSERT INTO areas(id,name,search_name,kind,source,source_id,source_version,boundary,centroid,bbox_min_lat,bbox_max_lat,bbox_min_lng,bbox_max_lng)
      SELECT $1,$1,$1,'national_park','fixture',$1,'1',ST_Multi(g),ST_Centroid(g),46.7,47,-121.9,-121.6
      FROM (SELECT ST_MakeEnvelope(-121.9,46.7,-121.6,47,4326) g) s`,[area]);
    await apply(manifest);
    for (let i=0;i<2;i++) {
      const x=5.5+i*4, path={type:"LineString",coordinates:[[...ring(x,1.5)[0],100],[...ring(x+2,1.5)[0],100]]};
      await c.query(`INSERT INTO routes(id,name,owner,path) VALUES($1,'Fixture route',$2,ST_SetSRID(ST_GeomFromGeoJSON($3),4326)::geography)`,[routes[i],token,JSON.stringify(path)]);
      await c.query(`INSERT INTO tracking_sessions(id,user_id,start_time,ended,path)
        VALUES($1,$2,to_timestamp(1700000000),true,ST_SetSRID(ST_GeomFromGeoJSON($3),4326)::geography)`,[sessions[i],token,JSON.stringify(path)]);
      for (const [j,p] of path.coordinates.entries()) await c.query(`INSERT INTO tracking_points(session_id,time,segment_number,elevation,location)
        VALUES($1,$2,0,100,ST_SetSRID(ST_MakePoint($3,$4,100),4326)::geography)`,[sessions[i],1700000000+j*100,p[0],p[1]]);
      await c.query("SELECT refresh_session_glacier_crossings($1)",[sessions[i]]);
    }
    await c.query("DELETE FROM route_glacier_rematch_queue WHERE route_id=ANY($1::text[])",[routes]);
    await c.query("DELETE FROM session_rematch_queue WHERE session_id=ANY($1::text[])",[sessions]);
    const before=await state();
    await apply(manifest);
    assert.deepEqual(await state(),before,"identical manifests do not update facts/destinations or queues");

    const boundary=shape(10), geometry={schema_version:1 as const,geometry_source:"Fixture inventory",source_url:"https://example.test/inventory",
      source_sha256:"b".repeat(64),observed_at:"2019-09-09",snapshot_at:"2026-10-28",credit:"Fixture inventory authors",license:"CC0-1.0",
      license_url:"https://creativecommons.org/publicdomain/zero/1.0/",method:"Fixture inventory union",geometry_sha256:sha256(JSON.stringify(boundary))};
    const refreshed={...manifest,places:[{...manifest.places[0],boundary,geometry}]};
    await apply(refreshed);
    const changed=await state();
    assert.deepEqual(changed.boundary,before.boundary,"largest display polygon stays fixed");
    assert.equal(changed.outline_revision,before.outline_revision+1);
    assert.equal(changed.route_queue.length,2);
    assert.equal(changed.session_queue.length,2);
    const row=(await c.query(`SELECT geometry_credit,geometry_license,to_char(outline_observed_at,'YYYY-MM-DD') AS mapped,
      outline_source_url,outline_source_sha256,provenance->'outline' AS provenance,
      ST_Equals(outline::geometry,(SELECT ST_UnaryUnion(ST_Collect(outline_part::geometry)) FROM glacier_outline_parts WHERE destination_id=$1)) AS parts_ok,
      (SELECT ST_Equals(d.boundary::geometry,(SELECT ST_UnaryUnion(ST_Collect(boundary_part::geometry))
        FROM destination_boundary_parts WHERE destination_id=$1)) FROM destinations d WHERE d.id=$1) AS boundary_parts_ok
      FROM destination_glacier_facts WHERE destination_id=$1`,[id])).rows[0];
    assert.equal(row.geometry_credit,geometry.credit);assert.equal(row.geometry_license,geometry.license);
    assert.equal(row.mapped,"2019-09-09");assert.equal(row.outline_source_url,geometry.source_url);
    assert.equal(row.outline_source_sha256,geometry.source_sha256);assert.deepEqual(row.provenance,geometry);
    assert.equal(row.parts_ok,true);assert.equal(row.boundary_parts_ok,true);
    await apply(refreshed);
    assert.deepEqual(await state(),changed,"replaying a refresh leaves timestamps, revision and queue dates unchanged");
    for (let i=0;i<2;i++) {
      await c.query("SELECT refresh_route_glacier_crossings($1)",[routes[i]]);
      await c.query("SELECT refresh_session_glacier_crossings($1)",[sessions[i]]);
      assert.equal((await c.query("SELECT count(*)::int n FROM route_glacier_crossings WHERE route_id=$1 AND destination_id=$2",[routes[i],id])).rows[0].n,i);
      assert.equal((await c.query("SELECT count(*)::int n FROM session_glacier_crossings WHERE session_id=$1 AND destination_id=$2",[sessions[i],id])).rows[0].n,i);
    }
  } finally {
    if (previous===undefined) delete process.env.GLACIER_DATABASE_URL; else process.env.GLACIER_DATABASE_URL=previous;
    await c.query("DELETE FROM tracking_sessions WHERE id=ANY($1::text[])",[sessions]);
    await c.query("DELETE FROM routes WHERE id=ANY($1::text[])",[routes]);
    await c.query("DELETE FROM destinations WHERE id=$1",[id]);
    await c.query("DELETE FROM destinations WHERE id=$1",[parent]);
    await c.query("DELETE FROM areas WHERE id=$1",[area]);
    c.release();await pool.end();
  }
});

test("per-place containers and parents: absent containers skip coverage and links; keyed IDs are checked",{skip:!url},async()=>{
  const token=randomUUID(), parents=[`glacier-a-parent-${token}`,`glacier-b-parent-${token}`], ids=[`glacier-a-${token}`,`glacier-b-${token}`];
  const area=`glacier-a-area-${token}`, small=`glacier-small-area-${token}`;
  const pool=new Pool({connectionString:url,max:1}), c=await pool.connect();
  const previous=process.env.GLACIER_DATABASE_URL;
  const ring=(x:number)=>[[x,0],[x+2,0],[x+2,2],[x,2],[x,0]].map(([a,b])=>[-121.76+a*.001,46.85+b*.001]);
  const base=loadRainierOsmPackage(), parent={...base.parent,name:parents[0],lat:46.85,lng:-121.76,features:["summit"]};
  const { container_area: _single, ...rest } = base;
  const manifest: GlacierManifest={...rest,parent,parents:{second:{...parent,name:parents[1],mountain_context:{named_glacier_count:1}}},
    container_areas:{wild:{kind:"wilderness",name:area}},places:ids.map((id,i)=>({...base.places[0],id,name:`Keyed Glacier ${i} ${token}`,
      osm_key:`way:${Date.now()}${i}${Math.floor(Math.random()*10000)}`,external_ids:{},aliases:[],
      boundary:{type:"MultiPolygon" as const,coordinates:[[ring(i*10)]]},
      ...(i ? {parent_key:"second",container_area_key:null} : {container_area_key:"wild"})}))};
  const hash=manifestSha256(manifest), args=(areaId:string)=>["--apply",`--expected-manifest-sha256=${hash}`,
    `--parent-mountain-id=${parents[0]}`,`--parent-id=second=${parents[1]}`,`--area-id=wild=${areaId}`];
  try {
    process.env.GLACIER_DATABASE_URL=url;
    for (const p of parents) await c.query(`INSERT INTO destinations(id,name,search_name,owner,features,country_code,state_code,location)
      VALUES($1,$1,$1,'peaks','{summit}','US','WA',ST_SetSRID(ST_MakePoint(-121.76,46.85,0),4326)::geography)`,[p]);
    for (const [id,g] of [[area,"ST_MakeEnvelope(-121.77,46.84,-121.755,46.86,4326)"],[small,"ST_MakeEnvelope(-121.77,46.84,-121.7595,46.86,4326)"]])
      await c.query(`INSERT INTO areas(id,name,search_name,kind,source,source_id,source_version,boundary,centroid,bbox_min_lat,bbox_max_lat,bbox_min_lng,bbox_max_lng)
        SELECT $1,$2,$2,'wilderness','fixture',$1,'1',ST_Multi(g),ST_Centroid(g),ST_YMin(g),ST_YMax(g),ST_XMin(g),ST_XMax(g) FROM (SELECT ${g} g) s`,[id,area]);
    await assert.rejects(applyGlacierManifest({...manifest,manifest_sha256:hash},args(small)),/out-of-area/,"a keyed area that misses its outline stops before writes");
    assert.equal((await c.query("SELECT count(*)::int n FROM destinations WHERE id=ANY($1::text[])",[ids])).rows[0].n,0);
    await assert.rejects(applyGlacierManifest({...manifest,manifest_sha256:hash},[...args(area).slice(0,3),`--parent-id=second=${parents[0]}`,`--area-id=wild=${area}`]),
      /identity check failed/,"a keyed parent ID must match that parent's name");
    await applyGlacierManifest({...manifest,manifest_sha256:hash},args(area));
    const rows=(await c.query(`SELECT gf.destination_id,gf.parent_mountain_id,gf.provenance->'mountain_context' AS context,
      (SELECT array_agg(area_id) FROM destination_areas da WHERE da.destination_id=gf.destination_id) AS areas
      FROM destination_glacier_facts gf WHERE gf.destination_id=ANY($1::text[]) ORDER BY gf.destination_id`,[ids])).rows;
    assert.deepEqual(rows.map(r=>[r.destination_id,r.parent_mountain_id,r.areas]),[[ids[0],parents[0],[area]],[ids[1],parents[1],null]]);
    assert.deepEqual(rows[1].context,{named_glacier_count:1});
    assert.deepEqual(rows[0].context,base.mountain_context);
  } finally {
    if (previous===undefined) delete process.env.GLACIER_DATABASE_URL; else process.env.GLACIER_DATABASE_URL=previous;
    await c.query("DELETE FROM destinations WHERE id=ANY($1::text[])",[ids]);
    await c.query("DELETE FROM destinations WHERE id=ANY($1::text[])",[parents]);
    await c.query("DELETE FROM areas WHERE id=ANY($1::text[])",[[area,small]]);
    c.release();await pool.end();
  }
});
