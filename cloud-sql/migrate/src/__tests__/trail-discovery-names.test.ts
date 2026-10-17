import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanDiscoveryName, isRoadName, usableTrailheadName, viaTrailName } from '../trail-graph/discovery-names';
import { discover, discoveryName } from '../trail-graph/discovery';
import { length } from '../trail-graph/geo';
import { provenance } from '../trail-graph/topology';
import type { NamedFeature, Segment } from '../trail-graph/types';

test('road words cannot hide before trail, viewpoint or connector suffixes', () => {
  for (const name of ['Old Road Trail', 'Cedar Lane Trail', 'Pebble-wood Rd Connector', 'Stunt Road Viewpoint', 'Bpa Road / Skyline Blvd', 'Forest Road 4103-087', 'United States Forest Service Road 5800-7', 'National Forest Development Road 056 Trail', 'NFR #12', 'FDR #610']) {
    assert.equal(isRoadName(name), true, name);
    assert.equal(cleanDiscoveryName(name).name, null, name);
  }
  for (const name of ['Roadrunner Trail', 'Broad Creek Trail', 'East Mountain Way', 'Woodland Trail', 'Mount St. Helens', 'St. Anthony Trail', 'Dr. Jekyll Trail']) {
    assert.equal(isRoadName(name), false, name);
    assert.equal(discoveryName(name), name, name);
  }
});

test('parenthetical trail aliases choose the fuller trail name within a route clause', () => {
  assert.deepEqual(cleanDiscoveryName('Wapati (Cape Mountain Trail)'), { name: 'Cape Mountain Trail', aliases: ['Wapati (Cape Mountain Trail)'], flags: [] });
  assert.equal(cleanDiscoveryName('Cape Mountain via Wapati (Cape Mountain Trail)', { kind: 'route' }).name, 'Cape Mountain via Cape Mountain Trail');
  assert.equal(cleanDiscoveryName('Toróma (Wildcat) Trail Loop').name, 'Toróma Trail Loop');
  assert.equal(cleanDiscoveryName('Boulder Mountain Spur (Nf-1045)').name, 'Boulder Mountain Spur');
});

test('seasonal qualifiers become flags while the source name remains an alias', () => {
  assert.deepEqual(cleanDiscoveryName('Shepherd Pond (seasonal)', { kind: 'objective' }), { name: 'Shepherd Pond', aliases: ['Shepherd Pond (seasonal)'], flags: ['seasonal'] });
});

test('trail numbers stay in aliases when a proper trail name exists', () => {
  assert.deepEqual(cleanDiscoveryName('Diamond Peak Trail #3699'), { name: 'Diamond Peak Trail', aliases: ['Diamond Peak Trail #3699'], flags: [] });
  assert.equal(cleanDiscoveryName('Black Trail #16407').name, 'Black Trail');
  assert.equal(cleanDiscoveryName('Black Trail #4948- 119').name, 'Black Trail');
});

test('only numbers, codes or generic words cannot name discovered hikes', () => {
  for (const name of ['Trail 024', 'Trail 097', 'Trail024', 'Trail #3699', 'Foot Trail', '(Off 257)', 'Trail', 'Unnamed Path', 'Main Trail', 'Trail 4110-118', 'Trail 1/2', 'CL8337', '32N01X', 'U1100', 'A-0100', '150', 'Viewpoint', 'Forest Trail 12']) assert.equal(discoveryName(name), null, name);
  for (const name of ['Summit Lake', 'North Lake', 'Black Trail', 'Half Mile / 1/2 Loop Trail']) assert.equal(discoveryName(name), name, name);
});

test('source placeholders disappear and hyphenated proper words keep title case', () => {
  assert.equal(discoveryName('Continental Divide National Scenic Trail xxx'), 'Continental Divide National Scenic Trail');
  assert.equal(discoveryName('Corral Creek-hat Creek'), 'Corral Creek-Hat Creek');
  assert.equal(discoveryName('CORRAL CREEK-HAT CREEK'), 'Corral Creek-Hat Creek');
});

