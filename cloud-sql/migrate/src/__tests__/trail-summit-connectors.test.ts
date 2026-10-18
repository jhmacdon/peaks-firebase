import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { alignSummitKind, appendSummitConnector, finalizePlaceLinks } from '../trail-graph/summit-connectors';
import { refresh, provenance } from '../trail-graph/topology';
import { haversine, length } from '../trail-graph/geo';
import { applyCuration, projection, routeLine } from '../trail-graph/stretches';
import { finalizeRows, materialize } from '../trail-graph/compose';
import { finalizeRebases, rebaseDraft, rebasePlanHash, type LegacyRoute } from '../trail-graph/rebase';
import { TrailRouter } from '../trail-graph/router';
import { replacementPlan } from '../trail-graph/load-rebase';
import { planRoute } from '../trail-graph/load-catalog';
import { DestinationResolver } from '../trail-graph/load-matching';
import { segmentValues } from '../trail-graph/load-segments';
import { peaksLegacyProvenance, unionProvenance, sourcesCovered, validSource } from '../trail-graph/source-provenance';
import type { ComposedRoute, PeaksDestination } from '../trail-graph/catalog-types';
import type { Coord, Segment, NamedFeature } from '../trail-graph/types';

const summit: PeaksDestination = { id: 'goal', name: 'Test Peak', features: ['summit'], lng: -120.98, lat: 47.0002 };
const th: PeaksDestination = { id: 'th', name: 'Test Trailhead', features: ['trailhead'], lng: -121, lat: 47 };
function fixture(reverse = false, kind: ComposedRoute['kind'] = 'summit') {
  const coords: Coord[] = Array.from({ length: 201 }, (_, i) => [-121 + i * .0001, 47]);
  const nodes = coords.map((_, i) => `n${reverse ? 200 - i : String(i).padStart(3, '0')}`);
  const s = refresh({ id: '', name: 'Test Trail', display_name: 'Test Trail', trail_names: ['Test Trail'], relation_names: [], relations: [],
    kind: 'trail', sac_scale: null, trail_visibility: null, coords, node_ids: nodes, osm_edge_way_ids: coords.slice(1).map(() => 10),
    osm_way_ids: [10], start_node: '', end_node: '', length_m: 0, provenance: provenance([10], '2026-10-15T00:00:00Z'), alt_sources: [] });
  const row: ComposedRoute = { seed_index: 0, name: 'Test Peak via Test Trail', aliases: [], kind, region: 'Test', tier: 1,
    trailhead: { peaks_id: 'th' }, objective: { peaks_id: 'goal' }, segments: [{ id: s.id, direction: reverse ? 'reverse' : 'forward' }],
    length_m: s.length_m, shape: 'out_and_back', waypoints: [], wta_url: null, requires_permit: null, season: '', existing_route_match: null,
    existing_route_matches: [], name_duplicates: [], status: 'ok', reasons: [], expected_length_m: s.length_m, deviation_fraction: 0,
    preferred_fraction: 1, road_fraction: 0, approx_roundtrip_mi: 2, route_start: [-121, 47], route_end: [-120.98, 47], segment_sources: [] };
  return { s, row, byId: new Map([[s.id, s]]) };
}
test('summit connectors keep directed continuity, exact target, xc/null display and Peaks-derived credit', () => {
  for (const reverse of [false, true]) {
    const { s, row, byId } = fixture(reverse), before = structuredClone(s), start = routeLine(row, byId)[0];
    const connector = appendSummitConnector(row, byId, summit)!;
    assert.ok(connector.length_m > 5 && connector.length_m <= 75);
    assert.ok(connector.coords.length >= 2 && connector.coords.length <= 5);
    assert.equal(connector.kind, 'xc'); assert.equal(connector.display_name, null); assert.equal(connector.description, 'summit connector');
    assert.equal(connector.provenance.source_kind, 'peaks-derived'); assert.equal(connector.provenance.attribution, 'Peaks');
    assert.equal(connector.provenance.contains_osm_geometry, false); assert.deepEqual(connector.osm_way_ids, []); assert.ok(validSource(connector.provenance));
    const line = routeLine(row, byId); assert.deepEqual(line[0], start); assert.deepEqual(line.at(-1), [summit.lng, summit.lat]);
    assert.ok(Math.abs(length(line) - row.length_m) < .001); assert.deepEqual(s, before);
    assert.ok(JSON.parse(segmentValues(connector)[4] as string).coordinates.every((p: number[]) => p[2] === 0));
    assert.ok(row.notes!.some(n => n.includes('summit connector')));
    assert.equal(appendSummitConnector(row, byId, summit), null, 'retry at the exact summit adds nothing');
  }
});
test('connectors require a Peaks summit objective and never apply to destination/loop/traverse routes', () => {
  for (const kind of ['destination', 'loop', 'traverse'] as const) { const f = fixture(false, kind); assert.equal(appendSummitConnector(f.row, f.byId, summit), null); assert.equal(f.row.segments.length, 1); }
  const f = fixture(); f.row.objective = { new: { name: summit.name, feature: 'summit', lng: summit.lng, lat: summit.lat, source: { kind: 'osm' } } };
  assert.equal(appendSummitConnector(f.row, f.byId, summit), null);
  const other = fixture(); assert.equal(appendSummitConnector(other.row, other.byId, { ...summit, features: ['viewpoint'] }), null);
});
test('resolved Peaks summit objectives correct destination-kind seeds before endpoint composition', () => {
  const f = fixture(false, 'destination'); alignSummitKind(f.row, summit);
  assert.equal(f.row.kind, 'summit'); assert.ok(f.row.notes!.some(n => n.includes('instead of seed destination kind')));
  assert.ok(appendSummitConnector(f.row, f.byId, summit));
  for (const kind of ['loop', 'traverse'] as const) { const x = fixture(false, kind); alignSummitKind(x.row, summit); assert.equal(x.row.kind, kind); assert.equal(appendSummitConnector(x.row, x.byId, summit), null); }
  const ordinary = fixture(false, 'destination'); alignSummitKind(ordinary.row, { ...summit, features: ['viewpoint'] }); assert.equal(ordinary.row.kind, 'destination');
});
test('5m contact needs no connector; the 75m limit is strict and a refused gap is reported', () => {
  const f = fixture(); assert.equal(appendSummitConnector(f.row, f.byId, { ...summit, lat: 47.00001 }), null);
  const delta = .001 / haversine([-120.98, 47], [-120.98, 47.001]);
  for (const [gap, allowed] of [[74.999, true], [75.001, false]] as const) {
    const x = fixture(), result = appendSummitConnector(x.row, x.byId, { ...summit, lat: 47 + delta * gap });
    assert.equal(!!result, allowed); if (!allowed) { assert.equal(x.row.status, 'review'); assert.match(x.row.reasons.join(), />75 m/); assert.equal(x.row.segments.length, 1); }
  }
});
test('same graph-end/target connectors share a stable id and are excluded from OSM source claims', () => {
  const a = fixture(), b = structuredClone(a.row), x = appendSummitConnector(a.row, a.byId, summit)!, y = appendSummitConnector(b, a.byId, summit)!;
  assert.equal(x, y); assert.equal(a.byId.size, 2); assert.deepEqual(a.row.segments, b.segments);
  const mixed = unionProvenance([a.s.provenance, peaksLegacyProvenance('2020-01-01T00:00:00Z'), x.provenance]);
  assert.equal(mixed.sources!.length, 3); assert.ok(validSource(mixed)); assert.ok(sourcesCovered([a.s.provenance, peaksLegacyProvenance('2020-01-01T00:00:00Z'), x.provenance], mixed));
  assert.equal(sourcesCovered([a.s.provenance], mixed), false); assert.deepEqual(mixed.osm_way_ids, [10]);
});
test('connector geometry stays xc/null while its presentation joins the previous named stretch', () => {
  const f = fixture(), connector = appendSummitConnector(f.row, f.byId, summit)!, segments = [...f.byId.values()];
  applyCuration([f.row], segments, { routes: [] }, [th, summit], []);
  assert.equal(f.row.stretches!.length, 1); assert.equal(f.row.stretches![0].display_name, 'Test Trail');
  assert.ok(Math.abs(f.row.stretches![0].length_m - f.row.length_m) < .001); assert.equal(connector.display_name, null); assert.equal(connector.kind, 'xc');
});
test('composed links drop an untouched intermediate summit/place and retain exact objective and touched camp', () => {
  const f = fixture(), missed: PeaksDestination = { ...summit, id: 'rim', name: 'Crater Rim', lng: -120.99, lat: 47.0004 }, camp: PeaksDestination = { ...summit, id: 'camp', name: 'Camp', features: ['campsite'], lng: -120.995, lat: 47 };
  f.row.waypoints = [missed, camp].map(d => ({ peaks_id: d.id, name: d.name, feature: d.features[0], lng: d.lng, lat: d.lat, fraction: .5, osm_id: `peaks/${d.id}`, distance_from_route_m: 0 }));
  appendSummitConnector(f.row, f.byId, summit); finalizePlaceLinks(f.row, f.byId, new Map([th, summit, missed, camp].map(d => [d.id, d])), [th, summit, missed, camp]);
  assert.deepEqual(f.row.waypoints.map(w => w.peaks_id), ['camp']); assert.equal(f.row.objective!.peaks_id, 'goal'); assert.equal(f.row.status, 'ok');
  assert.equal(f.row.dropped_links![0].name, 'Crater Rim'); assert.ok(f.row.dropped_links![0].gap_m > 40); assert.equal(f.row.segments.length, 2, 'no spur to intermediate summit');
  finalizeRows([f.row], [...f.byId.values()]); const plan = planRoute(f.row, f.byId, { elevation: true });
  const metadata = JSON.parse(plan.statements.find(s => s.kind === 'route_insert')!.values[5] as string).wa_catalog;
  assert.equal(metadata.dropped_links[0].name, 'Crater Rim'); assert.deepEqual(JSON.parse(plan.statements.find(s => s.kind === 'route_destination_insert')!.values[1] as string).map((p: { id: string }) => p.id), ['th', 'camp', 'goal']);
});
test('a refused summit objective is not retained as a claimed route destination', () => {
  const f = fixture(), far = { ...summit, lat: 47.001 };
  appendSummitConnector(f.row, f.byId, far); finalizePlaceLinks(f.row, f.byId, new Map([th, far].map(d => [d.id, d])));
  assert.equal(f.row.objective, null); assert.equal(f.row.status, 'review'); assert.equal(f.row.dropped_links![0].id, 'goal'); assert.equal(f.byId.size, 1);
});
test('area/source contact retains passed glaciers and camps without weakening Peaks summit contact', () => {
  const f = fixture(), camp = { ...summit, id: 'camp', name: 'Test Camp', features: ['campsite'], lng: -120.99, lat: 47.0004, has_boundary: true }, missed = { ...camp, id: 'rim', name: 'Missed Summit', features: ['summit'] };
  appendSummitConnector(f.row, f.byId, summit);
  const point = (name: string, osm_id: string, feature: NamedFeature['feature']): NamedFeature => ({ name, osm_id, feature, lon: -120.99, lat: 47, graph_node: null, graph_distance_m: null, location_method: 'osm_point' });
  const glacier: NamedFeature = { ...point('Test Glacier', 'relation/1', 'glacier'), lat: 47.01, boundary: { type: 'MultiPolygon', coordinates: [[[[-120.992, 46.999], [-120.988, 46.999], [-120.988, 47.001], [-120.992, 47.001], [-120.992, 46.999]]]] } };
  f.row.waypoints = [
    { peaks_id: camp.id, name: camp.name, feature: 'campsite', lng: camp.lng, lat: camp.lat, fraction: .5, osm_id: 'curated/camp', distance_from_route_m: 45 },
    { peaks_id: missed.id, name: missed.name, feature: 'summit', lng: missed.lng, lat: missed.lat, fraction: .5, osm_id: 'node/2', distance_from_route_m: 0 },
    { name: glacier.name, feature: 'glacier', lng: glacier.lon, lat: glacier.lat, fraction: .5, osm_id: glacier.osm_id, distance_from_route_m: 0 },
  ];
  finalizePlaceLinks(f.row, f.byId, new Map([th, summit, camp, missed].map(d => [d.id, d])), [th, summit, camp, missed], [glacier, point(camp.name, 'node/1', 'campsite'), point(missed.name, 'node/2', 'summit')]);
  assert.deepEqual(f.row.waypoints.map(w => w.name).sort(), [camp.name, glacier.name].sort());
  assert.ok(f.row.waypoints.every(w => w.distance_from_route_m < .001)); assert.ok(f.row.dropped_links!.some(d => d.id === missed.id));
});
test('loader dedupe cannot substitute an untouched summit and clears retained IDs from dropped-link audit', () => {
  const f = fixture(), minor: PeaksDestination = { ...summit, id: 'minor', name: 'Minor Peak', lng: -120.99 };
  appendSummitConnector(f.row, f.byId, summit);
  f.row.waypoints = [{ new: { name: minor.name, feature: 'summit', lng: minor.lng, lat: 47, source: { kind: 'osm', osm_id: 'node/123' } }, name: minor.name, feature: 'summit', lng: minor.lng, lat: 47, fraction: .5, osm_id: 'node/123', distance_from_route_m: 0 }];
  f.row.dropped_links = [{ id: 'th', name: th.name, gap_m: 0, reason: 'same place under another name' }];
  finalizeRows([f.row], [...f.byId.values()]);
  const p = planRoute(f.row, f.byId, { resolver: new DestinationResolver([th, summit, minor]) });
  assert.ok(!p.skipped); assert.ok(!p.destination_ids.includes('minor'));
  const meta = JSON.parse(p.statements.find(s => s.kind === 'route_insert')!.values[5] as string).wa_catalog;
  assert.deepEqual(meta.dropped_links.map((d: any) => d.id), ['minor']);
  const connector = p.statements.find(s => s.kind === 'segment_insert' && JSON.parse(s.values[6] as string).source_kind === 'peaks-derived')!;
  assert.deepEqual(JSON.parse(connector.values[6] as string).wa_catalog.notes, ['summit connector']);
});
test('loader refuses a deduped summit objective requiring a connector until it is recomposed', () => {
  const f = fixture(); f.row.objective = { new: { name: summit.name, feature: 'summit', lng: summit.lng, lat: 47, source: { kind: 'osm', osm_id: 'node/123' } } };
  finalizeRows([f.row], [...f.byId.values()]);
  const p = planRoute(f.row, f.byId, { resolver: new DestinationResolver([th, summit]) });
  assert.match(p.skipped!, /resolved summit objective.*recompose/); assert.equal(p.statements.length, 0);
});
test('legacy summit rebase ends exactly at the target, preserves its start and replaces legacy place links', () => {
  const f = fixture(), missed = { ...summit, id: 'old-summit', name: 'Untouched Rim', lng: -120.99, lat: 47.0004 };
  const legacy: LegacyRoute = { id: 'legacy', name: 'Test Trail', status: 'active', kind: null, shape: null, distance: f.s.length_m, gain: 200,
    objective_destination_id: 'goal', trailhead_destination_id: 'th', provenance_source: null, n_sessions: 4, catalog_reviewed: false,
    factory_job: null, segments: null, coords: f.s.coords.map(p => [...p]), created_at: '2020-01-01T00:00:00Z' };
  const result = rebaseDraft(legacy, new TrailRouter([f.s]), f.byId, undefined, { objectiveFeatures: ['summit'], places: [th, missed, summit] });
  const parts = materialize([result.draft], f.byId), byId = new Map(parts.map(s => [s.id, s]));
  const connector = appendSummitConnector(result.plan.row, byId, summit)!; parts.push(connector);
  finalizePlaceLinks(result.plan.row, byId, new Map([th, summit, missed].map(d => [d.id, d])), [th, missed, summit]);
  finalizeRebases([result.plan], parts); finalizeRows([result.plan.row], parts); result.plan.plan_hash = rebasePlanHash(result.plan);
  assert.equal(result.plan.status, 'ok', result.plan.reasons.join()); const line = routeLine(result.plan.row, byId);
  assert.deepEqual(line[0], legacy.coords[0]); assert.deepEqual(line.at(-1), [summit.lng, summit.lat]); assert.ok(projection([summit.lng, summit.lat], line).distance < .001);
  const plan = replacementPlan(result.plan.row, byId, result.plan, { elevation: true });
  assert.ok(plan.statements.some(s => s.kind === 'replace_destinations')); assert.deepEqual(plan.destination_ids, ['th', 'goal']);
  assert.ok(!plan.statements.some(s => /SET status=|session_routes/.test(s.sql)));
  assert.ok(plan.statements.some(s => s.kind === 'segment_insert' && JSON.parse(s.values[6] as string).source_kind === 'peaks-derived'));
  assert.ok(plan.statements.some(s => s.kind === 'elevation_segment_update' && s.values[0] === connector.id));
});
test('both migrations use positional SQL parameters and preserve explicit column aliases', async () => {
  for (const file of ['20261016_wa_catalog_activation.sql', '20261017_wa_catalog_source_bundles.sql']) {
    const sql = await readFile(resolve(__dirname, '../../../migrations', file), 'utf8'); let checked = 0;
    for (const m of sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION\s+(\w+)\s*\(([^;]*?)\)\s*RETURNS\b([^;]*?)\$\$([\s\S]*?)\$\$;/gi)) {
      if (!/LANGUAGE\s+SQL\b/i.test(m[3])) continue; checked++;
      const params = m[2].split(',').map(s => s.trim().split(/\s+/)[0]);
      const body = m[4].replace(/'(?:''|[^'])*'|--[^\n]*/g, '').replace(/\bway_(?:id|url)\(value, ordinal\)/g, '').replace(/\b\w+\.value\b/g, '');
      for (let n = 0; n < params.length; n++) { assert.ok(body.includes('$' + (n + 1)), m[1]); assert.ok(!new RegExp('\\b' + params[n] + '\\b').test(body), `${file}: ${m[1]} unqualified ${params[n]}`); }
    }
    assert.ok(checked >= 2); assert.match(sql, /AS way_id\(value, ordinal\)/); assert.match(sql, /way_id\.value/); assert.ok(sql.includes("'dropped_links'"));
    if (file.startsWith('20261017')) {
      const body = sql.split('CREATE OR REPLACE FUNCTION wa_catalog_provenance_elevation')[1];
      assert.ok(body.includes("CASE WHEN $1?'wa_catalog'")); assert.ok(body.includes('||$2')); assert.ok(!body.includes("CASE WHEN value?'wa_catalog'"));
      assert.ok(sql.includes('CREATE OR REPLACE FUNCTION wa_catalog_valid_source_provenance'), 'fix existing 20261016 installs too');
    }
  }
});
