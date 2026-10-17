import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Composer, catalogRouteId, compositionHash, digest, finalizeRows, materialize, segmentManifestHash } from '../trail-graph/compose';
import { compositionValid, planRoute } from '../trail-graph/load-catalog';
import { digestValue } from '../trail-graph/discovery-catalog';
import { activateBulkBatch, batches, buildBulkBatch, bulkId, bulkPreflightValues,
  executeBulkBatch, fatalBulkError, insidePoly, parsePoly, loadIsolated, planBulkActivation, planBulkBatch, runLoadBulkBatch, type BulkBatch } from '../trail-graph/load-bulk';
import { BULK_PREFLIGHT_SQL, readBulkPreflight, type BulkPreflight } from '../trail-graph/load-bulk-preflight';
import { IMPORT_MARKER } from '../trail-graph/load-matching';
import { loaderArgs, loaderMode } from '../trail-graph/loader-cli';
import { provenance, refresh } from '../trail-graph/topology';
import type { CatalogInputs, ComposedRoute } from '../trail-graph/catalog-types';
import type { Segment } from '../trail-graph/types';

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/wa-compose.json'), 'utf8'));
function setup() {
  const segment = refresh({ id: '', name: 'River Trail', trail_names: ['River Trail'], kind: 'trail', sac_scale: null, trail_visibility: null,
    osm_way_ids: [10], osm_edge_way_ids: [10, 10], relations: [], relation_names: [], start_node: '', end_node: '',
    coords: [[-121, 47], [-120.995, 47], [-120.99, 47]], node_ids: ['1', '2', '3'], length_m: 0,
    provenance: provenance([10], '2026-10-15T00:00:00Z'), alt_sources: [] } as Segment);
  const input: CatalogInputs = { ...structuredClone(fixture), seeds: [fixture.seed], segments: [segment], routes: [], popularity: [] };
  const composer = new Composer(input), draft = composer.compose(fixture.seed, 0);
  const source = new Map(materialize([draft], composer.byId).map(s => [s.id, s]));
  assert.equal(draft.row.status, 'ok', draft.row.reasons.join());
  return { row: draft.row, source };
}
function rehash(row: ComposedRoute): void {
  row.composition_hash = digest({ ...row, route_id: undefined, composition_hash: undefined });
  row.route_id = catalogRouteId(row);
}
function live(overrides: Partial<BulkPreflight> = {}): BulkPreflight {
  return { ready: true, lease_bound_worker: false, cover_trigger_absent: true,
    destinations: structuredClone(fixture.destinations), routes: [], segments: [], overlaps: [], ...overrides };
}
function profiles(source: Map<string, Segment>): Map<string, number[][]> {
  return new Map([...source].map(([id, s]) => [id, s.coords.map(([x, y], i) => [x, y, 100 + i * 12])]));
}
function batchClient(batch: BulkBatch, options: { binding?: boolean; rebuild?: boolean; inserted?: number; refreshError?: boolean } = {}) {
  const calls: string[] = [];
  const client = { query: async (sql: string, values?: unknown[]) => {
    calls.push(sql);
    if (sql.startsWith('INSERT INTO routes(')) return { rows: batch.ids.map(id => ({ id })), rowCount: options.inserted ?? batch.ids.length };
    if (sql.includes('AS valid')) return { rows: [{ valid: options.binding ?? true }], rowCount: 1 };
    if (sql.includes('rebuild_route_paths')) return { rows: [{ results: (values![0] as string[]).map(route_id => ({ route_id, success: options.rebuild ?? true, error: options.rebuild === false ? 'bad path' : undefined })) }], rowCount: 1 };
    if (sql.includes('refresh_route_derivations') && options.refreshError) throw new Error('refresh failed');
    return { rows: [], rowCount: 0 };
  } };
  return { calls, client: client as any };
}

