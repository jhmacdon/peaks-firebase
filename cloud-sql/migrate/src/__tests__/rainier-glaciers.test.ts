import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, loadRainierPackage, importRainierGlaciers } from "../import-rainier-glaciers";
import { parseGlaciers, sha256, SNAPSHOT_SHA256 } from "../glaciers/rainier";
import { parseGlacierBackfillOptions } from "../backfill-glacier-crossings";

const coords=(points: number[][])=>points.map(([lon,lat])=>({lon,lat}));
const square=(x=0,y=0,size=1)=>coords([[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]]);
const tags={natural:"glacier",name:"Synthetic Glacier"};

test("snapshot hash and complete named roster: 28 glaciers plus Muir Snowfield",()=>{
  const bytes=readFileSync(join(DATA_DIR,"rainier-glaciers-overpass.json"));
  assert.equal(sha256(bytes),SNAPSHOT_SHA256);
  const pkg=loadRainierPackage();
  assert.equal(pkg.places.length,29);
  assert.equal(pkg.places.filter(p=>p.kind==="glacier").length,28);
  assert.equal(new Set(pkg.places.map(p=>p.id)).size,29);
  assert.equal(pkg.places.find(p=>p.name==="Muir Snowfield")!.kind,"snowfield");
  assert.ok(pkg.places.every(p=>p.boundary.type==="MultiPolygon" && p.boundary.coordinates.length>0));
  assert.deepEqual(pkg.places.filter(p=>p.boundary.coordinates.length>1).map(p=>[p.name,p.boundary.coordinates.length]).sort(),
    [["Columbia Crest Glacier",2],["Flett Glacier",3],["Kautz Glacier",2]]);
  assert.equal(pkg.places.find(p=>p.name==="Emmons Glacier")!.external_ids.wikidata,"Q5373601");
  assert.equal(loadRainierPackage().manifest_sha256,pkg.manifest_sha256,"replay is deterministic");
});

test("parser retains outer components, holes, stitched/reversed members and deduplicates parent ways",()=>{
  const one=square(), two=square(3,0), hole=square(.2,.2,.2);
  const places=parseGlaciers({elements:[{type:"way",id:1,tags,geometry:one},
    {type:"relation",id:2,tags,members:[
      {type:"way",ref:1,role:"outer",geometry:one},
      {type:"way",ref:3,role:"outer",geometry:two.slice(0,3)},
      {type:"way",ref:4,role:"outer",geometry:two.slice(2).reverse()},
      {type:"way",ref:5,role:"inner",geometry:hole},
    ]}, {type:"way",id:6,tags:{natural:"glacier"},geometry:square(7)}]});
  assert.equal(places.length,1);
  assert.equal(places[0].osm_key,"relation:2");
  assert.equal(places[0].boundary.coordinates.length,2);
  assert.equal(places[0].boundary.coordinates[0].length,2);
  assert.deepEqual(places[0].boundary.coordinates[0][1],hole.map(p=>[p.lon,p.lat]));
  const a=parseGlaciers({elements:[{type:"way",id:2,tags,geometry:one}]});
  assert.notEqual(a[0].id,places[0].id,"way/relation numeric IDs must not collide");
});

test("incomplete snapshots, open rings, point-only places and orphan holes fail closed",()=>{
  assert.throws(()=>parseGlaciers({remark:"timeout",elements:[]}),/Incomplete/);
  assert.throws(()=>parseGlaciers("<html>"),/Incomplete/);
  const invalid=square();invalid[1]={lon:NaN,lat:0};
  assert.throws(()=>parseGlaciers({elements:[{type:"way",id:9,tags,geometry:invalid}]}),/Invalid WGS84/);
  assert.throws(()=>parseGlaciers({elements:[{type:"way",id:1,tags,geometry:square().slice(0,3)}]}),/Open/);
  assert.throws(()=>parseGlaciers({elements:[{type:"node",id:1,tags,lat:46.8,lon:-121.7}]}),/no polygon/);
  assert.throws(()=>parseGlaciers({elements:[{type:"relation",id:1,tags,members:[
    {type:"way",role:"outer",ref:2,geometry:square()},
    {type:"way",role:"inner",ref:3,geometry:square(4)},
  ]}]}),/Orphan/);
});

