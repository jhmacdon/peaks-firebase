import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PoolClient } from "pg";
import { buildCandidate, loadCandidateSnapshots } from "../trail-catalog/candidate-source";
import { candidateProvenance, prepareElevation, provenanceSourceIds, segmentProvenance } from "../trail-catalog/sources";
import { sha256, stableJson } from "../trail-catalog/graph";
import { planPilot } from "../trail-catalog-pilot";
import { buildOfficialArcgisQueryUrl } from "../official-route-geometry";
import { getPublishableArcgisTrailSource } from "../official-trail-sources";
import { TERRARIUM_REQUIRED_ATTRIBUTION } from "../lib/terrarium-attribution";
import { discoverCatalogCandidates, type DiscoveryConfig } from "../trail-catalog/discovery";
import type { CatalogPlace, ElevationLineage, PilotCandidateInput } from "../trail-catalog/types";

const service = getPublishableArcgisTrailSource("usfs-nfs-trails").service;
const head: CatalogPlace = {id:"head",name:"Lake Trailhead",features:["trailhead"],lat:47,lng:-121,stateCode:"WA",countryCode:"US",boundary:null};
const lake: CatalogPlace = {...head,id:"lake",name:"Example Lake",features:["lake"],lng:-120.998};
const source = {type:"FeatureCollection",features:[
  {type:"Feature",properties:{globalid:"lower",trail_name:"Example Lake Trail",trail_no:"1013",attributesubset:"TrailNFS_MGMT",allowed_terra_use:"21"},geometry:{type:"LineString",coordinates:[[-121,47],[-120.999,47]]}},
  {type:"Feature",properties:{globalid:"upper",trail_name:"Example Lake Trail",trail_no:"1013",attributesubset:"TrailNFS_MGMT",allowed_terra_use:"21"},geometry:{type:"LineString",coordinates:[[-120.999,47],[-120.998,47]]}},
]};
const input: PilotCandidateInput = {sourceKey:"usfs:example",name:"Example Lake Trail",kind:"destination",trailheadId:"head",objectiveId:"lake",source:{type:"usfs-nfs-trails",featureIds:["lower","upper"],snapshots:[{path:"source.json",sha256:sha256(JSON.stringify(source)),url:buildOfficialArcgisQueryUrl(service,["lower","upper"]).toString(),retrievedAt:"2026-10-01T00:00:00Z"}]},startSourceVertex:{featureId:"lower",part:0,vertex:0},endSourceVertex:{featureId:"upper",part:0,vertex:1}};
const lineage: ElevationLineage = {source:"AWS Open Data Terrain Tiles (Mapzen Terrarium z14)",sourceUrl:"https://registry.opendata.aws/terrain-tiles/",attribution:TERRARIUM_REQUIRED_ATTRIBUTION,licenseUrl:"https://github.com/tilezen/joerd/blob/master/docs/attribution.md",retrievedAt:"2026-10-01T00:00:00Z",profile:"terrain"};

