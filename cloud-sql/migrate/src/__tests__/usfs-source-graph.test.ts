import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOfficialArcgisQueryUrl, parseOfficialFeatureIdsFromSourceUrl, type OfficialNetworkPath } from "../official-route-geometry";
import { getPublishableArcgisTrailSource } from "../official-trail-sources";
import { buildUsfsSourceGraphPath, loadUsfsSnapshot, proveUsfsSourceSpan, usfsSpanSourceUrl } from "../trail-catalog/usfs-source-graph";
import { sha256 } from "../trail-catalog/graph";

function paths(): OfficialNetworkPath[] { return [
  { featureId: "lower", properties: { attributesubset: "TrailNFS_MGMT", allowed_terra_use: "21" }, coordinates: [[-121,47],[-120.999,47]], names: ["EXAMPLE TRAIL","1013"], access: [] },
  { featureId: "upper", properties: { attributesubset: "TrailNFS_MGMT", allowed_terra_use: "1" }, coordinates: [[-120.999,47],[-120.998,47]], names: ["UPPER EXAMPLE","1013.1"], access: [] },
]; }
const options = { start: { featureId: "lower", part: 0, vertex: 0 }, end: { featureId: "upper", part: 0, vertex: 1 } };
const service = getPublishableArcgisTrailSource("usfs-nfs-trails").service;