test('bulk plans keep five collection inserts and twelve transaction statements at one or 200 routes', () => {
  const { row, source } = setup();
  for (const count of [1, 200]) {
    const rows = Array.from({ length: count }, (_, i) => { const result = structuredClone(row); result.name += ` ${i}`; result.seed_index = i; rehash(result); return result; });
    const plan = planBulkBatch(rows, source, 'OR'), batch = buildBulkBatch(plan, profiles(plan.segments));
    assert.equal(plan.skipped.length, 0);
    assert.equal(batch.ids.length, count);
    assert.equal(batch.statements.length, 13);
    assert.deepEqual(batch.statements.map(s => s.kind), ['begin', 'defer_rematch', 'timeouts', 'defer_derivations',
      'destination_insert', 'segment_insert', 'route_insert', 'route_segment_insert', 'route_destination_insert',
      'binding_guard', 'rebuild', 'refresh', 'commit']);
    const inserts = batch.statements.filter(s => s.sql.startsWith('INSERT'));
    assert.equal(inserts.length, 5);
    for (const insert of inserts) {
      assert.match(insert.sql, /FROM jsonb_to_recordset\(\$1::jsonb\)/);
      assert.match(insert.sql, /ON CONFLICT(?:\(id\))? DO NOTHING/);
      assert.equal(insert.values.length, 1);
      assert.ok(Array.isArray(JSON.parse(insert.values[0] as string)));
    }
    assert.equal(JSON.parse(batch.statements.find(s => s.kind === 'route_insert')!.values[0] as string).length, count);
    assert.equal(JSON.parse(batch.statements.find(s => s.kind === 'segment_insert')!.values[0] as string).length, 1, 'shared segment is inserted once');
    assert.deepEqual(batch.statements.find(s => s.kind === 'rebuild')!.values, [batch.ids]);
    assert.deepEqual(batch.statements.find(s => s.kind === 'refresh')!.values, [batch.ids]);
    assert.ok(batch.statements.every(s => !/DISABLE TRIGGER|session_replication_role|session_rematch_queue|UPDATE segments/.test(s.sql)));
  }
});

test('discovery rows hash and name themselves as the loader checks, and a tampered row still fails', () => {
  const { row, source } = setup();
  // Discovery writes route_id first, then the hash (compose-discover.ts).
  const disc: ComposedRoute = { ...structuredClone(row), state_code: 'OR', discovery_source: 'named_trail', discovery_identity: 'trail:river' };
  disc.route_id = catalogRouteId(disc); disc.composition_hash = compositionHash(disc);
  assert.equal(digestValue, digest);
  assert.match(disc.route_id, /^or-catalog-/);
  assert.equal(compositionValid(JSON.parse(JSON.stringify(disc))), true);
  const plan = planBulkBatch([JSON.parse(JSON.stringify(disc))], source, 'OR');
  assert.deepEqual(plan.skipped, []);
  assert.equal(plan.routes[0].id, disc.route_id);
  for (const tamper of [(r: ComposedRoute) => { r.name += ' X'; }, (r: ComposedRoute) => { r.state_code = 'ID'; }, (r: ComposedRoute) => { r.route_id = 'or-catalog-000000000000000000000000'; }]) {
    const bad = structuredClone(disc); tamper(bad);
    assert.equal(compositionValid(bad), false);
    assert.match(planBulkBatch([bad], source, 'OR').skipped[0].skipped ?? '', /invalid plan: Composition hash mismatch|is ID, not OR/);
  }
  assert.throws(() => planRoute(disc, source, { stateCode: 'CA' }), /is OR, not CA/);
});

