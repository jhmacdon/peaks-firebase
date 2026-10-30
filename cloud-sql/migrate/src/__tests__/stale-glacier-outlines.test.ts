import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTopology } from '../trail-graph/topology';
import { readFeatures } from '../trail-graph/features';
import { conflate } from '../trail-graph/agency';
import { segmentDisplayName } from '../trail-graph/segment-names';
import { parseStaleOutlines, staleGlacierOutlines, staleOutline } from '../glaciers/stale-outlines';
import { parseOsmGlaciers } from '../glaciers/osm';
import { auditStretchNames, type StretchRoute } from '../audit-trail-stretch-names';
import type { Coord, Glacier, Way } from '../trail-graph/types';

const time = '2026-10-29T00:00:00Z';
const nodes = new Map<number, Coord>([[1, [-121.02, 47]], [2, [-121.01, 47]], [3, [-121, 47]], [4, [-120.99, 47]]]);
const way: Way = { id: 1, nodes: [1, 2, 3, 4], tags: { highway: 'path', name: 'Worm Flows Climbing Route' }, relations: [] };
const box = (west: number, east: number): Coord[][] => [[[west, 46.99], [east, 46.99], [east, 47.01], [west, 47.01], [west, 46.99]]];
const fixtureList = parseStaleOutlines({ schemaVersion: 1, outlines: [
  { osm_id: 'relation/10', name: 'Old Glacier', status: 'gone', reason: 'Melted.', sources: ['https://example.org/old'], reviewedAt: '2026-10-29' },
  { osm_id: 'relation/11', name: 'Thin Glacier', status: 'remnant', remnant_label: 'Thin Glacier remnant', reason: 'Debris-covered ice.', sources: ['https://example.org/thin'], reviewedAt: '2026-10-29' },
] });

/** Write a features.geojsonseq fixture with one glacier outline and return what the import reads from it. */
async function readOutline(id: number, name: string, west = -121.011, east = -120.999) {
  const dir = mkdtempSync(join(tmpdir(), 'stale-glacier-')), path = join(dir, 'features.geojsonseq');
  writeFileSync(path, JSON.stringify({ type: 'Feature', properties: { '@type': 'relation', '@id': id, natural: 'glacier', name },
    geometry: { type: 'Polygon', coordinates: box(west, east) } }) + '\n');
  return readFeatures(path, undefined, fixtureList);
}

test('the reviewed list parses, and holds Swift (remnant) and Hinman (gone)', () => {
  const list = staleGlacierOutlines();
  assert.equal(staleOutline('relation/9690999', list)?.status, 'remnant');
  assert.equal(staleOutline('relation:13209365', list)?.status, 'gone', 'place-import keys resolve too');
  assert.equal(staleOutline('https://www.openstreetmap.org/relation/13209365', list)?.name, 'Hinman Glacier');
  for (const o of list.values()) if (o.status === 'remnant') assert.doesNotMatch(o.remnant_label!, /\bglacier$/i);
});

test('the list rejects a remnant labelled as a glacier, a missing source, and duplicates', () => {
  const entry = { osm_id: 'relation/1', name: 'A Glacier', status: 'remnant', remnant_label: 'A Glacier', reason: 'r', sources: ['https://x.org'], reviewedAt: '2026-10-29' };
  assert.throws(() => parseStaleOutlines({ schemaVersion: 1, outlines: [entry] }), /must not end in "Glacier"/);
  assert.throws(() => parseStaleOutlines({ schemaVersion: 1, outlines: [{ ...entry, remnant_label: undefined }] }), /needs remnant_label/);
  assert.throws(() => parseStaleOutlines({ schemaVersion: 1, outlines: [{ ...entry, remnant_label: 'A remnant', sources: [] }] }), /sources/);
  const ok = { ...entry, remnant_label: 'A remnant' };
  assert.throws(() => parseStaleOutlines({ schemaVersion: 1, outlines: [ok, ok] }), /listed twice/);
  assert.throws(() => parseStaleOutlines({ schemaVersion: 1, outlines: [{ ...ok, osm_id: '9690999' }] }), /osm_id/);
});

test('a gone outline neither types nor names an edge, and makes no glacier place', async () => {
  const read = await readOutline(10, 'Old Glacier');
  assert.deepEqual(read.glaciers, []);
  assert.deepEqual(read.records, [], 'no named glacier feature');
  const segments = buildTopology([way], nodes, read.glaciers, time);
  assert.deepEqual(segments.map(s => s.kind), ['trail']);
  assert.deepEqual(segments.map(segmentDisplayName), ['Worm Flows Climbing Route']);
  assert.equal(segments[0].terrain, undefined);
});

