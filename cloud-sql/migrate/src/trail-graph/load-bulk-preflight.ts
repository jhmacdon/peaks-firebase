import type { Client } from 'pg';
import type { PeaksDestination } from './catalog-types';
import type { Provenance } from './types';

export interface StoredBulkSegment {
  id: string; name: string | null; display_name: string | null; description: string | null; kind: string;
  provenance: Provenance; path: { coordinates: number[][] }; path_hash?: string; complete: boolean;
}
export interface BulkPreflight {
  ready: boolean; lease_bound_worker: boolean; cover_trigger_absent: boolean;
  destinations: PeaksDestination[];
  routes: { id: string; status: string; loader: string | null; state_code: string; composition_hash: string | null; reviewed: boolean }[];
  segments: StoredBulkSegment[];
  overlaps: { new_id: string; existing_id: string }[];
}

// A single read-only statement per batch. Clip long lines before buffering, keep
// Triple Crown exclusions, and choose UTM from longitude (including eastern ID).
export const BULK_PREFLIGHT_SQL = `WITH incoming AS MATERIALIZED (
  SELECT i.*,ST_SetSRID(ST_GeomFromGeoJSON(i.geometry),4326)::geography AS path
  FROM jsonb_to_recordset($1::jsonb) AS i(id text,geometry text,frozen boolean)
), projected AS MATERIALIZED (
  SELECT i.*,ST_Expand(ST_Envelope(ST_Force2D(path::geometry)),0.001) AS box,
    32600+LEAST(60,GREATEST(1,floor((ST_X(ST_Centroid(path::geometry))+180)/6)::integer+1)) AS srid
  FROM incoming i
), places AS MATERIALIZED (
  SELECT p.*,ST_SetSRID(ST_MakePoint(p.lng,p.lat),4326)::geography AS location
  FROM jsonb_to_recordset($3::jsonb) AS p(id text,lng float8,lat float8,external_ids jsonb)
), overlap_rows AS (
  SELECT i.id AS new_id,s.id AS existing_id FROM projected i JOIN segments s
    ON s.id NOT LIKE 'triple-crown-%' AND ST_DWithin(i.path,s.path,15)
    -- Skip only this state's own loader rows. Washington and neighbouring
    -- bulk states share the marker; border trails must still count as overlaps.
    AND NOT (COALESCE(s.provenance#>>'{wa_catalog,loader}'=$4,false) AND s.state_code=$6)
    -- Frozen assets can outlive their old route. Exact XYZ is checked before
    -- rebuilding; the route arm below still blocks overlapping live Peaks rows.
    AND NOT (i.frozen AND s.id=i.id)
  WHERE ST_Length(ST_CollectionExtract(ST_Intersection(ST_Transform(ST_Force2D(i.path::geometry),i.srid),
      ST_Buffer(ST_Transform(ST_ClipByBox2D(ST_Force2D(s.path::geometry),i.box),i.srid),15)),2))
    >=0.8*ST_Length(ST_Transform(ST_Force2D(i.path::geometry),i.srid))
  UNION
  SELECT i.id,r.id FROM projected i JOIN routes r
    ON r.owner='peaks' AND r.status IN ('pending','active') AND r.id NOT LIKE 'triple-crown-%'
    AND NOT (COALESCE(r.provenance#>>'{wa_catalog,loader}'=$4,false) AND r.state_code=$6) AND ST_DWithin(i.path,r.path,15)
  WHERE ST_Length(ST_CollectionExtract(ST_Intersection(ST_Transform(ST_Force2D(i.path::geometry),i.srid),
      ST_Buffer(ST_Transform(ST_ClipByBox2D(ST_Force2D(r.path::geometry),i.box),i.srid),15)),2))
    >=0.8*ST_Length(ST_Transform(ST_Force2D(i.path::geometry),i.srid))
)
SELECT to_regprocedure('rebuild_route_paths(text[])') IS NOT NULL
  AND to_regprocedure('refresh_route_derivations(text[])') IS NOT NULL
  AND to_regprocedure('activate_wa_catalog_routes(text[])') IS NOT NULL
  AND to_regprocedure('wa_catalog_provenance_elevation(jsonb,jsonb)') IS NOT NULL
  AND has_function_privilege(current_user,'rebuild_route_paths(text[])','EXECUTE')
  AND has_function_privilege(current_user,'refresh_route_derivations(text[])','EXECUTE')
  AND has_function_privilege(current_user,'activate_wa_catalog_routes(text[])','EXECUTE') AS ready,
  (pg_has_role(session_user,'peaks-route-factory','member') OR pg_has_role(session_user,'peaks-route-reviewer','member')) AS lease_bound_worker,
  NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='routes'::regclass AND tgname='trg_enforce_peaks_route_cover_activation' AND NOT tgisinternal) AS cover_trigger_absent,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'features',d.features,'lng',ST_X(d.location::geometry),'lat',ST_Y(d.location::geometry),'external_ids',d.external_ids))
    -- Three index lookups, not one OR: the OR scanned every destination (90 s+
    -- for 20 routes, then an out-of-memory kill on db-f1-micro at 200).
    FROM destinations d WHERE d.owner='peaks' AND d.id IN (
      SELECT unnest($5::text[])
      UNION SELECT near.id FROM places p JOIN destinations near ON ST_DWithin(near.location,p.location,400)
      UNION SELECT same.id FROM places p CROSS JOIN LATERAL jsonb_each_text(p.external_ids) osm
        JOIN destinations same ON same.external_ids @> jsonb_build_object(osm.key,osm.value))),'[]') AS destinations,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'state_code',r.state_code,'loader',r.provenance#>>'{wa_catalog,loader}',
    'composition_hash',r.provenance#>>'{wa_catalog,composition_hash}',
    'reviewed',EXISTS(SELECT 1 FROM trail_catalog_review_jobs WHERE route_id=r.id) OR EXISTS(SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=r.id)))
    FROM routes r WHERE r.id=ANY($2::text[])),'[]') AS routes,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'display_name',s.display_name,'description',s.description,'kind',s.kind,
    'provenance',s.provenance,'path',ST_AsGeoJSON(s.path::geometry,15)::jsonb,'path_hash',md5(ST_AsEWKB(s.path::geometry)),
    'complete',s.gain IS NOT NULL AND s.gain_loss IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ST_DumpPoints(s.path::geometry) p
      WHERE ST_Z((p).geom) IS NULL OR ST_Z((p).geom)=0 OR NOT(ST_Z((p).geom) BETWEEN -500 AND 9000))))
    FROM segments s WHERE s.id IN (SELECT id FROM incoming)),'[]') AS segments,
  COALESCE((SELECT jsonb_agg(o) FROM overlap_rows o),'[]') AS overlaps`;

export async function readBulkPreflight(client: Pick<Client, 'query'>, values: unknown[], activate: boolean): Promise<BulkPreflight> {
  const result = (await client.query(BULK_PREFLIGHT_SQL, values)).rows[0] as BulkPreflight | undefined;
  if (!result?.ready) throw new Error('Install the segment model, source bundles and 20261018_bulk_catalog_load.sql before apply');
  if (result.lease_bound_worker) throw new Error('Bulk loading requires an operator connection; factory/reviewer logins require their candidate leases');
  if (activate && !result.cover_trigger_absent) throw new Error('--activate refused: trg_enforce_peaks_route_cover_activation must be absent');
  return result;
}
