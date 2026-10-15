import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Composer, catalogRouteId, digest, materialize, finalizeRows } from '../trail-graph/compose';
import { namedOsm, resolveObjective, resolveTrailhead } from '../trail-graph/compose-resolve';
import { expectedLength, repeatedEdgesAllowed, validateRoute } from '../trail-graph/compose-validate';
import { addLoopVia, composeLoop } from '../trail-graph/compose-loops';
import { accessIndex, resolveAccessTrailhead } from '../trail-graph/compose-access';
import { attachRoadLinks, boundedRoadLinks, readRoadAccess } from '../trail-graph/road-access';
import { featureDistance, vertexIndex } from '../trail-graph/features';
import { executePlan, planCounts, planRoute, type Approval } from '../trail-graph/load-catalog';
import { databaseFeature, tokenMatch, trailKey } from '../trail-graph/names';
import { TrailRouter } from '../trail-graph/router';
import { applyCuration, assignNames, projection, reviewData, smoothNames, splitSegment, type Curation } from '../trail-graph/stretches';
import { summitApproach } from '../trail-graph/summit-approach';
import { segmentValues } from '../trail-graph/load-segments';
import { provenance, refresh } from '../trail-graph/topology';
import type { CatalogInputs, ComposedRoute, Seed } from '../trail-graph/catalog-types';
import type { Coord, NamedFeature, Segment } from '../trail-graph/types';

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/wa-compose.json'), 'utf8'));
const time = '2026-10-15T00:00:00Z';
function edge(id: number, ids: string[], coords: Coord[], name = 'River Trail'): Segment {
  return refresh({ id: '', name, trail_names: [name], kind: 'trail', sac_scale: null, trail_visibility: null, osm_way_ids: [id], osm_edge_way_ids: coords.slice(1).map(() => id),
    relations: [], relation_names: [], start_node: '', end_node: '', coords, node_ids: ids, length_m: 0, provenance: provenance([id], time), alt_sources: [] });
}
function inputs(): CatalogInputs {
  return { seeds: [structuredClone(fixture.seed)], destinations: structuredClone(fixture.destinations), features: structuredClone(fixture.features), routes: [], popularity: [],
    segments: [edge(10, ['1', '2', '3'], [[-121, 47], [-120.995, 47], [-120.99, 47]])] };
}
function composed(): { row: ComposedRoute; segments: Map<string, Segment> } {
  const c = new Composer(inputs()), draft = c.compose(fixture.seed, 0), segments = new Map(materialize([draft], c.byId).map(s => [s.id, s]));
  return { row: draft.row, segments };
}
function rehash(row: ComposedRoute) { row.composition_hash = digest({ ...row, route_id: undefined, composition_hash: undefined }); row.route_id = catalogRouteId(row); }

