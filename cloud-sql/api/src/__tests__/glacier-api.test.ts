import assert from "node:assert/strict";
import { test, mock, afterEach } from "node:test";
import { app } from "../index";
import db from "../db";
import { appRequest } from "./helpers/app-request";

afterEach(()=>mock.restoreAll());
const headers={"X-Peaks-Capabilities":"glaciers-v1","X-Test-User":"glacier-reader"};
const crossings=[{destination_id:"ice",pass_index:0,entered_distance_m:10,exited_distance_m:20},
  {destination_id:"ice",pass_index:1,entered_distance_m:100,exited_distance_m:120}];

test("full glacier detail requires the capability, supports signed-out reads, and keeps facts null",async()=>{
  mock.method(console,"log",()=>{});
  const queries:string[]=[];
  mock.method(db,"query",async(sql:string)=>{
    queries.push(sql);
    if (sql.includes("to_regprocedure")) return {rows:[{ready:true}],rowCount:1};
    return {rows:[{id:"ice",name:"Muir Snowfield",features:["glacier"],type:"region",kind:"snowfield",owner:"peaks",
      glacier:{kind:"snowfield",area_km2:null,head_elevation_m:null,parent_mountain:{id:"rainier",name:"Mount Rainier"}},
      boundary:{type:"MultiPolygon",coordinates:[]},session_count:0,sessions:[],routes:[]}],rowCount:1};
  });
  const old=await appRequest(app,"GET","/api/destinations/ice/glacier");
  assert.equal(old.status,404);assert.equal(queries.length,0);
  const current=await appRequest(app,"GET","/api/destinations/ice/glacier",{"X-Peaks-Capabilities":"glaciers-v1"});
  assert.equal(current.status,200);assert.equal(current.body.glacier.kind,"snowfield");
  assert.equal(current.body.glacier.area_km2,null);assert.equal(current.body.boundary.type,"MultiPolygon");
  assert.equal(current.body.session_count,0);
  assert.match(queries.at(-1)!,/s.user_id=\$2 AND \$2<>''/);
});

test("route and session HTTP JSON retain repeated spans, including a session with no route",async()=>{
  mock.method(db,"query",async(sql:string)=>{
    if (sql.includes("to_regprocedure")) return {rows:[{ready:true}],rowCount:1};
    if (sql.includes("AS glacier_crossings")) return {rows:[{id:"record",session_id:"record",segments:[],owner:"peaks",
      glacier_crossings:crossings,glacier_crossings_status:"complete"}],rowCount:1};
    return {rows:[],rowCount:0};
  });
  const route=await appRequest(app,"GET","/api/routes/record",headers);
  assert.equal(route.status,200);assert.equal(route.body.glacier_crossings.length,2);
  const session=await appRequest(app,"GET","/api/sessions/record/route-facts",headers);
  assert.equal(session.status,200);assert.deepEqual(session.body.segments,[]);
  assert.deepEqual(session.body.glacier_crossings,crossings);
  const denied=await appRequest(app,"GET","/api/sessions/record/route-facts");
  assert.equal(denied.status,401);
});

test("legacy destination detail hides glacier objects while preserving existing lake JSON",async()=>{
  let feature="glacier";
  mock.method(db,"query",async(sql:string)=>sql.includes("information_schema") ? {rows:[{}],rowCount:1}
    : {rows:[{id:"place",features:[feature],boundary:{type:feature==="lake"?"Polygon":"MultiPolygon",coordinates:[]}}],rowCount:1});
  const old=await appRequest(app,"GET","/api/destinations/place",{"X-Test-User":"reader"});
  assert.equal(old.status,404);
  feature="lake";
  const lake=await appRequest(app,"GET","/api/destinations/place",{"X-Test-User":"reader"});
  assert.equal(lake.status,200);assert.equal(lake.body.boundary.type,"Polygon");
});

test("capable destination detail replaces the legacy polygon with the full outline",async()=>{
  const outline={type:"MultiPolygon",coordinates:[[[[0,0],[2,0],[2,2],[0,0]]],[[[3,0],[4,0],[4,1],[3,0]]]]};
  let feature="glacier";
  mock.method(console,"log",()=>{});
  mock.method(db,"query",async(sql:string)=>{
    if (sql.includes("to_regprocedure")) return {rows:[{ready:true}],rowCount:1};
    if (sql.includes("information_schema")) return {rows:[{}],rowCount:1};
    if (sql.includes("FROM destination_glacier_facts gf"))
      return {rows:[{glacier:{kind:"glacier",area_km2:1},boundary:outline}],rowCount:1};
    return {rows:[{id:"place",features:[feature],boundary:{type:"Polygon",coordinates:outline.coordinates[0]}}],rowCount:1};
  });
  const glacier=await appRequest(app,"GET","/api/destinations/place",headers);
  assert.equal(glacier.status,200);assert.deepEqual(glacier.body.boundary,outline);
  assert.equal(glacier.body.glacier.kind,"glacier");
  feature="lake";
  const lake=await appRequest(app,"GET","/api/destinations/place",headers);
  assert.equal(lake.status,200);assert.equal(lake.body.boundary.type,"Polygon");
  assert.equal(lake.body.glacier,undefined);
});
