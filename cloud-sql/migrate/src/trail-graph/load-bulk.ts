import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Client } from 'pg';
import { ndjson } from './io';
import { digest } from './compose';
import { planRoute, type RoutePlan, type Statement } from './load-catalog';
import { DestinationResolver, IMPORT_MARKER, osmExternalIds } from './load-matching';
import { readBulkPreflight, type BulkPreflight } from './load-bulk-preflight';
import { withoutElevation, sourceLeaves, unionProvenance, validSource } from './source-provenance';
import { sampleBulkSegments } from './bulk-elevation';
import { displayName } from './display-names';
import type { ComposedRoute, PlaceRef } from './catalog-types';
import type { Provenance, Segment } from './types';
import type { StateCode } from './state';

export type BulkState = Exclude<StateCode, 'WA'>;
export interface BulkOptions { dir: string; state: BulkState; apply?: boolean; activate?: boolean; batchSize?: number }
export interface BulkResult { route_id: string; state_code: BulkState; operation: 'load' | 'activate'; success: boolean; skipped?: string; error?: string; sqlstate?: string }
export interface BulkRoute { row: ComposedRoute; plan: RoutePlan; id: string; refs: { id: string; direction: 'forward' | 'reverse' }[] }
export interface BulkPlan { routes: BulkRoute[]; skipped: BulkResult[]; segments: Map<string, Segment>; compositionHashes: Map<string, string>; state: BulkState; live?: BulkPreflight }
export interface BulkBatch { ids: string[]; statements: Statement[] }
const ROOT_CACHE = resolve(__dirname, '../../../../.cache');
export const BULK_LOCK_SQL = "SELECT pg_advisory_lock(hashtextextended('wa_trail_catalog_loader',0))";
export const DEFER_DERIVATIONS_SQL = "SET LOCAL peaks.defer_route_derivations = 'on'";

/** Validate the original composition first, then give new assets a state namespace.
 * Frozen assets and existing destination IDs keep their original identity. */
