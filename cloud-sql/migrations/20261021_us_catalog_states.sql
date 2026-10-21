-- Extend graph-catalog provenance and activation to all 50 states and DC.
-- Copy the current functions from 20261018; change only their state lists.
-- Fixed recurring cost: $0; no new service, table, index or table rewrite.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION wa_catalog_valid_single_provenance(value JSONB) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof($1) IS DISTINCT FROM 'object' THEN false ELSE COALESCE(wa_catalog_valid_source_provenance($1-'wa_catalog') AND (
    CASE WHEN NOT($1?'wa_catalog') THEN true WHEN jsonb_typeof($1->'wa_catalog') IS DISTINCT FROM 'object' THEN false ELSE (
      $1#>>'{wa_catalog,loader}'='wa-trail-graph-v2'
      AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys($1->'wa_catalog') k WHERE k NOT IN ('loader','compose_status','composition_hash','approximate','notes','waypoint_names','loaded_binding_hash','dropped_links','state_code'))
      AND (NOT($1->'wa_catalog'?'state_code') OR (jsonb_typeof($1#>'{wa_catalog,state_code}')='string' AND $1#>>'{wa_catalog,state_code}' IN ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY')))
      AND (NOT($1->'wa_catalog'?'compose_status') OR $1#>>'{wa_catalog,compose_status}' IN ('ok','review'))
      AND (NOT($1->'wa_catalog'?'composition_hash') OR $1#>>'{wa_catalog,composition_hash}' ~ '^[a-f0-9]{64}$')
      AND (NOT($1->'wa_catalog'?'loaded_binding_hash') OR $1#>>'{wa_catalog,loaded_binding_hash}' ~ '^[a-f0-9]{64}$')
      AND (NOT($1->'wa_catalog'?'approximate') OR jsonb_typeof($1#>'{wa_catalog,approximate}')='boolean')
      AND (NOT($1->'wa_catalog'?'notes') OR CASE WHEN jsonb_typeof($1#>'{wa_catalog,notes}')='array' THEN
        NOT EXISTS(SELECT 1 FROM jsonb_array_elements($1#>'{wa_catalog,notes}') n WHERE jsonb_typeof(n)<>'string') ELSE false END)
      AND (NOT($1->'wa_catalog'?'waypoint_names') OR jsonb_typeof($1#>'{wa_catalog,waypoint_names}')='array')
      AND (NOT($1->'wa_catalog'?'dropped_links') OR CASE WHEN jsonb_typeof($1#>'{wa_catalog,dropped_links}')='array' THEN
        NOT EXISTS(SELECT 1 FROM jsonb_array_elements($1#>'{wa_catalog,dropped_links}') AS dropped(link) WHERE
          CASE WHEN jsonb_typeof(link)='object' THEN NOT(link ?& ARRAY['id','name','gap_m','reason'])
          OR (SELECT count(*) FROM jsonb_object_keys(link))<>4
          OR jsonb_typeof(link->'id') IS DISTINCT FROM 'string'
          OR jsonb_typeof(link->'name') IS DISTINCT FROM 'string' OR btrim(link->>'name')=''
          OR jsonb_typeof(link->'reason') IS DISTINCT FROM 'string' OR btrim(link->>'reason')=''
          OR CASE WHEN jsonb_typeof(link->'gap_m')='number' THEN (link->>'gap_m')::numeric<0 ELSE true END ELSE true END)
        ELSE false END)

    ) END),false) END
$$;
ALTER FUNCTION wa_catalog_valid_single_provenance(JSONB) OWNER TO postgres;

-- This pre-existing activation primitive must retain its isolated NOLOGIN
-- owner: guard_wa_catalog_activation checks that exact current_user. Changing
-- it to postgres would require weakening or replacing that guard. Every new
-- function and replaced derivation/source function in this migration belongs
-- to postgres; this existing primitive is the sole ownership exception.
-- Preserve every prior activation check; extend only state/ID eligibility.
-- Temporary membership permits CREATE OR REPLACE on Cloud SQL and is removed
-- before commit, exactly as in 20261016_wa_catalog_activation.sql.
DO $$ BEGIN EXECUTE format('GRANT "peaks-wa-catalog-publisher" TO %I',current_user); END $$;
GRANT CREATE ON SCHEMA public TO "peaks-wa-catalog-publisher";
CREATE OR REPLACE FUNCTION activate_wa_catalog_route(candidate_route_id TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r routes%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('wa_trail_catalog_loader',0));
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='routes'::regclass AND tgname='trg_enforce_peaks_route_cover_activation' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'trg_enforce_peaks_route_cover_activation must be absent before WA activation';
  END IF;
  SELECT * INTO r FROM routes WHERE id=candidate_route_id FOR UPDATE;
  IF r.id IS NULL OR r.owner<>'peaks' OR NOT COALESCE(
      (r.state_code='WA' AND r.id LIKE 'wa-%')
      OR (r.state_code IN ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WV','WI','WY') AND r.id LIKE lower(r.state_code)||'-%'
          AND r.provenance#>>'{wa_catalog,state_code}'=r.state_code), false)
    OR r.provenance#>>'{wa_catalog,loader}' IS DISTINCT FROM 'wa-trail-graph-v2'
    OR r.provenance#>>'{wa_catalog,compose_status}' IS DISTINCT FROM 'ok'
    OR COALESCE(r.provenance#>>'{wa_catalog,composition_hash}','') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Only a composer-ok WA loader route is eligible';
  END IF;
  IF r.status NOT IN ('pending','active') THEN RAISE EXCEPTION 'WA route must be pending or already active'; END IF;
  IF EXISTS(SELECT 1 FROM trail_catalog_review_jobs WHERE route_id=r.id)
    OR EXISTS(SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=r.id) THEN
    RAISE EXCEPTION 'Existing catalog review/candidate route requires its own supersede path';
  END IF;
  PERFORM 1 FROM route_segments WHERE route_id=r.id ORDER BY ordinal FOR SHARE;
  PERFORM 1 FROM segments s JOIN route_segments rs ON rs.segment_id=s.id WHERE rs.route_id=r.id ORDER BY s.id FOR SHARE OF s;
  PERFORM 1 FROM route_destinations WHERE route_id=r.id ORDER BY ordinal FOR SHARE;
  PERFORM 1 FROM destinations d JOIN route_destinations rd ON rd.destination_id=d.id WHERE rd.route_id=r.id ORDER BY d.id FOR SHARE OF d;
  IF r.gain IS NULL OR r.gain_loss IS NULL OR NOT(r.provenance?'elevation_source')
    OR EXISTS(SELECT 1 FROM ST_DumpPoints(r.path::geometry) p
      WHERE ST_Z((p).geom) IS NULL OR ST_Z((p).geom)=0 OR NOT(ST_Z((p).geom) BETWEEN -500 AND 9000))
    OR NOT COALESCE(route_elevation_profile_has_real_range(r.path),false) THEN
    RAISE EXCEPTION 'Elevation must be complete: no Z=0, finite real range and gain required';
  END IF;
  -- The existing predicate checks exact directed XYZ assembly, segment stats,
  -- canonical rights/source coverage, every linked summit <=5 m, kind-specific
  -- objective/endpoint/loop rules and the encoded elevation profile.
  IF NOT COALESCE(peaks_route_passes_publish_integrity(r.id,NULL,r.status),false) THEN
    RAISE EXCEPTION 'WA route failed canonical publish integrity';
  END IF;
  IF r.status='active' THEN
    IF NOT EXISTS(SELECT 1 FROM wa_catalog_activation_receipts a WHERE a.route_id=r.id AND a.composition_hash=r.provenance#>>'{wa_catalog,composition_hash}') THEN
      RAISE EXCEPTION 'Active WA route lacks its activation receipt';
    END IF;
    RETURN;
  END IF;
  INSERT INTO wa_catalog_activation_receipts(route_id,composition_hash,segment_ids,destination_ids)
    SELECT r.id,r.provenance#>>'{wa_catalog,composition_hash}',
      ARRAY(SELECT segment_id FROM route_segments WHERE route_id=r.id ORDER BY ordinal),
      ARRAY(SELECT destination_id FROM route_destinations WHERE route_id=r.id ORDER BY ordinal);
  UPDATE routes SET status='active',updated_at=now() WHERE id=r.id AND status='pending';
END $$;
REVOKE ALL ON FUNCTION activate_wa_catalog_route(TEXT) FROM PUBLIC,"peaks-api";
ALTER FUNCTION activate_wa_catalog_route(TEXT) OWNER TO "peaks-wa-catalog-publisher";
REVOKE CREATE ON SCHEMA public FROM "peaks-wa-catalog-publisher";
DO $$ BEGIN EXECUTE format('GRANT EXECUTE ON FUNCTION activate_wa_catalog_route(TEXT) TO %I',current_user); END $$;
DO $$ BEGIN EXECUTE format('REVOKE "peaks-wa-catalog-publisher" FROM %I',current_user); END $$;

COMMIT;