test('via clauses keep a full generic word and append Trail if the source omits it', () => {
  assert.equal(viaTrailName('Divide'), 'Divide Trail');
  assert.equal(viaTrailName('Swampy Lakes'), 'Swampy Lakes Trail');
  assert.equal(viaTrailName('Diamond Peak Trail #3699'), 'Diamond Peak Trail');
  assert.equal(viaTrailName('River Path'), 'River Path');
  assert.equal(viaTrailName('Forest Road 12'), null);
});

test('only a mapped official trailhead can retain a road-containing trailhead name', () => {
  const official: NamedFeature = { osm_id: 'node/1', name: 'Mather Road Trailhead', feature: 'trailhead', lon: -121, lat: 47, graph_node: null, graph_distance_m: null, location_method: 'osm_point' };
  assert.equal(usableTrailheadName(official), 'Mather Road Trailhead');
  assert.equal(usableTrailheadName({ ...official, osm_id: 'graph/contact' }), null);
  assert.equal(usableTrailheadName({ osm_id: 'way/2', name: 'Mather Road', coord: [-121, 47], parking: true }), null);
  for (const name of ['P5', 'Lot 7', 'Parking Lot A12', 'Horsetail Falls Parkin…', 'Horsetail Falls Parkin...']) assert.equal(usableTrailheadName({ osm_id: 'way/2', name, coord: [-121, 47], parking: true }), null, name);
  assert.equal(usableTrailheadName({ osm_id: 'way/2', name: 'Horsetail Falls Parking', coord: [-121, 47], parking: true }), 'Horsetail Falls Parking');
});

test('discovery rejects road viewpoints and preserves full trail names at source', () => {
  const a: [number, number] = [-121, 47], b: [number, number] = [-121, 47.025];
  const segment: Segment = { id: 'trail', name: 'Divide', trail_names: ['Divide'], kind: 'trail', sac_scale: null, trail_visibility: null, osm_way_ids: [1], relation_names: [], relations: [], start_node: 'a', end_node: 'b', coords: [a, b], node_ids: ['a', 'b'], osm_edge_way_ids: [1], length_m: length([a, b]), provenance: provenance([1], '2026-10-17T00:00:00Z'), alt_sources: [] };
  const start: NamedFeature = { osm_id: 'node/1', name: 'Divide Trailhead', feature: 'trailhead', lon: a[0], lat: a[1], graph_node: null, graph_distance_m: null, location_method: 'osm_point' };
  const road: NamedFeature = { osm_id: 'node/2', name: 'Stunt Road Viewpoint', feature: 'viewpoint', lon: b[0], lat: b[1], graph_node: null, graph_distance_m: null, location_method: 'osm_point' };
  const lake: NamedFeature = { osm_id: 'node/3', name: 'Shepherd Pond (seasonal)', feature: 'lake', lon: b[0], lat: b[1], graph_node: null, graph_distance_m: null, location_method: 'osm_point' };
  const routes = [...discover({ segments: [segment], features: [start, road, lake], access: [] })].filter(candidate => candidate.source === 'objective');
  assert.equal(routes.length, 1);
  assert.equal(routes[0].name, 'Shepherd Pond via Divide Trail');
  assert.equal(routes[0].objective!.name, lake.name, 'raw qualifier remains available to the catalog flag writer');
});


test('short inventory identities drop without a list of local trail codes', () => {
  for (const name of ['Vetr 100', 'Vetr100', 'Fb-5', 'Fb 11', 'Sm260', 'Nfo 500', 'Blm 6149 Ao', 'Blm6149Ao', 'Zt-9', 'M H 1', 'M H1', '211 Bia', 'Bia211', 'NFST-2715951 Trail']) assert.equal(cleanDiscoveryName(name).name, null, name);
  for (const name of ['Lake22', 'Lake 22', 'Lake Creek 8', 'Peak1', 'Peak 1', 'Pond 3', 'Pass 7', 'Arch 2', 'Lake 22 Trail', 'Alder 1', 'Sandbar Gulch 2']) assert.equal(cleanDiscoveryName(name).name, name, name);
});