export function bulkId(id: string, state: BulkState): string {
  return `${state.toLowerCase()}-${id.replace(/^(?:wa|or|ca|id)-/, '')}`;
}
export function batches<T>(rows: T[], size = 200): T[][] {
  if (!Number.isInteger(size) || size < 1 || size > 200) throw new Error('Bulk batch size must be 1–200');
  const result: T[][] = [];
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size));
  return result;
}
const placeRefs = (row: ComposedRoute): PlaceRef[] => [row.trailhead, row.objective, row.end_trailhead, ...row.waypoints].filter((p): p is PlaceRef => !!p);
const segmentId = (s: Segment, state: BulkState) => s.frozen_catalog ? s.id : bulkId(s.id, state);
export function bulkPreflightValues(rows: ComposedRoute[], source: Map<string, Segment>, state: BulkState): unknown[] {
  const validRows = rows.filter(r => r.status === 'ok');
  const segments = [...new Set(validRows.flatMap(r => r.segments.map(s => s.id)))].flatMap(id => {
    const s = source.get(id);
    // The planner records invalid compositions; do not send broken geometry to
    // PostGIS before it can report the row's own error.
    if (!s || s.coords.length < 2 || s.coords.some(p => !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) return [];
    return [{ id: segmentId(s, state), geometry: JSON.stringify({ type: 'LineString', coordinates: s.coords }), frozen: !!s.frozen_catalog }];
  });
  const places = validRows.flatMap(placeRefs).flatMap(p => p.new && Number.isFinite(p.new.lng) && Number.isFinite(p.new.lat) ? [{ lng: p.new.lng, lat: p.new.lat, external_ids: osmExternalIds(p.new.source.osm_id) }] : []);
  return [JSON.stringify(segments), validRows.map(r => bulkId(r.route_id ?? '', state)), JSON.stringify(places), IMPORT_MARKER, validRows.flatMap(placeRefs).flatMap(p => p.peaks_id ? [p.peaks_id] : []), state];
}

export function planBulkBatch(rows: ComposedRoute[], source: Map<string, Segment>, state: BulkState, live?: BulkPreflight): BulkPlan {
  if (!['OR','CA','ID'].includes(state)) throw new Error('--bulk requires --state OR|CA|ID');
  const result: BulkPlan = { routes: [], skipped: [], segments: new Map(), compositionHashes: new Map(), state, live };
  const resolver = new DestinationResolver(live?.destinations ?? [], state);
  const existing = new Map(live?.routes.map(r => [r.id, r]));
  const overlaps = new Set(live?.overlaps.map(o => o.new_id));
  for (const row of rows) {
    const id = bulkId(row.route_id ?? '', state);
    const skip = (reason: string) => result.skipped.push({ route_id: id, state_code: state, operation: 'load', success: false, skipped: reason });
    try {
      const plan = planRoute(row, source, { resolver, stateCode: state, onlyOk: true, livePreflight: !!live });
      if (plan.skipped) { skip(plan.skipped); continue; }
      result.compositionHashes.set(id, row.composition_hash!);
      if (existing.has(id)) { skip('already loaded'); continue; }
      if (result.routes.some(r => r.id === id)) { skip('duplicate composition'); continue; }
      if (plan.segment_ids.some(id => source.get(id)?.legacy_tail)) { skip('legacy rebase is not supported in bulk mode'); continue; }
      const refs = row.segments.map(ref => ({ ...ref, id: segmentId(source.get(ref.id)!, state) }));
      if (refs.some(ref => overlaps.has(ref.id))) { skip('overlaps existing Peaks route'); continue; }
      for (const originalId of plan.segment_ids) {
        const segment = source.get(originalId)!;
        if (!validSource(segment.provenance)) throw new Error(`Invalid source provenance ${originalId}`);
        result.segments.set(segmentId(segment, state), { ...segment, id: segmentId(segment, state) });
      }
      result.routes.push({ row, plan, id, refs });
    } catch (error) { skip(`invalid plan: ${(error as Error).message}`); }
  }
  // A resolver can dedupe a later row to a new place first seen in a skipped row.
  // Its returned refs retain the new place, so admitted plans still insert it.
  const used = new Set(result.routes.flatMap(r => r.refs.map(ref => ref.id)));
  for (const id of result.segments.keys()) if (!used.has(id)) result.segments.delete(id);
  return result;
}

function elevated(provenance: Provenance): Provenance {
  return unionProvenance(sourceLeaves(withoutElevation(provenance)).map(p => ({ ...p, elevation_source: 'terrarium_z14', elevation_profile: 'terrain' })));
}
function statement(kind: string, sql: string, rows: unknown[]): Statement { return { kind, sql, values: [JSON.stringify(rows)] }; }

/** Each collection is sent once, even when empty. No per-route SQL is emitted. */
export function buildBulkBatch(plan: BulkPlan, profiles?: Map<string, number[][]>): BulkBatch {
  const { state } = plan, stored = new Map(plan.live?.segments.map(s => [s.id, s]));
  const places = new Map<string, Record<string, unknown>>(), segments: Record<string, unknown>[] = [], checks: Record<string, unknown>[] = [];
  const routes: Record<string, unknown>[] = [], links: Record<string, unknown>[] = [], destinations: Record<string, unknown>[] = [];
  const provenances = new Map<string, Provenance>();
  for (const s of plan.segments.values()) {
    const old = stored.get(s.id);
    if (old && !old.complete) throw new Error(`Existing segment lacks usable elevation: ${s.id}`);
    if (s.frozen_catalog && plan.live && !old) throw new Error(`Frozen segment is missing: ${s.id}`);
    const xyz = old?.path.coordinates ?? profiles?.get(s.id) ?? s.frozen_catalog?.coords_xyz ?? s.coords.map(([x,y]) => [x,y,0]);
    if (profiles && (xyz.length !== s.coords.length || xyz.some((p,i) => Math.abs(p[0]-s.coords[i][0]) >= 1e-9 || Math.abs(p[1]-s.coords[i][1]) >= 1e-9 || p.length !== 3 || !p.every(Number.isFinite) || p[2] === 0 || p[2] < -500 || p[2] > 9000))) throw new Error(`Incomplete/invalid elevation profile ${s.id}`);
    const rights = s.frozen_catalog ? s.provenance : elevated(s.provenance);
    const provenance = old?.provenance ?? { ...rights, wa_catalog: { loader: IMPORT_MARKER, state_code: state, ...(s.summit_connector ? { notes: ['summit connector'] } : {}) } };
    provenances.set(s.id, provenance);
    const record = { id: s.id, name: s.name, display_name: s.display_name === undefined ? displayName(s.trail_names[0] || s.relation_names[0] || null) : s.display_name,
      description: s.description ?? null, kind: s.kind, state_code: state, trail_names: s.trail_names, distance: s.length_m,
      geometry: JSON.stringify({ type: 'LineString', coordinates: xyz }), provenance };
    checks.push({ ...record, geometry: JSON.stringify({ type: 'LineString', coordinates: s.frozen_catalog?.coords_xyz ?? s.coords }),
      frozen: !!s.frozen_catalog, old_path_hash: old?.path_hash ?? null, expected_source: withoutElevation(s.provenance) });
    if (!old && !s.frozen_catalog) segments.push(record);
  }
  for (const route of plan.routes) {
    const insert = route.plan.statements.find(s => s.kind === 'route_insert')!, v = insert.values;
    for (const p of route.plan.statements.filter(s => s.kind === 'destination_insert')) {
      const d = p.values;
      const metadata = JSON.parse(d[7] as string); metadata.provenance.wa_catalog.state_code = state;
      places.set(d[0] as string, { id: d[0], name: d[1], feature: d[2], lng: d[3], lat: d[4], z: d[5], elevation: d[6], metadata,
        external_ids: JSON.parse(d[8] as string), boundary: d[9], state_code: state });
    }
    const original = JSON.parse(v[5] as string), provenance = { ...unionProvenance(route.refs.map(ref => provenances.get(ref.id)!)),
      wa_catalog: { ...original.wa_catalog, state_code: state, loaded_binding_hash: digest(route.refs) } };
    routes.push({ id: route.id, name: v[1], kind: v[2], aliases: v[3], external_links: JSON.parse(v[4] as string), provenance, shape: v[6], trailhead: v[7], objective: v[8], state_code: state });
    route.refs.forEach((ref, ordinal) => links.push({ route_id: route.id, segment_id: ref.id, ordinal, direction: ref.direction }));
    route.plan.destination_ids.forEach((id, ordinal) => destinations.push({ route_id: route.id, destination_id: id, ordinal }));
  }
  const ids = routes.map(r => r.id as string);
  return { ids, statements: [
    { kind: 'begin', sql: 'BEGIN', values: [] },
    { kind: 'defer_rematch', sql: "SET LOCAL peaks.defer_rematch = 'on'", values: [] },
    { kind: 'timeouts', sql: TIMEOUTS_SQL, values: [] },
    { kind: 'defer_derivations', sql: DEFER_DERIVATIONS_SQL, values: [] },
    statement('destination_insert', `INSERT INTO destinations(id,name,search_name,features,activities,state_code,country_code,location,elevation,metadata,external_ids,boundary)
      SELECT d.id,d.name,peaks_search_name(d.name),ARRAY[d.feature]::destination_feature[],ARRAY['outdoor-trek']::activity_type[],d.state_code,'US',
        ST_SetSRID(ST_MakePoint(d.lng,d.lat,d.z),4326)::geography,d.elevation,d.metadata,d.external_ids,
        CASE WHEN d.boundary IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON(d.boundary),4326)::geography END
      FROM jsonb_to_recordset($1::jsonb) AS d(id text,name text,feature text,state_code text,lng float8,lat float8,z float8,elevation float8,metadata jsonb,external_ids jsonb,boundary text)
      ON CONFLICT(id) DO NOTHING`, [...places.values()]),
    statement('segment_insert', `INSERT INTO segments(id,name,display_name,kind,state_code,trail_names,path,distance,gain,gain_loss,provenance,description,description_source_url)
      SELECT s.id,s.name,s.display_name,s.kind,s.state_code,s.trail_names,p.path,s.distance,stats.gain,stats.loss,s.provenance,s.description,NULL
      FROM jsonb_to_recordset($1::jsonb) AS s(id text,name text,display_name text,kind text,state_code text,trail_names text[],geometry text,distance float8,provenance jsonb,description text)
      CROSS JOIN LATERAL (SELECT ST_SetSRID(ST_GeomFromGeoJSON(s.geometry),4326)::geography AS path) p
      CROSS JOIN LATERAL route_elevation_stats(p.path) stats ON CONFLICT(id) DO NOTHING`, segments),
    statement('route_insert', `INSERT INTO routes(id,name,status,owner,kind,slug,search_name,aliases,state_code,country_code,external_links,provenance,shape,trailhead_destination_id,objective_destination_id,description,
        elevation_source,elevation_source_url,elevation_attribution,elevation_license_url,elevation_retrieved_at)
      SELECT r.id,r.name,'pending','peaks',r.kind,peaks_route_catalog_slug(r.name,r.id),peaks_search_name(r.name),r.aliases,r.state_code,'US',r.external_links,r.provenance,r.shape::route_shape,r.trailhead,r.objective,NULL,
        'segment_profiles','https://registry.opendata.aws/terrain-tiles/','Mapzen / AWS Open Data Terrain Tiles','https://github.com/tilezen/joerd/blob/master/docs/attribution.md',now()
      FROM jsonb_to_recordset($1::jsonb) AS r(id text,name text,kind text,aliases text[],state_code text,external_links jsonb,provenance jsonb,shape text,trailhead text,objective text)
      ON CONFLICT(id) DO NOTHING RETURNING id`, routes),
    statement('route_segment_insert', `INSERT INTO route_segments(route_id,segment_id,ordinal,direction)
      SELECT route_id,segment_id,ordinal,direction FROM jsonb_to_recordset($1::jsonb) AS l(route_id text,segment_id text,ordinal int,direction text)
      ORDER BY route_id,ordinal ON CONFLICT DO NOTHING`, links),
    statement('route_destination_insert', `INSERT INTO route_destinations(route_id,destination_id,ordinal)
      SELECT route_id,destination_id,ordinal FROM jsonb_to_recordset($1::jsonb) AS l(route_id text,destination_id text,ordinal int)
      ORDER BY route_id,ordinal ON CONFLICT DO NOTHING`, destinations),
    { kind: 'binding_guard', sql: `WITH locked_segments AS MATERIALIZED (
        SELECT s.* FROM segments s WHERE s.id IN (SELECT item->>'id' FROM jsonb_array_elements($1::jsonb) item) ORDER BY s.id FOR SHARE OF s
      ) SELECT NOT EXISTS(SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS expected(id text,name text,display_name text,kind text,description text,geometry text,expected_source jsonb,provenance jsonb,frozen boolean,old_path_hash text)
        LEFT JOIN locked_segments s ON s.id=expected.id WHERE s.id IS NULL
        OR s.name IS DISTINCT FROM expected.name OR s.display_name IS DISTINCT FROM expected.display_name OR s.kind IS DISTINCT FROM expected.kind OR s.description IS DISTINCT FROM expected.description
        OR (wa_catalog_provenance_elevation(s.provenance,'{}'::jsonb)-'wa_catalog') IS DISTINCT FROM expected.expected_source
        OR s.provenance IS DISTINCT FROM expected.provenance
        OR (expected.old_path_hash IS NOT NULL AND md5(ST_AsEWKB(s.path::geometry)) IS DISTINCT FROM expected.old_path_hash)
        OR NOT COALESCE(ST_OrderingEquals(ST_Force2D(s.path::geometry),ST_Force2D(ST_GeomFromGeoJSON(expected.geometry))),false)
        OR (expected.frozen AND ST_AsEWKB(s.path::geometry) IS DISTINCT FROM ST_AsEWKB(ST_SetSRID(ST_GeomFromGeoJSON(expected.geometry),4326)))
        OR s.gain IS NULL OR s.gain_loss IS NULL OR EXISTS(SELECT 1 FROM ST_DumpPoints(s.path::geometry) p WHERE ST_Z((p).geom) IS NULL OR ST_Z((p).geom)=0 OR NOT(ST_Z((p).geom) BETWEEN -500 AND 9000)))
      AND NOT EXISTS(SELECT 1 FROM routes r WHERE r.id=ANY($2::text[]) AND (
        EXISTS(SELECT 1 FROM trail_catalog_review_jobs WHERE route_id=r.id) OR EXISTS(SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=r.id))) AS valid`, values: [JSON.stringify(checks), ids] },
    { kind: 'rebuild', sql: 'SELECT rebuild_route_paths($1::text[]) AS results', values: [ids] },
    { kind: 'refresh', sql: 'SELECT refresh_route_derivations($1::text[])', values: [ids] },
    { kind: 'commit', sql: 'COMMIT', values: [] },
  ] };
}

/** The database shares one vCPU with the live API: no statement or lock wait may run long. */
export const TIMEOUTS_SQL = "SELECT set_config('statement_timeout','180s',true), set_config('lock_timeout','10s',true)";

/** Errors no single route causes. Stop the run instead of splitting the batch into hundreds of retries. */
export function fatalBulkError(error: unknown): boolean {
  const code = (error as { code?: string }).code ?? '';
  return code === '42501' || code === '57014' || code === '55P03' || /^(08|53|57P)/.test(code) || /Connection terminated|ECONNRESET|ECONNREFUSED/.test((error as Error).message ?? '');
}

/** A rebuild failure names the routes that failed; the rest of the batch may retry. */
export class BulkRebuildError extends Error {
  constructor(public readonly failures: { route_id: string; error?: string; sqlstate?: string }[]) {
    super(`Path rebuild failed: ${JSON.stringify(failures)}`);
  }
}

export async function executeBulkBatch(client: Pick<Client, 'query'>, batch: BulkBatch): Promise<void> {
  if (!batch.ids.length) return;
  try {
    for (const step of batch.statements) {
      const response = await client.query(step.sql, step.values);
      if (step.kind === 'route_insert' && response.rowCount !== batch.ids.length) throw new Error('Route IDs changed after preflight; batch rolled back');
      if (step.kind === 'binding_guard' && response.rows[0]?.valid !== true) throw new Error('Stored segment binding, elevation or review guard failed');
      if (step.kind === 'rebuild') {
        const results = response.rows[0]?.results as { route_id: string; success: boolean; error?: string; sqlstate?: string }[] | undefined;
        if (!results || results.length !== batch.ids.length) throw new Error(`Path rebuild returned an incomplete result list: ${JSON.stringify(results)}`);
        const failures = results.filter(r => !r.success);
        if (failures.length) throw new BulkRebuildError(failures.map(({ route_id, error, sqlstate }) => ({ route_id, error, sqlstate })));
      }
    }
  } catch (error) { try { await client.query('ROLLBACK'); } catch { /* Retain the batch error. */ } throw error; }
}

/** The same plan narrowed to some of its routes, keeping only the segments they use. */
export function subPlan(plan: BulkPlan, routes: BulkRoute[]): BulkPlan {
  const used = new Set(routes.flatMap(r => r.refs.map(ref => ref.id)));
  return { ...plan, routes, segments: new Map([...plan.segments].filter(([id]) => used.has(id))) };
}

/**
 * Commit what can commit. A rebuild failure drops the named routes and retries
 * the rest once per failure set; any other failure splits the batch in half
 * until the failing route stands alone. One bad route never strands 199 others,
 * and a clean batch still costs exactly one transaction.
 */
export async function loadIsolated(client: Pick<Client, 'query'>, plan: BulkPlan, profiles: Map<string, number[][]>): Promise<BulkResult[]> {
  const result = (id: string, error?: string, sqlstate?: string): BulkResult =>
    ({ route_id: id, state_code: plan.state, operation: 'load', success: !error, ...(error ? { error } : {}), ...(sqlstate ? { sqlstate } : {}) });
  if (!plan.routes.length) return [];
  try {
    await executeBulkBatch(client, buildBulkBatch(plan, profiles));
    return plan.routes.map(r => result(r.id));
  } catch (error) {
    if (error instanceof BulkRebuildError) {
      const failed = new Map(error.failures.map(f => [f.route_id, f]));
      const rest = plan.routes.filter(r => !failed.has(r.id));
      if (rest.length < plan.routes.length) {
        return [...error.failures.map(f => result(f.route_id, `path rebuild failed: ${f.error ?? 'unknown error'}`, f.sqlstate)),
          ...await loadIsolated(client, subPlan(plan, rest), profiles)];
      }
    }
    if (fatalBulkError(error)) throw error;
    const message = (error as Error).message;
    if (plan.routes.length === 1) return [result(plan.routes[0].id, message)];
    const half = Math.ceil(plan.routes.length / 2);
    return [...await loadIsolated(client, subPlan(plan, plan.routes.slice(0, half)), profiles),
      ...await loadIsolated(client, subPlan(plan, plan.routes.slice(half)), profiles)];
  }
}

export async function activateBulkBatch(client: Pick<Client, 'query'>, ids: string[], state: BulkState): Promise<BulkResult[]> {
  if (ids.length > 50) throw new Error('Activation batch exceeds 50 routes');
  if (!ids.length) return [];
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL peaks.defer_rematch = 'on'");
    await client.query(TIMEOUTS_SQL);
    const response = await client.query('SELECT activate_wa_catalog_routes($1::text[]) AS results', [ids]);
    const results = response.rows[0]?.results as { route_id: string; success: boolean; error?: string; sqlstate?: string }[] | undefined;
    if (!results || results.length !== ids.length) throw new Error('Activation returned an incomplete result list');
    await client.query('COMMIT');
    return results.map(r => ({ ...r, state_code: state, operation: 'activate' }));
  } catch (error) { try { await client.query('ROLLBACK'); } catch { /* Retain the activation error. */ } throw error; }
}

