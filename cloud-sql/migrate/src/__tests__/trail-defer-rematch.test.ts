import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Composer, digest, finalizeRows, materialize } from '../trail-graph/compose';
import { executePlan, planRoute, runPlans, type RoutePlan } from '../trail-graph/load-catalog';
import { replacementPlan } from '../trail-graph/load-rebase';
import { pilotPlan } from '../trail-graph/load-pilot';
import { prunePlan } from '../trail-graph/load-prune';
import { writeRematchNeeded } from '../trail-graph/load-rematch';
import { DEFER_REMATCH_SQL, destinationLinks, plannedSegmentLinks, segmentLinks } from '../trail-graph/load-sql';
import { WA_PILOTS } from '../trail-graph/pilot-routes';
import { finalizeRebases, mergePlans, rebaseDraft, rebasePlanHash, type LegacyRoute } from '../trail-graph/rebase';
import { splitSegment } from '../trail-graph/stretches';
import { provenance, refresh } from '../trail-graph/topology';
import type { CatalogInputs } from '../trail-graph/catalog-types';
import type { Segment } from '../trail-graph/types';

function fixture() {
  const data = JSON.parse(readFileSync(join(__dirname, 'fixtures/wa-compose.json'), 'utf8'));
  const s = refresh({ id: '', name: 'River Trail', trail_names: ['River Trail'], kind: 'trail', sac_scale: null, trail_visibility: null,
    osm_way_ids: [10], osm_edge_way_ids: [10, 10], relations: [], relation_names: [], start_node: '', end_node: '',
    coords: [[-121, 47], [-120.995, 47], [-120.99, 47]], node_ids: ['a', 'b', 'c'], length_m: 0,
    provenance: provenance([10], '2026-10-15T00:00:00Z'), alt_sources: [] } as Segment);
  const source = splitSegment(s, s.coords[1], 'forward').segments;
  const input: CatalogInputs = { ...data, seeds: [data.seed], segments: source, routes: [], popularity: [] }, composer = new Composer(input), draft = composer.compose(data.seed, 0);
  const legacy: LegacyRoute = { id: 'legacy', name: draft.row.name, status: 'active', kind: 'destination', shape: 'out_and_back', distance: s.length_m, gain: 1,
    objective_destination_id: 'lake', trailhead_destination_id: 'th', provenance_source: 'openstreetmap', n_sessions: 1, catalog_reviewed: false,
    factory_job: null, trail_names: ['River Trail'], segments: [{ id: 'whole', ordinal: 0, direction: 'forward', shared_by: 1 }], coords: s.coords };
  const rebase = rebaseDraft(legacy, composer.router, composer.byId), segments = materialize([draft, rebase.draft], composer.byId);
  finalizeRebases([rebase.plan], segments); finalizeRows([draft.row, rebase.plan.row], segments); rebase.plan.plan_hash = rebasePlanHash(rebase.plan);
  const byId = new Map(segments.map(s => [s.id, s])), merge = mergePlans([draft.row], [rebase.plan], segments)[0];
  return { row: draft.row, byId, rebase: rebase.plan, merge };
}
function clientFor(plan: RoutePlan, options: { failCommit?: boolean; alreadyActive?: boolean; alreadyApplied?: boolean } = {}) {
  const calls: string[] = [];
  return { calls, query: async (sql: string) => {
    calls.push(sql); assert.ok(!sql.includes('session_rematch_queue'), 'loader must neither scan nor enqueue the rematch queue');
    if (sql === 'COMMIT' && options.failCommit) throw new Error('commit failed');
    if (sql.includes('AS already_applied')) return { rows: [{ already_applied: !!options.alreadyApplied }], rowCount: 1 };
    if (sql.includes('AS links_match')) return { rows: [{ id: plan.route_id, name: plan.legacy_expected!.name, status: plan.legacy_expected!.status, owner: 'peaks', protected: false, links_match: true, source_match: true }], rowCount: 1 };
    if (sql.startsWith('SELECT r.id,r.status,')) return { rows: options.alreadyActive ? [{ id: plan.route_id, status: 'active', protected: false }] : [], rowCount: 0 };
    return { rows: [{ valid: true, complete: true }], rowCount: 1 };
  } };
}
test('every loader transaction defers trigger rematching immediately after BEGIN', () => {
  const f = fixture(), catalog = planRoute(f.row, f.byId), activate = planRoute(f.row, f.byId, { activate: true, elevation: true });
  const rebase = replacementPlan(f.rebase.row, f.byId, f.rebase), merge = replacementPlan(f.row, f.byId, f.rebase, {}, f.merge);
  for (const statements of [catalog.statements, activate.statements, rebase.statements, merge.statements, pilotPlan(WA_PILOTS[0].id), prunePlan([], [])]) {
    assert.ok(statements.length > 2); assert.equal(statements[0].sql, 'BEGIN'); assert.equal(statements[1].sql, DEFER_REMATCH_SQL);
    assert.equal(statements.filter(s => s.kind === 'defer_rematch').length, 1); assert.equal(statements.at(-1)!.sql, 'COMMIT');
  }
  const segmentLoader = readFileSync(resolve(__dirname, '../trail-graph/load-segments.ts'), 'utf8');
  assert.match(segmentLoader, /await client\.query\('BEGIN'\);\s*await client\.query\(DEFER_REMATCH_SQL\)/);
});
test('catalog, merge and rebase insert each ordered link collection in one SQL statement', () => {
  const f = fixture(); assert.equal(f.row.segments.length, 2);
  for (const plan of [planRoute(f.row, f.byId), replacementPlan(f.rebase.row, f.byId, f.rebase), replacementPlan(f.row, f.byId, f.rebase, {}, f.merge)]) {
    assert.equal(plan.skipped, undefined);
    const segments = plan.statements.filter(s => s.kind === 'route_segment_insert'), destinations = plan.statements.filter(s => s.kind === 'route_destination_insert');
    assert.equal(segments.length, 1); assert.equal(destinations.length, 1);
    for (const s of [...segments, ...destinations]) { assert.match(s.sql, /INSERT INTO route_(?:segments|destinations)/); assert.match(s.sql, /FROM jsonb_to_recordset\(\$2::jsonb\)/); assert.match(s.sql, /ORDER BY link\.ordinal ON CONFLICT DO NOTHING/); assert.equal(s.values[0], plan.route_id); }
    const links = plannedSegmentLinks(plan.statements); assert.equal(links.length, 2); assert.deepEqual(links.map(l => l.ordinal), [0, 1]);
    assert.deepEqual(JSON.parse(destinations[0].values[1] as string), plan.destination_ids.map((id, ordinal) => ({ id, ordinal })));
    const resume = plan.statements.find(s => s.kind === 'replacement_resume_guard');
    if (resume) { assert.deepEqual(JSON.parse(resume.values[1] as string), links); assert.equal(resume.values[2], digest(links.map(({ id, direction }) => ({ id, direction }))));
      assert.deepEqual(JSON.parse(plan.statements.find(s => s.kind === 'replacement_links_guard')!.values[1] as string), links); }
  }
  const reverse = segmentLinks('route', [{ id: 'two', direction: 'reverse' }, { id: 'one', direction: 'forward' }]);
  assert.deepEqual(plannedSegmentLinks([reverse]), [{ id: 'two', direction: 'reverse', ordinal: 0 }, { id: 'one', direction: 'forward', ordinal: 1 }]);
  assert.deepEqual(JSON.parse(destinationLinks('route', ['th', 'camp', 'goal']).values[1] as string).map((p: { id: string }) => p.id), ['th', 'camp', 'goal']);
});
test('only committed active or activated routes enter the rematch audit; failures and skips do not', async () => {
  const f = fixture(), pending = planRoute(f.row, f.byId), activate = planRoute(f.row, f.byId, { activate: true, elevation: true }), rebase = replacementPlan(f.rebase.row, f.byId, f.rebase);
  const affected = new Set<string>();
  await executePlan(clientFor(pending) as any, pending, f.byId, '.', undefined, affected); assert.equal(affected.size, 0);
  await assert.rejects(() => executePlan(clientFor(activate, { failCommit: true }) as any, activate, f.byId, '.', undefined, affected), /commit failed/); assert.equal(affected.size, 0);
  await assert.rejects(() => executePlan(clientFor(rebase, { failCommit: true }) as any, rebase, f.byId, '.', undefined, affected), /commit failed/); assert.equal(affected.size, 0);
  await executePlan(clientFor(activate, { alreadyActive: true }) as any, activate, f.byId, '.', undefined, affected); assert.equal(affected.size, 0);
  await executePlan(clientFor(rebase, { alreadyApplied: true }) as any, rebase, f.byId, '.', undefined, affected); assert.equal(affected.size, 0);
  await executePlan(clientFor(activate) as any, activate, f.byId, '.', undefined, affected);
  await executePlan(clientFor(rebase) as any, rebase, f.byId, '.', undefined, affected);
  assert.deepEqual([...affected].sort(), [activate.route_id, rebase.route_id].sort());
});
test('rematch receipts accumulate across modes and survive a later run failure after commit', async () => {
  const parent = resolve(__dirname, '../../../../.cache/rematch-tests'); await mkdir(parent, { recursive: true }); const dir = await mkdtemp(join(parent, 'run-'));
  try {
    await writeRematchNeeded(dir, ['earlier-active'], false); await writeRematchNeeded(dir, [], false);
    const f = fixture(), plan = planRoute(f.row, f.byId, { activate: true, elevation: true });
    await assert.rejects(() => runPlans(clientFor(plan) as any, [plan], f.byId, dir, { resultsFile: 'missing/results.json' }), /ENOENT/);
    const receipt = JSON.parse(await readFile(join(dir, 'rematch-needed.json'), 'utf8'));
    assert.equal(receipt.required, true); assert.deepEqual(receipt.route_ids, ['earlier-active', plan.route_id].sort()); assert.deepEqual(receipt.this_run_route_ids, [plan.route_id]);
    assert.match(receipt.instruction, /full rematch is required/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
