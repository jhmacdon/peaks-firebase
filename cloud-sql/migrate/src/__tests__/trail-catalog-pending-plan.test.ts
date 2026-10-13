import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { planPendingSegments, type PendingPlanModules } from "../trail-catalog/pending-plan";
import type { ReadyCandidate } from "../trail-catalog/types";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planPilot } from "../trail-catalog-pilot";
import { sha256 } from "../trail-catalog/graph";
import { TERRARIUM_REQUIRED_ATTRIBUTION } from "../lib/terrarium-attribution";
import type { PilotManifest } from "../trail-catalog/types";

const candidate = {
  input: { source: { type: "osm" } },
  points: [{ lat: 47, lng: -121 }, { lat: 47.001, lng: -121 }, { lat: 47.002, lng: -121 }],
  elevatedPoints: [{ lat: 47, lng: -121, ele: 100, dist: 0 }, { lat: 47.001, lng: -121, ele: 120, dist: 111 }, { lat: 47.002, lng: -121, ele: 140, dist: 222 }],
  edges: [{wayId:10,names:["Example Trail"]},{wayId:10,names:["Example Trail"]}],
  requiredCutIndices: [0,2],
  provenance: { source_kind: "openstreetmap", osm_way_ids: [10], osm_way_urls: ["https://www.openstreetmap.org/way/10"] },
} as unknown as ReadyCandidate;

function fixture(kind: "new" | "existing" | "split" = "new", options: { overlap?: string; wrongSource?: boolean; unsafeReuse?: boolean; matcherError?: string } = {}) {
  const queries: string[] = [], reuseLocks: boolean[] = [];
  const client = { async query(sql: string) {
    queries.push(sql);
    assert.ok(/^SELECT\s/.test(sql), `Planner must not issue DML: ${sql}`);
    if (sql.includes("SELECT provenance")) return { rows: [{ provenance: { ...candidate.provenance, osm_way_ids: options.wrongSource ? [99] : [10] } }] };
    assert.match(sql, /s\.provenance->>'source_kind'<>\$3/);
    return { rows: options.overlap ? [{id:options.overlap}] : [] };
  }} as unknown as Pick<PoolClient,"query">;
  const modules: PendingPlanModules = {
    async analyzeRouteSegmentsWithClient(_client, _points, rawOptions) {
      assert.deepEqual(rawOptions,{exactOnly:true,allowExistingSplits:false,requiredCutIndices:[0,2]});
      if (options.matcherError) throw new Error(options.matcherError);
      return {segments:[{type:kind,points:candidate.elevatedPoints,routeStartIndex:0,routeEndIndex:2,...(kind==="existing"?{existingSegmentId:"stored",direction:"reverse" as const}:{})}],splits:[]};
    },
    async existingSegmentIsSafeToReuse(_client, id, _points, direction, _provenance, lock) {
      assert.equal(id,"stored");assert.equal(direction,"reverse");reuseLocks.push(lock===true);return !options.unsafeReuse;
    },
    pointsToLineStringZ: points => `LINESTRING Z(${points.map(point=>`${point.lng} ${point.lat} ${point.ele}`).join(",")})`,
  };
  return {client,modules,queries,reuseLocks};
}

test("dry pending plan issues only SELECT and surfaces cross-source overlap",async()=> {
  const clean=fixture();const plan=await planPendingSegments(clean.client,candidate,{modules:clean.modules});
  assert.equal(plan.segments.length,1);assert.equal(plan.reusedLengthM,0);assert.equal(clean.queries.length,1);
  assert.ok(clean.queries.every(sql=>!sql.includes("FOR UPDATE")));
  for (const overlap of ["same-source-span","cross-source-common-stem"]) {
    const blocked=fixture("new",{overlap});
    await assert.rejects(planPendingSegments(blocked.client,candidate,{modules:blocked.modules}),new RegExp(`existing_source_geometry_requires_review: ${overlap}`));
  }
});
test("dry pending plan exposes matcher splits and exhausted scan budgets",async()=> {
  for (const matcherError of ["existing_segment_split_requires_review:stored","exact_candidate_scan_limit_exceeded:512","exact_candidate_point_limit_exceeded:200000"]) {
    const blocked=fixture("new",{matcherError});
    await assert.rejects(planPendingSegments(blocked.client,candidate,{modules:blocked.modules}),error=>typeof error==="object" && error!==null && "reason" in error && error.reason===matcherError.split(":")[0]);
    assert.equal(blocked.queries.length,0);
  }
  const split=fixture("split");await assert.rejects(planPendingSegments(split.client,candidate,{modules:split.modules}),/existing_segment_split_requires_review/);
});
test("existing span requires exact source interval and XYZ/profile/stats proof",async()=> {
  const wrong=fixture("existing",{wrongSource:true});
  await assert.rejects(planPendingSegments(wrong.client,candidate,{modules:wrong.modules}),/existing_segment_source_interval_mismatch/);
  assert.equal(wrong.reuseLocks.length,0);
  const unsafe=fixture("existing",{unsafeReuse:true});
  await assert.rejects(planPendingSegments(unsafe.client,candidate,{modules:unsafe.modules}),/existing_segment_reuse_rejected/);
  const safe=fixture("existing");const plan=await planPendingSegments(safe.client,candidate,{modules:safe.modules});
  assert.equal(plan.reusedLengthM,222);assert.deepEqual(safe.reuseLocks,[false]);
  assert.ok(safe.queries.every(sql=>!sql.includes("FOR UPDATE")));
});
test("writer preflight repeats the same reuse proof with row locks",async()=> {
  const locked=fixture("existing");await planPendingSegments(locked.client,candidate,{modules:locked.modules,lockExisting:true});
  assert.deepEqual(locked.reuseLocks,[true]);assert.ok(locked.queries[0].endsWith("FOR UPDATE"));
});

