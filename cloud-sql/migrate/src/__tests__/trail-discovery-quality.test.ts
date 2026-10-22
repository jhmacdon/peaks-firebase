import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiscoveryAccess } from '../trail-graph/discovery-access';
import { composeDiscovery, discoverySummary, DiscoveryDeduper } from '../trail-graph/discovery-catalog';
import { discover, type DiscoveryCandidate } from '../trail-graph/discovery';
import { cleanDiscoveryName, isNoteObjectiveName, viaTrailName } from '../trail-graph/discovery-names';
import { restrictedFootAccess } from '../trail-graph/pedestrian-access';
import { loadRestrictedDiscoverySegments } from '../trail-graph/discovery-eligibility';
import { drivablePublicRoad, readRoadAccess } from '../trail-graph/road-access';
import { buildTopology, provenance } from '../trail-graph/topology';
import { length } from '../trail-graph/geo';
import type { Coord, NamedFeature, Segment, Tags } from '../trail-graph/types';

const a: Coord = [-106, 35], b: Coord = [-106, 35.02];
const north = (m: number): Coord => [a[0], a[1] + m / 111195];
const feature = (id: string, name: string, coord: Coord, kind: NamedFeature['feature'] = 'trailhead'): NamedFeature => ({ osm_id: id, name, feature: kind, lon: coord[0], lat: coord[1], graph_node: null, graph_distance_m: null, location_method: 'osm_point' });
function fixture() {
  const segment: Segment = { id: 'trail', name: 'Jacks Creek Trail', trail_names: ['Jacks Creek Trail'], kind: 'trail', sac_scale: null, trail_visibility: null, osm_way_ids: [1], relation_names: [], relations: [], start_node: 'a', end_node: 'b', coords: [a, b], node_ids: ['a', 'b'], osm_edge_way_ids: [1], length_m: length([a, b]), provenance: provenance([1], '2026-10-21'), alt_sources: [] };
  const candidate: DiscoveryCandidate = { source: 'objective', identity: 'test', name: 'East Pecos Baldy via Jacks Creek Trail', shape: 'out_and_back', walk: [{ segment_id: 'trail', direction: 'forward', start_vertex: 0, end_vertex: 1, length_m: segment.length_m }], trailhead: { osm_id: 'way/2', coord: a, parking: true }, trailheadCoord: a, objective: feature('node/3', 'East Pecos Baldy', b, 'summit'), preferredNames: ['Jacks Creek Trail'] };
  const byId = new Map([[segment.id, segment]]), access = new DiscoveryAccess([{ osm_id: 'way/2', coord: a, parking: true }]);
  const compose = (context = access) => composeDiscovery(candidate, 0, 'NM', byId, 0, undefined, undefined, context);
  return { segment, candidate, byId, compose };
}

test('unnamed starts use the first trail, record generated names, and cannot supply from suffixes', () => {
  const f = fixture(), draft = f.compose();
  assert.equal(draft.row.status, 'ok');
  assert.equal(draft.row.trailhead!.new!.name, 'Jacks Creek Trailhead');
  assert.equal(draft.row.trailhead!.new!.source.name_is_fallback, true);
  assert.match(draft.row.trailhead!.new!.source.note!, /Generated/);
  assert.ok(draft.row.flags!.includes('generated trailhead name'));
  assert.equal(discoverySummary(draft).trailheadLabel, undefined);
  f.candidate.trailhead = feature('graph/a', 'Invented Route Title Trailhead', a);
  assert.equal(f.compose().row.trailhead!.new!.name, 'Jacks Creek Trailhead');
  f.segment.trail_names = ['Jacks Creek Path'];
  assert.equal(f.compose().row.trailhead!.new!.name, 'Jacks Creek Trailhead');
});

test('unnamed starts choose the nearest named parking or trailhead within 125 metres', () => {
  const f = fixture();
  const named = feature('node/10', 'Jacks Creek Trailhead', north(100));
  const access = [{ osm_id: 'way/2', coord: a, parking: true }, { osm_id: 'way/11', coord: north(80), parking: true, name: 'Creek Parking' }];
  let draft = f.compose(new DiscoveryAccess(access, [named]));
  assert.equal(draft.row.trailhead!.new!.name, 'Creek Parking');
  assert.equal(draft.row.trailhead!.new!.source.name_is_fallback, undefined);
  draft = f.compose(new DiscoveryAccess(access.slice(0, 1), [named]));
  assert.equal(draft.row.trailhead!.new!.source.osm_id, 'node/10');
  assert.equal(f.compose(new DiscoveryAccess(access.slice(0, 1), [{ ...named, lat: north(126)[1] }])).row.trailhead!.new!.source.name_is_fallback, true);
});

