import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscoveryDestinations, discoverySnapshotPath } from '../trail-graph/discovery-destinations';
import { composeDiscovery, DiscoveryPieces, discoverySummary } from '../trail-graph/discovery-catalog';
import { finalizeRows } from '../trail-graph/compose';
import { DestinationResolver } from '../trail-graph/load-matching';
import { planRoute } from '../trail-graph/load-catalog';
import { haversine, length } from '../trail-graph/geo';
import { provenance } from '../trail-graph/topology';
import { discover, type DiscoveryCandidate } from '../trail-graph/discovery';
import type { PeaksDestination } from '../trail-graph/catalog-types';
import type { Coord, Segment } from '../trail-graph/types';

function fixture(gap = 20) {
  const start: Coord = [-122, 44], end: Coord = [-122, 44.02];
  const peak: PeaksDestination = { id: 'real-summit', name: 'Example Peak', features: ['summit'], lng: end[0], lat: end[1] + gap / 111195 };
  const segment: Segment = { id: 'or-trail', name: 'Example Trail', trail_names: ['Example Trail'], relation_names: [], relations: [], kind: 'trail', sac_scale: null, trail_visibility: null, osm_way_ids: [1], osm_edge_way_ids: [1], coords: [start, end], node_ids: ['a', 'b'], start_node: 'a', end_node: 'b', length_m: length([start, end]), provenance: provenance([1], '2026-10-17T00:00:00Z'), alt_sources: [] };
  const candidate: DiscoveryCandidate = { source: 'objective', identity: 'node/1/node/2', name: 'Example Peak via Example Trail', shape: 'out_and_back', trailhead: { osm_id: 'node/1', name: 'Example Trailhead', feature: 'trailhead', lon: start[0], lat: start[1], graph_node: 'a', graph_coord: start, graph_distance_m: 0, location_method: 'osm_point' }, trailheadCoord: start, objective: { osm_id: 'node/2', name: 'Example Peak', feature: 'summit', lon: end[0], lat: end[1], graph_node: 'b', graph_coord: end, graph_distance_m: 0, location_method: 'osm_point' }, preferredNames: ['Example Trail'], walk: [{ segment_id: segment.id, direction: 'forward', start_vertex: 0, end_vertex: 1, length_m: segment.length_m }] };
  return { candidate, peak, byId: new Map([[segment.id, segment]]) };
}
test('snapshot resolution precedes the only summit connector and reaches the Peaks point', () => {
  const f = fixture(), destinations = new DiscoveryDestinations([f.peak]);
  const d = composeDiscovery(f.candidate, 1, 'OR', f.byId, 0, undefined, destinations);
  assert.equal(d.row.status, 'ok'); assert.deepEqual(d.row.objective, { peaks_id: f.peak.id });
  assert.equal(d.walk.length, 2); assert.ok(haversine(d.row.route_end!, [f.peak.lng, f.peak.lat]) < .001);
  const connector = f.byId.get(d.walk[1].segment_id)!;
  assert.equal(connector.summit_connector!.destination_id, f.peak.id); assert.equal(connector.state_code, 'OR');
  assert.equal(d.source_places!.objective!.source.osm_id, 'node/2');
  assert.equal(discoverySummary(d).objective, f.peak.id);
  const pieces = new DiscoveryPieces(); pieces.add(d.walk); pieces.build(f.byId, 'OR'); d.row.segments = pieces.materialize(d.walk);
  finalizeRows([d.row], [...pieces.segments.values()]);
  assert.equal(planRoute(d.row, pieces.segments, { resolver: new DestinationResolver([f.peak]) }).skipped, undefined);
});
test('Peaks summit gaps beyond the existing 75 metre limit stay review-only', () => {
  const f = fixture(80), d = composeDiscovery(f.candidate, 1, 'OR', f.byId, 0, undefined, new DiscoveryDestinations([f.peak]));
  assert.equal(d.row.status, 'review'); assert.equal(d.walk.length, 1);
  assert.ok(d.row.reasons.some(r => /connector refused/.test(r)));
});
test('snapshot contacts are resolved before discovery without moving source coordinates', () => {
  const f = fixture(20), objective = f.candidate.objective!;
  objective.lat += 200 / 111195; delete objective.graph_coord; objective.graph_node = null; objective.graph_distance_m = null;
  const original = structuredClone(objective), destinations = new DiscoveryDestinations([f.peak]);
  const features = [f.candidate.trailhead as typeof objective, objective], segments = [...f.byId.values()];
  assert.equal([...discover({ segments, features, access: [] })].filter(c => c.source === 'objective').length, 0);
  const resolvedContacts = destinations.graphContacts(features, []);
  assert.deepEqual(resolvedContacts.get(objective.osm_id), { coord: [f.peak.lng, f.peak.lat], summit: true });
  const candidate = [...discover({ segments, features, access: [] }, () => {}, { resolvedContacts })].find(c => c.source === 'objective')!;
  assert.ok(candidate); assert.deepEqual(objective, original);
  const d = composeDiscovery(candidate, 1, 'OR', f.byId, 0, undefined, destinations);
  assert.equal(d.row.status, 'ok'); assert.ok(haversine(d.row.route_end!, [f.peak.lng, f.peak.lat]) < .001);
});
test('same-name snapshot matching reaches 400 metres without joining distant homonyms', () => {
  const f = fixture(350), resolver = new DiscoveryDestinations([f.peak]);
  const ref = { new: { name: 'Example Peak', feature: 'summit', lng: -122, lat: 44.02, source: { kind: 'osm' as const, osm_id: 'node/2' } } };
  assert.deepEqual(resolver.resolve(ref), { peaks_id: f.peak.id });
  const distant = { new: { ...ref.new, lat: 43, source: { ...ref.new.source, osm_id: 'node/99' } } };
  assert.deepEqual(resolver.resolve(distant), distant);
});
test('OSM external identity wins and unmatched places never emit transient Peaks IDs', () => {
  const f = fixture(50); f.peak.name = 'Other Official Name'; f.peak.external_ids = { osm_node: '2' };
  const resolver = new DiscoveryDestinations([f.peak]);
  const ref = { new: { name: 'Example Peak', feature: 'summit', lng: -122, lat: 44.02, source: { kind: 'osm' as const, osm_id: 'node/2' } } };
  assert.deepEqual(resolver.resolve(ref), { peaks_id: f.peak.id });
  const unmatched = { new: { ...ref.new, name: 'Unmatched Peak', source: { kind: 'osm' as const, osm_id: 'node/3' } } };
  assert.deepEqual(resolver.resolve(unmatched), unmatched); assert.deepEqual(resolver.resolve(unmatched), unmatched);
});
test('a resolved source identity survives later display-name cleanup', () => {
  const destination: PeaksDestination = { id: 'real-trailhead', name: 'Bear Valley Lakes NRT', features: ['trailhead'], lng: -122, lat: 44 };
  const resolver = new DiscoveryDestinations([destination]);
  resolver.graphContacts([{ osm_id: 'node/4', name: destination.name, feature: 'trailhead', lon: -122, lat: 44, graph_node: null, graph_distance_m: null, location_method: 'osm_point' }], []);
  assert.deepEqual(resolver.resolve({ new: { name: 'Bear Valley Lakes National Recreation Trail', feature: 'trailhead', lng: -122, lat: 44, source: { kind: 'osm', osm_id: 'node/4' } } }), { peaks_id: destination.id });
});
test('resolved trailheads retain source names for dedupe and fail distant start contact', () => {
  const f = fixture(), th: PeaksDestination = { id: 'real-start', name: 'Example Trailhead', features: ['trailhead'], lng: -122, lat: 44.002 };
  const d = composeDiscovery(f.candidate, 1, 'OR', f.byId, 0, undefined, new DiscoveryDestinations([f.peak, th]));
  assert.deepEqual(d.row.trailhead, { peaks_id: th.id }); assert.equal(d.row.status, 'review');
  assert.equal(discoverySummary(d).trailheadLabel, 'Example Trailhead');
});
test('an existing summit identity cannot masquerade as the start trailhead', () => {
  const f = fixture(), wrong: PeaksDestination = { id: 'summit-at-start', name: 'Other Mountain', features: ['summit', 'fire-lookout'], lng: -122, lat: 44, external_ids: { osm_node: '1' } };
  const d = composeDiscovery(f.candidate, 1, 'OR', f.byId, 0, undefined, new DiscoveryDestinations([f.peak, wrong]));
  assert.deepEqual(d.row.trailhead, { peaks_id: wrong.id }); assert.equal(d.row.status, 'review');
  assert.ok(d.row.reasons.includes('resolved start destination is not a trailhead'));
});
test('resolved non-area objectives use their Peaks point for the contact gate', () => {
  const f = fixture(20); f.peak.features = ['viewpoint']; f.candidate.objective!.feature = 'viewpoint';
  f.candidate.objective!.lat += 60 / 111195;
  const d = composeDiscovery(f.candidate, 1, 'OR', f.byId, 0, undefined, new DiscoveryDestinations([f.peak]));
  assert.equal(d.row.status, 'ok'); assert.equal(d.row.kind, 'destination'); assert.equal(d.walk.length, 1);
  assert.deepEqual(d.row.objective, { peaks_id: f.peak.id });
});
test('snapshot paths use the WA input and shared western snapshot directory', () => {
  assert.equal(discoverySnapshotPath('WA', '/private/wa'), '/private/wa/peaks-snapshot/wa-destinations.ndjson');
  assert.equal(discoverySnapshotPath('OR', '/private/west/oregon'), '/private/west/peaks-snapshot/or-destinations.ndjson');
});
