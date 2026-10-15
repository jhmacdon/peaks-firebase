import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Client } from 'pg';
import { args, ndjson, option } from './io';
import { DEFAULT_COMPOSE, catalogRouteId, digest, segmentManifestHash } from './compose';
import { databaseFeature, normalizeName } from './names';
import { hash, haversine } from './geo';
import { segmentValues } from './load-segments';
import type { ComposedRoute, NewPlace, PlaceRef } from './catalog-types';
import type { Coord, Segment } from './types';

export interface Approval { route_id: string; composition_hash: string; status: 'approved'; reviewed_by: string; reviewed_at: string }
export interface LoadOptions { activate?: boolean; elevation?: boolean; approvals?: Approval[]; onlyOk?: boolean }
export interface Statement { kind: string; sql: string; values: unknown[] }
export interface RoutePlan { route_id: string; seed_index: number; statements: Statement[]; segment_ids: string[]; activate: boolean; notes: string[]; skipped?: string }
const STATES = "('approved','publish_leased','published','verify_leased','verified','rejected')";
const PROTECTED = `SELECT 1 FROM route_segments rs JOIN trail_catalog_review_jobs review ON review.route_id=rs.route_id WHERE rs.segment_id=segments.id AND review.state IN ${STATES}`;

export function placeId(ref: PlaceRef): string {
  if (ref.peaks_id) return ref.peaks_id;
  if (!ref.new) throw new Error('Unresolved destination reference');
  const p = ref.new;
  return p.source.osm_id ? `wa-osm-${p.source.osm_id.replace('/', '-')}` : `wa-place-${hash(JSON.stringify([p.feature, p.source.node_id, p.lng, p.lat]))}`;
}
function destinationStatement(p: NewPlace): Statement {
  // The current destinations.boundary column is Polygon, not MultiPolygon.
  // Retain the full footprint in metadata; its largest part fits that column.
  const rings = p.boundary?.coordinates.slice().sort((a, b) => area(b[0]) - area(a[0]))[0];
  const source = p.source.osm_id ? { source_kind: 'openstreetmap', source_url: `https://www.openstreetmap.org/${p.source.osm_id}`,
    license_name: 'Open Data Commons Open Database License (ODbL) 1.0', license_url: 'https://opendatacommons.org/licenses/odbl/1-0/', attribution: '© OpenStreetMap contributors', osm_id: p.source.osm_id } : p.source.provenance;
  const externalIds = p.source.osm_id ? { osm: p.source.osm_id } : {};
  return { kind: 'destination_insert', sql: `INSERT INTO destinations(id,name,search_name,features,activities,state_code,country_code,location,elevation,metadata,external_ids,boundary)
    VALUES($1,$2,peaks_search_name($2),ARRAY[$3]::destination_feature[],ARRAY['outdoor-trek']::activity_type[],'WA','US',ST_SetSRID(ST_MakePoint($4,$5,$6),4326)::geography,$7,$8::jsonb,$9::jsonb,
      CASE WHEN $10::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($10),4326)::geography END)
    ON CONFLICT(id) DO NOTHING`, values: [placeId({ new: p }), p.name, p.source.kind === 'curated' ? p.feature : databaseFeature(p.feature), p.lng, p.lat, p.ele ?? 0, p.ele ?? null,
      JSON.stringify({ import: 'wa-trail-graph', natural_feature: p.feature, provenance: source, resolution: p.source, ...(p.boundary ? { osm_boundary: p.boundary } : {}) }), JSON.stringify(externalIds), rings ? JSON.stringify({ type: 'Polygon', coordinates: rings }) : null] };
}
function area(ring: Coord[]): number { let n = 0; for (let i = 1; i < ring.length; i++) n += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1]; return Math.abs(n); }
export function routeNotes(row: ComposedRoute): string | null {
  const notes = [...(row.approximate ? ['Approximate route.'] : []), ...(row.notes ?? [])];
  return notes.length ? notes.join('\n\n') : null;
}
export function compositionValid(r: ComposedRoute): boolean {
  return !!r.composition_hash && r.composition_hash === digest({ ...r, route_id: undefined, composition_hash: undefined }) && r.route_id === catalogRouteId(r);
}
export function planRoute(row: ComposedRoute, segments: Map<string, Segment>, options: LoadOptions = {}): RoutePlan {
  const plan: RoutePlan = { route_id: row.route_id ?? '', seed_index: row.seed_index, statements: [], segment_ids: [], activate: false, notes: [] };
  const skip = (reason: string) => ({ ...plan, skipped: reason });
  if (!['ok', 'review'].includes(row.status) || options.onlyOk && row.status !== 'ok') return skip(`composition status ${row.status}`);
  if (row.existing_route_matches.some(m => m.catalog_reviewed) || row.existing_route_match?.catalog_reviewed) return skip('catalog_reviewed match: use trail-catalog supersede path');
  if (!compositionValid(row)) throw new Error(`Composition hash mismatch for seed ${row.seed_index}`);
  if (row.segment_manifest_hash !== segmentManifestHash(row.segments.map(s => s.id), segments)) throw new Error(`Segment manifest hash mismatch for seed ${row.seed_index}`);
  if (!row.trailhead || !row.segments.length || !row.provenance) throw new Error(`Incomplete composition ${row.seed_index}`);
  const add = (kind: string, sql: string, values: unknown[] = []) => plan.statements.push({ kind, sql, values });
  let cursor: Coord | null = null, measured = 0;
  for (const ref of row.segments) {
    const segment = segments.get(ref.id); if (!segment) throw new Error(`Missing composed segment ${ref.id}`);
    const forward = ref.direction === 'forward', start = segment.coords[forward ? 0 : segment.coords.length - 1], end = segment.coords[forward ? segment.coords.length - 1 : 0];
    if (cursor && haversine(cursor, start) > 0.1) throw new Error(`Disconnected composed segments for ${row.name}`);
    cursor = end; measured += segment.length_m; segmentValues(segment);
  }
  if (Math.abs(measured - row.length_m) > 0.1) throw new Error(`Composed segment length mismatch for ${row.name}`);
  add('begin', 'BEGIN');
  add('lock', "SELECT pg_advisory_xact_lock(hashtextextended('wa_trail_catalog_loader',0))");
  add('review_guard', `SELECT r.id,r.status,EXISTS(SELECT 1 FROM trail_catalog_review_jobs review WHERE review.route_id=r.id AND review.state IN ${STATES}) AS protected
    FROM routes r WHERE r.id=ANY($1::text[]) FOR UPDATE`, [[...new Set([row.route_id!, ...row.existing_route_matches.map(m => m.id), ...(row.existing_route_match ? [row.existing_route_match.id] : [])])]]);
  const refs = [row.trailhead, ...[...row.waypoints].sort((a, b) => a.fraction - b.fraction), row.end_trailhead, row.objective].filter((p): p is PlaceRef => !!p);
  const places = new Map<string, PlaceRef>(); for (const ref of refs) places.set(placeId(ref), ref);
  for (const ref of places.values()) if (ref.new) plan.statements.push(destinationStatement(ref.new));
  plan.segment_ids = [...new Set(row.segments.map(s => s.id))];
  for (const id of plan.segment_ids) add('segment_insert', `INSERT INTO segments(id,name,display_name,kind,state_code,trail_names,path,distance,provenance,description,description_source_url)
    VALUES($1,$2,$8,$3,'WA',$4,ST_SetSRID(ST_GeomFromGeoJSON($5),4326)::geography,$6,$7::jsonb,$9,$10) ON CONFLICT(id) DO NOTHING`, segmentValues(segments.get(id)!));
  const slug = `${normalizeName(row.name).replace(/ /g, '-')}-${row.route_id!.slice(-8)}`;
  if (row.wta_url && !/^https:\/\/(?:www\.)?wta\.org\/go-hiking\/hikes\/[a-z0-9.-]+\/?$/.test(row.wta_url)) throw new Error(`Invalid WTA URL ${row.wta_url}`);
  add('route_insert', `INSERT INTO routes(id,name,status,owner,kind,slug,search_name,aliases,state_code,country_code,external_links,provenance,shape,trailhead_destination_id,objective_destination_id,description)
    VALUES($1,$2,'pending','peaks',$3,$4,peaks_search_name($2),$5,'WA','US',$6::jsonb,$7::jsonb,$8::route_shape,$9,$10,$11) ON CONFLICT(id) DO NOTHING`,
    [row.route_id, row.name, row.kind, slug, row.aliases, JSON.stringify(row.wta_url ? [{ type: 'wta', id: row.wta_url }] : []), JSON.stringify(row.provenance), row.shape, placeId(row.trailhead), row.objective ? placeId(row.objective) : null, routeNotes(row)]);
  row.segments.forEach((ref, ordinal) => add('route_segment_insert', `INSERT INTO route_segments(route_id,segment_id,ordinal,direction) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [row.route_id, ref.id, ordinal, ref.direction]));
  // route_destinations has a (route_id,destination_id) primary key. Keep one
  // occurrence, with the objective last and trailhead first even on loops.
  const thId = placeId(row.trailhead), objectiveId = row.objective ? placeId(row.objective) : null;
  const ordered = [...new Set(refs.map(placeId))].filter(id => id !== thId && id !== objectiveId);
  ordered.unshift(thId); if (objectiveId && objectiveId !== thId) ordered.push(objectiveId);
  ordered.forEach((id, ordinal) => add('route_destination_insert', 'INSERT INTO route_destinations(route_id,destination_id,ordinal) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [row.route_id, id, ordinal]));
  add('binding_guard', `SELECT
    jsonb_build_object('name',r.name,'owner',r.owner,'kind',r.kind,'aliases',r.aliases,'shape',r.shape,
      'state_code',r.state_code,'country_code',r.country_code,'trailhead_destination_id',r.trailhead_destination_id,
      'objective_destination_id',r.objective_destination_id,'external_links',r.external_links,'provenance',r.provenance,'description',r.description)=$2::jsonb
    AND COALESCE((SELECT jsonb_agg(jsonb_build_object('id',segment_id,'direction',direction) ORDER BY ordinal) FROM route_segments WHERE route_id=r.id),'[]')=$3::jsonb
    AND COALESCE((SELECT jsonb_agg(destination_id ORDER BY ordinal) FROM route_destinations WHERE route_id=r.id),'[]')=$4::jsonb
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements($5::jsonb) item LEFT JOIN segments s ON s.id=item->>'id'
      WHERE s.id IS NULL OR s.name IS DISTINCT FROM (item->>'name') OR s.display_name IS DISTINCT FROM (item->>'display_name')
        OR s.description IS DISTINCT FROM (item->>'description') OR s.description_source_url IS NOT NULL OR s.state_code IS DISTINCT FROM 'WA'
        OR s.kind IS DISTINCT FROM (item->>'kind') OR to_jsonb(s.trail_names) IS DISTINCT FROM (item->'trail_names')
        OR (s.provenance-ARRAY['elevation_source','elevation_profile']) IS DISTINCT FROM (item->'provenance')
        OR NOT COALESCE(ST_OrderingEquals(ST_Force2D(s.path::geometry),ST_GeomFromGeoJSON(item->>'geometry')),false))
    AS valid FROM routes r WHERE r.id=$1`, [row.route_id,
      JSON.stringify({ name: row.name, owner: 'peaks', kind: row.kind, aliases: row.aliases, shape: row.shape, state_code: 'WA', country_code: 'US', trailhead_destination_id: thId, objective_destination_id: objectiveId, external_links: row.wta_url ? [{ type: 'wta', id: row.wta_url }] : [], provenance: row.provenance, description: routeNotes(row) }),
      JSON.stringify(row.segments), JSON.stringify(ordered), JSON.stringify(plan.segment_ids.map(id => { const s = segments.get(id)!; return { id, name: s.name, display_name: s.display_name === undefined ? s.trail_names[0] || s.relation_names[0] || null : s.display_name, description: s.description ?? null, kind: s.kind, trail_names: s.trail_names, provenance: s.provenance, geometry: { type: 'LineString', coordinates: s.coords } }; }))]);
  if (options.elevation) {
    for (const id of plan.segment_ids) {
      add('elevation_guard', `SELECT EXISTS(${PROTECTED}) AS protected FROM segments WHERE id=$1`, [id]);
      add('elevation_segment_update', `UPDATE segments SET path=ST_SetSRID(ST_GeomFromGeoJSON($2),4326)::geography,
      gain=(SELECT gain FROM route_elevation_stats(ST_SetSRID(ST_GeomFromGeoJSON($2),4326)::geography)),
      gain_loss=(SELECT loss FROM route_elevation_stats(ST_SetSRID(ST_GeomFromGeoJSON($2),4326)::geography)),
      provenance=provenance || '{"elevation_source":"terrarium_z14","elevation_profile":"terrain"}'::jsonb
      WHERE id=$1 AND NOT EXISTS(${PROTECTED})`, [id, '__TERRARIUM_LINESTRINGZ_AT_APPLY__']);
    }
  } else plan.notes.push('TODO elevation: rerun the elevation job, or use --elevation with network access; geometry has Z=0 placeholders');
  add('rebuild_route_path', 'SELECT rebuild_route_path($1)', [row.route_id]);
  if (options.elevation) add('elevation_route_metadata', `UPDATE routes SET gain=stats.gain,gain_loss=stats.loss,elevation_source='segment_profiles',
    elevation_source_url='https://registry.opendata.aws/terrain-tiles/',elevation_attribution='Mapzen / AWS Open Data Terrain Tiles',
    elevation_license_url='https://github.com/tilezen/joerd/blob/master/docs/attribution.md',elevation_retrieved_at=now()
    FROM route_elevation_stats((SELECT path FROM routes WHERE id=$1)) stats WHERE id=$1`, [row.route_id]);
  if (options.activate) {
    const approved = options.approvals?.some(a => a.route_id === row.route_id && a.composition_hash === row.composition_hash && a.status === 'approved' && a.reviewed_by.trim() && Number.isFinite(Date.parse(a.reviewed_at)));
    if (!approved) plan.notes.push('Activation skipped: no approval bound to this composition hash');
    else {
      plan.activate = true;
      add('activate', "UPDATE routes SET status='active',updated_at=now() WHERE id=$1 AND status='pending' RETURNING id", [row.route_id]);
      const legacy = row.existing_route_match;
      if (legacy && legacy.id !== row.route_id) {
        add('legacy_supersede', `UPDATE routes SET status='superseded',updated_at=now() WHERE id=$1 AND owner='peaks' AND status IN ('pending','active')
          AND NOT EXISTS(SELECT 1 FROM trail_catalog_review_jobs review WHERE review.route_id=routes.id AND review.state IN ${STATES}) RETURNING id`, [legacy.id]);
        // Preserve all session_routes columns, including any companion additions.
        add('session_routes_move', `INSERT INTO session_routes SELECT (jsonb_populate_record(NULL::session_routes,to_jsonb(sr)||jsonb_build_object('route_id',$1))).*
          FROM session_routes sr WHERE sr.route_id=$2 ON CONFLICT(session_id,route_id) DO NOTHING`, [row.route_id, legacy.id]);
        add('session_routes_delete_legacy', 'DELETE FROM session_routes WHERE route_id=$1', [legacy.id]);
      }
    }
  }
  add('commit', 'COMMIT'); return plan;
}
export function planCounts(plans: RoutePlan[]) {
  const statements: Record<string, number> = {}, skipped: Record<string, number> = {};
  for (const p of plans) if (p.skipped) skipped[p.skipped] = (skipped[p.skipped] ?? 0) + 1; else for (const s of p.statements) statements[s.kind] = (statements[s.kind] ?? 0) + 1;
  return { input_routes: plans.length, planned_routes: plans.filter(p => !p.skipped).length, skipped, statements,
    unique_segment_ids: new Set(plans.filter(p => !p.skipped).flatMap(p => p.segment_ids)).size,
    note: 'Exact planned SQL statement counts; affected-row counts and existing IDs require a DB. Inserts are ON CONFLICT DO NOTHING.' };
}
export async function executePlan(client: Pick<Client, 'query'>, plan: RoutePlan, segments: Map<string, Segment>, cacheDir: string, sample?: (points: { lng: number; lat: number }[]) => Promise<number[]>): Promise<string> {
  if (plan.skipped) return `skipped: ${plan.skipped}`;
  let elevationSkipped = false, existingPending = false; const protectedSegments = new Set<string>();
  try {
    for (const statement of plan.statements) {
      if (existingPending && ['destination_insert','segment_insert','route_insert','route_segment_insert','route_destination_insert'].includes(statement.kind)) continue;
      if (statement.kind === 'elevation_segment_update') {
        const id = statement.values[0] as string;
        if (protectedSegments.has(id)) { elevationSkipped = true; continue; }
        const segment = segments.get(id)!, elevations = await sample!(segment.coords.map(([lng, lat]) => ({ lng, lat })));
        if (elevations.length !== segment.coords.length || elevations.some(z => !Number.isFinite(z))) throw new Error(`Incomplete elevation profile ${id}`);
        const geometry = JSON.stringify({ type: 'LineString', coordinates: segment.coords.map(([lng, lat], i) => [lng, lat, elevations[i]]) });
        const changed = await client.query(statement.sql, [id, geometry]);
        if (changed.rowCount !== 1) elevationSkipped = true;
      } else {
        if (statement.kind === 'elevation_route_metadata' && elevationSkipped) continue;
        const result = await client.query(statement.sql, statement.values);
        if (statement.kind === 'review_guard') {
          if (result.rows.some(r => r.protected)) { await client.query('ROLLBACK'); return 'skipped: live catalog review protects a matched route'; }
          const own = result.rows.find(r => r.id === plan.route_id);
          if (own) {
            if (own.status === 'pending' && (plan.activate || plan.statements.some(s => s.kind === 'elevation_guard'))) existingPending = true;
            else { await client.query('ROLLBACK'); return `skipped: route already exists (${own.status})`; }
          }
        }
        if (statement.kind === 'binding_guard' && result.rows[0]?.valid !== true) throw new Error('Stored route/segments differ from the reviewed composition');
        if (statement.kind === 'elevation_guard' && result.rows[0]?.protected) protectedSegments.add(statement.values[0] as string);
        if (['activate', 'legacy_supersede'].includes(statement.kind) && result.rowCount !== 1) throw new Error(`${statement.kind} did not change one pending/legacy route`);
      }
    }
    return elevationSkipped ? 'applied; protected segment elevation skipped' : 'applied';
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
async function main() {
  const options = args(), dir = option(options, 'out', DEFAULT_COMPOSE), segments = new Map<string, Segment>(), routes: ComposedRoute[] = [];
  for (const flag of ['apply', 'activate', 'elevation', 'only-ok']) if (options.has(flag) && options.get(flag)![0] !== 'true') throw new Error(`--${flag} is a flag without a value`);
  for await (const s of ndjson<Segment>(join(dir, 'segments.ndjson'))) segments.set(s.id, s);
  for await (const r of ndjson<ComposedRoute>(join(dir, 'routes.ndjson'))) routes.push(r);
  const approvals: Approval[] = options.has('reviews') ? JSON.parse(await readFile(option(options, 'reviews', ''), 'utf8')) : [];
  const plans = routes.map(r => planRoute(r, segments, { activate: options.has('activate'), elevation: options.has('elevation'), onlyOk: options.has('only-ok'), approvals }));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'load-plan.json'), JSON.stringify({ counts: planCounts(plans), plans }, null, 2) + '\n');
  console.log(JSON.stringify(planCounts(plans), null, 2));
  if (!options.has('apply')) return;
  if (!process.env.DATABASE_URL) throw new Error('--apply requires DATABASE_URL');
  const { Client } = await import('pg'); const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const schema = await client.query("SELECT to_regprocedure('rebuild_route_path(text)') IS NOT NULL AS ready");
    if (!schema.rows[0]?.ready) throw new Error('Apply the companion 20261015_segment_model_v2.sql first');
    // TODO hook: same sampler as route-elevation-jobs.ts. Import only at apply
    // with --elevation; dry runs cannot fetch tiles or import native sharp.
    const sample = options.has('elevation') ? async (points: { lng: number; lat: number }[]) => {
      const { sampleTerrariumProfile } = await import('../lib/terrarium-route-profile');
      return sampleTerrariumProfile(points, { cacheDir: join(dir, 'terrarium') });
    } : undefined;
    for (const plan of plans) console.log(plan.seed_index, await executePlan(client, plan, segments, dir, sample));
  } finally { await client.end(); }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