export function planBulkActivation(plan: BulkPlan): { ids: string[]; skipped: BulkResult[] } {
  if (!plan.live) return { ids: plan.routes.map(r => r.id), skipped: plan.skipped.map(r => ({ ...r, operation: 'activate' })) };
  const stored = new Map(plan.live.routes.map(r => [r.id, r]));
  const ids: string[] = [], skipped: BulkResult[] = [];
  for (const route of plan.routes) skipped.push({ route_id: route.id, state_code: plan.state, operation: 'activate', success: false, skipped: 'route is not loaded' });
  for (const route of plan.skipped) {
    const old = stored.get(route.route_id);
    if (route.skipped !== 'already loaded' || !old) { skipped.push({ ...route, operation: 'activate' }); continue; }
    let reason: string | undefined;
    if (old.reviewed) reason = 'catalog review/candidate route is protected';
    else if (old.loader !== IMPORT_MARKER || old.state_code !== plan.state) reason = 'existing route is not owned by this loader and state';
    else if (old.status !== 'pending') reason = `route is already ${old.status}`;
    else if (old.composition_hash !== plan.compositionHashes.get(route.route_id)) reason = 'stored composition differs';
    if (reason) skipped.push({ ...route, operation: 'activate', skipped: reason });
    else ids.push(route.route_id);
  }
  return { ids: [...new Set(ids)], skipped };
}

