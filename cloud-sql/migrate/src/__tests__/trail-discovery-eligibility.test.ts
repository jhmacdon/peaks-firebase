import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../trail-graph/discovery';
import { eligibleDiscoverySegment, isHighwayPathName, isMotorizedName, isUtilityObjective, loadExcludedDiscoverySegments, motorizedTags, npsMotorizedDesignation, usfsMotorizedDesignation } from '../trail-graph/discovery-eligibility';
import { haversine, length } from '../trail-graph/geo';
import { provenance } from '../trail-graph/topology';
import type { AccessPoint } from '../trail-graph/catalog-types';
import type { Coord, NamedFeature, Relation, Segment, Tags } from '../trail-graph/types';

const a: Coord = [-121, 47], b: Coord = [-121, 47.025];
const relation: Relation = { id: 1, name: 'Alpha Trail', route: 'hiking' };
function segment(name = 'Alpha Trail', relations: Relation[] = []): Segment {
  return { id: 'ab', name, trail_names: [name], kind: 'trail', sac_scale: null, trail_visibility: null, osm_way_ids: [10], relation_names: relations.map(value => value.name!), relations,
    start_node: 'a', end_node: 'b', coords: [a, b], node_ids: ['a', 'b'], osm_edge_way_ids: [10], length_m: length([a, b]), provenance: provenance([10], '2026-10-17T00:00:00Z'), alt_sources: [] };
}
function feature(id: string, name: string, kind: NamedFeature['feature'], point: Coord): NamedFeature {
  return { osm_id: id, name, feature: kind, lon: point[0], lat: point[1], graph_node: null, graph_distance_m: null, location_method: 'osm_point' };
}
function parking(id: string, point: Coord): AccessPoint { return { osm_id: id, coord: point, parking: true, name: 'Alpha Parking' }; }

test('natural objectives sharing an access OSM ID become destination hikes rather than traverses', () => {
  for (const kind of ['summit', 'saddle', 'pass'] as const) {
    const objective = feature('node/2', `Alpha ${kind}`, kind, b);
    const routes = [...discover({ segments: [segment('Alpha Trail', [relation])], features: [objective], access: [parking('node/1', a), parking('node/2', b)] })];
    const route = routes.find(value => value.source === 'relation')!;
    assert.ok(route); assert.equal(route.objective, objective); assert.equal(route.shape, 'out_and_back'); assert.equal(route.endTrailhead, undefined);
  }
});

test('relations need a distinct real parking or mapped trailhead for a traverse end', () => {
  const roadContact: AccessPoint = { osm_id: 'way/2', name: 'Alpha Road', coord: b, parking: false };
  const input = { segments: [segment('Alpha Trail', [relation])], features: [], access: [parking('node/1', a), roadContact] };
  let route = [...discover(input)].find(value => value.source === 'relation')!;
  assert.equal(route.shape, 'out_and_back'); assert.equal(route.endTrailhead, undefined);
  input.access[1] = parking('way/2', b);
  route = [...discover(input)].find(value => value.source === 'relation')!;
  assert.equal(route.shape, 'point_to_point'); assert.equal(route.endTrailhead?.osm_id, 'way/2');
});

test('motor recreation names and positive designations exclude graph edges from every discovery path', () => {
  for (const name of ['Crane Mountain Motorized Trail', 'Round Top Motorcycle', 'Norris Draw Ohv', 'Alpha ATV Trail', 'Alpha Off-Highway Trail', 'Whites Ridge 4×4 Trail', 'Whites Ridge 4x4 Trail', 'Alpha 4WD Trail', 'Alpha Four-Wheel-Drive Trail']) {
    assert.equal(isMotorizedName(name), true); assert.equal(eligibleDiscoverySegment(segment(name)), false);
    assert.deepEqual([...discover({ segments: [segment(name, [relation])], features: [feature('node/1', 'Alpha Trailhead', 'trailhead', a), feature('node/2', 'Alpha Lake', 'lake', b)], access: [parking('way/3', a)] })], []);
  }
  for (const tags of [{ motorcycle: 'designated' }, { ohv: 'yes' }, { atv: 'permissive' }, { designation: 'motorized' }, { motor_vehicle: 'designated' }] as Tags[]) {
    assert.equal(motorizedTags(tags), true);
    const source = segment(); source.alt_sources.push({ source: 'usfs', id: '1', name: 'Alpha Trail', number: '1', tags });
    assert.equal(eligibleDiscoverySegment(source), false);
  }
  for (const tags of [{ motorcycle: 'no' }, { atv: 'private' }, { ohv: 'unknown' }, { motor_vehicle: 'yes' }, { bicycle: 'designated' }] as Tags[]) assert.equal(motorizedTags(tags), false);
});

