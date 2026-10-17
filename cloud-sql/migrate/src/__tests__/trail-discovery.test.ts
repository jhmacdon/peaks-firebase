import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { composeDiscover } from '../trail-graph/compose-discover';
import { discover, discoveryName, objectiveCostLowerBound, type DiscoveryCandidate, type HardGoalRequest, type HardGoalResult, type HardGoalSolver } from '../trail-graph/discovery';
import { displayName, assertDisplayName } from '../trail-graph/display-names';
import { composeDiscovery, DiscoveryDeduper, DiscoveryPieces, discoverySummary, popularity, routeDistance, routeTitle, sharedLength, type DiscoverySummary } from '../trail-graph/discovery-catalog';
import { finalizeRows } from '../trail-graph/compose';
import { compositionValid, planRoute } from '../trail-graph/load-catalog';
import { haversine, length } from '../trail-graph/geo';
import { provenance } from '../trail-graph/topology';
import type { AccessPoint, DraftRoute } from '../trail-graph/catalog-types';
import type { Coord, NamedFeature, Relation, Segment } from '../trail-graph/types';
import type { RouteStep } from '../trail-graph/router';

const time = '2026-10-17T00:00:00Z', origin: Coord = [-121, 47];
const northDegree = haversine(origin, [-121, 48]), eastDegree = haversine(origin, [-120, 47]);
const xy = (east: number, north = 0): Coord => [origin[0] + east / eastDegree, origin[1] + north / northDegree];
function segment(id: string, nodes: string[], points: Coord[], name: string | null = 'Alpha Trail', relations: Relation[] = [], kind: Segment['kind'] = 'trail'): Segment {
  return { id, name, trail_names: name ? [name] : [], kind, sac_scale: null, trail_visibility: null, osm_way_ids: [10], relation_names: relations.map(r => r.name).filter((n): n is string => !!n), relations,
    start_node: nodes[0], end_node: nodes.at(-1)!, coords: points, node_ids: nodes, osm_edge_way_ids: points.slice(1).map(() => 10), length_m: length(points), provenance: provenance([10], time), alt_sources: [] };
}
function feature(id: string, name: string, kind: NamedFeature['feature'], point: Coord): NamedFeature {
  return { osm_id: id, name, feature: kind, lon: point[0], lat: point[1], graph_node: null, graph_distance_m: null, location_method: 'osm_point' };
}
const parking = (id: string, point: Coord, name?: string): AccessPoint => ({ osm_id: id, coord: point, parking: true, ...(name ? { name } : {}) });
function step(s: Segment, start = 0, end = s.coords.length - 1): RouteStep {
  return { segment_id: s.id, direction: start < end ? 'forward' : 'reverse', start_vertex: start, end_vertex: end, length_m: length(s.coords.slice(Math.min(start, end), Math.max(start, end) + 1)) };
}
const byId = (segments: Segment[]) => new Map(segments.map(s => [s.id, s]));
function candidate(segments: Segment[], overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return { source: 'named_trail', identity: 'fixture', name: 'Alpha Trail', shape: 'out_and_back', walk: segments.map(s => step(s)), trailhead: feature('node/1', 'Alpha Trailhead', 'trailhead', segments[0].coords[0]), trailheadCoord: segments[0].coords[0], preferredNames: ['Alpha Trail'], ...overrides };
}
function connected(walk: RouteStep[], source: Map<string, Segment>, closed = false): void {
  for (let i = 1; i < walk.length; i++) {
    const p = walk[i - 1], q = walk[i];
    assert.equal(source.get(p.segment_id)!.node_ids[p.end_vertex], source.get(q.segment_id)!.node_ids[q.start_vertex]);
    assert.ok(haversine(source.get(p.segment_id)!.coords[p.end_vertex], source.get(q.segment_id)!.coords[q.start_vertex]) < .01);
  }
  if (closed) { const a = walk[0], b = walk.at(-1)!; assert.deepEqual(source.get(a.segment_id)!.coords[a.start_vertex], source.get(b.segment_id)!.coords[b.end_vertex]); }
}
const sourceOf = (routes: DiscoveryCandidate[], source: DiscoveryCandidate['source']) => routes.filter(r => r.source === source);

test('WA discovery runs without an optional seed file', async () => {
  const parent = resolve(__dirname, '../../../../.cache/test-tmp'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'seedless-'));
  try {
    const graph = join(root, 'graph'), out = join(root, 'compose'); await mkdir(graph);
    for (const file of ['segments', 'features', 'access']) await writeFile(join(graph, `${file}.ndjson`), '');
    await mkdir(join(root, 'peaks-snapshot')); await writeFile(join(root, 'peaks-snapshot/wa-destinations.ndjson'), '');
    await composeDiscover('WA', graph, out, root);
    const summary = JSON.parse(await readFile(join(out, 'summary.json'), 'utf8'));
    assert.equal(summary.candidates, 0); assert.equal(summary.wa_seed_overlap, null);
    assert.equal(JSON.parse(await readFile(join(out, 'seed-overlap.json'), 'utf8')).available, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preferred coverage compares expanded source and display names', () => {
  const s = segment('ab', ['a', 'b'], [xy(0), xy(2500)], 'Chimney Mt Trail');
  const draft = composeDiscovery(candidate([s], { name: 'Chimney Mountain Trail', preferredNames: ['Chimney Mountain Trail'] }), 0, 'WA', byId([s]));
  assert.equal(draft.row.status, 'ok'); assert.equal(draft.row.preferred_fraction, 1);
});

test('inferred named-trail starts retain access evidence and use the trail name', () => {
  const s = segment('ab', ['a', 'b'], [xy(0), xy(2500)]);
  const access: AccessPoint = { osm_id: 'node/3', coord: xy(0, 124), parking: false, name: 'Forest Road' };
  const route = [...discover({ segments: [s], features: [], access: [access] })].find(r => r.source === 'named_trail')!;
  const draft = composeDiscovery(route, 0, 'ID', byId([s]));
  assert.equal(draft.row.status, 'ok'); assert.equal(draft.row.trailhead!.new!.name, 'Alpha Trailhead');
  assert.equal(draft.row.trailhead!.new!.source.kind, 'inferred_road_contact');
  assert.equal(draft.row.trailhead!.new!.source.osm_id, access.osm_id);
  assert.equal(draft.row.trailhead!.new!.source.access_name, access.name);
  assert.ok(draft.row.trailhead!.new!.source.access_gap_m! < 125);
});

test('named hiking relations use one outbound leg, an end access contact and a far objective', () => {
  const relation: Relation = { id: 1, name: 'Alpha Trail', route: 'hiking', network: 'lwn' }, a = xy(0), b = xy(2500);
  const s = segment('ab', ['a', 'b'], [a, b], 'Alpha Trail', [relation]);
  const routes = sourceOf([...discover({ segments: [s], features: [feature('node/2', 'Alpha Lake', 'lake', b)], access: [parking('node/3', a, 'Alpha Parking')] })], 'relation');
  assert.equal(routes.length, 1); assert.equal(routes[0].shape, 'out_and_back'); assert.equal(routes[0].objective!.name, 'Alpha Lake');
  assert.equal(routes[0].walk.length, 1); assert.equal(routes[0].reasons, undefined); connected(routes[0].walk, byId([s]));
});
test('named foot relations with contact at both ends become point-to-point routes', () => {
  const relation: Relation = { id: 2, name: 'River Traverse', route: 'foot' }, a = xy(0), b = xy(2500), s = segment('ab', ['a', 'b'], [a, b], 'Alpha Trail', [relation]);
  const routes = sourceOf([...discover({ segments: [s], features: [], access: [parking('node/1', a), parking('node/2', b)] })], 'relation');
  assert.equal(routes.length, 1); assert.equal(routes[0].shape, 'point_to_point'); assert.ok(routes[0].endTrailhead); assert.equal(routes[0].reasons, undefined);
});
test('closed relations rotate to an interior access vertex and keep exact loop closure', () => {
  const relation: Relation = { id: 3, name: 'Alpha Loop', route: 'hiking' }, a = xy(0), b = xy(1500), c = xy(750, 1000);
  const s = segment('ring', ['a', 'b', 'c', 'a'], [a, b, c, a], 'Alpha Trail', [relation]);
  const route = sourceOf([...discover({ segments: [s], features: [], access: [parking('node/1', b, 'Loop Parking')] })], 'relation')[0];
  assert.equal(route.shape, 'loop'); assert.equal(route.reasons, undefined); assert.deepEqual(route.trailheadCoord, b); connected(route.walk, byId([s]), true);
});
test('disconnected and branched relations keep explicit review reasons', () => {
  const relation: Relation = { id: 4, name: 'Alpha Route', route: 'hiking' };
  const a = segment('ab', ['a', 'b'], [xy(0), xy(2500)], 'Alpha Trail', [relation]), b = segment('cd', ['c', 'd'], [xy(5000), xy(6500)], 'Alpha Trail', [relation]);
  let route = sourceOf([...discover({ segments: [a, b], features: [], access: [parking('node/1', xy(0))] })], 'relation')[0];
  assert.match(route.reasons!.join('; '), /disconnected/); connected(route.walk, byId([a, b]));
  const branch = segment('be', ['b', 'e'], [xy(2500), xy(2500, 1000)], 'Alpha Trail', [relation]), tail = segment('bf', ['b', 'f'], [xy(2500), xy(3500)], 'Alpha Trail', [relation]);
  route = sourceOf([...discover({ segments: [a, branch, tail], features: [], access: [parking('node/1', xy(0))] })], 'relation')[0];
  assert.match(route.reasons!.join('; '), /branches/); connected(route.walk, byId([a, branch, tail]));
});
test('open relations require contact at an end and omit non-pedestrian relation types', () => {
  const a = segment('ab', ['a', 'b'], [xy(0), xy(2500)], 'Alpha Trail', [{ id: 5, name: 'Alpha Trail', route: 'hiking' }]);
  const route = sourceOf([...discover({ segments: [a], features: [feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0))], access: [] })], 'relation')[0];
  assert.match(route.reasons!.join('; '), /no road or parking contact at an end/);
  a.relations = [{ id: 6, name: 'Bicycle Route', route: 'bicycle' }];
  assert.equal(sourceOf([...discover({ segments: [a], features: [], access: [] })], 'relation').length, 0);
});

