import assert from "node:assert/strict";
import { test, after } from "node:test";
import db from "../db";
import { supportsGlaciers, withoutGlaciers, glacierVisibilitySql, glacierCapabilityGuard } from "../lib/glacier-capability";
import { buildGlacierDetailQuery, buildGlacierFactsQuery, mapGlacierDetailRow } from "../lib/glacier-detail";
import { glacierCrossingsSql } from "../lib/glacier-crossings";
import { buildRouteDetailQuery } from "../routes/routes";
import { buildSessionDetailQuery, buildSessionRouteFactsQuery } from "../routes/sessions";
import { buildRouteLandmarksQuery, routePlacePage } from "../lib/route-landmarks";
import { buildDestinationSearchQuery, buildRankedDestinationSearchQuery } from "../routes/search";
import { buildSessionDestinationMatchSql } from "../processing";
import { normalizeSearchName } from "../search-utils";
import type { Request, Response } from "express";

after(async()=>{await db.end();});

test("capability is explicit and old clients lose neither a page nor a polygon parser",()=>{
  assert.equal(supportsGlaciers({headers:{}}),false);
  assert.equal(supportsGlaciers({} as Request),false);
  assert.equal(supportsGlaciers({headers:{"x-peaks-capabilities":"other, glaciers-v1"}}),true);
  assert.equal(supportsGlaciers({headers:{"x-peaks-capabilities":"glaciers-v10"}}),false);
  const value={destinations:[{id:"g",features:["glacier"]},{id:"lake",features:["lake"]}],
    sessions:[{id:"s",glacier_crossings:[{destination_id:"g"}],glacier_stretches:[{kind:"glacier"}],glacier_crossings_status:"complete"}]};
  assert.deepEqual(withoutGlaciers(value),{destinations:[{id:"lake",features:["lake"]}],sessions:[{id:"s"}]});
  assert.equal(value.destinations.length,2,"guard must not mutate cached rows");
  let status=200, body: any;
  const res={vary:()=>{},status:(n:number)=>{status=n;return res;},json:(v:unknown)=>{body=v;return res;}};
  glacierCapabilityGuard({method:"GET",headers:{}} as Request,res as unknown as Response,()=>{});
  res.json({id:"g",features:["glacier"]});
  assert.equal(status,404);
  assert.deepEqual(body,{error:"Destination not found"});
});

