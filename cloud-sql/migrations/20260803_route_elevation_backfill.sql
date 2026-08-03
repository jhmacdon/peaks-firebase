-- Materialize client elevation profiles from Peaks-owned PostGIS route paths.
-- The durable queue supports local, leased backfill work without an always-on
-- service. Expected backend run-rate change: near $0/month.

BEGIN;

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS elevation_source TEXT,
  ADD COLUMN IF NOT EXISTS elevation_source_url TEXT,
  ADD COLUMN IF NOT EXISTS elevation_attribution TEXT,
  ADD COLUMN IF NOT EXISTS elevation_license_url TEXT,
  ADD COLUMN IF NOT EXISTS elevation_retrieved_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION encode_route_elevation_profile(path geography)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  point_count BIGINT;
  valid_point_count BIGINT;
  has_nonzero_rounded_elevation BOOLEAN;
  elevation_profile TEXT;
BEGIN
  IF path IS NULL
    OR ST_IsEmpty(path::geometry)
    OR ST_GeometryType(path::geometry) <> 'ST_LineString'
    OR NOT ST_IsValid(path::geometry) THEN
    RETURN NULL;
  END IF;

  WITH points AS (
    SELECT
      (dumped).path AS point_path,
      ST_Z((dumped).geom) AS elevation
    FROM ST_DumpPoints(path::geometry) AS dumped
  ), valid_points AS (
    SELECT
      *,
      elevation IS NOT NULL
        AND elevation NOT IN (
          'NaN'::DOUBLE PRECISION,
          'Infinity'::DOUBLE PRECISION,
          '-Infinity'::DOUBLE PRECISION
        ) AS has_valid_elevation
    FROM points
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE has_valid_elevation),
    COALESCE(bool_or(round(elevation::numeric)::bigint <> 0) FILTER (
      WHERE has_valid_elevation
    ), false),
    string_agg(
      (round(elevation::numeric)::bigint)::text,
      '|' ORDER BY point_path
    ) FILTER (WHERE has_valid_elevation)
  INTO
    point_count,
    valid_point_count,
    has_nonzero_rounded_elevation,
    elevation_profile
  FROM valid_points;

  IF point_count < 2
    OR point_count <> valid_point_count
    OR NOT has_nonzero_rounded_elevation THEN
    RETURN NULL;
  END IF;

  RETURN replace(
    replace(encode(convert_to(elevation_profile, 'SQL_ASCII'), 'base64'), E'\n', ''),
    E'\r',
    ''
  );
END;
$$;