test('resolution prefers named Peaks trailheads, then nearby Peaks, then OSM', () => {
  const i = inputs(), vertices = vertexIndex(i.segments), starts: Coord[] = [[-121, 47]];
  assert.equal(resolveTrailhead('River TH', i.destinations, i.features, starts, vertices)!.ref.peaks_id, 'th');
  assert.equal(resolveTrailhead('Visitor Center', i.destinations, i.features, starts, vertices)!.ref.peaks_id, 'th');
  assert.equal(resolveTrailhead('River Trailhead', [], i.features, starts, vertices)!.ref.new!.source.osm_id, 'node/1');
  assert.equal(resolveTrailhead('Far away', [], [], starts, vertices), null);
});
test('lake resolution uses its boundary and rejects distant Peaks homonyms', () => {
  const i = inputs(), vertices = vertexIndex(i.segments), lake = i.features[2];
  const resolved = resolveObjective('River Lake', 'lake', i.destinations, i.features, [[-120.99, 47]], [-121, 47], vertices)!;
  assert.equal(resolved.ref.peaks_id, 'lake'); assert.equal(resolved.gap_m, 0); assert.deepEqual(resolved.route_coord, [-120.99, 47]);
  assert.ok(featureDistance([-121, 47], lake) > 700);
  const withoutLocal = resolveObjective('River Lake', 'lake', i.destinations.filter(d => d.id !== 'lake'), i.features, [[-120.99, 47]], [-121, 47], vertices)!;
  assert.equal(withoutLocal.ref.new!.source.osm_id, 'relation/3');
});
test('road input streams exact vertices and named parking, excluding private parking', async () => {
  const segments = [edge(99, ['1', '3'], [[-121, 47], [-120.998, 47]])];
  const access = await readRoadAccess(join(__dirname, 'fixtures/wa-road-access.opl'), segments);
  assert.equal(access.stats.input_ways, 2); assert.equal(access.links.length, 1);
  assert.ok(access.points.some(p => p.name === 'River Trail Parking' && p.parking));
  assert.ok(access.points.some(p => p.name === 'River Lot' && p.osm_id === 'way/11'));
  assert.ok(!access.points.some(p => p.name === 'Private Lot'));
  const withRoad = attachRoadLinks(segments, access.links, access.coords, time);
  assert.ok(withRoad.some(s => s.kind === 'road' && s.osm_way_ids.includes(10)));
});
test('token trailhead resolution drops generic words and snaps to the preferred network', () => {
  const i = inputs(); i.destinations[0] = { ...i.destinations[0], name: 'Upper River Parking Lot' };
  i.features = i.features.filter(f => f.feature !== 'trailhead');
  const c = new Composer(i), th = resolveAccessTrailhead(fixture.seed, i, i.segments, accessIndex([]), c.router, [-120.99, 47], false)!;
  assert.equal(tokenMatch('River Trailhead', 'Upper River Parking Lot'), true);
  assert.equal(th.ref.peaks_id, 'th');
});
test('road connectors use short stretches of long ways and enforce the 400 m limit', () => {
  const nodes = Array.from({ length: 11 }, (_, i) => i + 1), coords = new Map(nodes.map((n, i) => [n, [-121 + i * 0.0013, 47] as Coord]));
  const w = { id: 77, nodes, tags: { highway: 'service' }, relations: [] };
  assert.deepEqual(boundedRoadLinks([w], coords, new Set(['5', '8']))[0].nodes, [5, 6, 7, 8]);
  assert.equal(boundedRoadLinks([w], coords, new Set(['1', '11'])).length, 0);
});
test('road attachments node both the hiking line and an interior road contact', () => {
  const a: Coord = [-121, 47], b: Coord = [-120.999, 47], c: Coord = [-120.998, 47], d: Coord = [-120.999, 47.001];
  const hiking = edge(90, ['2', '4'], [b, d]), road = { id: 91, nodes: [1, 2, 3], tags: { highway: 'service' }, relations: [] };
  const segments = attachRoadLinks([hiking], [road], new Map([[1, a], [2, b], [3, c]]), time), router = new TrailRouter(segments);
  assert.equal(segments.filter(s => s.kind === 'road').length, 2);
  assert.equal(router.route(a, d, { includeFeatures: false }).segments.length, 2);
});
test('road-contact inference maximizes network distance; wide networks minimize it', () => {
  const i = inputs(); i.destinations = i.destinations.filter(d => !d.features.includes('trailhead')); i.features = i.features.filter(f => f.feature !== 'trailhead');
  i.segments = [edge(1, ['1', '2'], [[-121, 47], [-120.995, 47]]), edge(2, ['2', '3'], [[-120.995, 47], [-120.99, 47]])];
  i.access = [{ osm_id: 'node/100', coord: [-121, 47], parking: true }, { osm_id: 'node/101', coord: [-120.995, 47], parking: false }];
  const c = new Composer(i), grid = accessIndex(i.access);
  const far = resolveAccessTrailhead(fixture.seed, i, i.segments, grid, c.router, [-120.99, 47], false)!;
  const near = resolveAccessTrailhead(fixture.seed, i, i.segments, grid, c.router, [-120.99, 47], true)!;
  assert.equal(far.ref.new!.source.kind, 'inferred_road_contact'); assert.deepEqual(far.route_coord, [-121, 47]); assert.deepEqual(near.route_coord, [-120.995, 47]);
  const draft = c.compose(fixture.seed, 0); assert.equal(draft.row.status, 'ok'); assert.ok(draft.row.reasons.includes('inferred trailhead'));
  const segments = new Map(materialize([draft], c.byId).map(s => [s.id, s]));
  const plan = planRoute(draft.row, segments), insert = plan.statements.find(s => s.kind === 'destination_insert')!;
  assert.equal(JSON.parse(insert.values![7] as string).provenance.source_kind, 'openstreetmap');
});
test('local objective token/alias matches survive distant exact homonyms', () => {
  const i = inputs(), vertices = vertexIndex(i.segments);
  const local: NamedFeature = { ...i.features[1], name: 'Twin Falls (Lower)', feature: 'waterfall', lon: -120.99, lat: 47 };
  const distant: NamedFeature = { ...local, osm_id: 'node/999', name: 'Twin Falls', lon: -118, lat: 48 };
  const r = resolveObjective('Twin Falls', 'waterfall', [], [local, distant], [[-120.99, 47]], [-121, 47], vertices)!;
  assert.equal(r.ref.new!.source.osm_id, local.osm_id);
  assert.ok(resolveObjective('Unmapped official name', 'waterfall', [], [local], [[-120.99, 47]], [-121, 47], vertices, ['Twin Falls']));
});
test('summits 150–400 m off the trail end require review; named trail ends are explicit', () => {
  const i = inputs(); i.destinations.push({ id: 'peak', name: 'River Peak', features: ['summit'], lng: -120.99, lat: 47.002 });
  const summit = new Composer(i).compose({ ...fixture.seed, kind: 'summit', objective: { name: 'River Peak', feature: 'summit' } }, 0);
  assert.equal(summit.row.status, 'review'); assert.match(summit.row.reasons.join(), /summit off trail end 222m/);
  i.features = i.features.filter(f => f.feature !== 'viewpoint');
  const end = new Composer(i).compose({ ...fixture.seed, objective: { name: 'River Basin', feature: 'other' } }, 0);
  assert.equal(end.row.status, 'review'); assert.ok(end.row.reasons.includes('objective at trail end')); assert.equal(end.row.objective!.new!.source.kind, 'trail_end');
});
test('source names strip guesses/numbers; typed feature IDs and name identity stay exact', () => {
  assert.equal(trailKey('River Trail #1599.1?'), trailKey('RIVER'));
  assert.equal(namedOsm('Lake', 'lake', fixture.features).length, 0);
  assert.equal(databaseFeature('glacier'), 'landform'); assert.equal(databaseFeature('camp'), 'campsite');
  assert.equal(tokenMatch('Third Burroughs', '3rd Burroughs Mountain'), true);
  assert.equal(tokenMatch('Third Burroughs', 'First Burroughs Mountain'), false);
});
test('composer produces a shore route, waypoint fractions, and existing route matches', () => {
  const i = inputs(); i.routes = [{ id: 'legacy', name: 'River Lake Route', status: 'active', catalog_reviewed: false, distance: 760, n_sessions: 2,
    destinations: [{ id: 'lake', ordinal: 1 }], start: { coordinates: [-121, 47] }, end: { coordinates: [-120.99, 47] } }];
  const c = new Composer(i), draft = c.compose(fixture.seed, 0); materialize([draft], c.byId);
  assert.equal(draft.row.status, 'ok'); assert.equal(draft.row.existing_route_match!.id, 'legacy');
  assert.equal(draft.row.objective!.peaks_id, 'lake');
  const view = draft.row.waypoints.find(w => w.name === 'River View')!;
  assert.ok(view.fraction > 0.49 && view.fraction < 0.51); assert.ok(view.new);
  assert.ok(draft.row.segments.length); assert.ok(draft.row.composition_hash);
});
test('validation thresholds include 25%, 50%, 60% preferred and 10% road', () => {
  assert.equal(validateRoute('destination', 1250, 1000, 0.6, 0.1, true).status, 'ok');
  assert.equal(validateRoute('destination', 1500, 1000, 1, 0, true).status, 'review');
  assert.equal(validateRoute('destination', 1501, 1000, 1, 0, true).status, 'failed');
  assert.equal(validateRoute('destination', 1000, 1000, 0.599, 0, true).status, 'review');
  assert.equal(validateRoute('destination', 1000, 1000, 1, 0.101, true).status, 'review');
  assert.equal(validateRoute('destination', 0, 1000, 1, 0, true).status, 'failed');
  assert.equal(expectedLength({ kind: 'traverse', approx_roundtrip_mi: 10 }), 16093.44);
});
test('summit graph gaps become needs_geometry with measured gaps', () => {
  const i = inputs(), seed: Seed = { ...fixture.seed, kind: 'summit', objective: { name: 'Far Peak', feature: 'summit' } };
  i.destinations.push({ id: 'peak', name: 'Far Peak', features: ['summit'], lng: -120.99, lat: 47.01 });
  const draft = new Composer(i).compose(seed, 0);
  assert.equal(draft.row.status, 'needs_geometry'); assert.match(draft.row.reasons.join(), /objective graph gap 1112/);
});
test('loop composition follows a cycle and only permits repeated shared stems', () => {
  const a: Coord = [-121, 47], b: Coord = [-120.995, 47], c: Coord = [-120.99, 47], d: Coord = [-120.995, 47.005];
  const segments = [edge(1, ['a', 'b'], [a, b]), edge(2, ['b', 'c'], [b, c]), edge(3, ['c', 'd'], [c, d]), edge(4, ['d', 'b'], [d, b])];
  const router = new TrailRouter(segments), walk = composeLoop(router, [segments], a, 2300, ['River Trail'])!;
  assert.equal(walk.length, 5); assert.equal(repeatedEdgesAllowed('loop', walk, new Map()), true);
  assert.equal(repeatedEdgesAllowed('destination', walk, new Map()), false);
});
test('an ordered loop via may be the junction at the end of a named spur', () => {
  const a: Coord = [-121, 47], b: Coord = [-120.99, 47], c: Coord = [-120.995, 47.005], d: Coord = [-120.99, 47.01];
  const ab = edge(1, ['a', 'b'], [a, b], 'Outbound Trail'), bc = edge(2, ['b', 'c'], [b, c], 'Outbound Trail'), ca = edge(3, ['c', 'a'], [c, a], 'Return Trail'), spur = edge(4, ['b', 'd'], [b, d], 'Junction Trail');
  const router = new TrailRouter([ab, bc, ca, spur]), expected = ab.length_m + bc.length_m + ca.length_m;
  const walk = composeLoop(router, [[ab, bc], [spur], [ca]], a, expected, ['Outbound Trail', 'Junction Trail', 'Return Trail'])!;
  assert.ok(walk); assert.ok(!walk.some(s => s.segment_id === spur.id));
  assert.ok(Math.abs(walk.reduce((n, s) => n + s.length_m, 0) - expected) < 0.01);
  assert.equal(composeLoop(router, [[ab, bc], [spur], [ca]], a, expected, [], [d]), null);
  const withSummit = addLoopVia(router, walk, d, ['Junction Trail']), actual = withSummit.reduce((n, s) => n + s.length_m, 0);
  assert.ok(Math.abs(actual - expected - 2 * spur.length_m) < 0.01);
  assert.equal(validateRoute('loop', actual, actual, 1, 0, repeatedEdgesAllowed('loop', withSummit, new Map())).status, 'review');
});
test('a unique objective rejects a distant trailhead homonym before locating trails', () => {
  const i = inputs(); i.destinations = i.destinations.filter(d => !d.features.includes('trailhead') && d.id !== 'far-lake'); i.features = i.features.filter(f => f.feature !== 'trailhead' && f.osm_id !== 'relation/4');
  i.destinations.push({ id: 'wrong-th', name: 'River Trailhead', features: ['trailhead'], lng: -119, lat: 48 });
  i.access = [{ osm_id: 'node/900', parking: true, coord: [-121, 47] }];
  const row = new Composer(i).compose(fixture.seed, 0).row;
  assert.equal(row.status, 'ok'); assert.equal(row.trailhead!.new!.source.kind, 'inferred_road_contact'); assert.deepEqual(row.route_start, [-121, 47]);
});
test('global materialization reuses exact subsegments between partial and full routes', () => {
  const c = new Composer(inputs()), full = c.compose(fixture.seed, 0), half = c.compose(fixture.seed, 1);
  half.walk = c.router.route([-121, 47], [-120.995, 47], { includeFeatures: false }).segments;
  half.row.length_m = half.walk[0].length_m;
  materialize([full, half], c.byId);
  assert.equal(full.row.segments.length, 2); assert.equal(half.row.segments.length, 1); assert.equal(full.row.segments[0].id, half.row.segments[0].id);
});
test('a loop beginning at an interior source vertex rotates without adding a false stem', () => {
  const s = edge(1, ['a', 'b', 'c', 'd', 'a'], [[-121, 47], [-120.99, 47], [-120.99, 47.01], [-121, 47.01], [-121, 47]]);
  const router = new TrailRouter([s]), walk = composeLoop(router, [[s]], s.coords[1], s.length_m, ['River Trail'])!;
  assert.equal(repeatedEdgesAllowed('loop', walk, new Map()), true);
  assert.ok(Math.abs(walk.reduce((n, s) => n + s.length_m, 0) - s.length_m) < 0.001);
});
test('dry-run plan counts insert only consumed segments; reviewed matches skip all SQL', () => {
  const { row, segments } = composed(), plan = planRoute(row, segments), counts = planCounts([plan]);
  assert.equal(counts.planned_routes, 1); assert.equal(counts.statements.segment_insert, 1); assert.equal(counts.statements.route_insert, 1);
  assert.equal(counts.statements.destination_insert, 1); assert.equal(counts.statements.route_destination_insert, 3);
  assert.equal(counts.statements.rebuild_route_path, 1); assert.ok(plan.statements.every(s => !/UPDATE segments/.test(s.sql)));
  row.existing_route_match = { id: 'reviewed', name: 'old', catalog_reviewed: true, n_sessions: 0, start_gap_m: 0, end_gap_m: 0 };
  assert.match(planRoute(row, segments).skipped!, /catalog_reviewed/);
});
test('activation requires a matching approval and includes atomic legacy/session moves', () => {
  const { row, segments } = composed(); row.existing_route_match = { id: 'old', name: 'old', catalog_reviewed: false, n_sessions: 1, start_gap_m: 0, end_gap_m: 0 }; rehash(row);
  assert.equal(planRoute(row, segments, { activate: true }).activate, false);
  const approval: Approval = { route_id: row.route_id!, composition_hash: row.composition_hash!, status: 'approved', reviewed_by: 'Fixture reviewer', reviewed_at: time };
  const plan = planRoute(row, segments, { activate: true, approvals: [approval] });
  assert.equal(plan.activate, true);
  for (const kind of ['activate', 'legacy_supersede', 'session_routes_move', 'session_routes_delete_legacy']) assert.equal(plan.statements.filter(s => s.kind === kind).length, 1);
  assert.equal(plan.statements[0].sql, 'BEGIN'); assert.equal(plan.statements.at(-1)!.sql, 'COMMIT');
});
test('elevation dry-run plans work without sampling or importing Terrarium/sharp', () => {
  const { row, segments } = composed(), plan = planRoute(row, segments, { elevation: true }), counts = planCounts([plan]);
  assert.equal(counts.statements.elevation_guard, 1); assert.equal(counts.statements.elevation_segment_update, 1);
  assert.match(plan.statements.find(s => s.kind === 'elevation_segment_update')!.sql, /NOT EXISTS/);
});
test('mocked executor rolls back a live reviewed match before any mutation', async () => {
  const { row, segments } = composed(), plan = planRoute(row, segments), calls: string[] = [];
  const client = { query: async (sql: string) => { calls.push(sql); return { rows: sql.includes('FOR UPDATE') ? [{ id: 'old', protected: true }] : [], rowCount: 1 }; } };
  const result = await executePlan(client as any, plan, segments, '.cache');
  assert.match(result, /live catalog review/); assert.equal(calls.at(-1), 'ROLLBACK'); assert.ok(calls.every(sql => !/^INSERT|^UPDATE/.test(sql)));
});
test('mocked executor rolls back if the stored graph differs from the approval', async () => {
  const { row, segments } = composed(), calls: string[] = [], plan = planRoute(row, segments);
  const client = { query: async (sql: string) => { calls.push(sql); return { rows: sql.includes('AS valid FROM') ? [{ valid: false }] : [], rowCount: 1 }; } };
  await assert.rejects(() => executePlan(client as any, plan, segments, '.cache'), /differ from/);
  assert.equal(calls.at(-1), 'ROLLBACK'); assert.ok(!calls.includes('COMMIT'));
});
test('altering a composed route invalidates its loader plan', () => {
  const { row, segments } = composed(); row.name = 'Changed after review';
  assert.throws(() => planRoute(row, segments), /hash mismatch/);
});
test('an approval also binds the actual cached segment geometry and kind', () => {
  const { row, segments } = composed(), segment = segments.get(row.segments[0].id)!;
  segment.kind = 'road'; assert.throws(() => planRoute(row, segments), /manifest hash mismatch/);
});
test('an existing pending import activates atomically without rewriting its graph links', async () => {
  const { row, segments } = composed(); row.existing_route_match = { id: 'old', name: 'old', catalog_reviewed: false, n_sessions: 1, start_gap_m: 0, end_gap_m: 0 }; rehash(row);
  const approval: Approval = { route_id: row.route_id!, composition_hash: row.composition_hash!, status: 'approved', reviewed_by: 'Fixture reviewer', reviewed_at: time };
  const plan = planRoute(row, segments, { activate: true, approvals: [approval] }), calls: string[] = [];
  const client = { query: async (sql: string) => {
    calls.push(sql); return { rows: sql.includes('FOR UPDATE') ? [{ id: row.route_id, status: 'pending', protected: false }] : sql.includes('AS valid FROM') ? [{ valid: true }] : [], rowCount: 1 };
  } };
  assert.equal(await executePlan(client as any, plan, segments, '.cache'), 'applied');
  assert.ok(calls.some(sql => sql.startsWith('INSERT INTO session_routes')));
  assert.ok(calls.every(sql => !sql.startsWith('INSERT INTO route_segments') && !sql.startsWith('INSERT INTO destinations')));
  assert.equal(calls[calls.length - 1], 'COMMIT');
});
test('a snapshot match to the same catalog ID never supersedes itself or deletes session links', () => {
  const { row, segments } = composed();
  row.existing_route_match = { id: row.route_id!, name: row.name, catalog_reviewed: false, n_sessions: 2, start_gap_m: 0, end_gap_m: 0 }; rehash(row);
  const approval: Approval = { route_id: row.route_id!, composition_hash: row.composition_hash!, status: 'approved', reviewed_by: 'Fixture reviewer', reviewed_at: time };
  const plan = planRoute(row, segments, { activate: true, approvals: [approval] });
  assert.equal(plan.activate, true);
  assert.ok(plan.statements.every(s => !['legacy_supersede','session_routes_move','session_routes_delete_legacy'].includes(s.kind)));
});

