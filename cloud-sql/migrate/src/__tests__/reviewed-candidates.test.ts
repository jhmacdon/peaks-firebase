import assert from "node:assert/strict";
import test from "node:test";
import { chooseCatalogCandidates, isStrictCandidatePrefix } from "../trail-catalog/reviewed-candidates";
import type { BuiltCandidate, CatalogPlace, PilotCandidateInput } from "../trail-catalog/types";

const place=(id:string,name:string):CatalogPlace=>({id,name,lat:47,lng:-121,features:["summit"],countryCode:"US",stateCode:"WA"});
function candidate(key:string,objectiveId:string,count:number,options:Partial<PilotCandidateInput>={}):BuiltCandidate {
  const trailhead={...place(options.trailheadId??"head","Example Trailhead"),features:["trailhead"]};
  const objective=place(objectiveId,objectiveId==="lake"?"Ingalls Lake":objectiveId==="mailbox"?"Mailbox Peak":`Peak ${objectiveId}`);
  const input:PilotCandidateInput={sourceKey:key,name:`Reviewed ${objective.name}`,kind:"summit",trailheadId:trailhead.id,objectiveId,
    source:{type:"osm",relationId:99,snapshots:[]},...options};
  const points=Array.from({length:count},(_,i)=>({lat:47+i*0.0001,lng:-121}));
  return {input,trailhead,objective,endTrailhead:null,points,nodeIds:points.map((_,i)=>i),
    edges:points.slice(1).map((_,i)=>({wayId:10,startNodeId:i,endNodeId:i+1,names:["Ingalls Way","1390"]})),
    requiredCutIndices:[0,count-1],usedWayIds:[10],distanceM:count*10,mappedFraction:1,sourceHashes:[],geometryHash:key,
    attestation:"osm-relation:99",attestedRouteNames:[],shape:"out_and_back"};
}
const lakeEvidence:PilotCandidateInput["commonDestinationEvidence"]={objectiveId:"lake",name:"Lake Ingalls",publisher:"wta",
  sourceUrl:"https://www.wta.org/go-hiking/hikes/lake-ingalls",checkedAt:"2026-10-13T00:00:00Z",attestation:"standalone_named_hike",
  note:"The named guide describes the lake as a standalone hike, including the lake turnaround."};