test("facts serialization keeps source dates, nulls, numeric wire fields and complete MultiPolygons",()=>{
  const boundary={type:"MultiPolygon",coordinates:[[[[0,0],[1,0],[1,1],[0,0]],[[.2,.2],[.3,.2],[.2,.3],[.2,.2]]],[[[3,0],[4,0],[4,1],[3,0]]]]};
  const row=mapGlacierDetailRow({id:"g",boundary,glacier:{kind:"snowfield",area_km2:null,
    observed_year:null,outline_observed_at:"2026-10-28",head_elevation_m:null},session_count:"2",route_count:"3",
    session_distance:1200,session_gain:300,session_time:"400",sessions_has_more:true,sessions_next_offset:"25",
    sessions:[{id:"s"}],routes:[],description:"uncredited"});
  const wire=JSON.parse(JSON.stringify(row));
  assert.equal(wire.glacier.area_km2,null);assert.equal(wire.glacier.observed_year,null);
  assert.equal(typeof wire.session_time,"number");assert.equal(wire.session_count,2);
  assert.equal(wire.description,null);assert.deepEqual(wire.boundary,boundary);
  assert.equal(wire.boundary.coordinates.length,2);assert.equal(wire.boundary.coordinates[0].length,2);
  const q=buildGlacierDetailQuery("g","me",25,0);
  assert.deepEqual(q.values,["g","me",25,0]);
  assert.match(q.text,/s.user_id=\$2 AND \$2<>''/);
  assert.match(q.text,/session_destination_rejections/);
  assert.match(q.text,/EXISTS\(SELECT 1 FROM session_glacier_crossings/);
  assert.match(q.text,/ST_AsGeoJSON\(gf.outline,9\)/);
  assert.match(q.text,/to_jsonb\(gf\).*-'outline'/);
  assert.doesNotMatch(q.text,/ST_AsGeoJSON\(d.boundary[,)]|ST_Simplify|SELECT s\.\*/);
  assert.match(buildGlacierFactsQuery("g","me").text,/pm.owner='peaks' OR pm.owner=\$2/);
});

test("route/session readers expose ordered stored spans without requiring a primary session route",()=>{
  const route=buildRouteDetailQuery("r","me",{glaciers:true});
  assert.match(route.text,/route_glacier_crossings c/);
  assert.match(buildSessionDetailQuery("s","me",{glaciers:true}).text,/session_glacier_crossings c/);
  const q=buildSessionRouteFactsQuery("s","me",true);
  assert.match(q.text,/s.user_id=\$2 OR s.is_public=true/);
  assert.match(q.text,/session_glacier_crossings c/);
  assert.doesNotMatch(glacierCrossingsSql("session","s"),/primary_route|session_routes/);
  assert.match(glacierCrossingsSql("session","s"),/ORDER BY c.entered_distance_m,c.destination_id,c.pass_index/);
  assert.match(glacierCrossingsSql("session","s"),/NOT EXISTS\(SELECT 1 FROM session_destination_rejections/);
  assert.match(glacierCrossingsSql("route","r"),/glacier_match_input_hash IS NOT NULL/);
  assert.doesNotMatch(buildRouteDetailQuery("r","me").text,/route_glacier_crossings/);
  assert.doesNotMatch(buildSessionDetailQuery("s","me").text,/session_glacier_crossings/);
  const landmarks=buildRouteLandmarksQuery("r","me",undefined,true);
  assert.match(landmarks.text,/route_glacier_crossings/);
  const spans=[{destination_id:"g",pass_index:0,entered_distance_m:1},{destination_id:"g",pass_index:1,entered_distance_m:20}];
  const page=routePlacePage({version:"v",total_vertices:2,last_vertex:2,end_m:50,items:[],glacier_crossings:spans,glacier_crossings_status:"complete"},{vertex:1,along:0,row:0});
  assert.deepEqual(page.glacier_crossings,spans,"same-ID return passes must survive paging");
  assert.match(buildSessionDestinationMatchSql("s").text,/NOT \('glacier'=ANY\(d.features::text\[\]\)\)/);
});

test("glacier search uses narrow candidates, retains the planner fixes, and accepts Interglacier",()=>{
  assert.equal(normalizeSearchName("Interglacier"),"inter glacier");
  for (const query of ["emmons","emmons glacier","em","glacier","rainier","inter glacier"]) {
    const q=buildDestinationSearchQuery({normalizedQuery:query,rawQuery:query,limit:20,glaciers:true});
    assert.match(q.text,/FROM destination_search_rows ds/);
    assert.match(q.text,/word_rows AS MATERIALIZED/);
    assert.doesNotMatch(q.text,/glacier_facts|glacier_crossings|ST_Intersects/);
    assert.equal(q.values[0],query);
  }
  const old=buildRankedDestinationSearchQuery({normalizedQuery:"glacier",rawQuery:"glacier",limit:20,glaciers:false});
  assert.match(old.text,/NOT \('glacier'=ANY\(ds.features::text\[\]\)\)/);
  assert.ok(old.text.indexOf("NOT ('glacier'")<old.text.indexOf("ranked_destinations AS"));
  assert.equal(glacierVisibilitySql("ds",true),"TRUE");
});

test("summary enrichment walks nested arrays copy-on-write and keeps detail glacier objects",async()=>{
  const { attachGlacierSummaries, collectGlacierSummaryIds, buildGlacierSummaryQuery } = await import("../lib/glacier-summary");
  const body={destinations:[{id:"g",features:["glacier"]},{id:"d",features:["glacier"],glacier:{kind:"glacier",area_km2:1}}],
    areas:[{id:"a",destinations:[{id:"g2",features:"{summit,glacier}",boundary:{features:["glacier"],id:"x"}}]}],
    results:[{type:"destination",id:"g",data:{features:["glacier"]}}]};
  assert.deepEqual([...collectGlacierSummaryIds(body)].sort(),["g","g2"]);
  let calls=0;
  const out=await attachGlacierSummaries(body,"",async(_t,values)=>{calls++;
    assert.deepEqual(values,[["g","g2"],""]);
    return [{id:"g",glacier:{kind:"glacier",parent_mountain:{id:"p",name:"P"}}},{id:"g2",glacier:{kind:"snowfield",parent_mountain:{id:"p",name:"P"}}}];});
  assert.equal(calls,1);
  assert.equal(out.destinations[0].glacier.kind,"glacier");
  assert.equal(out.destinations[1].glacier.area_km2,1);
  assert.equal(out.areas[0].destinations[0].glacier.kind,"snowfield");
  assert.equal((body.destinations[0] as any).glacier,undefined,"cached rows stay untouched");
  assert.equal(await attachGlacierSummaries([{id:"l",features:["lake"]}],"",async()=>{throw new Error("no lookup");}).then(r=>r.length),1);
  const sql=buildGlacierSummaryQuery(["g"],"me").text;
  for (const field of ["geometry_credit","geometry_license","outline_observed_at","outline_source_url"])
    assert.ok(sql.includes(`gf.${field}`),field);
  assert.match(sql,/gf.provenance->'outline'/);
});

test("mixed geometry sources retain each row's own credit and mapped date in detail, summaries and crossings",async()=>{
  const { attachGlacierSummaries } = await import("../lib/glacier-summary");
  const rows=[
    {id:"osm",geometry_credit:"© OpenStreetMap contributors",geometry_license:"ODbL-1.0",outline_observed_at:"2026-10-28",
      provenance:{outline:{observed_at:null,snapshot_at:"2026-10-28"}}},
    {id:"inventory",geometry_credit:"Inventory authors, via GLIMS",geometry_license:"CC0-1.0",outline_observed_at:"2019-09-09",
      provenance:{outline:{observed_at:"2019-09-09",snapshot_at:"2026-10-28"}}},
  ];
  const summaries=await attachGlacierSummaries(rows.map(r=>({id:r.id,features:["glacier"]})),"",async()=>rows.map(r=>({id:r.id,glacier:r})));
  const wire=JSON.parse(JSON.stringify(rows.map(r=>mapGlacierDetailRow({id:r.id,glacier:r}))));
  assert.equal(wire[0].glacier.outline_observed_at,"2026-10-28");
  assert.equal(wire[1].glacier.outline_observed_at,"2019-09-09");
  assert.equal(wire[1].glacier.geometry_credit,"Inventory authors, via GLIMS");
  assert.equal(summaries[1].glacier.geometry_license,"CC0-1.0");
  assert.equal(summaries[0].glacier.provenance.outline.observed_at,null);
  for (const kind of ["route","session"] as const) {
    const sql=glacierCrossingsSql(kind,"r");
    assert.match(sql,/'geometry_credit',gf.geometry_credit/);
    assert.match(sql,/to_char\(gf.outline_observed_at,'YYYY-MM-DD'\)/);
    assert.match(sql,/'outline_provenance',gf.provenance->'outline'/);
    assert.doesNotMatch(sql,/OpenStreetMap contributors|2019-09-09/);
  }
});