test('objective discovery supports every requested named objective kind', () => {
  const kinds: NamedFeature['feature'][] = ['summit', 'lake', 'waterfall', 'viewpoint', 'lookout', 'hut', 'pass', 'saddle', 'hot_spring', 'arch', 'meadow'];
  const s = segment('ab', ['a', 'b'], [xy(0), xy(2500)]), features = [feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0)), ...kinds.map((kind, i) => feature(`node/${i + 10}`, `Alpha ${kind}`, kind, xy(2500)))];
  const routes = sourceOf([...discover({ segments: [s], features, access: [] })], 'objective');
  assert.equal(routes.length, kinds.length); assert.deepEqual(new Set(routes.map(r => r.objective!.feature)), new Set(kinds));
});
test('artificial and flowing water types are not lake objectives', () => {
  const s = segment('trail', ['a', 'g'], [xy(0), xy(2500)]), start = feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0));
  const excluded: { name: string; tags: Record<string, string> }[] = [{ name: 'Drumheller Fountain', tags: { amenity: 'fountain', water: 'fountain', fountain: 'decorative', natural: 'water', wikidata: 'Q21952661' } }, { name: 'Lovejoy Fountain', tags: { amenity: 'fountain', natural: 'water' } }, { name: 'Water Feature', tags: { water: 'fountain' } }, { name: 'Swimming Pool', tags: { water: 'swimming_pool' } }, { name: 'Leisure Pool', tags: { leisure: 'swimming_pool', natural: 'water' } }, { name: 'Treatment Pond', tags: { water: 'wastewater' } }, { name: 'Treatment Basin', tags: { man_made: 'wastewater_basin' } }, { name: 'Sewage Pond', tags: { man_made: 'sewage_treatment_pond' } }, { name: 'Clarifier', tags: { man_made: 'clarifier' } }, { name: 'Wastewater', tags: { substance: 'wastewater' } }];
  const features: NamedFeature[] = excluded.map((value, i) => ({ ...feature(`way/${i + 2}`, value.name, 'lake', xy(2500)), tags: value.tags }));
  for (const water of ['river', 'canal', 'stream', 'ditch', 'drain', 'moat']) features.push({ ...feature(`way/${water}`, 'Alpha Water', 'lake', xy(2500)), tags: { natural: 'water', water } });
  assert.equal(sourceOf([...discover({ segments: [s], features: [start, ...features], access: [] })], 'objective').length, 0);
  for (const water of ['lake', 'pond', 'reservoir', 'oxbow', 'lagoon', '']) {
    const lake = { ...feature('way/20', 'Alpha Lake', 'lake', xy(2500)), tags: { natural: 'water', water, wikidata: 'Q20' } };
    const routes = sourceOf([...discover({ segments: [s], features: [start, lake], access: [] })], 'objective'); assert.equal(routes.length, 1); assert.equal(routes[0].objective, lake); assert.equal(routes[0].objective!.tags!.wikidata, 'Q20');
  }
});
test('explicit trailheads and named parking start objective hikes, while unnamed parking alone does not', () => {
  const s = segment('ab', ['a', 'b'], [xy(0), xy(2500)]), th = feature('node/1', '', 'trailhead', xy(0)), goal = feature('node/2', 'Alpha Lake', 'lake', xy(2500));
  const routes = sourceOf([...discover({ segments: [s], features: [th, goal], access: [parking('way/3', xy(0), 'Alpha Parking'), parking('way/4', xy(0))] })], 'objective');
  assert.deepEqual(routes.map(r => r.trailhead.osm_id).sort(), ['node/1', 'way/3']);
});
test('objective paths stay within 15 km one way without limiting the number of objectives', () => {
  const a = segment('ab', ['a', 'b'], [xy(0), xy(14900)]), b = segment('bc', ['b', 'c'], [xy(14900), xy(15100)]);
  const routes = sourceOf([...discover({ segments: [a, b], features: [feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0)), feature('node/2', 'Near Lake', 'lake', xy(14900)), feature('node/3', 'Far Lake', 'lake', xy(15100))], access: [] })], 'objective');
  assert.equal(routes.length, 1); assert.equal(routes[0].objective!.name, 'Near Lake'); assert.ok(routes[0].walk.reduce((n, s) => n + s.length_m, 0) <= 15000);
});
test('objective discovery admits exactly 30% unnamed path and rejects greater shares, including roads', () => {
  for (const [namedLength, kind, expected] of [[700, 'trail', 1], [699, 'trail', 0], [699, 'road', 0]] as const) {
    const a = segment('ab', ['a', 'b'], [xy(0), xy(namedLength)]), b = segment('bc', ['b', 'c'], [xy(namedLength), xy(1000)], null, [], kind);
    const routes = sourceOf([...discover({ segments: [a, b], features: [feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0)), feature('node/2', 'Alpha View', 'viewpoint', xy(1000))], access: [] })], 'objective');
    assert.equal(routes.length, expected, `${namedLength} named metres; ${kind}`);
  }
});
test('a longer named path survives an unnamed shortcut that would fail the coverage gate', () => {
  const a = segment('shortcut', ['a', 'b'], [xy(0), xy(1000)], null), b = segment('named', ['a', 'c', 'b'], [xy(0), xy(500, 500), xy(1000)]);
  const route = sourceOf([...discover({ segments: [a, b], features: [feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0)), feature('node/2', 'Alpha Lake', 'lake', xy(1000))], access: [] })], 'objective')[0];
  assert.deepEqual(route.walk.map(s => s.segment_id), ['named']);
});
test('a longer simple named bypass can repair the same fixed unnamed metres', () => {
  const start = xy(0), junction = xy(100), end = xy(150), detour = xy(125, 500);
  const segments = [segment('approach', ['a', 'b'], [start, junction], null), segment('short', ['b', 'g'], [junction, end]), segment('long', ['b', 'c', 'g'], [junction, detour, end])];
  const logs: string[] = [], routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', start), feature('node/2', 'Alpha View', 'viewpoint', end)], access: [] }, message => logs.push(message))], 'objective');
  assert.equal(routes.length, 1); assert.deepEqual(routes[0].walk.map(s => s.segment_id), ['approach', 'long']); connected(routes[0].walk, byId(segments));
  assert.ok(logs.some(message => /0 off-target nodes/.test(message)), 'parallel source edges keep their goal-bearing block');
  assert.equal(composeDiscovery(routes[0], 0, 'WA', byId(segments)).row.status, 'ok');
});
test('an over-limit cheapest named route does not hide a shorter feasible weighted alternative', () => {
  const start = xy(0), end = xy(10000), long = segment('long', ['a', 'x', 'g'], [start, xy(5000, 6000), end]);
  const fraction = 2000 / haversine(start, xy(5000, 5500)), cut = xy(5000 * fraction, 5500 * fraction);
  const approach = segment('approach', ['a', 'b'], [start, cut], null), tail = segment('tail', ['b', 'c', 'g'], [cut, xy(5000, 5500), end]), segments = [long, approach, tail];
  assert.ok(long.length_m > 15000); assert.ok(approach.length_m + tail.length_m < 15000); assert.ok(approach.length_m * 1.6 + tail.length_m > long.length_m);
  const routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', start), feature('node/2', 'Alpha View', 'viewpoint', end)], access: [] })], 'objective');
  assert.equal(routes.length, 1); assert.deepEqual(routes[0].walk.map(s => s.segment_id), ['approach', 'tail']);
});
test('cheap valid goals settle in the scalar pass without exploring dense Pareto alternatives', () => {
  const segments: Segment[] = [], width = 8;
  for (let row = 0; row < width; row++) for (let column = 0; column < width; column++) {
    const node = `${row}:${column}`;
    if (row + 1 < width) segments.push(segment(`v${node}`, [node, `${row + 1}:${column}`], [xy(column * 100, row * 100), xy(column * 100, (row + 1) * 100)]));
    if (column + 1 < width) segments.push(segment(`h${node}`, [node, `${row}:${column + 1}`], [xy(column * 100, row * 100), xy((column + 1) * 100, row * 100)]));
  }
  const logs: string[] = [], routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0)), feature('node/2', 'Alpha View', 'viewpoint', xy(700, 700))], access: [] }, message => logs.push(message))], 'objective');
  assert.equal(routes.length, 1); assert.ok(logs.some(message => /1 scalar settled, 0 fallback goals, 0 fallback states/.test(message)));
});
test('dense cyclic unnamed regions fail the named-distance upper bound without fallback enumeration', () => {
  const segments: Segment[] = [], width = 8;
  for (let row = 0; row < width; row++) for (let column = 0; column < width; column++) {
    const node = `${row}:${column}`;
    if (row + 1 < width) segments.push(segment(`v${node}`, [node, `${row + 1}:${column}`], [xy(column * 100, row * 100), xy(column * 100, (row + 1) * 100)], null));
    if (column + 1 < width) segments.push(segment(`h${node}`, [node, `${row}:${column + 1}`], [xy(column * 100, row * 100), xy((column + 1) * 100, row * 100)], null));
  }
  const logs: string[] = [], routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0)), feature('node/2', 'Alpha View', 'viewpoint', xy(700, 700))], access: [] }, message => logs.push(message))], 'objective');
  assert.equal(routes.length, 0); assert.ok(logs.some(message => /0 fallback states, 0 resource-infeasible, 1 named-infeasible/.test(message)));
});
test('resource A-star bounds account for ratio-required distance and summit connector subtraction', () => {
  const base = { distance: 0, bad: 0, road: 0, physicalRemainder: 2000, badRemainder: 1807, roadRemainder: 0, weightedCost: 0, weightedRemainder: 3084.2, maxConnector: 0 };
  const bound = objectiveCostLowerBound(base); assert.ok(Math.abs(bound - (1807 / .3 + .6 * 1807)) < 1e-6); assert.ok(bound > base.weightedRemainder); assert.ok(bound <= 6500 + .6 * 1807);
  assert.equal(objectiveCostLowerBound({ ...base, weightedRemainder: 10000 }), 10000, 'the weighted bound can still be stronger');
  assert.equal(objectiveCostLowerBound({ distance: 1000, bad: 265, road: 0, physicalRemainder: 50, badRemainder: 50, roadRemainder: 0, weightedCost: 1159, weightedRemainder: 50, maxConnector: 50 }), 1209);
  assert.equal(objectiveCostLowerBound({ distance: 0, bad: 0, road: 0, physicalRemainder: 200, badRemainder: 100, roadRemainder: 100, weightedCost: 0, weightedRemainder: 410, maxConnector: 0 }), 1210);
});
test('a simple path loses unused named forks when leaving their junction', () => {
  const start = xy(0), junction = xy(100), end = xy(150), rise = Math.sqrt(100 ** 2 - 25 ** 2);
  const segments = [segment('approach', ['a', 'b'], [start, junction], null), segment('upper', ['b', 'x', 'g'], [junction, xy(125, rise), end]), segment('lower', ['b', 'y', 'g'], [junction, xy(125, -rise), end])];
  const logs: string[] = [], routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', start), feature('node/2', 'Alpha View', 'viewpoint', end)], access: [] }, message => logs.push(message))], 'objective');
  assert.equal(routes.length, 0); assert.ok(logs.some(message => /2 named-capacity prunes/.test(message))); assert.ok(logs.some(message => /0 named-infeasible/.test(message)), 'only the per-path fork choice proves infeasibility');
});
function hardGoalFixture(longer = false) {
  const start = xy(0), junction = xy(100), end = xy(150), segments = [segment('approach', ['a', 'b'], [start, junction], null), segment('short', ['b', 'g'], [junction, end]), segment('long', ['b', 'c', 'g'], [junction, xy(125, 500), end])];
  if (longer) segments.push(segment('longer', ['b', 'd', 'g'], [junction, xy(125, 600), end]));
  return { segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', start), feature('node/2', 'Alpha View', 'viewpoint', end)], access: [] };
}
function hardPath(request: HardGoalRequest, longest = false): NonNullable<HardGoalResult['path']> {
  const approach = request.edges.find(edge => edge.from === 'a' && edge.to === 'b')!;
  const named = request.edges.filter(edge => edge.from === 'b' && edge.to === 'g' && edge.named).sort((a, b) => a.length - b.length);
  return [{ edge: approach.id, reverse: false }, { edge: named[longest ? named.length - 1 : named.findIndex(edge => edge.length > 500)].id, reverse: false }];
}
test('an optional proved optimum reconstructs a validated graph path once per hard goal', () => {
  let calls = 0;
  const solve: HardGoalSolver = request => {
    calls++; assert.equal(request.start, 'a'); assert.equal(request.maxDistance, 15000); assert.deepEqual(request.contacts, [{ node: 'g', connector: 0 }]);
    assert.ok(request.edges.every(edge => typeof edge.named === 'boolean' && typeof edge.road === 'boolean' && edge.length > 0));
    return { status: 'optimal', path: hardPath(request), elapsed_seconds: .01, max_rss_mib: 100, solver_version: 'fixture' };
  };
  const routes = sourceOf([...discover(hardGoalFixture(), () => {}, { hardGoalSolver: solve, hardGoalAfterStates: 0 })], 'objective');
  assert.equal(calls, 1); assert.equal(routes.length, 1); assert.deepEqual(routes[0].walk.map(s => s.segment_id), ['approach', 'long']);
});
test('an optional proved infeasibility ends a hard goal while the default threshold leaves cheap goals in TypeScript', () => {
  let calls = 0; const solve: HardGoalSolver = () => { calls++; return { status: 'infeasible' }; };
  assert.equal(sourceOf([...discover(hardGoalFixture(), () => {}, { hardGoalSolver: solve, hardGoalAfterStates: 0 })], 'objective').length, 0); assert.equal(calls, 1);
  calls = 0; assert.equal(sourceOf([...discover(hardGoalFixture(), () => {}, { hardGoalSolver: solve })], 'objective').length, 1); assert.equal(calls, 0);
});
test('invalid solver paths cannot bypass continuity, direction, simplicity or quality gates', () => {
  const invalid: ((request: HardGoalRequest) => NonNullable<HardGoalResult['path']>)[] = [
    () => [{ edge: 999999, reverse: false }],
    request => hardPath(request).slice(1),
    request => hardPath(request).map((step, i) => i ? step : { ...step, reverse: true }),
    request => { const approach = request.edges.find(edge => edge.from === 'a')!, short = request.edges.find(edge => edge.from === 'b' && edge.length < 100)!; return [{ edge: approach.id, reverse: false }, { edge: short.id, reverse: false }, { edge: short.id, reverse: true }, ...hardPath(request).slice(1)]; },
    request => [{ edge: request.edges.find(edge => edge.from === 'a')!.id, reverse: false }, { edge: request.edges.find(edge => edge.from === 'b' && edge.length < 100)!.id, reverse: false }],
    request => hardPath(request).slice(0, 1),
  ];
  for (const status of ['optimal', 'feasible', 'limit'] as const) for (const path of invalid) {
    let calls = 0; const logs: string[] = [], routes = sourceOf([...discover(hardGoalFixture(), message => logs.push(message), { hardGoalSolver: request => { calls++; return { status, path: path(request) }; }, hardGoalAfterStates: 0 })], 'objective');
    assert.equal(calls, 1); assert.deepEqual(routes[0].walk.map(s => s.segment_id), ['approach', 'long']); assert.ok(logs.some(message => /invalid or unsuitable path/.test(message)));
  }
});
test('unavailable, failed and unfinished solver attempts continue the exact search without retrying', () => {
  for (const status of ['unavailable', 'error', 'feasible', 'limit', 'throw'] as const) {
    let calls = 0; const solve: HardGoalSolver = () => { calls++; if (status === 'throw') throw new Error('fixture failure'); return { status }; };
    const routes = sourceOf([...discover(hardGoalFixture(), () => {}, { hardGoalSolver: solve, hardGoalAfterStates: 0 })], 'objective');
    assert.equal(calls, 1); assert.equal(routes.length, 1); assert.deepEqual(routes[0].walk.map(s => s.segment_id), ['approach', 'long']);
  }
});
test('a validated feasible or time-limited solver walk completes the qualifying approach', () => {
  for (const status of ['feasible', 'limit'] as const) {
    let calls = 0; const logs: string[] = [], routes = sourceOf([...discover(hardGoalFixture(true), message => logs.push(message), { hardGoalSolver: request => { calls++; return { status, path: hardPath(request, true) }; }, hardGoalAfterStates: 0 })], 'objective');
    assert.equal(calls, 1); assert.deepEqual(routes[0].walk.map(s => s.segment_id), ['approach', 'longer'], 'a qualifying solver path need not prove the global minimum cost');
    assert.ok(logs.some(message => /1 fallback states/.test(message))); assert.equal(composeDiscovery(routes[0], 0, 'WA', byId(hardGoalFixture(true).segments)).row.status, 'ok');
  }
});
test('a feasible solver result keeps the better already found approach', () => {
  let calls = 0; const routes = sourceOf([...discover(hardGoalFixture(true), () => {}, { hardGoalSolver: request => { calls++; return { status: 'feasible', path: hardPath(request, true) }; }, hardGoalAfterStates: 3 })], 'objective');
  assert.equal(calls, 1); assert.deepEqual(routes[0].walk.map(s => s.segment_id), ['approach', 'long']);
});
test('an exhausted objective budget emits one explicit review candidate that the loader cannot load', () => {
  for (const status of ['unavailable', 'error', 'limit'] as const) {
    const input = hardGoalFixture(), logs: string[] = []; let calls = 0;
    const routes = sourceOf([...discover(input, message => logs.push(message), { maxObjectiveStates: 1, hardGoalAfterStates: 0, hardGoalSolver: () => { calls++; return { status }; } })], 'objective');
    assert.equal(calls, 1); assert.equal(routes.length, 1); assert.deepEqual(routes[0].walk.map(s => s.segment_id), ['approach', 'short']);
    assert.deepEqual(routes[0].reasons, ['objective search budget exhausted; qualifying named alternative unresolved']);
    assert.ok(logs.some(message => /1 exhausted budgets, 1 budget reviews/.test(message)));
    const sources = byId(input.segments), draft = composeDiscovery(routes[0], 0, 'WA', sources), pieces = new DiscoveryPieces();
    assert.equal(draft.row.status, 'review'); pieces.add(draft.walk); pieces.build(sources, 'WA'); draft.row.segments = pieces.materialize(draft.walk); finalizeRows([draft.row], [...pieces.segments.values()]);
    assert.equal(compositionValid(draft.row), true); assert.match(planRoute(draft.row, pieces.segments, { includeReview: true }).skipped!, /composition status review/);
  }
});
test('budget review walks use the original graph even when a road shortcut was pruned from qualifying search', () => {
  const start = xy(0), junction = xy(600), end = xy(1000), rise = (half: number) => Math.sqrt(half ** 2 - 200 ** 2);
  const segments = [segment('approach', ['a', 'b'], [start, junction], null), segment('short', ['b', 's', 'g'], [junction, xy(800, rise(650)), end]), segment('long', ['b', 'l', 'g'], [junction, xy(800, rise(900)), end]), segment('road-shortcut', ['a', 'r', 'g'], [start, xy(500, Math.sqrt(900 ** 2 - 500 ** 2)), end], 'Forest Road', [], 'road')];
  const logs: string[] = [], routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', start), feature('node/2', 'Alpha View', 'viewpoint', end)], access: [] }, message => logs.push(message), { maxObjectiveStates: 1 })], 'objective');
  assert.equal(routes.length, 1); assert.deepEqual(routes[0].walk.map(s => s.segment_id), ['road-shortcut']); assert.ok(routes[0].reasons?.length);
  assert.ok(logs.some(message => /1 bad-excluded edges/.test(message))); assert.equal(composeDiscovery(routes[0], 0, 'WA', byId(segments)).row.status, 'review');
});
test('physical fallback checks every shore and keeps a qualifying route ahead of a nearer unsuitable contact', () => {
  const start = xy(0), end = xy(1000), rise = Math.sqrt(520 ** 2 - 500 ** 2), bend = xy(500, rise), split = xy(500 * 330 / 520, rise * 330 / 520);
  const segments = [segment('start', ['a', 'b'], [start, xy(100)]), segment('road', ['b', 'c'], [xy(100), xy(190)], 'Forest Road', [], 'road'), segment('unnamed', ['c', 'd'], [xy(190), xy(300)], null), segment('tail', ['d', 'g'], [xy(300), end]), segment('cheaper-unnamed', ['a', 'e'], [start, split], null), segment('cheaper-tail', ['e', 'f', 'g'], [split, bend, end])];
  const lake = feature('way/2', 'Alpha Lake', 'lake', xy(600)); lake.boundary = { type: 'MultiPolygon', coordinates: [[[xy(180, -10), xy(1010, -10), xy(1010, 10), xy(180, 10), xy(180, -10)]]] };
  const logs: string[] = [], routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', start), lake], access: [] }, message => logs.push(message), { maxObjectiveStates: 1 })], 'objective');
  assert.equal(routes.length, 1); assert.equal(routes[0].reasons, undefined); assert.deepEqual(routes[0].walk.map(s => s.segment_id), ['start', 'road', 'unnamed', 'tail']);
  assert.ok(logs.some(message => /qualifying physical approach/.test(message))); assert.equal(composeDiscovery(routes[0], 0, 'WA', byId(segments)).row.status, 'ok');
});
test('budget fallbacks keep summit contact and the connector-inclusive 15 km bound', () => {
  for (const gap of [40, 80]) {
    const input = hardGoalFixture(); input.features[1] = feature('node/2', 'Alpha Peak', 'summit', xy(150, gap));
    const routes = sourceOf([...discover(input, () => {}, { maxObjectiveStates: 1 })], 'objective'); assert.equal(routes.length, gap === 40 ? 1 : 0);
    if (routes.length) { const draft = composeDiscovery(routes[0], 0, 'WA', byId(input.segments)); assert.equal(draft.row.status, 'review'); assert.ok(haversine(draft.row.route_end!, xy(150, gap)) <= 5); assert.ok(draft.row.length_m < 15000); }
  }
  const s = segment('too-far', ['a', 'g'], [xy(0), xy(14980)]), routes = sourceOf([...discover({ segments: [s], features: [feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0)), feature('node/2', 'Alpha Peak', 'summit', xy(14980, 50))], access: [] }, () => {}, { maxObjectiveStates: 1 })], 'objective');
  assert.equal(routes.length, 0);
});
test('the objective budget keeps an already qualifying approach and never caps starts or objectives', () => {
  const input = hardGoalFixture(), settled = sourceOf([...discover(input, () => {}, { maxObjectiveStates: 3 })], 'objective');
  assert.equal(settled.length, 1); assert.deepEqual(settled[0].walk.map(s => s.segment_id), ['approach', 'long']); assert.equal(settled[0].reasons, undefined);
  input.features.push(feature('node/3', 'Beta Trailhead', 'trailhead', xy(0)), feature('node/4', 'Beta View', 'viewpoint', xy(150)));
  const routes = sourceOf([...discover(input, () => {}, { maxObjectiveStates: 1 })], 'objective'); assert.equal(routes.length, 4); assert.equal(new Set(routes.map(r => r.identity)).size, 4); assert.ok(routes.every(r => r.reasons?.[0].includes('budget exhausted')));
  assert.throws(() => [...discover(input, () => {}, { maxObjectiveStates: 0 })], /positive integer/);
});
test('a solver optimum must pass the final connector-aware unnamed gate', () => {
  const segments = [segment('approach', ['a', 'b'], [xy(0), xy(266)], null), segment('short', ['b', 'g'], [xy(266), xy(1000)]), segment('long', ['b', 'c', 'g'], [xy(266), xy(600, 500), xy(1000)])], goal = feature('node/2', 'Alpha Peak', 'summit', xy(1000, 50));
  let calls = 0; const routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0)), goal], access: [] }, () => {}, { hardGoalSolver: request => { calls++; return { status: 'optimal', path: [{ edge: request.edges.find(edge => !edge.named)!.id, reverse: false }, { edge: request.edges.filter(edge => edge.named).sort((a, b) => a.length - b.length)[0].id, reverse: false }] }; }, hardGoalAfterStates: 0 })], 'objective');
  assert.equal(calls, 1); assert.equal(routes.length, 1); assert.deepEqual(routes[0].walk.map(s => s.segment_id), ['approach', 'long']); assert.equal(composeDiscovery(routes[0], 0, 'WA', byId(segments)).row.status, 'ok');
});
test('exact mask and ancestor representations both retain a feasible mixed named bypass', () => {
  for (const corridorNodes of [0, 4100]) {
    const start = xy(0), junction = xy(100), end = xy(150), detour = xy(125, 500);
    const segments = [segment('approach', ['a', 'b'], [start, junction], null), segment('short', ['b', 'g'], [junction, end]), segment('long', ['b', 'c', 'g'], [junction, detour, end])];
    let previous = junction, previousNode = 'b';
    for (let i = 0; i < corridorNodes; i++) { const next = xy(100 + 50 * (i + 1) / (corridorNodes + 1), (i + 1) % 2 ? 3 : 0), node = `chain${i}`; segments.push(segment(node, [previousNode, node], [previous, next])); previous = next; previousNode = node; }
    if (corridorNodes) segments.push(segment('chain-end', [previousNode, 'g'], [previous, end]));
    const logs: string[] = [], routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', start), feature('node/2', 'Alpha View', 'viewpoint', end)], access: [] }, message => logs.push(message))], 'objective');
    assert.equal(routes.length, 1); assert.deepEqual(routes[0].walk.map(s => s.segment_id), ['approach', 'long']);
    assert.ok(logs.some(message => (corridorNodes ? /0 mask goals, 1 ancestor goals/ : /1 mask goals, 0 ancestor goals/).test(message)), `${corridorNodes} corridor nodes`);
    assert.ok(logs.some(message => /0 named-infeasible/.test(message)));
  }
});
test('a hanging named cycle cannot dilute the unnamed ratio of a simple objective approach', () => {
  const segments = [segment('approach', ['a', 'b'], [xy(0), xy(500)], null), segment('goal', ['b', 'g'], [xy(500), xy(1000)], null), segment('bx', ['b', 'x'], [xy(500), xy(500, 1000)]), segment('xy', ['x', 'y'], [xy(500, 1000), xy(1500, 1000)]), segment('yb', ['y', 'b'], [xy(1500, 1000), xy(500)])];
  const logs: string[] = [], routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0)), feature('node/2', 'Alpha View', 'viewpoint', xy(1000))], access: [] }, message => logs.push(message))], 'objective');
  assert.equal(routes.length, 0); assert.ok(logs.some(message => /1 named-infeasible/.test(message) && /2 off-target nodes/.test(message) && /0 fallback states/.test(message)));
});
test('off-target pruning protects a farther shore contact that makes a lake approach feasible', () => {
  const start = xy(0), junction = xy(100), near = xy(150), far = xy(150, 1000), segments = [segment('approach', ['a', 'b'], [start, junction], null), segment('near', ['b', 'c'], [junction, near]), segment('far', ['b', 'd'], [junction, far])];
  const lake = feature('way/2', 'Alpha Lake', 'lake', xy(150, 500)); lake.boundary = { type: 'MultiPolygon', coordinates: [[[xy(140, -10), xy(160, -10), xy(160, 1010), xy(140, 1010), xy(140, -10)]]] };
  const routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', start), lake], access: [] })], 'objective');
  assert.equal(routes.length, 1); assert.deepEqual(routes[0].walk.map(s => s.segment_id), ['approach', 'far']); assert.equal(routes[0].walk.at(-1)!.end_vertex, 1);
});
test('whole-route maximum cost excludes an impossible edge in both orientations', () => {
  const start = xy(0), junction = xy(100), end = xy(150), segments = [segment('approach', ['a', 'b'], [start, junction], null), segment('short', ['b', 'g'], [junction, end]), segment('long', ['b', 'c', 'g'], [junction, xy(125, 500), end]), segment('impossible', ['a', 'z', 'g'], [start, xy(0, 7000), end], null)];
  const logs: string[] = [], routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', start), feature('node/2', 'Alpha View', 'viewpoint', end)], access: [] }, message => logs.push(message))], 'objective');
  assert.equal(routes.length, 1); assert.deepEqual(routes[0].walk.map(s => s.segment_id), ['approach', 'long']); assert.ok(logs.some(message => /1 cost-excluded edges/.test(message)));
});
test('forward physical bounds cut over-limit named edges and detour nodes before fallback', () => {
  const start = xy(0), junction = xy(100), end = xy(150), q = xy(1000, 9000), segments = [segment('approach', ['a', 'b'], [start, junction], null), segment('short', ['b', 'g'], [junction, end]), segment('long', ['b', 'c', 'g'], [junction, xy(125, 500), end]), segment('physical-edge', ['a', 'z', 'g'], [start, xy(0, 9000), end]), segment('aq', ['a', 'q'], [start, q]), segment('qg', ['q', 'g'], [q, end])];
  const logs: string[] = [], routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', start), feature('node/2', 'Alpha View', 'viewpoint', end)], access: [] }, message => logs.push(message))], 'objective');
  assert.equal(routes.length, 1); assert.deepEqual(routes[0].walk.map(s => s.segment_id), ['approach', 'long']);
  assert.ok(logs.some(message => /1 physical-excluded nodes, 1 physical-excluded edges/.test(message)));
});
test('coupled bad and named bounds remove named detours needing an impossible unnamed approach', () => {
  const start = xy(0), end = xy(1000), x = xy(0, 5000), y = xy(3000, 5000), segments = [segment('direct', ['a', 'g'], [start, end], null), segment('ax', ['a', 'x'], [start, x], null), segment('named', ['x', 'y'], [x, y]), segment('yg', ['y', 'g'], [y, end], null)];
  const logs: string[] = [], routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', start), feature('node/2', 'Alpha View', 'viewpoint', end)], access: [] }, message => logs.push(message))], 'objective');
  assert.equal(routes.length, 0); assert.ok(logs.some(message => /1 named-infeasible/.test(message) && /3 bad-excluded edges/.test(message) && /0 fallback states/.test(message)));
});
test('bad and named coupling reaches a fixed point when one removed detour invalidates another', () => {
  const start = xy(0), end = xy(1000), x = xy(0, 1000), y = xy(1000, 1000), u = xy(0, 5000), v = xy(1000, 5000), rise = Math.sqrt(1500 ** 2 - 500 ** 2);
  const segments = [segment('direct', ['a', 'g'], [start, end], null), segment('ax', ['a', 'x'], [start, x], null), segment('first-named', ['x', 'm', 'y'], [x, xy(500, 1000 + rise), y]), segment('yg', ['y', 'g'], [y, end], null), segment('au', ['a', 'u'], [start, u], null), segment('second-named', ['u', 'n', 'v'], [u, xy(500, 5000 + rise), v]), segment('vg', ['v', 'g'], [v, end], null)];
  const logs: string[] = [], routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', start), feature('node/2', 'Alpha View', 'viewpoint', end)], access: [] }, message => logs.push(message))], 'objective');
  assert.equal(routes.length, 0); assert.ok(logs.some(message => /1 named-infeasible/.test(message) && /6 bad-excluded edges/.test(message) && /2 coupling passes/.test(message)));
});
test('reverse road resource bounds reject an unavoidable excess before fallback enumeration', () => {
  const segments = [segment('start', ['a', 'b'], [xy(0), xy(100)]), segment('road', ['b', 'c'], [xy(100), xy(2100)], 'Forest Road', [], 'road'), segment('tail', ['c', 'd'], [xy(2100), xy(3000)])];
  const logs: string[] = [], routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0)), feature('node/2', 'Alpha View', 'viewpoint', xy(3000))], access: [] }, message => logs.push(message))], 'objective');
  assert.equal(routes.length, 0); assert.ok(logs.some(message => /0 fallback states, 1 resource-infeasible/.test(message)));
});
test('multi-contact summit settlement includes each connector as a virtual terminal cost', () => {
  const start = xy(0), farContact = xy(1000, 60), summit = xy(1000), nearDetour = xy(500, 100);
  const segments = [segment('far', ['a', 'b'], [start, farContact]), segment('near', ['a', 'c', 'd'], [start, nearDetour, summit], 'Beta Trail')];
  const goal = feature('way/2', 'Alpha Peak', 'summit', summit); goal.boundary = { type: 'MultiPolygon', coordinates: [[[xy(990, -10), xy(1010, -10), xy(1010, 70), xy(990, 70), xy(990, -10)]]] };
  assert.ok(segments[0].length_m < segments[1].length_m); assert.ok(segments[0].length_m + 60 > segments[1].length_m);
  const routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', start), goal], access: [] })], 'objective');
  assert.equal(routes.length, 1); assert.deepEqual(routes[0].walk.map(s => s.segment_id), ['near']);
});
test('summit connectors count toward the final 30% unnamed budget before goal settlement', () => {
  for (const [bad, expected] of [[265, 1], [266, 0]] as const) {
    const segments = [segment('approach', ['a', 'b'], [xy(0), xy(bad)], null), segment('named', ['b', 'c'], [xy(bad), xy(1000)])], goal = feature('node/2', 'Alpha Peak', 'summit', xy(1000, 50));
    const routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0)), goal], access: [] })], 'objective');
    assert.equal(routes.length, expected); if (expected) assert.equal(composeDiscovery(routes[0], 0, 'WA', byId(segments)).row.status, 'ok');
  }
});
test('summit connectors cannot dilute an initially excessive road share into a settled goal', () => {
  const segments = [segment('start', ['a', 'b'], [xy(0), xy(100)]), segment('road', ['b', 'c'], [xy(100), xy(204)], 'Forest Road', [], 'road'), segment('tail', ['c', 'd'], [xy(204), xy(1000)])];
  const goal = feature('node/2', 'Alpha Peak', 'summit', xy(1000, 50));
  const routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0)), goal], access: [] })], 'objective');
  assert.equal(routes.length, 0);
});
test('absolute objective budgets retain repairable prefixes and their exact 15 km boundary', () => {
  for (const [badMetres, roadMetres, expected] of [[4500, 1500, 1], [4501, 1500, 0], [4500, 1501, 0]] as const) {
    const start = xy(0), first = xy(0, 100), roadEnd = xy(0, 100 + roadMetres), unnamedEnd = xy(0, 100 + badMetres), end = xy(0, 15000);
    const segments = [segment('start', ['a', 'b'], [start, first]), segment('road', ['b', 'c'], [first, roadEnd], 'Forest Road', [], 'road'), segment('unnamed', ['c', 'd'], [roadEnd, unnamedEnd], null), segment('tail', ['d', 'e'], [unnamedEnd, end])];
    const routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', start), feature('node/2', 'Alpha View', 'viewpoint', end)], access: [] })], 'objective');
    assert.equal(routes.length, expected, `${badMetres} unnamed/road metres, including ${roadMetres} road metres`);
    if (expected) {
      const total = routes[0].walk.reduce((n, s) => n + s.length_m, 0); assert.ok(Math.abs(total - 15000) < 1e-6);
      assert.ok(badMetres / (100 + badMetres) > .9, 'the high unnamed prefix ratio must be repairable by the named tail');
      assert.equal(composeDiscovery(routes[0], 0, 'CA', byId(segments)).row.status, 'ok');
    }
  }
});
test('interior trailhead and objective snaps retain exact source vertex intervals', () => {
  const s = segment('long', ['a', 'b', 'c', 'd'], [xy(0), xy(1000), xy(2000), xy(3000)]);
  const route = sourceOf([...discover({ segments: [s], features: [feature('node/1', 'Alpha Trailhead', 'trailhead', xy(1000)), feature('node/2', 'Alpha Lake', 'lake', xy(2000))], access: [] })], 'objective')[0];
  assert.equal(route.walk.length, 1); assert.equal(route.walk[0].start_vertex, 1); assert.equal(route.walk[0].end_vertex, 2);
});
test('one lake has one objective approach from each disconnected shore trailhead', () => {
  const west = segment('west', ['wa', 'wb', 'wc'], [xy(-2500), xy(-1000), xy(-1000, 100)]), east = segment('east', ['ea', 'eb', 'ec'], [xy(2500), xy(1000), xy(1000, 100)], 'Beta Trail');
  const lake = feature('way/20', 'Alpha Lake', 'lake', xy(0));
  lake.boundary = { type: 'MultiPolygon', coordinates: [[[xy(-1000, -500), xy(1000, -500), xy(1000, 500), xy(-1000, 500), xy(-1000, -500)]]] };
  const routes = sourceOf([...discover({ segments: [west, east], features: [feature('node/1', 'West Trailhead', 'trailhead', xy(-2500)), feature('node/2', 'East Trailhead', 'trailhead', xy(2500)), lake], access: [] })], 'objective');
  assert.equal(routes.length, 2); assert.deepEqual(new Set(routes.map(r => r.trailhead.osm_id)), new Set(['node/1', 'node/2'])); assert.ok(routes.every(r => r.objective === lake));
  assert.ok(routes.every(r => r.walk[0].end_vertex === 1), 'each approach stops at its first contacted shore vertex');
  for (const route of routes) assert.equal(composeDiscovery(route, 0, 'WA', byId([west, east])).row.status, 'ok');
});

