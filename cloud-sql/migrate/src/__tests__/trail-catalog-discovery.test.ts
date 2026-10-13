import test from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { mkdtempSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverCatalogCandidates,loadDiscoveryPlaces,validateDiscoveryConfig,type DiscoveryConfig } from "../trail-catalog/discovery";
import { buildCandidate } from "../trail-catalog/candidate-source";
import { isApprovedOsmSnapshotUrl,loadSourceSnapshots } from "../trail-catalog/sources";
import { sha256 } from "../trail-catalog/graph";
import { parseDiscoveryArgs,rebaseDiscoveryManifest } from "../trail-catalog-discover";
import { sourceCycles } from "../trail-catalog/source-cycles";
import { allowedWay } from "../trail-catalog/graph";
import { proveOsmSegmentSource } from "../osm-segment-source-proof";
import type { CatalogPlace } from "../trail-catalog/types";

const head:CatalogPlace={id:"head",name:"Example Trailhead",features:["trailhead"],lat:47,lng:-121,stateCode:"WA",countryCode:"US",boundary:null};
const peak:CatalogPlace={...head,id:"peak",name:"Example Peak",features:["summit"],lng:-120.998};
function snapshot(){return {elements:[
  {type:"node",id:1,lat:47,lon:-121},{type:"node",id:2,lat:47,lon:-120.999},{type:"node",id:3,lat:47,lon:-120.998},
  {type:"way",id:10,nodes:[1,2,3],tags:{highway:"path",name:"Example Trail"}},
  {type:"relation",id:99,members:[{type:"way",ref:10}],tags:{type:"route",route:"hiking",name:"Example Trail"}},
]};}
const config:DiscoveryConfig={version:1,batchKey:"discovery-test",bbox:{west:-121.1,east:-120.9,south:46.9,north:47.1},bundles:[{id:"example",source:{type:"osm",snapshots:[{path:"source.json",sha256:"a".repeat(64),url:"https://api.openstreetmap.org/api/0.6/map.json?bbox=-121.1,46.9,-120.9,47.1",retrievedAt:"2026-10-01T00:00:00Z"}]}}]};
const discover=(places:CatalogPlace[]=[head,peak],body:unknown=snapshot(),options=config)=>discoverCatalogCandidates(options,[{bundle:options.bundles[0],snapshots:[body]}],places);

