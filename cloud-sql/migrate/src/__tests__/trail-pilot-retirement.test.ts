import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { WA_PILOTS, isWaPilot, onlyWaPilots, PILOT_BATCH, PILOT_REJECTION } from '../trail-graph/pilot-routes';
import { loaderArgs, loaderMode } from '../trail-graph/loader-cli';
import { assertPilotsRetired, executePilot, pilotPlan, PILOT_SCHEMA, PILOT_STATE } from '../trail-graph/load-pilot';
import { adoptFrozenSegments, type FrozenSegment } from '../trail-graph/frozen-segments';
import { Composer, finalizeRows, materialize } from '../trail-graph/compose';
import { provenance, refresh } from '../trail-graph/topology';
import { planRoute } from '../trail-graph/load-catalog';
import type { CatalogInputs, PeaksRoute } from '../trail-graph/catalog-types';
import type { Segment } from '../trail-graph/types';
import { catalogGuard, companionMigration } from './trail-migration-fixtures';

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/wa-compose.json'), 'utf8'));
function graph(): Segment {
  return refresh({ id: '', name: 'River Trail', trail_names: ['River Trail'], kind: 'trail', sac_scale: null, trail_visibility: null,
    osm_way_ids: [10], osm_edge_way_ids: [10, 10], relations: [], relation_names: [], start_node: '', end_node: '',
    coords: [[-121, 47], [-120.995, 47], [-120.99, 47]], node_ids: ['a', 'b', 'c'], length_m: 0,
    provenance: provenance([10], '2026-10-15T00:00:00Z'), alt_sources: [] });
}
test('only the four approved pilot identities are excluded, including stale coarse reviewed flags', () => {
  assert.equal(WA_PILOTS.length, 4); assert.equal(new Set(WA_PILOTS.map(p => p.id)).size, 4);
  assert.ok(WA_PILOTS.every(p => isWaPilot(p.id)));
  assert.equal(isWaPilot('trail-unapproved'), false); assert.equal(onlyWaPilots([]), false);
  assert.equal(onlyWaPilots([WA_PILOTS[0].id, 'reviewed-route']), false);
  const existing = (id: string): PeaksRoute => ({ id, name: fixture.seed.name, status: 'pending', catalog_reviewed: true,
    distance: 800, n_sessions: 0, destinations: [], start: null, end: null });
  const input: CatalogInputs = { ...structuredClone(fixture), seeds: [fixture.seed], segments: [graph()], popularity: [],
    routes: [...WA_PILOTS.map(p => existing(p.id)), existing('genuinely-reviewed')] };
  const c = new Composer(input);
  assert.deepEqual(c.input.routes.map(r => r.id), ['genuinely-reviewed']); assert.equal(input.routes.length, 5);
  const normal = new Composer({ ...input, routes: input.routes.slice(0, 4) }), draft = normal.compose(fixture.seed, 0);
  const segments = materialize([draft], normal.byId); finalizeRows([draft.row], segments);
  assert.equal(draft.row.status, 'ok', draft.row.reasons.join()); assert.equal(draft.row.existing_route_match, null);
  assert.equal(planRoute(draft.row, new Map(segments.map(s => [s.id, s]))).skipped, undefined);
  draft.row.existing_route_match = { id: 'genuinely-reviewed', name: 'Frozen', catalog_reviewed: true, n_sessions: 0, start_gap_m: 0, end_gap_m: 0 };
  assert.match(planRoute(draft.row, new Map(segments.map(s => [s.id, s]))).skipped!, /catalog_reviewed/);
});
test('pilot-only frozen input is ignored; mixed ownership remains frozen and exact', () => {
  const segment = graph(), fixed: FrozenSegment = { id: 'old-fixed', name: segment.name, trail_names: segment.trail_names,
    provenance: segment.provenance, route_ids: [WA_PILOTS[0].id], coords: segment.coords.map(p => [...p, 100]) };
  const result = adoptFrozenSegments([segment], [fixed]);
  assert.deepEqual(result.segments, [segment]); assert.equal(result.audit.ignored_pilot_segments, 1); assert.equal(result.audit.fixed_segments, 0);
  const mixed = { ...fixed, route_ids: [...fixed.route_ids, 'reviewed-route'] }, preserved = adoptFrozenSegments([segment], [mixed]);
  assert.equal(preserved.audit.fixed_segments, 1); assert.equal(preserved.audit.ignored_pilot_segments, 0);
  assert.deepEqual(preserved.segments[0].frozen_catalog!.coords_xyz, fixed.coords);
});
test('old graph caches require a raw rebuild instead of inventing per-edge source rights', () => {
  const parent = graph(), old: Segment = { ...parent, id: 'old-fixed', frozen_catalog: { route_ids: [WA_PILOTS[0].id], coords_xyz: parent.coords.map(p => [...p, 100]) },
    provenance: { ...parent.provenance, elevation_source: 'old', elevation_profile: 'terrain' } as any };
  assert.throws(() => adoptFrozenSegments([old], []), /rebuild the graph from raw inputs/);
  assert.equal(old.frozen_catalog!.route_ids[0], WA_PILOTS[0].id); assert.equal(old.id, 'old-fixed');
});
test('retirement is an exclusive CLI mode and rejects combined or unknown flags', () => {
  assert.equal(loaderMode(loaderArgs(['--retire-pilot'])), 'retire-pilot');
  for (const flag of ['--rebase', '--prune-pending', '--activate', '--elevation', '--include-review', '--only-ok']) assert.throws(() => loaderArgs(['--retire-pilot', flag]));
  assert.throws(() => loaderArgs(['--retire-pilot --apply']), /Unknown/); assert.throws(() => loaderArgs(['--retire-pilot', '--typo']), /Unknown/);
  assert.throws(() => loaderArgs(['--retire-pilot'], 'segments'), /Unknown/);
});
test('retirement dry-run needs no graph files and performs no catalog or rebase work', async () => {
  const root = resolve(__dirname, '../../../../.cache/pilot-tests'); await mkdir(root, { recursive: true }); const dir = await mkdtemp(join(root, 'dry-'));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, TSX_DISABLE_CACHE: '1' }; delete env.DATABASE_URL; delete env.TEST_DATABASE_URL;
    const result = spawnSync(process.execPath, ['--import', 'tsx', resolve(__dirname, '../trail-graph/load-catalog.ts'), '--retire-pilot', '--out', dir, '--input', dir], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); const plan = JSON.parse(await readFile(join(dir, 'retire-pilot-plan.json'), 'utf8'));
    assert.equal(plan.mode, 'dry-run'); assert.equal(plan.batch, PILOT_BATCH); assert.equal(plan.rejection_reason, PILOT_REJECTION);
    assert.equal(plan.counts.transactions, 4); assert.equal(plan.counts.statements, 16);
    assert.deepEqual(await readdir(dir), ['retire-pilot-plan.json']);
    for (const p of plan.plans) assert.deepEqual(p.statements.map((s: any) => s.kind), ['begin', 'lock', 'retire_pilot', 'commit']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('retirement transactions roll back per candidate and can proceed with the next candidate', async () => {
  const calls: string[] = [], client = { query: async (sql: string, values?: unknown[]) => { calls.push(sql);
    if (sql.includes('retire_wa_catalog_pilot')) { if (values![0] === WA_PILOTS[0].id) throw new Error('pilot has review');
      return { rows: [{ result: { route_id: values![0], outcome: 'retired' } }] }; } return { rows: [] }; } };
  await assert.rejects(() => executePilot(client as any, pilotPlan(WA_PILOTS[0].id)), /review/); assert.equal(calls.at(-1), 'ROLLBACK');
  assert.deepEqual(await executePilot(client as any, pilotPlan(WA_PILOTS[1].id)), { route_id: WA_PILOTS[1].id, outcome: 'retired' }); assert.equal(calls.at(-1), 'COMMIT');
  assert.throws(() => pilotPlan('other-route'), /Not an approved/);
  await assert.rejects(() => executePilot(client as any, [{ kind: 'route_insert', sql: 'INSERT INTO routes', values: [] }]), /Non-retirement/);
  assert.ok(!calls.includes('INSERT INTO routes'));
  await assert.rejects(() => executePilot({ query: async () => ({ rows: [] }) } as any, pilotPlan(WA_PILOTS[1].id)), /receipt/);
});
test('later modes require live retirement of all four, even with stale offline snapshots', async () => {
  const client = (retired: boolean, ready = true) => ({ query: async (sql: string, values?: unknown[]) => {
    if (sql === PILOT_SCHEMA) return { rows: [{ ready, operator: true }] };
    assert.equal(sql, PILOT_STATE); assert.equal(values![1], PILOT_BATCH); assert.equal(values![2], PILOT_REJECTION);
    return { rows: WA_PILOTS.map((p, i) => ({ id: p.id, retired: i > 0 || retired })) };
  } });
  await assertPilotsRetired(client(true) as any); await assert.rejects(() => assertPilotsRetired(client(false) as any), /Run --retire-pilot first/);
  await assert.rejects(() => assertPilotsRetired(client(true, false) as any), /migration/);
});
test('owned SQL retirement retains receipts and checks exact pending identities and every reference class', () => {
  const sql = readFileSync(resolve(__dirname, '../../../migrations/20261017_wa_catalog_source_bundles.sql'), 'utf8');
  const fn = sql.match(/CREATE OR REPLACE FUNCTION retire_wa_catalog_pilot[\s\S]*?END \$\$;/)![0];
  for (const p of WA_PILOTS) assert.ok(fn.includes(`('${p.id}','${p.name}')`));
  for (const fragment of ['SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp', 'session_user<>table_owner', 'current_user<>table_owner',
    "job.state IS DISTINCT FROM 'pending'", "r.status IS DISTINCT FROM 'pending'", "job.batch_key IS DISTINCT FROM 'wa-cascades-20261013'",
    "job.route_id IS DISTINCT FROM p_route_id", "state='rejected',route_id=NULL", "'wa_graph_retirement'", "'outcome','already_retired'",
    'trail_catalog_review_jobs WHERE route_id=p_route_id OR source_key=job.source_key', 'wa_catalog_activation_receipts',
    'session_routes', 'list_routes', 'plan_routes', 'trip_report_routes', 'FOR UPDATE', 'NOT EXISTS(SELECT 1 FROM route_segments rs WHERE rs.segment_id=s.id)',
    "NOT wa_catalog_has_references('public.segments'::regclass,s.id)"]) assert.ok(fn.includes(fragment), fragment);
  assert.ok(fn.indexOf('UPDATE trail_catalog_candidate_jobs') < fn.indexOf('UPDATE routes SET status'));
  assert.ok(fn.indexOf('UPDATE routes SET status') < fn.indexOf('DELETE FROM route_segments'));
  assert.doesNotMatch(fn, /DELETE FROM (?:trail_catalog_candidate_jobs|trail_catalog_review_jobs|routes)\b/);
  assert.match(sql, /REVOKE ALL ON FUNCTION retire_wa_catalog_pilot\(TEXT\) FROM PUBLIC,"peaks-api","peaks-route-factory","peaks-route-reviewer"/);
});
test('narrow guard exception preserves every prior reviewed/publication check verbatim', () => {
  const previous = companionMigration('covers').sql;
  const current = readFileSync(resolve(__dirname, '../../../migrations/20261017_wa_catalog_source_bundles.sql'), 'utf8');
  const extra = catalogGuard(current).match(/  -- BEGIN approved pilot retirement exception[\s\S]*?  -- END approved pilot retirement exception\n/)![0];
  assert.equal(catalogGuard(current).replace(extra, ''), catalogGuard(previous));
  assert.match(extra, /\(to_jsonb\(NEW\)-ARRAY\['status','updated_at'\]\)=\(to_jsonb\(OLD\)-ARRAY\['status','updated_at'\]\)/);
  for (const fragment of ["OLD.status='pending' AND NEW.status='superseded'", 'current_user=session_user', "j.state='rejected' AND j.route_id IS NULL",
    'NOT EXISTS(SELECT 1 FROM trail_catalog_review_jobs', 'NOT EXISTS(SELECT 1 FROM wa_catalog_activation_receipts']) assert.ok(extra.includes(fragment));
  for (const p of WA_PILOTS) assert.ok(extra.includes(p.id));
  assert.doesNotMatch(current, /CREATE OR REPLACE FUNCTION (?:guard_trail_catalog_candidate_job|guard_trail_catalog_receipt_removal|guard_trail_catalog_reviewed_links|check_trail_catalog_candidate_job_final)\b/);
});