test('uncovered named trails at least 2 km long become out-and-back hikes', () => {
  const s = segment('ab', ['a', 'b'], [xy(0), xy(2500)], 'ALPHA TRAIL'), th = feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0));
  let routes = sourceOf([...discover({ segments: [s], features: [th], access: [] })], 'named_trail');
  assert.equal(routes.length, 1); assert.equal(routes[0].name, 'Alpha Trail'); assert.equal(routes[0].shape, 'out_and_back');
  routes = sourceOf([...discover({ segments: [s], features: [th, feature('node/2', 'Alpha Lake', 'lake', xy(2500))], access: [] })], 'named_trail');
  assert.equal(routes.length, 0, 'the objective approach already covers this named trail');
  const short = segment('short', ['a', 'b'], [xy(0), xy(1900)]); assert.equal(sourceOf([...discover({ segments: [short], features: [th], access: [] })], 'named_trail').length, 0);
});
test('named-trail end road contact can infer a trailhead without expanding objective starts', () => {
  const s = segment('ab', ['a', 'b'], [xy(0), xy(2500)]), road: AccessPoint = { osm_id: 'node/20', coord: xy(0, 124), parking: false };
  const parallel = segment('parallel', ['x', 'y'], [xy(0, 120), xy(100, 120)], 'Beta Trail');
  const routes = [...discover({ segments: [s, parallel], features: [feature('node/2', 'Alpha Lake', 'lake', xy(2500))], access: [road] })], named = sourceOf(routes, 'named_trail');
  assert.equal(named.length, 1); assert.equal(named[0].trailhead, road); assert.deepEqual(named[0].trailheadCoord, xy(0)); assert.equal(named[0].trailheadEvidence!.access, road); assert.equal(named[0].trailheadEvidence!.node_id, 'a');
  assert.ok(Math.abs(named[0].trailheadEvidence!.gap_m - 124) < .01); assert.equal(sourceOf(routes, 'objective').length, 0);
});
test('road-inferred named trails need access within 125 m and never start at bare trail ends', () => {
  const s = segment('ab', ['a', 'b'], [xy(0), xy(2500)]);
  const farRoad: AccessPoint = { osm_id: 'node/20', coord: xy(0, 126), parking: false };
  assert.equal(sourceOf([...discover({ segments: [s], features: [], access: [farRoad] })], 'named_trail').length, 0);
  assert.equal(sourceOf([...discover({ segments: [s], features: [], access: [] })], 'named_trail').length, 0);
});
test('an existing named-trail trailhead takes precedence over an inferred road contact', () => {
  const s = segment('ab', ['a', 'b'], [xy(0), xy(2500)]), th = feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0)), road: AccessPoint = { osm_id: 'node/20', coord: xy(0, 20), parking: false };
  const routes = sourceOf([...discover({ segments: [s], features: [th], access: [road] })], 'named_trail');
  assert.equal(routes.length, 1); assert.equal(routes[0].trailhead, th); assert.equal(routes[0].trailheadEvidence, undefined);
});
function lollipop(scale = 1, thirdName = false) {
  const a = xy(0), b = xy(1000 * scale), c = xy(2500 * scale), d = xy(2000 * scale, 1000 * scale);
  const segments = [segment('stem', ['a', 'b'], [a, b]), segment('bc', ['b', 'c'], [b, c]), segment('cd', ['c', 'd'], [c, d], 'Beta Trail'), segment('db', ['d', 'b'], [d, b], thirdName ? 'Gamma Trail' : 'Beta Trail')];
  const routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', a)], access: [] })], 'lollipop');
  return { segments, routes };
}
test('two-named-trail lollipops include the shared stem twice and keep a connected 3–30 km loop', () => {
  const { segments, routes } = lollipop(); assert.equal(routes.length, 1); const route = routes[0];
  assert.equal(route.shape, 'loop'); assert.equal(route.walk[0].segment_id, 'stem'); assert.equal(route.walk.at(-1)!.segment_id, 'stem');
  const distance = route.walk.reduce((n, s) => n + s.length_m, 0); assert.ok(distance >= 3000 && distance <= 30000); connected(route.walk, byId(segments), true);
  assert.equal(composeDiscovery(route, 0, 'WA', byId(segments)).row.status, 'ok');
});
test('lollipop discovery excludes short loops, loops over 30 km, and three-name cycles', () => {
  assert.equal(lollipop(.2).routes.length, 0); assert.equal(lollipop(8).routes.length, 0); assert.equal(lollipop(1, true).routes.length, 0);
});
test('lollipop titles do not repeat Loop when the final trail name already ends with it', () => {
  const { segments } = lollipop();
  for (const s of segments) if (s.name === 'Beta Trail') { s.name = 'Fox Loop'; s.trail_names = ['Fox Loop']; }
  const routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0))], access: [] })], 'lollipop');
  assert.equal(routes.length, 1); assert.equal(routes[0].name, 'Alpha Trail and Fox Loop'); assert.doesNotMatch(routes[0].name, /\bloop\s+loop\b/i);
});
test('a third-name diagonal cannot hide an outer two-name lollipop from the cycle basis', () => {
  const a = xy(1000), b = xy(2500), c = xy(2500, 1500), d = xy(1000, 1500), th = xy(0);
  const segments = [segment('ab', ['a', 'b'], [a, b]), segment('bc', ['b', 'c'], [b, c], 'Beta Trail'), segment('cd', ['c', 'd'], [c, d]), segment('da', ['d', 'a'], [d, a], 'Beta Trail'), segment('ac', ['a', 'c'], [a, c], 'Gamma Trail'), segment('stem', ['th', 'a'], [th, a])];
  const routes = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', th)], access: [] })], 'lollipop');
  const outer = routes.find(r => r.preferredNames.includes('Alpha Trail') && r.preferredNames.includes('Beta Trail'));
  assert.ok(outer); assert.ok(!outer.walk.some(s => s.segment_id === 'ac')); assert.equal(outer.walk[0].segment_id, 'stem'); connected(outer.walk, byId(segments), true);
});