test('a way wholly inside a remnant is a snowfield named as remnant ice, never a glacier', async () => {
  const read = await readOutline(11, 'Thin Glacier', -121.03, -120.98);
  assert.equal(read.glaciers.length, 1);
  assert.deepEqual(read.records, [], 'remnant ice makes no glacier place');
  const segments = buildTopology([way], nodes, read.glaciers, time);
  assert.deepEqual(segments.map(s => s.kind), ['snowfield']);
  assert.deepEqual(segments[0].terrain, { kind: 'snowfield', name: 'Thin Glacier remnant', osm_id: 'relation/11' });
  assert.equal(segmentDisplayName(segments[0]), 'Thin Glacier Remnant', 'display names are title-cased');
});

test('a way that only grazes a remnant keeps its trail kind and name (the Worm Flows case)', async () => {
  const read = await readOutline(11, 'Thin Glacier');
  const segments = buildTopology([way], nodes, read.glaciers, time);
  assert.deepEqual(segments.map(s => s.kind), ['trail']);
  assert.deepEqual(segments.map(segmentDisplayName), ['Worm Flows Climbing Route']);
});

test('a current glacier still wins where it overlaps a remnant', () => {
  const remnant: Glacier = { name: 'Thin Glacier', osm_id: 'relation/11', polygons: [box(-121.03, -120.98)], remnant_label: 'Thin Glacier remnant' };
  const current: Glacier = { name: 'Live Glacier', osm_id: 'way/7', polygons: [box(-121.011, -120.999)] };
  const segments = buildTopology([way], nodes, [remnant, current], time);
  assert.deepEqual(segments.map(s => s.kind), ['trail', 'glacier', 'trail'], 'the remnant steps are demoted once the way is not wholly remnant');
  assert.equal(segmentDisplayName(segments[1]), 'Live Glacier');
});

test('agency-only lines follow the same remnant rule', () => {
  const remnant: Glacier = { name: 'Thin Glacier', osm_id: 'relation/11', polygons: [box(-121.03, -120.97)], remnant_label: 'Thin Glacier remnant' };
  const line = (coords: Coord[]) => conflate([], [{ id: 'a1', name: 'Agency Trail', names: ['Agency Trail'], number: null, source: 'usfs', retrieved_at: time, coords } as any], [remnant]).segments[0];
  assert.equal(line([[-121.04, 47], [-121, 47], [-120.96, 47]]).kind, 'trail', 'midpoint inside, ends outside');
  const inside = line([[-121.025, 47], [-121, 47], [-120.975, 47]]);
  assert.equal(inside.kind, 'snowfield');
  assert.equal(inside.terrain?.name, 'Thin Glacier remnant');
});

test('the glacier place parser skips listed outlines and their member ways, and a roster may not name one', () => {
  const ring = (lon: number) => [{ lat: 46.99, lon }, { lat: 46.99, lon: lon + 0.01 }, { lat: 47, lon: lon + 0.01 }, { lat: 46.99, lon }];
  const snapshot = { elements: [
    { type: 'relation', id: 10, tags: { natural: 'glacier', name: 'Old Glacier' }, members: [{ type: 'way', ref: 100, role: 'outer', geometry: ring(-121) }] },
    { type: 'way', id: 100, tags: { natural: 'glacier', name: 'Old Glacier' }, geometry: ring(-121) },
    { type: 'way', id: 200, tags: { natural: 'glacier', name: 'Live Glacier' }, geometry: ring(-120) },
  ] };
  assert.deepEqual(parseOsmGlaciers(snapshot, { stale: fixtureList }).map(p => p.osm_key), ['way:200']);
  assert.throws(() => parseOsmGlaciers(snapshot, { stale: fixtureList, roster: ['relation:10'] }), /marks gone/);
});

test('the name audit flags an edge still named after a listed glacier', () => {
  const route: StretchRoute = { id: 'r', name: 'Worm Flows Route', status: 'active', state_code: 'WA', section_count: 0, segments: [
    { id: 's0', ordinal: 0, direction: 'forward', display_name: 'Worm Flows Climbing Route', trail_names: [], kind: 'trail', distance: 100 },
    { id: 's1', ordinal: 1, direction: 'forward', display_name: 'Swift Glacier', trail_names: [], kind: 'glacier', distance: 70 },
    { id: 's2', ordinal: 2, direction: 'forward', display_name: 'Swift Glacier remnant', trail_names: [], kind: 'snowfield', distance: 70 },
  ] };
  assert.deepEqual(auditStretchNames(route).filter(f => f.code === 'named_after_stale_glacier').map(f => f.segment_ids), [['s1']]);
});
