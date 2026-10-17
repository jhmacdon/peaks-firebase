import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { comparePopularity, loadRankingContext, popularityThresholds, popularityTier, rankDiscovery } from '../trail-graph/discovery-ranking';
import { composeDiscovery } from '../trail-graph/discovery-catalog';
import { composeDiscover } from '../trail-graph/compose-discover';
import { finalizeRows } from '../trail-graph/compose';
import { provenance } from '../trail-graph/topology';
import { length } from '../trail-graph/geo';
import type { DiscoveryCandidate } from '../trail-graph/discovery';
import type { ComposedRoute } from '../trail-graph/catalog-types';
import type { NamedFeature, Relation, Segment } from '../trail-graph/types';

function fixture(): { candidate: DiscoveryCandidate; segment: Segment; byId: Map<string, Segment> } {
  const coords: Segment['coords'] = [[-121, 47], [-121, 47.025]], name = 'Alpine Lake Trail';
  const segment: Segment = { id: 'or-osm-alpine', name, trail_names: [name], kind: 'trail', sac_scale: null, trail_visibility: null, osm_way_ids: [10], relation_names: [], relations: [], start_node: 'a', end_node: 'b', coords, node_ids: ['a', 'b'], osm_edge_way_ids: [10], length_m: length(coords), provenance: provenance([10], '2026-10-17T00:00:00Z'), alt_sources: [] };
  const trailhead: NamedFeature = { osm_id: 'node/1', name: 'Alpine Trailhead', feature: 'trailhead', lon: coords[0][0], lat: coords[0][1], graph_node: 'a', graph_distance_m: 0, location_method: 'osm_point' };
  const objective: NamedFeature = { osm_id: 'node/2', name: 'Alpine Lake', feature: 'lake', lon: coords[1][0], lat: coords[1][1], graph_node: 'b', graph_distance_m: 0, location_method: 'osm_point' };
  return { segment, byId: new Map([[segment.id, segment]]), candidate: { source: 'objective', identity: 'fixture', name: 'Alpine Lake via Alpine Lake Trail', shape: 'out_and_back', walk: [{ segment_id: segment.id, direction: 'forward', start_vertex: 0, end_vertex: 1, length_m: segment.length_m }], trailhead, trailheadCoord: coords[0], objective, preferredNames: [name] } };
}
const score = (f: ReturnType<typeof fixture>, junction = 0) => rankDiscovery(f.candidate, f.byId, junction).popularity;