test('a 4×4 vehicle track does not exclude its separate adjacent hiking path', () => {
  const track = segment('Whites Ridge 4×4 Trail'), path = { ...segment('Whites Ridge Trail'), id: 'hiking' };
  const objective = feature('node/2', 'Alpha Lake', 'lake', b);
  const routes = [...discover({ segments: [track, path], features: [feature('node/1', 'Alpha Trailhead', 'trailhead', a), objective], access: [] })].filter(route => route.source === 'objective');
  assert.equal(routes.length, 1); assert.equal(routes[0].walk[0].segment_id, 'hiking');
  assert.equal(isMotorizedName('Non-Motorized Trail'), false); assert.equal(isMotorizedName('Four Mile Trail'), false);
});

test('highway corridor paths are excluded while ordinary local multi-use trails remain', () => {
  for (const name of ['I-205 Multi-Use Path', 'Interstate 80 Trail', 'US 101 Bike Path', 'SR 20 Greenway']) {
    assert.equal(isHighwayPathName(name), true); assert.equal(eligibleDiscoverySegment(segment(name)), false);
  }
  for (const name of ['River Multi-Use Path', 'Lake 22 Trail', 'Interlaken Trail']) assert.equal(eligibleDiscoverySegment(segment(name)), true);
});

test('utility water objectives are omitted without dropping natural ponds and reservoirs', () => {
  const start = feature('node/1', 'Alpha Trailhead', 'trailhead', a);
  for (const name of ['Rancho San Antonio County Park Detention Basin', 'Alpha Retention Pond', 'Alpha Stormwater Pond', 'Alpha Flood Control Basin']) {
    const objective = feature('way/2', name, 'lake', b); assert.equal(isUtilityObjective(objective), true);
    assert.equal([...discover({ segments: [segment()], features: [start, objective], access: [] })].filter(value => value.source === 'objective').length, 0);
  }
  for (const tags of [{ water: 'basin' }, { basin: 'detention' }, { man_made: 'wastewater_basin' }] as Tags[]) assert.equal(isUtilityObjective({ ...feature('way/2', 'Alpha Water', 'lake', b), tags }), true);
  for (const tags of [{ water: 'lake' }, { water: 'pond' }, { water: 'reservoir' }, {}] as Tags[]) assert.equal(isUtilityObjective({ ...feature('way/2', 'Alpha Reservoir', 'lake', b), tags }), false);
});