test('state mapping preserves the source composition and tags every inserted collection', () => {
  const { row, source } = setup();
  row.trailhead = { new: { name: 'New River Trailhead', feature: 'trailhead', lng: -121, lat: 47, source: { kind: 'osm', osm_id: 'node/555' } } };
  rehash(row);
  const original = JSON.stringify({ row, source: [...source] });
  for (const state of ['OR', 'CA', 'ID'] as const) {
    const plan = planBulkBatch([row], source, state), batch = buildBulkBatch(plan, profiles(plan.segments));
    assert.equal(plan.skipped.length, 0);
    assert.equal(batch.ids[0], bulkId(row.route_id!, state));
    for (const kind of ['destination_insert', 'segment_insert', 'route_insert']) {
      const records = JSON.parse(batch.statements.find(s => s.kind === kind)!.values[0] as string);
      assert.ok(records.length > 0);
      for (const record of records) {
        assert.equal(record.state_code, state);
        assert.ok(record.id.startsWith(`${state.toLowerCase()}-`));
        if (kind === 'destination_insert') assert.equal(record.metadata.provenance.wa_catalog.state_code, state);
        else assert.equal(record.provenance.wa_catalog.state_code, state);
      }
    }
    assert.deepEqual(bulkId(batch.ids[0], state), batch.ids[0]);
  }
  assert.equal(JSON.stringify({ row, source: [...source] }), original);
});

test('bulk rerun planning skips already-loaded IDs and admits shared assets owned by this loader', () => {
  const { row, source } = setup(), initial = planBulkBatch([row], source, 'CA', live());
  assert.equal(initial.routes.length, 1);
  const committed = live({ routes: [{ id: initial.routes[0].id, status: 'pending', loader: IMPORT_MARKER,
    state_code: 'CA', composition_hash: row.composition_hash!, reviewed: false }] });
  const rerun = planBulkBatch([row], source, 'CA', committed);
  assert.equal(rerun.routes.length, 0);
  assert.equal(rerun.skipped[0].skipped, 'already loaded');
  assert.equal(buildBulkBatch(rerun).ids.length, 0);
  const next = structuredClone(row); next.name += ' Second Approach'; rehash(next);
  const shared = planBulkBatch([next], source, 'CA', committed);
  assert.equal(shared.routes.length, 1, 'another route may use an already-imported segment');
  assert.equal(shared.skipped.length, 0);
});

test('activation planning requires an already-loaded pending route with matching owner, state and validated composition', () => {
  const { row, source } = setup(), id = bulkId(row.route_id!, 'OR');
  const unloaded = planBulkActivation(planBulkBatch([row], source, 'OR', live()));
  assert.deepEqual(unloaded.ids, []);
  assert.equal(unloaded.skipped[0].skipped, 'route is not loaded');
  const stored = { id, status: 'pending', loader: IMPORT_MARKER, state_code: 'OR', composition_hash: row.composition_hash!, reviewed: false };
  const pending = planBulkActivation(planBulkBatch([row], source, 'OR', live({ routes: [stored] })));
  assert.deepEqual(pending.ids, [id]);
  assert.deepEqual(pending.skipped, []);
  for (const [changes, reason] of [
    [{ status: 'active' }, 'route is already active'],
    [{ reviewed: true }, 'catalog review/candidate route is protected'],
    [{ state_code: 'CA' }, 'existing route is not owned by this loader and state'],
    [{ loader: null }, 'existing route is not owned by this loader and state'],
    [{ loader: 'another-loader' }, 'existing route is not owned by this loader and state'],
    [{ composition_hash: '0'.repeat(64) }, 'stored composition differs'],
    [{ composition_hash: null }, 'stored composition differs'],
  ] as const) {
    const result = planBulkActivation(planBulkBatch([row], source, 'OR', live({ routes: [{ ...stored, ...changes }] })));
    assert.deepEqual(result.ids, []);
    assert.equal(result.skipped[0].skipped, reason);
    assert.equal(result.skipped[0].operation, 'activate');
  }
  const review = planBulkActivation(planBulkBatch([{ ...row, status: 'review' }], source, 'OR', live({ routes: [stored] })));
  assert.deepEqual(review.ids, []);
  assert.equal(review.skipped[0].skipped, 'composition status review');
});