CREATE OR REPLACE FUNCTION route_elevation_profile_has_real_range(path geography)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    (
      SELECT point_count >= 2
        AND point_count = valid_point_count
        AND max_rounded_elevation - min_rounded_elevation >= 1
      FROM (
        SELECT count(*) AS point_count,
               count(elevation) FILTER (WHERE elevation_is_finite)
                 AS valid_point_count,
               max(round(elevation::numeric)::bigint)
                 FILTER (WHERE elevation_is_finite)
                 AS max_rounded_elevation,
               min(round(elevation::numeric)::bigint)
                 FILTER (WHERE elevation_is_finite)
                 AS min_rounded_elevation
        FROM (
          SELECT ST_Z((dumped).geom) AS elevation,
                 ST_Z((dumped).geom) IS NOT NULL
                   AND ST_Z((dumped).geom) NOT IN (
                     'NaN'::DOUBLE PRECISION,
                     'Infinity'::DOUBLE PRECISION,
                     '-Infinity'::DOUBLE PRECISION
                   ) AS elevation_is_finite
          FROM ST_DumpPoints(path::geometry) AS dumped
        ) valid_points
      ) elevation_range
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION route_elevation_stats(path geography)
RETURNS TABLE(gain DOUBLE PRECISION, loss DOUBLE PRECISION)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  elevation DOUBLE PRECISION;
  previous_elevation DOUBLE PRECISION;
  pending DOUBLE PRECISION := 0;
  point_count INTEGER := 0;
BEGIN
  gain := 0;
  loss := 0;
  IF path IS NULL THEN
    gain := NULL;
    loss := NULL;
    RETURN NEXT;
    RETURN;
  END IF;
  FOR elevation IN
    SELECT ST_Z((dumped).geom)
    FROM ST_DumpPoints(path::geometry) AS dumped
    ORDER BY (dumped).path
  LOOP
    IF elevation IS NULL OR elevation IN (
      'NaN'::DOUBLE PRECISION,
      'Infinity'::DOUBLE PRECISION,
      '-Infinity'::DOUBLE PRECISION
    ) THEN
      gain := NULL;
      loss := NULL;
      RETURN NEXT;
      RETURN;
    END IF;
    point_count := point_count + 1;
    IF previous_elevation IS NULL THEN
      previous_elevation := elevation;
      CONTINUE;
    END IF;
    IF (pending >= 0 AND elevation - previous_elevation >= 0)
      OR (pending <= 0 AND elevation - previous_elevation <= 0) THEN
      pending := pending + elevation - previous_elevation;
    ELSE
      IF pending > 4 THEN
        gain := gain + pending;
      ELSIF pending < -4 THEN
        loss := loss + abs(pending);
      END IF;
      pending := elevation - previous_elevation;
    END IF;
    previous_elevation := elevation;
  END LOOP;
  IF point_count < 2 THEN
    gain := NULL;
    loss := NULL;
  ELSIF pending > 4 THEN
    gain := gain + pending;
  ELSIF pending < -4 THEN
    loss := loss + abs(pending);
  END IF;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION materialize_peaks_route_elevation_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.elevation_string = encode_route_elevation_profile(NEW.path);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION touch_route_elevation_backfill_job()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_routes_materialize_peaks_elevation_profile ON routes;

CREATE TRIGGER trg_routes_materialize_peaks_elevation_profile
BEFORE INSERT OR UPDATE OF path, owner ON routes
FOR EACH ROW
WHEN (NEW.owner = 'peaks')
EXECUTE FUNCTION materialize_peaks_route_elevation_profile();

CREATE TABLE IF NOT EXISTS route_elevation_backfill_jobs (
  route_id            TEXT PRIMARY KEY REFERENCES routes(id) ON DELETE CASCADE,
  state               TEXT NOT NULL DEFAULT 'queued',
  path_fingerprint    TEXT NOT NULL,
  priority            INTEGER NOT NULL DEFAULT 0,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  source_kind         TEXT NOT NULL DEFAULT 'unknown',
  last_error          TEXT,
  final_evidence      JSONB,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner         TEXT,
  lease_token         TEXT,
  lease_expires_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT route_elevation_backfill_jobs_state_check CHECK (
    state IN ('queued', 'working', 'retry', 'blocked', 'complete', 'out_of_scope')
  ),
  CONSTRAINT route_elevation_backfill_jobs_attempt_count_check CHECK (
    attempt_count >= 0
  ),
  CONSTRAINT route_elevation_backfill_jobs_source_kind_check CHECK (
    btrim(source_kind) <> ''
  ),
  CONSTRAINT route_elevation_backfill_jobs_lease_check CHECK (
    (state = 'working'
      AND lease_owner IS NOT NULL
      AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL)
    OR
    (state <> 'working'
      AND lease_owner IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL)
  )
);

DROP TRIGGER IF EXISTS trg_route_elevation_backfill_jobs_updated
  ON route_elevation_backfill_jobs;

CREATE TRIGGER trg_route_elevation_backfill_jobs_updated
BEFORE UPDATE ON route_elevation_backfill_jobs
FOR EACH ROW EXECUTE FUNCTION touch_route_elevation_backfill_job();

CREATE INDEX IF NOT EXISTS idx_route_elevation_backfill_jobs_claim
  ON route_elevation_backfill_jobs (
    state,
    next_attempt_at,
    priority DESC,
    route_id
  )
  WHERE state IN ('queued', 'retry');

CREATE INDEX IF NOT EXISTS idx_route_elevation_backfill_jobs_lease
  ON route_elevation_backfill_jobs (lease_expires_at)
  WHERE state = 'working';

GRANT SELECT, INSERT, UPDATE, DELETE
  ON route_elevation_backfill_jobs TO "peaks-api";

COMMIT;