test("discovery enumerates catalog objectives and named relations, with replayable concrete source endpoints",()=>{
  const result=discover();
  assert.equal(result.complete,true);assert.equal(result.manifest.candidates.length,1);
  assert.equal(result.records.filter(record=>record.mode==="objective").length,1);
  assert.equal(result.records.filter(record=>record.mode==="relation").length,1);
  assert.ok(result.records.some(record=>record.reason==="duplicate_trailhead_objective"&&record.keptSourceKey));
  const candidate=result.manifest.candidates[0];assert.equal(candidate.startNodeId,1);assert.equal(candidate.endNodeId,3);
  assert.equal(buildCandidate(candidate,[snapshot()],{trailhead:head,objective:peak}).points.length,3);
});
test("review tolerance cannot shorten a point objective, while a real lake footprint permits the first shoreline vertex",()=>{
  const lake={...peak,id:"lake",name:"Example Lake",features:["lake"]};
  assert.equal(discover([head,lake]).manifest.candidates[0].endNodeId,3);
  const shoreline={...lake,boundary:{type:"Polygon" as const,coordinates:[[[-120.9991,46.999],[-120.997,46.999],[-120.997,47.001],[-120.9991,47.001],[-120.9991,46.999]]]}};
  const result=discover([head,shoreline]);
  const objective=result.records.find(record=>record.mode==="objective")!;
  const candidate=result.manifest.candidates.find(candidate=>candidate.sourceKey===objective.sourceKey);
  assert.ok(candidate);assert.equal(candidate.endNodeId,2);
});
test("standalone destination evidence preserves catalog names without an optional name override",()=>{
  const lake={...peak,id:"lake",name:"Example Lake",features:["lake"],lng:-120.999};
  const reviewed={...config,evidence:[{bundleId:"example",trailheadId:head.id,objectiveId:lake.id,
    commonDestinationEvidence:{objectiveId:lake.id,name:lake.name,publisher:"usfs" as const,sourceUrl:"https://www.fs.usda.gov/trail/example",checkedAt:"2026-10-01T00:00:00Z",note:"Official standalone lake hike.",attestation:"standalone_named_hike" as const}}]};
  assert.ok(discover([head,lake,peak]).records.some(row=>row.objectiveId===lake.id&&row.reason==="strict_prefix_without_common_destination_attestation"));
  const result=discover([head,lake,peak],snapshot(),reviewed);
  const candidate=result.manifest.candidates.find(candidate=>candidate.objectiveId===lake.id);
  assert.ok(candidate);assert.equal(candidate.name,"Example Lake via Example Trail");
  assert.equal(candidate.commonDestinationEvidence?.objectiveId,lake.id);
  assert.ok(!result.records.some(row=>row.reason==="candidate_discovery_failed"));
});
test("discovery keeps denied access and incomplete relation sources visible",()=>{
  const denied=snapshot();denied.elements.find(element=>element.type==="way")!.tags={highway:"path",access:"no"} as never;
  assert.equal(discover([head,peak],denied).manifest.candidates.length,0);
  const partial=snapshot();partial.elements.find(element=>element.type==="relation")!.members!.push({type:"way",ref:11});
  assert.ok(discover([head,peak],partial).records.some(record=>record.mode==="relation"&&record.reason==="relation_source_incomplete"));
});
test("an exhausted graph-search budget withholds the whole manifest",()=>{
  const source=snapshot();source.elements.push({...source.elements.find(element=>element.type==="relation")!,id:100});
  const result=discover([head,peak],source,{...config,limits:{attempts:1}});
  assert.equal(result.complete,false);assert.deepEqual(result.manifest.candidates,[]);
  assert.ok(result.records.some(record=>record.reason==="discovery_attempt_limit"));
  assert.ok(result.records.every(record=>record.outcome==="rejected"));
});
test("landforms and campsites require explicit reviewed pass or cluster evidence",()=>{
  for (const [feature,reason] of [["landform","pass_source_evidence_missing"],["campsite","campsite_cluster_evidence_missing"]]) {
    const objective={...peak,features:[feature]};
    assert.ok(discover([head,objective]).records.some(record=>record.mode==="objective"&&record.reason===reason));
  }
  const pass={...peak,name:"Example Pass",features:["landform"]};
  const reviewed={...config,objectiveTypeEvidence:[{objectiveId:pass.id,type:"named_pass" as const,name:pass.name,sourceUrl:"https://www.fs.usda.gov/trail/example",checkedAt:"2026-10-01T00:00:00Z",note:"Official pass identity reviewed."}]};
  assert.equal(discover([head,pass],snapshot(),reviewed).manifest.candidates.length,1);
});
test("source-closed loops are discovered without inventing a closing edge",()=>{
  const source={elements:[{type:"node",id:1,lat:47,lon:-121},{type:"node",id:2,lat:47,lon:-120.99},{type:"node",id:3,lat:47.01,lon:-120.99},{type:"node",id:4,lat:47.01,lon:-121},
    {type:"way",id:10,nodes:[1,2,3,4,1],tags:{highway:"path",name:"Example Loop"}},{type:"relation",id:99,members:[{type:"way",ref:10}],tags:{type:"route",route:"hiking",name:"Example Loop"}}]};
  const result=discover([head],source);assert.equal(result.manifest.candidates.length,1);assert.equal(result.manifest.candidates[0].kind,"loop");
  source.elements.find(element=>element.type==="way")!.nodes=[1,2,3,4];
  assert.equal(discover([head],source).manifest.candidates.length,0);
});
test("raw OSM trailheads remain source-bound proposals, with no inferred catalog identity",()=>{
  const source=snapshot();Object.assign(source.elements[0],{tags:{highway:"trailhead",name:"Example Trailhead"}});
  const record=discover([head,peak],source).records.find(record=>record.sourceNodeId===1)!;
  assert.equal(record.reason,"raw_trailhead_catalog_binding_required");assert.deepEqual(record.matchingCatalogIds,[head.id]);assert.deepEqual(record.proposedPoint,{lat:47,lng:-121});
});
test("catalog enumeration fails on truncation and never casts a nonexistent pass enum",async()=>{
  const queries:string[]=[];
  const client={query:async(sql:string)=>{queries.push(sql);return {rows:sql.includes("AND features @>")?Array.from({length:21},()=>head):[]};}} as unknown as PoolClient;
  await assert.rejects(()=>loadDiscoveryPlaces(client,config),/discovery_inventory_limit/);
  assert.ok(queries.every(sql=>!sql.includes("'pass'")));
  assert.throws(()=>validateDiscoveryConfig({...config,bbox:{west:-121,east:-120,south:47} as never}),/bbox/);
});
test("OSM map snapshots require one bounded bbox and reject partial API responses",()=>{
  const url=config.bundles[0].source.snapshots[0].url;
  assert.equal(isApprovedOsmSnapshotUrl(url),true);
  for (const invalid of [url+"&anything=1",url+"&bbox=0,0,1,1",url.replace("-121.1,46.9,-120.9,47.1","-125,45,-116,50"),url+"#fragment",url.replace("map.json","user/details.json")]) assert.equal(isApprovedOsmSnapshotUrl(invalid),false);
  const dir=mkdtempSync(join(tmpdir(),"peaks-discovery-source-"));
  try {const body=JSON.stringify({...snapshot(),error:"incomplete API result"});writeFileSync(join(dir,"source.json"),body);assert.throws(()=>loadSourceSnapshots([{...config.bundles[0].source.snapshots[0],sha256:sha256(body)}],dir),/incomplete_osm_source_response/);}finally{rmSync(dir,{recursive:true,force:true});}
});
test("discovery CLI is dry-only and rebases immutable source paths for replay",()=>{
  assert.throws(()=>parseDiscoveryArgs(["--config","a","--manifest","b","--report","c","--apply"]),/Usage/);
  assert.deepEqual(parseDiscoveryArgs(["--config","a","--manifest","b","--report","c"]),{config:"a",manifest:"b",report:"c"});
  const result=discover();const rebased=rebaseDiscoveryManifest(result.manifest,"/tmp/config","/tmp/output");
  assert.equal(rebased.candidates[0].source.snapshots[0].path,"../config/source.json");
});
test("an isolated nearer vertex cannot mask reachable objective contact",()=>{
  const source=snapshot();source.elements.find(element=>element.id===3)!.lat=47.00001;
  source.elements.push({type:"node",id:4,lat:47,lon:-120.998},{type:"node",id:5,lat:47,lon:-120.997},
    {type:"way",id:11,nodes:[4,5],tags:{highway:"path",name:"Isolated Trail"}});
  const result=discover([head,peak],source);
  assert.equal(result.complete,true);assert.equal(result.manifest.candidates[0].endNodeId,3);
});
test("an independent identity does not promote an unrelated hiking relation",()=>{
  const source=snapshot();source.elements.find(element=>element.type==="relation")!.members=[{type:"way",ref:11}];
  source.elements.push({type:"node",id:4,lat:47.01,lon:-121},{type:"node",id:5,lat:47.01,lon:-120.999},
    {type:"way",id:11,nodes:[4,5],tags:{highway:"path",name:"Unrelated Trail"}});
  const evidence={bundleId:"example",trailheadId:head.id,objectiveId:peak.id,name:"Example Peak Trail",identity:{name:"Example Peak Trail",publisher:"wta" as const,sourceUrl:"https://www.wta.org/go-hiking/hikes/example"}};
  const result=discover([head,peak],source,{...config,evidence:[evidence]});
  const candidate=result.manifest.candidates[0];
  assert.equal(candidate.source.relationId,undefined);
  assert.equal(result.records.find(row=>row.outcome==="admitted")!.sourceAttestation,`wta:${evidence.identity.sourceUrl}`);
  // Replay also downgrades a caller-supplied relation whose edges do not attest the path.
  const replay=buildCandidate({...candidate,source:{...candidate.source,relationId:99}},[source],{trailhead:head,objective:peak});
  assert.equal(replay.input.source.relationId,undefined);assert.ok(replay.attestation.startsWith("wta:"));
});
test("a cycle survives a spur within the same source way and keeps exact replay nodes",()=>{
  const source={elements:[{type:"node",id:1,lat:47,lon:-121},{type:"node",id:2,lat:47,lon:-120.98},
    {type:"node",id:3,lat:47.02,lon:-120.98},{type:"node",id:4,lat:47.02,lon:-121},{type:"node",id:5,lat:46.99,lon:-121},
    {type:"way",id:10,nodes:[5,1,2,3,4,1],tags:{highway:"path",name:"Example Loop"}},
    {type:"relation",id:99,members:[{type:"way",ref:10}],tags:{type:"route",route:"hiking",name:"Example Loop"}}]};
  const result=discover([head],source),candidate=result.manifest.candidates[0];
  assert.equal(candidate.kind,"loop");assert.deepEqual(candidate.loopNodeIds,[1,2,3,4,1]);
  assert.equal(buildCandidate(candidate,[source],{trailhead:head}).points.length,5);
  assert.throws(()=>buildCandidate({...candidate,loopNodeIds:[1,3,4,1]},[source],{trailhead:head}),/loop_source_edge_missing/);
});
test("cycle enumeration retains distinct cycles and fails instead of truncating dense sources",()=>{
  const graph=new Map<string,Set<string>>();
  const edge=(a:string,b:string)=>{graph.set(a,new Set([...(graph.get(a)??[]),b]));graph.set(b,new Set([...(graph.get(b)??[]),a]));};
  for (let a=0;a<4;a++) for (let b=a+1;b<4;b++) edge(String(a),String(b));
  assert.equal(sourceCycles(graph).length,7);
  for (let a=0;a<9;a++) for (let b=a+1;b<9;b++) edge(String(a),String(b));
  assert.throws(()=>sourceCycles(graph),/discovery_cycle_(inventory|search)_limit/);
  const source=snapshot();source.elements=[];
  for (let id=1;id<=9;id++) source.elements.push({type:"node",id,lat:47+id*0.0001,lon:-121});
  let id=100;
  for (let a=1;a<=9;a++) for (let b=a+1;b<=9;b++) source.elements.push({type:"way",id:id++,nodes:[a,b],tags:{highway:"path",name:"Dense Trail"}});
  const result=discover([head,peak],source);
  assert.equal(result.complete,false);assert.deepEqual(result.manifest.candidates,[]);
  assert.ok(result.records.every(record=>record.outcome==="rejected"));
});
test("mapped steps keep exact source proof, access exclusions and terrain review",()=>{
  const source=snapshot();source.elements.find(element=>element.type==="way")!.tags={highway:"steps",name:"Example Trail"} as never;
  const candidate=discover([head,peak],source).manifest.candidates[0];
  const built=buildCandidate(candidate,[source],{trailhead:head,objective:peak});
  const proof=proveOsmSegmentSource(built.points,built.edges.filter(edge=>"wayId" in edge).map((edge,i)=>({...edge,start:built.points[i],end:built.points[i+1]})),{strictMappedGeometry:true});
  assert.deepEqual(proof.errors,[]);assert.deepEqual(proof.usedWayIds,[10]);
  const denied:Record<string,string>[]=[{access:"no"},{access:"private"},{foot:"no"},{foot:"private"},{foot:"discouraged"}];
  for (const tags of denied) assert.equal(allowedWay({tags:{highway:"steps",...tags}}),false);
  source.elements.find(element=>element.type==="way")!.tags={highway:"steps",name:"Example Trail",sac_scale:"alpine_hiking"} as never;
  assert.ok(discover([head,peak],source).records.some(row=>row.reason==="terrain_review_required"));
});