test('note-like objectives stay as review rows, including the NM warning', () => {
  for (const name of ["Dangerous Cliffs & 6' of Winter Snow.", 'What?', 'Wow!', 'A place.', '6" snow', 'Caution Point', 'CLOSED Canyon', 'No Access Peak', 'Private Arch', 'Emergency View', 'Keep Out', 'Do Not Enter', 'Danger Bluff', 'Warning Lake']) {
    assert.equal(isNoteObjectiveName(name), true, name);
    const f = fixture(); f.candidate.objective!.name = name;
    const draft = f.compose(); assert.equal(draft.row.status, 'review', name);
    assert.ok(draft.row.reasons.includes('objective name reads as a note or warning'));
  }
  for (const name of ['Mount St. Helens', 'St.', 'Closedown Peak', "Devil's Lake", 'Peak 6', 'Dangerfield Arch']) assert.equal(isNoteObjectiveName(name), false, name);
  const f = fixture(); f.candidate.objective!.name = "Dangerous Cliffs & 6' of Winter Snow.";
  const routes = [...discover({ segments: [f.segment], features: [feature('node/2', 'Creek Trailhead', a), f.candidate.objective!], access: [] })];
  assert.ok(routes.some(route => route.objective?.name === f.candidate.objective!.name));
});

test('Emergency cannot supply a via trail, but a second named trail can', () => {
  for (const name of ['Emergency', 'Emergency Trail', 'Emergency Exit Trail']) assert.equal(viaTrailName(name), null);
  const f = fixture(); f.segment.name = 'Emergency Trail'; f.segment.trail_names = ['Emergency Trail']; f.candidate.preferredNames = ['Emergency Trail'];
  const input = { segments: [f.segment], features: [feature('node/2', 'Creek Trailhead', a), f.candidate.objective!], access: [] };
  let route = [...discover(input)].find(route => route.source === 'objective')!;
  assert.doesNotMatch(route.name, /via Emergency/);
  assert.equal(composeDiscovery(route, 0, 'NM', f.byId, 0, undefined, undefined, new DiscoveryAccess([{ osm_id: 'way/4', coord: a, parking: true }])).row.status, 'review');
  f.segment.trail_names.push('Jacks Creek Trail');
  route = [...discover(input)].find(route => route.source === 'objective')!;
  assert.match(route.name, /via Jacks Creek Trail$/);
});

test('explicit and inferred starts and traverse ends all need road access within 250 metres', () => {
  const f = fixture(); f.candidate.trailhead = feature('node/9', 'Plateau Point Trailhead', a);
  assert.equal(f.compose(new DiscoveryAccess()).row.status, 'review');
  for (const gap of [249, 251]) {
    const draft = f.compose(new DiscoveryAccess([{ osm_id: 'road/1', coord: north(-gap), parking: false }]));
    assert.equal(draft.row.status, gap < 250 ? 'ok' : 'review');
  }
  f.candidate.shape = 'point_to_point'; f.candidate.endTrailhead = feature('node/8', 'Far Trailhead', b);
  let draft = f.compose(); assert.ok(draft.row.reasons.includes('far trailhead has no public road or parking within 250 m'));
  draft = f.compose(new DiscoveryAccess([{ osm_id: 'road/1', coord: a, parking: false }, { osm_id: 'road/2', coord: b, parking: false }]));
  assert.equal(draft.row.status, 'ok');
});

test('private pedestrian tags and foot overrides survive topology boundaries and composition', () => {
  for (const tags of [{ access: 'private' }, { access: 'no' }, { foot: 'private' }, { foot: 'no' }] as Tags[]) {
    assert.equal(restrictedFootAccess(tags), true);
    const f = fixture(); f.segment.osm_access = tags;
    assert.ok(f.compose().row.reasons.includes('route uses a private or no-access pedestrian segment'));
    for (const foot of ['yes', 'designated', 'permissive']) {
      f.segment.osm_access = { ...tags, foot }; assert.equal(f.compose().row.status, 'ok');
    }
  }
  const nodes = new Map<number, Coord>([[1, a], [2, north(100)], [3, b]]);
  const segments = buildTopology([{ id: 1, nodes: [1, 2], tags: { highway: 'path', name: 'Creek Trail' }, relations: [] }, { id: 2, nodes: [2, 3], tags: { highway: 'path', name: 'Creek Trail', access: 'private', foot: 'permissive' }, relations: [] }], nodes, [], '2026-10-21', 'NM');
  assert.equal(segments.length, 2); assert.ok(segments.some(segment => segment.osm_access?.foot === 'permissive'));
});

