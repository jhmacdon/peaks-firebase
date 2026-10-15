import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Client } from 'pg';
import { args, ndjson, option, DEFAULT_INPUT } from './io';
import { DEFAULT_COMPOSE, catalogRouteId, digest, routeProvenance, segmentManifestHash } from './compose';
import { databaseFeature } from './names';
import { haversine } from './geo';
import { assertDisplayName } from './display-names';
import { segmentValues } from './load-segments';
import { DestinationResolver, IMPORT_MARKER, checkSupersede, claimSupersedes, forbiddenPlace, osmExternalIds, placeIdentity, type SupersedeDecision } from './load-matching';
import { bindExistingSegments, readPreflight, type ExistingOverlap } from './load-preflight';
import { prunePlan } from './load-prune';
import { DESTINATION_FEATURES, routeLine } from './stretches';
import type { ComposedRoute, NewPlace, PeaksDestination, PeaksRoute, PlaceRef } from './catalog-types';
import type { Coord, Provenance, Segment } from './types';

export interface LoadOptions { activate?: boolean; elevation?: boolean; includeReview?: boolean; onlyOk?: boolean; resolver?: DestinationResolver; supersede?: SupersedeDecision; overlaps?: ExistingOverlap[]; supersededIds?: Set<string>; currentIds?: Set<string>; livePreflight?: boolean }
export interface Statement { kind: string; sql: string; values: unknown[] }
export interface RoutePlan { route_id: string; seed_index: number; statements: Statement[]; segment_ids: string[]; destination_ids: string[]; activate: boolean; notes: string[]; skipped?: string; reused_segment_ids: string[]; segment_data: Map<string, Segment> }
const STATES = "('approved','publish_leased','published','verify_leased','verified','rejected')";
const PROTECTED = `SELECT 1 FROM route_segments rs JOIN trail_catalog_review_jobs review ON review.route_id=rs.route_id WHERE rs.segment_id=segments.id AND review.state IN ${STATES}`;
export const placeId = placeIdentity;
export function importedProvenance(provenance: Provenance, metadata: Record<string, unknown>): unknown {
  return { ...provenance, wa_catalog: { loader: IMPORT_MARKER, ...metadata } };
}
function destinationStatement(p: NewPlace): Statement {
  if (p.source.kind === 'curated' && !DESTINATION_FEATURES.has(p.feature)) throw new Error(`Invalid curated destination feature ${p.feature}`);
  const rings = p.boundary?.coordinates.slice().sort((a, b) => area(b[0]) - area(a[0]))[0];
  const source = p.source.provenance ?? { source_kind: 'openstreetmap', source_url: `https://www.openstreetmap.org/${p.source.osm_id}`,
    license_name: 'Open Data Commons Open Database License (ODbL) 1.0', license_url: 'https://opendatacommons.org/licenses/odbl/1-0/', attribution: '© OpenStreetMap contributors', osm_id: p.source.osm_id };
  return { kind: 'destination_insert', sql: `INSERT INTO destinations(id,name,search_name,features,activities,state_code,country_code,location,elevation,metadata,external_ids,boundary)
    VALUES($1,$2,peaks_search_name($2),ARRAY[$3]::destination_feature[],ARRAY['outdoor-trek']::activity_type[],'WA','US',ST_SetSRID(ST_MakePoint($4,$5,$6),4326)::geography,$7,$8::jsonb,$9::jsonb,
      CASE WHEN $10::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($10),4326)::geography END) ON CONFLICT(id) DO NOTHING`,
    values: [placeId({ new: p }), p.name, p.source.kind === 'curated' ? p.feature : databaseFeature(p.feature), p.lng, p.lat, p.ele ?? 0, p.ele ?? null,
      JSON.stringify({ import: IMPORT_MARKER, natural_feature: p.feature, provenance: { ...source, wa_catalog: { loader: IMPORT_MARKER } }, resolution: p.source, ...(p.boundary ? { osm_boundary: p.boundary } : {}) }), JSON.stringify(osmExternalIds(p.source.osm_id)), rings ? JSON.stringify({ type: 'Polygon', coordinates: rings }) : null] };
}
function area(ring: Coord[]): number { let n = 0; for (let i = 1; i < ring.length; i++) n += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1]; return Math.abs(n); }
export function compositionValid(r: ComposedRoute): boolean {
  return !!r.composition_hash && r.composition_hash === digest({ ...r, route_id: undefined, composition_hash: undefined }) && r.route_id === catalogRouteId(r);
}
export function planRoute(row: ComposedRoute, source: Map<string, Segment>, options: LoadOptions = {}): RoutePlan {
  const plan: RoutePlan = { route_id: row.route_id ?? '', seed_index: row.seed_index, statements: [], segment_ids: [], destination_ids: [], activate: false, notes: [], reused_segment_ids: [], segment_data: source };
  const skip = (reason: string) => ({ ...plan, skipped: reason });
  if (row.status !== 'ok' && !(options.includeReview && row.status === 'review')) return skip(`composition status ${row.status}`);
  if (row.existing_route_matches.some(m => m.catalog_reviewed) || row.existing_route_match?.catalog_reviewed) return skip('catalog_reviewed match: use trail-catalog supersede path');
  if (!compositionValid(row)) throw new Error(`Composition hash mismatch for seed ${row.seed_index}`);
  if (row.segment_manifest_hash !== segmentManifestHash(row.segments.map(s => s.id), source)) throw new Error(`Segment manifest hash mismatch for seed ${row.seed_index}`);
  if (!row.trailhead || !row.segments.length || !row.provenance) throw new Error(`Incomplete composition ${row.seed_index}`);
  if (options.activate && !options.elevation) throw new Error('--activate requires --elevation; activation also checks every stored Z and gain');
  const binding = bindExistingSegments(row, source, options.overlaps ?? [], options.supersededIds ?? new Set(), options.currentIds ?? new Set());
  if (binding.blocked.length) return skip(`segment overlap conflict: ${binding.blocked.join('; ')}`);
  plan.segment_data = binding.segments; plan.reused_segment_ids = binding.reused;
  const refs = binding.refs, segments = binding.segments, resolver = options.resolver ?? new DestinationResolver([]);
  const th = resolver.resolve(row.trailhead), goal = row.objective ? resolver.resolve(row.objective) : null, end = row.end_trailhead ? resolver.resolve(row.end_trailhead) : null;
  if (goal && forbiddenPlace(goal)) return skip('uncurated pass/glacier/saddle objective requires an existing or curated destination');
  const waypoints = [...row.waypoints].sort((a, b) => a.fraction - b.fraction).filter(w => w.new?.source.kind === 'curated' || w.osm_id.startsWith('curated/') || !['pass', 'saddle', 'glacier'].includes(w.feature)).map(w => resolver.resolve(w)).filter(ref => !forbiddenPlace(ref));
  const places = new Map<string, PlaceRef>(); for (const ref of [th, ...waypoints, end, goal].filter((p): p is PlaceRef => !!p)) places.set(placeId(ref), ref);
  let cursor: Coord | null = null, measured = 0;
  for (const ref of refs) {
    const s = segments.get(ref.id)!, start = s.coords[ref.direction === 'forward' ? 0 : s.coords.length - 1], finish = s.coords[ref.direction === 'forward' ? s.coords.length - 1 : 0];
    if (cursor && haversine(cursor, start) > 0.1) throw new Error(`Disconnected composed segments for ${row.name}`);
    cursor = finish; measured += s.length_m; assertDisplayName(s.display_name ?? null); if (!binding.reused.includes(s.id)) segmentValues(s);
  }
  if (Math.abs(measured - row.length_m) > 0.1) throw new Error(`Composed segment length mismatch for ${row.name}`);
  const add = (kind: string, sql: string, values: unknown[] = []) => plan.statements.push({ kind, sql, values });
  add('begin', 'BEGIN'); add('lock', "SELECT pg_advisory_xact_lock(hashtextextended('wa_trail_catalog_loader',0))");
  add('review_guard', `SELECT r.id,r.status,EXISTS(SELECT 1 FROM trail_catalog_review_jobs j WHERE j.route_id=r.id AND j.state IN ${STATES}) AS protected
    FROM routes r WHERE r.id=ANY($1::text[]) FOR UPDATE`, [[row.route_id!, ...(options.supersede?.eligible ? [options.supersede.legacy_id] : [])]]);
  // Another replacement may fail while this run continues. Its planned claim
  // must not authorize duplicate geometry until that retirement has committed.
  const dependencies = [...new Set((options.overlaps ?? []).filter(o => row.segments.some(r => r.id === o.new_id) && !binding.reused.includes(o.id))
    .flatMap(o => o.routes.map(r => r.id)).filter(id => id !== (options.supersede?.eligible ? options.supersede.legacy_id : null)))];
  if (dependencies.length) add('overlap_guard', `SELECT NOT EXISTS(SELECT 1 FROM routes WHERE id=ANY($1::text[]) AND status IS DISTINCT FROM 'superseded') AS valid`, [dependencies]);
  for (const ref of places.values()) if (ref.new) plan.statements.push(destinationStatement(ref.new));
  plan.segment_ids = [...new Set(refs.map(s => s.id))];
  for (const id of plan.segment_ids.filter(id => !binding.reused.includes(id))) {
    const values = segmentValues(segments.get(id)!); values[6] = JSON.stringify(importedProvenance(segments.get(id)!.provenance, {}));
    add('segment_insert', `INSERT INTO segments(id,name,display_name,kind,state_code,trail_names,path,distance,provenance,description,description_source_url)
      VALUES($1,$2,$8,$3,'WA',$4,ST_SetSRID(ST_GeomFromGeoJSON($5),4326)::geography,$6,$7::jsonb,$9,$10) ON CONFLICT(id) DO NOTHING`, values);
  }
  const thId = placeId(th), objectiveId = goal ? placeId(goal) : null;
  const ordered = [...places.keys()].filter(id => id !== thId && id !== objectiveId); ordered.unshift(thId); if (objectiveId && objectiveId !== thId) ordered.push(objectiveId); plan.destination_ids = ordered;
  const sourceProvenance: any = { ...routeProvenance(plan.segment_ids.map(id => segments.get(id)!.provenance)) };
  delete sourceProvenance.elevation_source; delete sourceProvenance.elevation_profile; delete sourceProvenance.wa_catalog;
  const metadata = { compose_status: row.status, composition_hash: row.composition_hash, approximate: !!row.approximate, notes: row.notes ?? [],
    waypoint_names: row.waypoints.map(w => ({ name: w.name, feature: w.feature, fraction: w.fraction })), loaded_binding_hash: digest(refs) };
  const provenance = importedProvenance(sourceProvenance, metadata);
  if (row.wta_url && !/^https:\/\/(?:www\.)?wta\.org\/go-hiking\/hikes\/[a-z0-9.-]+\/?$/.test(row.wta_url)) throw new Error(`Invalid WTA URL ${row.wta_url}`);
  add('route_insert', `INSERT INTO routes(id,name,status,owner,kind,slug,search_name,aliases,state_code,country_code,external_links,provenance,shape,trailhead_destination_id,objective_destination_id,description)
    VALUES($1,$2,'pending','peaks',$3,peaks_route_catalog_slug($2,$1),peaks_search_name($2),$4,'WA','US',$5::jsonb,$6::jsonb,$7::route_shape,$8,$9,NULL) ON CONFLICT(id) DO NOTHING`,
    [row.route_id, row.name, row.kind, row.aliases, JSON.stringify(row.wta_url ? [{ type: 'wta', id: row.wta_url }] : []), JSON.stringify(provenance), row.shape, thId, objectiveId]);
  refs.forEach((ref, ordinal) => add('route_segment_insert', 'INSERT INTO route_segments(route_id,segment_id,ordinal,direction) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [row.route_id, ref.id, ordinal, ref.direction]));
  ordered.forEach((id, ordinal) => add('route_destination_insert', 'INSERT INTO route_destinations(route_id,destination_id,ordinal) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [row.route_id, id, ordinal]));
  add('binding_guard', `SELECT jsonb_build_object('name',r.name,'owner',r.owner,'kind',r.kind,'aliases',r.aliases,'shape',r.shape,
      'state_code',r.state_code,'country_code',r.country_code,'trailhead_destination_id',r.trailhead_destination_id,'objective_destination_id',r.objective_destination_id,
      'external_links',r.external_links,'provenance',r.provenance-ARRAY['elevation_source','elevation_profile'],'description',r.description)=$2::jsonb
    AND COALESCE((SELECT jsonb_agg(jsonb_build_object('id',segment_id,'direction',direction) ORDER BY ordinal) FROM route_segments WHERE route_id=r.id),'[]')=$3::jsonb
    AND COALESCE((SELECT jsonb_agg(destination_id ORDER BY ordinal) FROM route_destinations WHERE route_id=r.id),'[]')=$4::jsonb
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements($5::jsonb) item LEFT JOIN segments s ON s.id=item->>'id'
      WHERE s.id IS NULL OR s.name IS DISTINCT FROM (item->>'name') OR s.display_name IS DISTINCT FROM(item->>'display_name')
      OR s.description IS DISTINCT FROM(item->>'description') OR s.kind IS DISTINCT FROM(item->>'kind')
      OR (s.provenance-ARRAY['elevation_source','elevation_profile','wa_catalog']) IS DISTINCT FROM(item->'provenance')
      OR NOT COALESCE(ST_OrderingEquals(ST_Force2D(s.path::geometry),ST_GeomFromGeoJSON(item->>'geometry')),false)) AS valid FROM routes r WHERE r.id=$1`,
    [row.route_id, JSON.stringify({ name: row.name, owner: 'peaks', kind: row.kind, aliases: row.aliases, shape: row.shape, state_code: 'WA', country_code: 'US', trailhead_destination_id: thId, objective_destination_id: objectiveId, external_links: row.wta_url ? [{ type: 'wta', id: row.wta_url }] : [], provenance, description: null }),
      JSON.stringify(refs), JSON.stringify(ordered), JSON.stringify(plan.segment_ids.map(id => { const s = segments.get(id)!, p: any = { ...s.provenance }; delete p.elevation_source; delete p.elevation_profile; delete p.wa_catalog; return { id, name: s.name, display_name: s.display_name === undefined ? s.trail_names[0] || s.relation_names[0] || null : s.display_name, description: s.description ?? null, kind: s.kind, provenance: p, geometry: { type: 'LineString', coordinates: s.coords } }; }))]);
  if (options.elevation) for (const id of plan.segment_ids) {
    add('elevation_guard', `SELECT EXISTS(${PROTECTED}) AS protected,
      gain IS NOT NULL AND gain_loss IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ST_DumpPoints(path::geometry) p WHERE ST_Z((p).geom) IS NULL OR ST_Z((p).geom)=0) AS complete
      FROM segments WHERE id=$1`, [id]);
    add('elevation_segment_update', `UPDATE segments SET path=ST_SetSRID(ST_GeomFromGeoJSON($2),4326)::geography,
      gain=(SELECT gain FROM route_elevation_stats(ST_SetSRID(ST_GeomFromGeoJSON($2),4326)::geography)),gain_loss=(SELECT loss FROM route_elevation_stats(ST_SetSRID(ST_GeomFromGeoJSON($2),4326)::geography)),
      provenance=provenance||'{"elevation_source":"terrarium_z14","elevation_profile":"terrain"}'::jsonb
      WHERE id=$1 AND NOT EXISTS(${PROTECTED}) AND gain IS NULL`, [id, '__TERRARIUM_LINESTRINGZ_AT_APPLY__']);
  }
  else plan.notes.push('Z=0 placeholders: activation requires --elevation and the owned SQL integrity function');
  add('rebuild_route_path', 'SELECT rebuild_route_path($1)', [row.route_id]);
  if (options.elevation) add('elevation_route_metadata', `UPDATE routes SET gain=stats.gain,gain_loss=stats.loss,elevation_source='segment_profiles',
    elevation_source_url='https://registry.opendata.aws/terrain-tiles/',elevation_attribution='Mapzen / AWS Open Data Terrain Tiles',elevation_license_url='https://github.com/tilezen/joerd/blob/master/docs/attribution.md',elevation_retrieved_at=now(),
    provenance=provenance||'{"elevation_source":"terrarium_z14","elevation_profile":"terrain"}'::jsonb
    FROM route_elevation_stats((SELECT path FROM routes WHERE id=$1)) stats WHERE id=$1`, [row.route_id]);
  if (options.activate && row.status === 'ok') {
    plan.activate = true;
    add('activate', 'SELECT activate_wa_catalog_route($1)', [row.route_id]);
    if (options.supersede?.eligible) {
      const legacy = options.supersede;
      add('legacy_supersede', `UPDATE routes old SET status='superseded',updated_at=now() FROM routes fresh
        WHERE old.id=$1 AND fresh.id=$2 AND old.name=$3 AND old.owner='peaks' AND old.status IN ('active','pending')
        AND COALESCE(old.objective_destination_id,(SELECT destination_id FROM route_destinations WHERE route_id=old.id ORDER BY ordinal DESC LIMIT 1))=fresh.objective_destination_id
        AND ST_DWithin(ST_StartPoint(old.path::geometry)::geography,ST_StartPoint(fresh.path::geometry)::geography,300)
        AND ST_DWithin(ST_EndPoint(old.path::geometry)::geography,ST_EndPoint(fresh.path::geometry)::geography,150)
        AND ST_Length(ST_CollectionExtract(ST_Intersection(ST_Force2D(old.path::geometry),ST_Buffer(fresh.path,30)::geometry),2)::geography)>=0.8*ST_Length(old.path)
        AND NOT EXISTS(SELECT 1 FROM trail_catalog_review_jobs j WHERE j.route_id=old.id AND j.state IN ${STATES}) RETURNING old.id`, [legacy.legacy_id, row.route_id, legacy.legacy_name]);
      add('supersede_claim', 'INSERT INTO wa_catalog_supersedes(legacy_route_id,route_id) VALUES($1,$2)', [legacy.legacy_id, row.route_id]);
      add('session_rematch_queue', `INSERT INTO session_rematch_queue(session_id,reason) SELECT session_id,'wa-catalog-supersede:'||$2 FROM session_routes WHERE route_id=$1
        ON CONFLICT(session_id) DO UPDATE SET reason=EXCLUDED.reason,queued_at=now()`, [legacy.legacy_id, row.route_id]);
      add('session_routes_move', `INSERT INTO session_routes(session_id,route_id,source,coverage,covered_intervals,is_primary)
        SELECT session_id,$2,'auto',NULL,NULL,false FROM session_routes WHERE route_id=$1 ON CONFLICT(session_id,route_id) DO NOTHING`, [legacy.legacy_id, row.route_id]);
      add('session_routes_delete_legacy', 'DELETE FROM session_routes WHERE route_id=$1', [legacy.legacy_id]);
    }
  }
  if (!options.livePreflight) plan.notes.push('Live segment-overlap preflight required before any database write; not checked offline');
  add('commit', 'COMMIT'); return plan;
}
export function planCounts(plans: RoutePlan[]) {
  const statements: Record<string, number> = {}, skipped: Record<string, number> = {};
  for (const p of plans) if (p.skipped) skipped[p.skipped] = (skipped[p.skipped] ?? 0) + 1; else for (const s of p.statements) statements[s.kind] = (statements[s.kind] ?? 0) + 1;
  const admitted = plans.filter(p => !p.skipped);
  return { input_routes: plans.length, planned_routes: admitted.length, skipped, statements, unique_segment_ids: new Set(admitted.flatMap(p => p.segment_ids)).size,
    unique_destination_ids: new Set(admitted.flatMap(p => p.destination_ids)).size, unique_new_destination_ids: new Set(admitted.flatMap(p => p.statements.filter(s => s.kind === 'destination_insert').map(s => s.values[0]))).size,
    reused_segment_ids: [...new Set(admitted.flatMap(p => p.reused_segment_ids))], note: 'SQL statement counts, not affected-row counts. Offline plans require live read-only preflight before writes.' };
}
export async function executePlan(client: Pick<Client, 'query'>, plan: RoutePlan, segments: Map<string, Segment>, cacheDir: string, sample?: (points: { lng: number; lat: number }[]) => Promise<number[]>): Promise<string> {
  if (plan.skipped) return `skipped: ${plan.skipped}`;
  let existingPending = false; const elevated = new Set<string>();
  try {
    for (const statement of plan.statements) {
      if (existingPending && ['destination_insert','segment_insert','route_insert','route_segment_insert','route_destination_insert'].includes(statement.kind)) continue;
      if (statement.kind === 'elevation_segment_update') {
        const id = statement.values[0] as string; if (elevated.has(id)) continue;
        if (!sample) throw new Error('Elevation sampler missing');
        const s = plan.segment_data.get(id) ?? segments.get(id)!, elevations = await sample(s.coords.map(([lng, lat]) => ({ lng, lat })));
        if (elevations.length !== s.coords.length || elevations.some(z => !Number.isFinite(z) || z === 0 || z < -500 || z > 9000)) throw new Error(`Incomplete/invalid elevation profile ${id}`);
        const result = await client.query(statement.sql, [id, JSON.stringify({ type: 'LineString', coordinates: s.coords.map(([lng, lat], i) => [lng, lat, elevations[i]]) })]);
        if (result.rowCount !== 1) throw new Error(`Elevation update refused for ${id}`);
      } else {
        const result = await client.query(statement.sql, statement.values);
        if (statement.kind === 'review_guard') {
          if (result.rows.some(r => r.protected)) { await client.query('ROLLBACK'); return 'skipped: live catalog review protects a matched route'; }
          const own = result.rows.find(r => r.id === plan.route_id);
          if (own) { if (own.status === 'pending') existingPending = true; else { await client.query('ROLLBACK'); return `skipped: route already exists (${own.status})`; } }
        }
        if (statement.kind === 'binding_guard' && result.rows[0]?.valid !== true) throw new Error('Stored route/segments differ from the composition binding');
        if (statement.kind === 'overlap_guard' && result.rows[0]?.valid !== true) throw new Error('Overlapping legacy owner has not been superseded; retry after its replacement succeeds');
        if (statement.kind === 'elevation_guard') { const row = result.rows[0]; if (row?.complete) elevated.add(statement.values[0] as string); else if (row?.protected) throw new Error('Protected segment lacks usable elevation'); }
        if (statement.kind === 'legacy_supersede' && result.rowCount !== 1) throw new Error('Legacy supersede refused by live objective/start/end/overlap/review checks');
      }
    }
    return 'applied';
  } catch (error) { try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ } throw error; }
}
export async function waitForRematchDrain(client: Pick<Client, 'query'>, sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)), now: () => number = Date.now): Promise<void> {
  const deadline = now() + 30 * 60 * 1000;
  for (;;) { const result = await client.query('SELECT count(*)::int AS pending FROM session_rematch_queue'); if (result.rows[0]?.pending === 0) return;
    if (now() >= deadline) throw new Error('Rematch queue did not drain within 30 minutes; no further activation batches'); await sleep(30000); }
}
export async function runPlans(client: Pick<Client, 'query'>, plans: RoutePlan[], segments: Map<string, Segment>, dir: string, options: { batchSize?: number; drain?: () => Promise<void>; sample?: (points: { lng: number; lat: number }[]) => Promise<number[]> } = {}) {
  const size = options.batchSize ?? 50; if (!Number.isInteger(size) || size < 1 || size > 50) throw new Error('Activation batch size must be 1–50');
  const results: { seed_index: number; result: string }[] = []; let attempted = 0;
  for (const plan of plans) {
    if (plan.activate && attempted === size) { await (options.drain ?? (() => waitForRematchDrain(client)))(); attempted = 0; }
    if (plan.activate) attempted++;
    try { results.push({ seed_index: plan.seed_index, result: await executePlan(client, plan, segments, dir, options.sample) }); }
    catch (e) { results.push({ seed_index: plan.seed_index, result: `failed: ${(e as Error).message}` }); }
    await writeFile(join(dir, 'load-results.json'), JSON.stringify(results, null, 2) + '\n');
  }
  if (attempted) await (options.drain ?? (() => waitForRematchDrain(client)))(); return results;
}
async function readRows<T>(file: string): Promise<T[]> { const rows: T[] = []; for await (const row of ndjson<T>(file)) rows.push(row); return rows; }
export function catalogPlans(rows: ComposedRoute[], segments: Map<string, Segment>, destinations: PeaksDestination[], legacyRoutes: PeaksRoute[], options: LoadOptions = {}) {
  const resolver = new DestinationResolver(destinations), decisions: SupersedeDecision[] = [], byId = new Map(legacyRoutes.map(r => [r.id, r]));
  for (const row of rows) for (const match of [...new Map([...row.existing_route_matches, ...(row.existing_route_match ? [row.existing_route_match] : [])].map(m => [m.id, m])).values()]) {
    const legacy = byId.get(match.id); if (!legacy) continue;
    const goal = row.objective ? resolver.resolve(row.objective) : null, objectiveName = goal?.peaks_id ? destinations.find(d => d.id === goal.peaks_id)?.name ?? '' : goal?.new?.name ?? '';
    const valid = compositionValid(row) && row.segments.every(s => segments.has(s.id)) && row.segment_manifest_hash === segmentManifestHash(row.segments.map(s => s.id), segments);
    const decision = checkSupersede(row, legacy, valid ? routeLine(row, segments) : [], objectiveName, goal ? placeId(goal) : null);
    if (!valid) { decision.eligible = false; decision.reasons.push('invalid composition/segment manifest'); }
    decisions.push(decision);
  }
  claimSupersedes(decisions); const currentIds = new Set(rows.flatMap(r => r.route_id ? [r.route_id] : []));
  let plans: RoutePlan[] = [];
  // A skipped replacement cannot authorize a second route to duplicate its
  // legacy segments. Remove those claims and repeat until the set is closed.
  for (let pass = 0; pass <= decisions.length; pass++) {
    const supersededIds = new Set(options.activate ? decisions.filter(d => d.eligible).map(d => d.legacy_id) : []);
    plans = rows.map(r => {
      try { return planRoute(r, segments, { ...options, resolver, supersededIds, currentIds, supersede: decisions.find(d => d.seed_index === r.seed_index && d.eligible) }); }
      catch (e) { return { route_id: r.route_id ?? '', seed_index: r.seed_index, statements: [], segment_ids: [], destination_ids: [], activate: false, reused_segment_ids: [], segment_data: segments, notes: [], skipped: `invalid plan: ${(e as Error).message}` } as RoutePlan; }
    });
    let changed = false;
    for (const decision of decisions) if (decision.eligible && plans.find(p => p.seed_index === decision.seed_index)?.skipped) {
      decision.eligible = false; decision.reasons.push('replacement route was skipped; cannot authorize supersede'); changed = true;
    }
    if (!changed) break;
  }

  return { plans, supersedes: decisions, dedupe: resolver.events, currentIds: [...currentIds] };
}
async function main() {
  const flags = args(), dir = option(flags, 'out', DEFAULT_COMPOSE), input = option(flags, 'input', DEFAULT_INPUT);
  for (const flag of ['apply','activate','elevation','only-ok','include-review','prune-pending']) if (flags.has(flag) && flags.get(flag)![0] !== 'true') throw new Error(`--${flag} is a flag without a value`);
  if (flags.has('reviews')) throw new Error('--reviews is no longer supported: WA activation uses the owned SQL publish gate');
  if (flags.has('only-ok') && flags.has('include-review')) throw new Error('Choose --only-ok or --include-review');
  const batchSize = Number(option(flags, 'batch-size', '50'));
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) throw new Error('Activation batch size must be 1–50');
  if (flags.has('activate') && !flags.has('elevation')) throw new Error('--activate requires --elevation');
  const segments = new Map((await readRows<Segment>(join(dir, 'segments.ndjson'))).map(s => [s.id, s])), rows = await readRows<ComposedRoute>(join(dir, 'routes.ndjson'));
  let destinations = await readRows<PeaksDestination>(join(input, 'peaks-snapshot/wa-destinations.ndjson')), legacy = await readRows<PeaksRoute>(join(input, 'peaks-snapshot/wa-routes.ndjson'));
  const options: LoadOptions = { activate: flags.has('activate'), elevation: flags.has('elevation'), includeReview: flags.has('include-review') };
  let client: Client | undefined;
  try {
    if (flags.has('apply')) {
      if (!process.env.DATABASE_URL) throw new Error('--apply requires DATABASE_URL');
      const { Client } = await import('pg'); client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
      // Serialize competing WA loaders across the read-only snapshot and writes.
      // Session close releases this lock, including on failure.
      await client.query("SELECT pg_advisory_lock(hashtextextended('wa_trail_catalog_loader',0))");
      const live = await readPreflight(client, [...segments.values()], !!options.activate); destinations = live.destinations; legacy = live.routes; options.overlaps = live.overlaps; options.livePreflight = true;
    }
    const result = catalogPlans(rows, segments, destinations, legacy, options), pruning = flags.has('prune-pending') ? prunePlan(result.plans, result.currentIds) : [];
    const report = { mode: flags.has('apply') ? 'apply' : 'dry-run', preflight: options.livePreflight ? 'live read-only checks completed before writes' : 'not run: no DB connection; overlap and missing snapshot IDs/paths remain unverified',
      counts: planCounts(result.plans), supersedes: result.supersedes, dedupe: result.dedupe, pruning, plans: result.plans.map(({ segment_data, ...p }) => p) };
    await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'load-plan.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ ...report, plans: undefined, supersedes: undefined, dedupe: { matches: result.dedupe.length }, pruning: pruning.map(s => s.kind) }, null, 2));
    if (!client) return;
    const sample = options.elevation ? async (points: { lng: number; lat: number }[]) => { const { sampleTerrariumProfile } = await import('../lib/terrarium-route-profile'); return sampleTerrariumProfile(points, { cacheDir: join(dir, 'terrarium') }); } : undefined;
    await runPlans(client, result.plans, segments, dir, { batchSize, sample });
    if (pruning.length) { try { for (const s of pruning) await client.query(s.sql, s.values); } catch (e) { await client.query('ROLLBACK'); throw e; } }
  } finally { if (client) await client.end(); }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
