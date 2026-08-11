-- Preserve source precision in Peaks route profiles and enforce equality for
-- elevation values stored both as a plain float8 and a PostGIS Z coordinate.
-- This adds no service or recurring work. Expected run-rate change: $0/month.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Install the write guards in their own short transaction. ADD CONSTRAINT
-- NOT VALID checks new and changed rows as soon as this transaction commits,
-- without scanning either live table or holding either lock during repair.
DO $$
DECLARE
  expected_marker CONSTANT TEXT :=
    'peaks:elevation-matches-location-z:finite-float8-v1';
  expected_definition CONSTANT TEXT :=
    'CHECK (elevation_matches_location_z(elevation, location))';
  helper_oid OID := to_regprocedure(
    'elevation_matches_location_z(double precision,geography)'
  );
  helper_marker TEXT;
  has_validated_dependency BOOLEAN;
BEGIN
  IF helper_oid IS NULL THEN
    RETURN;
  END IF;

  helper_marker := obj_description(helper_oid, 'pg_proc');
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE convalidated
      AND (
        (conrelid = 'destinations'::regclass
          AND conname = 'destinations_elevation_matches_location_z')
        OR (conrelid = 'tracking_points'::regclass
          AND conname = 'tracking_points_elevation_matches_location_z')
      )
      AND regexp_replace(pg_get_constraintdef(oid, true), ' NOT VALID$', '') =
          expected_definition
  ) INTO has_validated_dependency;

  IF has_validated_dependency AND helper_marker IS DISTINCT FROM expected_marker THEN
    RAISE EXCEPTION
      'refusing to replace unmarked elevation_matches_location_z behind a validated constraint';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION elevation_matches_location_z(
  elevation DOUBLE PRECISION,
  location geography
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT (
    location IS NULL
    OR (
      ST_Z(location::geometry) IS NOT NULL
      AND ST_Z(location::geometry) NOT IN (
        'NaN'::DOUBLE PRECISION,
        'Infinity'::DOUBLE PRECISION,
        '-Infinity'::DOUBLE PRECISION
      )
    )
  ) AND (
    elevation IS NULL
    OR (
      location IS NOT NULL
      AND elevation NOT IN (
        'NaN'::DOUBLE PRECISION,
        'Infinity'::DOUBLE PRECISION,
        '-Infinity'::DOUBLE PRECISION
      )
      AND elevation = ST_Z(location::geometry)
    )
  );
$$;

COMMENT ON FUNCTION elevation_matches_location_z(DOUBLE PRECISION, geography) IS
  'peaks:elevation-matches-location-z:finite-float8-v1';

DO $$
DECLARE
  expected_definition CONSTANT TEXT :=
    'CHECK (elevation_matches_location_z(elevation, location))';
  actual_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid, true) INTO actual_definition
  FROM pg_constraint
  WHERE conrelid = 'destinations'::regclass
    AND conname = 'destinations_elevation_matches_location_z';

  IF actual_definition IS NULL THEN
    ALTER TABLE destinations
      ADD CONSTRAINT destinations_elevation_matches_location_z
      CHECK (elevation_matches_location_z(elevation, location)) NOT VALID;
  ELSIF regexp_replace(actual_definition, ' NOT VALID$', '') <>
      expected_definition THEN
    RAISE EXCEPTION
      'constraint destinations_elevation_matches_location_z has unexpected definition: %',
      actual_definition;
  END IF;

  SELECT pg_get_constraintdef(oid, true) INTO actual_definition
  FROM pg_constraint
  WHERE conrelid = 'tracking_points'::regclass
    AND conname = 'tracking_points_elevation_matches_location_z';

  IF actual_definition IS NULL THEN
    ALTER TABLE tracking_points
      ADD CONSTRAINT tracking_points_elevation_matches_location_z
      CHECK (elevation_matches_location_z(elevation, location)) NOT VALID;
  ELSIF regexp_replace(actual_definition, ' NOT VALID$', '') <>
      expected_definition THEN
    RAISE EXCEPTION
      'constraint tracking_points_elevation_matches_location_z has unexpected definition: %',
      actual_definition;
  END IF;
END;
$$;

COMMIT;

BEGIN;

SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtextextended('peaks:elevation-double-precision:v1', 0));

