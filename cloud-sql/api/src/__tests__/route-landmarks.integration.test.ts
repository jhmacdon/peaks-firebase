import assert from "node:assert/strict";
import { after,test } from "node:test";
import db from "../db";
import { buildRouteLandmarksQuery,decodeRoutePlaceCursor,routePlacePage } from "../lib/route-landmarks";
import { buildPlanDestinationMatchSql } from "../processing";
import { dbSkipReason } from "./helpers/test-db";

after(async()=>{await db.end();});

test("shared places preserve first encounters, outlines, privacy, and paging",{skip:dbSkipReason??undefined},async(t)=>{
 const c=await db.connect();
 try {
  await c.query("BEGIN");
  await c.query(`
   CREATE TEMP TABLE routes(id text PRIMARY KEY,owner text,status text,path geography(LineStringZ,4326),updated_at timestamptz DEFAULT now()) ON COMMIT DROP;
   CREATE TEMP TABLE destinations(id text PRIMARY KEY,name text,owner text,elevation float8,features destination_feature[],location geography(PointZ,4326),boundary geography) ON COMMIT DROP;
   CREATE TEMP TABLE route_destinations(route_id text,destination_id text) ON COMMIT DROP;
   CREATE TEMP TABLE plans(id text PRIMARY KEY,user_id text,path geography) ON COMMIT DROP;
   CREATE TEMP TABLE plan_routes(plan_id text,route_id text) ON COMMIT DROP;
   CREATE TEMP TABLE plan_party(plan_id text,user_id text) ON COMMIT DROP;
   CREATE TEMP TABLE plan_destinations(plan_id text,destination_id text) ON COMMIT DROP;
   CREATE TEMP TABLE plan_reached_destinations(plan_id text,destination_id text,ordinal int,source text,PRIMARY KEY(plan_id,destination_id)) ON COMMIT DROP;
   CREATE TEMP TABLE destination_boundary_parts(destination_id text,ordinal int,boundary_part geography) ON COMMIT DROP;
   CREATE TEMP TABLE triple_crown_route_points(route_id text,idx int,pt geometry(Point,4326),along_m float8,PRIMARY KEY(route_id,idx)) ON COMMIT DROP;
   INSERT INTO routes(id,owner,status,path) VALUES('route','peaks','active','SRID=4326;LINESTRING Z (0 0 0,0 0.1 0)');
  `);
  const add=async(id:string,name:string,feature:string,offset:number,owner="peaks")=>{
   await c.query(`INSERT INTO destinations(id,name,owner,elevation,features,location)
    SELECT $1,$2,$3,100,ARRAY[$4]::destination_feature[],
     ST_Force3DZ(ST_Project('SRID=4326;POINT(0 0.05)'::geography,$5::float8,pi()/2)::geometry)::geography`,[id,name,owner,feature,offset]);
  };
  const page=async(uid="",cursor=decodeRoutePlaceCursor(undefined))=>{
   const q=buildRouteLandmarksQuery("route",uid,cursor);const r=await c.query(q.text,q.values);
   return r.rows.length?routePlacePage(r.rows[0],cursor):null;
  };
  await add("camp","Mackinaw Shelter","campsite",15);
  await add("hut","Mackinaw Shelter","hut",25);
  await add("white","White Pass Camp","campsite",250);
  await add("far","Far Camp","campsite",301);
  await add("private","Private Camp","campsite",1,"someone");
  await add("peak","Nearby Peak","summit",10);
  await add("view","Trail Viewpoint","viewpoint",150);
  await add("unnamed","  ","campsite",5);
  await t.test("public context includes nearby camps, deduplicates shelter records, and does not infer summits",async()=>{
   const p=(await page())!;
   assert.deepEqual(new Set(p.items.map((x:any)=>x.id)),new Set(["camp","white","view"]));
   assert.ok(Math.abs(p.items.find((x:any)=>x.id==="white").route_offset_m-250)<0.1);
   assert.equal((await c.query("SELECT count(*)::int n FROM route_destinations")).rows[0].n,0);
   assert.ok(!(await page("someone"))!.items.some((x:any)=>x.id==="private"));
  });
  await t.test("linked shelter wins without deleting or duplicating a user's links",async()=>{
   await c.query("INSERT INTO route_destinations VALUES('route','hut'),('route','peak')");
   const p=(await page())!;
   assert.ok(p.items.some((x:any)=>x.id==="hut"&&x.is_linked));
   assert.ok(!p.items.some((x:any)=>x.id==="camp"));
   assert.ok(p.items.some((x:any)=>x.id==="peak"));
   assert.equal((await c.query("SELECT count(*)::int n FROM route_destinations")).rows[0].n,2);
   await c.query("DELETE FROM route_destinations");
  });
  await t.test("uses camp edges and lake shores even when centers are far away",async()=>{
   await c.query(`UPDATE destinations SET boundary=ST_Buffer(location,128) WHERE id='white';
    INSERT INTO destination_boundary_parts SELECT id,0,boundary FROM destinations WHERE id='white'`);
   await add("lake","Wide Lake","lake",1000);
   await c.query(`UPDATE destinations SET boundary=ST_Buffer(location,980) WHERE id='lake';
    INSERT INTO destination_boundary_parts SELECT id,0,boundary FROM destinations WHERE id='lake'`);
   const p=(await page())!;
   assert.ok(p.items.find((x:any)=>x.id==="white").route_offset_m<125);
   assert.ok(p.items.find((x:any)=>x.id==="lake").route_offset_m<25);
  });
  await t.test("private routes require ownership or plan membership",async()=>{
   await c.query("UPDATE routes SET owner='owner'");
   assert.equal(await page(),null);assert.equal(await page("stranger"),null);
   assert.ok((await page("owner"))!.items.length>0);
   await c.query("INSERT INTO plans(id,user_id) VALUES('party','owner'); INSERT INTO plan_routes VALUES('party','route'); INSERT INTO plan_party VALUES('party','friend')");
   assert.ok((await page("friend"))!.items.length>0);
   await c.query("UPDATE routes SET owner='peaks'");
  });
  await t.test("orders a loop's start and first outward camp before the summit",async()=>{
   await c.query(`DELETE FROM destinations;DELETE FROM destination_boundary_parts;
    UPDATE routes SET path='SRID=4326;LINESTRING Z (0 0 0,0 0.05 0,0 0.1 0,0.00001 0.05 0,0.00001 0 0)'::geography;
    INSERT INTO destinations(id,name,owner,elevation,features,location) VALUES
     ('start','Trailhead','peaks',0,'{trailhead}','SRID=4326;POINT Z (0.00001 0 0)'),
     ('camp','Mackinaw Shelter','peaks',100,'{campsite}','SRID=4326;POINT Z (0.00001 0.05 0)'),
     ('hut','Mackinaw Shelter','peaks',100,'{hut}','SRID=4326;POINT Z (0.00002 0.05 0)'),
     ('summit','Summit','peaks',1000,'{summit}','SRID=4326;POINT Z (0 0.1 0)');
    INSERT INTO route_destinations VALUES('route','start'),('route','summit')`);
   assert.deepEqual((await page())!.items.map((x:any)=>x.id),["start","camp","summit"]);
   await c.query("INSERT INTO plans(id,user_id,path) SELECT 'matched','owner',path FROM routes WHERE id='route'");
   const q=buildPlanDestinationMatchSql("matched");await c.query(q.text,q.values);
   const r=await c.query("SELECT destination_id FROM plan_reached_destinations WHERE plan_id='matched' ORDER BY ordinal");
   assert.deepEqual(r.rows.map(x=>x.destination_id),["start","camp","summit"]);
   await c.query(q.text,q.values);
   assert.equal((await c.query("SELECT count(*)::int n FROM plan_reached_destinations WHERE plan_id='matched'")).rows[0].n,3);
  });
  await t.test("does not connect disjoint plan lines",async()=>{
   await c.query("INSERT INTO plans(id,user_id,path) VALUES('disjoint','owner','SRID=4326;MULTILINESTRING((0 0,0 0.01),(0 0.09,0 0.1))')");
   const q=buildPlanDestinationMatchSql("disjoint");await c.query(q.text,q.values);
   assert.ok(!(await c.query("SELECT destination_id FROM plan_reached_destinations WHERE plan_id='disjoint'")).rows.some(x=>x.destination_id==="camp"));
  });
  await t.test("pages all dense results without dropping a stop",async()=>{
   await c.query(`DELETE FROM destinations;DELETE FROM route_destinations;
    UPDATE routes SET path='SRID=4326;LINESTRING Z (0 0 0,0 0.1 0)'::geography;
    INSERT INTO destinations(id,name,owner,elevation,features,location)
    SELECT 'dense-'||i,'Camp '||i,'peaks',0,'{campsite}',ST_SetSRID(ST_MakePoint(0,i*0.0005,0),4326)::geography FROM generate_series(1,150) i`);
   const first=(await page())!;assert.equal(first.items.length,100);assert.ok(first.nextCursor);
   const second=(await page("",decodeRoutePlaceCursor(first.nextCursor)))!;
   assert.equal(second.items.length,50);assert.equal(second.nextCursor,null);
   assert.equal(new Set([...first.items,...second.items].map((x:any)=>x.id)).size,150);
  });
  await t.test("long paths continue at the next original vertex and detect changed geometry",async()=>{
   await c.query(`DELETE FROM destinations;
    UPDATE routes SET path=(SELECT ST_MakeLine(ST_SetSRID(ST_MakePoint(0,i*0.001,0),4326) ORDER BY i)::geography FROM generate_series(0,3000)i)`);
   const first=(await page())!;assert.ok(first.nextCursor);
   const cursor=decodeRoutePlaceCursor(first.nextCursor);assert.equal(cursor.vertex,2049);
   assert.ok(cursor.along>200000);
   const next=(await page("",cursor))!;assert.equal(next.nextCursor,null);assert.ok(next.distanceThroughMeters>300000);
   await c.query("UPDATE routes SET updated_at=updated_at+interval '1 second'");
   await assert.rejects(page("",cursor),/Route changed/);
  });
  await t.test("indexed long trails use their point index instead of the continent path",async()=>{
   await c.query(`UPDATE routes SET id='triple-crown-pct',path='SRID=4326;LINESTRING Z(20 20 0,20 21 0)'::geography;
    INSERT INTO triple_crown_route_points VALUES('triple-crown-pct',0,ST_SetSRID(ST_MakePoint(0,0),4326),0),
     ('triple-crown-pct',1,ST_SetSRID(ST_MakePoint(0,0.1),4326),11057)`);
   await add("indexed-camp","Indexed Camp","campsite",15);
   const q=buildRouteLandmarksQuery("triple-crown-pct","");const r=await c.query(q.text,q.values);
   assert.ok(routePlacePage(r.rows[0],decodeRoutePlaceCursor(undefined)).items.some((x:any)=>x.id==="indexed-camp"));
  });
 } finally {await c.query("ROLLBACK");c.release();}
});
