-- Route covers of their own, and photos become optional for activation.
--
-- Design: docs/trails/washington-routes-and-segments.md, decisions 7 and 8.
--
-- 1. routes gains a direct, credited cover (cover_image, cover_attribution,
--    cover_attribution_url, cover_storage_path, cover_focal_x/y, cover_source,
--    cover_updated_at). A cover that is set must carry its full credit; the
--    CHECK below makes that a database rule, not an API habit.
-- 2. destinations gains hero_image_source and hero_image_storage_path, so an
--    admin-set cover can be told apart from a reviewed source photo and later
--    cleared. Any other writer that replaces hero_image clears both markers
--    (trg_destinations_clear_hero_source), so a stale 'admin' marker can never
--    let the admin DELETE endpoint remove a reviewed photo.
-- 3. route_cover_photo(route_id) prefers the route's own cover, then falls back
--    to the linked-destination choice from 20261009_route_cover_photo_lookup.
--    Its seven columns keep their names, order and types; one column,
--    `origin` ('route' or 'destination'), is appended. Postgres cannot change
--    a function's result type in place, so the view and function are dropped
--    and recreated in this transaction, and the view's grant is restored.
-- 4. Photos are optional. The trg_enforce_peaks_route_cover_activation
--    constraint trigger and its function are dropped. The trail catalog's
--    `credited_cover` gate moves from machine gates to measurements: it is
--    still reported, it no longer blocks review or activation. Both catalog
--    functions are reproduced from 20261014_trail_catalog_review_activation.sql
--    (checked equal to production's pg_get_functiondef on 2026-10-15) with
--    only that change.
-- 5. guard_trail_catalog_pending_only keeps reviewed catalog routes immutable,
--    except for status, updated_at and the new cover columns, so an admin can
--    set a cover on a reviewed route. Reproduced from the 20261014 source with
--    only the exempt-column list extended.
--
-- Idempotent: every ADD uses IF NOT EXISTS or a catalog check, every function
-- is CREATE OR REPLACE or drop-and-create, and every trigger is dropped first.
-- Prod-safe: no row is rewritten. New columns are NULL or carry a constant
-- default, so ALTER TABLE does not rewrite either table. The CHECKs scan rows
-- that are all NULL. lock_timeout bounds the brief exclusive locks.
--
-- Apply by hand as `postgres` (CI never applies migrations).
-- Cost: $0/month. No service, timer, or always-on resource.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Route cover columns
-- ---------------------------------------------------------------------------
ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS cover_image TEXT,
  ADD COLUMN IF NOT EXISTS cover_attribution TEXT,
  ADD COLUMN IF NOT EXISTS cover_attribution_url TEXT,
  ADD COLUMN IF NOT EXISTS cover_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS cover_focal_x SMALLINT NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS cover_focal_y SMALLINT NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS cover_source TEXT,
  ADD COLUMN IF NOT EXISTS cover_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'routes'::regclass AND conname = 'routes_cover_focal_x_check') THEN
    ALTER TABLE routes ADD CONSTRAINT routes_cover_focal_x_check CHECK (cover_focal_x BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'routes'::regclass AND conname = 'routes_cover_focal_y_check') THEN
    ALTER TABLE routes ADD CONSTRAINT routes_cover_focal_y_check CHECK (cover_focal_y BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'routes'::regclass AND conname = 'routes_cover_source_check') THEN
    ALTER TABLE routes ADD CONSTRAINT routes_cover_source_check
      CHECK (cover_source IS NULL OR cover_source IN ('commons', 'nps', 'usfs', 'admin', 'other'));
  END IF;
  -- A shown photo carries full credit: author and a link. A cover also names
  -- where it came from, and nothing describes a cover that is not there.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'routes'::regclass AND conname = 'routes_cover_credit_check') THEN
    ALTER TABLE routes ADD CONSTRAINT routes_cover_credit_check CHECK (
      CASE WHEN cover_image IS NULL THEN
        cover_attribution IS NULL AND cover_attribution_url IS NULL
        AND cover_storage_path IS NULL AND cover_source IS NULL
      ELSE
        NULLIF(btrim(cover_image), '') IS NOT NULL
        AND NULLIF(btrim(cover_attribution), '') IS NOT NULL
        AND NULLIF(btrim(cover_attribution_url), '') IS NOT NULL
        AND cover_source IS NOT NULL
      END
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Destination cover origin markers
-- ---------------------------------------------------------------------------
ALTER TABLE destinations
  ADD COLUMN IF NOT EXISTS hero_image_source TEXT,
  ADD COLUMN IF NOT EXISTS hero_image_storage_path TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'destinations'::regclass AND conname = 'destinations_hero_image_source_check') THEN
    ALTER TABLE destinations ADD CONSTRAINT destinations_hero_image_source_check
      CHECK (hero_image_source IS NULL OR hero_image_source IN ('commons', 'nps', 'usfs', 'admin', 'other'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION clear_destination_hero_source_on_image_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- A writer that replaces the photo without restating where it came from
  -- (the web review flow, an importer) makes the old markers wrong.
  IF NEW.hero_image IS DISTINCT FROM OLD.hero_image
     AND NEW.hero_image_source IS NOT DISTINCT FROM OLD.hero_image_source
     AND NEW.hero_image_storage_path IS NOT DISTINCT FROM OLD.hero_image_storage_path THEN
    NEW.hero_image_source := NULL;
    NEW.hero_image_storage_path := NULL;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_destinations_clear_hero_source ON destinations;
CREATE TRIGGER trg_destinations_clear_hero_source
BEFORE UPDATE OF hero_image ON destinations
FOR EACH ROW EXECUTE FUNCTION clear_destination_hero_source_on_image_change();

-- ---------------------------------------------------------------------------
-- 3. route_cover_photo(): the route's own cover first
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS route_cover_photos;
DROP FUNCTION IF EXISTS route_cover_photo(text);

CREATE FUNCTION route_cover_photo(target_route_id text)
RETURNS TABLE (
    destination_id   text,
    destination_name text,
    image_url        text,
    attribution      text,
    attribution_url  text,
    focal_x          smallint,
    focal_y          smallint,
    origin           text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT choice.destination_id, choice.destination_name, choice.image_url,
         choice.attribution, choice.attribution_url,
         choice.focal_x, choice.focal_y, choice.origin
  FROM (
    (SELECT NULL::text AS destination_id,
            NULL::text AS destination_name,
            btrim(r.cover_image) AS image_url,
            btrim(r.cover_attribution) AS attribution,
            btrim(r.cover_attribution_url) AS attribution_url,
            r.cover_focal_x AS focal_x,
            r.cover_focal_y AS focal_y,
            'route'::text AS origin,
            0 AS priority
     FROM routes r
     WHERE r.id = target_route_id
       AND NULLIF(btrim(r.cover_image), '') IS NOT NULL
       AND NULLIF(btrim(r.cover_attribution), '') IS NOT NULL
       AND NULLIF(btrim(r.cover_attribution_url), '') IS NOT NULL)
    UNION ALL
    (SELECT d.id,
            d.name,
            btrim(d.hero_image),
            btrim(d.hero_image_attribution),
            btrim(d.hero_image_attribution_url),
            d.hero_image_focal_x,
            d.hero_image_focal_y,
            'destination'::text,
            1
     FROM route_destinations rd
     JOIN destinations d ON d.id = rd.destination_id
     WHERE rd.route_id = target_route_id
       AND NULLIF(btrim(d.hero_image), '') IS NOT NULL
       AND NULLIF(btrim(d.hero_image_attribution), '') IS NOT NULL
       AND NULLIF(btrim(d.hero_image_attribution_url), '') IS NOT NULL
     ORDER BY ('summit'::destination_feature = ANY (d.features)) DESC,
              rd.ordinal DESC,
              d.prominence DESC NULLS LAST,
              d.elevation DESC NULLS LAST,
              d.name,
              d.id
     LIMIT 1)
  ) choice
  ORDER BY choice.priority
  LIMIT 1
$$;

CREATE VIEW route_cover_photos AS
SELECT r.id AS route_id,
       cover.destination_id,
       cover.destination_name,
       cover.image_url,
       cover.attribution,
       cover.attribution_url,
       cover.focal_x,
       cover.focal_y,
       cover.origin
FROM routes r
CROSS JOIN LATERAL route_cover_photo(r.id) AS cover;

GRANT SELECT ON route_cover_photos TO "peaks-api";

-- ---------------------------------------------------------------------------
-- 4. Photos are optional for activation
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_enforce_peaks_route_cover_activation ON routes;
DROP FUNCTION IF EXISTS enforce_peaks_route_cover_activation();

-- Reproduced from 20261014_trail_catalog_review_activation.sql. Only change:
-- credited_cover moves from `gates` to `measurements`.
CREATE OR REPLACE FUNCTION trail_catalog_review_machine_checks(candidate_source_key TEXT,required_status TEXT DEFAULT 'pending') RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job trail_catalog_candidate_jobs%ROWTYPE; r routes%ROWTYPE; reused DOUBLE PRECISION; summit_count INTEGER; summit_gap DOUBLE PRECISION;
  cover BOOLEAN; contact BOOLEAN; integrity BOOLEAN; exact_binding BOOLEAN; gates JSONB; measurements JSONB;
BEGIN
  SELECT * INTO job FROM trail_catalog_candidate_jobs WHERE source_key=candidate_source_key;
  SELECT * INTO r FROM routes WHERE id=job.proposed_route_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'catalog candidate route is missing'; END IF;
  exact_binding:=trail_catalog_snapshot_binding_valid(r.id,required_status);
  integrity:=peaks_route_passes_publish_integrity(r.id,NULL,required_status);
  contact:=peaks_route_kind_passes_contact(r.id,NULL);
  SELECT count(*)::int,max(ST_Distance(r.path,d.location)) INTO summit_count,summit_gap
    FROM route_destinations rd JOIN destinations d ON d.id=rd.destination_id
    WHERE rd.route_id=r.id AND 'summit'::destination_feature=ANY(d.features);
  SELECT EXISTS(SELECT 1 FROM route_destinations rd JOIN destinations d ON d.id=rd.destination_id
    WHERE rd.route_id=r.id
      AND NULLIF(btrim(d.hero_image),'') IS NOT NULL AND NULLIF(btrim(d.hero_image_attribution),'') IS NOT NULL AND NULLIF(btrim(d.hero_image_attribution_url),'') IS NOT NULL) INTO cover;
  SELECT COALESCE(sum(ST_Length(s.path)) FILTER(WHERE EXISTS(SELECT 1 FROM route_segments other WHERE other.segment_id=s.id AND other.route_id<>r.id)),0)
    INTO reused FROM route_segments rs JOIN segments s ON s.id=rs.segment_id WHERE rs.route_id=r.id;
  gates:=jsonb_build_object('pending_binding',exact_binding,'provenance',COALESCE(is_valid_route_provenance(r.provenance),false),
    'publish_integrity',integrity,'xyz_assembly',integrity AND exact_binding AND ST_NPoints(r.path::geometry)>=5,
    'stats',COALESCE(r.gain>=0 AND r.gain<=2000 AND r.distance>0 AND r.distance=ST_Length(r.path),false),'contacts',contact,
    'linked_summits',contact AND (summit_count=0 OR (summit_gap IS NOT NULL AND summit_gap<=5)),
    'self_intersection',COALESCE(ST_IsSimple(r.path::geometry),false),'segment_reuse',exact_binding AND NOT EXISTS(
      SELECT 1 FROM route_segments rs JOIN segments s ON s.id=rs.segment_id JOIN segments duplicate ON duplicate.id<>s.id
      WHERE rs.route_id=r.id AND route_segment_provenance_compatible(duplicate.provenance,s.provenance)
        AND ST_Equals(ST_Force2D(duplicate.path::geometry),ST_Force2D(s.path::geometry))),
    'elevation',COALESCE(r.elevation_string=encode_route_elevation_profile(r.path) AND route_elevation_profile_has_real_range(r.path),false));
  measurements:=jsonb_build_object('distance_m',r.distance,'gain_m',r.gain,'loss_m',r.gain_loss,'reused_length_m',reused,'reuse_fraction',CASE WHEN r.distance>0 THEN reused/r.distance ELSE NULL END,
    'start_gap_m',(SELECT ST_Distance(ST_StartPoint(r.path::geometry)::geography,d.location) FROM destinations d WHERE d.id=r.trailhead_destination_id),
    'objective_gap_m',(SELECT ST_Distance(CASE WHEN r.kind IN ('loop','traverse') THEN r.path ELSE ST_EndPoint(r.path::geometry)::geography END,
      CASE WHEN d.boundary IS NOT NULL AND NOT ('summit'::destination_feature=ANY(d.features)) THEN d.boundary ELSE d.location END) FROM destinations d WHERE d.id=r.objective_destination_id),
    'end_trailhead_gap_m',(SELECT ST_Distance(ST_EndPoint(r.path::geometry)::geography,d.location) FROM destinations d WHERE d.id=job.artifact#>>'{candidate,endTrailhead,id}'),
    'summit_max_gap_m',summit_gap,'summit_count',summit_count,'credited_cover',cover);
  RETURN jsonb_build_object('gates',gates,'measurements',measurements,'errors',COALESCE((SELECT jsonb_agg(key ORDER BY key) FROM jsonb_each(gates) WHERE value<>'true'::jsonb),'[]'::jsonb));
END $$;

-- Reproduced from 20261014_trail_catalog_review_activation.sql. Only change:
-- credited_cover leaves the required gate list.
CREATE OR REPLACE FUNCTION trail_catalog_source_review_passes(check_result JSONB,candidate_route_id TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE gate TEXT; checked TIMESTAMPTZ;
BEGIN
  IF check_result->'passed' IS DISTINCT FROM 'true'::jsonb OR check_result->>'routeId' IS DISTINCT FROM candidate_route_id
    OR check_result->'errors' IS DISTINCT FROM '[]'::jsonb
    OR check_result#>'{machineChecks,errors}' IS DISTINCT FROM '[]'::jsonb THEN RETURN false; END IF;
  checked:=(check_result->>'checkedAt')::timestamptz;
  IF checked IS NULL OR checked<clock_timestamp()-interval '24 hours' OR checked>clock_timestamp()+interval '5 minutes' THEN RETURN false; END IF;
  FOREACH gate IN ARRAY ARRAY['pending_binding','provenance','publish_integrity','source_geometry','xyz_assembly','stats','contacts','linked_summits','self_intersection','segment_reuse','elevation'] LOOP
    IF check_result#>ARRAY['machineChecks','gates',gate] IS DISTINCT FROM 'true'::jsonb THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Reviewed catalog routes accept cover edits
-- ---------------------------------------------------------------------------
-- Reproduced from 20261014_trail_catalog_review_activation.sql. Only change:
-- the cover columns join status and updated_at in the exempt list. The
-- trigger itself is unchanged and keeps pointing at this function.
CREATE OR REPLACE FUNCTION guard_trail_catalog_pending_only() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE candidate_route_id TEXT:=CASE WHEN TG_OP='INSERT' THEN NEW.id ELSE OLD.id END; receipt_state TEXT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=candidate_route_id) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'catalog candidate route cannot be deleted outside explicit receipt repair'; END IF;
  IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'trail catalog candidate route identity is immutable'; END IF;
  SELECT state INTO receipt_state FROM trail_catalog_review_jobs WHERE route_id=candidate_route_id;
  IF TG_OP='UPDATE' AND receipt_state IN ('approved','publish_leased','published','verify_leased','verified','rejected')
    AND(to_jsonb(NEW)-ARRAY['status','updated_at','cover_image','cover_attribution','cover_attribution_url','cover_storage_path','cover_focal_x','cover_focal_y','cover_source','cover_updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','updated_at','cover_image','cover_attribution','cover_attribution_url','cover_storage_path','cover_focal_x','cover_focal_y','cover_source','cover_updated_at']) THEN RAISE EXCEPTION 'catalog reviewed route is immutable'; END IF;
  IF NEW.status='active' AND(TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    IF NOT trail_catalog_publish_authorized(candidate_route_id) THEN RAISE EXCEPTION 'trail catalog candidate requires independent review; direct activation is disabled except its owned activation function'; END IF;
  ELSIF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'catalog route transition requires explicit reviewed activation'; END IF;
  RETURN NEW;
END $$;

COMMIT;
