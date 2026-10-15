import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { perfCheckMatching } from "../matching-perf";

test("perf check runs the real SELECTs only inside read-only transactions", async () => {
  const calls:string[]=[];
  const events:Array<Record<string,unknown>>=[];
  const client={query:async (sql:string)=>{
    calls.push(sql);
    if(sql.includes("AS has_objective")) return {rows:[
      {route_id:"dc",length_m:11529,covered_m:9615,covered_intervals:[[0,0.834]],objective_reached:true,covered_geometry:"01"},
      {route_id:"muir",length_m:6504,covered_m:5925,covered_intervals:[[0,0.911]],objective_reached:true,covered_geometry:"02"},
    ]};
    if(sql.includes("SELECT r.id FROM routes")) return {rows:[{id:"dc"},{id:"muir"}]};
    if(sql.includes("HAVING COALESCE")) return {rows:[{route_id:"muir"}]};
    return {rows:[]};
  }};
  assert.equal(await perfCheckMatching(client as never,["s"],e=>events.push(e)),0);
  assert.equal(calls[0],"BEGIN READ ONLY");
  assert.equal(calls[1],"SET LOCAL statement_timeout = '30s'");
  assert.equal(calls[calls.length-1],"ROLLBACK");
  for(const sql of calls.slice(2,-1)) {
    assert.match(sql,/^WITH/);
    assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE)\b/);
  }
  assert.equal(events.find(e=>"primary" in e)?.primary,"dc");
  assert.ok(events.some(e=>e.step==="segment_select_sql" && typeof e.sql==="string"));
  const script=readFileSync(resolve(__dirname,"../../scripts/perf-check-matching.ts"),"utf8");
  assert.match(script,/process.env.DATABASE_URL/);
  assert.doesNotMatch(script,/processSession|buildSessionSegmentCoverageSql|upsertSessionRouteCoverage/);
});

test("a timed-out perf query rolls back before the next session", async () => {
  const calls:string[]=[];
  let timedOut=false;
  const client={query:async(sql:string)=>{
    calls.push(sql);
    if(sql.includes("SELECT r.id FROM routes")&&!timedOut) {timedOut=true;throw new Error("statement timeout");}
    return {rows:[]};
  }};
  assert.equal(await perfCheckMatching(client as never,["slow","next"],()=>{}),1);
  assert.equal(calls.filter(sql=>sql==="BEGIN READ ONLY").length,2);
  assert.equal(calls.filter(sql=>sql==="ROLLBACK").length,2);
  const firstRollback=calls.indexOf("ROLLBACK");
  assert.equal(calls[firstRollback+1],"BEGIN READ ONLY");
});