test('external Peaks overlaps skip whole routes, while review, stale hashes and frozen partials stay blocked', () => {
  const { row, source } = setup(), id = bulkId(row.segments[0].id, 'ID');
  const overlap = planBulkBatch([row], source, 'ID', live({ overlaps: [{ new_id: id, existing_id: 'legacy-peaks-route' }] }));
  assert.equal(overlap.routes.length, 0);
  assert.equal(overlap.skipped[0].skipped, 'overlaps existing Peaks route');
  const review = { ...row, status: 'review' as const };
  assert.equal(planBulkBatch([review], source, 'ID').skipped[0].skipped, 'composition status review');
  const altered = structuredClone(row); altered.name += ' changed';
  assert.match(planBulkBatch([altered], source, 'ID').skipped[0].skipped!, /Composition hash mismatch/);
  const partial = new Map(source); partial.set(row.segments[0].id, { ...source.get(row.segments[0].id)!, frozen_partial: { segment_id: 'frozen', from_vertex: 0, to_vertex: 1 } });
  assert.match(planBulkBatch([row], partial, 'ID').skipped[0].skipped!, /review-only/);
});

test('frozen IDs and XYZ remain fixed and never enter a segment INSERT', () => {
  const { row, source } = setup(), first = source.get(row.segments[0].id)!;
  first.frozen_catalog = { route_ids: ['reviewed'], coords_xyz: first.coords.map(([x, y], i) => [x, y, 210 + i]) };
  row.segment_manifest_hash = segmentManifestHash(row.segments.map(s => s.id), source); rehash(row);
  const old = { id: first.id, name: first.name, display_name: first.display_name ?? first.trail_names[0], description: first.description ?? null,
    kind: first.kind, provenance: first.provenance, path: { coordinates: first.frozen_catalog.coords_xyz }, complete: true };
  const plan = planBulkBatch([row], source, 'OR', live({ segments: [old] })), batch = buildBulkBatch(plan, new Map());
  assert.equal(plan.skipped.length, 0);
  assert.equal(plan.routes[0].refs[0].id, first.id);
  assert.deepEqual(JSON.parse(batch.statements.find(s => s.kind === 'segment_insert')!.values[0] as string), []);
  const checks = JSON.parse(batch.statements.find(s => s.kind === 'binding_guard')!.values[0] as string);
  assert.deepEqual(JSON.parse(checks[0].geometry).coordinates, first.frozen_catalog.coords_xyz);
  assert.throws(() => buildBulkBatch(planBulkBatch([row], source, 'OR', live()), new Map()), /Frozen segment is missing/);
});

test('stored segment GeoJSON rounding preserves source XY in the binding guard and inserts no existing geometry', () => {
  const { row, source } = setup(), first = source.get(row.segments[0].id)!;
  // Near-zero longitude lets this double retain more than 15 decimal places.
  first.coords = [[0, 47], [0.005123456789012345, 47], [0.01, 47]];
  row.trailhead = { new: { name: 'Precision Trailhead', feature: 'trailhead', lng: 0, lat: 47, source: { kind: 'osm', osm_id: 'node/700' } } };
  row.objective = { new: { name: 'Precision Lake', feature: 'lake', lng: 0.01, lat: 47, source: { kind: 'osm', osm_id: 'node/701' } } };
  row.waypoints = []; row.route_start = first.coords[0]; row.route_end = first.coords.at(-1)!;
  finalizeRows([row], [...source.values()]);
  const rounded = first.coords.map(([x, y], i) => [Number(x.toFixed(15)), Number(y.toFixed(15)), 300 + i]);
  assert.notEqual(rounded[1][0], first.coords[1][0]);
  assert.ok(Math.abs(rounded[1][0] - first.coords[1][0]) < 1e-9);
  const old = { id: bulkId(first.id, 'OR'), name: first.name, display_name: first.display_name ?? first.trail_names[0], description: first.description ?? null,
    kind: first.kind, provenance: first.provenance, path: { coordinates: rounded }, path_hash: 'a'.repeat(32), complete: true };
  const plan = planBulkBatch([row], source, 'OR', live({ destinations: [], segments: [old] }));
  assert.equal(plan.skipped.length, 0);
  const batch = buildBulkBatch(plan, new Map());
  assert.deepEqual(JSON.parse(batch.statements.find(s => s.kind === 'segment_insert')!.values[0] as string), []);
  const guard = batch.statements.find(s => s.kind === 'binding_guard')!, checks = JSON.parse(guard.values[0] as string);
  assert.deepEqual(JSON.parse(checks[0].geometry).coordinates, first.coords);
  assert.notDeepEqual(JSON.parse(checks[0].geometry).coordinates, rounded);
  assert.equal(checks[0].old_path_hash, old.path_hash);
  assert.match(guard.sql, /ORDER BY s\.id FOR SHARE OF s/);
  assert.match(guard.sql, /md5\(ST_AsEWKB\(s\.path::geometry\)\) IS DISTINCT FROM expected\.old_path_hash/);
  assert.match(guard.sql, /s\.provenance IS DISTINCT FROM expected\.provenance/);
});

