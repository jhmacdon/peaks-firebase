import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { agencyLine, conflate, matchedAgencies, unmatchedStretches, type AgencyLine } from '../trail-graph/agency';
import { attachFeatures, featureType, readFeatures } from '../trail-graph/features';
import { ndjson } from '../trail-graph/io';
import { haversine, length, lineIndex } from '../trail-graph/geo';
import { decodeOpl, keepWay, parseOpl, readOsm } from '../trail-graph/opl';
import { TrailRouter } from '../trail-graph/router';
import { buildTopology, graphNodes, provenance, prune, refresh, resolveIdCollisions } from '../trail-graph/topology';
import { segmentValues, UPSERT_SEGMENT, SEGMENT_CONFLICT } from '../trail-graph/load-segments';
import type { Coord, Segment, Tags, Way } from '../trail-graph/types';

const fixture = join(__dirname, 'fixtures/trail-graph.opl'), time = '2026-10-15T00:00:00Z';
function segment(id: number, nodes: string[], coords: Coord[], name = 'Main', kind: Segment['kind'] = 'trail'): Segment {
  return refresh({ id: '', name, trail_names: [name], kind, sac_scale: null, trail_visibility: null, osm_way_ids: [id], osm_edge_way_ids: coords.slice(1).map(() => id), relation_names: [], relations: [], start_node: '', end_node: '', coords, node_ids: nodes, length_m: 0, provenance: provenance([id], time), alt_sources: [] });
}
test('parallel arcs with the same endpoints and way IDs get stable distinct IDs', () => {
  const a = segment(1, ['a', 'b'], [[-121, 47], [-120.99, 47]]), b = segment(1, ['a', 'x', 'b'], [[-121, 47], [-121, 47.001], [-120.99, 47]]);
  assert.equal(a.id, b.id); assert.equal(resolveIdCollisions([a, b]).collisions, 1); assert.notEqual(a.id, b.id);
});
test('OPL escapes decode code points after tag/member delimiters split', () => {
  assert.equal(decodeOpl('A%20%B%2c%C%3d%D%25%%1f3d4%'), 'A B,C=D%🏔');
  const r = parseOpl('r99 v1 Tname=A%2c%B,ref=x%3d%y Mw123@a%2c%b,r2@');
  assert.equal(r.tags.name, 'A,B'); assert.equal(r.tags.ref, 'x=y'); assert.deepEqual(r.members, [{ type: 'w', id: 123, role: 'a,b' }, { type: 'r', id: 2, role: '' }]);
  assert.deepEqual(parseOpl('n1 Tname=Peak x-121.2 y47.5').coord, [-121.2, 47.5]);
});
test('OSM pedestrian filters enforce access and footway/track exceptions', () => {
  assert.equal(keepWay({ highway: 'path' }, false), true);
  assert.equal(keepWay({ highway: 'path', access: 'private' }, true), false);
  assert.equal(keepWay({ highway: 'footway', name: 'A', footway: 'crossing' }, true), false);
  assert.equal(keepWay({ highway: 'footway', trail_visibility: 'bad' }, false), true);
  assert.equal(keepWay({ highway: 'track', trail_visibility: 'good' }, false), false);
  assert.equal(keepWay({ highway: 'track' }, true), true);
});
test('streaming passes keep relation metadata and join matching degree-2 ways', async () => {
  const osm = await readOsm(fixture); assert.equal(osm.ways.length, 4); assert.equal(osm.nodes.size, 6);
  assert.deepEqual(osm.ways[0].relations, [{ id: 20, name: 'River Loop', ref: 'R', network: 'lwn', route: 'hiking', tags: { type: 'route', route: 'hiking', name: 'River Loop', ref: 'R', network: 'lwn' } }]);
  const graph = buildTopology(osm.ways, osm.nodes, [], time);
  assert.equal(graph.length, 4); // 1->2; 2->3->4; branch; unnamed relation footway.
  const joined = graph.find(s => s.osm_way_ids.length === 2)!;
  assert.deepEqual(joined.osm_way_ids, [10, 11]); assert.deepEqual(joined.node_ids, ['2', '3', '4']);
  assert.deepEqual(joined.osm_edge_way_ids, [10, 11]);
  assert.equal(graphNodes(graph).find(n => n.id === '2')!.degree, 3);
});
test('identity, relation and kind changes stop degree-2 joining; reversed ways have stable IDs', () => {
  const nodes = new Map<number, Coord>([[1, [-121, 47]], [2, [-120.99, 47]], [3, [-120.98, 47]]]);
  const ways: Way[] = [{ id: 1, nodes: [1, 2], tags: { highway: 'path', name: 'A' }, relations: [] }, { id: 2, nodes: [2, 3], tags: { highway: 'path', name: 'A' }, relations: [] }];
  const one = buildTopology(ways, nodes, [], time); assert.equal(one.length, 1);
  assert.equal(buildTopology(ways.map(w => ({ ...w, nodes: [...w.nodes].reverse() })).reverse(), nodes, [], time)[0].id, one[0].id);
  for (const change of [{ name: 'B' }, { ref: '2' }, { sac_scale: 'demanding_mountain_hiking' }] as Tags[]) {
    assert.equal(buildTopology([ways[0], { ...ways[1], tags: { ...ways[1].tags, ...change } }], nodes, [], time).length, 2);
  }
  assert.equal(buildTopology([ways[0], { ...ways[1], relations: [{ id: 9, name: 'Route' }] }], nodes, [], time).length, 2);
});
test('glacier polygons, including holes, split kind at source vertices', () => {
  const nodes = new Map<number, Coord>([[1, [-121.02, 47]], [2, [-121.01, 47]], [3, [-121, 47]], [4, [-120.99, 47]]]);
  const way: Way = { id: 1, nodes: [1, 2, 3, 4], tags: { highway: 'path', name: 'Climb', sac_scale: 'alpine_hiking' }, relations: [] };
  const graph = buildTopology([way], nodes, [{ name: 'Muir Snowfield', polygons: [[[[-121.011, 46.99], [-120.999, 46.99], [-120.999, 47.01], [-121.011, 47.01], [-121.011, 46.99]]]] }], time);
  assert.deepEqual(graph.map(s => s.kind), ['climb', 'snowfield', 'climb']);
  const holes = buildTopology([way], nodes, [{ name: 'Ice', polygons: [[[[-121.011, 46.99], [-120.999, 46.99], [-120.999, 47.01], [-121.011, 47.01], [-121.011, 46.99]], [[-121.009, 46.999], [-121.001, 46.999], [-121.001, 47.001], [-121.009, 47.001], [-121.009, 46.999]]]] }], time);
  assert.deepEqual(holes.map(s => s.kind), ['climb']);
});
test('feature sequence deduplicates areas, keeps unnamed glacier footprints and snaps points/shore', async () => {
  const source = await readFeatures(join(__dirname, 'fixtures/trail-graph-features.geojsonseq'));
  assert.equal(source.records.length, 2); assert.equal(source.glaciers.length, 1);
  const s = segment(1, ['a', 'b'], [[-121, 47], [-120.99, 47]]), features = attachFeatures(source.records, [s]);
  assert.equal(features[0].graph_node, 'a'); assert.ok(Math.abs(features[0].ele! - 2072.64) < 0.01);
  assert.equal(features[1].location_method, 'boundary_nearest_graph'); assert.equal(features[1].graph_distance_m, 0);
});
test('missing NDJSON input reports an error', async () => {
  await assert.rejects(async () => { for await (const _ of ndjson(join(__dirname, 'fixtures/missing-trail-graph-file'))) {} }, /ENOENT/);
});
test('typed OSM IDs preserve relation polygons and do not collide with way/node IDs', async () => {
  const source = await readFeatures(join(__dirname, 'fixtures/trail-graph-typed.geojsonseq'));
  assert.deepEqual(source.records.map(r => r.feature.osm_id), ['node/123', 'way/123', 'relation/123']);
  assert.equal(source.records[2].feature.boundary!.coordinates[0][0].length, 4);
  assert.equal(source.records.length, 3);
});
test('prune drops short and unnamed components and retains named >=500 m', () => {
  const a = segment(1, ['a', 'b'], [[-121, 47], [-120.99, 47]]), b = segment(2, ['c', 'd'], [[-122, 47], [-121.999, 47]]);
  const c = segment(3, ['e', 'f'], [[-123, 47], [-122.99, 47]]); c.trail_names = []; c.name = null;
  const p = prune([a, b, c]); assert.equal(p.segments.length, 1); assert.equal(p.dropped.components, 2); assert.equal(p.dropped.unnamed_components, 1);
});
function agency(coords: Coord[], name = 'Official'): AgencyLine { return { coords, source: 'usfs', id: '7', name, number: '1599', names: [`${name} Trail #1599`], group: name, retrieved_at: time }; }
test('conflation measures length at 15 m/80%, rather than endpoint or vertex counts', () => {
  const coords: Coord[] = [[-121, 47], [-120.99, 47]], a = agency([[-121, 47.00005], [-120.991, 47.00005]]);
  assert.equal(matchedAgencies(coords, [a], lineIndex([a])).length, 1);
  const short = agency([[-121, 47], [-120.996, 47]]); assert.equal(matchedAgencies(coords, [short], lineIndex([short])).length, 0);
  const far = agency([[-121, 47.0003], [-120.99, 47.0003]]); assert.equal(matchedAgencies(coords, [far], lineIndex([far])).length, 0);
  const around = agency([[-121, 47], [-121, 47.01], [-120.99, 47.01], [-120.99, 47]]);
  assert.equal(matchedAgencies(coords, [around], lineIndex([around])).length, 0);
});
test('agency normalizer reads trail_no, credits names, and excludes snow-only lines', () => {
  const f = { type: 'Feature', id: 7, properties: { trail_name: 'Stuart Lake', trail_no: '1599', trail_type: 'TERRA' }, geometry: { type: 'LineString', coordinates: [[-121, 47], [-120.99, 47]] } };
  assert.equal(agencyLine(f, 'usfs', time)[0].names.includes('Stuart Lake Trail #1599'), true);
  f.properties.trail_type = 'SNOW'; assert.equal(agencyLine(f, 'usfs', time).length, 0);
});
test('unmatched agency stretches >=1 km are retained and node at nearby interior OSM vertices', () => {
  const s = segment(1, ['a', 'b', 'c'], [[-121.01, 47], [-121, 47], [-120.99, 47]]);
  const a = agency([[-121, 47.0002], [-121, 47.02]]); // 22 m seam: beyond matching radius, inside the 30 m node tolerance.
  const result = conflate([s], [a]); assert.equal(result.stats.agency_only_segments, 1); assert.equal(result.stats.osm_splits, 1);
  assert.equal(graphNodes(result.segments).find(n => n.id === 'b')!.degree, 3);
  assert.equal(unmatchedStretches(s.coords, lineIndex([s])).length, 0);
  assert.equal(unmatchedStretches([[-122, 47], [-122, 47.0089]], lineIndex([])).length, 0);
});
test('router snaps interior vertices, honors via, preferences, avoidance and directions', () => {
  const a: Coord = [-121, 47], b: Coord = [-120.99, 47], c: Coord = [-120.98, 47], d: Coord = [-120.99, 47.005];
  const main = segment(1, ['a', 'b', 'c'], [a, b, c], 'Main'), branch = segment(2, ['c', 'd'], [c, d], 'Scenic');
  const router = new TrailRouter([main, branch]);
  const partial = router.route(b, c); assert.equal(partial.segments.length, 1); assert.ok(Math.abs(partial.total_length_m - haversine(b, c)) < 0.01);
  assert.equal(router.route(c, a).segments[0].direction, 'reverse');
  assert.equal(router.route(a, c, { via: [d] }).segments.length, 3);
  assert.throws(() => router.route(a, [-125, 48]), /150 m/);
  assert.throws(() => router.route(a, d, { avoidKinds: ['trail'] }), /Disconnected/);
  const road = segment(3, ['a', 'c'], [a, c], 'Shortcut', 'road');
  const alternative = segment(4, ['a', 'd', 'c'], [a, d, c], 'Scenic');
  const choices = new TrailRouter([road, alternative]);
  assert.equal(choices.route(a, c).segments[0].segment_id, alternative.id);
  road.kind = 'trail';
  assert.equal(choices.route(a, c, { preferNames: ['Scenic'] }).segments[0].segment_id, alternative.id);
});
test('router reports only named features within 30 metres in walk order', () => {
  const s = segment(1, ['a', 'b'], [[-121, 47], [-120.99, 47]]);
  const feature = (name: string, lon: number, lat: number) => ({ osm_id: `node/${name}`, name, feature: 'viewpoint' as const, lon, lat, graph_node: null, graph_distance_m: null, location_method: 'osm_point' as const });
  const router = new TrailRouter([s], [feature('near', -120.995, 47.0001), feature('far', -120.995, 47.001)]);
  assert.deepEqual(router.route(s.coords[0], s.coords[1]).features.map(f => f.name), ['near']);
  const littleLake = { ...feature('Little Colchuck Lake', -121, 47), feature: 'lake' as const };
  assert.throws(() => new TrailRouter([s], [littleLake]).resolve('Colchuck Lake'), /not found/);
});
test('loader dry-run values are LineStringZ, with the exact immutable review states in SQL', () => {
  const s = segment(1, ['a', 'b'], [[-121, 47], [-120.99, 47]]);
  assert.deepEqual(JSON.parse(segmentValues(s)[4] as string).coordinates[0], [-121, 47, 0]);
  for (const state of ['approved', 'publish_leased', 'published', 'verify_leased', 'verified', 'rejected']) assert.ok(SEGMENT_CONFLICT.includes(`'${state}'`));
  assert.equal(Object.keys(s.provenance).length, 9); assert.equal(s.provenance.attribution, '© OpenStreetMap contributors');
  assert.equal(provenance([], time, 'nps', '7').license_name, 'Public domain');
  assert.equal(featureType({ natural: 'saddle', mountain_pass: 'yes' }), 'pass');
});