-- Workers claim a job before they inspect or update its route. Take the three
-- job-table locks first, then the source and join tables in their normal write
-- order. SHARE ROW EXCLUSIVE
-- is the weakest mode that both blocks new ROW EXCLUSIVE writer/claim locks
-- and lets this transaction update the locked tables without a later upgrade.
-- Route writers normally take routes before segments and join rows, so those
-- follow in write order. A few legacy writers use another order; the local
-- timeout makes an overlap fail this migration closed instead of waiting or
-- creating a long deadlock chain.
LOCK TABLE
  route_elevation_backfill_jobs,
  route_catalog_audit_jobs,
  standard_route_backfill_jobs,
  routes,
  segments,
  route_segments,
  route_destinations
IN SHARE ROW EXCLUSIVE MODE;

-- Snapshot bytes from whichever encoder is installed. The legacy whole-metre
-- codec can overflow its bigint cast for an extreme finite Z, so do not invoke
-- an unmarked codec on those paths. They are affected by definition. The
-- explicit codec marker lets later runs compare the full finite float8 range.
CREATE TEMP TABLE elevation_precision_segment_profiles_before ON COMMIT DROP AS
WITH encoder_capability AS (
  SELECT COALESCE(
           obj_description(
             'encode_route_elevation_profile(geography)'::regprocedure,
             'pg_proc'
           ) = 'peaks:route-elevation-profile:finite-float8-v1',
           false
         ) AS supports_full_float8
), segment_safety AS MATERIALIZED (
  SELECT segment.id,
         segment.path,
         encoder_capability.supports_full_float8,
         safety.unsafe_for_legacy_bigint
  FROM segments segment
  CROSS JOIN encoder_capability
  CROSS JOIN LATERAL (
    SELECT COALESCE(bool_or(
      CASE
        WHEN ST_Z((dumped).geom) IS NULL
          OR ST_Z((dumped).geom) IN (
            'NaN'::DOUBLE PRECISION,
            'Infinity'::DOUBLE PRECISION,
            '-Infinity'::DOUBLE PRECISION
          ) THEN false
        ELSE round(ST_Z((dumped).geom)::numeric) NOT BETWEEN
             '-9223372036854775808'::numeric
             AND '9223372036854775807'::numeric
      END
    ), false) AS unsafe_for_legacy_bigint
    FROM ST_DumpPoints(segment.path::geometry) dumped
  ) safety
  WHERE EXISTS (
    SELECT 1
    FROM route_segments linked
    JOIN routes route ON route.id = linked.route_id
    WHERE linked.segment_id = segment.id
      AND route.owner = 'peaks'
  )
)
SELECT id,
       NOT supports_full_float8 AND unsafe_for_legacy_bigint AS forced_affected,
       CASE
         WHEN supports_full_float8 OR NOT unsafe_for_legacy_bigint
         THEN encode_route_elevation_profile(path)
         ELSE NULL
       END AS elevation_profile
FROM segment_safety;

CREATE OR REPLACE FUNCTION canonical_elevation_token(elevation DOUBLE PRECISION)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
SET extra_float_digits = 1
AS $$
  SELECT CASE
    WHEN elevation IN (
      'NaN'::DOUBLE PRECISION,
      'Infinity'::DOUBLE PRECISION,
      '-Infinity'::DOUBLE PRECISION
    ) THEN NULL
    WHEN elevation = 0 THEN '0'
    ELSE ((elevation::text)::numeric)::text
  END;
$$;

CREATE OR REPLACE FUNCTION encode_route_elevation_profile(path geography)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  point_count BIGINT;
  valid_point_count BIGINT;
  has_nonzero_elevation BOOLEAN;
  elevation_profile TEXT;
