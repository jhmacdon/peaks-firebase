import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adoptFrozenSegments, type FrozenSegment } from '../trail-graph/frozen-segments';
import { provenance, refresh, graphNodes } from '../trail-graph/topology';
import { TrailRouter } from '../trail-graph/router';
import { Composer, finalizeRows, materialize } from '../trail-graph/compose';
import { applyCuration, assignNames, splitSegment } from '../trail-graph/stretches';
import { bindExistingSegments, type ExistingOverlap } from '../trail-graph/load-preflight';
import { planRoute, executePlan } from '../trail-graph/load-catalog';
import { alignSummitKind, alignTraverseObjective } from '../trail-graph/summit-connectors';
import { withoutElevation, validSource, sourceLeaves } from '../trail-graph/source-provenance';
import { segmentValues } from '../trail-graph/load-segments';
import type { CatalogInputs, ComposedRoute } from '../trail-graph/catalog-types';
import type { Coord, Segment } from '../trail-graph/types';

const data = JSON.parse(readFileSync(join(__dirname, 'fixtures/wa-compose.json'), 'utf8'));
function fixture() {
  const coords: Coord[] = [[-121, 47], [-120.995, 47], [-120.99, 47]];
  const parent = refresh({ id: '', name: 'River Trail', trail_names: ['River Trail'], kind: 'trail', sac_scale: null, trail_visibility: null, osm_way_ids: [10], osm_edge_way_ids: [10, 10],
    relations: [], relation_names: [], start_node: '', end_node: '', coords, node_ids: ['a', 'b', 'c'], length_m: 0, provenance: provenance([10], '2026-10-15T00:00:00Z'), alt_sources: [] } as Segment);
  const fixed: FrozenSegment = { id: 'trail-fixed', name: 'River Trail', trail_names: ['River Trail'], route_ids: ['frozen-route'],
    provenance: { ...parent.provenance, elevation_source: 'old-profile', elevation_profile: 'terrain' } as any,
    coords: [[-120.992, 47, 150.125], [-120.995, 47, 130.25], [-120.998, 47, 110.875]] };
  const adopted = adoptFrozenSegments([parent], [fixed]);
  const input: CatalogInputs = { ...structuredClone(data), seeds: [data.seed], segments: adopted.segments, routes: [], popularity: [] };
  const c = new Composer(input), draft = c.compose(data.seed, 0), segments = materialize([draft], c.byId), row = draft.row;
  assignNames([row], segments); finalizeRows([row], segments);
  return { parent, fixed, adopted, c, row, segments, byId: new Map(segments.map(s => [s.id, s])) };
}
test('frozen whole pieces replace spans across graph cuts without changing their XY, XYZ, provenance or direction', () => {
  const f = fixture(), saved = structuredClone(f.parent), savedFrozen = structuredClone(f.fixed), fixed = f.adopted.segments.find(s => s.id === f.fixed.id)!;
  adoptFrozenSegments([f.parent], [f.fixed]);
  assert.equal(f.adopted.segments.length, 3); assert.equal(f.row.status, 'ok', f.row.reasons.join());
  assert.deepEqual(fixed.coords, f.fixed.coords.map(p => p.slice(0, 2)));
  assert.deepEqual(fixed.frozen_catalog!.coords_xyz, f.fixed.coords); assert.deepEqual(fixed.provenance, f.fixed.provenance);
  assert.equal(f.row.segments.find(r => r.id === fixed.id)!.direction, 'reverse');
  assert.deepEqual(f.parent, saved); assert.deepEqual(f.fixed, savedFrozen); assert.doesNotThrow(() => graphNodes(f.adopted.segments));
  const again = adoptFrozenSegments(f.adopted.segments, [f.fixed]); assert.deepEqual(again.segments, f.adopted.segments);
});
test('frozen endpoints snap within one metre and leave distinct paths beyond that distance', () => {
  const f = fixture(), near = structuredClone(f.parent), far = structuredClone(f.parent);
  near.coords = near.coords.map(([x, y]) => [x, y + .000004]);
  far.coords = far.coords.map(([x, y]) => [x, y + .00003]);
  assert.ok(adoptFrozenSegments([near], [f.fixed]).audit.removed_length_m > 400);
  assert.equal(adoptFrozenSegments([far], [f.fixed]).audit.removed_length_m, 0);
});
test('one fixed segment replaces several old edges and forbids partial materialization and curated splits', () => {
  const f = fixture(), parts = splitSegment(f.parent, [-120.995, 47], 'forward').segments;
  const result = adoptFrozenSegments(parts, [f.fixed]);
  assert.equal(result.segments.filter(s => s.id === f.fixed.id).length, 1);
  assert.equal(result.audit.fixed[0].replaced_ids.length, 2);
  const fixed = result.segments.find(s => s.id === f.fixed.id)!;
  assert.throws(() => splitSegment(fixed, [-120.995, 47], 'forward'), /Cannot split frozen/);
  const router = new TrailRouter(result.segments), walk = router.route([-121, 47], [-120.995, 47], { includeFeatures: false }).segments;
  const draft = { row: { ...f.row, segments: [], reasons: [] }, walk };
  materialize([draft], new Map(result.segments.map(s => [s.id, s])));
  assert.equal(draft.row.status, 'needs_geometry'); assert.match(draft.row.reasons.join(), /cannot cut frozen/);
});
test('frozen pending pieces bind by exact ID/XY without a reviewed-route flag; mismatches block', () => {
  const f = fixture(), s = f.byId.get(f.fixed.id)!;
  const overlap: ExistingOverlap = { new_id: s.id, id: s.id, name: s.name, display_name: null, description: null, kind: null, trail_names: s.trail_names, provenance: s.provenance,
    path: { type: 'LineString', coordinates: f.fixed.coords }, coverage: 1, routes: [{ id: 'frozen-route', reviewed: false, status: 'pending' }] };
  const good = bindExistingSegments(f.row, f.byId, [overlap], new Set(), new Set());
  assert.ok(good.reused.includes(s.id)); assert.deepEqual(good.blocked, []);
  const bad = bindExistingSegments(f.row, f.byId, [{ ...overlap, path: { ...overlap.path, coordinates: f.fixed.coords.slice(1) } }], new Set(), new Set());
  assert.match(bad.blocked.join(), /snapshot does not match/);
});
test('an internal frozen junction keeps the correct route visible but cannot yield a writable partial asset', () => {
  const f = fixture(), branch = refresh({ ...f.parent, id: '', coords: [[-120.995, 47], [-120.995, 47.001]], node_ids: ['b', 'branch'], osm_edge_way_ids: [11] });
  const graph = adoptFrozenSegments([f.parent, branch], [f.fixed]).segments, router = new TrailRouter(graph);
  const fixed = graph.find(s => s.frozen_catalog)!;
  assert.equal(graphNodes(graph).find(n => n.id === fixed.node_ids[1])!.degree, 3);
  const walk = router.route([-121, 47], [-120.995, 47.001], { includeFeatures: false }).segments;
  assert.ok(walk.some(s => s.segment_id === f.fixed.id && s.start_vertex === 2 && s.end_vertex === 1));
  const draft = { row: { ...structuredClone(f.row), reasons: [] }, walk }, segments = materialize([draft], new Map(graph.map(s => [s.id, s])));
  assert.equal(draft.row.status, 'needs_geometry'); assert.ok(draft.row.segments.length > 0);
  assert.ok(segments.some(s => s.frozen_partial));
  assert.throws(() => segmentValues(segments.find(s => s.frozen_partial)!), /not insertable/);
  assert.throws(() => segmentValues(graph.find(s => s.frozen_catalog)!), /not insertable/);
  draft.row.status = 'ok'; finalizeRows([draft.row], segments);
  assert.match(planRoute(draft.row, new Map(segments.map(s => [s.id, s])), { includeReview: true }).skipped!, /review-only/);
});
test('loader reuses fixed assets, verifies full XYZ and preserves per-source elevation lineage', async () => {
  const f = fixture(), plan = planRoute(f.row, f.byId, { elevation: true });
  assert.equal(plan.skipped, undefined); assert.ok(plan.reused_segment_ids.includes(f.fixed.id));
  assert.ok(!plan.statements.some(s => ['segment_insert', 'elevation_segment_update'].includes(s.kind) && s.values[0] === f.fixed.id));
  assert.match(plan.statements.find(s => s.kind === 'frozen_segment_guard')!.sql, /ST_AsEWKB/);
  const metadata = plan.statements.find(s => s.kind === 'elevation_route_metadata')!.sql;
  assert.match(metadata, /wa_catalog_union_provenance/); assert.doesNotMatch(metadata, /wa_catalog_provenance_elevation/);
  const inserted = JSON.parse(plan.statements.find(s => s.kind === 'route_insert')!.values[5] as string);
  const { wa_catalog, ...rights } = inserted;
  assert.ok(validSource(rights)); assert.deepEqual(rights, withoutElevation(f.row.provenance!));
  assert.ok(sourceLeaves(rights).every(p => !('elevation_source' in p)), 'binding strips elevation from every leaf, not only the header');
  const calls: string[] = [];
  await assert.rejects(() => executePlan({ query: async (sql: string) => { calls.push(sql); return { rows: [{ valid: !sql.includes('ST_AsEWKB') }], rowCount: 1 }; } } as any, plan, f.byId, '.', async points => points.map(() => 100)), /frozen_segment_guard/);
  assert.equal(calls.at(-1), 'ROLLBACK');
});
test('legacy tails stay unnamed despite old route aliases unless curated; timelines join them to the preceding stretch', () => {
  const f = fixture(), s = f.segments.find(s => !s.frozen_catalog)!;
  s.legacy_tail = { route_id: 'legacy', source_hash: 'x', attachment_gap_m: 0 }; s.trail_names = ['Old Route Name']; s.display_name = 'Old Route Name';
  const row = structuredClone(f.row); row.segments = [f.row.segments.find(r => r.id === f.fixed.id)!, f.row.segments.find(r => r.id === s.id)!];
  applyCuration([row], f.segments, { routes: [] }, [], []);
  assert.equal(s.display_name, null); assert.equal(row.stretches!.length, 1);
  applyCuration([row], f.segments, { routes: [{ route: row.name, stretches: [{ display_name: 'Curated Snowfield', kind: 'snowfield', segments: [s.id] }] }] }, [], []);
  assert.equal(s.display_name, 'Curated Snowfield');
});
test('resolved fire lookouts use destination contact rules and traverses link the far trailhead as objective', () => {
  const f = fixture(); f.row.kind = 'summit';
  alignSummitKind(f.row, { id: 'lake', name: 'Lookout', features: ['fire-lookout'], lng: -120.99, lat: 47 });
  assert.equal(f.row.kind, 'destination');
  f.row.kind = 'traverse'; f.row.objective = null; f.row.end_trailhead = { peaks_id: 'far' }; alignTraverseObjective(f.row);
  assert.deepEqual(f.row.objective, { peaks_id: 'far' });
  f.row.objective = { peaks_id: 'intermediate-objective' }; alignTraverseObjective(f.row); assert.equal(f.row.objective.peaks_id, 'intermediate-objective');
});