test('a changed stored frozen Z never replaces the saved snapshot in the binding payload', () => {
  const { row, source } = setup(), first = source.get(row.segments[0].id)!;
  const saved = first.coords.map(([x, y], i) => [x, y, 210 + i]);
  first.frozen_catalog = { route_ids: ['reviewed'], coords_xyz: saved };
  finalizeRows([row], [...source.values()]);
  const changed = saved.map(([x, y, z]) => [x, y, z + 50]);
  const old = { id: first.id, name: first.name, display_name: first.display_name ?? first.trail_names[0], description: first.description ?? null,
    kind: first.kind, provenance: first.provenance, path: { coordinates: changed }, complete: true };
  const plan = planBulkBatch([row], source, 'CA', live({ segments: [old] })), batch = buildBulkBatch(plan, new Map());
  assert.equal(plan.skipped.length, 0);
  assert.deepEqual(JSON.parse(batch.statements.find(s => s.kind === 'segment_insert')!.values[0] as string), []);
  const guard = batch.statements.find(s => s.kind === 'binding_guard')!, checks = JSON.parse(guard.values[0] as string);
  assert.equal(checks[0].frozen, true);
  assert.deepEqual(JSON.parse(checks[0].geometry).coordinates, saved);
  assert.notDeepEqual(JSON.parse(checks[0].geometry).coordinates, changed);
  assert.match(guard.sql, /expected\.frozen AND ST_AsEWKB/);
});

