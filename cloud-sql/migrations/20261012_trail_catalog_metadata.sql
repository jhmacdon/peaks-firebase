-- Add searchable trail metadata to the existing route and segment catalog.
-- Cost: no new service or schedule; expected fixed cost increase ~$0/month.
-- Index storage and bounded refresh queries use the current Cloud SQL instance.
-- Classification and missing destination links stay NULL until a checked refresh.
-- This migration does not change names, statuses, geometry, or publish gates.

BEGIN;

CREATE OR REPLACE FUNCTION peaks_search_name(value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(COALESCE(string_agg(COALESCE(
    ('{"mt":"mount","mtn":"mountain","pt":"point","st":"saint",'
     '"ft":"fort","lk":"lake","pk":"peak","cr":"creek",'
     '"crk":"creek","cyn":"canyon","jct":"junction","spgs":"springs",'
     '"spr":"spring","fk":"fork","br":"bridge","brg":"bridge",'
     '"trl":"trail","hwy":"highway","rd":"road","ne":"northeast",'
     '"nw":"northwest","se":"southeast","sw":"southwest"}'::jsonb)->>word,
    word), ' ' ORDER BY ordinal), ''))
  FROM regexp_split_to_table(lower(COALESCE(value, '')), '[[:space:]]+')
       WITH ORDINALITY AS words(word, ordinal);
$$;

CREATE OR REPLACE FUNCTION peaks_search_names(value TEXT[])
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT peaks_search_name(array_to_string(value, ' '));
$$;

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS kind TEXT CHECK (kind IN ('summit', 'destination', 'loop', 'traverse')),
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS search_name TEXT,
  ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS objective_destination_id TEXT REFERENCES destinations(id),
  ADD COLUMN IF NOT EXISTS trailhead_destination_id TEXT REFERENCES destinations(id),
  ADD COLUMN IF NOT EXISTS difficulty TEXT CHECK (difficulty IN ('easy', 'moderate', 'hard', 'strenuous')),
  ADD COLUMN IF NOT EXISTS est_moving_seconds INTEGER CHECK (est_moving_seconds > 0),
  ADD COLUMN IF NOT EXISTS state_code TEXT,
  ADD COLUMN IF NOT EXISTS country_code TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS description_source_name TEXT,
  ADD COLUMN IF NOT EXISTS description_source_url TEXT,
  ADD COLUMN IF NOT EXISTS description_source_license TEXT,
  ADD COLUMN IF NOT EXISTS popularity INTEGER NOT NULL DEFAULT 0 CHECK (popularity >= 0);

ALTER TABLE segments ADD COLUMN IF NOT EXISTS trail_names TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS list_routes (
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  PRIMARY KEY (list_id, route_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON list_routes TO "peaks-api";

CREATE UNIQUE INDEX IF NOT EXISTS idx_routes_state_slug
  ON routes (COALESCE(state_code, ''), slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routes_search_name_trgm ON routes USING gin (search_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_routes_search_name_prefix ON routes (search_name text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_routes_aliases_trgm ON routes USING gin (peaks_search_names(aliases) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_routes_aliases_prefix ON routes (peaks_search_names(aliases) text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_routes_aliases_fts ON routes USING gin
  (to_tsvector('simple', peaks_search_names(aliases))) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_segments_trail_names_trgm ON segments USING gin (peaks_search_names(trail_names) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_segments_trail_names_prefix ON segments (peaks_search_names(trail_names) text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_segments_trail_names_fts ON segments USING gin
  (to_tsvector('simple', peaks_search_names(trail_names)));
CREATE INDEX IF NOT EXISTS idx_routes_objective_destination ON routes (objective_destination_id);
CREATE INDEX IF NOT EXISTS idx_routes_trailhead_destination ON routes (trailhead_destination_id);
CREATE INDEX IF NOT EXISTS idx_route_segments_segment_route ON route_segments (segment_id, route_id);
CREATE INDEX IF NOT EXISTS idx_list_routes_route_list ON list_routes (route_id, list_id);
CREATE INDEX IF NOT EXISTS idx_lists_catalog_name_trgm ON lists USING gin (peaks_search_name(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_lists_catalog_name_prefix ON lists (peaks_search_name(name) text_pattern_ops);

-- A missing/non-finite Z, zero-length vertical jump, or entirely empty path
-- returns no usable estimate. An exact duplicate XYZ vertex adds no distance.
CREATE OR REPLACE FUNCTION peaks_route_path_edges(route_path geography)
RETURNS TABLE (ordinal INTEGER, distance_m DOUBLE PRECISION,
               start_z DOUBLE PRECISION, end_z DOUBLE PRECISION)
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  WITH points AS (
    SELECT (point).path[1] AS ordinal, (point).geom AS point,
           lag((point).geom) OVER (ORDER BY (point).path[1]) AS prior
    FROM ST_DumpPoints(route_path::geometry) point
  )
  SELECT ordinal, ST_Distance(prior::geography, point::geography),
         ST_Z(prior), ST_Z(point)
  FROM points WHERE prior IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION peaks_route_path_is_estimable(route_path geography)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(count(*) > 0 AND sum(distance_m) > 0 AND bool_and(
    start_z IS NOT NULL AND end_z IS NOT NULL
    AND start_z NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
    AND end_z NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
    AND distance_m NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
    AND (distance_m > 0 OR start_z = end_z)
  ), false)
  FROM peaks_route_path_edges(route_path);
$$;

-- Sample elevation along cumulative geodesic distance at 100 m intervals.
-- Merge a final interval shorter than 50 m into the prior one. A route shorter
-- than 100 m uses its full length. This prevents dense vertices from turning
-- a small elevation wobble into the route's maximum grade.
CREATE OR REPLACE FUNCTION peaks_route_max_grade(route_path geography)
RETURNS DOUBLE PRECISION LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  WITH edges AS MATERIALIZED (
    SELECT *, sum(distance_m) OVER (ORDER BY ordinal) AS end_m,
           sum(distance_m) OVER () AS total_m
    FROM peaks_route_path_edges(route_path)
  ), samples AS (
    SELECT 0::float8 AS at_m, ST_Z(ST_StartPoint(route_path::geometry)) AS z
    UNION
    SELECT max(total_m), ST_Z(ST_EndPoint(route_path::geometry)) FROM edges
    UNION
    SELECT sample * 100.0,
           start_z + (end_z - start_z) *
             ((sample * 100.0 - (end_m - distance_m)) / distance_m)
    FROM edges
    CROSS JOIN LATERAL generate_series(
      greatest(1, floor((end_m - distance_m) / 100.0)::integer + 1),
      least(floor(end_m / 100.0)::integer, floor((total_m - 50) / 100.0)::integer)
    ) sample
    WHERE distance_m > 0
  ), grades AS (
    SELECT abs(z - lag(z) OVER (ORDER BY at_m)) /
           NULLIF(at_m - lag(at_m) OVER (ORDER BY at_m), 0) AS grade
    FROM samples
  )
  SELECT CASE WHEN peaks_route_path_is_estimable(route_path) THEN max(grade) END
  FROM grades;
$$;

-- Peaks effort score: full walking km + full ascent metres / 100 +
-- 20 * maximum absolute grade over the 100 m windows above.
-- Thresholds are Peaks' own estimates, never a source site's difficulty.
CREATE OR REPLACE FUNCTION peaks_route_difficulty(
  distance_m DOUBLE PRECISION, gain_m DOUBLE PRECISION,
  loss_m DOUBLE PRECISION, max_grade DOUBLE PRECISION, route_shape route_shape
)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  WITH effort AS (
    SELECT least(distance_m / 1000, 28) * CASE WHEN route_shape = 'out_and_back' THEN 2 ELSE 1 END
      + least(gain_m / 100, 28)
      + CASE WHEN route_shape = 'out_and_back' THEN least(loss_m / 100, 28) ELSE 0 END
      + least(max_grade, 1.4) * 20 AS score
    WHERE distance_m > 0 AND gain_m >= 0 AND loss_m >= 0 AND max_grade >= 0
      AND route_shape IS NOT NULL
      AND distance_m NOT IN ('NaN'::float8, 'Infinity'::float8)
      AND gain_m NOT IN ('NaN'::float8, 'Infinity'::float8)
      AND loss_m NOT IN ('NaN'::float8, 'Infinity'::float8)
      AND max_grade NOT IN ('NaN'::float8, 'Infinity'::float8)
  )
  SELECT CASE WHEN score < 8 THEN 'easy' WHEN score < 16 THEN 'moderate'
              WHEN score < 28 THEN 'hard' ELSE 'strenuous' END FROM effort;
$$;

-- Tobler (1993), https://escholarship.org/uc/item/05r820mz, Figure II.
-- Sum each edge's horizontal metres / walking speed. Speed is
-- max(0.5, 6 * exp(-3.5 * abs(grade + 0.05))) km/h. The 0.5 km/h floor
-- is a Peaks bound for steep terrain, not a claim from the source formula.
-- Out-and-back adds the return with the opposite grade, not twice the ascent.
CREATE OR REPLACE FUNCTION peaks_route_walking_speed(grade DOUBLE PRECISION)
RETURNS DOUBLE PRECISION LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN grade IS NULL OR grade IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
              THEN NULL
              WHEN abs(grade + 0.05) >= ln(12.0) / 3.5 THEN 0.5
              ELSE 6 * exp(-3.5 * abs(grade + 0.05)) END;
$$;

CREATE OR REPLACE FUNCTION peaks_route_est_moving_seconds(
  route_path geography, route_shape route_shape
)
RETURNS INTEGER LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  WITH times AS (
    SELECT sum(distance_m * 3.6 /
          peaks_route_walking_speed((end_z - start_z) / NULLIF(distance_m, 0))
      + CASE WHEN route_shape = 'out_and_back' THEN
          distance_m * 3.6 /
            peaks_route_walking_speed((start_z - end_z) / NULLIF(distance_m, 0))
        ELSE 0 END) AS seconds
    FROM peaks_route_path_edges(route_path) WHERE distance_m > 0
  )
  SELECT CASE WHEN route_shape IS NOT NULL AND peaks_route_path_is_estimable(route_path)
                   AND seconds > 0 AND seconds <= 2147483647
              THEN ceil(seconds)::integer END FROM times;
$$;

CREATE OR REPLACE FUNCTION refresh_route_catalog_derived_metadata()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_name := NULLIF(peaks_search_name(NEW.name), '');
  IF NEW.slug IS NULL AND NEW.search_name IS NOT NULL THEN
    NEW.slug := trim(both '-' FROM regexp_replace(NEW.search_name, '[^a-z0-9]+', '-', 'g'))
      || '-' || substr(md5(NEW.id), 1, 12);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_routes_catalog_derived_metadata ON routes;
CREATE TRIGGER trg_routes_catalog_derived_metadata
BEFORE INSERT OR UPDATE OF name ON routes
FOR EACH ROW EXECUTE FUNCTION refresh_route_catalog_derived_metadata();

-- Keep a name-only change free of path reads, including comparisons with the
-- old toasted geometry. Estimates run only when their own inputs are written.
CREATE OR REPLACE FUNCTION refresh_route_catalog_estimates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.difficulty := peaks_route_difficulty(NEW.distance, NEW.gain, NEW.gain_loss,
                                         peaks_route_max_grade(NEW.path), NEW.shape);
  NEW.est_moving_seconds := peaks_route_est_moving_seconds(NEW.path, NEW.shape);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_routes_catalog_estimates ON routes;
CREATE TRIGGER trg_routes_catalog_estimates
BEFORE INSERT OR UPDATE OF path, shape, distance, gain, gain_loss ON routes
FOR EACH ROW EXECUTE FUNCTION refresh_route_catalog_estimates();

-- Read one legacy summit route without changing it. Callers report every
-- reason and must not treat a partial plan as a completed backfill.
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
  difficulty := peaks_route_difficulty(candidate.distance, candidate.gain, candidate.gain_loss,
                                       max_grade, candidate.shape);
  est_moving_seconds := peaks_route_est_moving_seconds(candidate.path, candidate.shape);
  IF difficulty IS NULL OR est_moving_seconds IS NULL THEN
    errors := array_append(errors, 'path_estimate_unavailable');
  END IF;
  RETURN NEXT;
END;
$$;

-- Invoke only after a reviewed dry run, in bounded batches. The caller uses
-- routeDoneCoverageSql for its popularity count; this SQL does not copy that
-- threshold or count partial route matches as completed hikes.
CREATE OR REPLACE FUNCTION refresh_peaks_route_catalog_metadata(
  candidate_route_id TEXT, matched_popularity INTEGER DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE planned RECORD;
BEGIN
  IF matched_popularity IS NOT NULL AND matched_popularity < 0 THEN
    RAISE EXCEPTION 'Popularity must be nonnegative';
  END IF;
  PERFORM 1 FROM routes r WHERE r.id = candidate_route_id FOR UPDATE;
  PERFORM 1 FROM route_destinations rd WHERE rd.route_id = candidate_route_id FOR SHARE;
  PERFORM 1 FROM route_segments rs WHERE rs.route_id = candidate_route_id FOR SHARE;
  PERFORM 1 FROM segments s WHERE s.id IN (
    SELECT rs.segment_id FROM route_segments rs WHERE rs.route_id = candidate_route_id
  ) ORDER BY s.id FOR SHARE;
  PERFORM 1 FROM destinations d WHERE d.id IN (
    SELECT rd.destination_id FROM route_destinations rd WHERE rd.route_id = candidate_route_id
  ) ORDER BY d.id FOR SHARE;
  SELECT * INTO planned FROM peaks_route_catalog_metadata_plan(candidate_route_id);
  IF cardinality(planned.errors) > 0 THEN
    RAISE EXCEPTION 'Route % metadata refresh blocked: %', candidate_route_id,
      array_to_string(planned.errors, ', ');
  END IF;
  UPDATE routes SET kind = planned.kind, objective_destination_id = planned.objective_destination_id,
    trailhead_destination_id = planned.trailhead_destination_id,
    state_code = planned.state_code, country_code = planned.country_code,
    difficulty = planned.difficulty, est_moving_seconds = planned.est_moving_seconds,
    popularity = COALESCE(matched_popularity, popularity)
  WHERE id = candidate_route_id;
END;
$$;

-- Backfill only names and slugs here. Do not infer summit objectives, origin
-- regions, or estimates for incomplete legacy rows during a schema change.
UPDATE routes SET search_name = NULLIF(peaks_search_name(name), ''),
  slug = COALESCE(slug,
    CASE WHEN NULLIF(peaks_search_name(name), '') IS NOT NULL THEN
      trim(both '-' FROM regexp_replace(peaks_search_name(name), '[^a-z0-9]+', '-', 'g'))
        || '-' || substr(md5(id), 1, 12) END)
WHERE search_name IS DISTINCT FROM NULLIF(peaks_search_name(name), '') OR slug IS NULL;

COMMENT ON COLUMN routes.kind IS 'NULL means catalog classification still needs review; it never grants publication.';
COMMENT ON COLUMN routes.slug IS 'Stable name-derived slug with an ID hash suffix; unique even when state_code is missing.';
COMMENT ON COLUMN routes.difficulty IS 'Peaks effort estimate from full distance, ascent and maximum 100 m grade; not a technical climbing rating.';
COMMENT ON COLUMN routes.est_moving_seconds IS 'Tobler-style walking estimate from directed path edges, including the return for out_and_back.';

COMMIT;