test("Table 4/5/7/12 facts cross-check independent published values and units",()=>{
  const report=readFileSync(join(DATA_DIR,"nps-beason-2023-report.txt"),"utf8");
  const pkg=loadRainierPackage(), facts=(name:string)=>pkg.places.find(p=>p.name===name)!.facts;
  assert.match(report,/Emmons\s+EMM\s+1\s+10,959,203 ± 575,333/);
  assert.match(report,/Emmons\s+EMM\s+1\s+659,213,186 ± 230,724,615/);
  const emmons=facts("Emmons Glacier");
  assert.equal(emmons.area_km2,10.959203);
  assert.equal(emmons.area_uncertainty_km2,.575333);
  assert.equal(emmons.head_elevation_m,4312);
  assert.equal(emmons.terminus_elevation_m,1488);
  assert.equal(emmons.elevation_range_m,2824);
  assert.equal(emmons.length_km,7.32);
  assert.equal(emmons.average_slope_deg,24,"report table has integer mean; do not silently mix page precision");
  assert.equal(emmons.flow_direction_deg,55);
  assert.equal(emmons.type_code,"S");
  assert.equal(emmons.estimated_volume_km3,.659213186);
  assert.deepEqual(emmons.area_history.map(o=>o.year),[1896,1913,1971,1994,2009,2015,2021]);
  assert.equal(emmons.area_history[0].area_km2,17.458);
  assert.ok(Math.abs(emmons.percent_change_since_earliest!-((10.959/17.458-1)*100))<1e-10);
  assert.equal(facts("Carbon Glacier").type_code,"C");
  assert.equal(facts("Winthrop Glacier").terminus_elevation_m,1479);
  assert.equal(pkg.mountain_context.area_km2,75.496);
  assert.match(report,/75\.496 ± 4\.109/);
});

test("name crosswalks preserve combined histories and unknown observations",()=>{
  const pkg=loadRainierPackage(), facts=(name:string)=>pkg.places.find(p=>p.name===name)!.facts;
  assert.equal(facts("Inter Glacier").inventory_name,"Inter");
  assert.equal(facts("Pyramid Glaciers").area_km2,.176038);
  assert.equal(facts("Sarvant Glacier").inventory_name,"Sarvent");
  assert.equal(facts("Cowlitz Glacier").area_history_scope,"Cowlitz-Ingraham");
  assert.equal(facts("Cowlitz Glacier").area_history[6].area_km2,6.647);
  assert.equal(facts("Cowlitz Glacier").area_km2,3.684615);
  assert.equal(facts("Paradise Glacier").area_history_scope,"Paradise-Stevens");
  assert.equal(facts("Flett Glacier").area_history[0].area_km2,null);
  assert.equal(facts("Muir Snowfield").area_km2,null,"NPS Muir Glacier is not Muir Snowfield");
  assert.equal(facts("Pinnacle Glacier").observed_year,null);
  assert.equal(facts("Pinnacle Glacier").estimated_volume_km3,null);
  assert.equal(pkg.places.filter(p=>p.facts.description!==null).length,8);
  assert.equal(facts("Paradise Glacier").description,null,"saved page is for the Paradise visitor area");
  assert.equal(facts("Ohanapecosh Glacier").description,null,"saved page is for the visitor center");
  assert.equal(facts("Inter Glacier").type_code,null,"Table 5 does not supply type codes");
});

test("apply requires a reviewed hash before opening a connection; repair batches are bounded",async()=>{
  await assert.rejects(importRainierGlaciers(["--apply","--expected-manifest-sha256=wrong"]),/reviewed/);
  assert.equal(parseGlacierBackfillOptions([]).limit,10);
  assert.equal(parseGlacierBackfillOptions([]).apply,false);
  assert.throws(()=>parseGlacierBackfillOptions(["--limit=101"]),/1..100/);
  assert.throws(()=>parseGlacierBackfillOptions(["--limit=1.5"]),/1..100/);
  assert.throws(()=>parseGlacierBackfillOptions(["--kind=everything"]),/kind/);
});

test("the Rainier builder emits a generic manifest; the writer reads every name, credit and check from it",async()=>{
  const { validateGlacierManifest, importGlacierManifest, manifestSha256 } = await import("../import-glacier-manifest");
  const pkg=loadRainierPackage();
  assert.equal(manifestSha256(pkg),pkg.manifest_sha256);
  assert.deepEqual(pkg.places.find(p=>p.name==="Inter Glacier")!.aliases,["Interglacier"]);
  assert.ok(pkg.places.filter(p=>p.name!=="Inter Glacier").every(p=>p.aliases.length===0));
  assert.equal(pkg.mountain_context.history_start_year,1896);
  assert.equal(pkg.parent.name,"Mount Rainier");
  assert.equal(pkg.facts_source_url,"https://doi.org/10.36967/2299328");
  const { manifest_sha256: _hash, ...body } = pkg;
  assert.throws(()=>validateGlacierManifest({...body,facts_credit:" "}),/credits/);
  assert.throws(()=>validateGlacierManifest({...body,places:[]}),/no places/);
  assert.throws(()=>validateGlacierManifest({...body,places:[{...body.places[0],aliases:undefined as never}]}),/aliases/);
  await assert.rejects(importGlacierManifest([]),/--manifest/);
});