test('old graphs recover private source-way restrictions and foot overrides from OPL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'discovery-private-'));
  try {
    await mkdir(join(root, 'extract'));
    const f = fixture();
    await writeFile(join(root, 'extract/trails.opl'), 'w1 Taccess=private Nn1,n2\n');
    assert.deepEqual(await loadRestrictedDiscoverySegments(root, [f.segment]), new Set(['trail']));
    await writeFile(join(root, 'extract/trails.opl'), 'w1 Taccess=private,foot=permissive Nn1,n2\n');
    assert.equal((await loadRestrictedDiscoverySegments(root, [f.segment])).size, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('after dedupe, only another ok route to the same resolved objective can demote a long approach', () => {
  for (const objective of ['peaks-summit-id', 'node/123']) {
    const deduper = new DiscoveryDeduper();
    for (const [index, name, distance, loadable, goal] of [[0, 'Mount Willey via Webster Cliff Trail', 10000, true, objective], [1, 'Mount Willey via Willey Range Trail', 5000, true, objective], [2, 'Other Peak', 2000, true, 'node/999'], [3, 'Mount Willey via Review Trail', 1000, false, objective], [4, 'Mount Willey via Nearby Trail', 9999, true, objective]] as const) deduper.consider({ index, name, objective: goal, start: a, trailhead: String(index), walk: [], length: distance, quality: 100 - index, loadable, trail: name });
    deduper.finalNames();
    assert.deepEqual(deduper.longAlternatives(), new Set([0]));
    assert.equal(deduper.counts.long_alternatives_demoted, 1);
  }
});

test('national trail sections, recreation abbreviations, casing and duplicate generics retain source aliases', () => {
  for (const [source, expected] of [['CDT', 'Continental Divide Trail'], ['CDT: Colorado', 'Continental Divide Trail'], ['Cdt - Colorado Section Trail', 'Continental Divide Trail'], ['CDT - Colorado Section Trail - Section A', 'Continental Divide Trail'], ['Bonneville Shoreline Trail - Mount Wire Section', 'Bonneville Shoreline Trail'], ['Cedar Trail - Section A', 'Cedar Trail'], ['Cedar Trail Section 2', 'Cedar Trail'], ['Cedar Trail New Mexico Section', 'Cedar Trail'], ['Wheeler Nat. Rec. Trail', 'Wheeler National Recreation Trail'], ['Wheeler Natl Rec Trail', 'Wheeler National Recreation Trail'], ['Wheeler N.R.T.', 'Wheeler National Recreation Trail'], ['Wheeler NRT Trail', 'Wheeler National Recreation Trail'], ['peek a boo arch', 'Peek a Boo Arch'], ['Peek a boo arch', 'Peek a Boo Arch'], ['árbol arch', 'Árbol Arch'], ['Cedar Loop Loop', 'Cedar Loop'], ['Cedar Trail Trail', 'Cedar Trail']]) {
    const result = cleanDiscoveryName(source, { kind: 'trail' });
    assert.equal(result.name, expected, source); assert.ok(result.aliases.includes(source), source);
  }
  assert.equal(cleanDiscoveryName('Canyon Section A via Cedar Trail Section 2 from Valley Section B', { kind: 'route' }).name, 'Canyon Section A via Cedar Trail from Valley Section B');
  for (const name of ['McDonald Trail', 'iPhone Arch']) assert.equal(cleanDiscoveryName(name, { kind: 'objective' }).name, name);
});

test('the road index rejects footpaths and private motor access, and retains 250 metre contacts', async () => {
  for (const tags of [{ highway: 'path' }, { highway: 'footway' }, { highway: 'cycleway' }, { highway: 'service', motor_vehicle: 'no' }, { highway: 'service', access: 'private', foot: 'yes' }] as Tags[]) assert.equal(drivablePublicRoad(tags), false);
  const root = await mkdtemp(join(tmpdir(), 'discovery-roads-'));
  try {
    const point = north(-240), path = join(root, 'roads.opl');
    await writeFile(path, `n1 T x${point[0]} y${point[1]}\nn2 T x${point[0] + .001} y${point[1]}\nw1 Thighway=service Nn1,n2\n`);
    const result = await readRoadAccess(path, [fixture().segment]);
    assert.ok(result.points.some(point => point.osm_id === 'node/1'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('agency abbreviations remain route aliases after the builder expands their display names', () => {
  const f = fixture(); f.segment.name = 'Continental Divide Trail'; f.segment.trail_names = ['Continental Divide Trail'];
  f.segment.alt_sources = [{ source: 'usfs', id: '10', name: 'Continental Divide Trail', number: null, tags: { trail_name: 'CDT' } }];
  f.candidate.preferredNames = ['Continental Divide Trail'];
  assert.ok(f.compose().row.aliases.includes('CDT'));
});

test('the note-name rule also checks generated trail ends', () => {
  const f = fixture(); f.candidate.objective = undefined; f.candidate.source = 'named_trail';
  f.candidate.name = "Dangerous Dee's Jumpline";
  assert.ok(f.compose().row.reasons.includes('objective name reads as a note or warning'));
});
