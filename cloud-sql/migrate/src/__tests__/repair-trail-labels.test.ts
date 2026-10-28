import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { LabelPlan, repairSql, snapshotSql, validatePlan } from "../repair-trail-labels";

const plan = (): LabelPlan => ({version:1,reviewed_by:"reviewer",changes:[{
  id:"s1",before:"Old trail",after:"Glacier Crossing",stable_hash:"a".repeat(32),
  links:[{route_id:"r1",ordinal:0,direction:"forward"}],reason:"Unnamed source polygon",evidence:["source.geojson#way/1"],
}]});

test("requires a bounded reviewed plan, unique targets, links and backup",()=>{
  assert.throws(()=>validatePlan({...plan(),reviewed_by:""}));
  assert.throws(()=>validatePlan({...plan(),changes:[]}));
  assert.throws(()=>validatePlan({...plan(),changes:Array(1001).fill(plan().changes[0])}));
  assert.throws(()=>validatePlan({...plan(),changes:Array(2).fill(plan().changes[0])}));
  for (const edit of [{stable_hash:""},{links:[]},{evidence:[]},{after:""},{after:"Old trail"}]) {
    const p=plan(); Object.assign(p.changes[0],edit); assert.throws(()=>validatePlan(p));
  }
  assert.throws(()=>repairSql(plan(),true));
  assert.match(repairSql(plan(),false),/IF false AND current_label/);
  assert.match(repairSql(plan(),true,"123"),/IF true AND current_label/);
});

test("escapes apostrophes and dollar delimiters without changing the target scope",()=>{
  const p=plan();p.changes[0].after="St. Mary's $repair$ Crossing";
  const sql=repairSql(p,true,"123");
  assert.match(sql,/St\. Mary''s \$repair\$ Crossing/);
  assert.match(sql,/DO \$repairx\$/);
  assert.throws(()=>snapshotSql(["s1'); DELETE FROM segments; --"]));
});

const url=process.env.TEST_DATABASE_URL;
test("database: atomic labels, idempotency, drift and sharing guards",{skip:!url},async()=>{
  if (!new URL(url!).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must end in _test");
  const db=new Client({connectionString:url});await db.connect();
  const run=(sql:string)=>db.query(sql.replace(/^\\set.*\n/m,""));
  try {
    await db.query(`CREATE TEMP TABLE segments(id text PRIMARY KEY,display_name text,name text,trail_names text[],kind text,distance float8,path text,updated_at timestamptz);
      CREATE TEMP TABLE routes(id text PRIMARY KEY,owner text,status text);
      CREATE TEMP TABLE route_segments(segment_id text REFERENCES segments(id),route_id text REFERENCES routes(id),ordinal int,direction text);
      CREATE TEMP TABLE trail_catalog_review_jobs(route_id text,state text);
      INSERT INTO segments VALUES ('s1','Old trail','Source trail',ARRAY['Source trail'],'glacier',52.3,'unchanged',now()),
        ('s2','Other trail','Other trail',ARRAY['Other trail'],'trail',11.5,'unchanged',now());
      INSERT INTO routes VALUES ('r1','peaks','active'),('r2','peaks','pending');
      INSERT INTO route_segments VALUES ('s1','r1',0,'forward'),('s2','r1',1,'reverse');`);
    const snapshot=async()=> (await db.query(snapshotSql(["s1","s2"]))).rows.map(row=>row.jsonb_build_object);
    const initial=await snapshot();
    const p=plan();p.changes[0].stable_hash=initial[0].stable_hash;
    await run(repairSql(p,false)); assert.equal((await snapshot())[0].display_name,"Old trail");
    await run(repairSql(p,true,"123"));
    await run(repairSql(p,true,"123"));
    const after=await snapshot();assert.equal(after[0].display_name,"Glacier Crossing");assert.equal(after[0].stable_hash,initial[0].stable_hash);
    const bad=plan();bad.changes[0].before="Glacier Crossing";bad.changes[0].after="New label";bad.changes[0].stable_hash=initial[0].stable_hash;
    bad.changes.push({...bad.changes[0],id:"s2",before:"Other trail",stable_hash:"f".repeat(32),links:[{route_id:"r1",ordinal:1,direction:"reverse"}]});
    await assert.rejects(run(repairSql(bad,true,"123")),/Segment changed/);await db.query("ROLLBACK");
    assert.equal((await snapshot())[0].display_name,"Glacier Crossing","earlier updates must roll back with a later failure");
    await db.query("INSERT INTO route_segments VALUES ('s1','r2',2,'reverse')");
    await assert.rejects(run(repairSql(p,true,"123")),/Route links changed/);await db.query("ROLLBACK");
    p.changes[0].links.push({route_id:"r2",ordinal:2,direction:"reverse"});
    await db.query("UPDATE routes SET owner='private-user' WHERE id='r2'");
    await assert.rejects(run(repairSql(p,true,"123")),/outside the reviewed catalog scope/);await db.query("ROLLBACK");
    await db.query("UPDATE routes SET owner='peaks' WHERE id='r2'; UPDATE segments SET path='changed' WHERE id='s1'");
    await assert.rejects(run(repairSql(p,true,"123")),/Segment changed/);await db.query("ROLLBACK");
    await db.query("UPDATE segments SET path='unchanged',display_name='A new review' WHERE id='s1'");
    await assert.rejects(run(repairSql(p,true,"123")),/Label changed/);await db.query("ROLLBACK");
    await db.query("UPDATE segments SET display_name='Glacier Crossing' WHERE id='s1'; UPDATE routes SET status='superseded' WHERE id='r2'");
    await run(repairSql(p,true,"123"));
    await db.query(`CREATE FUNCTION pg_temp.rewrite_label() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.display_name='Trigger target' THEN NEW.display_name='Unexpected'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_rewrite BEFORE UPDATE ON segments FOR EACH ROW EXECUTE FUNCTION pg_temp.rewrite_label();`);
    p.changes[0].before="Glacier Crossing";p.changes[0].after="Trigger target";
    await assert.rejects(run(repairSql(p,true,"123")),/changed by a trigger/);await db.query("ROLLBACK");
    assert.equal((await snapshot())[0].display_name,"Glacier Crossing");
  } finally {await db.end();}
});
