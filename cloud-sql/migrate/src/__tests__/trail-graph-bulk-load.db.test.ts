import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { Client } from 'pg';
import { Composer, catalogRouteId, digest, materialize } from '../trail-graph/compose';
import { activateBulkBatch, bulkPreflightValues, buildBulkBatch, loadIsolated, planBulkBatch } from '../trail-graph/load-bulk';
import { readBulkPreflight } from '../trail-graph/load-bulk-preflight';
import { provenance, refresh } from '../trail-graph/topology';
import type { CatalogInputs, ComposedRoute } from '../trail-graph/catalog-types';
import type { Segment } from '../trail-graph/types';

// Needs the migration operator (Cloud SQL `postgres`, or a container superuser)
// on a disposable *_test database provisioned with schema.sql + migrations/,
// including 20261015_segment_model_v2.sql and 20261016-20261018. The suite runs
// inside one transaction and rolls it back; the loader's own BEGIN/COMMIT map
// to savepoints, so nothing it writes outlives the run.
const URL_ENV = process.env.BULK_LOAD_TEST_DATABASE_URL;
const skip = URL_ENV ? undefined : 'BULK_LOAD_TEST_DATABASE_URL not set - skipping bulk catalog DB tests';
const ROUTES = Number(process.env.BULK_LOAD_TEST_ROUTES ?? '20');
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

function fixtureRows(count: number) {
  const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/wa-compose.json'), 'utf8'));
  const segment = refresh({ id: '', name: 'River Trail', trail_names: ['River Trail'], kind: 'trail', sac_scale: null, trail_visibility: null,
    osm_way_ids: [10], osm_edge_way_ids: [10, 10], relations: [], relation_names: [], start_node: '', end_node: '',
    coords: [[-121, 47], [-120.995, 47], [-120.99, 47]], node_ids: ['1', '2', '3'], length_m: 0,
    provenance: provenance([10], '2026-10-15T00:00:00Z'), alt_sources: [] } as Segment);
  const input: CatalogInputs = { ...structuredClone(fixture), seeds: [fixture.seed], segments: [segment], routes: [], popularity: [] };
  const composer = new Composer(input), draft = composer.compose(fixture.seed, 0);
  assert.equal(draft.row.status, 'ok', draft.row.reasons.join());
  const source = new Map(materialize([draft], composer.byId).map(s => [s.id, s]));
  const rows = Array.from({ length: count }, (_, i) => {
    const row: ComposedRoute = structuredClone(draft.row); row.name += ` ${run} ${i}`; row.seed_index = i;
    row.composition_hash = digest({ ...row, route_id: undefined, composition_hash: undefined }); row.route_id = catalogRouteId(row);
    return row;
  });
  return { rows, source, destinations: fixture.destinations as { id: string; name: string; features: string[]; lng: number; lat: number }[] };
}
const profiles = (segments: Map<string, Segment>) =>
  new Map([...segments].map(([id, s]) => [id, s.coords.map(([x, y], i) => [x, y, 1200 + i * 35])]));

const DERIVED = `SELECT r.id,r.search_name,r.slug,r.difficulty,r.est_moving_seconds,r.elevation_string,
  ARRAY(SELECT a.area_id||':'||a.relation FROM route_areas a WHERE a.route_id=r.id AND a.source='postgis' ORDER BY a.area_id) AS areas
  FROM routes r WHERE r.id=ANY($1::text[]) ORDER BY r.id`;