test("USFS graph keeps exact vertices, source feature spans, and source seams", () => {
  const result = buildUsfsSourceGraphPath(paths(), options);
  assert.deepEqual(result.points, [{lng:-121,lat:47},{lng:-120.999,lat:47},{lng:-120.998,lat:47}]);
  assert.deepEqual(result.usedFeatureIds, ["lower","upper"]);
  assert.deepEqual(result.requiredCutIndices, [0,1,2]);
  assert.deepEqual(parseOfficialFeatureIdsFromSourceUrl(service, result.sourceUrl), ["lower","upper"]);
  assert.deepEqual(parseOfficialFeatureIdsFromSourceUrl(service, usfsSpanSourceUrl(result.edges,0,1)), ["lower"]);
  assert.deepEqual(result.edges[1], {featureId:"upper",part:0,startVertex:0,endVertex:1,names:["UPPER EXAMPLE","1013.1"]});
});
test("USFS graph rejects raw centerline records, unknown access codes and year-round restrictions", () => {
  for (const invalid of [{attributesubset:"TrailNFS_Centerline"},{allowed_terra_use:"N/A"},{hiker_pedestrian_restricted:"01/01-12/31"},{hiker_pedestrian_disc:"01/01-12/31"}]) {
    const source = paths(); Object.assign(source[0].properties,invalid);
    assert.throws(() => buildUsfsSourceGraphPath(source, options), /usfs_access_rejected/);
  }
});
test("USFS graph cannot bridge even a small missing feature connector", () => {
  const source = paths(); source[1].coordinates[0][0] += 0.00001;
  assert.throws(() => buildUsfsSourceGraphPath(source, options), /usfs_source_disconnected/);
});
test("USFS exact cycle coordinates exclude a spur and reject guessed connectors",()=>{
  const source:OfficialNetworkPath[]=[{...paths()[0],coordinates:[[-121,46.99],[-121,47],[-120.98,47],[-120.98,47.02],[-121,47.02],[-121,47]]}];
  const points=[{lng:-121,lat:47},{lng:-120.98,lat:47},{lng:-120.98,lat:47.02},{lng:-121,lat:47.02},{lng:-121,lat:47}];
  const options={start:{featureId:"lower",part:0,vertex:1},loop:true,loopPoints:points};
  const built=buildUsfsSourceGraphPath(source,options);
  assert.deepEqual(built.points,points);assert.equal(proveUsfsSourceSpan(points,source,["lower"]).passed,true);
  assert.throws(()=>buildUsfsSourceGraphPath(source,{...options,loopPoints:[points[0],points[2],points[3],points[0]]}),/usfs_loop_source_edge_missing/);
});
test("USFS graph preserves reverse source span bounds and rejects duplicate physical claims", () => {
  const result = buildUsfsSourceGraphPath(paths(), { start: options.end, end: options.start });
  assert.equal(result.edges[0].startVertex, 1); assert.equal(result.edges[0].endVertex, 0);
  const source = paths(); source.push({...source[0], featureId:"duplicate"});
  assert.throws(() => buildUsfsSourceGraphPath(source, options), /ambiguous_usfs_source_edge/);
});
test("independent USFS span proof requires every cited feature to contribute geometry", () => {
  const source = paths(), result = buildUsfsSourceGraphPath(source,options);
  assert.equal(proveUsfsSourceSpan(result.points,source,["lower","upper"]).passed,true);
  const lower = proveUsfsSourceSpan(result.points.slice(0,2),source,["lower"]);
  assert.equal(lower.passed,true); assert.deepEqual(lower.usedFeatureIds,["lower"]);
  const excess = proveUsfsSourceSpan(result.points.slice(0,2),source,["lower","upper"]);
  assert.equal(excess.passed,false); assert.ok(excess.errors.some(e => e.includes("positive geometry")));
  const fakeEnd = [...result.points,{lng:-120.998,lat:47.00107}];
  assert.equal(proveUsfsSourceSpan(fakeEnd,source,["lower","upper"]).passed,false);
});
test("USFS loader pins canonical feature query, exact bytes and registry parsing", () => {
  const dir = mkdtempSync(join(tmpdir(),"peaks-usfs-source-"));
  try {
    const source = paths(), payload = {type:"FeatureCollection",features:source.map(path => ({type:"Feature",properties:{...path.properties,globalid:path.featureId,trail_name:path.names[0],trail_no:path.names[1]},geometry:{type:"LineString",coordinates:path.coordinates}}))};
    const body = JSON.stringify(payload); writeFileSync(join(dir,"snapshot.json"),body);
    const snapshot = {path:"snapshot.json",sha256:sha256(body),url:buildOfficialArcgisQueryUrl(service,["lower","upper"]).toString(),retrievedAt:"2026-10-01T00:00:00Z"};
    assert.equal(loadUsfsSnapshot(snapshot,["lower","upper"],dir).paths.length,2);
    assert.throws(() => loadUsfsSnapshot(snapshot,["lower"],dir),/usfs_snapshot_feature_ids_mismatch/);
    assert.throws(() => loadUsfsSnapshot({...snapshot,url:"https://www.nps.gov/trails.geojson"},["lower","upper"],dir),/does not match/);
    assert.throws(() => loadUsfsSnapshot({...snapshot,sha256:"a".repeat(64)},["lower","upper"],dir),/snapshot_hash_mismatch/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test("independent USFS proof excludes nearby parallel feature padding", () => {
  const source = paths(), result = buildUsfsSourceGraphPath(source,options);
  const parallel = source.map(path => ({...path,featureId:`parallel-${path.featureId}`,coordinates:path.coordinates.map(([lng,lat]): [number,number] => [lng,lat + 0.000018])}));
  const proof = proveUsfsSourceSpan(result.points,[...source,...parallel],["lower","upper","parallel-lower","parallel-upper"]);
  assert.equal(proof.passed,false);
  assert.deepEqual(proof.usedFeatureIds,["lower","upper"]);
  assert.ok(proof.errors.some(error => error.includes("positive geometry: parallel-lower,parallel-upper")));
});
test("independent USFS proof rejects a near-source drift or skipped vertex", () => {
  const source = paths(), result = buildUsfsSourceGraphPath(source,options);
  const drifted = [...result.points.slice(0,2),{...result.points[2],lat:result.points[2].lat + 0.000009}];
  const drift = proveUsfsSourceSpan(drifted,source,["lower","upper"]);
  assert.equal(drift.passed,false); assert.ok(drift.maxOffsetM < 2);
  assert.ok(drift.errors.some(error => error.includes("exact cited source edges: 1")));
  const shortcut = proveUsfsSourceSpan([result.points[0],result.points[2]],source,["lower","upper"]);
  assert.equal(shortcut.passed,false); assert.deepEqual(shortcut.usedFeatureIds,[]);
  const reverse = proveUsfsSourceSpan([...result.points].reverse(),source,["lower","upper"]);
  assert.equal(reverse.passed,true);
});
