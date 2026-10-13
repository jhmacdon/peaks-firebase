-- Trails phase 1: catalog metadata, search names, trip effort, and popularity.
-- Cost: approximately $0/month. No new service or scheduler; small indexes and
-- changed-row popularity updates run in the existing /internal/sweep request.
-- Routes store one-way stats. Out-and-back effort/time use distance * 2 and
-- gain + gain_loss; other shapes keep the client's forward traversal totals.

BEGIN;

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS kind            TEXT CHECK (kind IN ('summit', 'destination', 'loop', 'traverse')),
  ADD COLUMN IF NOT EXISTS slug            TEXT,
  ADD COLUMN IF NOT EXISTS search_name     TEXT,
  ADD COLUMN IF NOT EXISTS aliases         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS objective_destination_id TEXT REFERENCES destinations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trailhead_destination_id TEXT REFERENCES destinations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS difficulty      TEXT CHECK (difficulty IN ('easy', 'moderate', 'hard', 'strenuous')),
  ADD COLUMN IF NOT EXISTS est_moving_seconds INT,
  ADD COLUMN IF NOT EXISTS state_code      TEXT,
  ADD COLUMN IF NOT EXISTS country_code    TEXT,
  ADD COLUMN IF NOT EXISTS description     TEXT,
  ADD COLUMN IF NOT EXISTS description_source_name TEXT,
  ADD COLUMN IF NOT EXISTS description_source_url TEXT,
  ADD COLUMN IF NOT EXISTS description_source_license TEXT,
  ADD COLUMN IF NOT EXISTS popularity      DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE segments ADD COLUMN IF NOT EXISTS trail_names TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_routes_search_name ON routes USING GIN (search_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_routes_aliases ON routes USING GIN (aliases);
CREATE UNIQUE INDEX IF NOT EXISTS idx_routes_catalog_state_slug
  ON routes (state_code, slug) NULLS NOT DISTINCT
  WHERE owner = 'peaks' AND slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routes_objective_destination ON routes (objective_destination_id);
CREATE INDEX IF NOT EXISTS idx_routes_trailhead_destination ON routes (trailhead_destination_id);
CREATE INDEX IF NOT EXISTS idx_routes_popular ON routes (id) WHERE popularity <> 0;

-- Keep this SQL normalizer in step with api/src/search-utils.ts, which writes
-- destination search names. There was no shared SQL normalizer before trails.
CREATE OR REPLACE FUNCTION peaks_normalize_search_name(value TEXT)
RETURNS TEXT
LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT btrim(string_agg(CASE word
    WHEN 'mt' THEN 'mount' WHEN 'mtn' THEN 'mountain'
    WHEN 'pt' THEN 'point' WHEN 'st' THEN 'saint' WHEN 'ft' THEN 'fort'
    WHEN 'lk' THEN 'lake' WHEN 'pk' THEN 'peak'
    WHEN 'cr' THEN 'creek' WHEN 'crk' THEN 'creek' WHEN 'cyn' THEN 'canyon'
    WHEN 'jct' THEN 'junction' WHEN 'spgs' THEN 'springs' WHEN 'spr' THEN 'spring'
    WHEN 'fk' THEN 'fork' WHEN 'br' THEN 'bridge' WHEN 'brg' THEN 'bridge'
    WHEN 'trl' THEN 'trail' WHEN 'hwy' THEN 'highway' WHEN 'rd' THEN 'road'
    WHEN 'ne' THEN 'northeast' WHEN 'nw' THEN 'northwest'
    WHEN 'se' THEN 'southeast' WHEN 'sw' THEN 'southwest'
    ELSE word END, ' ' ORDER BY ordinal))
  FROM regexp_split_to_table(lower(value), '\s+') WITH ORDINALITY AS words(word, ordinal);
$$;

-- One searchable string per name list, for the alias and segment trail-name
-- trigram indexes. Search matches it with word similarity ($1 <% text).
CREATE OR REPLACE FUNCTION peaks_search_names_text(names TEXT[])
RETURNS TEXT
LANGUAGE SQL IMMUTABLE PARALLEL SAFE
AS $$
  SELECT COALESCE(string_agg(peaks_normalize_search_name(name), ' | ' ORDER BY ordinal), '')
  FROM unnest(names) WITH ORDINALITY AS names_list(name, ordinal);
$$;

CREATE INDEX IF NOT EXISTS idx_routes_alias_search ON routes
  USING GIN (peaks_search_names_text(aliases) gin_trgm_ops) WHERE aliases <> '{}';
CREATE INDEX IF NOT EXISTS idx_segments_trail_name_search ON segments
  USING GIN (peaks_search_names_text(trail_names) gin_trgm_ops) WHERE trail_names <> '{}';

-- Match web getRouteTraversalMetrics: completion expresses a preferred
-- direction, not extra distance. Only out_and_back repeats the stored line;
-- its ascent includes the outbound descent climbed on the return journey.
CREATE OR REPLACE FUNCTION peaks_route_trip_metrics(
  route_distance DOUBLE PRECISION, route_gain DOUBLE PRECISION,
  route_gain_loss DOUBLE PRECISION, route_shape TEXT, route_completion TEXT DEFAULT 'none'
)
RETURNS TABLE(trip_km DOUBLE PRECISION, trip_gain_m DOUBLE PRECISION)
LANGUAGE SQL IMMUTABLE PARALLEL SAFE
AS $$
  SELECT route_distance / 1000.0 * CASE WHEN route_shape = 'out_and_back' THEN 2 ELSE 1 END,
    CASE WHEN route_shape = 'out_and_back' THEN
      CASE WHEN route_gain IS NULL AND route_gain_loss IS NULL THEN NULL
        ELSE COALESCE(route_gain, 0) + COALESCE(route_gain_loss, 0) END
      ELSE route_gain END;
$$;

CREATE OR REPLACE FUNCTION peaks_route_difficulty(
  route_distance DOUBLE PRECISION, route_gain DOUBLE PRECISION,
  route_gain_loss DOUBLE PRECISION, route_shape TEXT, route_completion TEXT DEFAULT 'none'
)
RETURNS TEXT
LANGUAGE SQL IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN trip_km IS NULL OR trip_gain_m IS NULL
      OR trip_km < 0 OR trip_gain_m < 0
      OR trip_km >= 'Infinity'::float8 OR trip_gain_m >= 'Infinity'::float8 THEN NULL
    WHEN trip_km + trip_gain_m / 100.0 < 8 THEN 'easy'
    WHEN trip_km + trip_gain_m / 100.0 < 16 THEN 'moderate'
    WHEN trip_km + trip_gain_m / 100.0 < 26 THEN 'hard'
    ELSE 'strenuous' END
  FROM peaks_route_trip_metrics(route_distance, route_gain, route_gain_loss, route_shape, route_completion);
$$;

CREATE OR REPLACE FUNCTION peaks_route_est_moving_seconds(
  route_distance DOUBLE PRECISION, route_gain DOUBLE PRECISION,
  route_gain_loss DOUBLE PRECISION, route_shape TEXT, route_completion TEXT DEFAULT 'none'
)
RETURNS INT
LANGUAGE SQL IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN trip_km IS NULL OR trip_gain_m IS NULL
      OR trip_km < 0 OR trip_gain_m < 0
      OR trip_km >= 'Infinity'::float8 OR trip_gain_m >= 'Infinity'::float8 THEN NULL
    ELSE LEAST(2147483647, round((trip_km / 4.5 + trip_gain_m / 600.0) * 3600))::int END
  FROM peaks_route_trip_metrics(route_distance, route_gain, route_gain_loss, route_shape, route_completion);
$$;

CREATE OR REPLACE FUNCTION materialize_peaks_route_catalog()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  objective destinations%ROWTYPE;
  trailhead destinations%ROWTYPE;
  base_slug TEXT;
  candidate_slug TEXT;
  suffix INT := 1;
BEGIN
  NEW.search_name := peaks_normalize_search_name(NEW.name);
  NEW.difficulty := peaks_route_difficulty(NEW.distance, NEW.gain, NEW.gain_loss, NEW.shape::text, NEW.completion::text);
  NEW.est_moving_seconds := peaks_route_est_moving_seconds(NEW.distance, NEW.gain, NEW.gain_loss, NEW.shape::text, NEW.completion::text);
  IF NEW.owner <> 'peaks' THEN RETURN NEW; END IF;

  SELECT d.* INTO objective
  FROM route_destinations rd JOIN destinations d ON d.id = rd.destination_id
  WHERE rd.route_id = NEW.id ORDER BY rd.ordinal DESC, rd.destination_id DESC LIMIT 1;
  SELECT d.* INTO trailhead
  FROM route_destinations rd JOIN destinations d ON d.id = rd.destination_id
  WHERE rd.route_id = NEW.id AND 'trailhead'::destination_feature = ANY(d.features)
  ORDER BY rd.ordinal, rd.destination_id LIMIT 1;

  NEW.objective_destination_id := objective.id;
  NEW.trailhead_destination_id := trailhead.id;
  NEW.state_code := COALESCE(objective.state_code, trailhead.state_code);
  NEW.country_code := COALESCE(objective.country_code, trailhead.country_code);
  -- Traverse is an explicit editorial choice; the other kinds follow the stops.
  NEW.kind := CASE WHEN NEW.shape = 'loop' THEN 'loop'
    WHEN NEW.kind = 'traverse' THEN 'traverse'
    WHEN 'summit'::destination_feature = ANY(objective.features) THEN 'summit'
    ELSE 'destination' END;

  -- Keep published slugs when a name changes. A move into a state with the
  -- same slug resolves its collision without changing the other route's URL.
  IF NEW.slug IS NULL OR EXISTS (
    SELECT 1 FROM routes r WHERE r.owner = 'peaks' AND r.id <> NEW.id
      AND r.state_code IS NOT DISTINCT FROM NEW.state_code AND r.slug = NEW.slug
  ) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('peaks-route-slug:' || COALESCE(NEW.state_code, ''), 0));
    base_slug := COALESCE(NULLIF(NEW.slug, ''),
      NULLIF(btrim(regexp_replace(COALESCE(NEW.search_name, ''), '[^[:alnum:]]+', '-', 'g'), '-'), ''),
      'route-' || NEW.id);
    candidate_slug := base_slug;
    WHILE EXISTS (
      SELECT 1 FROM routes r WHERE r.owner = 'peaks' AND r.id <> NEW.id
        AND r.state_code IS NOT DISTINCT FROM NEW.state_code AND r.slug = candidate_slug
    ) LOOP
      suffix := suffix + 1;
      candidate_slug := base_slug || '-' || suffix;
    END LOOP;
    NEW.slug := candidate_slug;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_peaks_route_catalog_stops()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Factory logins may only change route status. Their pending route is
  -- refreshed by the same BEFORE trigger during its guarded activation.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peaks-route-factory'
    AND pg_has_role(session_user, oid, 'member')) THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    UPDATE routes SET name = name WHERE id = OLD.route_id AND owner = 'peaks';
  END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.route_id IS DISTINCT FROM OLD.route_id) THEN
    UPDATE routes SET name = name WHERE id = NEW.route_id AND owner = 'peaks';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_peaks_route_catalog_destination()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.features IS DISTINCT FROM OLD.features
    OR NEW.state_code IS DISTINCT FROM OLD.state_code
    OR NEW.country_code IS DISTINCT FROM OLD.country_code THEN
    UPDATE routes r SET name = r.name
    WHERE r.owner = 'peaks' AND EXISTS (
      SELECT 1 FROM route_destinations rd WHERE rd.route_id = r.id AND rd.destination_id = NEW.id
    );
  END IF;
  RETURN NULL;
