import type { Client } from 'pg';
import { digest } from './compose';
import { IMPORT_MARKER } from './load-matching';
import type { ComposedRoute, PeaksDestination, PeaksRoute } from './catalog-types';
import type { Coord, Segment } from './types';

export interface ExistingOverlap {
  new_id: string; id: string; name: string | null; display_name: string | null; kind: Segment['kind'] | null; trail_names: string[];
  description: string | null; provenance: Segment['provenance']; path: { type: 'LineString'; coordinates: number[][] };
  coverage: number; routes: { id: string; reviewed: boolean; status: string; loader?: string }[];
}
export interface LivePreflight { destinations: PeaksDestination[]; routes: PeaksRoute[]; overlaps: ExistingOverlap[]; cover_trigger_absent: boolean }
export const SCHEMA_PREFLIGHT = `SELECT to_regprocedure('rebuild_route_path(text)') IS NOT NULL AS rebuild_ready,
  to_regprocedure('activate_wa_catalog_route(text)') IS NOT NULL AS activation_ready,
  (pg_has_role(session_user,'peaks-route-factory','member') OR pg_has_role(session_user,'peaks-route-reviewer','member')) AS lease_bound_worker,
  NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='routes'::regclass AND tgname='trg_enforce_peaks_route_cover_activation' AND NOT tgisinternal) AS cover_trigger_absent,
  EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='session_routes'::regclass AND attname='is_primary' AND NOT attisdropped) AS session_primary_ready`;