test('proper trail names retain the generic word while numbered suffixes move to aliases', () => {
  for (const [source, expected] of [['Crater Rim Trail 3957', 'Crater Rim Trail'], ['Crater Rim Trail3957', 'Crater Rim Trail'], ['Arnold Ice Cave Trail Number 63', 'Arnold Ice Cave Trail'], ['Cabin Trail 434', 'Cabin Trail'], ['Diamond Peak Tie Trail 4239', 'Diamond Peak Tie Trail'], ['Black Trail 300A', 'Black Trail']]) {
    assert.deepEqual(cleanDiscoveryName(source), { name: expected, aliases: [source], flags: [] });
  }
  assert.equal(cleanDiscoveryName('Trail Number 63').name, null);
  assert.equal(cleanDiscoveryName('Lake Creek 8').name, 'Lake Creek 8');
  assert.equal(viaTrailName('Crater Rim Trail 3957'), 'Crater Rim Trail');
});


test('generic path descriptions cannot become proper hike titles', () => {
  for (const name of ['Trail from Valerie to Agua Alta Spring', 'Foot Trail from Parking to Lake', 'Path to the Meadow', 'Route from Valley to Ridge']) assert.equal(cleanDiscoveryName(name).name, null, name);
  for (const name of ['Escape from Moscow', 'Trail Creek', 'Trail Canyon East', 'Fromme Mountain Trail']) assert.equal(cleanDiscoveryName(name).name, name, name);
});

test('administrative relation sections yield to full trail names without hiding real section trails', () => {
  for (const name of ['ADT - California - T - Seg 9', 'Adt - California - T - Seg 9 Trail', 'Regional Trail - Segment 4', 'Regional Trail - Section 4 Trail']) assert.equal(cleanDiscoveryName(name).name, null, name);
  for (const name of ['Section 36 Loop Trail', 'Section36Loop Trail', 'Section Line Trail', 'American Discovery Trail']) assert.equal(cleanDiscoveryName(name).name, name, name);
});

test('objective titles choose a supported full relation name over its coded section label', () => {
  const a: [number, number] = [-121, 47], b: [number, number] = [-121, 47.025];
  const relations = [{ id: 1, name: 'ADT - California - T - Seg 9', route: 'hiking', ref: 'ADT T9' }, { id: 2, name: 'American Discovery Trail', route: 'hiking', ref: 'ADT' }];
  const segment: Segment = { id: 'trail', name: 'Randall Trail', trail_names: ['Randall Trail'], kind: 'trail', sac_scale: null, trail_visibility: null, osm_way_ids: [1], relation_names: relations.map(r => r.name), relations, start_node: 'a', end_node: 'b', coords: [a, b], node_ids: ['a', 'b'], osm_edge_way_ids: [1], length_m: length([a, b]), provenance: provenance([1], '2026-10-17T00:00:00Z'), alt_sources: [] };
  const start: NamedFeature = { osm_id: 'node/1', name: 'Five Brooks Trailhead', feature: 'trailhead', lon: a[0], lat: a[1], graph_node: null, graph_distance_m: null, location_method: 'osm_point' };
  const lake: NamedFeature = { osm_id: 'node/2', name: 'Kent Lake', feature: 'lake', lon: b[0], lat: b[1], graph_node: null, graph_distance_m: null, location_method: 'osm_point' };
  const routes = [...discover({ segments: [segment], features: [start, lake], access: [] })];
  const objective = routes.find(candidate => candidate.source === 'objective')!;
  assert.equal(objective.name, 'Kent Lake via American Discovery Trail');
  assert.ok(!objective.preferredNames.some(name => /\bseg\b/i.test(name)));
  assert.ok(!routes.some(candidate => candidate.source === 'relation' && candidate.relation?.id === 1));
});