END;
$$;

-- Same done predicate as routeDoneCoverageSql: manual/legacy NULL counts,
-- automatic coverage under 0.70 does not. A published report adds 0.1.
CREATE OR REPLACE FUNCTION peaks_refresh_route_popularity()
RETURNS INT
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  changed INT;
BEGIN
  -- Touch only routes that score now or scored before (partial index), never
  -- the whole wide routes table: a full scan cost 6 s cold on prod (2026-10-12).
  WITH done_users AS (
    SELECT sr.route_id, count(DISTINCT s.user_id)::float8 AS users
    FROM session_routes sr JOIN tracking_sessions s ON s.id = sr.session_id
    WHERE (sr.coverage IS NULL OR sr.coverage >= 0.7)
    GROUP BY sr.route_id
  ), reports AS (
    SELECT trr.route_id, count(*)::float8 * 0.1 AS weight
    FROM trip_report_routes trr JOIN trip_reports tr ON tr.id = trr.report_id
    WHERE tr.moderation_state = 'published'
    GROUP BY trr.route_id
  ), scored AS (
    SELECT COALESCE(d.route_id, p.route_id) AS route_id,
      COALESCE(d.users, 0) + COALESCE(p.weight, 0) AS popularity
    FROM done_users d FULL JOIN reports p ON p.route_id = d.route_id
  ), scores AS (
    SELECT route_id, popularity FROM scored
    UNION ALL
    SELECT r.id, 0 FROM routes r
    WHERE r.owner = 'peaks' AND r.popularity <> 0
      AND NOT EXISTS (SELECT 1 FROM scored WHERE scored.route_id = r.id)
  )
  UPDATE routes r SET popularity = scores.popularity
  FROM scores WHERE r.id = scores.route_id AND r.owner = 'peaks'
    AND r.popularity IS DISTINCT FROM scores.popularity;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

