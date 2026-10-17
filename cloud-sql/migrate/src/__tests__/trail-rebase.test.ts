import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rebaseDraft, finalizeRebases, rebasePlanHash, mergePlans, trimmedHausdorff, leased, cutLine, type LegacyRoute } from '../trail-graph/rebase';
import { replacementPlan } from '../trail-graph/load-rebase';
import { executePlan } from '../trail-graph/load-catalog';
import { TrailRouter } from '../trail-graph/router';
import { materialize, finalizeRows } from '../trail-graph/compose';
import { provenance, refresh } from '../trail-graph/topology';
import { length } from '../trail-graph/geo';
import type { Coord, Segment } from '../trail-graph/types';
import type { ComposedRoute } from '../trail-graph/catalog-types';

function setup(tail = false) {
  const coords: Coord[] = Array.from({ length: 101 }, (_, i) => [-121 + i * .0001, 47]);
  const s: Segment = refresh({ id: '', name: 'River Trail', trail_names: ['River Trail'], kind: 'trail', sac_scale: null, trail_visibility: null,
    osm_way_ids: [10], osm_edge_way_ids: coords.slice(1).map(() => 10), relations: [], relation_names: [], start_node: '', end_node: '', coords, node_ids: coords.map((_, i) => 'n'+String(i).padStart(3, '0')),
    length_m: 0, provenance: provenance([10], '2026-10-15T00:00:00Z'), alt_sources: [] });
  const old: LegacyRoute = { id: 'legacy', name: 'River Trail', status: 'active', kind: 'summit', shape: 'out_and_back', distance: length(coords), gain: 100,
    objective_destination_id: 'summit', trailhead_destination_id: 'th', provenance_source: 'openstreetmap', n_sessions: 5, catalog_reviewed: false, factory_job: null,
    segments: [{ id: 'whole-line', ordinal: 0, direction: 'forward', shared_by: 2 }], coords: tail ? [...coords, [-120.989, 47.001], [-120.988, 47.002]] : [...coords] };
  const router = new TrailRouter([s]), source = new Map([[s.id, s]]), { plan, draft } = rebaseDraft(old, router, source);
  const segments = materialize([draft], source); finalizeRebases([plan], segments); finalizeRows([plan.row], segments); plan.plan_hash = rebasePlanHash(plan);
  return { old, plan, source, segments: new Map(segments.map(s => [s.id, s])), draft };
}
test('legacy matching shares graph segments and retains a summit tail with source-bound rights', () => {
  const { old, plan, segments } = setup(true);
  assert.equal(plan.status, 'ok'); assert.ok(plan.graph_length_m > 0); assert.ok(plan.tail_length_m > 0);
  const refs = plan.row.segments, first = refs[0], last = refs.at(-1)!, a = segments.get(first.id)!, b = segments.get(last.id)!;
  assert.deepEqual(a.coords[first.direction === 'forward' ? 0 : a.coords.length-1], old.coords[0]);
  assert.deepEqual(b.coords[last.direction === 'forward' ? b.coords.length-1 : 0], old.coords.at(-1));
  const tails = [...segments.values()].filter(s => s.legacy_tail); assert.ok(tails.length); assert.ok(tails.every(s => s.legacy_tail!.route_id === old.id));
  assert.ok(tails.every(s => s.provenance.source_kind === 'peaks-legacy')); assert.ok(plan.hausdorff_m! <= 50);
});
test('trimmed symmetric Hausdorff and length checks do not accept a distant detour', () => {
  const a: Coord[] = [[-121,47],[-120.99,47]], b: Coord[] = [[-121,47],[-120.995,47.002],[-120.99,47]];
  assert.ok(trimmedHausdorff(a,b) > 150); assert.ok(length(cutLine(a,100,200)) > 99.9);
});
test('the router applies a legacy-line penalty before choosing a shorter remote alternative', () => {
  const { source }=setup(), direct=[...source.values()][0];
  const detour=refresh({ ...structuredClone(direct), coords:[direct.coords[0],[-120.995,47.001],direct.coords.at(-1)!],node_ids:[direct.node_ids[0],'detour',direct.node_ids.at(-1)!],osm_edge_way_ids:[11,11] });
  const router=new TrailRouter([direct,detour]);
  assert.equal(router.route(direct.coords[0],direct.coords.at(-1)!,{includeFeatures:false}).segments[0].segment_id,direct.id);
  assert.equal(router.route(direct.coords[0],direct.coords.at(-1)!,{includeFeatures:false,segmentPenalty:s=>s.id===direct.id?3:1}).segments[0].segment_id,detour.id);
});
test('frozen routes and live factory leases produce no replacement walk', () => {
  const { old, source } = setup(), router = new TrailRouter([...source.values()]);
  const frozen = rebaseDraft({ ...old, catalog_reviewed: true }, router, source); assert.equal(frozen.plan.status,'review'); assert.equal(frozen.draft.walk.length,0);
  assert.equal(leased({ ...old, factory_job: { state:'researching',lease_expires_at:'2099-01-01T00:00:00Z' } }),true);
  assert.equal(leased({ ...old, factory_job: 'researching' }),false); // State alone does not prove a live lease.
  const busy = rebaseDraft({ ...old, factory_job:{ state:'researching',lease_expires_at:'2099-01-01T00:00:00Z' } },router,source); assert.match(busy.plan.reasons.join(),/lease/);
});
test('a line wholly outside the graph fails rather than passing as a copied legacy route', () => {
  const { old, source } = setup(), router = new TrailRouter([...source.values()]);
  const result = rebaseDraft({ ...old, coords: old.coords.map(([x,y])=>[x,y+.1]) },router,source); assert.equal(result.plan.status,'failed');
});
test('merge requires symmetric 90% shared length or identical place IDs within 5%; prefixes and Old/New differ', () => {
  const { plan, segments } = setup(), row: ComposedRoute = structuredClone(plan.row); row.seed_index=2;
  assert.equal(mergePlans([row],[plan],[...segments.values()]).length,1);
  const short = { ...structuredClone(row), length_m:row.length_m/2, trailhead:null, objective:null };
  assert.equal(mergePlans([short],[plan],[...segments.values()]).length,0);
  assert.equal(mergePlans([{ ...row,name:'River via Old Trail' }],[plan],[...segments.values()]).length,0);
  const samePlaces = { ...structuredClone(row), segments:[], length_m:row.length_m*1.04 };
  assert.equal(mergePlans([samePlaces],[plan],[...segments.values()]).length,0);
  const alt={...structuredClone([...segments.values()][0]),id:'same-places-other-span'};
  const withOtherSpan={...structuredClone(row),segments:[{id:alt.id,direction:'forward' as const}],length_m:row.length_m*1.04};
  assert.equal(mergePlans([withOtherSpan],[plan],[...segments.values(),alt])[0].same_endpoints,true);
  assert.equal(mergePlans([{...withOtherSpan,objective:{peaks_id:'other'}}],[plan],[...segments.values(),alt]).length,0);
});
test('rebase SQL preserves identity/status/session facts, locks jobs, and deletes only unreferenced old segments', () => {
  const { plan, segments } = setup(true), unused = { ...structuredClone([...segments.values()][0]), id: 'frozen-unused', frozen_catalog: { route_ids: ['frozen-route'], coords_xyz: [[-121, 47, 100], [-120.99, 47, 200]] } };
  segments.set(unused.id, unused);
  const p = replacementPlan(plan.row,segments,plan,{ elevation:true });
  const cleanup = p.statements.find(s => s.kind === 'delete_unused_legacy_segments')!;
  assert.match(cleanup.sql, /NOT\(id=ANY\(\$3::text\[\]\)\)/); assert.deepEqual(cleanup.values[2], ['frozen-unused']);
  assert.ok(!p.skipped); assert.equal(p.route_id,'legacy'); assert.equal(p.operation,'rebase');
  assert.ok(p.statements.some(s=>s.kind==='factory_lock')); assert.ok(p.statements.some(s=>s.kind==='active_integrity'));
  assert.ok(!p.statements.some(s=>/session_routes/.test(s.sql) || /SET status=/.test(s.sql)));
  assert.match(p.statements.find(s=>s.kind==='delete_unused_legacy_segments')!.sql,/NOT EXISTS\(SELECT 1 FROM route_segments/);
  const tail=p.statements.find(s=>s.kind==='legacy_tail_insert')!; assert.match(tail.sql,/FROM routes WHERE id=\$11 AND owner='peaks'/);assert.match(tail.sql,/created_at AT TIME ZONE/);
});
test('competing catalog aliases are suppressed instead of falling back to duplicate creation', () => {
  const {plan,segments}=setup(), a={...structuredClone(plan.row),seed_index:1},b={...structuredClone(plan.row),seed_index:2,name:'River alias'};
  const proposals=mergePlans([a,b],[plan],[...segments.values()]); assert.equal(proposals.length,2); assert.equal(proposals.filter(p=>p.status==='ok').length,1);
  assert.match(proposals.find(p=>p.status==='review')!.reasons.join(),/suppress duplicate/);
});
test('failed active integrity rolls back without deleting the old segment or touching session rows', async () => {
  const { plan, segments } = setup(), p = replacementPlan(plan.row,segments,plan,{ elevation:true }), calls:string[]=[];
  const client={ query:async (sql:string)=>{ calls.push(sql); return { rowCount:1, rows:sql.includes('AS links_match,')?[{id:'legacy',name:'River Trail',status:'active',owner:'peaks',protected:false,links_match:true,source_match:true}]:sql.includes('AS complete')?[{complete:true}]:sql.includes("status<> 'active'")?[{valid:false}]:sql.includes('AS valid')?[{valid:true}]:[] }; } };
  await assert.rejects(()=>executePlan(client as any,p,segments,'.'),/active_integrity/); assert.equal(calls.at(-1),'ROLLBACK'); assert.ok(!calls.some(s=>s.startsWith('DELETE FROM segments')));
});
test('merge keeps the legacy route and existing links/slug, applies composer links, and never activates it', () => {
  const { plan, segments }=setup(), row=structuredClone(plan.row); row.seed_index=3; row.name='Mount Example via River Trail'; row.wta_url='https://www.wta.org/go-hiking/hikes/example'; finalizeRows([row],[...segments.values()]);
  const merge=mergePlans([row],[plan],[...segments.values()])[0]; assert.ok(merge);
  const p=replacementPlan(row,segments,plan,{elevation:true},merge), update=p.statements.find(s=>s.kind==='merge_metadata')!;
  assert.equal(p.operation,'merge'); assert.ok(update); assert.match(update.sql,/COALESCE\(NULLIF\(slug,''\)/); assert.match(update.sql,/external_links=COALESCE/); assert.equal(update.values[1],'River Trail');
  assert.ok(!p.statements.some(s=>s.kind==='route_insert'||s.kind==='activate'||s.kind.startsWith('session_routes')));
});
test('a valid replacement can resume without rewriting the route or resampling it', async () => {
  const {plan,segments}=setup(),p=replacementPlan(plan.row,segments,plan,{elevation:true}),calls:string[]=[];
  const client={query:async(sql:string)=>{calls.push(sql);return{rows:sql.includes('AS already_applied')?[{already_applied:true}]:[],rowCount:0};}};
  assert.match(await executePlan(client as any,p,segments,'.'),/already applied/);assert.equal(calls.at(-1),'ROLLBACK');assert.ok(!calls.some(s=>s.startsWith('INSERT')||s.startsWith('DELETE')));
});
test('Josiah preflight retains Triple Crown exclusion and clipped UTM buffering', () => {
  const sql=readFileSync(join(__dirname,'../trail-graph/load-preflight.ts'),'utf8');
  for(const fragment of ["s.id NOT LIKE 'triple-crown-%'","AND NOT (s.id LIKE 'wa-%' AND s.provenance #>> '{wa_catalog,loader}' IS NOT NULL)",'ST_ClipByBox2D','incoming.path_m','32610','32611']) assert.ok(sql.includes(fragment));
  const { plan, segments } = setup();
  assert.match(replacementPlan(plan.row, segments, plan).statements.find(s => s.kind === 'replacement_guard')!.sql, /<=0\.25 AS source_match/);
});
test('dense lines retain selected original spans to fix shortening without relaxing length or geometry gates', () => {
  const { old, source } = setup(), segment = [...source.values()][0];
  const coords: Coord[] = Array.from({ length: 601 }, (_, i) => [-121 + i * .00002, 47 + .000015 * Math.sin(i * Math.PI / 4)]);
  const graph = refresh({ ...structuredClone(segment), coords: coords.map(([x]) => [x, 47]), node_ids: coords.map((_, i) => `v${String(i).padStart(4, '0')}`), osm_edge_way_ids: coords.slice(1).map(() => 10) });
  const byId = new Map([[graph.id, graph]]), { plan, draft } = rebaseDraft({ ...old, coords }, new TrailRouter([graph]), byId);
  const segments = materialize([draft], byId); finalizeRebases([plan], segments);
  assert.equal(plan.sparse, false); assert.equal(plan.status, 'ok', plan.reasons.join());
  assert.ok(plan.reasons.some(r => r.includes('mapped length distortion')));
  assert.ok(plan.deviation_fraction! <= .07); assert.ok(plan.hausdorff_m! <= 50);
  assert.ok(plan.tail_length_m > 0 && plan.tail_length_m / plan.row.length_m <= .8); assert.ok(plan.graph_length_m > 0);
  const huge = rebaseDraft({ ...old, coords: coords.map(([x, y]) => [x, y + .1]) }, new TrailRouter([graph]), new Map([[graph.id, graph]]));
  assert.equal(huge.plan.status, 'failed');
});
