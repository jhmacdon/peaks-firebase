-- Bulk graph-catalog loading: defer only derived facts within a transaction.
-- Guards, rights checks, graph checks and publish checks still run on every write.
-- Fixed recurring cost: $0; no new service, table, index or table rewrite.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Keep each existing trigger body verbatim after this transaction-local opt-out.
-- 20261015_route_covers.sql and 20261015_segment_model_v2.sql (on main) redefine
-- none of these four; 20261016 and 20261017 do not touch them either.
-- Source: 20261012_trail_catalog_metadata.sql.
CREATE OR REPLACE FUNCTION refresh_route_catalog_derived_metadata()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('peaks.defer_route_derivations', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.search_name := NULLIF(peaks_search_name(NEW.name), '');
  IF NEW.slug IS NULL AND NEW.search_name IS NOT NULL THEN
    NEW.slug := peaks_route_catalog_slug(NEW.name, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION refresh_route_catalog_derived_metadata() OWNER TO postgres;

CREATE OR REPLACE FUNCTION refresh_route_catalog_estimates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('peaks.defer_route_derivations', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.difficulty := peaks_route_difficulty(NEW.distance, NEW.gain, NEW.gain_loss,
                                         peaks_route_max_grade(NEW.path), NEW.shape);
  NEW.est_moving_seconds := peaks_route_est_moving_seconds(NEW.path, NEW.shape);
  RETURN NEW;
END;
$$;
ALTER FUNCTION refresh_route_catalog_estimates() OWNER TO postgres;

-- Source: 20260810_route_area_write_invariant.sql.
CREATE OR REPLACE FUNCTION refresh_route_area_links_on_path_write()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('peaks.defer_route_derivations', true) = 'on' THEN
    RETURN NEW;
  END IF;
  PERFORM link_route_to_areas(NEW.id, true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION refresh_route_area_links_on_path_write() OWNER TO postgres;
-- 20260827_standard_route_worker_roles.sql hardened this function after its
-- body was defined. CREATE OR REPLACE resets these attributes; restore both.
ALTER FUNCTION refresh_route_area_links_on_path_write() SECURITY DEFINER;
ALTER FUNCTION refresh_route_area_links_on_path_write()
  SET search_path = pg_catalog, public, pg_temp;

-- Source: 20260803_route_elevation_backfill.sql.
CREATE OR REPLACE FUNCTION materialize_peaks_route_elevation_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('peaks.defer_route_derivations', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.elevation_string = encode_route_elevation_profile(NEW.path);
  RETURN NEW;
END;
$$;
ALTER FUNCTION materialize_peaks_route_elevation_profile() OWNER TO postgres;

-- Keep the existing loader marker so the existing immutable-marker and owned
-- activation guards apply to all states. The marker now also records its state.
-- All prior source, bundle and import-metadata checks remain unchanged.
CREATE OR REPLACE FUNCTION wa_catalog_valid_single_provenance(value JSONB) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof($1) IS DISTINCT FROM 'object' THEN false ELSE COALESCE(wa_catalog_valid_source_provenance($1-'wa_catalog') AND (
    CASE WHEN NOT($1?'wa_catalog') THEN true WHEN jsonb_typeof($1->'wa_catalog') IS DISTINCT FROM 'object' THEN false ELSE (
      $1#>>'{wa_catalog,loader}'='wa-trail-graph-v2'
      AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys($1->'wa_catalog') k WHERE k NOT IN ('loader','compose_status','composition_hash','approximate','notes','waypoint_names','loaded_binding_hash','dropped_links','state_code'))
      AND (NOT($1->'wa_catalog'?'state_code') OR (jsonb_typeof($1#>'{wa_catalog,state_code}')='string' AND $1#>>'{wa_catalog,state_code}' IN ('WA','OR','CA','ID')))
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

-- Apply the skipped work to just this chunk. This does not clear the caller's
-- setting: loading and path rebuilding can remain deferred until COMMIT.
-- Only the profile trigger has a WHEN condition (owner = 'peaks'); preserve it.
-- Updating derived columns does not write path/name again or repeat derivations.
CREATE OR REPLACE FUNCTION refresh_route_derivations(route_ids TEXT[])
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE candidate_route_id TEXT;
BEGIN
  IF route_ids IS NULL THEN
    RAISE EXCEPTION 'route_ids must not be NULL';
  END IF;
  -- Lock in ID order before reading paths or replacing area links.
  PERFORM 1 FROM routes r WHERE r.id = ANY(route_ids) ORDER BY r.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM unnest(route_ids) requested(id)
             WHERE id IS NULL OR NOT EXISTS (SELECT 1 FROM routes r WHERE r.id = requested.id)) THEN
    RAISE EXCEPTION 'route_ids contains a NULL or missing route';
  END IF;
  FOR candidate_route_id IN SELECT r.id FROM routes r WHERE r.id = ANY(route_ids) ORDER BY r.id LOOP
    PERFORM link_route_to_areas(candidate_route_id, true);
  END LOOP;
  UPDATE routes r SET
    elevation_string = CASE WHEN r.owner = 'peaks' THEN encode_route_elevation_profile(r.path)
                            ELSE r.elevation_string END,
    search_name = NULLIF(peaks_search_name(r.name), ''),
    slug = CASE WHEN r.slug IS NULL AND NULLIF(peaks_search_name(r.name), '') IS NOT NULL
                THEN peaks_route_catalog_slug(r.name, r.id) ELSE r.slug END,
    difficulty = peaks_route_difficulty(r.distance, r.gain, r.gain_loss,
                                       peaks_route_max_grade(r.path), r.shape),
    est_moving_seconds = peaks_route_est_moving_seconds(r.path, r.shape)
  WHERE r.id = ANY(route_ids);
END;
$$;
ALTER FUNCTION refresh_route_derivations(TEXT[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION refresh_route_derivations(TEXT[]) FROM PUBLIC, "peaks-api";
DO $$ BEGIN EXECUTE format('GRANT EXECUTE ON FUNCTION refresh_route_derivations(TEXT[]) TO %I', current_user); END $$;

-- Each exception block rolls back only that route's rebuild, including trigger
-- writes. The loader must reject any failure before refreshing or committing.
CREATE OR REPLACE FUNCTION rebuild_route_paths(route_ids TEXT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE candidate_route_id TEXT; results JSONB := '[]'::jsonb;
BEGIN
  IF route_ids IS NULL THEN
    RAISE EXCEPTION 'route_ids must not be NULL';
  END IF;
  FOREACH candidate_route_id IN ARRAY route_ids LOOP
    BEGIN
      IF candidate_route_id IS NULL OR NOT EXISTS (SELECT 1 FROM routes WHERE id = candidate_route_id) THEN
        RAISE EXCEPTION 'Route % does not exist', candidate_route_id;
      END IF;
      PERFORM rebuild_route_path(candidate_route_id);
      results := results || jsonb_build_array(jsonb_build_object('route_id', candidate_route_id, 'success', true));
    EXCEPTION WHEN OTHERS THEN
      results := results || jsonb_build_array(jsonb_build_object('route_id', candidate_route_id, 'success', false,
                                                                'error', SQLERRM, 'sqlstate', SQLSTATE));
    END;
  END LOOP;
  RETURN results;
END;
$$;
ALTER FUNCTION rebuild_route_paths(TEXT[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION rebuild_route_paths(TEXT[]) FROM PUBLIC, "peaks-api";
DO $$ BEGIN EXECUTE format('GRANT EXECUTE ON FUNCTION rebuild_route_paths(TEXT[]) TO %I', current_user); END $$;

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
      OR (r.state_code IN ('OR','CA','ID') AND r.id LIKE lower(r.state_code)||'-%'
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

-- This invoker wrapper calls the existing isolated owner's activation function.
-- It never sets status itself and cannot bypass its elevation or publish gates.
CREATE OR REPLACE FUNCTION activate_wa_catalog_routes(route_ids TEXT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE candidate_route_id TEXT; results JSONB := '[]'::jsonb;
BEGIN
  IF route_ids IS NULL THEN
    RAISE EXCEPTION 'route_ids must not be NULL';
  END IF;
  IF cardinality(route_ids) > 200 THEN
    RAISE EXCEPTION 'Activation chunks must contain at most 200 routes';
  END IF;
  FOREACH candidate_route_id IN ARRAY route_ids LOOP
    BEGIN
      PERFORM activate_wa_catalog_route(candidate_route_id);
      results := results || jsonb_build_array(jsonb_build_object('route_id', candidate_route_id, 'success', true));
    EXCEPTION WHEN OTHERS THEN
      results := results || jsonb_build_array(jsonb_build_object('route_id', candidate_route_id, 'success', false,
                                                                'error', SQLERRM, 'sqlstate', SQLSTATE));
    END;
  END LOOP;
  RETURN results;
END;
$$;
ALTER FUNCTION activate_wa_catalog_routes(TEXT[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION activate_wa_catalog_routes(TEXT[]) FROM PUBLIC, "peaks-api";
DO $$ BEGIN EXECUTE format('GRANT EXECUTE ON FUNCTION activate_wa_catalog_routes(TEXT[]) TO %I', current_user); END $$;

COMMIT;
