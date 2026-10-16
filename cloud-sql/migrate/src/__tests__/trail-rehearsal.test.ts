import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {loaderArgs,loaderMode} from '../trail-graph/loader-cli';
import {executePrune,prunePlan} from '../trail-graph/load-prune';
import {executePlan,type RoutePlan} from '../trail-graph/load-catalog';
import {replacementPlan} from '../trail-graph/load-rebase';
import {peaksLegacyProvenance,unionProvenance,validSource,sourceCompatible,sourcesCovered} from '../trail-graph/source-provenance';
import {rebaseDraft,finalizeRebases,rebasePlanHash,mergePlans,medianSpacing,deviationStats,type LegacyRoute,type RebaseContext} from '../trail-graph/rebase';
import {TrailRouter} from '../trail-graph/router';
import {materialize,finalizeRows} from '../trail-graph/compose';
import {refresh,provenance} from '../trail-graph/topology';
import {length,interpolate} from '../trail-graph/geo';
import {projection,routeLine} from '../trail-graph/stretches';
import type {Coord,Segment} from '../trail-graph/types';

function fixture(overrides:Partial<LegacyRoute>={},context:RebaseContext={}) {
  const coords:Coord[]=Array.from({length:201},(_,i)=>[-121+i*.0001,47]);
  const segment=refresh({id:'',name:'River Trail',trail_names:['River Trail'],kind:'trail',sac_scale:null,trail_visibility:null,osm_way_ids:[10],osm_edge_way_ids:coords.slice(1).map(()=>10),relations:[],relation_names:[],start_node:'',end_node:'',coords,node_ids:coords.map((_,i)=>`n${String(i).padStart(3,'0')}`),length_m:0,provenance:provenance([10],'2026-10-15T00:00:00Z'),alt_sources:[]} as Segment);
  const legacy:LegacyRoute={id:'old',name:'River Trail',status:'active',kind:'summit',shape:'out_and_back',distance:length(coords),gain:100,objective_destination_id:'goal',trailhead_destination_id:'th',provenance_source:null,n_sessions:2,catalog_reviewed:false,factory_job:null,segments:null,coords:[...coords],created_at:'2020-01-02T03:04:05Z',...overrides};
  const source=new Map([[segment.id,segment]]),result=rebaseDraft(legacy,new TrailRouter([segment]),source,undefined,context),segments=materialize([result.draft],source);
  finalizeRebases([result.plan],segments);finalizeRows([result.plan.row],segments);result.plan.plan_hash=rebasePlanHash(result.plan);return{...result,segments:new Map(segments.map(s=>[s.id,s])),segment};
}
test('all loader argument schemas reject unknown, merged, duplicate and missing-value arguments',()=>{
  for(const cli of ['catalog','segments'] as const){
    for(const args of [['--typo'],['--prune-pending --apply'],['--apply --rebase'],['--out'],['--out','--apply'],['--apply=true'],['--apply','false'],['--out','x','--out','y']])assert.throws(()=>loaderArgs(args,cli));
    assert.deepEqual(loaderArgs(['--out=folder with spaces'],cli).get('out'),['folder with spaces']);
  }
  for(const args of [['--prune-pending','--rebase'],['--prune-pending','--elevation'],['--prune-pending','--activate'],['--rebase','--include-review']])assert.throws(()=>loaderArgs(args));
  assert.equal(loaderMode(loaderArgs(['--prune-pending','--apply'])),'prune');
  assert.equal(loaderMode(loaderArgs(['--rebase','--elevation'])),'rebase');assert.equal(loaderMode(loaderArgs([])),'catalog');
});
test('loader CLIs reject unknown flags before reading a nonexistent output folder',()=>{
  for(const script of ['load-catalog.ts','load-segments.ts']){const r=spawnSync(process.execPath,['--import','tsx',resolve(__dirname,'../trail-graph',script),'--out','/missing-wa-test-folder','--bogus'],{cwd:resolve(__dirname,'../..'),env:{...process.env,TSX_DISABLE_CACHE:'1'},encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stderr,/Unknown argument/);assert.ok(!r.stderr.includes('ENOENT'));}
});
test('prune mode writes only a prune plan and never dispatches catalog/rebase work',async()=>{
  const parent=resolve(__dirname,'../../../../.cache/rehearsal-tests');await mkdir(parent,{recursive:true});const dir=await mkdtemp(join(parent,'prune-'));
  try{await writeFile(join(dir,'routes.ndjson'),'');await writeFile(join(dir,'segments.ndjson'),'');const r=spawnSync(process.execPath,['--import','tsx',resolve(__dirname,'../trail-graph/load-catalog.ts'),'--prune-pending','--out',dir],{cwd:resolve(__dirname,'../..'),env:{...process.env,TSX_DISABLE_CACHE:'1'},encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);const out=JSON.parse(r.stdout);assert.equal(out.operation,'prune');assert.equal(out.catalog_routes_loaded,0);assert.equal(out.merges,0);assert.equal(out.rebases,0);
    const plan=JSON.parse(await readFile(join(dir,'prune-plan.json'),'utf8'));assert.deepEqual(plan.statements.map((s:any)=>s.kind),['begin','lock','prune_routes','prune_segments','prune_places','commit']);await assert.rejects(()=>access(join(dir,'load-plan.json')));
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('prune executor refuses non-prune statements without executing them',async()=>{
  const calls:string[]=[],client={query:async(sql:string)=>{calls.push(sql);return{rows:[]};}};
  await executePrune(client as any,prunePlan([],[]));assert.ok(calls.every(s=>!/^(INSERT|UPDATE)/.test(s)));
  await assert.rejects(()=>executePrune(client as any,[{kind:'merge_metadata',sql:'UPDATE routes SET name=$1',values:['oops']}]),/Non-prune/);assert.equal(calls.at(-1),'ROLLBACK');assert.ok(!calls.some(s=>s.startsWith('UPDATE')));
});
test('a catalog merge cannot use the original snapshot before rebase completion',async()=>{
  const f=fixture(),row=structuredClone(f.plan.row);row.seed_index=3;finalizeRows([row],[...f.segments.values()]);const merge=mergePlans([row],[f.plan],[...f.segments.values()])[0],p=replacementPlan(row,f.segments,f.plan,{elevation:true},merge),calls:string[]=[];
  const client={query:async(sql:string)=>{calls.push(sql);return{rows:sql.includes('wa_catalog_rebase_receipts')?[{valid:false}]:[],rowCount:0};}};
  await assert.rejects(()=>executePlan(client as any,p,f.segments,'.'),/completed rebase receipt missing/);assert.equal(calls.at(-1),'ROLLBACK');assert.ok(!calls.some(s=>/^(INSERT|DELETE|UPDATE)/.test(s)));
  const guard=p.statements.find(s=>s.kind==='replacement_guard')!;assert.ok(!guard.sql.includes(' OR '));
});
test('a rebase receipt is written only after source and active integrity checks',()=>{
  const f=fixture(),p=replacementPlan(f.plan.row,f.segments,f.plan,{elevation:true}),at=p.statements.findIndex(s=>s.kind==='rebase_receipt');assert.ok(at>p.statements.findIndex(s=>s.kind==='active_integrity'));assert.ok(at<p.statements.findIndex(s=>s.kind==='commit'));
});
test('Peaks legacy credit uses the original creation time and claims no OSM geometry',()=>{
  const p=peaksLegacyProvenance('2020-01-02T03:04:05Z');assert.ok(validSource(p));assert.equal(p.source_kind,'peaks-legacy');assert.equal(p.source_url,'https://peaks.app');assert.equal(p.retrieved_at,'2020-01-02T03:04:05Z');assert.deepEqual(p.osm_way_ids,[]);assert.equal(p.contains_osm_geometry,false);assert.equal(validSource(peaksLegacyProvenance()),false);
  const f=fixture({coords:[[-121,47],[-120.98,47],[-120.979,47.001]]}),p2=replacementPlan(f.plan.row,f.segments,f.plan,{elevation:true}),tail=p2.statements.find(s=>s.kind==='legacy_tail_insert')!;assert.match(tail.sql,/WHEN is_valid_route_provenance/);assert.match(tail.sql,/created_at AT TIME ZONE/);assert.match(tail.sql,/owner='peaks'/);assert.ok(!tail.sql.includes('retrieved_at\',now()'));
});
test('source bundles preserve both licenses and reject missing, forged or unrepresented credits',()=>{
  const osm=provenance([10],'2026-10-15T00:00:00Z'),peaks=peaksLegacyProvenance('2020-01-02T03:04:05Z'),mixed=unionProvenance([osm,peaks]);assert.ok(validSource(mixed));assert.equal(mixed.sources?.length,2);assert.deepEqual(mixed.osm_way_ids,[10]);assert.equal(mixed.sources!.find(s=>s.source_kind==='peaks-legacy')!.attribution,'Peaks');
  assert.ok(sourceCompatible(osm,mixed));assert.ok(sourceCompatible(peaks,mixed));assert.ok(sourcesCovered([osm,peaks],mixed));assert.equal(sourcesCovered([osm],mixed),false);assert.equal(sourceCompatible(peaks,osm),false);
  assert.equal(validSource({...mixed,attribution:'Peaks'}),false);assert.equal(validSource({...mixed,osm_way_ids:[10,99],osm_way_urls:['https://www.openstreetmap.org/way/10','https://www.openstreetmap.org/way/99']}),false);
  assert.equal(validSource({...mixed,sources:[osm,null as any]}),false);
  const grouped=unionProvenance([osm,provenance([11],'2026-10-16T00:00:00Z')]);assert.equal(grouped.sources,undefined);assert.deepEqual(grouped.osm_way_ids,[10,11]);
});
test('new SQL changes only source coverage and keeps canonical publish-integrity enforcement',async()=>{
  const sql=await readFile(resolve(__dirname,'../../../migrations/20261017_wa_catalog_source_bundles.sql'),'utf8');
  for(const fragment of ['wa_catalog_valid_source_provenance(leaf)','route_segment_provenance_compatible','wa_catalog_leaf_compatible(actual,claim)','wa_catalog_rebase_receipts',"trail_catalog_usfs_feature_ids($1->>'source_url') <@ trail_catalog_usfs_feature_ids($2->>'source_url')","trail_catalog_usfs_feature_ids(claim->>'source_url') <@ ARRAY(",'wa_catalog_union_provenance','jsonb_array_length(value->\'sources\') NOT BETWEEN 2 AND 128'])assert.ok(sql.includes(fragment),fragment);
  assert.ok(!/CREATE(?: OR REPLACE)? FUNCTION (?:public\.)?peaks_route_passes_publish_integrity/.test(sql));assert.ok(!sql.includes("SET status='active'"));
});
test('sparse acceptance uses weighted mean/max and preferred names; dense lines keep 50m/7%',()=>{
  const f=fixture(),base=f.segment.coords,sparse:Coord[]=Array.from({length:13},(_,i)=>[-121+.02*i/12,47+(i===6?.0008:0)]),dense:Coord[]=[];
  for(let i=1;i<sparse.length;i++)for(let j=0;j<20;j++)dense.push(interpolate(sparse[i-1],sparse[i],j/20));dense.push(sparse.at(-1)!);
  const assess=(coords:Coord[],name='River Trail')=>{const p=structuredClone(f.plan);p.legacy.coords=coords;p.legacy.name=name;p.legacy.trail_names=[];p.median_spacing_m=medianSpacing(coords);p.sparse=p.median_spacing_m>50;p.status='ok';p.reasons=[];finalizeRebases([p],[...f.segments.values()]);return p;};
  const a=assess(sparse),b=assess(dense);assert.equal(a.status,'ok',a.reasons.join());assert.ok(a.mean_deviation_m!<=40);assert.ok(a.hausdorff_m!>50&&a.hausdorff_m!<=150);assert.equal(a.mapped_name_fraction,1);assert.equal(b.status,'review');assert.ok(b.reasons.some(r=>r.includes('>50')));
  const unnamed=assess(sparse,'Unrelated Ridge');assert.equal(unnamed.status,'review');assert.ok(unnamed.reasons.some(r=>r.includes('<80%')));assert.ok(deviationStats(sparse,base).mean<40);
});
test('the original <=5m summit-contact span survives graph matching without moving endpoints',()=>{
  const basic=fixture(),coords=structuredClone(basic.segment.coords);coords[190][1]+=.000045;const summit:Coord=[coords[190][0],coords[190][1]+.000005];
  const f=fixture({coords},{summits:[{id:'goal',name:'Contact Peak',coord:summit}]}),line=routeLine(f.plan.row,f.segments);
  assert.ok(projection(summit,basic.segment.coords).distance>5);assert.ok(projection(summit,line).distance<5);assert.deepEqual(line[0],coords[0]);assert.deepEqual(line.at(-1),coords.at(-1));assert.ok([...f.segments.values()].some(s=>s.legacy_tail));
});
test('an old summit gap waits for the composed endpoint/link pass rather than failing map matching',()=>{
  const summit:Coord=[-120.98,47.000135],f=fixture({}, {summits:[{id:'goal',name:'Old Gap Peak',coord:summit}]});assert.equal(f.plan.status,'ok');assert.ok(!f.plan.reasons.some(r=>r.includes('existing summit contact Old Gap Peak')));
});
test('null legacy kind is inferred from its existing objective, without changing status or sessions',()=>{
  const f=fixture({kind:null},{objectiveFeatures:['campsite']}),p=replacementPlan(f.plan.row,f.segments,f.plan,{elevation:true});assert.equal(f.plan.row.kind,'destination');assert.ok(p.statements.some(s=>s.kind==='rebase_metadata'&&s.values[1]==='destination'));assert.ok(!p.statements.some(s=>/SET status=|session_routes/.test(s.sql)));
});

test('pure summit rebases use the composed kind/shape and contacted destination manifest',()=>{
  const f=fixture({kind:null,shape:null},{objectiveFeatures:['summit']}),p=replacementPlan(f.plan.row,f.segments,f.plan,{elevation:true});assert.equal(f.plan.row.kind,'summit');assert.ok(p.statements.some(s=>s.kind==='rebase_metadata'));assert.ok(p.statements.some(s=>s.kind==='replace_destinations'));
});