test('route names expand Mount/Mountain/Peak and title-case agency capitals without road titles', () => {
  assert.equal(routeTitle('Mt. Hood Trail'), 'Mount Hood Trail'); assert.equal(routeTitle('BLUE MTN TRAIL'), 'Blue Mountain Trail'); assert.equal(routeTitle('ALPHA PK TRAIL'), 'Alpha Peak Trail');
  assert.equal(routeTitle('EAGLE CREEK TRAIL'), 'Eagle Creek Trail'); assert.equal(discoveryName('Forest Service Road 23'), null); assert.equal(discoveryName('Summit Rd.'), null);
  for (const road of ['Franklin Place Northeast', 'Franklin Pl. NE', 'First Ave Northwest', 'Lake Street North', 'Summit St SW', 'Eagle Blvd. Southeast', 'Cedar Lane West', 'Highway 101 North']) assert.equal(discoveryName(road), null, road);
  for (const road of ['NFDR610', 'Nfdr 610', 'Nfdr610', 'FSR12', 'FSR-12', 'NFR #12', 'FR610', 'FR 610', 'FR-610', 'FDR610', 'FDR #610']) assert.equal(discoveryName(road), null, road);
  for (const road of ['Nfd 9711', 'NFD1800-013', 'Fs 1905-764', 'Fs 284A', 'NF4811-120', 'Nf-65 (abandoned)', 'Usfs 1381', 'Forest Service 597', 'North 2000 East', 'East 2200 North', 'S 1700 E', 'Southeast 312th Way']) assert.equal(discoveryName(road), null, road);
  for (const road of ['1701-524', '39-2-3', '16407', '1.2.3', '14000N', '14000 North', 'Silverleaf Mine Rd Fs-1078', 'Conjector Mine Rd Fs-1017', 'Ndfr 1675', 'Forest Road Fs6550-610']) assert.equal(discoveryName(road), null, road);
  for (const road of ['Forest Road 4110-118', 'Forest Road 9703-112', 'Forest Road 4600-301', 'Forest Road 9712-218', 'Forest Road 4110 - 118', 'Forest Road #4110-118', 'Forest Road 41.5', 'Forest Road 41 1/2', 'Forest Road 41 / 2', '4948- 119', '4948 -119', '39 - 2 - 3', '1 / 2', '1. 2 .3']) assert.equal(discoveryName(road), null, road);
  for (const road of ['Forest Road 4W325', 'Forest Road 2281-180 B125', 'Forest Road 2304 (Road to Nowhere;Green Tunnel)', 'Forest Road 5701 (closed)', 'Forest Road 3330 (unimproved)', 'Forest Road 18N09', 'Forest Road4W325', 'National Forest Development Road 056 Trail', 'North National Forest Development Road 323 Trail', 'Natl Forest Develop Road 119 Trail', 'Natl. Forest Service Road 41 Trail', 'Forest Dev. Rd. 12 Trail']) assert.equal(discoveryName(road), null, road);
  assert.equal(discoveryName('Forest Trail 12'), null); assert.equal(discoveryName('ForestTrail12'), null); assert.equal(discoveryName('NF 12 Trail'), null);
  assert.equal(discoveryName('Fs 81 Shoshone Ridge Trail'), 'Fs 81 Shoshone Ridge Trail'); assert.equal(discoveryName('Cdt Fs 1790'), null); assert.equal(discoveryName('N88E Stinky'), 'N88E Stinky'); assert.equal(discoveryName('East Mountain Way'), 'East Mountain Way');
  assert.equal(discoveryName('Trail 424'), null); assert.equal(discoveryName('Black Trail #16407'), 'Black Trail'); assert.equal(discoveryName('Boulder Mountain Spur (Nf-1045)'), 'Boulder Mountain Spur');
  assert.equal(discoveryName('Trail 4110-118'), null); assert.equal(discoveryName('Black Trail #4948- 119'), 'Black Trail'); assert.equal(discoveryName('U1100'), null); assert.equal(discoveryName('A-0100'), null);
  assert.equal(discoveryName('Old Road Trail'), null); assert.equal(discoveryName('Cedar Lane Trail'), null);
});
test('source names expand separator-adjacent Mount, Mountain and Peak abbreviations', () => {
  for (const [source, expected] of [
    ['Little Castle Lake/Mt. Bradley Trailhead', 'Little Castle Lake/Mount Bradley Trailhead'],
    ['Little Castle Lake/Mt.Bradley Trailhead', 'Little Castle Lake/Mount Bradley Trailhead'],
    ['Little Castle Lake-Mt. Bradley Trailhead', 'Little Castle Lake-Mount Bradley Trailhead'],
    ['Little Castle Lake–Mt. Bradley Trailhead', 'Little Castle Lake–Mount Bradley Trailhead'],
    ['Little Castle Lake—Mt. Bradley Trailhead', 'Little Castle Lake—Mount Bradley Trailhead'],
    ['Blue/Mtn. Trail', 'Blue/Mountain Trail'], ['Blue-Pk. Trail', 'Blue-Peak Trail'],
    ['Chimney Mt-Trail', 'Chimney Mountain-Trail'], ['BLUE-MTN-TRAIL', 'Blue-Mountain-Trail'],
    ['Mount St. Helens/Blue Lake Trail', 'Mount St. Helens/Blue Lake Trail'], ['40S02A-Blue Trail', '40S02A-Blue Trail'],
  ]) { assert.equal(displayName(source), expected, source); assert.doesNotThrow(() => assertDisplayName(displayName(source))); assert.equal(routeTitle(source), expected); }
});
test('a slash alias cannot hide a road name while numbered trail fractions stay eligible', () => {
  for (const name of ['Cascade Fire Road / Repack', 'Repack / Cascade Fire Road', 'Cascade Fire Road/Repack', 'Repack/Cascade Fire Road']) assert.equal(discoveryName(name), null, name);
  for (const name of ['Forest Road 23 (Sunshine Trail)', 'Sunshine Trail (Forest Road 23)']) assert.equal(discoveryName(name), null, name);
  for (const name of ['Trail 1/2', 'Trail 424/427']) assert.equal(discoveryName(name), null, name);
  for (const name of ['Half Mile / 1/2 Loop Trail', 'Lake Trail / Ridge Trail']) assert.equal(discoveryName(name), name, name);
  const road = segment('road-alias', ['a', 'b'], [xy(0), xy(2500)], 'Cascade Fire Road / Repack'), objective = feature('node/2', 'Green Hill', 'summit', xy(2500)), trailhead = feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0));
  assert.equal(sourceOf([...discover({ segments: [road], features: [trailhead, objective], access: [] })], 'objective').length, 0, 'a road alias supplies no named-trail coverage');
  const forced = candidate([road], { source: 'objective', name: 'Green Hill via Cascade Fire Road / Repack', objective, preferredNames: [road.name!] });
  assert.equal(composeDiscovery(forced, 0, 'CA', byId([road])).row.status, 'review');
  road.trail_names.push('Redwood Trail');
  const routes = sourceOf([...discover({ segments: [road], features: [trailhead, objective], access: [] })], 'objective');
  assert.equal(routes.length, 1); assert.equal(routes[0].name, 'Green Hill via Redwood Trail'); assert.deepEqual(routes[0].preferredNames, ['Redwood Trail']); assert.equal(composeDiscovery(routes[0], 0, 'CA', byId([road])).row.status, 'ok');
});
test('composition quality checks road share, preferred names and physical connectivity', () => {
  const a = segment('ab', ['a', 'b'], [xy(0), xy(800)]), b = segment('bc', ['b', 'c'], [xy(800), xy(1000)], 'Forest Road', [], 'road');
  let row = composeDiscovery(candidate([a, b]), 0, 'WA', byId([a, b])).row;
  assert.equal(row.status, 'review'); assert.match(row.reasons.join('; '), /road share/);
  row = composeDiscovery(candidate([a], { preferredNames: ['Different Trail'] }), 0, 'WA', byId([a])).row;
  assert.equal(row.status, 'review'); assert.match(row.reasons.join('; '), /preferred-name share/);
  const far = segment('far', ['x', 'y'], [xy(5000), xy(6000)]);
  row = composeDiscovery(candidate([a, far]), 0, 'WA', byId([a, far])).row;
  assert.equal(row.status, 'failed'); assert.match(row.reasons.join('; '), /disconnected walk/);
  row = composeDiscovery(candidate([a], { shape: 'loop' }), 0, 'WA', byId([a])).row;
  assert.equal(row.status, 'failed'); assert.match(row.reasons.join('; '), /open loop/);
});
test('40 m summit gaps use the existing connector; 80 m gaps stay review-only', () => {
  for (const [gap, expected] of [[40, 'ok'], [80, 'review']] as const) {
    const s = segment('ab', ['a', 'b'], [xy(0), xy(2500)]), sources = byId([s]);
    const draft = composeDiscovery(candidate([s], { source: 'objective', objective: feature('node/2', 'Alpha Peak', 'summit', xy(2500, gap)) }), 0, 'OR', sources);
    assert.equal(draft.row.status, expected);
    if (gap === 40) { assert.equal(draft.walk.length, 2); assert.deepEqual(draft.row.route_end, xy(2500, gap)); assert.equal(sources.get(draft.walk[1].segment_id)!.kind, 'xc'); assert.equal(sources.get(draft.walk[1].segment_id)!.state_code, 'OR'); }
    else { assert.equal(draft.walk.length, 1); assert.match(draft.row.reasons.join('; '), />75 m|contact exceeds 5 m/); }
  }
});
test('a summit connector starts at the traversed endpoint of a partial parent and leaves its source intact', () => {
  for (const reverse of [false, true]) {
    const s = segment('long', ['a', 'b', 'c', 'd'], [xy(0), xy(1000), xy(2000), xy(3000)]), before = structuredClone(s), sources = byId([s]);
    const start = reverse ? 2 : 1, end = reverse ? 1 : 2, finish = reverse ? 1000 : 2000;
    const draft = composeDiscovery(candidate([s], { source: 'objective', walk: [step(s, start, end)], trailhead: feature('node/1', 'Alpha Trailhead', 'trailhead', xy(reverse ? 2000 : 1000)), trailheadCoord: xy(reverse ? 2000 : 1000), objective: feature('node/2', 'Alpha Peak', 'summit', xy(finish, 40)) }), 0, 'WA', sources);
    assert.equal(draft.row.status, 'ok'); assert.equal(draft.walk.length, 2); connected(draft.walk, sources); assert.deepEqual(s, before); assert.equal(sources.get(s.id), s);
  }
});
test('objective contacts use feature footprints and reject distant point objectives', () => {
  const s = segment('ab', ['a', 'b'], [xy(0), xy(2500)]), lake = feature('way/2', 'Alpha Lake', 'lake', xy(2500, 500));
  let row = composeDiscovery(candidate([s], { source: 'objective', objective: lake }), 0, 'WA', byId([s])).row;
  assert.equal(row.status, 'review'); assert.match(row.reasons.join('; '), /lake objective contact/);
  lake.boundary = { type: 'MultiPolygon', coordinates: [[[xy(2400, -20), xy(2600, -20), xy(2600, 1000), xy(2400, 1000), xy(2400, -20)]]] };
  row = composeDiscovery(candidate([s], { source: 'objective', objective: lake }), 0, 'WA', byId([s])).row; assert.equal(row.status, 'ok');
});
test('objective approaches under 100 m need review while the bound leaves longer hikes loadable', () => {
  for (const [metres, expected] of [[99, 'review'], [101, 'ok']] as const) {
    const s = segment('ab', ['a', 'b'], [xy(0), xy(metres)]), goal = feature('node/2', 'Alpha View', 'viewpoint', xy(metres));
    const row = composeDiscovery(candidate([s], { source: 'objective', objective: goal }), 0, 'WA', byId([s])).row;
    assert.equal(row.status, expected); if (expected === 'review') assert.match(row.reasons.join('; '), /shorter than 100 m/);
  }
});
test('named trail and open relation out-and-back routes retain an exact mapped trail end objective', () => {
  for (const source of ['named_trail', 'relation'] as const) {
    const s = segment('long', ['a', 'b', 'c'], [xy(0), xy(1000), xy(2500)]);
    const row = composeDiscovery(candidate([s], { source, walk: [step(s, 0, 1)] }), 0, 'WA', byId([s])).row;
    assert.equal(row.status, 'ok'); assert.equal(row.objective!.new!.name, 'Alpha Trail End'); assert.equal(row.objective!.new!.feature, 'landform');
    assert.deepEqual([row.objective!.new!.lng, row.objective!.new!.lat], xy(1000)); assert.equal(row.objective!.new!.source.kind, 'trail_end'); assert.equal(row.objective!.new!.source.node_id, 'b');
  }
});
test('a point-to-point route with no natural objective uses its contacted far trailhead', () => {
  const s = segment('ab', ['a', 'b'], [xy(0), xy(2500)]), end = parking('way/2', xy(2500), 'Beta Trailhead');
  const row = composeDiscovery(candidate([s], { source: 'relation', shape: 'point_to_point', endTrailhead: end }), 0, 'ID', byId([s])).row;
  assert.equal(row.status, 'ok'); assert.equal(row.kind, 'traverse'); assert.equal(row.objective, row.end_trailhead); assert.equal(row.objective!.new!.name, 'Beta Trailhead');
});
test('summit objectives on traverses get exact contact with a state-prefixed connector', () => {
  for (const state of ['OR', 'ID', 'CA'] as const) {
    const s = segment('ab', ['a', 'b'], [xy(0), xy(2500)]), sources = byId([s]), goal = feature('node/2', 'Alpha Peak', 'summit', xy(2500, 40));
    const draft = composeDiscovery(candidate([s], { source: 'relation', shape: 'point_to_point', objective: goal, endTrailhead: parking('way/3', xy(2500, 40), 'Summit Trailhead') }), 0, state, sources);
    assert.equal(draft.row.status, 'ok'); assert.equal(draft.row.kind, 'traverse'); assert.equal(draft.row.shape, 'point_to_point'); assert.equal(draft.walk.length, 2);
    assert.match(draft.walk[1].segment_id, new RegExp(`^${state.toLowerCase()}-summit-connector-`)); assert.equal(draft.row.segments[1].id, draft.walk[1].segment_id); connected(draft.walk, sources);
    assert.deepEqual(draft.row.route_end, xy(2500, 40)); assert.equal(sources.get(draft.walk[1].segment_id)!.state_code, state);
  }
});
test('point-to-point far trailheads must contact the mapped endpoint within 125 m', () => {
  for (const [gap, expected] of [[124, 'ok'], [126, 'review']] as const) {
    const s = segment('ab', ['a', 'b'], [xy(0), xy(2500)]), goal = feature('node/2', 'Alpha Lake', 'lake', xy(2500));
    const draft = composeDiscovery(candidate([s], { source: 'relation', shape: 'point_to_point', objective: goal, endTrailhead: parking('way/3', xy(2500, gap), 'Beta Trailhead') }), 0, 'OR', byId([s]));
    assert.equal(draft.row.status, expected); if (expected === 'review') assert.match(draft.row.reasons.join('; '), /end trailhead|far trailhead/);
  }
});
test('the far trailhead contact gate uses the endpoint after a summit connector moves it', () => {
  for (const [gap, expected] of [[124, 'ok'], [126, 'review']] as const) {
    const s = segment('ab', ['a', 'b'], [xy(0), xy(2500)]), goal = feature('node/2', 'Alpha Peak', 'summit', xy(2500, 40));
    const draft = composeDiscovery(candidate([s], { source: 'relation', shape: 'point_to_point', objective: goal, endTrailhead: parking('way/3', xy(2500, 40 + gap), 'Summit Trailhead') }), 0, 'OR', byId([s]));
    assert.equal(draft.walk.length, 2); assert.deepEqual(draft.row.route_end, xy(2500, 40)); assert.equal(draft.row.status, expected);
    if (expected === 'review') assert.match(draft.row.reasons.join('; '), /end trailhead|far trailhead/);
  }
});
test('OSM feature credit stays separate from a public-domain agency route geometry source', () => {
  const s = segment('agency', ['a', 'b'], [xy(0), xy(2500)]); s.provenance = provenance([], time, 'usfs', '31'); s.osm_way_ids = []; s.osm_edge_way_ids = [];
  const draft = composeDiscovery(candidate([s], { source: 'objective', objective: feature('way/2', 'Alpha Lake', 'lake', xy(2500)) }), 0, 'OR', byId([s]));
  const th = draft.row.trailhead!.new!.source.provenance!, goal = draft.row.objective!.new!.source.provenance!;
  assert.equal(th.source_kind, 'openstreetmap'); assert.equal(th.source_url, 'https://www.openstreetmap.org/node/1'); assert.equal(th.contains_osm_geometry, false);
  assert.equal(goal.source_kind, 'openstreetmap'); assert.equal(goal.source_url, 'https://www.openstreetmap.org/way/2'); assert.equal(goal.license_name, 'Open Data Commons Open Database License (ODbL) 1.0'); assert.deepEqual(goal.osm_way_ids, [2]);
  finalizeRows([draft.row], [s]); assert.equal(draft.row.provenance!.source_kind, 'usfs'); assert.equal(draft.row.provenance!.license_name, 'Public domain'); assert.equal(draft.row.provenance!.contains_osm_geometry, false);
});
test('OSM and agency popularity signals produce a bounded 0–1 score', () => {
  const relation: Relation = { id: 1, name: 'Alpha Trail', route: 'hiking', network: 'nwn' }, s = segment('ab', ['a', 'b'], [xy(0), xy(2500)], 'Alpha Trail', [relation]);
  s.alt_sources = [{ source: 'usfs', id: '1', name: 'National Recreation Trail', number: null }];
  const goal = { ...feature('node/2', 'Alpha Peak', 'summit', xy(2500)), ele: 2500, tags: { wikidata: 'Q1', wikipedia: 'en:Alpha', prominence: '500' } };
  const rich = popularity(candidate([s], { objective: goal }), byId([s]), 6);
  s.relations = []; s.alt_sources = []; const sparse = popularity(candidate([s]), byId([s]));
  assert.ok(rich > .7 && rich <= 1); assert.ok(sparse > 0 && sparse < rich);
});
test('trailhead popularity counts all incident named trails rather than only the chosen walk', () => {
  const segments = [segment('ab', ['a', 'b'], [xy(0), xy(2500)]), segment('ac', ['a', 'c'], [xy(0), xy(0, 1000)], 'Beta Trail'), segment('ad', ['a', 'd'], [xy(0), xy(-1000)], 'Gamma Trail')];
  const route = sourceOf([...discover({ segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', xy(0)), feature('node/2', 'Alpha Lake', 'lake', xy(2500))], access: [] })], 'objective')[0];
  assert.equal(route.junctionNameCount, 3); assert.equal(route.walk.length, 1);
});

function summary(index: number, walk: RouteStep[], source: Map<string, Segment>, overrides: Partial<DiscoverySummary> = {}): DiscoverySummary {
  return { index, name: 'Alpha Peak via Alpha Trail', objective: 'node/2', start: xy(0), trailhead: 'node/1', walk, length: walk.reduce((n, s) => n + s.length_m, 0), quality: 100, ...overrides };
}
test('dedupe keeps the best same-objective route with at least 80% shared length', () => {
  const common = segment('common', ['a', 'b'], [xy(0), xy(800)]), tail = segment('tail', ['b', 'c'], [xy(800), xy(1000)]), alternative = segment('alt', ['b', 'd'], [xy(800), xy(800, 200)]), sources = byId([common, tail, alternative]);
  const a = summary(0, [step(common), step(tail)], sources), b = summary(1, [step(common), step(alternative)], sources, { name: 'Alpha Peak via Beta Trail', quality: 101 });
  assert.ok(sharedLength(a, b, sources) >= .8 * Math.min(a.length, b.length) - .01);
  const deduper = new DiscoveryDeduper(sources); assert.equal(deduper.consider(a), true); assert.equal(deduper.consider(b), true); assert.deepEqual([...deduper.kept.keys()], [1]);
});
test('different trailheads to one objective stay distinct, while nearby duplicate names do not', () => {
  const s = segment('ab', ['a', 'b'], [xy(0), xy(2500)]), sources = byId([s]), deduper = new DiscoveryDeduper(sources);
  const a = summary(0, [step(s)], sources), b = summary(1, [step(s)], sources, { name: 'Alpha Peak via Beta Trail', start: xy(500), trailhead: 'node/3' });
  assert.equal(deduper.consider(a), true); assert.equal(deduper.consider(b), true); assert.equal(deduper.kept.size, 2);
  const collision = summary(2, [step(s)], sources, { name: a.name, start: xy(1000), trailhead: 'node/4' });
  assert.equal(deduper.distinctTrailheadName(collision), true); assert.equal(deduper.consider(collision), false); assert.equal(deduper.kept.size, 2);
});
test('distinct trailheads 20 m apart stay separate while aliases at one exact contact dedupe', () => {
  const s = segment('ab', ['a', 'b', 'c'], [xy(0), xy(20), xy(1000)]), sources = byId([s]), deduper = new DiscoveryDeduper(sources);
  const a = summary(0, [step(s, 0, 2)], sources), b = summary(1, [step(s, 1, 2)], sources, { name: 'Alpha Peak via Beta Trail', start: xy(20), trailhead: 'node/3' });
  assert.ok(sharedLength(a, b, sources) > .8 * Math.min(a.length, b.length)); assert.equal(deduper.consider(a), true); assert.equal(deduper.consider(b), true); assert.equal(deduper.kept.size, 2);
  assert.equal(deduper.distinctTrailheadName({ ...b, name: a.name }), true);
  const parkingAlias = summary(2, [step(s, 0, 2)], sources, { name: 'Alpha Peak via Parking Approach', trailhead: 'way/4', quality: 99 });
  assert.equal(deduper.consider(parkingAlias), false); assert.deepEqual([...deduper.kept.keys()], [0, 1]);
});
test('dedupe measures shared metres rather than the fraction of source vertices', () => {
  for (const [points, end, shouldReplace] of [
    [[xy(0), xy(10), xy(20), xy(1000)], 2, false],
    [[xy(0), xy(900), xy(950), xy(1000)], 1, true],
  ] as [Coord[], number, boolean][]) {
    const s = segment('uneven', ['a', 'b', 'c', 'd'], points), shared = step(s, 0, end), tail = segment('tail', [s.node_ids[end], 'e'], [points[end], xy(1000)]), sources = byId([s, tail]);
    const a = summary(0, [step(s)], sources), b = summary(1, [shared, step(tail)], sources, { name: 'Alpha Peak via Beta Trail', quality: 101 });
    const metres = sharedLength(a, b, sources); assert.ok(Math.abs(metres - shared.length_m) < .01);
    assert.equal(metres >= .8 * Math.min(a.length, b.length), shouldReplace);
    const deduper = new DiscoveryDeduper(sources); assert.equal(deduper.consider(a), true); assert.equal(deduper.consider(b), true); assert.equal(deduper.kept.size, shouldReplace ? 1 : 2);
  }
});
test('same-objective named approaches dedupe across trailheads at 60% shared metres', () => {
  const common = segment('shared', ['a', 'b'], [xy(0), xy(600)]), tail = segment('tail', ['b', 'c'], [xy(600), xy(1000)]), other = segment('other', ['b', 'd'], [xy(600), xy(600, 400)]), sources = byId([common, tail, other]);
  const first = summary(0, [step(common), step(tail)], sources, { trail: 'alpha', trailheadLabel: 'North Trailhead' });
  const second = summary(1, [step(common), step(other)], sources, { trail: 'alpha', start: xy(600, 400), trailhead: 'node/3', trailheadLabel: 'South Trailhead', quality: 101 });
  const deduper = new DiscoveryDeduper(sources); deduper.consider(first); deduper.consider(second);
  assert.deepEqual([...deduper.kept.keys()], [1]); assert.equal(deduper.finalNames().get(1), first.name);
});
test('from labels distinguish only retained same-objective same-trail approaches', () => {
  const north = segment('north', ['a', 'b'], [xy(0), xy(1000)]), south = segment('south', ['c', 'd'], [xy(0, 1000), xy(1000, 1000)]), sources = byId([north, south]), deduper = new DiscoveryDeduper(sources);
  const first = summary(0, [step(north)], sources, { trail: 'alpha', trailheadLabel: 'North Trailhead' });
  const second = summary(1, [step(south)], sources, { trail: 'alpha', trailheadLabel: 'South Trailhead', start: xy(0, 1000), trailhead: 'node/3' });
  deduper.consider(first); assert.equal(deduper.finalNames().get(0), first.name);
  deduper.consider(second); assert.equal(deduper.kept.size, 2);
  assert.equal(deduper.finalNames().get(0), `${first.name} from North Trailhead`);
  assert.equal(deduper.finalNames().get(1), `${second.name} from South Trailhead`);
  const coded = summary(2, [step(south)], sources, { trail: 'alpha', start: xy(0, 2000), trailhead: 'node/4', quality: 99 });
  assert.equal(deduper.consider(coded), false);
});
test('composition keeps seasonal flags and numbered aliases outside cleaned names', () => {
  const s = segment('trail', ['a', 'b'], [xy(0), xy(2500)], 'Diamond Peak Trail #3699'), goal = feature('node/2', 'Shepherd Pond (seasonal)', 'lake', xy(2500));
  const draft = composeDiscovery(candidate([s], { source: 'objective', name: 'Shepherd Pond via Diamond Peak Trail', preferredNames: ['Diamond Peak Trail'], objective: goal }), 0, 'OR', byId([s]));
  assert.equal(draft.row.status, 'ok'); assert.equal(draft.row.objective!.new!.name, 'Shepherd Pond');
  assert.deepEqual(draft.row.flags, ['seasonal']); assert.ok(draft.row.aliases.includes('Diamond Peak Trail #3699'));
});
test('unsafe parking source names never become generated from labels', () => {
  const s = segment('trail', ['a', 'b'], [xy(0), xy(2500)]);
  for (const name of ['P5', 'Mather Road', 'Horsetail Falls Parkin…']) {
    const draft = composeDiscovery(candidate([s], { trailhead: parking('way/3', xy(0), name) }), 0, 'CA', byId([s]));
    assert.equal(draft.row.trailhead!.new!.source.name_is_fallback, true);
    assert.equal(discoverySummary(draft).trailheadLabel, undefined);
  }
});
test('objective source aliases remain available for seed overlap and search', () => {
  const s = segment('trail', ['a', 'b'], [xy(0), xy(2500)]), objective = { ...feature('node/2', 'Alpha Lake / Native Name', 'lake', xy(2500)), aliases: ['Alpha Lake', 'Native Name'] };
  const row = composeDiscovery(candidate([s], { source: 'objective', objective, name: 'Alpha Lake / Native Name via Alpha Trail' }), 0, 'WA', byId([s])).row;
  assert.ok(row.aliases.includes('Alpha Lake')); assert.ok(row.aliases.includes('Native Name'));
  assert.equal(discoveryName('Main Trail (Cape Mountain Trail)'), 'Cape Mountain Trail');
});
test('agency inventory codes drop while proper names keep numeric refs as aliases', () => {
  for (const code of ['Fr 19W01', 'Fr 9N21', 'Fsr 8S42', 'Fr 4N40', 'Fr 9N01', 'Fsr 8S10']) assert.equal(discoveryName(code), null, code);
  for (const code of ['Nfst-2715951', 'Nfst-4700550 Trail #T4700550', 'Nfs 9725630', 'National Forest Development 9724-475', 'Blm 14-8-3', 'Nfs Route 068', 'Frd 340', 'Idl 3100-5', 'F R 166D', 'Nat For Service2232-433', 'Fsd 2611', 'Traill 099', '14 Trail Head', 'National Forest Development Trail 16', 'Atv Tr 1550', 'Way 91']) assert.equal(discoveryName(code), null, code);
  assert.equal(discoveryName('Smith Ridge Trail #T700'), 'Smith Ridge Trail');
  assert.equal(discoveryName('Smith Ridge Trail 2w07'), 'Smith Ridge Trail');
  assert.equal(discoveryName('Smith Ridge Trail Number 04W30'), 'Smith Ridge Trail');
  assert.equal(discoveryName('Corral Creek - hat Creek'), 'Corral Creek - Hat Creek');
  const s = segment('trail', ['a', 'b'], [xy(0), xy(2500)], 'Smith Ridge Trail #T-43108');
  const row = composeDiscovery(candidate([s], { name: 'Smith Ridge Trail', preferredNames: ['Smith Ridge Trail'] }), 0, 'ID', byId([s])).row;
  assert.equal(row.status, 'ok'); assert.ok(row.aliases.includes('Smith Ridge Trail #T-43108'));
});
test('display finalization preserves hyphen initials and far-trailhead objective aliases', () => {
  assert.equal(routeTitle('A-H Creek'), 'A-H Creek'); assert.equal(displayName('BLUE-RED TRAIL'), 'Blue-Red Trail');
  const s = segment('trail', ['a', 'b'], [xy(0), xy(2500)]), end = { ...feature('node/2', 'Pine Creek Trailhead', 'trailhead', xy(2500)), aliases: ['Windy Saddle Trailhead'] };
  const row = composeDiscovery(candidate([s], { shape: 'point_to_point', endTrailhead: end }), 0, 'WA', byId([s])).row;
  assert.equal(row.objective!.new!.name, 'Pine Creek Trailhead'); assert.ok(row.aliases.includes('Windy Saddle Trailhead'));
});
test('a review-only sibling does not add from to the sole loadable approach', () => {
  const a = segment('north', ['a', 'b'], [xy(0), xy(1000)]), b = segment('south', ['c', 'd'], [xy(0, 1000), xy(1000, 1000)]), sources = byId([a, b]), deduper = new DiscoveryDeduper(sources);
  const north = summary(0, [step(a)], sources, { trail: 'alpha', trailheadLabel: 'North Trailhead', loadable: true });
  const south = summary(1, [step(b)], sources, { trail: 'alpha', trailheadLabel: 'South Trailhead', start: xy(0, 1000), trailhead: 'node/3', loadable: false });
  deduper.consider(north); deduper.consider(south); assert.equal(deduper.finalNames().get(0), north.name);
});
test('shared source cuts materialize once and preserve forward and reverse partial walks', () => {
  const s = segment('long', ['a', 'b', 'c', 'd'], [xy(0), xy(1000), xy(2000), xy(3000)]), sources = byId([s]), pieces = new DiscoveryPieces();
  pieces.add([step(s)]); pieces.add([step(s, 1, 3)]); pieces.add([step(s, 3, 1)]); pieces.build(sources, 'ID');
  assert.equal(pieces.segments.size, 2); const full = pieces.materialize([step(s)]), part = pieces.materialize([step(s, 1, 3)]), reverse = pieces.materialize([step(s, 3, 1)]);
  assert.equal(full.length, 2); assert.equal(part.length, 1); assert.equal(reverse.length, 1); assert.equal(part[0].id, reverse[0].id); assert.notEqual(part[0].direction, reverse[0].direction);
  assert.ok([...pieces.segments.values()].every(p => p.state_code === 'ID')); assert.equal([...pieces.segments.values()].reduce((n, p) => n + p.length_m, 0), s.length_m);
});
function finalizedDraft(state: 'WA' | 'OR' | 'ID' | 'CA' = 'OR', objectiveKind: NamedFeature['feature'] = 'lake'): { draft: DraftRoute; sources: Map<string, Segment> } {
  const s = segment('long', ['a', 'b', 'c'], [xy(0), xy(1000), xy(2500)]), sources = byId([s]);
  const draft = composeDiscovery(candidate([s], { source: 'objective', objective: feature('node/2', 'Alpha Lake', objectiveKind, xy(2500)) }), 0, state, sources), pieces = new DiscoveryPieces();
  pieces.add(draft.walk); pieces.build(sources, state); draft.row.segments = pieces.materialize(draft.walk); finalizeRows([draft.row], [...pieces.segments.values()]);
  return { draft, sources: pieces.segments };
}
test('discovered routes retain the loader schema, stable composition hash and state values', () => {
  for (const state of ['WA', 'OR', 'ID', 'CA'] as const) {
    const { draft, sources } = finalizedDraft(state); assert.equal(draft.row.status, 'ok'); assert.equal(compositionValid(draft.row), true);
    const plan = planRoute(draft.row, sources); assert.equal(plan.skipped, undefined); assert.ok(plan.statements.length > 0); assert.equal(plan.activate, false);
    assert.equal(plan.statements.find(s => s.kind === 'route_insert')!.values[9], state); assert.equal(plan.statements.find(s => s.kind === 'segment_insert')!.values[10], state);
    assert.ok(plan.statements.filter(s => s.kind === 'destination_insert').every(s => s.values[10] === state)); assert.ok(!JSON.stringify(plan).includes('alltrails'));
    assert.ok(Math.abs(routeDistance(draft.row) - draft.row.length_m * 2) < .01);
    assert.equal(discoverySummary(draft).objective, 'node/2');
  }
});
test('only ok discovered rows are loadable even when includeReview is requested', () => {
  const { draft, sources } = finalizedDraft(); draft.row.status = 'review'; finalizeRows([draft.row], [...sources.values()]);
  assert.match(planRoute(draft.row, sources, { includeReview: true }).skipped!, /composition status review/);
  draft.row.status = 'failed'; finalizeRows([draft.row], [...sources.values()]); assert.match(planRoute(draft.row, sources, { includeReview: true }).skipped!, /composition status failed/);
});
test('OSM pass and saddle discoveries use the loader contact rule without a database', () => {
  for (const kind of ['pass', 'saddle'] as const) { const { draft, sources } = finalizedDraft('OR', kind); assert.equal(planRoute(draft.row, sources).skipped, undefined); }
});


test('same objective approaches use safe trailheads even across more than five kilometres', () => {
  const a = segment('west', ['a', 'b'], [xy(0), xy(1000)]), b = segment('east', ['c', 'd'], [xy(10000), xy(11000)]), sources = byId([a, b]);
  const deduper = new DiscoveryDeduper(sources);
  deduper.consider(summary(0, [step(a)], sources, { trail: 'alpha', trailheadLabel: 'West Trailhead', loadable: true }));
  deduper.consider(summary(1, [step(b)], sources, { trail: 'alpha', trailheadLabel: 'East Trailhead', trailhead: 'node/3', start: xy(10000), loadable: true }));
  const names = deduper.finalNames();
  assert.equal(names.get(0), 'Alpha Peak via Alpha Trail from West Trailhead');
  assert.equal(names.get(1), 'Alpha Peak via Alpha Trail from East Trailhead');
  assert.equal(deduper.kept.size, 2);
});

test('long trail sections use meaningful named endpoints without source codes', () => {
  const a = segment('north', ['a', 'b'], [xy(0), xy(1000)]), b = segment('south', ['c', 'd'], [xy(10000), xy(11000)]), sources = byId([a, b]);
  const deduper = new DiscoveryDeduper(sources);
  deduper.consider(summary(0, [step(a)], sources, { name: 'Timber Trail', objective: 'node/20', section: true, trailheadLabel: 'Gilchrist', endLabel: 'Chemult', loadable: true }));
  deduper.consider(summary(1, [step(b)], sources, { name: 'Timber Trail', objective: 'node/30', section: true, trailheadLabel: 'Chemult', endLabel: 'Crescent', trailhead: 'node/3', start: xy(10000), loadable: true }));
  const names = deduper.finalNames();
  assert.equal(names.get(0), 'Timber Trail: Gilchrist to Chemult');
  assert.equal(names.get(1), 'Timber Trail: Chemult to Crescent');
  assert.equal(deduper.kept.size, 2);
});

test('unresolved state-wide display collisions retain only the best ok route', () => {
  const a = segment('near', ['a', 'b'], [xy(0), xy(1000)]), b = segment('far', ['c', 'd'], [xy(10000), xy(11000)]), sources = byId([a, b]);
  const deduper = new DiscoveryDeduper(sources);
  deduper.consider(summary(0, [step(a)], sources, { name: 'Timber Trail', objective: 'node/20', loadable: true, quality: 100 }));
  deduper.consider(summary(1, [step(b)], sources, { name: 'Timber Trail', objective: 'node/30', trailhead: 'node/3', start: xy(10000), loadable: true, quality: 110 }));
  assert.equal(deduper.kept.size, 2);
  const names = deduper.finalNames(); assert.deepEqual([...deduper.kept.keys()], [1]); assert.equal(names.get(1), 'Timber Trail');
  assert.equal(deduper.counts.name_collision_suppressed, 1);
});

test('final names cannot collide with a pre-existing disambiguated display title', () => {
  const a = segment('west', ['a', 'b'], [xy(0), xy(1000)]), b = segment('east', ['c', 'd'], [xy(10000), xy(11000)]), c = segment('other', ['e', 'f'], [xy(20000), xy(21000)]), sources = byId([a, b, c]);
  const deduper = new DiscoveryDeduper(sources);
  deduper.consider(summary(0, [step(a)], sources, { trail: 'alpha', trailheadLabel: 'West Trailhead', loadable: true, quality: 100 }));
  deduper.consider(summary(1, [step(b)], sources, { trail: 'alpha', trailheadLabel: 'East Trailhead', trailhead: 'node/3', start: xy(10000), loadable: true, quality: 100 }));
  deduper.consider(summary(2, [step(c)], sources, { name: 'Alpha Peak via Alpha Trail from West Trailhead', objective: 'node/20', start: xy(20000), loadable: true, quality: 110 }));
  const names = deduper.finalNames(); assert.equal(deduper.kept.size, 2); assert.equal(new Set(names.values()).size, 2); assert.equal(deduper.kept.has(0), false);
});