export async function readPreflight(client: Pick<Client, 'query'>, segments: Segment[], activate: boolean): Promise<LivePreflight> {
  await client.query('BEGIN READ ONLY');
  try {
    const schema = (await client.query(SCHEMA_PREFLIGHT)).rows[0];
    if (schema?.lease_bound_worker) throw new Error('WA bulk loading requires an operator connection; standard factory/reviewer logins require their own candidate leases');
    if (!schema?.rebuild_ready || !schema.activation_ready) throw new Error('Apply the segment model and WA activation migrations before loading');
    if (activate && !schema.cover_trigger_absent) throw new Error('--activate refused: trg_enforce_peaks_route_cover_activation must be absent (PR #235)');
    if (activate && !schema.session_primary_ready) throw new Error('session_routes.is_primary is missing; install its companion migration');
    const destinations = (await client.query(`SELECT id,name,features::text[],ST_X(location::geometry) AS lng,ST_Y(location::geometry) AS lat,external_ids
      FROM destinations WHERE owner='peaks' AND state_code='WA' AND location IS NOT NULL`)).rows as PeaksDestination[];
    const routes = (await client.query(`SELECT r.id,r.name,r.status,r.owner,r.kind,r.objective_destination_id,
      ST_AsGeoJSON(r.path::geometry)::jsonb AS path,ST_AsGeoJSON(ST_StartPoint(r.path::geometry))::jsonb AS start,ST_AsGeoJSON(ST_EndPoint(r.path::geometry))::jsonb AS end,
      EXISTS(SELECT 1 FROM trail_catalog_review_jobs j WHERE j.route_id=r.id AND j.state IN ('approved','publish_leased','published','verify_leased','verified','rejected')) AS catalog_reviewed,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',destination_id,'ordinal',ordinal) ORDER BY ordinal) FROM route_destinations WHERE route_id=r.id),'[]') AS destinations
      FROM routes r WHERE owner='peaks' AND status IN ('active','pending') AND (state_code='WA' OR ST_Intersects(r.path::geometry,ST_MakeEnvelope(-125,45.5,-116.8,49.1,4326)))`)).rows as PeaksRoute[];
    const overlaps: ExistingOverlap[] = [];
    for (let i = 0; i < segments.length; i += 100) {
      const result = await client.query(`WITH incoming AS (
        SELECT item->>'id' AS id,ST_SetSRID(ST_GeomFromGeoJSON(item->>'geometry'),4326)::geography AS path FROM jsonb_array_elements($1::jsonb) item
      ), nearby AS (
        SELECT incoming.id AS new_id,s.*,ST_Length(ST_CollectionExtract(ST_Intersection(ST_Force2D(incoming.path::geometry),ST_Buffer(s.path,15)::geometry),2)::geography)/NULLIF(ST_Length(incoming.path),0) AS coverage
        FROM incoming JOIN segments s ON ST_DWithin(incoming.path,s.path,15)
      ) SELECT s.new_id,s.id,s.name,s.display_name,s.description,s.kind,s.trail_names,s.provenance,ST_AsGeoJSON(s.path::geometry)::jsonb AS path,s.coverage,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'loader',r.provenance#>>'{wa_catalog,loader}',
          'reviewed',EXISTS(SELECT 1 FROM trail_catalog_review_jobs j WHERE j.route_id=r.id AND j.state IN ('approved','publish_leased','published','verify_leased','verified','rejected'))))
          FROM route_segments rs JOIN routes r ON r.id=rs.route_id WHERE rs.segment_id=s.id),'[]') AS routes
        FROM nearby s WHERE coverage>=0.8`, [JSON.stringify(segments.slice(i, i + 100).map(s => ({ id: s.id, geometry: { type: 'LineString', coordinates: s.coords } })))]);
      overlaps.push(...result.rows as ExistingOverlap[]);
    }
    await client.query('COMMIT'); return { destinations, routes, overlaps, cover_trigger_absent: schema.cover_trigger_absent };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
export function sameXY(a: Coord[], b: Coord[]): boolean { return a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-9 && Math.abs(p[1] - b[i][1]) < 1e-9); }
export interface SegmentBinding { refs: ComposedRoute['segments']; segments: Map<string, Segment>; reused: string[]; blocked: string[] }
export function bindExistingSegments(row: ComposedRoute, source: Map<string, Segment>, overlaps: ExistingOverlap[], superseded: Set<string>, currentIds: Set<string>): SegmentBinding {
  const result: SegmentBinding = { refs: [], segments: new Map(source), reused: [], blocked: [] };
  for (const ref of row.segments) {
    const s = source.get(ref.id)!, candidates = overlaps.filter(o => o.new_id === ref.id);
    const reusable = candidates.filter(o => o.routes.some(r => r.reviewed) || o.id === ref.id && o.routes.length > 0 && o.routes.every(r => currentIds.has(r.id) && r.loader === IMPORT_MARKER))
      .map(o => ({ o, coords: o.path.coordinates.map(c => c.slice(0, 2) as Coord) }))
      .filter(x => sameXY(s.coords, x.coords) || sameXY(s.coords, [...x.coords].reverse())).sort((a, b) => a.o.id.localeCompare(b.o.id))[0];
    if (reusable) {
      const { o, coords } = reusable, forward = sameXY(s.coords, coords);
      const replacement: Segment = { ...s, id: o.id, name: o.name, display_name: o.display_name, description: o.description, kind: o.kind as Segment['kind'],
        trail_names: o.trail_names, coords, start_node: forward ? s.start_node : s.end_node, end_node: forward ? s.end_node : s.start_node, node_ids: forward ? [...s.node_ids] : [...s.node_ids].reverse(), provenance: o.provenance };
      result.segments.set(o.id, replacement); result.reused.push(o.id);
      result.refs.push({ id: o.id, direction: forward ? ref.direction : ref.direction === 'forward' ? 'reverse' : 'forward' }); continue;
    }
    for (const o of candidates) if (!o.routes.length || !o.routes.every(r => !r.reviewed && superseded.has(r.id))) {
      result.blocked.push(`${s.id} overlaps ${o.id}: ${o.routes.some(r => r.reviewed) ? 'reviewed geometry cannot replace the whole segment exactly; split/recompose needed' : 'not owned solely by legacy routes this load supersedes'}`);
    }
    result.refs.push(ref);
  }
  result.reused = [...new Set(result.reused)]; return result;
}
export function bindingHash(binding: SegmentBinding): string { return digest(binding.refs.map(r => [r, binding.segments.get(r.id)!.coords])); }