BEGIN
  IF path IS NULL
    OR ST_IsEmpty(path::geometry)
    OR ST_GeometryType(path::geometry) <> 'ST_LineString'
    OR NOT ST_IsValid(path::geometry) THEN
    RETURN NULL;
  END IF;

  WITH points AS (
    SELECT (dumped).path AS point_path,
           ST_Z((dumped).geom) AS elevation
    FROM ST_DumpPoints(path::geometry) AS dumped
  ), valid_points AS (
    SELECT *,
           elevation IS NOT NULL
             AND elevation NOT IN (
               'NaN'::DOUBLE PRECISION,
               'Infinity'::DOUBLE PRECISION,
               '-Infinity'::DOUBLE PRECISION
             ) AS has_valid_elevation
    FROM points
  )
  SELECT count(*),
         count(*) FILTER (WHERE has_valid_elevation),
         COALESCE(bool_or(elevation <> 0) FILTER (WHERE has_valid_elevation), false),
         string_agg(canonical_elevation_token(elevation), '|' ORDER BY point_path)
           FILTER (WHERE has_valid_elevation)
  INTO point_count, valid_point_count, has_nonzero_elevation, elevation_profile
  FROM valid_points;

  IF point_count < 2
    OR point_count <> valid_point_count
    OR NOT has_nonzero_elevation THEN
    RETURN NULL;
  END IF;

  RETURN replace(
    replace(encode(convert_to(elevation_profile, 'SQL_ASCII'), 'base64'), E'\n', ''),
    E'\r',
    ''
  );
END;
$$;

COMMENT ON FUNCTION encode_route_elevation_profile(geography) IS
  'peaks:route-elevation-profile:finite-float8-v1';

