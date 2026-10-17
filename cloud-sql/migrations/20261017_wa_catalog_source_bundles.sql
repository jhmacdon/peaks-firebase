-- Explicit source bundles for graph + Peaks-owned legacy tails/connectors.
-- peaks-derived is a non-OSM Peaks rights leaf, just as peaks-legacy is. No row rewrite,
-- activation, contact-tolerance or geometry-check change. Fixed cost: $0/month.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Repeat the positional-parameter fix for clones where 20261016 already ran.
-- Keep the original rights rules and explicit way_id/way_url column aliases.
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

CREATE OR REPLACE FUNCTION wa_catalog_valid_single_provenance(value JSONB) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof($1) IS DISTINCT FROM 'object' THEN false ELSE COALESCE(wa_catalog_valid_source_provenance($1-'wa_catalog') AND (
    CASE WHEN NOT($1?'wa_catalog') THEN true WHEN jsonb_typeof($1->'wa_catalog') IS DISTINCT FROM 'object' THEN false ELSE (
      $1#>>'{wa_catalog,loader}'='wa-trail-graph-v2'
      AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys($1->'wa_catalog') k WHERE k NOT IN ('loader','compose_status','composition_hash','approximate','notes','waypoint_names','loaded_binding_hash','dropped_links'))
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

CREATE OR REPLACE FUNCTION is_valid_route_provenance(value JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE leaf JSONB; ids JSONB;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF NOT(value?'sources') THEN RETURN wa_catalog_valid_single_provenance(value); END IF;
  IF NOT wa_catalog_valid_single_provenance(value-'sources') OR jsonb_typeof(value->'sources') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(value->'sources') NOT BETWEEN 2 AND 128 THEN RETURN false; END IF;
  FOR leaf IN SELECT item FROM jsonb_array_elements(value->'sources') item LOOP
    -- Nine/eleven-field leaves only: no nested bundles, arbitrary metadata or
    -- weaker license checks. The original exact ODbL credit rule still applies.
    IF NOT COALESCE(wa_catalog_valid_source_provenance(leaf),false) THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT count(*)<>count(DISTINCT item) FROM jsonb_array_elements(value->'sources') item) THEN RETURN false; END IF;
  IF (value-ARRAY['sources','wa_catalog','osm_way_ids','osm_way_urls']) IS DISTINCT FROM
    ((value->'sources'->0)-ARRAY['osm_way_ids','osm_way_urls']) THEN RETURN false; END IF;
  IF (value->>'contains_osm_geometry')::boolean IS DISTINCT FROM
    (SELECT bool_or((item->>'contains_osm_geometry')::boolean) FROM jsonb_array_elements(value->'sources') item) THEN RETURN false; END IF;
  SELECT COALESCE(jsonb_agg(DISTINCT way ORDER BY way),'[]') INTO ids
    FROM jsonb_array_elements(value->'sources') src CROSS JOIN LATERAL jsonb_array_elements(src->'osm_way_ids') way;
  RETURN (value->'osm_way_ids') @> ids AND ids @> (value->'osm_way_ids');
END $$;

CREATE OR REPLACE FUNCTION wa_catalog_provenance_sources(value JSONB) RETURNS JSONB
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof($1->'sources')='array' THEN $1->'sources' ELSE jsonb_build_array($1-'wa_catalog') END
$$;

CREATE OR REPLACE FUNCTION wa_catalog_leaf_compatible(segment_source JSONB,route_source JSONB) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN COALESCE(wa_catalog_valid_source_provenance($1),false) AND COALESCE(wa_catalog_valid_source_provenance($2),false) THEN
    $1->>'source_kind'=$2->>'source_kind'
    AND $1->'contains_osm_geometry'=$2->'contains_osm_geometry'
    AND $1->>'license_name'=$2->>'license_name'
    AND $1->>'license_url'=$2->>'license_url'
    AND $1->>'attribution'=$2->>'attribution'
    AND $1->>'elevation_source' IS NOT DISTINCT FROM $2->>'elevation_source'
    AND $1->>'elevation_profile' IS NOT DISTINCT FROM $2->>'elevation_profile'
    AND CASE WHEN ($2->>'contains_osm_geometry')::boolean THEN
      jsonb_array_length($1->'osm_way_ids')>0 AND ($1->'osm_way_ids') <@ ($2->'osm_way_ids')
      WHEN $2->>'source_kind'='usfs-nfs-trails' THEN
        $2->>'license_name'='U.S. Government work under 17 U.S.C. § 105'
        AND $2->>'license_url'='https://www.govinfo.gov/content/pkg/USCODE-2023-title17/html/USCODE-2023-title17-chap1-sec105.htm'
        AND $2->>'attribution'='USDA Forest Service'
        AND trail_catalog_usfs_feature_ids($1->>'source_url') <@ trail_catalog_usfs_feature_ids($2->>'source_url')
      ELSE $1->>'source_url'=$2->>'source_url' END
    ELSE false END
$$;

CREATE OR REPLACE FUNCTION route_segment_provenance_compatible(segment_provenance JSONB,route_provenance JSONB) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN COALESCE(is_valid_route_provenance($1),false) AND COALESCE(is_valid_route_provenance($2),false) THEN
    NOT EXISTS(SELECT 1 FROM jsonb_array_elements(wa_catalog_provenance_sources($1)) seg
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(wa_catalog_provenance_sources($2)) route
        WHERE wa_catalog_leaf_compatible(seg,route))) ELSE false END
$$;

CREATE OR REPLACE FUNCTION route_segments_cover_provenance(candidate_route_id TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE((SELECT CASE WHEN is_valid_route_provenance(r.provenance) THEN
    EXISTS(SELECT 1 FROM route_segments WHERE route_id=r.id)
    AND NOT EXISTS(SELECT 1 FROM route_segments rs LEFT JOIN segments s ON s.id=rs.segment_id
      WHERE rs.route_id=r.id AND NOT route_segment_provenance_compatible(s.provenance,r.provenance))
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(wa_catalog_provenance_sources(r.provenance)) claim
      WHERE NOT EXISTS(SELECT 1 FROM route_segments rs JOIN segments s ON s.id=rs.segment_id
        CROSS JOIN LATERAL jsonb_array_elements(wa_catalog_provenance_sources(s.provenance)) actual
        WHERE rs.route_id=r.id AND wa_catalog_leaf_compatible(actual,claim))
      OR NOT(CASE WHEN claim->>'source_kind'='usfs-nfs-trails' THEN
        trail_catalog_usfs_feature_ids(claim->>'source_url') <@ ARRAY(
          SELECT DISTINCT feature_id FROM route_segments rs JOIN segments s ON s.id=rs.segment_id
          CROSS JOIN LATERAL jsonb_array_elements(wa_catalog_provenance_sources(s.provenance)) actual
          CROSS JOIN LATERAL unnest(trail_catalog_usfs_feature_ids(actual->>'source_url')) feature_id
          WHERE rs.route_id=r.id AND wa_catalog_leaf_compatible(actual,claim))
      ELSE (claim->'osm_way_ids') <@ COALESCE((SELECT jsonb_agg(DISTINCT way)
        FROM route_segments rs JOIN segments s ON s.id=rs.segment_id
        CROSS JOIN LATERAL jsonb_array_elements(wa_catalog_provenance_sources(s.provenance)) actual
        CROSS JOIN LATERAL jsonb_array_elements(actual->'osm_way_ids') way
        WHERE rs.route_id=r.id AND wa_catalog_leaf_compatible(actual,claim)),'[]'::jsonb) END))
    ELSE false END FROM routes r WHERE r.id=$1),false)
$$;

CREATE OR REPLACE FUNCTION wa_catalog_union_provenance(input_sources JSONB) RETURNS JSONB
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
WITH leaves AS (
  SELECT leaf FROM jsonb_array_elements($1) item CROSS JOIN LATERAL jsonb_array_elements(wa_catalog_provenance_sources(item)) leaf
), keyed AS (
  SELECT leaf,jsonb_build_array(leaf->'source_kind',leaf->'license_name',leaf->'license_url',leaf->'attribution',leaf->'contains_osm_geometry',
    CASE WHEN (leaf->>'contains_osm_geometry')::boolean THEN NULL ELSE leaf->'source_url' END,leaf->'elevation_source',leaf->'elevation_profile') AS key FROM leaves
), grouped AS (
  SELECT key,(array_agg(leaf ORDER BY leaf->>'retrieved_at' DESC,leaf->>'source_url'))[1] AS sample FROM keyed GROUP BY key
), combined AS (
  SELECT grouped.key,jsonb_set(jsonb_set(sample,'{osm_way_ids}',ids.ways),'{osm_way_urls}',COALESCE((SELECT jsonb_agg('https://www.openstreetmap.org/way/'||(way#>>'{}') ORDER BY way) FROM jsonb_array_elements(ids.ways) way),'[]')) AS src
  FROM grouped CROSS JOIN LATERAL (SELECT COALESCE(jsonb_agg(DISTINCT way ORDER BY way),'[]') AS ways FROM keyed k
    CROSS JOIN LATERAL jsonb_array_elements(k.leaf->'osm_way_ids') way WHERE k.key=grouped.key) ids
), sources AS (
  SELECT jsonb_agg(src ORDER BY (src->>'contains_osm_geometry')::boolean DESC,key) AS items FROM combined
), ids AS (
  SELECT COALESCE(jsonb_agg(DISTINCT way ORDER BY way),'[]') AS ways FROM leaves CROSS JOIN LATERAL jsonb_array_elements(leaf->'osm_way_ids') way
), header AS (
  SELECT jsonb_set(jsonb_set(items->0,'{osm_way_ids}',ways),'{osm_way_urls}',COALESCE((SELECT jsonb_agg('https://www.openstreetmap.org/way/'||(way#>>'{}') ORDER BY way) FROM jsonb_array_elements(ids.ways) way),'[]')) AS src,items FROM sources CROSS JOIN ids
)
SELECT src||CASE WHEN jsonb_array_length(items)>1 THEN jsonb_build_object('sources',items) ELSE '{}'::jsonb END FROM header
$$;

CREATE OR REPLACE FUNCTION wa_catalog_provenance_elevation(value JSONB,elevation JSONB) RETURNS JSONB
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT wa_catalog_union_provenance(jsonb_agg((leaf-ARRAY['elevation_source','elevation_profile'])||$2))
    ||CASE WHEN $1?'wa_catalog' THEN jsonb_build_object('wa_catalog',$1->'wa_catalog') ELSE '{}'::jsonb END
  FROM jsonb_array_elements(wa_catalog_provenance_sources($1)) leaf
$$;

CREATE TABLE IF NOT EXISTS wa_catalog_rebase_receipts (
  route_id TEXT PRIMARY KEY REFERENCES routes(id),
  source_hash TEXT NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  binding_hash TEXT NOT NULL CHECK(binding_hash ~ '^[a-f0-9]{64}$'),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON wa_catalog_rebase_receipts FROM PUBLIC,"peaks-api","peaks-route-factory","peaks-route-reviewer";
-- The migration operator owns receipts. Insertion happens only after the route
-- transaction's source, ordered-XY, elevation and active-integrity checks pass.
-- peaks_route_passes_publish_integrity itself is deliberately unchanged.

-- Retire only the four approved, never-reviewed pending pilot candidates.
-- The migration operator owns this entry point. Receipts and source artifacts
-- remain; no application/factory/reviewer role can invoke this repair.
CREATE OR REPLACE FUNCTION retire_wa_catalog_pilot(p_route_id TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job trail_catalog_candidate_jobs%ROWTYPE; r routes%ROWTYPE; expected_name TEXT;
  old_segment_ids TEXT[]; removed_ids TEXT[]; detached_segments INTEGER; detached_places INTEGER; table_owner NAME;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO table_owner FROM pg_class WHERE oid='public.trail_catalog_candidate_jobs'::regclass;
  IF session_user<>table_owner OR current_user<>table_owner
    OR pg_has_role(session_user,'peaks-route-factory','member') OR pg_has_role(session_user,'peaks-route-reviewer','member') THEN
    RAISE EXCEPTION 'Pilot retirement requires the candidate table owner operator login';
  END IF;
  SELECT approved.name INTO expected_name FROM (VALUES
    ('trail-6dfd43dc-8f23-4791-ab00-570049a1c39b','Skyline Loop (Paradise)'),
    ('trail-f39e1eac-83f9-4ce7-b870-e10c04f396b0','Lake Serene Trail'),
    ('trail-e7e610fd-b4be-4b67-94c5-bc7646cfb346','Rattlesnake Ledge via Rattlesnake Ledge Trail'),
    ('trail-6391bc0f-8687-4bc8-b465-a2add6d99d58','Lake Twentytwo via Lake Twenty Two Trail')
  ) approved(id,name) WHERE approved.id=p_route_id;
  IF expected_name IS NULL THEN RAISE EXCEPTION 'Route is not an approved WA pilot'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wa_trail_catalog_loader',0));
  SELECT * INTO job FROM trail_catalog_candidate_jobs WHERE proposed_route_id=p_route_id FOR UPDATE;
  SELECT * INTO r FROM routes WHERE id=p_route_id FOR UPDATE;
  IF job.source_key IS NULL AND r.id IS NULL THEN RETURN jsonb_build_object('outcome','not_present','route_id',p_route_id); END IF;
  IF job.source_key IS NULL OR r.id IS NULL OR job.batch_key IS DISTINCT FROM 'wa-cascades-20261013'
    OR r.owner IS DISTINCT FROM 'peaks' OR r.name IS DISTINCT FROM expected_name
    OR job.artifact#>>'{candidate,input,name}' IS DISTINCT FROM expected_name THEN
    RAISE EXCEPTION 'Pilot identity, batch or source receipt differs from approval';
  END IF;
  -- The route row lock also blocks new FK-backed user/review links until commit.
  IF EXISTS(SELECT 1 FROM trail_catalog_review_jobs WHERE route_id=p_route_id OR source_key=job.source_key)
    OR EXISTS(SELECT 1 FROM wa_catalog_activation_receipts WHERE route_id=p_route_id)
    OR EXISTS(SELECT 1 FROM session_routes WHERE route_id=p_route_id)
    OR EXISTS(SELECT 1 FROM list_routes WHERE route_id=p_route_id)
    OR EXISTS(SELECT 1 FROM plan_routes WHERE route_id=p_route_id)
    OR EXISTS(SELECT 1 FROM trip_report_routes WHERE route_id=p_route_id) THEN
    RAISE EXCEPTION 'Pilot has review/publication history or user references; retirement refused';
  END IF;
  IF job.state='rejected' AND job.route_id IS NULL AND job.rejection_reason='superseded_by_wa_graph_catalog'
    AND job.result#>>'{wa_graph_retirement,route_id}'=p_route_id AND r.status='superseded'
    AND NOT EXISTS(SELECT 1 FROM route_segments WHERE route_id=p_route_id)
    AND NOT EXISTS(SELECT 1 FROM route_destinations WHERE route_id=p_route_id) THEN
    RETURN jsonb_build_object('outcome','already_retired','route_id',p_route_id);
  END IF;
  IF job.state IS DISTINCT FROM 'pending' OR job.route_id IS DISTINCT FROM p_route_id OR r.status IS DISTINCT FROM 'pending'
    OR job.lease_owner IS NOT NULL OR job.lease_token IS NOT NULL OR job.lease_expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only an unleased pending candidate with a pending route may retire';
  END IF;
  PERFORM 1 FROM route_segments WHERE route_id=p_route_id ORDER BY ordinal FOR UPDATE;
  PERFORM 1 FROM route_destinations WHERE route_id=p_route_id ORDER BY ordinal FOR UPDATE;
  old_segment_ids:=ARRAY(SELECT DISTINCT segment_id FROM route_segments WHERE route_id=p_route_id ORDER BY segment_id);
  UPDATE trail_catalog_candidate_jobs SET state='rejected',route_id=NULL,rejection_reason='superseded_by_wa_graph_catalog',updated_at=now(),
    result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('wa_graph_retirement',jsonb_build_object(
      'route_id',p_route_id,'from_state','pending','reason','superseded_by_wa_graph_catalog','operator',session_user,
      'retired_at',clock_timestamp(),'segment_ids',to_jsonb(old_segment_ids))) WHERE source_key=job.source_key;
  UPDATE routes SET status='superseded',updated_at=now() WHERE id=p_route_id;
  DELETE FROM route_segments WHERE route_id=p_route_id; GET DIAGNOSTICS detached_segments=ROW_COUNT;
  DELETE FROM route_destinations WHERE route_id=p_route_id; GET DIAGNOSTICS detached_places=ROW_COUNT;
  WITH removed AS (DELETE FROM segments s WHERE s.id=ANY(old_segment_ids)
    AND NOT EXISTS(SELECT 1 FROM route_segments rs WHERE rs.segment_id=s.id)
    AND NOT EXISTS(SELECT 1 FROM wa_catalog_activation_receipts a WHERE s.id=ANY(a.segment_ids))
    AND NOT wa_catalog_has_references('public.segments'::regclass,s.id) RETURNING s.id)
    SELECT COALESCE(array_agg(id ORDER BY id),'{}'::text[]) INTO removed_ids FROM removed;
  RETURN jsonb_build_object('outcome','retired','route_id',p_route_id,'segments_detached',detached_segments,
    'destinations_detached',detached_places,'segments_deleted',to_jsonb(removed_ids),
    'segments_kept',to_jsonb(ARRAY(SELECT unnest(old_segment_ids) EXCEPT SELECT unnest(removed_ids))));
END $$;
REVOKE ALL ON FUNCTION retire_wa_catalog_pilot(TEXT) FROM PUBLIC,"peaks-api","peaks-route-factory","peaks-route-reviewer","peaks-trail-publisher","peaks-wa-catalog-publisher";

-- Base guard: 20261015_route_covers.sql, including its reviewed cover exemptions.
-- It rejects every non-activation status change, even for the table owner.
-- Add only this operator-only pending -> superseded exception.
-- Candidate job guards, receipt-removal guards and reviewed-link guards stay intact.
CREATE OR REPLACE FUNCTION guard_trail_catalog_pending_only() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE candidate_route_id TEXT:=CASE WHEN TG_OP='INSERT' THEN NEW.id ELSE OLD.id END; receipt_state TEXT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=candidate_route_id) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'catalog candidate route cannot be deleted outside explicit receipt repair'; END IF;
  IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'trail catalog candidate route identity is immutable'; END IF;
  -- BEGIN approved pilot retirement exception
  -- Retirement itself changes only status/updated_at; ordinary cover edits
  -- continue through the cover-aware reviewed-row check below.
  IF TG_OP='UPDATE' AND OLD.status='pending' AND NEW.status='superseded' AND OLD.owner='peaks'
    AND (to_jsonb(NEW)-ARRAY['status','updated_at'])=(to_jsonb(OLD)-ARRAY['status','updated_at'])
    AND session_user=pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='retire_wa_catalog_pilot(text)'::regprocedure))
    AND current_user=session_user AND (OLD.id,OLD.name) IN (
      ('trail-6dfd43dc-8f23-4791-ab00-570049a1c39b','Skyline Loop (Paradise)'),
      ('trail-f39e1eac-83f9-4ce7-b870-e10c04f396b0','Lake Serene Trail'),
      ('trail-e7e610fd-b4be-4b67-94c5-bc7646cfb346','Rattlesnake Ledge via Rattlesnake Ledge Trail'),
      ('trail-6391bc0f-8687-4bc8-b465-a2add6d99d58','Lake Twentytwo via Lake Twenty Two Trail'))
    AND EXISTS(SELECT 1 FROM trail_catalog_candidate_jobs j WHERE j.proposed_route_id=OLD.id AND j.batch_key='wa-cascades-20261013'
      AND j.state='rejected' AND j.route_id IS NULL AND j.rejection_reason='superseded_by_wa_graph_catalog'
      AND j.result#>>'{wa_graph_retirement,route_id}'=OLD.id AND j.result#>>'{wa_graph_retirement,from_state}'='pending'
      AND NOT EXISTS(SELECT 1 FROM trail_catalog_review_jobs review WHERE review.route_id=OLD.id OR review.source_key=j.source_key))
    AND NOT EXISTS(SELECT 1 FROM wa_catalog_activation_receipts WHERE route_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM session_routes WHERE route_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM list_routes WHERE route_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM plan_routes WHERE route_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM trip_report_routes WHERE route_id=OLD.id) THEN RETURN NEW;
  END IF;
  -- END approved pilot retirement exception
  SELECT state INTO receipt_state FROM trail_catalog_review_jobs WHERE route_id=candidate_route_id;
  IF TG_OP='UPDATE' AND receipt_state IN ('approved','publish_leased','published','verify_leased','verified','rejected')
    AND(to_jsonb(NEW)-ARRAY['status','updated_at','cover_image','cover_attribution','cover_attribution_url','cover_storage_path','cover_focal_x','cover_focal_y','cover_source','cover_updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','updated_at','cover_image','cover_attribution','cover_attribution_url','cover_storage_path','cover_focal_x','cover_focal_y','cover_source','cover_updated_at']) THEN RAISE EXCEPTION 'catalog reviewed route is immutable'; END IF;
  IF NEW.status='active' AND(TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    IF NOT trail_catalog_publish_authorized(candidate_route_id) THEN RAISE EXCEPTION 'trail catalog candidate requires independent review; direct activation is disabled except its owned activation function'; END IF;
  ELSIF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'catalog route transition requires explicit reviewed activation'; END IF;
  RETURN NEW;
END $$;
COMMIT;
