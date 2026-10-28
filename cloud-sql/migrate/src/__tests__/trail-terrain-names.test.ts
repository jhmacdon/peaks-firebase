import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTopology, joinDegreeTwo } from '../trail-graph/topology';
import { applyCuration, smoothNames } from '../trail-graph/stretches';
import { segmentValues } from '../trail-graph/load-segments';
import { segmentDisplayName } from '../trail-graph/segment-names';
import { validSource } from '../trail-graph/source-provenance';
import { conflate, type AgencyLine } from '../trail-graph/agency';
import type { ComposedRoute } from '../trail-graph/catalog-types';
import type { Coord, Glacier, Segment, Way } from '../trail-graph/types';

const time = '2026-10-28T00:00:00Z';
const nodes = new Map<number, Coord>([[1, [-121.02, 47]], [2, [-121.01, 47]], [3, [-121, 47]], [4, [-120.99, 47]]]);
const way: Way = { id: 1, nodes: [1, 2, 3, 4], tags: { highway: 'path', name: 'Three Fingers summit trail' }, relations: [] };
function glacier(name: string, west = -121.011, east = -120.999, id = 'way/7'): Glacier {
  return { name, osm_id: id, polygons: [[[[west, 46.99], [east, 46.99], [east, 47.01], [west, 47.01], [west, 46.99]]]] };
}
const refs = (segments: Segment[]) => segments.map(s => ({ id: s.id, direction: 'forward' as const }));

test('polygon name and identity survive topology, smoothing and segment loading', () => {
  const segments = buildTopology([way], nodes, [glacier('Test Glacier')], time);
  assert.deepEqual(segments.map(s => s.kind), ['trail', 'glacier', 'trail']);
  assert.deepEqual(segments[1].terrain, { kind: 'glacier', name: 'Test Glacier', osm_id: 'way/7' });
  assert.equal(validSource(segments[1].provenance), true, 'terrain metadata does not change the stored rights schema');
  segments[1].length_m = 60; // The screenshot has a 199 ft crossing.
  const names = smoothNames(refs(segments), new Map(segments.map(s => [s.id, s])));
  assert.deepEqual(names, ['Three Fingers summit trail', 'Test Glacier', 'Three Fingers summit trail']);
  assert.equal(segmentValues(segments[1])[7], 'Test Glacier');
  assert.deepEqual(segments[1].trail_names, ['Three Fingers summit trail']);
});

test('unnamed or legacy ice uses a crossing label, not the trail name', () => {
  const ice = buildTopology([way], nodes, [glacier('')], time)[1];
  assert.equal(segmentValues(ice)[7], 'Glacier Crossing');
  delete ice.terrain;
  assert.equal(segmentValues(ice)[7], 'Glacier Crossing');
  ice.kind = 'snowfield';
  assert.equal(segmentValues(ice)[7], 'Snowfield Crossing');
  ice.display_name = 'The Bowling Alley';
  assert.equal(segmentDisplayName(ice), 'The Bowling Alley', 'explicit reviewed names win');
});

test('adjacent glaciers keep separate names even when their terrain kind matches', () => {
  const left = glacier('West Glacier', -121.021, -121.0101, 'way/1');
  const right = glacier('East Glacier', -121.0099, -120.989, 'way/2');
  const segments = buildTopology([way], nodes, [left, right], time);
  assert.deepEqual(segments.map(segmentDisplayName), ['West Glacier', 'East Glacier']);
  assert.equal(joinDegreeTwo(segments).length, 2);
  segments[0].length_m = 20;
  assert.deepEqual(smoothNames(refs(segments), new Map(segments.map(s => [s.id, s]))), ['West Glacier', 'East Glacier']);
});

test('an unnamed member does not hide its named multipolygon; conflicting names stay unnamed', () => {
  const member = glacier('', -121.011, -120.999, 'way/7');
  const relation = glacier('Test Glacier', -121.011, -120.999, 'relation/8');
  for (const sources of [[member, relation], [relation, member]]) {
    const ice = buildTopology([way], nodes, sources, time)[1];
    assert.equal(segmentDisplayName(ice), 'Test Glacier');
    assert.equal(ice.terrain?.osm_id, 'relation/8');
  }
  const conflict = buildTopology([way], nodes, [relation, glacier('Other Glacier')], time)[1];
  assert.equal(segmentDisplayName(conflict), 'Glacier Crossing');
  assert.equal(conflict.terrain?.osm_id, undefined);
});

test('short named terrain between same-name trails is never smoothed away', () => {
  const segments = buildTopology([way], nodes, [glacier('Test Glacier')], time);
  segments[1].kind = 'scramble'; segments[1].trail_names = ['Summit ladders']; segments[1].length_m = 30;
  assert.deepEqual(smoothNames(refs(segments), new Map(segments.map(s => [s.id, s]))),
    ['Three Fingers summit trail', 'Summit ladders', 'Three Fingers summit trail']);
});

test('curation can keep a named feature within a glacier', () => {
  const segments = buildTopology([way], nodes, [glacier('Test Glacier')], time);
  const row = { name: 'Test route', seed_index: 0, segments: refs(segments), waypoints: [] } as unknown as ComposedRoute;
  applyCuration([row], segments, { routes: [{ route: row.name, stretches: [{ display_name: 'The Bowling Alley', kind: 'glacier', segments: [segments[1].id] }] }] }, [], []);
  assert.equal(segments.find(s => s.kind === 'glacier')!.display_name, 'The Bowling Alley');
});

test('agency-only crossings retain the polygon name too', () => {
  const a: AgencyLine = { coords: [[-121.015, 47], [-120.995, 47]], source: 'usfs', id: '5', name: 'Agency Trail',
    number: null, names: ['Agency Trail'], group: '5', retrieved_at: time };
  const segments = conflate([], [a], [glacier('Test Glacier')]).segments;
  assert.equal(segments.length, 1);
  assert.equal(segmentValues(segments[0])[7], 'Test Glacier');
});
