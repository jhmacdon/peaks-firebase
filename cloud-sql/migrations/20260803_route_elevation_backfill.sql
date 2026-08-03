-- Materialize client elevation profiles from Peaks-owned PostGIS route paths.
-- The durable queue supports local, leased backfill work without an always-on
-- service. Expected backend run-rate change: near $0/month.

BEGIN;

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
