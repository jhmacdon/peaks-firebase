-- OSM hiking grades raise route difficulty after enough graded ground.
-- Cost: $0/month fixed; no new service, index, route scan or table rewrite.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE segments ADD COLUMN IF NOT EXISTS osm_sac_scale TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'segments'::regclass AND conname = 'segments_osm_sac_scale_check') THEN
    ALTER TABLE segments ADD CONSTRAINT segments_osm_sac_scale_check CHECK (
      osm_sac_scale IN ('hiking', 'mountain_hiking', 'demanding_mountain_hiking',
                        'alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking')
    ) NOT VALID;
  END IF;
END $$;

-- The first argument is effort. A missing effort estimate stays missing.
CREATE OR REPLACE FUNCTION peaks_harder_difficulty(a TEXT, b TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN a IS NULL THEN NULL
    WHEN array_position(ARRAY['easy','moderate','hard','strenuous'], b)
       > array_position(ARRAY['easy','moderate','hard','strenuous'], a) THEN b
    ELSE a END;
$$;
ALTER FUNCTION peaks_harder_difficulty(TEXT, TEXT) OWNER TO postgres;

CREATE OR REPLACE FUNCTION peaks_route_terrain_floor(route_id TEXT)
RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT CASE
    WHEN sum(ST_Length(s.path)) FILTER (WHERE s.osm_sac_scale IN
      ('alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking')) >= 50 THEN 'hard'
    WHEN sum(ST_Length(s.path)) FILTER
      (WHERE s.osm_sac_scale = 'demanding_mountain_hiking') >= 50 THEN 'moderate'
    ELSE NULL END
  FROM segments s
  WHERE s.id IN (SELECT rs.segment_id FROM route_segments rs WHERE rs.route_id = $1)
    AND s.osm_sac_scale IN ('demanding_mountain_hiking', 'alpine_hiking',
                            'demanding_alpine_hiking', 'difficult_alpine_hiking');
$$;
ALTER FUNCTION peaks_route_terrain_floor(TEXT) OWNER TO postgres;

-- Preserve the loader's transaction-local deferral. A fresh route may have no
-- segment links yet; the loader refresh below applies the floor after linking.
CREATE OR REPLACE FUNCTION refresh_route_catalog_estimates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('peaks.defer_route_derivations', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.difficulty := peaks_harder_difficulty(
    peaks_route_difficulty(NEW.distance, NEW.gain, NEW.gain_loss,
                           peaks_route_max_grade(NEW.path), NEW.shape),
    peaks_route_terrain_floor(NEW.id));
  NEW.est_moving_seconds := peaks_route_est_moving_seconds(NEW.path, NEW.shape);
  RETURN NEW;
END;
$$;
ALTER FUNCTION refresh_route_catalog_estimates() OWNER TO postgres;

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
    difficulty = peaks_harder_difficulty(
      peaks_route_difficulty(r.distance, r.gain, r.gain_loss,
                             peaks_route_max_grade(r.path), r.shape),
      peaks_route_terrain_floor(r.id)),
    est_moving_seconds = peaks_route_est_moving_seconds(r.path, r.shape)
  WHERE r.id = ANY(route_ids);
END;
$$;
ALTER FUNCTION refresh_route_derivations(TEXT[]) OWNER TO postgres;

-- Keep checked metadata previews and refreshes on the same difficulty rule.
CREATE OR REPLACE FUNCTION peaks_route_catalog_metadata_plan(candidate_route_id TEXT)
RETURNS TABLE (
  route_id TEXT, kind TEXT, objective_destination_id TEXT,
  trailhead_destination_id TEXT, state_code TEXT, country_code TEXT,
  difficulty TEXT, est_moving_seconds INTEGER, errors TEXT[]
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  candidate routes%ROWTYPE;
  objective destinations%ROWTYPE;
  trailhead destinations%ROWTYPE;
  link_count INTEGER;
  segment_count INTEGER;
  segment_rows_valid BOOLEAN;
  ordinals_valid BOOLEAN;
  max_grade DOUBLE PRECISION;
BEGIN
  route_id := candidate_route_id;
  errors := '{}';
  SELECT r.* INTO candidate FROM routes r WHERE r.id = candidate_route_id;
  IF NOT FOUND THEN
    errors := ARRAY['route_missing']; RETURN NEXT; RETURN;
  END IF;
  IF candidate.owner <> 'peaks' THEN errors := array_append(errors, 'route_not_catalog'); END IF;
  IF candidate.status NOT IN ('active', 'pending') THEN errors := array_append(errors, 'route_not_current'); END IF;
  IF candidate.kind IS NOT NULL AND candidate.kind <> 'summit' THEN
    errors := array_append(errors, 'kind_requires_review');
  END IF;
  IF NULLIF(peaks_search_name(candidate.name), '') IS NULL THEN
    errors := array_append(errors, 'route_name_missing');
  END IF;
  IF cardinality(errors) > 0 THEN RETURN NEXT; RETURN; END IF;

  SELECT count(*)::integer, count(*) = count(DISTINCT rd.ordinal)
    AND min(rd.ordinal) = 0 AND max(rd.ordinal) = count(*) - 1
  INTO link_count, ordinals_valid
  FROM route_destinations rd WHERE rd.route_id = candidate_route_id;
  IF link_count < 2 OR NOT COALESCE(ordinals_valid, false) THEN
    errors := array_append(errors, 'destination_ordinals_invalid');
  END IF;
  SELECT count(*)::integer, count(*) = count(DISTINCT rs.ordinal)
    AND min(rs.ordinal) = 0 AND max(rs.ordinal) = count(*) - 1
    AND bool_and(s.id IS NOT NULL)
  INTO segment_count, segment_rows_valid
  FROM route_segments rs LEFT JOIN segments s ON s.id = rs.segment_id
  WHERE rs.route_id = candidate_route_id;
  IF segment_count < 1 OR NOT COALESCE(segment_rows_valid, false) THEN
    errors := array_append(errors, 'segments_missing_or_invalid');
  END IF;
  SELECT d.* INTO trailhead FROM route_destinations rd
  JOIN destinations d ON d.id = rd.destination_id
  WHERE rd.route_id = candidate_route_id AND rd.ordinal = 0
    AND 'trailhead'::destination_feature = ANY(d.features)
  ORDER BY d.id LIMIT 1;
  IF NOT FOUND THEN errors := array_append(errors, 'first_trailhead_missing'); END IF;
  SELECT d.* INTO objective FROM route_destinations rd
  JOIN destinations d ON d.id = rd.destination_id
  WHERE rd.route_id = candidate_route_id
    AND 'summit'::destination_feature = ANY(d.features)
  ORDER BY rd.ordinal DESC, d.id LIMIT 1;
  IF NOT FOUND THEN errors := array_append(errors, 'summit_objective_missing'); END IF;

  kind := 'summit';
  objective_destination_id := objective.id;
  trailhead_destination_id := trailhead.id;
  state_code := COALESCE(NULLIF(btrim(objective.state_code), ''), NULLIF(btrim(trailhead.state_code), ''));
  country_code := COALESCE(NULLIF(btrim(objective.country_code), ''), NULLIF(btrim(trailhead.country_code), ''));
  IF state_code IS NULL THEN errors := array_append(errors, 'state_missing'); END IF;
  IF country_code IS NULL THEN errors := array_append(errors, 'country_missing'); END IF;
  IF state_code IS NOT NULL AND state_code !~ '^[A-Z0-9][A-Z0-9-]{0,15}$' THEN
    errors := array_append(errors, 'state_invalid');
  END IF;
  IF country_code IS NOT NULL AND country_code !~ '^[A-Z]{2}$' THEN
    errors := array_append(errors, 'country_invalid');
  END IF;
  IF candidate.shape IS NULL THEN errors := array_append(errors, 'shape_missing'); END IF;
  IF candidate.distance IS NULL OR candidate.distance <= 0
     OR candidate.distance IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     OR candidate.gain IS NULL OR candidate.gain < 0
     OR candidate.gain IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     OR candidate.gain_loss IS NULL OR candidate.gain_loss < 0
     OR candidate.gain_loss IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) THEN
    errors := array_append(errors, 'route_stats_missing_or_invalid');
  END IF;
  IF cardinality(errors) > 0 THEN RETURN NEXT; RETURN; END IF;

  max_grade := peaks_route_max_grade(candidate.path);
  difficulty := peaks_harder_difficulty(
    peaks_route_difficulty(candidate.distance, candidate.gain, candidate.gain_loss,
                           max_grade, candidate.shape),
    peaks_route_terrain_floor(candidate_route_id));
  est_moving_seconds := peaks_route_est_moving_seconds(candidate.path, candidate.shape);
  IF difficulty IS NULL OR est_moving_seconds IS NULL THEN
    errors := array_append(errors, 'path_estimate_unavailable');
  END IF;
  RETURN NEXT;
END;
$$;
ALTER FUNCTION peaks_route_catalog_metadata_plan(TEXT) OWNER TO postgres;

-- Reviewed routes also need the new metadata. Exempt only a NULL-to-grade
-- fill on segments and a canonical difficulty-only refresh on routes.
CREATE OR REPLACE FUNCTION guard_trail_catalog_reviewed_links() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE bound_route_id TEXT;
BEGIN
  IF TG_TABLE_NAME='segments' THEN
    -- Filling this new grade does not change the reviewed source binding.
    IF TG_OP='UPDATE' AND OLD.osm_sac_scale IS NULL AND NEW.osm_sac_scale IS NOT NULL
      AND (to_jsonb(NEW)-'osm_sac_scale')=(to_jsonb(OLD)-'osm_sac_scale') THEN RETURN NEW; END IF;
    IF EXISTS(SELECT 1 FROM route_segments rs JOIN trail_catalog_review_jobs review ON review.route_id=rs.route_id
      WHERE rs.segment_id=OLD.id AND review.state IN ('approved','publish_leased','published','verify_leased','verified','rejected')) THEN RAISE EXCEPTION 'catalog reviewed source segment is immutable'; END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM trail_catalog_review_jobs review WHERE(review.route_id=CASE WHEN TG_OP='INSERT' THEN NEW.route_id ELSE OLD.route_id END
      OR(TG_OP='UPDATE' AND review.route_id=NEW.route_id)) AND review.state IN ('approved','publish_leased','published','verify_leased','verified','rejected')) THEN RAISE EXCEPTION 'catalog reviewed route links are immutable'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
ALTER FUNCTION guard_trail_catalog_reviewed_links() OWNER TO postgres;

CREATE OR REPLACE FUNCTION guard_trail_catalog_pending_only() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE candidate_route_id TEXT:=CASE WHEN TG_OP='INSERT' THEN NEW.id ELSE OLD.id END; receipt_state TEXT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=candidate_route_id) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'catalog candidate route cannot be deleted outside explicit receipt repair'; END IF;
  IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'trail catalog candidate route identity is immutable'; END IF;
  -- Permit only the canonical difficulty refresh; keep all reviewed inputs,
  -- status, cover exceptions and publication checks below unchanged.
  IF TG_OP='UPDATE' AND NEW.difficulty IS DISTINCT FROM OLD.difficulty
    AND (to_jsonb(NEW)-ARRAY['difficulty','updated_at'])=(to_jsonb(OLD)-ARRAY['difficulty','updated_at'])
    AND NEW.difficulty IS NOT DISTINCT FROM peaks_harder_difficulty(
      peaks_route_difficulty(NEW.distance,NEW.gain,NEW.gain_loss,peaks_route_max_grade(NEW.path),NEW.shape),
      peaks_route_terrain_floor(NEW.id)) THEN RETURN NEW;
  END IF;
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
ALTER FUNCTION guard_trail_catalog_pending_only() OWNER TO postgres;

COMMENT ON COLUMN segments.osm_sac_scale IS 'OSM mapper hiking grade; used only as a route difficulty floor after 50 m of distinct segments.';
COMMENT ON COLUMN routes.difficulty IS 'Peaks effort estimate raised by qualifying OSM hiking grades; NULL when effort is unknown.';

COMMIT;