export async function runLoadBulkBatch(client: Pick<Client, 'query'>, plan: BulkPlan, cacheDir: string, sample: typeof sampleBulkSegments = sampleBulkSegments): Promise<BulkResult[]> {
  if (!plan.routes.length) return [];
  const stored = new Set(plan.live?.segments.map(s => s.id));
  // Fetch/decode every needed tile before BEGIN. Stored/frozen XYZ is reused.
  const profiles = await sample([...plan.segments.values()].filter(s => !stored.has(s.id)), { cacheDir, concurrency: 8 });
  const missing = (route: BulkRoute) => route.refs.find(ref => !stored.has(ref.id) && !profiles.has(ref.id))?.id;
  const failed = plan.routes.filter(missing);
  const failures: BulkResult[] = failed.map(route => ({ route_id: route.id, state_code: plan.state, operation: 'load', success: false,
    error: `Incomplete/invalid elevation profile for segment ${missing(route)}` }));
  const rest = plan.routes.filter(route => !missing(route));
  return [...failures, ...(rest.length ? await loadIsolated(client, subPlan(plan, rest), profiles) : [])];
}

async function readRows<T>(file: string): Promise<T[]> { const result: T[] = []; for await (const row of ndjson<T>(file)) result.push(row); return result; }
/** Osmosis .poly (the boundary Geofabrik cut the state extract with): outer rings, then holes marked "!". */
export function parsePoly(text: string): { outer: [number, number][][]; holes: [number, number][][] } {
  const outer: [number, number][][] = [], holes: [number, number][][] = [];
  let ring: [number, number][] | null = null, hole = false;
  for (const line of text.split('\n').slice(1).map(l => l.trim()).filter(Boolean)) {
    if (line === 'END') { if (ring) { (hole ? holes : outer).push(ring); ring = null; } continue; }
    if (!ring) { ring = []; hole = line.startsWith('!'); continue; }
    const [x, y] = line.split(/\s+/).map(Number); ring.push([x, y]);
  }
  return { outer, holes };
}
function inRing([x, y]: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function insidePoly(p: [number, number], poly: ReturnType<typeof parsePoly>): boolean {
  return poly.outer.some(r => inRing(p, r)) && !poly.holes.some(r => inRing(p, r));
}

export async function loadBulk(options: BulkOptions): Promise<void> {
  const { state, dir } = options, size = options.batchSize ?? 50;
  if (!['OR','CA','ID'].includes(state)) throw new Error('--bulk requires --state OR|CA|ID');
  batches([], size);
  if (options.apply && !process.env.DATABASE_URL) throw new Error('--apply requires DATABASE_URL');
  const source = new Map((await readRows<Segment>(join(dir,'segments.ndjson'))).map(s => [s.id,s]));
  const allRows = await readRows<ComposedRoute>(join(dir,'routes.ndjson'));
  // State graphs keep lines that touch a buffered box, so a neighbour's trail can
  // compose here. Load a discovered route only from the state its start lies in.
  const boundaryFile = process.env.BULK_BOUNDARY_FILE || join(ROOT_CACHE,state.toLowerCase(),'boundary.poly');
  const boundary = await readFile(boundaryFile,'utf8').then(parsePoly).catch(() => null);
  if (options.apply && !boundary) throw new Error(`--apply requires the state boundary at ${boundaryFile}`);
  const start = (r: ComposedRoute) => (r as { route_start?: [number, number] }).route_start;
  const outside = boundary ? allRows.filter(r => { const p = start(r); return !!p && !insidePoly(p, boundary); }) : [];
  const outsideSet = new Set(outside), rows = boundary ? allRows.filter(r => !outsideSet.has(r)) : allRows;
  // Most popular first, so an interrupted overnight load has published the hikes people look for.
  rows.sort((a, b) => ((b as { popularity?: number }).popularity ?? 0) - ((a as { popularity?: number }).popularity ?? 0));
  const report = { mode: options.apply ? 'apply' : 'dry-run', state_code: state, operation: options.activate ? 'activate' : 'load', input_routes: allRows.length, outside_state: outside.length,
    planned_routes: 0, successful_routes: 0, failed_routes: 0, skipped_routes: 0, batches: 0, statements_per_load_batch: 12,
    skipped_reasons: {} as Record<string, number>, planned_route_ids: [] as string[],
    preflight: options.apply ? 'one live read-only query per batch' : 'unverified: dry-run opens no database and fetches no tiles' };
  const resultsDir = join(ROOT_CACHE,state.toLowerCase()), resultsFile = join(resultsDir,'bulk-results.ndjson');
  let client: Client | undefined;
  const record = async (results: BulkResult[]) => {
    for (const result of results) {
      if (result.skipped) { report.skipped_routes++; report.skipped_reasons[result.skipped] = (report.skipped_reasons[result.skipped] ?? 0)+1; }
      else if (result.success) report.successful_routes++; else report.failed_routes++;
    }
    if (options.apply && results.length) { await mkdir(resultsDir,{recursive:true}); await appendFile(resultsFile,results.map(r => JSON.stringify({ ...r, timestamp: new Date().toISOString() })+'\n').join('')); }
  };
  try {
    if (options.apply) {
      const pg = await import('pg'); client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
      // Shared with the existing WA loader/activation function; released on close.
      await client.query(BULK_LOCK_SQL);
    }
    for (const input of batches(rows,size)) {
      report.batches++;
      const live = client ? await readBulkPreflight(client,bulkPreflightValues(input,source,state),!!options.activate) : undefined;
      const plan = planBulkBatch(input,source,state,live);
      if (options.activate) {
        const { ids, skipped } = planBulkActivation(plan);
        report.planned_routes += ids.length;
        report.planned_route_ids.push(...ids);
        if (client) {
          try { for (let i = 0; i < ids.length; i += 50) await record(await activateBulkBatch(client,ids.slice(i,i+50),state)); }
          catch (error) { if (fatalBulkError(error)) throw error; await record(ids.map(id => ({ route_id:id,state_code:state,operation:'activate',success:false,error:(error as Error).message }))); }
        }
        await record(skipped);
        continue;
      }
      await record(plan.skipped); report.planned_routes += plan.routes.length;
      report.planned_route_ids.push(...plan.routes.map(r => r.id));
      if (!plan.routes.length) continue;
      if (!client) { buildBulkBatch(plan); continue; }
      try { await record(await runLoadBulkBatch(client, plan, join(dir,'terrarium'))); }
      catch (error) { if (fatalBulkError(error)) throw error; await record(plan.routes.map(r => ({route_id:r.id,state_code:state,operation:'load',success:false,error:(error as Error).message}))); }
    }
    await mkdir(dir,{recursive:true}); await writeFile(join(dir,'bulk-plan.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({...report,planned_route_ids:undefined,results_file:options.apply?resultsFile:undefined},null,2));
  } finally { if (client) await client.end(); }
}
