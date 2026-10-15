import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Composer, materialize, catalogRouteId, digest } from '../trail-graph/compose';
import { catalogPlans, executePlan, planRoute, runPlans, waitForRematchDrain } from '../trail-graph/load-catalog';
import { DestinationResolver, IMPORT_MARKER, checkSupersede, claimSupersedes, compatibleRouteNames, osmExternalIds, placeIdentity } from '../trail-graph/load-matching';
import { bindExistingSegments, readPreflight, type ExistingOverlap } from '../trail-graph/load-preflight';
import { prunePlan } from '../trail-graph/load-prune';
import { displayName, assertDisplayName } from '../trail-graph/display-names';
import { segmentValues, UPSERT_SEGMENT } from '../trail-graph/load-segments';
import { provenance, refresh } from '../trail-graph/topology';
import type { CatalogInputs, ComposedRoute, PeaksRoute, PlaceRef } from '../trail-graph/catalog-types';
import type { Coord, Segment } from '../trail-graph/types';
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/wa-compose.json'), 'utf8'));
function setup() {
  const s: Segment = refresh({ id: '', name: 'River Trail', trail_names: ['River Trail'], kind: 'trail', sac_scale: null, trail_visibility: null, osm_way_ids: [10], osm_edge_way_ids: [10, 10], relations: [], relation_names: [], start_node: '', end_node: '', coords: [[-121, 47], [-120.995, 47], [-120.99, 47]], node_ids: ['1', '2', '3'], length_m: 0, provenance: provenance([10], '2026-10-15T00:00:00Z'), alt_sources: [] });
  const input: CatalogInputs = { ...structuredClone(fixture), seeds: [fixture.seed], segments: [s], routes: [], popularity: [] };
  const c = new Composer(input), d = c.compose(fixture.seed, 0), segments = new Map(materialize([d], c.byId).map(s => [s.id, s]));
  const row = d.row, legacy: PeaksRoute = { id: 'legacy', name: row.name, status: 'active', catalog_reviewed: false, distance: row.length_m, n_sessions: 1,
    objective_destination_id: 'lake', destinations: [{ id: 'th', ordinal: 0 }, { id: 'lake', ordinal: 1 }], start: { coordinates: s.coords[0] }, end: { coordinates: s.coords.at(-1)! }, path: { type: 'LineString', coordinates: s.coords } };
  return { row, segments, legacy, input };
}
function rehash(r: ComposedRoute) { r.composition_hash = digest({ ...r, route_id: undefined, composition_hash: undefined }); r.route_id = catalogRouteId(r); }
function place(name: string, coord: Coord, feature = 'trailhead', osmId = 'node/123'): PlaceRef { return { new: { name, feature, lng: coord[0], lat: coord[1], source: { kind: 'osm', osm_id: osmId } } }; }