// Stretch names are global segment metadata, including reverse uses of a split.
test('stretch smoothing treats a run as a whole and preserves unnamed connectors', () => {
  const a = edge(1, ['1', '2'], [[-121, 47], [-120.99, 47]], 'Main'), b = edge(2, ['2', '3'], [[-120.99, 47], [-120.989, 47]], 'Blip');
  const c = edge(3, ['3', '4'], [[-120.989, 47], [-120.98, 47]], 'Main');
  const refs = [a, b, c].map(s => ({ id: s.id, direction: 'forward' as const })), byId = new Map([a, b, c].map(s => [s.id, s]));
  assert.deepEqual(smoothNames(refs, byId), ['Main', 'Main', 'Main']);
  b.trail_names = []; assert.deepEqual(smoothNames(refs, byId), ['Main', null, 'Main']);
  b.trail_names = ['Blip']; b.length_m = 301; assert.deepEqual(smoothNames(refs, byId), ['Main', 'Blip', 'Main']);
});
test('shared-name votes count each route once and report a deterministic conflict', () => {
  const a = edge(1, ['1', '2'], [[-121, 47], [-120.99, 47]], 'Main'), b = edge(2, ['2', '3'], [[-120.99, 47], [-120.989, 47]], 'Blip'), c = edge(3, ['3', '4'], [[-120.989, 47], [-120.98, 47]], 'Main');
  const base = composed().row, refs = [a, b, c].map(s => ({ id: s.id, direction: 'forward' as const }));
  const rows = [{ ...base, seed_index: 0, name: 'Through', segments: refs }, { ...base, seed_index: 1, name: 'Blip route', segments: [refs[1], refs[1], refs[1]] }, { ...base, seed_index: 2, name: 'Through again', segments: refs }];
  const conflicts = assignNames(rows, [a, b, c]); assert.equal(b.display_name, 'Main'); assert.equal(conflicts.length, 1); assert.equal(conflicts[0].votes[1].routes.length, 1);
});
test('split_at inserts a projection inside an edge, preserves way provenance and reverse semantics', () => {
  const parent = edge(10, ['1', '2'], [[-121, 47], [-120.99, 47]]);
  const split = splitSegment(parent, [-120.996, 47.0001], 'reverse');
  assert.equal(split.segments.length, 2); assert.ok(split.gap > 10 && split.gap < 12);
  assert.ok(Math.abs(split.segments.reduce((n, s) => n + s.length_m, 0) - parent.length_m) < 0.01);
  const path = split.refs.flatMap((r, i) => { const s = split.segments.find(s => s.id === r.id)!, coords = r.direction === 'forward' ? s.coords : [...s.coords].reverse(); return i ? coords.slice(1) : coords; });
  assert.deepEqual(path[0], parent.coords[1]); assert.deepEqual(path[path.length - 1], parent.coords[0]);
  split.segments.forEach(s => { assert.deepEqual(s.osm_way_ids, [10]); assert.deepEqual(s.source_segment_ids, [parent.id]); });
  assert.throws(() => splitSegment(parent, parent.coords[0], 'forward'), /endpoint/);
});
test('curated stretches replace a shared parent in every route, link ordered points and retain notes', () => {
  const { row } = composed(), parent = edge(10, ['1', '2'], [[-121, 47], [-120.99, 47]]);
  const forward: ComposedRoute = { ...structuredClone(row), name: 'Primary', segments: [{ id: parent.id, direction: 'forward' as const }], length_m: parent.length_m, route_start: parent.coords[0], route_end: parent.coords[1], waypoints: [] };
  const reverse: ComposedRoute = { ...structuredClone(forward), name: 'Reverse use', segments: [{ id: parent.id, direction: 'reverse' as const }], route_start: parent.coords[1], route_end: parent.coords[0] };
  const curation: Curation = { routes: [{ route: 'Primary', also_applies_to: ['Reverse use'], approximate: true, note: 'Seasonal line.', stretches: [
    { display_name: 'Before', kind: 'glacier', segments: [parent.id], split_at: 'Camp', part: 'before' },
    { display_name: 'After', kind: 'climb', description: 'Rock step.', segments: [parent.id], split_at: 'Camp', part: 'after' },
  ], points: [{ name: 'Camp', feature: 'campsite', match: 'existing' }, { name: 'Ridge', feature: 'landform', match: 'new', place_at: 'end of stretch After', note: 'Mapped stretch end.' }] }] };
  const segments = [parent], rows = [forward, reverse], destinations = [{ id: 'camp', name: 'Camp', features: ['campsite'], lng: -120.996, lat: 47.0001 }];
  const audit = applyCuration(rows, segments, curation, destinations, []); finalizeRows(rows, segments);
  assert.equal(audit.splits.length, 1); assert.equal(segments.length, 2); assert.deepEqual(forward.segments.map(r => r.id), reverse.segments.map(r => r.id).reverse());
  assert.deepEqual(forward.stretches!.map(s => s.display_name), ['Before', 'After']); assert.deepEqual(reverse.stretches!.map(s => s.display_name), ['After', 'Before']);
  assert.equal(forward.waypoints[0].peaks_id, 'camp'); assert.equal(forward.waypoints[1].new!.feature, 'landform'); assert.equal(forward.approximate, true); assert.ok(forward.notes!.includes('Seasonal line.'));
  assert.deepEqual(reviewData(rows, segments)[0].sn, ['Before', 'After']);
  const plan = planRoute(forward, new Map(segments.map(s => [s.id, s]))); assert.ok(!plan.skipped);
  const values = segmentValues(segments.find(s => s.display_name === 'After')!); assert.equal(values[7], 'After'); assert.equal(values[8], 'Rock step.'); assert.equal(values[9], null);
  assert.match(String(plan.statements.find(s => s.kind === 'route_insert')!.values[10]), /Approximate route/);
  assert.ok(plan.statements.filter(s => s.kind === 'segment_insert').every(s => s.sql.includes('description_source_url') && s.sql.includes('$8')));
});
test('curated remapping uses old route position geometry and refuses unsupported feature values', () => {
  const { row } = composed(), old = edge(11, ['1', '2'], [[-121, 47], [-120.99, 47]]), changed = { ...structuredClone(old), id: 'changed-id' };
  const r = { ...row, name: 'Route', segments: [{ id: changed.id, direction: 'forward' as const }] };
  const c: Curation = { routes: [{ route: 'Route', stretches: [{ display_name: 'Named', kind: 'trail', segments: [old.id] }] }] };
  const audit = applyCuration([r], [changed], c, [], [], new Map([[old.id, old]])); assert.deepEqual(audit.remapped[0].resolved, ['changed-id']);
  c.routes[0].points = [{ name: 'Glacier', feature: 'glacier', match: 'new', place_at: 'end of stretch Named' }];
  assert.throws(() => applyCuration([r], [changed], c, [], [], new Map([[old.id, old]])), /Invalid curated destination feature/);
});
test('Mailbox New Trail excludes the shorter Old Trail while preserving its shared summit leg', () => {
  const i = inputs(), start: Coord = [-121, 47], goal: Coord = [-120.99, 47], turn: Coord = [-120.995, 47.004];
  i.segments = [edge(11, ['1', '3'], [start, goal], 'Mailbox Peak Old Trail'), edge(12, ['1', '2', '3'], [start, turn, goal], 'Mailbox Peak Trail')];
  const seed: Seed = { ...fixture.seed, name: 'Mailbox Peak Trail', trails: ['Mailbox Peak Trail'] }; i.seeds = [seed];
  const c = new Composer(i), draft = c.compose(seed, 0); assert.ok(draft.walk.length); assert.ok(draft.walk.every(s => c.byId.get(s.segment_id)!.name !== 'Mailbox Peak Old Trail'));
});
test('xc final approaches retain source edges and require an OSM unofficial-path tag', () => {
  const s = edge(10, ['1', '2', '3', '4'], [[-121, 47], [-120.997, 47], [-120.994, 47], [-120.991, 47]]), byId = new Map([[s.id, s]]);
  const walk = [{ segment_id: s.id, direction: 'forward' as const, start_vertex: 0, end_vertex: 3, length_m: s.length_m }];
  assert.equal(summitApproach(walk, byId).xc.length, 0);
  s.informal = 'yes'; const approach = summitApproach(walk, byId); assert.equal(approach.walk.length, 2); assert.ok(approach.xc[0].length_m <= 400);
  const { row } = composed(); const parts = materialize([{ row, walk: approach.walk, xc: approach.xc }], byId);
  assert.ok(parts.some(s => s.kind === 'xc')); assert.ok(parts.some(s => s.kind === 'trail')); assert.ok(parts.every(p => p.coords.every(c => s.coords.includes(c))));
});
test('loader statements bind every numbered parameter, including segment descriptions', () => {
  const { row, segments } = composed(), plan = planRoute(row, segments);
  for (const statement of plan.statements) {
    const parameters = [...statement.sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1]));
    assert.equal(Math.max(0, ...parameters), statement.values.length, statement.kind);
  }
});
test('a token trailhead anchor must be near the first trail even with ambiguous objective names', () => {
  const i = inputs(); i.destinations = i.destinations.filter(d => !d.features.includes('trailhead'));
  i.features = i.features.filter(f => f.feature !== 'trailhead');
  i.destinations.push({ id: 'far-th', name: 'River Campground Trailhead', features: ['trailhead'], lng: -119, lat: 48 });
  const goal = i.features.find(f => f.feature === 'viewpoint')!;
  i.features.push({ ...goal, osm_id: 'node/99999', lon: -119, lat: 48 });
  i.access = [{ osm_id: 'node/900', parking: true, coord: [-121, 47] }];
  const seed = { ...fixture.seed, trailhead: { name: 'River Campground' } }, row = new Composer(i).compose(seed, 0).row;
  assert.equal(row.status, 'ok', JSON.stringify(row.reasons)); assert.deepEqual(row.route_start, [-121, 47]); assert.notEqual(row.trailhead?.peaks_id, 'far-th');
});
test('splitting an agency-only stretch keeps public-domain provenance and no OSM IDs', () => {
  const s = edge(10, ['1', '2'], [[-121, 47], [-120.99, 47]]); s.provenance = provenance([], time, 'nps', '123'); s.osm_edge_way_ids = []; s.osm_way_ids = [];
  const result = splitSegment(s, [-120.995, 47], 'forward');
  for (const part of result.segments) { assert.deepEqual(part.osm_way_ids, []); assert.equal(part.provenance.contains_osm_geometry, false); assert.equal(part.provenance.license_name, 'Public domain'); }
});
