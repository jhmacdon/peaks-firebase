-- What a route asks of the people on it, beyond effort.
--
-- terrain_category comes from segment kinds: a 5th-class climb makes a
-- technical climb; a climbers route or glacier makes mountaineering; a
-- scramble makes a scramble. NULL means a hike. Any of the three makes the
-- route at least 'hard', whatever its effort score, so a short technical
-- route can never read as easy. terrain_summary is the reviewed, credited
-- line saying what the whole trip needs (terrain-facts decisions).
-- Cost: $0/month fixed; the backfill updates only the routes that change.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE routes ADD COLUMN IF NOT EXISTS terrain_category TEXT;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS terrain_summary JSONB;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'routes'::regclass AND conname = 'routes_terrain_category_check') THEN
    ALTER TABLE routes ADD CONSTRAINT routes_terrain_category_check
      CHECK (terrain_category IN ('scramble', 'mountaineering', 'technical_climb')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'routes'::regclass AND conname = 'routes_terrain_summary_check') THEN
    ALTER TABLE routes ADD CONSTRAINT routes_terrain_summary_check
      CHECK (terrain_summary IS NULL OR (jsonb_typeof(terrain_summary) = 'object'
        AND jsonb_typeof(terrain_summary->'line') = 'string'
        AND jsonb_typeof(terrain_summary->'sources') = 'array')) NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION peaks_route_terrain_category(route_id TEXT)
RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT CASE
    WHEN bool_or(s.kind = 'climb') THEN 'technical_climb'
    WHEN bool_or(s.kind IN ('climbers_route', 'glacier')) THEN 'mountaineering'
    WHEN bool_or(s.kind = 'scramble') THEN 'scramble'
    ELSE NULL END
  FROM route_segments rs JOIN segments s ON s.id = rs.segment_id
  WHERE rs.route_id = $1;
$$;
ALTER FUNCTION peaks_route_terrain_category(TEXT) OWNER TO postgres;

-- Reviewed terrain beyond a hike makes a route at least hard; otherwise the
-- OSM grade floor from 20261020_route_terrain_floor.sql applies, now on
-- horizontal length (that file's ST_Length counted elevation change).
CREATE OR REPLACE FUNCTION peaks_route_terrain_floor(route_id TEXT)
RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT CASE
    WHEN peaks_route_terrain_category($1) IS NOT NULL THEN 'hard'
    WHEN sum(horizontal_m) FILTER (WHERE s.osm_sac_scale IN
      ('alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking')) >= 50 THEN 'hard'
    WHEN sum(horizontal_m) FILTER
      (WHERE s.osm_sac_scale = 'demanding_mountain_hiking') >= 50 THEN 'moderate'
    ELSE NULL END
  FROM segments s
  -- Horizontal length: ST_Length on a 3D geography counts the climb too.
  CROSS JOIN LATERAL (SELECT ST_Length(ST_Force2D(s.path::geometry)::geography) AS horizontal_m) l
  WHERE s.id IN (SELECT rs.segment_id FROM route_segments rs WHERE rs.route_id = $1);
$$;
ALTER FUNCTION peaks_route_terrain_floor(TEXT) OWNER TO postgres;

-- After a terrain:apply relabel: category and difficulty only, no path work.
CREATE OR REPLACE FUNCTION refresh_route_terrain(route_ids TEXT[])
RETURNS VOID LANGUAGE SQL AS $$
  UPDATE routes r SET
    terrain_category = peaks_route_terrain_category(r.id),
    difficulty = peaks_harder_difficulty(
      peaks_route_difficulty(r.distance, r.gain, r.gain_loss, peaks_route_max_grade(r.path), r.shape),
      peaks_route_terrain_floor(r.id))
  WHERE r.id = ANY(route_ids)
    AND (r.terrain_category IS DISTINCT FROM peaks_route_terrain_category(r.id)
      OR r.difficulty IS DISTINCT FROM peaks_harder_difficulty(
        peaks_route_difficulty(r.distance, r.gain, r.gain_loss, peaks_route_max_grade(r.path), r.shape),
        peaks_route_terrain_floor(r.id)));
$$;
ALTER FUNCTION refresh_route_terrain(TEXT[]) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION refresh_route_terrain(TEXT[]) TO "peaks-api";

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
  NEW.terrain_category := peaks_route_terrain_category(NEW.id);
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
    est_moving_seconds = peaks_route_est_moving_seconds(r.path, r.shape),
    terrain_category = peaks_route_terrain_category(r.id)
  WHERE r.id = ANY(route_ids);
END;
$$;
ALTER FUNCTION refresh_route_derivations(TEXT[]) OWNER TO postgres;

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
  -- Terrain refreshes may change difficulty, category and the reviewed summary only.
  IF TG_OP='UPDATE'
    AND (to_jsonb(NEW)-ARRAY['difficulty','terrain_category','terrain_summary','updated_at'])
      =(to_jsonb(OLD)-ARRAY['difficulty','terrain_category','terrain_summary','updated_at'])
    AND NEW.terrain_category IS NOT DISTINCT FROM peaks_route_terrain_category(NEW.id)
    AND (NEW.difficulty IS NOT DISTINCT FROM OLD.difficulty OR NEW.difficulty IS NOT DISTINCT FROM peaks_harder_difficulty(
      peaks_route_difficulty(NEW.distance,NEW.gain,NEW.gain_loss,peaks_route_max_grade(NEW.path),NEW.shape),
      peaks_route_terrain_floor(NEW.id))) THEN RETURN NEW;
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

-- Backfill: only routes with terrain beyond a hike.
SELECT refresh_route_terrain(ARRAY(
  SELECT DISTINCT rs.route_id FROM route_segments rs JOIN segments s ON s.id = rs.segment_id
  WHERE s.kind IN ('climb', 'climbers_route', 'glacier', 'scramble')));

COMMENT ON COLUMN routes.terrain_category IS 'Hardest terrain from segment kinds: scramble, mountaineering or technical_climb; NULL is a hike. Anything but a hike makes difficulty at least hard.';
COMMENT ON COLUMN routes.terrain_summary IS 'Reviewed line on what the whole trip needs: {line, gear[], hardest_class, sources[{name,url}], reviewed_at}.';

COMMIT;
