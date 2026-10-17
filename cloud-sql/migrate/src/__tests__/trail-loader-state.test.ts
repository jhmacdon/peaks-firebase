import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Composer, materialize, catalogRouteId, digest, segmentManifestHash } from '../trail-graph/compose';
import { planRoute } from '../trail-graph/load-catalog';
import { segmentValues, UPSERT_SEGMENT } from '../trail-graph/load-segments';
import { provenance, refresh } from '../trail-graph/topology';
import type { CatalogInputs, ComposedRoute } from '../trail-graph/catalog-types';
import type { Segment } from '../trail-graph/types';

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/wa-compose.json'), 'utf8'));
function rehash(row: ComposedRoute, segments: Map<string, Segment>) {
  row.segment_manifest_hash = segmentManifestHash(row.segments.map(s => s.id), segments);
  row.composition_hash = digest({ ...row, route_id: undefined, composition_hash: undefined }); row.route_id = catalogRouteId(row);
}
function setup() {
  const segment = refresh({ id: '', name: 'River Trail', trail_names: ['River Trail'], kind: 'trail', sac_scale: null, trail_visibility: null,
    osm_way_ids: [10], osm_edge_way_ids: [10, 10], relations: [], relation_names: [], start_node: '', end_node: '', coords: [[-121, 47], [-120.995, 47], [-120.99, 47]],
    node_ids: ['1', '2', '3'], length_m: 0, provenance: provenance([10], '2026-10-17T00:00:00Z'), alt_sources: [] } as Segment);
  const input: CatalogInputs = { ...structuredClone(fixture), seeds: [fixture.seed], segments: [segment], routes: [], popularity: [] };
  const composer = new Composer(input), draft = composer.compose(fixture.seed, 0), segments = new Map(materialize([draft], composer.byId).map(s => [s.id, s]));
  const row = draft.row; row.trailhead = { new: { name: 'River Trailhead', feature: 'trailhead', lng: row.route_start![0], lat: row.route_start![1], source: { kind: 'osm', osm_id: 'node/100' } } };
  row.objective = { new: { name: 'River Pass', feature: 'pass', lng: row.route_end![0], lat: row.route_end![1], source: { kind: 'osm', osm_id: 'node/101' } } };
  return { row, segments };
}
test('offline discovery plans bind route, segment, destination, and binding state', () => {
  const { row, segments } = setup(); row.state_code = 'OR'; row.discovery_source = 'objective'; rehash(row, segments);
  const plan = planRoute(row, segments); assert.equal(plan.skipped, undefined);
  assert.match(plan.route_id, /^or-catalog-/);
  assert.equal(plan.statements.find(s => s.kind === 'route_insert')!.values[9], 'OR');
  for (const statement of plan.statements.filter(s => ['segment_insert', 'destination_insert'].includes(s.kind))) assert.equal(statement.values[10], 'OR');
  const binding = plan.statements.find(s => s.kind === 'binding_guard')!; assert.equal(JSON.parse(binding.values[1] as string).state_code, 'OR');
  const pass = plan.statements.find(s => s.kind === 'destination_insert' && s.values[1] === 'River Pass')!;
  assert.equal(pass.values[2], 'landform'); assert.equal(JSON.parse(pass.values[7] as string).natural_feature, 'pass');
});
test('discovery review rows remain unloadable with include-review enabled', () => {
  for (const status of ['review', 'failed', 'needs_geometry'] as const) {
    const { row, segments } = setup(); row.discovery_source = 'objective'; row.status = status;
    assert.match(planRoute(row, segments, { includeReview: true }).skipped!, new RegExp(`composition status ${status}`));
  }
});
test('new pass/saddle creation remains narrow to contacted OSM discovery objectives', () => {
  const { row, segments } = setup(); rehash(row, segments);
  assert.match(planRoute(row, segments).skipped!, /uncurated/);
  row.discovery_source = 'objective'; row.objective!.new!.source.kind = 'graph'; rehash(row, segments);
  assert.match(planRoute(row, segments).skipped!, /uncurated/);
  row.objective!.new!.source.kind = 'osm'; row.objective!.new!.lng += 1; rehash(row, segments);
  assert.match(planRoute(row, segments).skipped!, /uncurated/);
  row.objective!.new!.lng -= 1; row.objective!.new!.feature = 'glacier'; rehash(row, segments);
  assert.match(planRoute(row, segments).skipped!, /uncurated/);
});
test('non-Washington activation refuses the Washington-only integrity function', () => {
  const { row, segments } = setup(); row.state_code = 'CA'; row.discovery_source = 'objective'; rehash(row, segments);
  assert.throws(() => planRoute(row, segments, { activate: true, elevation: true }), /activate_wa_catalog_route supports WA only/);
});
test('a discovered mapped trail end needs exact endpoint identity even when its name contains Pass or Glacier', () => {
  const { row, segments } = setup(), lastRef = row.segments.at(-1)!, lastSegment = segments.get(lastRef.id)!;
  const vertex = lastRef.direction === 'forward' ? lastSegment.node_ids.length - 1 : 0, point = lastSegment.coords[vertex];
  row.objective = { new: { name: 'Glacier Pass Trail End', feature: 'landform', lng: point[0], lat: point[1], source: { kind: 'trail_end', node_id: lastSegment.node_ids[vertex], provenance: lastSegment.provenance } } };
  rehash(row, segments); assert.match(planRoute(row, segments).skipped!, /uncurated/);
  row.discovery_source = 'named_trail'; rehash(row, segments); assert.equal(planRoute(row, segments).skipped, undefined);
  row.objective.new!.source.node_id = 'wrong-node'; rehash(row, segments); assert.match(planRoute(row, segments).skipped!, /uncurated/);
  row.objective.new!.source.node_id = lastSegment.node_ids[vertex]; row.objective.new!.lat += .00001; rehash(row, segments);
  assert.match(planRoute(row, segments).skipped!, /uncurated/);
});
test('standalone segment inserts bind their state and keep Washington as the default', () => {
  const { segments } = setup(), segment = [...segments.values()][0];
  assert.equal(segmentValues(segment)[10], 'WA'); segment.state_code = 'ID'; assert.equal(segmentValues(segment)[10], 'ID');
  assert.equal(segmentValues(segment, 'OR')[10], 'OR'); assert.match(UPSERT_SEGMENT, /\$11/);
});