test('streamed source designations block segment IDs even when graph rows omit OSM tags', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'discovery-access-'));
  try {
    await mkdir(join(directory, 'extract'));
    await writeFile(join(directory, 'extract', 'trails.opl'), ['w10 Tname=Alpha%20%Trail,highway=path,motorcycle=designated Nn1,n2', 'w20 Tname=Beta%20%Trail,highway=path,motorcycle=no Nn3,n4', 'w30 Tname=River%20%Path,highway=cycleway,ref=I-205 Nn5,n6'].join('\n'));
    const one = segment(), two = { ...segment(), id: 'cd', osm_way_ids: [20] }, three = { ...segment(), id: 'ef', osm_way_ids: [30] };
    const blocked = await loadExcludedDiscoverySegments(directory, [one, two, three]);
    assert.deepEqual([...blocked].sort(), ['ab', 'ef']);
    const routes = [...discover({ segments: [one], features: [feature('node/1', 'Alpha Trailhead', 'trailhead', a), feature('node/2', 'Alpha Lake', 'lake', b)], access: [] }, () => {}, { excludedSegmentIds: blocked })];
    assert.deepEqual(routes, []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('raw USFS motor designations match agency IDs while restrictions and unknown use stay eligible', async () => {
  for (const properties of [{ terra_motorized: 'Y' }, { terra_motorized: true }, { motorcycle_managed: '01/01-12/31' }, { atv_managed: '07/01-10/11,10/22-11/30' }]) assert.equal(usfsMotorizedDesignation(properties), true);
  for (const properties of [{ terra_motorized: 'N' }, { terra_motorized: 'N/A' }, { motorcycle_managed: 'NOT_MANAGED' }, { motorcycle_managed: 'N/A' }, { atv_managed: 'NO' }, { motorcycle_restricted: '01/01-12/31' }, { snow_motorized: 'Y' }]) assert.equal(usfsMotorizedDesignation(properties), false);
  const directory = await mkdtemp(join(tmpdir(), 'discovery-agency-'));
  try {
    await mkdir(join(directory, 'raw', 'agency'), { recursive: true });
    const source = (id: number, properties: Record<string, unknown>) => ({ type: 'Feature', id, properties, geometry: { type: 'LineString', coordinates: [a, b] } });
    await writeFile(join(directory, 'raw', 'agency', 'usfs_trails.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [source(10, { terra_motorized: 'Y' }), source(20, { motorcycle_restricted: '01/01-12/31' }), source(30, { atv_managed: '05/01-10/31' })] }));
    const sources = [10, 20, 30].map(id => ({ ...segment(), id: `agency-${id}`, alt_sources: [{ source: 'usfs', id: String(id), name: 'Alpha Trail', number: String(id) }] }));
    const otherAgency = { ...sources[0], id: 'nps-10', alt_sources: [{ ...sources[0].alt_sources[0], source: 'nps' }] };
    assert.deepEqual([...(await loadExcludedDiscoverySegments(directory, [...sources, otherAgency]))].sort(), ['agency-10', 'agency-30']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('raw NPS motor uses exclude their own source IDs and preserve prohibited or accessible terrain labels', async () => {
  for (const TRLUSE of ['Hiker/Pedestrian | All-Terrain Vehicle', 'Hike | Motorcycle', 'Hike | Motorcycles', 'OHV | Hike']) assert.equal(npsMotorizedDesignation({ TRLUSE }), true);
  for (const TRLUSE of ['Hike | No Motorcycles', 'Hiker/Pedestrian | Motorized prohibited', 'Non-Motorized', 'All-Terrain Accessible Trail', 'Hike | ATV restricted', 'Hike | Bike']) assert.equal(npsMotorizedDesignation({ TRLUSE }), false);
  assert.equal(isMotorizedName('All-Terrain Vehicle Trail'), true); assert.equal(isMotorizedName('All-Terrain Accessible Trail'), false); assert.equal(isMotorizedName('Non-Motorized Trail'), false);
  const directory = await mkdtemp(join(tmpdir(), 'discovery-nps-'));
  try {
    await mkdir(join(directory, 'raw', 'agency'), { recursive: true });
    await writeFile(join(directory, 'raw', 'agency', 'nps_trails.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 22685, properties: { TRLUSE: 'Hiker/Pedestrian | All-Terrain Vehicle' }, geometry: { type: 'LineString', coordinates: [a, b] } }] }));
    const nps = { ...segment(), id: 'nps', alt_sources: [{ source: 'nps', id: '22685', name: 'Point Bennett Trail', number: null }] };
    const usfs = { ...nps, id: 'usfs', alt_sources: [{ ...nps.alt_sources[0], source: 'usfs' }] };
    assert.deepEqual([...(await loadExcludedDiscoverySegments(directory, [nps, usfs]))], ['nps']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('resolved Peaks summit coordinates choose graph contacts before routing without changing source features', () => {
  const start = feature('node/1', 'Alpha Trailhead', 'trailhead', a);
  const objective = feature('node/2', 'Alpha Mountain', 'summit', [b[0], b[1] + .002]);
  const input = { segments: [segment()], features: [start, objective], access: [] };
  assert.equal([...discover(input)].filter(value => value.source === 'objective').length, 0, 'the source summit is beyond the connector limit');
  const point: Coord = [b[0], b[1] + .0003], source = JSON.stringify(objective);
  const routes = [...discover(input, () => {}, { resolvedContacts: new Map([[objective.osm_id, { coord: point, summit: true }]]) })].filter(value => value.source === 'objective');
  assert.equal(routes.length, 1); assert.equal(routes[0].objective, objective); assert.equal(routes[0].walk.at(-1)?.end_vertex, 1);
  assert.equal(JSON.stringify(objective), source, 'snapshot attachment does not rewrite OSM labels, coordinates or credit');
  assert.equal([...discover(input, () => {}, { resolvedContacts: new Map([[objective.osm_id, { coord: [b[0], b[1] + .001], summit: true }]]) })].filter(value => value.source === 'objective').length, 0, 'resolved summits still require a contact within 75 metres');
});

test('resolved trailhead points override cached source contacts for features and parking', () => {
  const middle: Coord = [-121, 47.005], trail = segment(); trail.coords = [a, middle, b]; trail.node_ids = ['a', 'middle', 'b']; trail.osm_edge_way_ids = [10, 10];
  const start = { ...feature('node/1', 'Alpha Trailhead', 'trailhead', a), graph_node: 'a', graph_coord: a, graph_distance_m: 0 };
  const access = parking('way/3', a), objective = feature('node/2', 'Alpha Lake', 'lake', b);
  const routes = [...discover({ segments: [trail], features: [start, objective], access: [access] }, () => {}, { resolvedContacts: new Map([[start.osm_id, { coord: middle, summit: false }], [access.osm_id, { coord: middle, summit: false }]]) })].filter(value => value.source === 'objective');
  assert.equal(routes.length, 2);
  for (const route of routes) { assert.deepEqual(route.trailheadCoord, middle); assert.equal(route.walk[0].start_vertex, 1); }
  assert.deepEqual([start.lon, start.lat], a); assert.deepEqual(access.coord, a);
});

test('lookouts resolved to Peaks summits apply summit contact distance and connector budgets', () => {
  const objective = feature('node/2', 'Alpha Lookout', 'lookout', b), input = { segments: [segment()], features: [feature('node/1', 'Alpha Trailhead', 'trailhead', a), objective], access: [] };
  const near: Coord = [b[0], b[1] + .0006], far: Coord = [b[0], b[1] + .0008];
  assert.equal([...discover(input, () => {}, { resolvedContacts: new Map([[objective.osm_id, { coord: near, summit: true }]]) })].filter(value => value.source === 'objective').length, 1);
  assert.equal([...discover(input, () => {}, { resolvedContacts: new Map([[objective.osm_id, { coord: far, summit: true }]]) })].filter(value => value.source === 'objective').length, 0);
  const longEnd: Coord = [a[0], a[1] + 14980 / haversine(a, [a[0], a[1] + 1])], longTrail = segment(); longTrail.coords = [a, longEnd]; longTrail.length_m = length(longTrail.coords);
  const longObjective = feature('node/2', 'Alpha Lookout', 'lookout', longEnd), longInput = { ...input, segments: [longTrail], features: [input.features[0], longObjective] };
  assert.equal([...discover(longInput)].filter(value => value.source === 'objective').length, 1);
  assert.equal([...discover(longInput, () => {}, { resolvedContacts: new Map([[longObjective.osm_id, { coord: [longEnd[0], longEnd[1] + .0006], summit: true }]]) })].filter(value => value.source === 'objective').length, 0, 'the resolved summit connector counts toward the 15 kilometre limit');
});