test('supersede needs exact objective, bounded ends, length-weighted geometry and compatible names', () => {
  const { row, segments, legacy } = setup(), coords = segments.get(row.segments[0].id)!.coords;
  assert.equal(checkSupersede(row, legacy, coords, 'River Lake', 'lake').eligible, true);
  assert.match(checkSupersede(row, { ...legacy, objective_destination_id: 'other' }, coords, 'River Lake', 'lake').reasons.join(), /objective/);
  assert.match(checkSupersede(row, { ...legacy, start: { coordinates: [-121, 47.003] } }, coords, 'River Lake', 'lake').reasons.join(), />300/);
  assert.match(checkSupersede(row, { ...legacy, end: { coordinates: [-120.99, 47.002] } }, coords, 'River Lake', 'lake').reasons.join(), />150/);
  assert.match(checkSupersede(row, { ...legacy, path: null }, coords, 'River Lake', 'lake').reasons.join(), /unverified/);
  assert.match(checkSupersede(row, { ...legacy, path: { type: 'LineString', coordinates: [coords[0], [-120.995, 47.01], coords[2]] } }, coords, 'River Lake', 'lake').reasons.join(), /overlap/);
});
test('named glacier variants and Mailbox Old/New never supersede one another', () => {
  const { row } = setup();
  for (const [newName, oldName, goal] of [['Mount Baker via Easton Glacier', 'Squak Glacier Route', 'Mount Baker'], ['Glacier Peak via Cool Glacier', 'Glacier Peak via North Fork Sauk', 'Glacier Peak'], ["Mount Daniel via Peggy’s Pond", 'Southeast Ridge', 'Mount Daniel'], ['Mailbox Peak via Old Trail', 'Mailbox Peak via New Trail', 'Mailbox Peak']]) {
    assert.equal(compatibleRouteNames({ ...row, name: newName, aliases: [] }, oldName, goal), false);
  }
  assert.equal(compatibleRouteNames({ ...row, name: 'Mailbox Peak Trail', aliases: ['Mailbox Peak via New Trail'] }, 'Mailbox Peak via Old Trail', 'Mailbox Peak'), false);
});
test('a legacy route is claimed by at most one new route', () => {
  const { row, segments, legacy } = setup(), d = checkSupersede(row, legacy, segments.get(row.segments[0].id)!.coords, 'River Lake', 'lake'), other = { ...structuredClone(d), seed_index: 1 };
  const claims = claimSupersedes([other, d]); assert.equal(claims.size, 1); assert.equal(claims.get(0), legacy.id); assert.equal(other.eligible, false);
});
test('destination dedupe uses exact prod OSM keys, 400 m trailhead names, and 30 m near-identical names', () => {
  const resolver = new DestinationResolver([
    { id: 'osm', name: 'Unrelated old name', features: ['trailhead'], lng: -121, lat: 47, external_ids: { osm_node: 123 } },
    { id: 'high', name: 'High Point Trailhead', features: ['trailhead'], lng: -120, lat: 47 },
    { id: 'davis', name: 'Davis Peak', features: ['summit'], lng: -119, lat: 47 },
    { id: 'tiger', name: 'West Tiger Mountain #3', features: ['summit'], lng: -118, lat: 47 },
  ]);
  assert.deepEqual(osmExternalIds('relation/777'), { osm_relation: '777' }); assert.deepEqual(osmExternalIds('way/44'), { osm_way: '44' });
  assert.equal(resolver.resolve(place('New name', [-121, 47], 'trailhead')).peaks_id, 'osm');
  assert.equal(resolver.resolve(place('High Point Trailhead', [-120.003, 47], 'trailhead', 'node/2')).peaks_id, 'high');
  assert.equal(resolver.resolve(place('Davis Peak Central', [-119.0001, 47], 'summit', 'node/3')).peaks_id, 'davis');
  assert.equal(resolver.resolve(place('West Tiger #3', [-118.0001, 47], 'summit', 'node/4')).peaks_id, 'tiger');
  assert.ok(resolver.resolve(place('Davis Peak Central', [-119.001, 47], 'summit', 'node/5')).new);
  const within = new DestinationResolver([]), a = within.resolve(place('Wonderland Trailhead', [-121, 47], 'trailhead', 'node/1')), b = within.resolve(place('Wonderland Trailhead', [-121.001, 47], 'trailhead', 'node/2'));
  assert.equal(placeIdentity(a), placeIdentity(b)); assert.equal(within.events.length, 1); within.resolve(place('Wonderland Trailhead', [-121.001, 47], 'trailhead', 'node/2')); assert.equal(within.events.length, 1);
});
test('uncurated pass/glacier waypoints stay in provenance and never create destination facts', () => {
  const { row, segments } = setup(); row.notes = ['Internal composer note'];
  row.waypoints.push({ ...place('Example Pass', [-120.995, 47], 'pass'), name: 'Example Pass', feature: 'pass', lng: -120.995, lat: 47, fraction: .5, osm_id: 'node/9', distance_from_route_m: 0 }); rehash(row);
  const plan = planRoute(row, segments), inserts = plan.statements.filter(s => s.kind === 'destination_insert'); assert.ok(!inserts.some(s => s.values[1] === 'Example Pass'));
  const route = plan.statements.find(s => s.kind === 'route_insert')!; assert.match(route.sql, /\$9,NULL/); const p = JSON.parse(route.values[5] as string); assert.ok(p.wa_catalog.waypoint_names.some((w: any) => w.name === 'Example Pass')); assert.deepEqual(p.wa_catalog.notes, row.notes);
  assert.match(route.sql, /peaks_route_catalog_slug/);
});
test('reviewed exact geometry is reused in either direction, partial and unrelated overlaps block', () => {
  const { row, segments } = setup(), s = segments.get(row.segments[0].id)!;
  const overlap: ExistingOverlap = { new_id: s.id, id: 'reviewed-segment', name: s.name, display_name: 'River Trail', description: null, kind: 'trail', trail_names: s.trail_names, provenance: s.provenance,
    path: { type: 'LineString', coordinates: [...s.coords].reverse() }, coverage: 1, routes: [{ id: 'reviewed-route', reviewed: true, status: 'active' }] };
  const bound = bindExistingSegments(row, segments, [overlap], new Set(), new Set()); assert.deepEqual(bound.reused, ['reviewed-segment']); assert.equal(bound.refs[0].direction, row.segments[0].direction === 'forward' ? 'reverse' : 'forward');
  const plan = planRoute(row, segments, { overlaps: [overlap], livePreflight: true }); assert.ok(!plan.skipped); assert.equal(plan.statements.filter(s => s.kind === 'segment_insert').length, 0);
  const partial = { ...overlap, path: { type: 'LineString' as const, coordinates: [s.coords[0], s.coords[1]] } }; assert.match(planRoute(row, segments, { overlaps: [partial] }).skipped!, /split\/recompose/);
  const other = { ...overlap, routes: [{ id: 'other', reviewed: false, status: 'active' }] }; assert.match(planRoute(row, segments, { overlaps: [other] }).skipped!, /not owned/);
  assert.ok(!planRoute(row, segments, { overlaps: [other], supersededIds: new Set(['other']) }).skipped);
});
test('a failed replacement cannot authorize another route to duplicate its legacy geometry', async () => {
  const { row, segments } = setup(), s = segments.get(row.segments[0].id)!;
  const overlap: ExistingOverlap = { new_id: s.id, id: 'legacy-segment', name: s.name, display_name: s.display_name ?? null, description: null, kind: s.kind, trail_names: s.trail_names, provenance: s.provenance,
    path: { type: 'LineString', coordinates: s.coords }, coverage: 1, routes: [{ id: 'other-legacy', reviewed: false, status: 'active' }] };
  const plan = planRoute(row, segments, { overlaps: [overlap], supersededIds: new Set(['other-legacy']) });
  const calls: string[] = [], client = { query: async (sql: string) => { calls.push(sql); return { rows: sql.includes("status IS DISTINCT FROM 'superseded'") ? [{ valid: false }] : [], rowCount: 0 }; } };
  await assert.rejects(() => executePlan(client as any, plan, segments, '.'), /has not been superseded/);
  assert.equal(calls.at(-1), 'ROLLBACK'); assert.ok(calls.every(sql => !sql.startsWith('INSERT')));
});
test('session moves clear primary and geometric facts, queue before deleting legacy rows, and tolerate PK conflicts', () => {
  const { row, segments, legacy } = setup(), decision = checkSupersede(row, legacy, segments.get(row.segments[0].id)!.coords, 'River Lake', 'lake');
  const plan = planRoute(row, segments, { activate: true, elevation: true, supersede: decision });
  const move = plan.statements.find(s => s.kind === 'session_routes_move')!; assert.match(move.sql, /'auto',NULL,NULL,false/); assert.match(move.sql, /ON CONFLICT\(session_id,route_id\) DO NOTHING/); assert.ok(!move.sql.includes('jsonb_populate_record'));
  assert.ok(plan.statements.findIndex(s => s.kind === 'session_rematch_queue') < plan.statements.findIndex(s => s.kind === 'session_routes_delete_legacy'));
  assert.match(plan.statements.find(s => s.kind === 'legacy_supersede')!.sql, /0\.8\*ST_Length/); assert.ok(plan.statements.some(s => s.kind === 'supersede_claim'));
});
test('display names expand abbreviations/caps/PCT regions and preserve trail numbers', () => {
  for (const [raw, expected] of [['IRA SPRING Trail #1038', 'Ira Spring Trail #1038'], ['PCT: MBS WHITE RIVER', 'Pacific Crest Trail'], ['PCNST', 'Pacific Crest Trail'], ['MT RAINIER TRAIL', 'Mount Rainier Trail'], ['Chimney Mt Trail #1599', 'Chimney Mountain Trail #1599'], ['Sand Pt Trail', 'Sand Point Trail']]) assert.equal(displayName(raw), expected);
  for (const bad of ['Mt. Si Trail', 'Some Mtn Trail', 'Example Pk Trail']) assert.throws(() => assertDisplayName(bad), /Abbreviated/);
  const { segments } = setup(), s = [...segments.values()][0]; s.display_name = 'Mt. Si Trail'; assert.throws(() => segmentValues(s), /Abbreviated/);
  assert.match(UPSERT_SEGMENT, /ON CONFLICT\(id\) DO NOTHING/); assert.ok(!/DO UPDATE|gain=NULL|path=EXCLUDED/.test(UPSERT_SEGMENT));
});
test('live preflight is read-only and refuses the old cover trigger before any mutation', async () => {
  const calls: string[] = [], client = { query: async (sql: string) => { calls.push(sql); return { rows: sql.includes('rebuild_ready') ? [{ rebuild_ready: true, activation_ready: true, cover_trigger_absent: false, session_primary_ready: true }] : [], rowCount: 0 }; } };
  await assert.rejects(() => readPreflight(client as any, [], true), /cover_activation must be absent/); assert.equal(calls[0], 'BEGIN READ ONLY'); assert.equal(calls.at(-1), 'ROLLBACK'); assert.ok(calls.every(sql => !/^(INSERT|UPDATE|DELETE)/.test(sql)));
});
test('activation migration retains canonical integrity, elevation/contact gate and exclusive owned activation', () => {
  const sql = readFileSync(resolve(__dirname, '../../../migrations/20261016_wa_catalog_activation.sql'), 'utf8');
  for (const gate of ['peaks_route_passes_publish_integrity(r.id,NULL,r.status)', "'{wa_catalog,compose_status}' IS DISTINCT FROM 'ok'", 'ST_Z((p).geom)=0', 'route_elevation_profile_has_real_range', 'r.gain IS NULL', 'SECURITY DEFINER', 'NOLOGIN', 'REVOKE ALL ON FUNCTION activate_wa_catalog_route', 'current_user<>\'peaks-wa-catalog-publisher\'']) assert.ok(sql.includes(gate), gate);
  assert.ok(!sql.includes('DROP TRIGGER IF EXISTS trg_enforce_peaks_route_cover_activation')); assert.match(sql, /wa_catalog_valid_source_provenance\(value-'wa_catalog'\)/);
  assert.match(sql, /GRANT UPDATE\(route_id\) ON route_segments,route_destinations/);
  assert.match(sql, /GRANT UPDATE\(id\) ON segments,destinations/);
  const grant = sql.indexOf('GRANT CREATE ON SCHEMA public'), transfer = sql.indexOf('ALTER FUNCTION activate_wa_catalog_route'), revoke = sql.indexOf('REVOKE CREATE ON SCHEMA public');
  assert.ok(grant > 0 && transfer > grant && revoke > transfer);
  assert.ok(sql.indexOf('GRANT EXECUTE ON FUNCTION activate_wa_catalog_route(TEXT) TO %I') > transfer);
});
test('lease-bound worker roles cannot enter the bulk loader write path', async () => {
  const calls: string[] = [], client = { query: async (sql: string) => { calls.push(sql); return { rows: sql.includes('rebuild_ready') ? [{ rebuild_ready: true, activation_ready: true, cover_trigger_absent: true, session_primary_ready: true, lease_bound_worker: true }] : [] }; } };
  await assert.rejects(() => readPreflight(client as any, [], false), /operator connection/);
  assert.deepEqual(calls.map(sql => sql === 'BEGIN READ ONLY' || sql === 'ROLLBACK' ? sql : 'schema check'), ['BEGIN READ ONLY', 'schema check', 'ROLLBACK']);
});
test('prune is marker-scoped, pending-only and preserves activation receipts and all foreign-key references', () => {
  const { row, segments } = setup(), plan = planRoute(row, segments), statements = prunePlan([plan], [row.route_id!]);
  assert.equal(statements[0].sql, 'BEGIN'); assert.equal(statements.at(-1)!.sql, 'COMMIT');
  for (const s of statements.filter(s => s.kind.startsWith('prune_'))) { assert.match(s.sql, /wa_catalog_activation_receipts/); assert.ok(JSON.stringify(s.values).includes(IMPORT_MARKER)); }
  assert.match(statements.find(s => s.kind === 'prune_routes')!.sql, /status='pending'/); assert.match(statements.find(s => s.kind === 'prune_places')!.sql, /wa_catalog_has_references/);
});
test('rematch drain polls at 30 s, returns only on zero and times out at 30 min', async () => {
  let time = 0, calls = 0; const sleep = async (ms: number) => { assert.equal(ms, 30000); time += ms; };
  await waitForRematchDrain({ query: async () => ({ rows: [{ pending: ++calls >= 3 ? 0 : 1 }] }) } as any, sleep, () => time); assert.equal(time, 60000);
  time = 0; await assert.rejects(() => waitForRematchDrain({ query: async () => ({ rows: [{ pending: 1 }] }) } as any, sleep, () => time), /30 minutes/); assert.equal(time, 1800000);
});
test('batches never exceed 50, wait before the next batch, and continue after one route rolls back', async () => {
  const { row, segments } = setup(), plan = planRoute(row, segments, { activate: true, elevation: true });
  const parent = resolve(__dirname, '../../../../.cache/loader-tests'); await mkdir(parent, { recursive: true }); const dir = await mkdtemp(join(parent, 'run-'));
  let activations = 0, drains = 0, failOnce = true, rollbacks = 0;
  const client = { query: async (sql: string) => {
    if (sql === 'ROLLBACK') rollbacks++;
    if (sql.includes('activate_wa_catalog_route')) { activations++; if (failOnce) { failOnce = false; throw new Error('one route failed'); } }
    return { rows: sql.includes('AS valid FROM') ? [{ valid: true }] : sql.includes('AS complete') ? [{ complete: true }] : [], rowCount: 1 };
  } };
  try {
    const results = await runPlans(client as any, Array.from({ length: 51 }, (_, i) => ({ ...plan, seed_index: i })), segments, dir, { drain: async () => { drains++; assert.equal(activations, drains === 1 ? 50 : 51); } });
    assert.equal(results.length, 51); assert.match(results[0].result, /failed/); assert.equal(results[50].result, 'applied'); assert.equal(rollbacks, 1); assert.equal(drains, 2);
    await assert.rejects(() => runPlans(client as any, [], segments, dir, { batchSize: 51 }), /1–50/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('one invalid plan is reported without hiding the remaining route plans', () => {
  const { row, segments, input } = setup(), bad = { ...structuredClone(row), seed_index: 1, name: 'Changed after compose' };
  const result = catalogPlans([bad, row], segments, input.destinations, []);
  assert.match(result.plans[0].skipped!, /hash mismatch/); assert.ok(!result.plans[1].skipped);
});
test('Olallie via Talapus has no WTA link when no match is known', () => {
  const { input } = setup(), composer = new Composer(input);
  assert.equal(composer.compose({ ...fixture.seed, name: 'Olallie Lake via Talapus Lake Trail' }, 0).row.wta_url, null);
});
test('reviewed legacy segments with null v2 kind/display metadata can be reused without rewriting them', () => {
  const { row, segments } = setup(), s = segments.get(row.segments[0].id)!;
  const overlap: ExistingOverlap = { new_id: s.id, id: 'reviewed-old', name: s.name, display_name: null, description: null, kind: null, trail_names: [], provenance: s.provenance, path: { type: 'LineString', coordinates: s.coords }, coverage: 1, routes: [{ id: 'old-reviewed', reviewed: true, status: 'active' }] };
  const plan = planRoute(row, segments, { overlaps: [overlap] }); assert.ok(!plan.skipped); assert.deepEqual(plan.reused_segment_ids, ['reviewed-old']); assert.ok(!plan.statements.some(s => s.kind === 'segment_insert'));
});
test('missing segment data in a legacy candidate cannot abort planning other routes', () => {
  const { row, legacy, segments, input } = setup(), bad = { ...structuredClone(row), seed_index: 1, segments: [{ id: 'missing', direction: 'forward' as const }], existing_route_matches: [{ id: legacy.id, name: legacy.name, catalog_reviewed: false, n_sessions: 1, start_gap_m: 0, end_gap_m: 0 }] };
  const result = catalogPlans([bad, row], segments, input.destinations, [legacy]);
  assert.ok(result.plans[0].skipped); assert.ok(!result.plans[1].skipped); assert.equal(result.supersedes[0].eligible, false);
});