test("USFS candidates use canonical source features, real places and unchanged provenance shape", () => {
  const built = buildCandidate(input,[source],{trailhead:head,objective:lake});
  assert.deepEqual(built.nodeIds,[]); assert.deepEqual(built.usedWayIds,[]); assert.deepEqual(built.usedFeatureIds,["lower","upper"]);
  const provenance = candidateProvenance(built,lineage);
  assert.equal(Object.keys(provenance).length,11);
  assert.equal(provenance.source_kind,"usfs-nfs-trails"); assert.equal(provenance.contains_osm_geometry,false);
  assert.deepEqual(provenanceSourceIds(provenance),["lower","upper"]);
  assert.throws(() => buildCandidate({...input,name:"Unrelated Hike"},[source],{trailhead:head,objective:lake}),/route_name_attestation_missing/);
  assert.throws(() => buildCandidate(input,[source],{trailhead:{...head,lng:-122},objective:lake}),/trailhead_source_gap/);
  assert.throws(() => buildCandidate({...input,kind:"summit"},[source],{trailhead:head,objective:{...lake,features:["summit"],lng:-120.997}}),/objective_source_gap/);
  assert.throws(() => buildCandidate({...input,source:{...input.source,wayIds:[10]}},[source],{trailhead:head,objective:lake}),/mixed_source_claims/);
});
test("USFS discovery derives aliases from contributing features and replays them",()=>{
  const sourceWithOther={...source,features:[...source.features,{...source.features[0],properties:{...source.features[0].properties,globalid:"other",trail_name:"Unrelated Trail",trail_no:"9999"},geometry:{type:"LineString",coordinates:[[-121,47.01],[-120.999,47.01]]}}]};
  const config:DiscoveryConfig={version:1,batchKey:"usfs-discovery-test",bbox:{west:-121.1,east:-120.9,south:46.9,north:47.1},bundles:[{id:"example",source:{type:"usfs-nfs-trails",featureIds:["lower","upper","other"],snapshots:[{...input.source.snapshots[0],url:buildOfficialArcgisQueryUrl(service,["lower","upper","other"]).toString()}]}}]};
  const result=discoverCatalogCandidates(config,[{bundle:config.bundles[0],snapshots:[sourceWithOther]}],[head,lake]);
  assert.equal(result.complete,true);assert.equal(result.manifest.candidates.length,1);
  const candidate=result.manifest.candidates[0];
  assert.ok(candidate.aliases!.includes("1013"));
  assert.ok(!candidate.aliases!.includes("9999"));assert.ok(!candidate.aliases!.includes("Unrelated Trail"));
  assert.deepEqual(buildCandidate(candidate,[sourceWithOther],{trailhead:head,objective:lake}).usedFeatureIds,["lower","upper"]);
  const loopSource={...sourceWithOther,features:[{...source.features[0],geometry:{type:"LineString",coordinates:[[-121,47],[-120.98,47],[-120.98,47.02],[-121,47.02],[-121,47]]}},sourceWithOther.features[2]]};
  const loopInput:PilotCandidateInput={...input,name:"Example Loop",kind:"loop",objectiveId:null,endSourceVertex:undefined,source:{...input.source,featureIds:["lower","other"],snapshots:[{...input.source.snapshots[0],url:buildOfficialArcgisQueryUrl(service,["lower","other"]).toString()}]},loopSourcePoints:loopSource.features[0].geometry.coordinates.map(([lng,lat])=>({lng,lat}))};
  const built=buildCandidate(loopInput,[loopSource],{trailhead:head},{deriveSourceAliases:true});
  assert.ok(!built.input.aliases!.includes("Unrelated Trail"));assert.ok(!built.input.aliases!.includes("9999"));
  assert.deepEqual(buildCandidate(built.input,[loopSource],{trailhead:head}).points,built.points);
});
test("USFS dry plans bind exact source bytes and elevation to independent segment feature subsets", async () => {
  const dir = mkdtempSync(join(tmpdir(),"peaks-usfs-pilot-"));
  try {
    writeFileSync(join(dir,"source.json"),JSON.stringify(source));
    const built = buildCandidate(input,[source],{trailhead:head,objective:lake});
    const elevation = {points:built.points.map((point,i) => ({...point,ele:100+i*30})),lineage};
    const body = JSON.stringify(elevation); writeFileSync(join(dir,"elevation.json"),body);
    const candidate = {...input,elevation:{path:"elevation.json",sha256:sha256(body)}};
    const ready = prepareElevation({...built,input:candidate},dir);
    assert.deepEqual(provenanceSourceIds(segmentProvenance(ready,0,1)),["lower"]);
    assert.deepEqual(provenanceSourceIds(segmentProvenance(ready,1,2)),["upper"]);
    const lowerLake={...lake,id:"lower-lake",name:"Lower Example Lake",lng:-120.999};
    const client = {query:async (sql:string) => ({rows:sql.includes("FROM destinations WHERE") ? [head,lake,lowerLake] : sql.includes("to_regclass") ? [{exists:false}] : []})} as unknown as PoolClient;
    const plan = await planPilot(client,{version:1,batchKey:"usfs-test",candidates:[candidate]},dir);
    assert.equal(plan.reports[0].outcome,"admitted"); assert.equal(plan.reports[0].pendingReady,true);
    const artifact = plan.artifacts.get(candidate.sourceKey)!;
    assert.equal(artifact.snapshots[0].body,JSON.stringify(source));
    assert.equal(stableJson(buildCandidate(candidate,artifact.snapshots.map(snapshot => JSON.parse(snapshot.body)),{trailhead:head,objective:lake}).edges),stableJson(ready.edges));
    const prefix={...candidate,sourceKey:"usfs:prefix",objectiveId:lowerLake.id,endSourceVertex:{featureId:"lower",part:0,vertex:1}};
    const choices=await planPilot(client,{version:1,batchKey:"usfs-prefix-test",candidates:[prefix,candidate]},dir);
    assert.equal(choices.reports.length,2);
    assert.equal(choices.reports[0].reason,"strict_prefix_without_common_destination_attestation");
    assert.equal(choices.reports[0].keptSourceKey,candidate.sourceKey);
    assert.equal(choices.reports[1].namingReason,"attested_common_name");
    assert.deepEqual([...choices.artifacts.keys()],[candidate.sourceKey]);
    assert.throws(() => loadCandidateSnapshots({...candidate,source:{...candidate.source,featureIds:["lower"]}},dir),/feature_ids_mismatch/);
    writeFileSync(join(dir,"source.json"),JSON.stringify({...source,features:[]}));
    assert.throws(() => loadCandidateSnapshots(candidate,dir),/snapshot_hash_mismatch/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