test('popularity is numeric and nonzero and a rich objective has a higher loading priority', () => {
  const f = fixture(), plain = score(f); assert.ok(plain > 0 && plain < 1);
  f.candidate.objective!.tags = { wikidata: 'Q1', wikipedia: 'en:Alpine Lake' };
  const rich = score(f, 5); assert.ok(rich > plain + .35); assert.ok(rich <= 1);
});
test('hiking network importance includes international, national, regional and local networks', () => {
  const f = fixture(), values = ['iwn', 'nwn', 'rwn', 'lwn', ''].map(network => {
    f.segment.relations = [{ id: 20, route: 'hiking', network }]; return score(f);
  });
  for (let i = 1; i < values.length; i++) assert.ok(values[i - 1] > values[i]);
  f.segment.relations = [{ id: 20, route: 'bicycle', network: 'iwn' }]; assert.equal(score(f), score(fixture()));
});
test('a brief national-trail crossing does not give the whole approach its network score', () => {
  const f = fixture(), second = structuredClone(f.segment); second.id = 'second'; second.relations = [{ id: 20, route: 'hiking', network: 'nwn' }]; f.byId.set(second.id, second);
  const original = f.candidate.walk[0]; f.candidate.walk = [{ ...original, length_m: 9900 }, { ...original, segment_id: second.id, length_m: 100 }];
  const crossing = score(f); f.candidate.walk = [{ ...original, segment_id: second.id, length_m: 10000 }]; assert.ok(score(f) > crossing + .12);
});
test('trail and relation wikipedia metadata contribute independently from objective metadata', () => {
  const f = fixture(), plain = score(f); f.segment.relations = [{ id: 20, route: 'foot', tags: { wikidata: 'Q20', wikipedia: 'en:Alpine Trail' } }];
  const result = rankDiscovery(f.candidate, f.byId); assert.ok(result.popularity > plain + .19); assert.ok(result.signals.trail_wikidata > 0); assert.ok(result.signals.trail_wikipedia > 0);
});
test('named summit elevation and prominence increase importance without rewarding low lakes', () => {
  const f = fixture(), plain = score(f); f.candidate.objective!.feature = 'summit'; f.candidate.objective!.ele = 4000; f.candidate.objective!.tags = { prominence: '1500 m' };
  assert.ok(score(f) > plain + .15);
});
test('waterfall scale rewards large falls and malformed negative heights keep numeric scores', () => {
  const f = fixture(); f.candidate.objective!.feature = 'waterfall'; f.candidate.objective!.tags = { height: '165' }; const large = score(f);
  f.candidate.objective!.tags.height = '5'; assert.ok(large > score(f));
  for (const height of ['-100', 'not measured', '']) { f.candidate.objective!.tags.height = height; assert.ok(Number.isFinite(score(f))); assert.ok(score(f) > 0); }
});
test('USFS ordinary designation code 1 is not a national trail bonus', () => {
  const f = fixture(), plain = score(f);
  f.segment.alt_sources = [{ source: 'usfs', id: '30', name: 'Alpine', number: '30', tags: { national_trail_designation: '1' } }]; assert.equal(score(f), plain);
  f.segment.alt_sources[0].tags!.national_trail_designation = '3'; assert.ok(score(f) >= plain + .08);
});
test('NPS and explicit wilderness tags add protected-area evidence', () => {
  const f = fixture(), plain = score(f); f.segment.alt_sources = [{ source: 'nps', id: '30', name: 'Alpine', number: null }]; assert.ok(score(f) > plain);
  f.segment.alt_sources = []; f.candidate.objective!.tags = { designation: 'wilderness' }; assert.ok(score(f) > plain);
});
test('very long one-way hikes get a penalty instead of collecting higher priorities', () => {
  const f = fixture(); f.candidate.walk[0].length_m = 25000; const dayHike = score(f);
  f.candidate.walk[0].length_m = 50000; assert.equal(score(f), Math.round(dayHike * .5 * 1e6) / 1e6);
});
test('tercile tiers preserve equal-score ties and descending ordering is deterministic', () => {
  const thresholds = popularityThresholds([.1, .2, .3, .4, .5, .6]); assert.deepEqual(thresholds, { tier_1_min: .5, tier_2_min: .3 });
  assert.deepEqual([.1, .3, .5].map(s => popularityTier(s, thresholds)), [3, 2, 1]);
  const rows = [{ popularity: .2, seed_index: 2 }, { popularity: .5, seed_index: 3 }, { popularity: .5, seed_index: 1 }];
  assert.deepEqual(rows.sort(comparePopularity).map(r => r.seed_index), [1, 3, 2]);
});
test('popularity, evidence and tiers survive catalog hash finalization', () => {
  const f = fixture(); f.candidate.objective!.tags = { wikidata: 'Q1', wikipedia: 'en:Alpine Lake' };
  const row = composeDiscovery(f.candidate, 0, 'OR', f.byId).row, popularity = row.popularity;
  assert.equal(typeof popularity, 'number'); assert.equal(row.popularity_score, popularity); finalizeRows([row], [f.segment]);
  assert.equal(row.popularity, popularity); assert.ok(row.popularity_signals!.objective_wikipedia > 0); assert.ok([1, 2, 3].includes(row.tier));
});
test('local OPL enrichment retains only ranking metadata and uses mapped parking capacity', async () => {
  const parent = resolve(__dirname, '../../../../.cache/test-tmp'); await mkdir(parent, { recursive: true }); const root = await mkdtemp(join(parent, 'ranking-tags-'));
  try {
    await mkdir(join(root, 'extract'));
    await writeFile(join(root, 'extract/trails.opl'), 'w10 Tname=Alpine%20%Trail,wikidata=Q10,wikipedia=en:Alpine%20%Trail Nn1,n2\n');
    await writeFile(join(root, 'extract/roads-parking.opl'), 'w30 Tamenity=parking,capacity=150,toilets=yes Nn1,n2\nn31 Tamenity=drinking_water x-121 y47\n');
    const context = await loadRankingContext(root, [{ osm_id: 'way/30', coord: [-121, 47], parking: true }]), f = fixture();
    assert.equal(context.ways.get(10)!.wikipedia, 'en:Alpine Trail'); assert.equal(context.ways.get(10)!.name, undefined);
    const result = rankDiscovery(f.candidate, f.byId, 4, context); assert.ok(result.popularity > score(f) + .3); assert.equal(result.signals.parking_capacity, .035); assert.ok(result.signals.trailhead_facilities >= .035);
    assert.equal(context.source_files.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('seed-free exports contain numeric popularity in descending loading order and all tiers', async () => {
  const parent = resolve(__dirname, '../../../../.cache/test-tmp'); await mkdir(parent, { recursive: true }); const root = await mkdtemp(join(parent, 'ranking-output-'));
  try {
    const graph = join(root, 'graph'), out = join(root, 'compose'); await mkdir(graph); const segments: Segment[] = [], features: NamedFeature[] = [];
    for (let i = 0; i < 6; i++) {
      const f = fixture(), shift = i * .1; f.segment.id = `or-osm-${i}`; f.segment.coords = f.segment.coords.map(([x, y]) => [x + shift, y]); f.segment.node_ids = [`a${i}`, `b${i}`]; f.segment.start_node = `a${i}`; f.segment.end_node = `b${i}`; f.segment.name = `Alpine ${i} Trail`; f.segment.trail_names = [f.segment.name];
      const relation: Relation = { id: 100 + i, route: 'hiking', network: ['lwn', 'rwn', 'nwn'][i % 3] }; if (i > 0) f.segment.relations = [relation];
      segments.push(f.segment);
      const th = f.candidate.trailhead as NamedFeature; th.lon += shift; th.osm_id = `node/${i + 1}`; th.graph_node = `a${i}`; th.name = `Alpine ${i} Trailhead`; features.push(th);
      const objective = f.candidate.objective!; objective.lon += shift; objective.osm_id = `node/${i + 101}`; objective.graph_node = `b${i}`; objective.name = `Alpine ${i} Lake`; if (i >= 3) objective.tags = { wikidata: `Q${i}` }; features.push(objective);
    }
    for (const [name, rows] of [['segments', segments], ['features', features], ['access', []]] as const) await writeFile(join(graph, `${name}.ndjson`), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    await composeDiscover('OR', graph, out, root);
    const rows = (await readFile(join(out, 'routes.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as ComposedRoute); assert.ok(rows.length >= 6);
    assert.deepEqual([...new Set(rows.filter(r => r.status === 'ok').map(r => r.tier))].sort(), [1, 2, 3]);
    for (let i = 0; i < rows.length; i++) { assert.ok(rows[i].popularity! > 0); assert.equal(rows[i].popularity_score, rows[i].popularity); if (i) assert.ok(rows[i - 1].popularity! >= rows[i].popularity!); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