DROP TRIGGER IF EXISTS trg_routes_materialize_catalog ON routes;
CREATE TRIGGER trg_routes_materialize_catalog
BEFORE INSERT OR UPDATE OF name, distance, gain, gain_loss, shape, completion,
  owner, status, kind, slug, objective_destination_id, trailhead_destination_id,
  state_code, country_code ON routes
FOR EACH ROW EXECUTE FUNCTION materialize_peaks_route_catalog();

DROP TRIGGER IF EXISTS trg_route_destinations_refresh_catalog ON route_destinations;
CREATE TRIGGER trg_route_destinations_refresh_catalog
AFTER INSERT OR UPDATE OR DELETE ON route_destinations
FOR EACH ROW EXECUTE FUNCTION refresh_peaks_route_catalog_stops();

DROP TRIGGER IF EXISTS trg_destinations_refresh_route_catalog ON destinations;
CREATE TRIGGER trg_destinations_refresh_route_catalog
AFTER UPDATE OF features, state_code, country_code ON destinations
FOR EACH ROW EXECUTE FUNCTION refresh_peaks_route_catalog_destination();

-- Refresh existing rows in stable ID order so duplicate names get repeatable
-- suffixes. The trigger keeps previously assigned slugs intact. User routes
-- get search_name, difficulty and time; only catalog rows get the rest.
-- Touches no path, status or owner, so no session re-match is queued.
DO $$
DECLARE route_id TEXT;
BEGIN
  FOR route_id IN SELECT id FROM routes ORDER BY id LOOP
    UPDATE routes SET name = name WHERE id = route_id;
  END LOOP;
END;
$$;

SELECT peaks_refresh_route_popularity();

COMMIT;
