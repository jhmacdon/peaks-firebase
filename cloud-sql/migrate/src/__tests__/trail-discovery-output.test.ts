import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { catalogSegment } from '../trail-graph/catalog-output';
import { composeDiscover } from '../trail-graph/compose-discover';
import { composeDiscovery, digestValue } from '../trail-graph/discovery-catalog';
import { catalogRouteId, finalizeRows, segmentManifestHash } from '../trail-graph/compose';
import { compositionValid, planRoute } from '../trail-graph/load-catalog';
import { sourcesCovered } from '../trail-graph/source-provenance';
import { provenance } from '../trail-graph/topology';
import { length } from '../trail-graph/geo';
import type { ComposedRoute } from '../trail-graph/catalog-types';
import type { Segment } from '../trail-graph/types';

function fixture(): Segment {
  const coords: Segment['coords'] = [[-121, 47], [-121, 47.02]];
  return { id: 'ca-osm-fixture', state_code: 'CA', name: 'Alpha Trail', trail_names: ['Alpha Trail'], kind: 'trail', sac_scale: null, trail_visibility: null,
    osm_way_ids: [10], relation_names: ['Alpha Loop'], relations: [{ id: 20, name: 'Alpha Loop', route: 'hiking', network: 'lwn', tags: { name: 'Alpha Loop', route: 'hiking', website: 'https://www.alltrails.com/trail/alpha', wikipedia: 'en:Alpha Trail', note: 'AllTrails is mentioned without a domain', wikidata: 'Q20' } }],
    start_node: 'a', end_node: 'b', coords, node_ids: ['a', 'b'], osm_edge_way_ids: [10], length_m: length(coords), provenance: provenance([10], '2026-10-17T00:00:00Z', 'usfs', undefined, 'CA'),
    alt_sources: [{ source: 'usfs', id: 'agency/30', name: 'ALPHA TRAIL', number: '30', tags: { website: 'https://www.fs.usda.gov/trail/alpha', wikipedia: 'en:https://APP.AllTrails.COM/trail/alpha', attribution: 'USDA Forest Service', license: 'Public domain' } }] };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

test('catalog segment output removes only excluded copied tags without changing its source', () => {
  const segment = freeze(fixture()), before = JSON.stringify(segment), result = catalogSegment(segment), expected = JSON.parse(before) as Segment;
  delete expected.relations[0].tags!.website; delete expected.alt_sources[0].tags!.wikipedia;
  assert.deepEqual(result, expected); assert.equal(JSON.stringify(segment), before); assert.notEqual(result, segment);
  for (const key of ['coords', 'node_ids', 'osm_edge_way_ids', 'osm_way_ids', 'provenance', 'trail_names', 'relation_names'] as const) assert.equal(result[key], segment[key], key);
  assert.equal(result.relations[0].id, 20); assert.equal(result.alt_sources[0].id, 'agency/30'); assert.equal(result.alt_sources[0].name, 'ALPHA TRAIL');
  assert.equal(result.relations[0].tags!.note, 'AllTrails is mentioned without a domain'); assert.equal(result.alt_sources[0].tags!.license, 'Public domain');
  assert.equal(catalogSegment(result), result, 'clean output is idempotent');
});
test('catalog tags exclude domain links with subdomains, case, embedded language prefixes and bare forms', () => {
  for (const link of ['https://alltrails.com/trail/alpha', 'HTTP://WWW.ALLTRAILS.COM/explore', 'https://app.mobile.alltrails.com:443/trail/alpha', 'en:https://www.alltrails.com/trail/alpha', '//www.alltrails.com/trail/alpha', 'www.alltrails.com/trail/alpha', 'alltrails.com/trail/alpha', 'alltrails.com', 'See (https://www.alltrails.com).', 'Official: https://www.fs.usda.gov; alternate: https://alltrails.com/trail/alpha']) {
    const segment = fixture(); segment.relations[0].tags = { website: link, route: 'hiking' }; segment.alt_sources[0].tags = { description: link, license: 'Public domain' };
    const result = catalogSegment(segment); assert.deepEqual(result.relations[0].tags, { route: 'hiking' }, link); assert.deepEqual(result.alt_sources[0].tags, { license: 'Public domain' }, link);
  }
});
test('catalog output preserves non-AllTrails tags and segments without copied tags', () => {
  for (const value of ['AllTrails', 'A note about AllTrails and maps', 'https://www.openstreetmap.org/relation/20', 'https://www.fs.usda.gov/trail/alpha', 'https://notalltrails.com/trail/alpha', 'https://alltrails.com.example.org/trail/alpha']) {
    const segment = fixture(); segment.relations[0].tags = { website: value }; segment.alt_sources[0].tags = { website: value };
    assert.equal(catalogSegment(segment), segment, value);
  }
  const segment = fixture(); delete segment.relations[0].tags; delete segment.alt_sources[0].tags; assert.equal(catalogSegment(segment), segment);
});
test('catalog display labels follow route cleanup while raw trail names retain aliases', () => {
  const segment = fixture(); segment.name = 'Diamond Peak Trail #3699'; segment.display_name = 'Diamond Peak Trail #3699'; segment.trail_names = [segment.name];
  const result = catalogSegment(segment);
  assert.equal(result.name, 'Diamond Peak Trail'); assert.equal(result.display_name, 'Diamond Peak Trail');
  assert.deepEqual(result.trail_names, ['Diamond Peak Trail #3699']); assert.equal(result.coords, segment.coords);
  assert.equal(catalogSegment(result), result);
  segment.name = 'Wapati (Cape Mountain Trail)'; segment.display_name = segment.name;
  assert.equal(catalogSegment(segment).display_name, 'Cape Mountain Trail');
  segment.name = 'Forest Road 23'; segment.display_name = segment.name;
  assert.equal(catalogSegment(segment).display_name, null);
  segment.kind = 'road'; assert.equal(catalogSegment(segment).display_name, 'Forest Road 23');
});
test('metadata cleaning preserves geometry and source coverage and re-finalizes valid loader hashes', () => {
  const segment = fixture(), source = new Map([[segment.id, segment]]), clean = catalogSegment(segment), cleaned = new Map([[clean.id, clean]]);
  const draft = composeDiscovery({ source: 'objective', identity: 'fixture', name: 'Alpha Lake', shape: 'out_and_back', walk: [{ segment_id: segment.id, direction: 'forward', start_vertex: 0, end_vertex: 1, length_m: segment.length_m }], trailhead: { osm_id: 'node/1', name: 'Alpha Trailhead', feature: 'trailhead', lon: -121, lat: 47, graph_node: 'a', graph_distance_m: 0, location_method: 'osm_point' }, trailheadCoord: [-121, 47], objective: { osm_id: 'node/2', name: 'Alpha Lake', feature: 'lake', lon: -121, lat: 47.02, graph_node: 'b', graph_distance_m: 0, location_method: 'osm_point' }, preferredNames: ['Alpha Trail'] }, 0, 'CA', source);
  finalizeRows([draft.row], [segment]);
  const original = structuredClone(draft.row); assert.equal(draft.row.status, 'ok'); assert.equal(compositionValid(draft.row), true); assert.equal(sourcesCovered([segment.provenance], draft.row.provenance!), true);
  assert.notEqual(segmentManifestHash([segment.id], source), segmentManifestHash([clean.id], cleaned), 'the manifest hashes copied tags as well as geometry');
  finalizeRows([draft.row], [clean]); draft.row.route_id = catalogRouteId(draft.row); draft.row.composition_hash = digestValue({ ...draft.row, route_id: undefined, composition_hash: undefined });
  assert.equal(draft.row.geometry_hash, original.geometry_hash); assert.equal(draft.row.length_m, original.length_m); assert.deepEqual(draft.row.segments, original.segments); assert.deepEqual(draft.row.segment_sources, original.segment_sources); assert.deepEqual(draft.row.provenance, original.provenance); assert.equal(sourcesCovered([clean.provenance], draft.row.provenance!), true);
  assert.notEqual(draft.row.segment_manifest_hash, original.segment_manifest_hash); assert.equal(compositionValid(draft.row), true); assert.equal(planRoute(draft.row, cleaned).skipped, undefined);
  const finalized = structuredClone(draft.row); finalizeRows([draft.row], [clean]); assert.deepEqual(draft.row, finalized, 'cleaning and finalization are stable on repeat');
});
test('the offline composer exports cleaned metadata before finalizing loader hashes', async () => {
  const parent = resolve(__dirname, '../../../../.cache/test-tmp'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'catalog-output-'));
  try {
    const graph = join(root, 'graph'), out = join(root, 'compose'); await mkdir(graph);
    const segment = fixture(); segment.id = 'or-osm-fixture'; segment.state_code = 'OR';
    await writeFile(join(graph, 'segments.ndjson'), JSON.stringify(segment) + '\n');
    await writeFile(join(graph, 'features.ndjson'), JSON.stringify({ osm_id: 'node/2', name: 'Alpha Lake', feature: 'lake', lon: -121, lat: 47.02, graph_node: 'b', graph_coord: [-121, 47.02], graph_distance_m: 0, location_method: 'osm_point' }) + '\n');
    await writeFile(join(graph, 'access.ndjson'), JSON.stringify({ osm_id: 'node/1', coord: [-121, 47], name: 'Alpha Parking', parking: true }) + '\n');
    await composeDiscover('OR', graph, out, root);
    const text = await readFile(join(out, 'segments.ndjson'), 'utf8'); assert.doesNotMatch(text, /alltrails\.com/i);
    const segments = text.trim().split('\n').map(line => JSON.parse(line) as Segment), source = new Map(segments.map(s => [s.id, s]));
    assert.equal(segments.length, 1); assert.equal(segments[0].id, segment.id); assert.deepEqual(segments[0].coords, segment.coords); assert.deepEqual(segments[0].provenance, segment.provenance); assert.equal(catalogSegment(segments[0]), segments[0]);
    const rows = (await readFile(join(out, 'routes.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as ComposedRoute); assert.ok(rows.length > 0);
    for (const row of rows) { assert.equal(row.status, 'ok'); assert.equal(compositionValid(row), true); assert.equal(row.segment_manifest_hash, segmentManifestHash(row.segments.map(s => s.id), source)); assert.equal(sourcesCovered(segments.map(s => s.provenance), row.provenance!), true); assert.equal(planRoute(row, source).skipped, undefined); }
    const summary = JSON.parse(await readFile(join(out, 'summary.json'), 'utf8')); assert.equal(summary.catalog_segments_cleaned, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
