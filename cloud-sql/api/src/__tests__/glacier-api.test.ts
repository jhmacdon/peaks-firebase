import assert from "node:assert/strict";
import { test, mock, afterEach } from "node:test";
import { app } from "../index";
import db from "../db";
import { appRequest } from "./helpers/app-request";

afterEach(()=>mock.restoreAll());
const headers={"X-Peaks-Capabilities":"glaciers-v1","X-Test-User":"glacier-reader"};
const crossings=[{destination_id:"ice",name:"Ice",kind:"glacier",pass_index:0,entered_distance_m:10,exited_distance_m:20,
  min_elevation_m:null,max_elevation_m:null},
  {destination_id:"ice",name:"Ice",kind:"glacier",pass_index:1,entered_distance_m:100,exited_distance_m:120,
    min_elevation_m:null,max_elevation_m:null}];
const crossingPaths=["/api/routes/record","/api/routes/record/landmarks","/api/sessions/record","/api/sessions/record/route-facts"];

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

test("all four route/session responses add display stretches and retain exact repeated spans",async()=>{
  mock.method(db,"query",async(sql:string)=>{
    if (sql.includes("to_regprocedure")) return {rows:[{ready:true}],rowCount:1};
    if (sql.includes("AS glacier_crossings")) return {rows:[{id:"record",session_id:"record",segments:[],owner:"peaks",
      version:"v",total_vertices:2,last_vertex:2,end_m:120,items:[],
      glacier_crossings:crossings,glacier_crossings_status:"complete"}],rowCount:1};
    return {rows:[],rowCount:0};
  });
  for (const path of crossingPaths) {
    const response=await appRequest(app,"GET",path,headers);
    assert.equal(response.status,200,path);
    assert.deepEqual(response.body.glacier_crossings,crossings,path);
    assert.deepEqual(response.body.glacier_stretches,[{kind:"glacier",
      destinations:[{id:"ice",name:"Ice",kind:"glacier",share:1}],
      entered_distance_m:10,exited_distance_m:120,min_elevation_m:null,max_elevation_m:null,crossing_indexes:[0,1]}],path);
    if (path.includes("/sessions/")) assert.deepEqual(response.body.segments,[]);
  }
  const denied=await appRequest(app,"GET","/api/sessions/record/route-facts");
  assert.equal(denied.status,401);
});

test("all four route/session responses omit stretches and crossings for old callers",async()=>{
  mock.method(db,"query",async()=>({rows:[{id:"record",session_id:"record",segments:[],owner:"peaks",
    version:"v",total_vertices:2,last_vertex:2,end_m:120,items:[],
    glacier_crossings:crossings,glacier_crossings_status:"complete"}],rowCount:1}));
  for (const path of crossingPaths) {
    const response=await appRequest(app,"GET",path,{"X-Test-User":"glacier-reader"});
    assert.equal(response.status,200,path);
    assert.equal(response.body.glacier_crossings,undefined,path);
    assert.equal(response.body.glacier_stretches,undefined,path);
    assert.equal(response.body.glacier_crossings_status,undefined,path);
  }
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

test("capable summary rows gain kind and parent after their query; detail and old readers are unchanged",async()=>{
  const queries:string[]=[];
  mock.method(db,"query",async(sql:string,values?:unknown[])=>{
    queries.push(sql);
    if (sql.includes("to_regprocedure")) return {rows:[{ready:true}],rowCount:1};
    if (sql.includes("FROM destination_glacier_facts gf JOIN destinations pm")) {
      assert.deepEqual(values,[["ice"],"glacier-reader"]);
      return {rows:[{id:"ice",glacier:{kind:"snowfield",parent_mountain:{id:"peak",name:"Parent Peak"}}}],rowCount:1};
    }
    return {rows:[{id:"ice",name:"Ice",features:["glacier"]},{id:"lake",name:"Lake",features:["lake"]}],rowCount:2};
  });
  const nearby=await appRequest(app,"GET","/api/destinations/viewport?minLat=0&maxLat=1&minLng=0&maxLng=1",headers);
  assert.equal(nearby.status,200);
  assert.deepEqual(nearby.body[0].glacier,{kind:"snowfield",parent_mountain:{id:"peak",name:"Parent Peak"}});
  assert.equal(nearby.body[1].glacier,undefined);
  const lookup=queries.findIndex(q=>q.includes("FROM destination_glacier_facts gf JOIN destinations pm"));
  assert.ok(lookup>queries.findIndex(q=>q.includes("ST_MakeEnvelope")),"the lookup runs after the limited row query");
  queries.length=0;
  const old=await appRequest(app,"GET","/api/destinations/viewport?minLat=0&maxLat=1&minLng=0&maxLng=1",{"X-Test-User":"glacier-reader"});
  assert.equal(old.body.length,1);assert.equal(old.body[0].glacier,undefined);
  assert.ok(!queries.some(q=>q.includes("FROM destination_glacier_facts gf JOIN destinations pm")));
});

test("complete-empty, pending and unavailable crossings all yield empty stretches on all four responses",async()=>{
  let now=Date.now()+1_000_000;
  mock.method(Date,"now",()=>now);
  let status="complete";
  mock.method(db,"query",async(sql:string)=>{
    if (sql.includes("to_regprocedure")) return {rows:[{ready:status!=="unavailable"}],rowCount:1};
    return {rows:[{id:"record",session_id:"record",segments:[],owner:"peaks",version:"v",
      total_vertices:2,last_vertex:2,end_m:120,items:[],
      glacier_crossings:[],glacier_crossings_status:status}],rowCount:1};
  });
  for (status of ["complete","pending","unavailable"]) {
    now+=120_000;
    for (const path of crossingPaths) {
      const response=await appRequest(app,"GET",path,headers);
      assert.equal(response.status,200,path);
      assert.deepEqual(response.body.glacier_crossings,[],path);
      assert.deepEqual(response.body.glacier_stretches,[],path);
      assert.equal(response.body.glacier_crossings_status,status,path);
    }
  }
});