CREATE OR REPLACE FUNCTION route_elevation_profile_has_real_range(path geography)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    (
      SELECT point_count >= 2
        AND point_count = valid_point_count
        AND max_elevation - min_elevation >= 1
      FROM (
        SELECT count(*) AS point_count,
               count(elevation) FILTER (WHERE elevation_is_finite) AS valid_point_count,
               max(elevation) FILTER (WHERE elevation_is_finite) AS max_elevation,
               min(elevation) FILTER (WHERE elevation_is_finite) AS min_elevation
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

DO $$
DECLARE
  active_elevation_leases BIGINT;
  active_catalog_leases BIGINT;
  active_standard_route_leases BIGINT;
BEGIN
  SELECT count(*) INTO active_elevation_leases
  FROM route_elevation_backfill_jobs
  WHERE state = 'working' AND lease_expires_at >= now();

  SELECT count(*) INTO active_catalog_leases
  FROM route_catalog_audit_jobs
  WHERE state = 'auditing' AND lease_expires_at >= now();

  SELECT count(*) INTO active_standard_route_leases
  FROM standard_route_backfill_jobs
  WHERE lease_token IS NOT NULL AND lease_expires_at >= now();

  IF active_elevation_leases <> 0
    OR active_catalog_leases <> 0
    OR active_standard_route_leases <> 0 THEN
    RAISE EXCEPTION
      'elevation precision preflight blocked by active work: % elevation, % catalog, % standard-route leases',
      active_elevation_leases,
      active_catalog_leases,
      active_standard_route_leases;
  END IF;
END;
$$;

-- Keep a cheap all-route timestamp snapshot to prove the update did not touch
-- unrelated Peaks rows. EWKB hashing is limited to the rows the repair will
-- update; hashing every route dominated the production migration runtime.
CREATE TEMP TABLE elevation_precision_route_timestamps_before ON COMMIT DROP AS
SELECT id, updated_at
FROM routes
WHERE owner = 'peaks';

CREATE TEMP TABLE elevation_precision_changed_routes ON COMMIT DROP AS
WITH profiles AS MATERIALIZED (
  SELECT r.id,
         r.elevation_string AS old_elevation_string,
         encode_route_elevation_profile(r.path) AS new_elevation_string
  FROM routes r
  WHERE r.owner = 'peaks'
)
SELECT id, old_elevation_string, new_elevation_string
FROM profiles
WHERE old_elevation_string IS DISTINCT FROM new_elevation_string;

CREATE TEMP TABLE elevation_precision_changed_route_paths_before ON COMMIT DROP AS
SELECT r.id,
       CASE WHEN r.path IS NULL THEN NULL
            ELSE md5(encode(ST_AsEWKB(r.path::geometry), 'hex')) END AS path_hash
FROM routes r
JOIN elevation_precision_changed_routes changed USING (id);

CREATE TEMP TABLE elevation_precision_profile_affected_routes ON COMMIT DROP AS
SELECT changed.id
FROM elevation_precision_changed_routes changed
UNION
SELECT DISTINCT r.id
FROM routes r
JOIN route_segments linked ON linked.route_id = r.id
JOIN segments segment ON segment.id = linked.segment_id
JOIN elevation_precision_segment_profiles_before before_segment
  ON before_segment.id = segment.id
WHERE r.owner = 'peaks'
  AND (
    before_segment.forced_affected
    OR before_segment.elevation_profile IS DISTINCT FROM
       encode_route_elevation_profile(segment.path)
  );

UPDATE routes r
SET elevation_string = changed.new_elevation_string,
    updated_at = now()
FROM elevation_precision_changed_routes changed
WHERE r.id = changed.id;

-- A profile byte change invalidates saved evidence. No active lease exists due
-- to the locked preflight above. Elevation jobs get the same current fingerprint
-- used by the worker and return to queued or out-of-scope without claiming that
-- the new bytes were independently verified. Catalog jobs keep their truthful
-- old fingerprint and receive an explicit stale marker so
-- their next seed pass writes the full current catalog fingerprint; verified
-- standard-route jobs return to their normal verification state.
WITH current_fingerprints AS (
  SELECT r.id AS route_id,
         md5(concat_ws('|', r.id, r.owner, r.status, COALESCE(r.name, ''),
             COALESCE(r.distance::text, ''), COALESCE(r.shape::text, ''),
             encode(ST_AsEWKB(r.path::geometry), 'hex'),
             COALESCE(r.elevation_string, ''),
             COALESCE(r.gain::text, ''), COALESCE(r.gain_loss::text, ''),
             COALESCE(r.elevation_source, ''), COALESCE(r.elevation_source_url, ''),
             COALESCE(r.elevation_attribution, ''), COALESCE(r.elevation_license_url, ''),
             COALESCE(r.elevation_retrieved_at::text, ''),
             COALESCE((SELECT string_agg(concat_ws(':',
               rs.ordinal::text, rs.direction, s.id,
               COALESCE(encode(ST_AsEWKB(s.path::geometry), 'hex'), ''),
               COALESCE(encode_route_elevation_profile(s.path), ''),
               COALESCE(s.gain::text, ''), COALESCE(s.gain_loss::text, ''),
               COALESCE(s.provenance::text, '')), ',' ORDER BY rs.ordinal, rs.segment_id)
               FROM route_segments rs
               JOIN segments s ON s.id = rs.segment_id
               WHERE rs.route_id = r.id), ''))
           ) AS path_fingerprint,
         r.status IN ('active', 'pending') AND r.path IS NOT NULL
           AS in_worker_scope
  FROM routes r
  JOIN elevation_precision_profile_affected_routes affected ON affected.id = r.id
)
UPDATE route_elevation_backfill_jobs job
SET path_fingerprint = current.path_fingerprint,
    state = CASE WHEN current.in_worker_scope THEN 'queued' ELSE 'out_of_scope' END,
    attempt_count = 0,
    last_error = NULL,
    final_evidence = NULL,
    next_attempt_at = now(),
    lease_owner = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    updated_at = now()
FROM current_fingerprints current
WHERE job.route_id = current.route_id
  AND job.path_fingerprint IS DISTINCT FROM current.path_fingerprint;

WITH impacted_catalog_jobs AS (
  SELECT DISTINCT job.destination_id
  FROM route_catalog_audit_jobs job
  JOIN route_destinations rd ON rd.destination_id = job.destination_id
  JOIN elevation_precision_profile_affected_routes affected ON affected.id = rd.route_id
  JOIN routes route ON route.id = affected.id
  WHERE route.status = 'active'
     OR (
       route.status = 'superseded'
       AND route.id ~ '^osm-route-[0-9]+-[0-9a-f]{10}$'
       AND route.provenance IS NULL
       AND route.completion = 'none'
       AND route.shape IS NULL
       AND route.gain IS NULL
       AND route.gain_loss IS NULL
       AND jsonb_typeof(route.external_links) = 'array'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(route.external_links) link
         WHERE link->>'type' = 'osm'
           AND link->>'id' ~ '^relation/[0-9]+$'
       )
       AND NOT EXISTS (
         SELECT 1 FROM route_segments linked_segment
         WHERE linked_segment.route_id = route.id
       )
       AND NOT EXISTS (
         SELECT 1
         FROM route_destinations linked_destination_route
         JOIN destinations linked_destination
           ON linked_destination.id = linked_destination_route.destination_id
         WHERE linked_destination_route.route_id = route.id
           AND 'trailhead'::destination_feature = ANY(linked_destination.features)
       )
     )
)
UPDATE route_catalog_audit_jobs job
SET state = 'queued',
    attempt_count = 0,
    last_error = NULL,
    final_result = jsonb_build_object(
      'stale_reason', 'elevation_profile_format_changed',
      'previous_catalog_fingerprint', job.catalog_fingerprint
    ),
    audited_at = NULL,
    lease_owner = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    updated_at = now()
FROM impacted_catalog_jobs impacted
WHERE job.destination_id = impacted.destination_id;

UPDATE standard_route_backfill_jobs job
SET state = CASE WHEN job.state = 'verified' THEN 'published' ELSE job.state END,
    evidence = job.evidence - 'last_verification' - 'verification_action',
    next_attempt_at = now(),
    last_error = NULL,
    updated_at = now()
FROM elevation_precision_changed_routes changed
WHERE changed.id = job.published_route_id
   OR changed.id = job.replacement_route_id;

DO $$
DECLARE
  changed_path_count BIGINT;
  unchanged_timestamp_changes BIGINT;
  invalid_profile_count BIGINT;
  malformed_or_mismatched_profile_count BIGINT;
BEGIN
  SELECT count(*) INTO changed_path_count
  FROM routes r
  JOIN elevation_precision_changed_route_paths_before before_row USING (id)
  WHERE (CASE WHEN r.path IS NULL THEN NULL
              ELSE md5(encode(ST_AsEWKB(r.path::geometry), 'hex')) END)
        IS DISTINCT FROM before_row.path_hash;

  SELECT count(*) INTO unchanged_timestamp_changes
  FROM routes r
  JOIN elevation_precision_route_timestamps_before before_row USING (id)
  LEFT JOIN elevation_precision_changed_routes changed USING (id)
  WHERE changed.id IS NULL
    AND r.updated_at IS DISTINCT FROM before_row.updated_at;

  WITH path_checks AS (
    SELECT r.id,
           r.elevation_string,
           r.path IS NOT NULL
             AND NOT ST_IsEmpty(r.path::geometry)
             AND ST_GeometryType(r.path::geometry) = 'ST_LineString'
             AND ST_IsValid(r.path::geometry)
             AND ST_NPoints(r.path::geometry) >= 2
             AND NOT EXISTS (
               SELECT 1 FROM ST_DumpPoints(r.path::geometry) dumped
               WHERE ST_Z((dumped).geom) IS NULL
                  OR ST_Z((dumped).geom) IN (
                    'NaN'::DOUBLE PRECISION,
                    'Infinity'::DOUBLE PRECISION,
                    '-Infinity'::DOUBLE PRECISION
                  )
             )
             AND EXISTS (
               SELECT 1 FROM ST_DumpPoints(r.path::geometry) dumped
               WHERE ST_Z((dumped).geom) <> 0
             ) AS has_valid_profile_source
    FROM routes r
    WHERE r.owner = 'peaks'
  )
  SELECT count(*) INTO invalid_profile_count
  FROM path_checks
  WHERE NOT has_valid_profile_source AND elevation_string IS NOT NULL;

  WITH valid_routes AS (
    SELECT r.id, r.path, r.elevation_string
    FROM routes r
    WHERE r.owner = 'peaks'
      AND r.path IS NOT NULL
      AND NOT ST_IsEmpty(r.path::geometry)
      AND ST_GeometryType(r.path::geometry) = 'ST_LineString'
      AND ST_IsValid(r.path::geometry)
      AND ST_NPoints(r.path::geometry) >= 2
      AND NOT EXISTS (
        SELECT 1 FROM ST_DumpPoints(r.path::geometry) dumped
        WHERE ST_Z((dumped).geom) IS NULL
           OR ST_Z((dumped).geom) IN (
             'NaN'::DOUBLE PRECISION,
             'Infinity'::DOUBLE PRECISION,
             '-Infinity'::DOUBLE PRECISION
           )
      )
      AND EXISTS (
        SELECT 1 FROM ST_DumpPoints(r.path::geometry) dumped
        WHERE ST_Z((dumped).geom) <> 0
      )
  ), profile_tokens AS (
    SELECT route.id,
           token.ordinality::int AS ordinal,
           token.value
    FROM valid_routes route
    CROSS JOIN LATERAL unnest(
      string_to_array(
        convert_from(decode(route.elevation_string, 'base64'), 'SQL_ASCII'),
        '|'
      )
    ) WITH ORDINALITY token(value, ordinality)
  ), path_points AS (
    SELECT route.id,
           (dumped).path[1]::int AS ordinal,
           ST_Z((dumped).geom) AS elevation
    FROM valid_routes route
    CROSS JOIN LATERAL ST_DumpPoints(route.path::geometry) dumped
  ), compared AS (
    SELECT COALESCE(path_points.id, profile_tokens.id) AS id,
           path_points.ordinal AS path_ordinal,
           profile_tokens.ordinal AS profile_ordinal,
           path_points.elevation,
           profile_tokens.value
    FROM path_points
    FULL JOIN profile_tokens
      ON profile_tokens.id = path_points.id
     AND profile_tokens.ordinal = path_points.ordinal
  ), failures AS (
    SELECT DISTINCT id
    FROM compared
    WHERE path_ordinal IS NULL
       OR profile_ordinal IS NULL
       OR value !~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'
       OR value = '-0'
       OR value::DOUBLE PRECISION IS DISTINCT FROM elevation
  )
  SELECT count(*) INTO malformed_or_mismatched_profile_count FROM failures;

  IF changed_path_count <> 0
    OR unchanged_timestamp_changes <> 0
    OR invalid_profile_count <> 0
    OR malformed_or_mismatched_profile_count <> 0 THEN
    RAISE EXCEPTION
      'elevation profile repair failed: % paths changed, % unrelated timestamps changed, % stale invalid profiles, % malformed/count/value mismatches',
      changed_path_count,
      unchanged_timestamp_changes,
      invalid_profile_count,
      malformed_or_mismatched_profile_count;
  END IF;
END;
$$;

COMMIT;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Validation scans old rows with SHARE UPDATE EXCLUSIVE. PostgreSQL permits
-- normal ROW EXCLUSIVE inserts and updates while this final scan runs. Check
-- the exact definition again and fail closed if it changed after the prelude.
DO $$
DECLARE
  expected_definition CONSTANT TEXT :=
    'CHECK (elevation_matches_location_z(elevation, location))';
  actual_definition TEXT;
  constraint_is_validated BOOLEAN;
BEGIN
  SELECT pg_get_constraintdef(oid, true), convalidated
  INTO actual_definition, constraint_is_validated
  FROM pg_constraint
  WHERE conrelid = 'destinations'::regclass
    AND conname = 'destinations_elevation_matches_location_z';

  IF actual_definition IS NULL THEN
    RAISE EXCEPTION
      'constraint destinations_elevation_matches_location_z disappeared before validation';
  ELSIF regexp_replace(actual_definition, ' NOT VALID$', '') <>
      expected_definition THEN
    RAISE EXCEPTION
      'constraint destinations_elevation_matches_location_z has unexpected definition: %',
      actual_definition;
  ELSIF NOT constraint_is_validated THEN
    ALTER TABLE destinations
      VALIDATE CONSTRAINT destinations_elevation_matches_location_z;
  END IF;

  SELECT pg_get_constraintdef(oid, true), convalidated
  INTO actual_definition, constraint_is_validated
  FROM pg_constraint
  WHERE conrelid = 'tracking_points'::regclass
    AND conname = 'tracking_points_elevation_matches_location_z';

  IF actual_definition IS NULL THEN
    RAISE EXCEPTION
      'constraint tracking_points_elevation_matches_location_z disappeared before validation';
  ELSIF regexp_replace(actual_definition, ' NOT VALID$', '') <>
      expected_definition THEN
    RAISE EXCEPTION
      'constraint tracking_points_elevation_matches_location_z has unexpected definition: %',
      actual_definition;
  ELSIF NOT constraint_is_validated THEN
    ALTER TABLE tracking_points
      VALIDATE CONSTRAINT tracking_points_elevation_matches_location_z;
  END IF;
END;
$$;

COMMIT;