test('one set-based read-only preflight binds all batch routes, segments and place keys', async () => {
  const { row, source } = setup();
  row.trailhead = { new: { name: 'River Trailhead', feature: 'trailhead', lng: -121, lat: 47, source: { kind: 'osm', osm_id: 'node/555' } } }; rehash(row);
  const values = bulkPreflightValues([row, row], source, 'OR'), calls: string[] = [];
  const expected = live();
  const actual = await readBulkPreflight({ query: async (sql: string, args: unknown[]) => { calls.push(sql); assert.deepEqual(args, values); return { rows: [expected] }; } } as any, values, false);
  assert.equal(actual, expected);
  assert.deepEqual(calls, [BULK_PREFLIGHT_SQL]);
  assert.equal(JSON.parse(values[0] as string).length, 1);
  assert.deepEqual(values[1], [bulkId(row.route_id!, 'OR'), bulkId(row.route_id!, 'OR')]);
  assert.equal(JSON.parse(values[2] as string)[0].external_ids.osm_node, '555');
  assert.doesNotMatch(BULK_PREFLIGHT_SQL, /\b(?:INSERT INTO|UPDATE|DELETE FROM)\b/);
  assert.match(BULK_PREFLIGHT_SQL, /ST_ClipByBox2D/);
  assert.match(BULK_PREFLIGHT_SQL, /32600\+LEAST/);
  assert.match(BULK_PREFLIGHT_SQL, /NOT \(COALESCE\(s\.provenance#>>'\{wa_catalog,loader\}'=\$4,false\) AND s\.state_code=\$6\)/);
  assert.match(BULK_PREFLIGHT_SQL, /NOT \(COALESCE\(r\.provenance#>>'\{wa_catalog,loader\}'=\$4,false\) AND r\.state_code=\$6\)/);
  await assert.rejects(() => readBulkPreflight({ query: async () => ({ rows: [live({ ready: false })] }) } as any, values, false), /Install/);
  await assert.rejects(() => readBulkPreflight({ query: async () => ({ rows: [live({ lease_bound_worker: true })] }) } as any, values, false), /operator connection/);
  await assert.rejects(() => readBulkPreflight({ query: async () => ({ rows: [live({ cover_trigger_absent: false })] }) } as any, values, true), /must be absent/);
});

test('review and missing geometry rows do not abort the whole batch preflight', () => {
  const { row, source } = setup();
  const review = { ...structuredClone(row), status: 'review' as const, route_id: 'wa-review', segments: [{ id: 'missing-review', direction: 'forward' as const }] };
  const missing = { ...structuredClone(row), route_id: 'wa-missing', segments: [{ id: 'missing-ok', direction: 'forward' as const }] };
  const values = bulkPreflightValues([row, review, missing], source, 'CA');
  assert.equal(JSON.parse(values[0] as string).length, 1);
  assert.ok(!(values[1] as string[]).includes('ca-review'));
  assert.equal(planBulkBatch([review], source, 'CA').skipped[0].skipped, 'composition status review');
  assert.equal(planBulkBatch([missing], source, 'CA').routes.length, 0);
});

test('batch execution commits only after complete rebuild and derivation refresh; failures roll back', async () => {
  const { row, source } = setup(), plan = planBulkBatch([row], source, 'OR'), batch = buildBulkBatch(plan, profiles(plan.segments));
  const success = batchClient(batch); await executeBulkBatch(success.client, batch);
  assert.deepEqual(success.calls, batch.statements.map(s => s.sql));
  for (const options of [{ binding: false }, { rebuild: false }, { inserted: 0 }, { refreshError: true }]) {
    const failed = batchClient(batch, options);
    await assert.rejects(() => executeBulkBatch(failed.client, batch));
    assert.equal(failed.calls.at(-1), 'ROLLBACK');
    assert.ok(!failed.calls.includes('COMMIT'));
    if ('rebuild' in options) assert.ok(!failed.calls.some(sql => sql.includes('refresh_route_derivations')));
  }
  const empty = batchClient({ ids: [], statements: [] }); await executeBulkBatch(empty.client, { ids: [], statements: [] });
  assert.deepEqual(empty.calls, []);
});

test('batch sampling finishes before BEGIN and a sampler failure issues no transaction', async () => {
  const { row, source } = setup(), plan = planBulkBatch([row], source, 'OR'), batch = buildBulkBatch(plan, profiles(plan.segments));
  const success = batchClient(batch), events: string[] = [];
  const client = { query: async (sql: string, values?: unknown[]) => { events.push(sql); return success.client.query(sql, values); } } as any;
  const sampler = async (segments: Segment[], options: { cacheDir: string; concurrency?: number }) => {
    assert.equal(events.length, 0);
    assert.equal(options.cacheDir, 'local-tiles'); assert.equal(options.concurrency, 8);
    events.push('sample start'); await Promise.resolve(); events.push('sample end');
    return profiles(new Map(segments.map(s => [s.id, s])));
  };
  await runLoadBulkBatch(client, plan, 'local-tiles', sampler);
  assert.deepEqual(events.slice(0, 3), ['sample start', 'sample end', 'BEGIN']);
  const never = batchClient(batch);
  await assert.rejects(() => runLoadBulkBatch(never.client, plan, 'local-tiles', async () => { throw new Error('tile failed'); }), /tile failed/);
  assert.deepEqual(never.calls, []);
});

test('activation commits per-route successes and failures from one call with at most 200 IDs', async () => {
  const ids = ['or-route-a', 'or-route-b'], calls: string[] = [];
  const client = { query: async (sql: string, values?: unknown[]) => {
    calls.push(sql);
    if (sql.includes('activate_wa_catalog_routes')) { assert.deepEqual(values, [ids]); return { rows: [{ results: [
      { route_id: ids[0], success: false, error: 'elevation incomplete', sqlstate: 'P0001' }, { route_id: ids[1], success: true },
    ] }] }; }
    return { rows: [] };
  } } as any;
  const results = await activateBulkBatch(client, ids, 'OR');
  assert.equal(results[0].success, false); assert.equal(results[0].error, 'elevation incomplete');
  assert.equal(results[1].success, true); assert.ok(results.every(r => r.state_code === 'OR' && r.operation === 'activate'));
  assert.equal(calls.length, 5); assert.equal(calls.at(-1), 'COMMIT');
  const before = calls.length;
  await assert.rejects(() => activateBulkBatch(client, Array(51).fill('too-many'), 'OR'), /50/);
  assert.equal(calls.length, before);
  assert.deepEqual(await activateBulkBatch(client, [], 'OR'), []);
});

test('bulk CLI validates state and bounded chunks before I/O and keeps legacy modes separate', () => {
  assert.equal(loaderMode(loaderArgs(['--bulk', '--state', 'CA', '--dir', 'local', '--activate'])), 'bulk');
  assert.deepEqual(batches(Array.from({ length: 401 }, (_, i) => i)).map(batch => batch.length), [200, 200, 1]);
  for (const size of [0, 201, 1.5, Number.NaN]) assert.throws(() => batches([], size), /1–200/);
  for (const args of [[], ['--state', 'WA'], ['--state', 'OR', '--batch-size', '201'],
    ['--state', 'OR', '--include-review'], ['--state', 'OR', '--rebase'], ['--state', 'OR', '--prune-pending']]) {
    assert.throws(() => loaderArgs(['--bulk', '--dir', 'local', ...args]));
  }
});

test('bulk dry-run and activation preview need no database or tiles; apply requires DATABASE_URL', async () => {
  const root = resolve(__dirname, '../../../../.cache/bulk-loader-tests'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'preview-'));
  try {
    const { row, source } = setup();
    await writeFile(join(dir, 'routes.ndjson'), JSON.stringify(row) + '\n');
    await writeFile(join(dir, 'segments.ndjson'), [...source.values()].map(s => JSON.stringify(s) + '\n').join(''));
    const env: NodeJS.ProcessEnv = { ...process.env, TSX_DISABLE_CACHE: '1', NODE_OPTIONS: '', BULK_BOUNDARY_FILE: join(dir, 'no-boundary.poly') }; delete env.DATABASE_URL; delete env.TEST_DATABASE_URL;
    const file = resolve(__dirname, '../trail-graph/load-catalog.ts');
    for (const mode of [[], ['--activate']]) {
      const result = spawnSync(process.execPath, ['--import', 'tsx', file, '--bulk', '--state', 'CA', '--dir', dir, ...mode], { env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(await readFile(join(dir, 'bulk-plan.json'), 'utf8'));
      assert.equal(report.mode, 'dry-run'); assert.equal(report.planned_routes, 1);
      assert.match(report.preflight, /opens no database and fetches no tiles/);
    }
    const apply = spawnSync(process.execPath, ['--import', 'tsx', file, '--bulk', '--state', 'CA', '--dir', dir, '--apply'], { env, encoding: 'utf8' });
    assert.notEqual(apply.status, 0); assert.match(apply.stderr, /--apply requires DATABASE_URL/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function routeRows(count: number) {
  const { row, source } = setup();
  const rows = Array.from({ length: count }, (_, i) => { const result = structuredClone(row); result.name += ` ${i}`; result.seed_index = i; rehash(result); return result; });
  return { rows, source };
}
/** A fake connection that fails any transaction containing a poisoned route. */
function isolatingClient(bad: Set<string>, stage: 'rebuild' | 'insert') {
  const transactions: string[][] = []; let current: string[] = [];
  const client = { query: async (sql: string, values?: unknown[]) => {
    if (sql === 'BEGIN') current = [];
    if (sql.startsWith('INSERT INTO routes(')) {
      const ids = (JSON.parse(values![0] as string) as { id: string }[]).map(r => r.id); current = ids;
      if (stage === 'insert' && ids.some(id => bad.has(id))) throw new Error('violates check constraint');
      return { rows: ids.map(id => ({ id })), rowCount: ids.length };
    }
    if (sql.includes('AS valid')) return { rows: [{ valid: true }], rowCount: 1 };
    if (sql.includes('rebuild_route_paths')) return { rows: [{ results: (values![0] as string[]).map(route_id =>
      bad.has(route_id) && stage === 'rebuild' ? { route_id, success: false, error: 'Segment x has no path', sqlstate: 'P0001' } : { route_id, success: true }) }], rowCount: 1 };
    if (sql === 'COMMIT') transactions.push(current);
    return { rows: [], rowCount: 0 };
  } };
  return { client: client as any, transactions };
}

test('a rebuild failure drops only the failed routes and commits the rest in one retry', async () => {
  const { rows, source } = routeRows(6), plan = planBulkBatch(rows, source, 'OR');
  const bad = new Set([plan.routes[1].id, plan.routes[4].id]), fake = isolatingClient(bad, 'rebuild');
  const results = await loadIsolated(fake.client, plan, profiles(plan.segments));
  assert.equal(results.length, 6);
  assert.deepEqual(results.filter(r => !r.success).map(r => r.route_id).sort(), [...bad].sort());
  assert.ok(results.filter(r => !r.success).every(r => /path rebuild failed: Segment x has no path/.test(r.error!) && r.sqlstate === 'P0001'));
  assert.equal(fake.transactions.length, 1, 'one committed retry');
  assert.deepEqual(fake.transactions[0].sort(), plan.routes.filter(r => !bad.has(r.id)).map(r => r.id).sort());
});

test('any other batch failure bisects until the bad route stands alone', async () => {
  const { rows, source } = routeRows(8), plan = planBulkBatch(rows, source, 'OR');
  const bad = new Set([plan.routes[5].id]), fake = isolatingClient(bad, 'insert');
  const results = await loadIsolated(fake.client, plan, profiles(plan.segments));
  assert.deepEqual(results.map(r => r.route_id), plan.routes.map(r => r.id));
  assert.deepEqual(results.filter(r => !r.success).map(r => [r.route_id, r.error]), [[plan.routes[5].id, 'violates check constraint']]);
  assert.deepEqual(fake.transactions.flat().sort(), plan.routes.filter(r => !bad.has(r.id)).map(r => r.id).sort());
  assert.ok(fake.transactions.length <= 4, 'log2(n) committed pieces');
  const clean = isolatingClient(new Set(), 'insert');
  assert.ok((await loadIsolated(clean.client, plan, profiles(plan.segments))).every(r => r.success));
  assert.equal(clean.transactions.length, 1, 'a clean batch is one transaction');
});

test('permission, timeout and connection errors stop the run instead of splitting the batch', () => {
  for (const code of ['42501', '57014', '55P03', '08006', '53200', '57P01']) assert.equal(fatalBulkError(Object.assign(new Error('x'), { code })), true);
  assert.equal(fatalBulkError(new Error('Connection terminated unexpectedly')), true);
  for (const code of ['23505', '22P02', 'P0001']) assert.equal(fatalBulkError(Object.assign(new Error('x'), { code })), false);
  assert.equal(fatalBulkError(new Error('Stored segment binding, elevation or review guard failed')), false);
});

test('state boundary keeps routes that start inside and drops a neighbour state start', () => {
  const poly = parsePoly('oregon\n1\n  -124.0 42.0\n  -117.0 42.0\n  -117.0 46.0\n  -124.0 46.0\nEND\n!2\n  -120.0 44.0\n  -119.0 44.0\n  -119.0 45.0\nEND\nEND\n');
  assert.equal(poly.outer.length, 1); assert.equal(poly.holes.length, 1);
  assert.equal(insidePoly([-122.0, 45.0], poly), true);
  assert.equal(insidePoly([-122.0, 47.0], poly), false);
  assert.equal(insidePoly([-119.8, 44.2], poly), false);
});
