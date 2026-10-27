import assert from "node:assert/strict";
import {after,test} from "node:test";
import db from "../db";
import plansRouter from "../routes/plans";
import {processPlan} from "../processing";
import {planSourceFingerprintSql} from "../lib/plan-repair";
import {dbSkipReason} from "./helpers/test-db";
after(async()=>{await db.end();});

test("route-only plan saves finish matching before responding and preserve goals",{skip:dbSkipReason??undefined},async(t)=>{
 const c=await db.connect();
 try {
  await c.query(`CREATE TEMP TABLE plans(id text PRIMARY KEY,user_id text,name text,description text,date timestamptz,
   is_public bool DEFAULT false,path geography,distance float8,gain float8,processing_state text DEFAULT 'idle',
   processing_error text,processing_started_at timestamptz,processed_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
   CREATE TRIGGER temp_plans_updated BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
   CREATE TEMP TABLE routes(id text PRIMARY KEY,owner text,status text,path geography,updated_at timestamptz DEFAULT now());
   CREATE TEMP TABLE plan_routes(plan_id text,route_id text,ordinal int,PRIMARY KEY(plan_id,route_id));
   CREATE TEMP TABLE plan_destinations(plan_id text,destination_id text,ordinal int,PRIMARY KEY(plan_id,destination_id));
   CREATE TEMP TABLE plan_reached_destinations(plan_id text,destination_id text,ordinal int,source text,PRIMARY KEY(plan_id,destination_id));
   CREATE TEMP TABLE plan_party(plan_id text,user_id text);
   CREATE TEMP TABLE destinations(id text PRIMARY KEY,name text,owner text,elevation float8,features destination_feature[],location geography,boundary geography);
   CREATE TEMP TABLE destination_boundary_parts(destination_id text,ordinal int,boundary_part geography);
   INSERT INTO routes(id,owner,status,path) VALUES('route','peaks','active','SRID=4326;LINESTRING(0 0,0 0.1)'),('other','peaks','active','SRID=4326;LINESTRING(0 0.2,0 0.3)');
   INSERT INTO destinations VALUES('camp','Mackinaw Shelter','peaks',100,'{campsite}','SRID=4326;POINT(0 0.05)',NULL),
    ('hut','Mackinaw Shelter','peaks',100,'{hut}','SRID=4326;POINT(0.00001 0.05)',NULL),
    ('other-camp','Other Camp','peaks',100,'{campsite}','SRID=4326;POINT(0 0.25)',NULL)`);
  let activeWriters=0;
  t.mock.method(db,"query",async(sql:string,args?:unknown[])=>{
   if (sql.startsWith("UPDATE plans p")&&sql.includes("processing_started_at")) assert.equal(activeWriters,0,"release the write connection before awaiting the matcher");
   return c.query(sql,args);
  });
  t.mock.method(db,"connect",async()=>{
   // The processor connects only after the handler releases its transaction.
   activeWriters++;
   let released=false;
   return {query:(sql:string,args?:unknown[])=>c.query(sql,args),release(){if(!released){released=true;activeWriters--;}}};
  });
  const handler=(method:string,path:string)=>{
   const layer=(plansRouter as any).stack.find((x:any)=>x.route?.path===path&&x.route.methods[method]);
   assert.ok(layer);return layer.route.stack[0].handle;
  };
  const response=()=>({code:200,body:undefined as any,status(n:number){this.code=n;return this;},json(v:unknown){this.body=v;return this;}});
  const first=response();
  await handler("post","/")({uid:"owner",body:{id:"plan",name:"A plan",routes:["route"],destinations:["goal"]}},first);
  assert.equal(first.code,201);
  assert.equal((await c.query("SELECT processing_state FROM plans WHERE id='plan'")).rows[0].processing_state,"completed");
  assert.deepEqual((await c.query("SELECT destination_id FROM plan_reached_destinations WHERE plan_id='plan'")).rows.map(x=>x.destination_id),["camp"]);
  assert.deepEqual((await c.query("SELECT destination_id FROM plan_destinations WHERE plan_id='plan'")).rows.map(x=>x.destination_id),["goal"]);
  const updated=response();
  await handler("put","/:id")({uid:"owner",params:{id:"plan"},body:{routes:["other"]}},updated);
  assert.equal(updated.code,200);
  assert.deepEqual((await c.query("SELECT destination_id FROM plan_reached_destinations WHERE plan_id='plan'")).rows.map(x=>x.destination_id),["other-camp"]);
  assert.equal((await c.query("SELECT count(*)::int n FROM plan_destinations")).rows[0].n,1);
  const pool={query:(sql:string,args?:unknown[])=>c.query(sql,args),connect:async()=>({query:(sql:string,args?:unknown[])=>c.query(sql,args),release(){}})} as any;
  await t.test("saved superseded paths remain usable without changing route links",async()=>{
   await c.query("UPDATE routes SET status='superseded' WHERE id='other'");
   await processPlan("plan","owner",{pool});
   assert.equal((await c.query("SELECT route_id FROM plan_routes WHERE plan_id='plan'")).rows[0].route_id,"other");
   assert.equal((await c.query("SELECT destination_id FROM plan_reached_destinations WHERE plan_id='plan'")).rows[0].destination_id,"other-camp");
  });
  await t.test("guarded repair tolerates the real processing timestamp trigger",async()=>{
   const row=(await c.query(`SELECT ${planSourceFingerprintSql()} fingerprint,updated_at::text AS version FROM plans p WHERE id='plan'`)).rows[0];
   await processPlan("plan","owner",{pool,expectedSourceFingerprint:row.fingerprint,expectedUpdatedAt:row.version});
   const after=(await c.query(`SELECT ${planSourceFingerprintSql()} fingerprint,processing_state FROM plans p WHERE id='plan'`)).rows[0];
   assert.equal(after.fingerprint,row.fingerprint);
   assert.equal(after.processing_state,"completed");
  });
  await t.test("the claim rejects a changed timestamp even if user fields match",async()=>{
   const row=(await c.query(`SELECT ${planSourceFingerprintSql()} fingerprint,updated_at::text AS version FROM plans p WHERE id='plan'`)).rows[0];
   await c.query("UPDATE plans SET path=path WHERE id='plan'");
   await assert.rejects(processPlan("plan","owner",{pool,expectedSourceFingerprint:row.fingerprint,expectedUpdatedAt:row.version}),/already_processing/);
  });
  await t.test("repair claims reject changed source data before overwriting matches",async()=>{
   const fingerprint=(await c.query(`SELECT ${planSourceFingerprintSql()} fingerprint FROM plans p WHERE id='plan'`)).rows[0].fingerprint;
   await c.query("UPDATE plans SET name='Edited',updated_at=updated_at+interval '1 second' WHERE id='plan'");
   await assert.rejects(processPlan("plan","owner",{pool,expectedSourceFingerprint:fingerprint}),/already_processing/);
   assert.equal((await c.query("SELECT name FROM plans WHERE id='plan'")).rows[0].name,"Edited");
  });
  await t.test("missing referenced geometry fails visibly and keeps old goals and matches",async()=>{
   await c.query("UPDATE routes SET path=NULL WHERE id='other'");
   await assert.rejects(processPlan("plan","owner",{pool}),/missing or unavailable geometry/);
   const row=(await c.query("SELECT processing_state,processing_error FROM plans WHERE id='plan'")).rows[0];
   assert.equal(row.processing_state,"failed");assert.match(row.processing_error,/other/);
   assert.equal((await c.query("SELECT count(*)::int n FROM plan_reached_destinations")).rows[0].n,1);
   assert.equal((await c.query("SELECT count(*)::int n FROM plan_destinations")).rows[0].n,1);
  });
 } finally {await c.query("ROLLBACK");await c.query("DISCARD TEMP");c.release();}
});