describe('bulk catalog load against a disposable database', { skip }, () => {
  let client: Client;
  const timings: Record<string, number> = {};
  // Savepoints stand in for the loader's transactions inside the suite's own.
  const loaderClient = () => ({ query: async (sql: string, values?: unknown[]) => {
    const mapped = sql === 'BEGIN' ? 'SAVEPOINT bulk_batch' : sql === 'COMMIT' ? 'RELEASE SAVEPOINT bulk_batch'
      : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT bulk_batch' : sql;
    const started = performance.now();
    try { return await client.query(mapped, values); }
    finally { const key = sql.split(/\s+/).slice(0, 3).join(' '); timings[key] = (timings[key] ?? 0) + performance.now() - started; }
  } });

  before(async () => {
    assert.match(new URL(URL_ENV!).pathname, /_test$/, 'bulk DB tests require a disposable *_test database');
    client = new Client({ connectionString: URL_ENV }); await client.connect();
    const name = (await client.query('SELECT current_database() AS name')).rows[0].name as string;
    assert.match(name, /_test$/);
    await client.query('BEGIN');
    const { destinations } = fixtureRows(1);
    for (const d of destinations.filter(d => d.id !== 'far-lake')) {
      await client.query(`INSERT INTO destinations(id,name,search_name,features,location,owner,state_code,country_code)
        VALUES($1,$2,peaks_search_name($2),$3::destination_feature[],ST_SetSRID(ST_MakePoint($4,$5,1200),4326)::geography,'peaks','OR','US')
        ON CONFLICT(id) DO NOTHING`, [d.id, d.name, d.features, d.lng, d.lat]);
    }
    await client.query(`INSERT INTO areas(id,name,search_name,kind,designation,manager,owner,country_code,state_codes,source,source_id,source_version,
        boundary,centroid,bbox_min_lat,bbox_max_lat,bbox_min_lng,bbox_max_lng,metadata)
      VALUES($1,'Bulk Fixture Forest','bulk fixture forest','national_forest','National Forest','Fixture','Fixture','US',ARRAY['OR'],'test',$1,'test',
        ST_GeomFromText('SRID=4326;MULTIPOLYGON(((-121.1 46.9,-120.9 46.9,-120.9 47.1,-121.1 47.1,-121.1 46.9)))'),
        ST_GeomFromText('SRID=4326;POINT(-121 47)'),46.9,47.1,-121.1,-120.9,'{}'::jsonb)`, [`bulk-area-${run}`]);
  });
  after(async () => { if (client) { await client.query('ROLLBACK').catch(() => undefined); await client.end(); } });

  test('the opt-out skips the four derivation triggers and only within its transaction', async () => {
    await client.query(`INSERT INTO routes(id,name,status,owner,shape,path) VALUES($1,'Opt Out Fixture','pending','peaks','out_and_back',
      ST_GeogFromText('SRID=4326;LINESTRING Z (-121 47 1200,-120.995 47 1235,-120.99 47 1270)'))`, [`bulk-optout-${run}`]);
    const read = async () => (await client.query(DERIVED, [[`bulk-optout-${run}`]])).rows[0];
    const normal = await read();
    assert.ok(normal.search_name && normal.difficulty && normal.est_moving_seconds && normal.elevation_string && normal.areas.length === 1, JSON.stringify(normal));
    await client.query('SAVEPOINT optout');
    await client.query("SET LOCAL peaks.defer_route_derivations = 'on'");
    await client.query(`DELETE FROM route_areas WHERE route_id=$1`, [`bulk-optout-${run}`]);
    await client.query(`UPDATE routes SET difficulty=NULL,est_moving_seconds=NULL,elevation_string=NULL,search_name=NULL WHERE id=$1`, [`bulk-optout-${run}`]);
    await client.query(`UPDATE routes SET path=ST_GeogFromText('SRID=4326;LINESTRING Z (-121 47 1200,-120.995 47 1240,-120.99 47 1290)'),name=name||' renamed' WHERE id=$1`, [`bulk-optout-${run}`]);
    const deferred = await read();
    assert.deepEqual([deferred.search_name, deferred.difficulty, deferred.est_moving_seconds, deferred.elevation_string, deferred.areas], [null, null, null, null, []]);
    await client.query(`SELECT refresh_route_derivations($1::text[])`, [[`bulk-optout-${run}`]]);
    const refreshed = await read();
    await client.query("SET LOCAL peaks.defer_route_derivations = 'off'");
    await client.query(`UPDATE routes SET path=path,name=name WHERE id=$1`, [`bulk-optout-${run}`]);
    assert.deepEqual(refreshed, await read(), 'refresh equals what the per-row triggers write');
    await client.query('RELEASE SAVEPOINT optout');
  });

  test(`a ${ROUTES}-route batch loads with both opt-outs, refreshes to per-row values, and re-runs as a no-op`, async () => {
    const { rows, source } = fixtureRows(ROUTES);
    const loader = loaderClient() as any;
    const live = await readBulkPreflight(loader, bulkPreflightValues(rows, source, 'OR'), false);
    const plan = planBulkBatch(rows, source, 'OR', live);
    assert.equal(plan.routes.length, ROUTES, JSON.stringify(plan.skipped));
    const batch = buildBulkBatch(plan, profiles(plan.segments));
    const started = performance.now();
    const results = await loadIsolated(loader, plan, profiles(plan.segments));
    const elapsed = performance.now() - started;
    assert.ok(results.every(r => r.success), JSON.stringify(results.filter(r => !r.success)));
    console.log(JSON.stringify({ bulk_batch_routes: ROUTES, statements: batch.statements.length, elapsed_ms: Math.round(elapsed),
      per_route_ms: Math.round(elapsed / ROUTES), by_statement_ms: Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, Math.round(v)])) }));

    const ids = batch.ids, bulk = (await client.query(DERIVED, [ids])).rows;
    assert.equal(bulk.length, ROUTES);
    assert.ok(bulk.every(r => r.difficulty && r.est_moving_seconds && r.elevation_string && r.search_name && r.areas.length === 1), JSON.stringify(bulk[0]));
    const stored = (await client.query(`SELECT count(*)::int AS n FROM routes WHERE id=ANY($1) AND state_code='OR' AND status='pending'
      AND provenance#>>'{wa_catalog,state_code}'='OR' AND gain IS NOT NULL AND path IS NOT NULL`, [ids])).rows[0].n;
    assert.equal(stored, ROUTES);
    await client.query('SAVEPOINT per_row');
    await client.query("SET LOCAL peaks.defer_route_derivations = 'off'");
    await client.query(`SET LOCAL peaks.defer_rematch = 'on'`);
    await client.query(`UPDATE routes SET path=path,name=name WHERE id=ANY($1)`, [ids]);
    assert.deepEqual((await client.query(DERIVED, [ids])).rows, bulk, 'refresh_route_derivations equals the per-row trigger path');
    await client.query('ROLLBACK TO SAVEPOINT per_row');

    const again = await readBulkPreflight(loader, bulkPreflightValues(rows, source, 'OR'), false);
    const rerun = planBulkBatch(rows, source, 'OR', again);
    assert.equal(rerun.routes.length, 0);
    assert.ok(rerun.skipped.every(s => s.skipped === 'already loaded'));
  });

  test('rebuild and activation wrappers capture a bad route without aborting the others', async () => {
    const { rows, source } = fixtureRows(3);
    const loader = loaderClient() as any;
    const plan = planBulkBatch(rows, source, 'OR', await readBulkPreflight(loader, bulkPreflightValues(rows, source, 'OR'), false));
    assert.ok((await loadIsolated(loader, plan, profiles(plan.segments))).every(r => r.success));
    const ids = plan.routes.map(r => r.id), bad = `or-bulk-bad-${run}`;
    await client.query(`INSERT INTO routes(id,name,status,owner,shape) VALUES($1,'Bad Fixture','pending','peaks','out_and_back')`, [bad]);
    const rebuilt = (await client.query(`SELECT rebuild_route_paths($1::text[]) AS r`, [[ids[0], bad, ids[1]]])).rows[0].r;
    assert.deepEqual(rebuilt.map((r: { success: boolean }) => r.success), [true, false, true]);
    assert.match(rebuilt[1].error, /no segments/);

    const activated = await activateBulkBatch(loader, [ids[0], bad, 'or-missing-route', ids[1], ids[2]], 'OR');
    assert.equal(activated.length, 5);
    assert.deepEqual(activated.filter(r => !r.success).map(r => r.route_id).slice(0, 2), [bad, 'or-missing-route']);
    const statuses = new Map((await client.query(`SELECT id,status FROM routes WHERE id=ANY($1)`, [[...ids, bad]])).rows.map(r => [r.id, r.status]));
    for (const r of activated) if (statuses.has(r.route_id)) assert.equal(statuses.get(r.route_id), r.success ? 'active' : 'pending', JSON.stringify(r));
    console.log(JSON.stringify({ activation: activated.map(({ route_id, success, error }) => ({ route_id, success, error })) }));
    await client.query('SAVEPOINT too_many');
    await assert.rejects(() => client.query(`SELECT activate_wa_catalog_routes($1::text[])`, [Array(201).fill(bad)]), /at most 200/);
    await client.query('ROLLBACK TO SAVEPOINT too_many');
  });
});