test("planPilot dry uses the real matcher and withholds split or overlapping candidates without DML",async()=> {
  const directory=mkdtempSync(join(tmpdir(),"peaks-pending-plan-"));
  const nodes=Array.from({length:5},(_,i)=>({type:"node",id:i+1,lat:47+i*0.001,lon:-121}));
  const source=JSON.stringify({elements:[...nodes,{type:"way",id:10,nodes:[1,2,3,4,5],tags:{highway:"path",name:"Fixture Lake Trail"}},{type:"relation",id:99,members:[{type:"way",ref:10}],tags:{type:"route",route:"hiking",name:"Fixture Lake Trail"}}]});
  const elevation=JSON.stringify({points:nodes.slice(1,4).map((node,i)=>({lat:node.lat,lng:node.lon,ele:120+i*20})),lineage:{source:"AWS Open Data Terrain Tiles (Mapzen Terrarium z14)",sourceUrl:"https://registry.opendata.aws/terrain-tiles/",licenseUrl:"https://github.com/tilezen/joerd/blob/master/docs/attribution.md",attribution:TERRARIUM_REQUIRED_ATTRIBUTION,retrievedAt:"2026-10-01T00:00:00Z",profile:"terrain"}});
  writeFileSync(join(directory,"source.json"),source);writeFileSync(join(directory,"elevation.json"),elevation);
  const manifest:PilotManifest={version:1,batchKey:"dry-planner",candidates:[{sourceKey:"dry-planner:lake",name:"Fixture Lake Trail",kind:"destination",trailheadId:"head",objectiveId:"lake",startNodeId:2,endNodeId:4,source:{type:"osm",relationId:99,snapshots:[{path:"source.json",sha256:sha256(source),url:"https://api.openstreetmap.org/api/0.6/relation/99/full.json",retrievedAt:"2026-10-01T00:00:00Z"}]},elevation:{path:"elevation.json",sha256:sha256(elevation)}}]};
  try {
    for (const blocker of ["split","overlap"] as const) {
      const queries:string[]=[];
      const client={async query(sql:string) {
        queries.push(sql);assert.match(sql,/^(SELECT|WITH)\s/);assert.ok(!sql.includes("FOR UPDATE"));
        if (sql.includes("FROM destinations WHERE id=ANY")) return {rows:[{id:"head",name:"Fixture Trailhead",features:["trailhead"],lat:47.001,lng:-121,boundary:null,stateCode:"WA",countryCode:"US"},{id:"lake",name:"Fixture Lake",features:["lake"],lat:47.003,lng:-121,boundary:null,stateCode:"WA",countryCode:"US"}]};
        if (sql.includes("to_regclass")) return {rows:[{exists:true}]};
        if (sql.includes("exact_candidate_ids")) return {rows:blocker==="split"?[{id:"old-long-span"}]:[]};
        if (sql.includes("candidate_sizes")) return {rows:[{id:"old-long-span",name:"Old Shared Trail",distance:444,point_count:5,total_points:5,geojson:JSON.stringify({type:"LineString",coordinates:nodes.map((node,i)=>[node.lon,node.lat,100+i*20])})}]};
        if (sql.startsWith("SELECT s.id FROM segments s WHERE")) return {rows:[{id:"existing-common-stem"}]};
        return {rows:[]};
      }} as unknown as Pick<PoolClient,"query">;
      const plan=await planPilot(client,manifest,directory);
      assert.equal(plan.reports.length,1);assert.equal(plan.reports[0].pendingReady,false);
      assert.equal(plan.reports[0].pendingBlocker,blocker==="split"?"existing_segment_split_requires_review":"existing_source_geometry_requires_review");
      assert.equal(plan.artifacts.size,0);assert.ok(queries.length>3);
    }
  } finally {rmSync(directory,{recursive:true,force:true});}
});
