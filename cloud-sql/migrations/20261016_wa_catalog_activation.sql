-- WA graph catalog: one owned activation function, no per-route reviewer lane.
-- Fixed recurring cost: $0. The existing rematch queue and sweep do the work.
-- Requires the segment-model migration (rebuild_route_path) at load time.
-- PR #235 must remove the credited-cover activation trigger before activation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Keep the existing nine/eleven-field rights checks unchanged beneath a strict
-- import-metadata extension. Catalog notes never become route descriptions.
CREATE OR REPLACE FUNCTION wa_catalog_valid_source_provenance(value JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof($1) <> 'object'
      OR NOT $1 ?& ARRAY[
        'source_kind', 'source_url', 'license_name', 'license_url', 'attribution',
        'retrieved_at', 'osm_way_ids', 'osm_way_urls', 'contains_osm_geometry'
      ]
      OR jsonb_typeof($1->'source_kind') <> 'string'
      OR btrim($1->>'source_kind') !~ '^[a-z0-9][a-z0-9_-]*$'
      OR jsonb_typeof($1->'source_url') <> 'string'
      OR $1->>'source_url' !~ '^https?://[^[:space:]]+$'
      OR jsonb_typeof($1->'license_name') <> 'string'
      OR btrim($1->>'license_name') = ''
      OR jsonb_typeof($1->'license_url') <> 'string'
      OR $1->>'license_url' !~ '^https?://[^[:space:]]+$'
      OR jsonb_typeof($1->'attribution') <> 'string'
      OR btrim($1->>'attribution') = ''
      OR jsonb_typeof($1->'retrieved_at') <> 'string'
      OR $1->>'retrieved_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      OR jsonb_typeof($1->'contains_osm_geometry') <> 'boolean'
      OR jsonb_typeof($1->'osm_way_ids') <> 'array'
      OR jsonb_typeof($1->'osm_way_urls') <> 'array'
      OR ($1 ? 'elevation_source') <> ($1 ? 'elevation_profile')
      OR (
        $1 ? 'elevation_source'
        AND (
          jsonb_typeof($1->'elevation_source') <> 'string'
          OR btrim($1->>'elevation_source') = ''
          OR jsonb_typeof($1->'elevation_profile') <> 'string'
          OR $1->>'elevation_profile' NOT IN ('terrain', 'monotonic_ascent')
        )
      )
    THEN false
    ELSE
      (SELECT count(*) FROM jsonb_object_keys($1)) IN (9, 11)
      AND jsonb_array_length($1->'osm_way_ids')
          = jsonb_array_length($1->'osm_way_urls')
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements($1->'osm_way_ids')
          WITH ORDINALITY AS way_id(value, ordinal)
        JOIN jsonb_array_elements($1->'osm_way_urls')
          WITH ORDINALITY AS way_url(value, ordinal)
          USING (ordinal)
        WHERE jsonb_typeof(way_id.value) <> 'number'
           OR (way_id.value #>> '{}') !~ '^[1-9][0-9]*$'
           OR jsonb_typeof(way_url.value) <> 'string'
           OR (way_url.value #>> '{}') <>
              ('https://www.openstreetmap.org/way/' || (way_id.value #>> '{}'))
      )
      AND (
        ($1->>'contains_osm_geometry')::boolean
          = (jsonb_array_length($1->'osm_way_ids') > 0)
      )
      AND (
        NOT ($1->>'contains_osm_geometry')::boolean
        OR (
          $1->>'source_kind' = 'openstreetmap'
          AND $1->>'license_name' =
              'Open Data Commons Open Database License (ODbL) 1.0'
          AND $1->>'license_url' =
              'https://opendatacommons.org/licenses/odbl/1-0/'
          AND $1->>'attribution' = '© OpenStreetMap contributors'
        )
      )
  END;
$$;

CREATE OR REPLACE FUNCTION is_valid_route_provenance(value JSONB) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof($1) IS DISTINCT FROM 'object' THEN false ELSE COALESCE(wa_catalog_valid_source_provenance($1-'wa_catalog') AND (
    CASE WHEN NOT($1?'wa_catalog') THEN true WHEN jsonb_typeof($1->'wa_catalog') IS DISTINCT FROM 'object' THEN false ELSE ( $1#>>'{wa_catalog,loader}'='wa-trail-graph-v2'
      AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys($1->'wa_catalog') k
        WHERE k NOT IN ('loader','compose_status','composition_hash','approximate','notes','waypoint_names','loaded_binding_hash','dropped_links'))
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

CREATE TABLE IF NOT EXISTS wa_catalog_activation_receipts (
  route_id TEXT PRIMARY KEY REFERENCES routes(id),
  composition_hash TEXT NOT NULL CHECK(composition_hash ~ '^[a-f0-9]{64}$'),
  segment_ids TEXT[] NOT NULL, destination_ids TEXT[] NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS wa_catalog_supersedes (
  legacy_route_id TEXT PRIMARY KEY REFERENCES routes(id),
  route_id TEXT NOT NULL REFERENCES routes(id),
  superseded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK(legacy_route_id<>route_id)
);
REVOKE ALL ON wa_catalog_activation_receipts,wa_catalog_supersedes FROM PUBLIC,"peaks-api";
GRANT SELECT ON wa_catalog_activation_receipts TO "peaks-route-factory";
GRANT SELECT,INSERT ON wa_catalog_supersedes TO "peaks-route-factory";

DO $$ DECLARE created BOOLEAN:=false; BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='peaks-wa-catalog-publisher') THEN
    CREATE ROLE "peaks-wa-catalog-publisher" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    created:=true;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='peaks-wa-catalog-publisher'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls))
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='peaks-wa-catalog-publisher'::regrole
      OR(roleid='peaks-wa-catalog-publisher'::regrole AND(NOT created OR member<>current_user::regrole))) THEN
    RAISE EXCEPTION 'WA activation owner must be an isolated NOLOGIN role';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO "peaks-wa-catalog-publisher";
GRANT SELECT ON routes,route_segments,segments,route_destinations,destinations,destination_boundary_parts,trail_catalog_review_jobs,trail_catalog_candidate_jobs,wa_catalog_activation_receipts TO "peaks-wa-catalog-publisher";
GRANT UPDATE(status,updated_at) ON routes TO "peaks-wa-catalog-publisher";
-- PostgreSQL row locks require UPDATE on at least one column of each table.
-- The isolated owner has no login or members and exposes no graph-write API.
GRANT UPDATE(route_id) ON route_segments,route_destinations TO "peaks-wa-catalog-publisher";
GRANT UPDATE(id) ON segments,destinations TO "peaks-wa-catalog-publisher";
GRANT INSERT ON wa_catalog_activation_receipts TO "peaks-wa-catalog-publisher";
GRANT EXECUTE ON FUNCTION peaks_route_passes_publish_integrity(TEXT,TEXT,TEXT) TO "peaks-wa-catalog-publisher";

-- A replay must replace the function already owned by the isolated role.
-- Grant access before replacement; revoke it again after the ownership transfer.
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
  IF r.id IS NULL OR r.owner<>'peaks' OR r.state_code IS DISTINCT FROM 'WA' OR r.id NOT LIKE 'wa-%'
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
-- This bulk loader uses the migration operator, not the lease-bound standard
-- factory/reviewer logins. Grant after transfer so ALTER OWNER cannot rewrite
-- the operator's ACL entry to the isolated owner.
DO $$ BEGIN EXECUTE format('GRANT EXECUTE ON FUNCTION activate_wa_catalog_route(TEXT) TO %I',current_user); END $$;
DO $$ BEGIN EXECUTE format('REVOKE "peaks-wa-catalog-publisher" FROM %I',current_user); END $$;

CREATE OR REPLACE FUNCTION guard_wa_catalog_activation() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.provenance#>>'{wa_catalog,loader}'='wa-trail-graph-v2'
    AND NEW.provenance#>>'{wa_catalog,loader}' IS DISTINCT FROM 'wa-trail-graph-v2' THEN
    RAISE EXCEPTION 'WA loader provenance marker is immutable';
  END IF;
  IF NEW.provenance#>>'{wa_catalog,loader}'='wa-trail-graph-v2' AND NEW.status='active'
    AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
    AND current_user<>'peaks-wa-catalog-publisher' THEN
    RAISE EXCEPTION 'WA route activation requires activate_wa_catalog_route';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_wa_catalog_activation ON routes;
CREATE TRIGGER trg_guard_wa_catalog_activation BEFORE INSERT OR UPDATE ON routes FOR EACH ROW EXECUTE FUNCTION guard_wa_catalog_activation();

-- Pruning must preserve references from any table, including user lists and
-- session facts. Unknown composite foreign keys conservatively prevent deletion.
CREATE OR REPLACE FUNCTION wa_catalog_has_references(target regclass,target_id TEXT,ignored_relations regclass[] DEFAULT '{}'::regclass[]) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE fk RECORD; has_ref BOOLEAN;
BEGIN
  FOR fk IN SELECT c.conrelid,c.conkey,c.confkey,a.attname,referenced.attname AS referenced_name FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    JOIN pg_attribute referenced ON referenced.attrelid=c.confrelid AND referenced.attnum=c.confkey[1]
    WHERE c.contype='f' AND c.confrelid=target AND NOT(c.conrelid=ANY(ignored_relations)) LOOP
    IF cardinality(fk.conkey)<>1 OR cardinality(fk.confkey)<>1 OR fk.referenced_name<>'id' THEN RETURN true; END IF;
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE %I=$1)',fk.conrelid::regclass,fk.attname) INTO has_ref USING target_id;
    IF has_ref THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;
COMMIT;
