import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { agencyLine, readAgencies } from '../trail-graph/agency';
import { build } from '../trail-graph/build';
import { featureType, readFeatures } from '../trail-graph/features';
import { Grid, haversine } from '../trail-graph/geo';
import { geojsonFeatures, ndjson } from '../trail-graph/io';
import { keepWay, readOsm } from '../trail-graph/opl';
import { readRoadAccess } from '../trail-graph/road-access';
import { intersectsBbox, parseState, STATE_CODES, stateConfig, statePaths } from '../trail-graph/state';
import { buildTopology, refresh } from '../trail-graph/topology';
import type { Coord, Segment, Tags } from '../trail-graph/types';

const cache = resolve(__dirname, '../../../../.cache/test-trail-graph-state');
async function temporary(run: (dir: string) => Promise<void>) {
  await mkdir(cache, { recursive: true }); const dir = await mkdtemp(join(cache, 'fixture-'));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
test('state defaults use isolated cache directories, source credit, and valid bounds', () => {
  assert.equal(STATE_CODES.length, 51);
  for (const code of STATE_CODES) {
    const state = stateConfig(code), paths = statePaths(code);
    assert.equal(parseState(code.toLowerCase()), code);
    assert.equal(paths.graph, resolve(__dirname, `../../../../.cache/${code.toLowerCase()}/graph`));
    assert.equal(paths.compose, resolve(__dirname, `../../../../.cache/${code.toLowerCase()}/compose`));
    assert.match(state.osmSourceUrl, new RegExp(`${state.slug}\\.html$`));
    assert.ok(state.bbox[0] < state.bbox[2] && state.bbox[1] < state.bbox[3]);
  }
  for (const code of ['WA', 'OR', 'CA', 'ID'] as const) {
    const state = stateConfig(code), paths = statePaths(code);
    assert.equal(paths.input.endsWith(code === 'WA' ? 'private/wa-trail-data' : `private/west-trail-data/${state.slug}`), true);
  }
  assert.equal(parseState('nh'), 'NH');
  assert.deepEqual(stateConfig('NH'), {
    code: 'NH', name: 'New Hampshire', slug: 'new-hampshire', bbox: [-72.7, 42.6, -70.6, 45.4],
    input: '/Users/josiahm/projects/peaks/private/us-trail-data/new-hampshire',
    osmSourceUrl: 'https://download.geofabrik.de/north-america/us/new-hampshire.html',
  });
  assert.equal(parseState('dc'), 'DC');
  assert.equal(stateConfig('DC').slug, 'district-of-columbia');
  assert.equal(statePaths('CO').input, '/Users/josiahm/projects/peaks/private/us-trail-data/colorado');
  assert.equal(parseState('ak'), 'AK');
  assert.deepEqual(stateConfig('AK').bbox, [-170, 51, -129.9, 72]);
  assert.throws(() => parseState('ZZ'), /Unsupported state/);
  assert.throws(() => parseState('__proto__'), /Unsupported state/);
  assert.ok(intersectsBbox([[-122, 44], [-118, 44]], [-121, 43, -120, 45]));
  assert.equal(intersectsBbox([[-122, 48], [-118, 48]], [-121, 43, -120, 45]), false);
});
test('grid queries remain complete from southern California through high latitudes', () => {
  for (const lat of [32.5, 44, 47.5, 60, 80]) {
    const grid = new Grid<Coord>(10), origin: Coord = [-120, lat];
    const east: Coord = [-120 + 90 / (111195 * Math.cos(lat * Math.PI / 180)), lat];
    assert.ok(haversine(origin, east) < 91); grid.add(east, east, east);
    assert.deepEqual(grid.near(origin, 100), [east]);
  }
});
test('state survives a segment refresh and changes IDs and OSM download credit', () => {
  const coords = new Map<number, Coord>([[1, [-121, 44]], [2, [-120.99, 44]]]);
  const ways = [{ id: 1, nodes: [1, 2], tags: { highway: 'path', name: 'River Trail' }, relations: [] }];
  const wa = buildTopology(ways, coords, [], '2026-10-17')[0], or = buildTopology(ways, coords, [], '2026-10-17', 'OR')[0];
  assert.equal(wa.id.replace(/^wa-/, 'or-'), or.id);
  assert.equal(refresh(or).id.startsWith('or-osm-'), true);
  assert.match(or.provenance.source_url, /oregon\.html$/);
  assert.equal(or.provenance.attribution, '© OpenStreetMap contributors');
});
test('streamed agency collections handle chunk boundaries, strings, and missing optional parks', async () => temporary(async dir => {
  const feature = { type: 'Feature', properties: { trail_name: 'MT. HOOD TRAIL', trail_no: '600', trail_type: 'TERRA', national_trail_designation: 1, notes: ('[\\"}]').repeat(20000) }, geometry: { type: 'LineString', coordinates: [[-121, 44], [-120.99, 44]] } };
  await writeFile(join(dir, 'usfs_trails.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [feature, { ...feature, id: 2 }] }));
  await writeFile(join(dir, 'nps_trails.geojson'), '{"type":"FeatureCollection","features":[]}');
  const parsed: unknown[] = []; for await (const row of geojsonFeatures(join(dir, 'usfs_trails.geojson'))) parsed.push(row);
  assert.deepEqual(parsed, [feature, { ...feature, id: 2 }]);
  const agencies = await readAgencies(dir, stateConfig('OR').bbox);
  assert.equal(agencies.lines.length, 2); assert.equal(agencies.counts.usfs.input, 2);
  assert.equal(agencies.counts.wa_state_parks, undefined);
  assert.equal(agencies.lines[0].name, 'Mount Hood Trail');
  assert.equal(agencies.lines[0].tags?.national_trail_designation, '1');
  assert.equal(agencyLine(feature, 'usfs', '2026-10-17')[0].names.includes('Mount Hood Trail #600'), true);
  await writeFile(join(dir, 'invalid.geojson'), '{"type":"FeatureCollection","features":[{"type":"Feature"}');
  await assert.rejects(async () => { for await (const _ of geojsonFeatures(join(dir, 'invalid.geojson'))) {} }, /Incomplete/);
}));
test('feature extraction keeps unnamed trailheads, objective kinds, and popularity tags', async () => temporary(async dir => {
  const kinds: [Tags, string][] = [
    [{ highway: 'trailhead' }, 'trailhead'], [{ natural: 'hot_spring' }, 'hot_spring'], [{ natural: 'arch' }, 'arch'],
    [{ landuse: 'meadow' }, 'meadow'], [{ natural: 'volcano' }, 'summit'],
    [{ man_made: 'tower', 'tower:type': 'fire_watchtower' }, 'lookout'],
  ];
  for (const [tags, kind] of kinds) assert.equal(featureType(tags), kind);
  const features = kinds.map(([tags], index) => ({ type: 'Feature', id: index, properties: { ...tags, ...(index ? { name: `Place ${index}` } : {}), wikidata: 'Q123', wikipedia: 'en:Place', prominence: 900, ele: '1000' }, geometry: { type: 'Point', coordinates: [-121, 44] } }));
  const path = join(dir, 'features.geojsonseq'); await writeFile(path, features.map(f => '\x1e' + JSON.stringify(f)).join('\n'));
  const source = await readFeatures(path, stateConfig('OR').bbox);
  assert.equal(source.records.length, kinds.length); assert.equal(source.records[0].feature.name, 'Trailhead');
  assert.equal(source.records[1].feature.tags?.wikidata, 'Q123');
  assert.equal(source.records[1].feature.tags?.prominence, '900');
  assert.equal((await readFeatures(path, stateConfig('WA').bbox)).records.length, 0);
}));
test('OSM bbox excludes distant ways while retaining full intersecting lines', async () => {
  const path = join(__dirname, 'fixtures/trail-graph.opl');
  const empty = await readOsm(path, stateConfig('CA').bbox);
  assert.equal(empty.ways.length, 0); assert.equal(empty.stats.bbox_excluded_ways, 4);
  const inside = await readOsm(path, [-121.001, 46.999, -120.989, 47.001]);
  assert.equal(inside.ways.length, 3); assert.equal(inside.ways[0].relations[0].route, 'hiking');
});
test('a local Oregon fixture builds without State Parks and writes Oregon segment identity', async () => temporary(async dir => {
  await mkdir(join(dir, 'extract')); await mkdir(join(dir, 'raw/agency'), { recursive: true });
  await writeFile(join(dir, 'extract/trails.opl'), 'n1 T x-121 y44\nn2 T x-120.98 y44\nw1 Thighway=path,name=River%20%Trail Nn1,n2\n');
  await writeFile(join(dir, 'extract/roads-parking.opl'), '');
  await writeFile(join(dir, 'extract/features.geojsonseq'), '\x1e' + JSON.stringify({ type: 'Feature', id: 2, properties: { natural: 'peak', name: 'River Peak' }, geometry: { type: 'Point', coordinates: [-120.98, 44] } }));
  for (const source of ['usfs', 'nps']) await writeFile(join(dir, `raw/agency/${source}_trails.geojson`), '{"type":"FeatureCollection","features":[]}');
  const out = join(dir, 'output'); await build(dir, out, 'OR');
  const segments: Segment[] = []; for await (const segment of ndjson<Segment>(join(out, 'segments.ndjson'))) segments.push(segment);
  assert.equal(segments.length, 1); assert.equal(segments[0].state_code, 'OR'); assert.match(segments[0].id, /^or-osm-/);
  assert.match(segments[0].provenance.source_url, /oregon\.html$/);
}));
test('pedestrian restrictions exclude named paths and cannot reappear as source connectors or parking', async () => temporary(async dir => {
  const restrictions: Tags[] = [{ foot: 'no' }, { foot: 'private' }, { access: 'no' }];
  for (const tags of restrictions) {
    assert.equal(keepWay({ highway: 'path', name: 'Restricted Trail', ...tags }, true), false);
  }
  assert.equal(keepWay({ highway: 'path', access: 'private', foot: 'yes' }, true), true);
  const path = join(dir, 'trails.opl');
  await writeFile(path, 'n1 T x-121 y44\nn2 T x-120.99 y44\nn3 T x-120.98 y44\nn4 T x-120.99 y44.01\nw1 Thighway=path,name=Public%20%Trail Nn1,n2\nw2 Thighway=footway,foot=no Nn2,n3\nw3 Thighway=track,foot=private Nn2,n4\n');
  const osm = await readOsm(path); assert.equal(osm.ways.length, 1); assert.equal(osm.connectors.length, 0);
  const graph = buildTopology(osm.ways, osm.nodes, [], '2026-10-17');
  const access = join(dir, 'roads-parking.opl');
  await writeFile(access, 'n1 Tamenity=parking,name=No%20%Pedestrians,foot=no x-121 y44\nn2 T x-120.99 y44\nn3 T x-120.98 y44\nw1 Thighway=service,foot=no Nn1,n2\nw2 Tamenity=parking,name=Private%20%Parking,foot=private Nn2,n3\n');
  const road = await readRoadAccess(access, graph); assert.equal(road.points.length, 0); assert.equal(road.links.length, 0);
}));
test('agency closures, planned trails, and pedestrian restrictions stay out; accessibility labels do not mean closure', () => {
  const feature = { type: 'Feature', id: 1, properties: {} as Record<string, string>, geometry: { type: 'LineString', coordinates: [[-121, 44], [-120.99, 44]] } };
  for (const status of ['Closed', 'Decommissioned', 'Planned', 'Abandoned']) {
    feature.properties = { TR_NM: 'Example Trail', TrailStatus: status }; assert.equal(agencyLine(feature, 'wa_state_parks', '2026-10-17').length, 0);
  }
  feature.properties = { TR_NM: 'Example Trail', TrailStatus: 'Existing', ACCESS_STA: 'NOT ACCESSIBLE' }; assert.equal(agencyLine(feature, 'wa_state_parks', '2026-10-17').length, 1);
  feature.properties = { trail_name: 'Example Trail', trail_type: 'TERRA', hiker_pedestrian_restricted: 'YES' }; assert.equal(agencyLine(feature, 'usfs', '2026-10-17').length, 0);
  feature.properties = { TRLNAME: 'Example Trail', TRLSTATUS: 'Existing', OPENTOPUBLIC: 'False' }; assert.equal(agencyLine(feature, 'nps', '2026-10-17').length, 0);
});