test("a named objective alone does not preserve a strict prefix; every drop names its final keeper",()=>{
  const a=candidate("a","a",2),b=candidate("b","b",3),c=candidate("c","c",5);
  const result=chooseCatalogCandidates([b,c,a]);
  assert.deepEqual(result.kept.map(c=>c.input.sourceKey),["c"]);
  assert.deepEqual(result.rejected,[{sourceKey:"a",reason:"strict_prefix_without_common_destination_attestation",keptSourceKey:"c"},
    {sourceKey:"b",reason:"strict_prefix_without_common_destination_attestation",keptSourceKey:"c"}]);
});
test("Ingalls Lake's explicit standalone-hike evidence preserves it beside the longer summit route",()=>{
  const lake=candidate("lake","lake",3,{kind:"destination",commonDestinationEvidence:lakeEvidence});
  assert.deepEqual(chooseCatalogCandidates([lake,candidate("peak","peak",5)]).kept.map(c=>c.input.sourceKey),["lake","peak"]);
  for (const bad of [{...lakeEvidence!,objectiveId:"other"},{...lakeEvidence!,sourceUrl:"https://wta.org.example.com/fake"},
    {...lakeEvidence!,attestation:"named_place" as "standalone_named_hike"}]) {
    assert.equal(chooseCatalogCandidates([{...lake,input:{...lake.input,commonDestinationEvidence:bad}},candidate("peak","peak",5)]).rejected[0].sourceKey,"lake");
  }
  const merelyNamed={...lake,input:{...lake.input,commonDestinationEvidence:undefined,
    identity:{name:lake.input.name,publisher:"wta" as const,sourceUrl:"https://www.wta.org/go-hiking/hikes/lake-ingalls"}}};
  assert.equal(chooseCatalogCandidates([merelyNamed,candidate("peak","peak",5)]).rejected[0].sourceKey,"lake");
});
test("reversed paths, suffixes and branches are not strict prefixes",()=>{
  const longer=candidate("long","long",5),shorter=candidate("short","short",3);
  assert.equal(isStrictCandidatePrefix(shorter,longer),true);
  for (const points of [[...shorter.points].reverse(),longer.points.slice(2),shorter.points.map((p,i)=>i===2?{...p,lng:p.lng+0.0001}:p)]) {
    const branch={...shorter,points};
    assert.equal(isStrictCandidatePrefix(branch,longer),false);
    assert.equal(chooseCatalogCandidates([branch,longer]).kept.length,2);
  }
});
test("pair dedupe is input-order independent and does not remove another trailhead",()=>{
  const a=candidate("a","objective",3),b=candidate("b","objective",4),other=candidate("other","objective",3,{trailheadId:"other-head"});
  other.trailhead.name="Other Trailhead";
  const first=chooseCatalogCandidates([b,other,a]),second=chooseCatalogCandidates([a,b,other]);
  assert.deepEqual(first,second);
  assert.deepEqual(first.kept.map(c=>c.input.sourceKey),["a","other"]);
  assert.notEqual(first.kept[0].input.name,first.kept[1].input.name);
  assert.deepEqual(first.rejected,[{sourceKey:"b",reason:"duplicate_trailhead_objective",keptSourceKey:"a"}]);
});
test("discovery pair selection uses shortest distance, breaks ties by key, and keeps distinct loops",()=>{
  const longer=candidate("a","objective",5),shorter=candidate("z","objective",3),tie=candidate("b","objective",3);
  for (const inputs of [[longer,shorter,tie],[tie,shorter,longer]]) {
    assert.equal(chooseCatalogCandidates(inputs,{preferShortestPath:true}).kept[0].input.sourceKey,"b");
  }
  assert.equal(chooseCatalogCandidates([longer,shorter,tie]).kept[0].input.sourceKey,"a");
  const first={...shorter,objective:null,input:{...shorter.input,kind:"loop" as const,objectiveId:null},shape:"loop" as const};
  first.points=[first.points[0],first.points[1],first.points[2],first.points[0]];
  const second={...first,points:first.points.map((p,i)=>i===1?{...p,lng:p.lng+0.01}:p),input:{...first.input,sourceKey:"second"}};
  assert.equal(chooseCatalogCandidates([first,second],{preferShortestPath:true}).kept.length,2);
  assert.equal(chooseCatalogCandidates([first,second]).kept.length,2);
  const reverse={...first,points:[...first.points].reverse(),input:{...first.input,sourceKey:"reverse"}};
  assert.equal(chooseCatalogCandidates([first,reverse]).kept.length,1);
});
test("only the two explicit source-bound Mailbox variants survive one trailhead/objective pair",()=>{
  const old=candidate("old","mailbox",4,{variant:"mailbox-old",source:{type:"osm",relationId:7147738,snapshots:[]}});
  const newer=candidate("new","mailbox",5,{variant:"mailbox-new",source:{type:"osm",relationId:5426108,snapshots:[]}});
  // These are distinct trail branches, not a prefix of each other.
  old.points[1]={...old.points[1],lng:-121.001};
  const result=chooseCatalogCandidates([old,newer,candidate("third","mailbox",6)]);
  assert.deepEqual(result.kept.map(c=>c.input.sourceKey),["new","old"]);
  assert.deepEqual(result.kept.map(c=>c.input.name),["Mailbox Peak (new trail)","Mailbox Peak (old trail)"]);
  assert.equal(result.rejected[0].sourceKey,"third");
  const fake=candidate("fake","other",4,{variant:"mailbox-old",source:{type:"osm",relationId:7147738,snapshots:[]}});
  assert.equal(chooseCatalogCandidates([fake,candidate("ordinary","other",4)]).kept.length,1);
});
test("attested common names stay stable and aliases retain observed names without case duplicates",()=>{
  const item=candidate("si","si",3,{name:"Mount Si Trail",aliases:["Mount Si","mount si"," Old Si Trail "]});
  item.attestedRouteNames=["Mount Si Trail","Si Trail"];
  item.edges.forEach(edge=>{edge.names=["Mount Si Trail","100"];});
  const original=JSON.stringify(item),result=chooseCatalogCandidates([item]);
  assert.equal(result.kept[0].input.name,"Mount Si Trail");
  assert.deepEqual(result.kept[0].input.aliases,["100","Mount Si","Old Si Trail","Si Trail"]);
  assert.equal(result.names[0].namingReason,"attested_common_name");
  assert.equal(JSON.stringify(item),original);
  assert.deepEqual(chooseCatalogCandidates(result.kept).kept,result.kept);
});
test("fallback names keep via until a complete regional and objective inventory proves uniqueness",()=>{
  const item=candidate("lake","lake",3,{kind:"destination",commonDestinationEvidence:lakeEvidence});
  assert.equal(chooseCatalogCandidates([item]).kept[0].input.name,"Ingalls Lake via Ingalls Way");
  const complete={completeRegionKeys:["US:WA"],completeObjectiveIds:["lake"],existingRoutes:[]};
  assert.equal(chooseCatalogCandidates([item],complete).kept[0].input.name,"Ingalls Lake");
  const collision={name:"Ingalls Lake",trailheadId:"elsewhere",objectiveId:"other",countryCode:"US",stateCode:"WA"};
  assert.equal(chooseCatalogCandidates([item],{...complete,existingRoutes:[collision]}).kept[0].input.name,"Ingalls Lake via Ingalls Way");
  const existingApproach={...collision,name:"Ingalls Lake via Ingalls Way",objectiveId:"lake"};
  assert.equal(chooseCatalogCandidates([item],{...complete,existingRoutes:[existingApproach]}).kept[0].input.name,"Ingalls Lake via Ingalls Way (Example Trailhead)");
});
