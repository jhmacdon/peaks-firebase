/**
 * Dry-run elevation precision report. `--apply` runs the reviewed transactional
 * migration, then opens a fresh repeatable-read, read-only audit transaction.
 * Reports contain counts only: no user, session, destination, or route IDs.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Pool, PoolClient } from "pg";
import db from "./db";

type OutputFormat = "human" | "json";

export interface AuditArgs {
  apply: boolean;
  format: OutputFormat;
  expectedDatabase: string | null;
  expectedInstance: string | null;
  expectedHost: string | null;
}

export interface ApplyTarget {
  database: string;
  instance: string;
  host: string;
}

interface AuditCountRow {
  destination_mismatches: number | string;
  tracking_point_mismatches: number | string;
  integer_looking_destinations: number | string;
  destinations_with_source_ids: number | string;
  legacy_integer_profiles: number | string;
  malformed_or_out_of_range_profiles: number | string;
  recoverable_peaks_profiles: number | string;
  invalid_peaks_profiles: number | string;
  user_profiles_preserved: number | string;
  active_elevation_leases: number | string;
  active_catalog_leases: number | string;
  active_standard_route_leases: number | string;
  stale_elevation_jobs: number | string;
  catalog_jobs_affected: number | string;
  standard_jobs_needing_verification: number | string;
  nonfinite_destination_scalars: number | string;
  nonfinite_destination_z: number | string;
  nonfinite_tracking_scalars: number | string;
  nonfinite_tracking_z: number | string;
  nonfinite_route_scalars: number | string;
  nonfinite_route_z: number | string;
  nonfinite_segment_scalars: number | string;
  nonfinite_segment_z: number | string;
  nonfinite_session_scalars: number | string;
  nonfinite_session_path_z: number | string;
  nonfinite_marker_z: number | string;
  nonfinite_plan_gain: number | string;
  nonfinite_elevation_jsonb: number | string;
  fractional_destination_z: number | string;
  fractional_tracking_z: number | string;
  fractional_route_scalars: number | string;
  fractional_route_z: number | string;
  fractional_segment_scalars: number | string;
  fractional_segment_z: number | string;
  fractional_session_scalars: number | string;
  fractional_session_path_z: number | string;
  fractional_marker_z: number | string;
  fractional_plan_gain: number | string;
  elevation_like_jsonb_values: number | string;
  fractional_elevation_jsonb: number | string;
  route_profile_count: number | string;
  route_profile_samples: number | string;
  min_profile_samples: number | string;
  max_profile_samples: number | string;
  min_profile_bytes: number | string;
  max_profile_bytes: number | string;
  min_profile_elevation: number | string | null;
  max_profile_elevation: number | string | null;
}

interface SchemaTypeRow {
  table_name: string;
  column_name: string;
  data_type: string;
}

interface QueryClient {
  query(sql: string): Promise<{ rows: unknown[] }>;
  release(): void;
}

interface QueryPool {
  connect(): Promise<QueryClient>;
}

export const COUNTS_SQL = `
WITH RECURSIVE profile_paths AS (
  SELECT 'route'::text AS source_kind, r.id AS source_id, r.path
  FROM routes r
  UNION ALL
  SELECT 'segment'::text AS source_kind, s.id AS source_id, s.path
  FROM segments s
), profile_aggregates AS (
  SELECT profile_paths.*,
         samples.point_count,
         samples.valid_point_count,
         samples.has_nonzero_elevation,
         samples.profile_text
  FROM profile_paths
  CROSS JOIN LATERAL (
    SELECT count((dumped).geom) AS point_count,
           count((dumped).geom) FILTER (
             WHERE ST_Z((dumped).geom) IS NOT NULL
               AND ST_Z((dumped).geom) NOT IN (
                 'NaN'::DOUBLE PRECISION,
                 'Infinity'::DOUBLE PRECISION,
                 '-Infinity'::DOUBLE PRECISION
               )
           ) AS valid_point_count,
           COALESCE(bool_or(ST_Z((dumped).geom) <> 0) FILTER (
             WHERE ST_Z((dumped).geom) IS NOT NULL
               AND ST_Z((dumped).geom) NOT IN (
                 'NaN'::DOUBLE PRECISION,
                 'Infinity'::DOUBLE PRECISION,
                 '-Infinity'::DOUBLE PRECISION
               )
           ), false) AS has_nonzero_elevation,
           string_agg(
             CASE WHEN ST_Z((dumped).geom) = 0 THEN '0'
                  ELSE ((ST_Z((dumped).geom)::text)::numeric)::text END,
             '|' ORDER BY (dumped).path
           ) FILTER (
             WHERE ST_Z((dumped).geom) IS NOT NULL
               AND ST_Z((dumped).geom) NOT IN (
                 'NaN'::DOUBLE PRECISION,
                 'Infinity'::DOUBLE PRECISION,
                 '-Infinity'::DOUBLE PRECISION
               )
           ) AS profile_text
    FROM ST_DumpPoints(profile_paths.path::geometry) dumped
  ) samples
), proposed_path_profiles AS (
  SELECT source_kind,
         source_id,
         CASE WHEN path IS NOT NULL
                    AND NOT ST_IsEmpty(path::geometry)
                    AND ST_GeometryType(path::geometry) = 'ST_LineString'
                    AND ST_IsValid(path::geometry)
                    AND point_count >= 2
                    AND point_count = valid_point_count
                    AND has_nonzero_elevation
              THEN replace(replace(
                encode(convert_to(profile_text, 'SQL_ASCII'), 'base64'),
                E'\\n', ''), E'\\r', '')
              ELSE NULL END AS canonical_profile
  FROM profile_aggregates
), route_profiles AS (
  SELECT r.id,
         r.owner,
         r.path,
         r.elevation_string,
         proposed.canonical_profile,
         CASE
           WHEN r.elevation_string ~ '^[A-Za-z0-9+/]+={0,2}$'
             AND length(r.elevation_string) % 4 = 0
           THEN convert_from(decode(r.elevation_string, 'base64'), 'SQL_ASCII')
           ELSE NULL
         END AS decoded_profile
  FROM routes r
  JOIN proposed_path_profiles proposed
    ON proposed.source_kind = 'route' AND proposed.source_id = r.id
), profile_token_candidates AS MATERIALIZED (
  SELECT route_profile.id,
         token.value,
         CASE
           WHEN length(token.value) <= 1024
             AND token.value ~ '^-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?$'
             AND (
               token.value !~ '[eE]'
               OR substring(token.value FROM '[eE][+-]?([0-9]+)$') ~ '^[0-9]{1,4}$'
             )
           THEN token.value::numeric
           ELSE NULL
         END AS numeric_value
  FROM route_profiles route_profile
  CROSS JOIN LATERAL unnest(
    COALESCE(string_to_array(route_profile.decoded_profile, '|'), ARRAY[]::text[])
  ) token(value)
), parsed_profile_tokens AS MATERIALIZED (
  SELECT id,
         value,
         CASE
           WHEN numeric_value = 0
             OR abs(numeric_value) BETWEEN
                '4.9406564584124654e-324'::numeric
                AND '1.7976931348623157e308'::numeric
           THEN numeric_value::DOUBLE PRECISION
           ELSE NULL
         END AS elevation,
         numeric_value = 0
           OR abs(numeric_value) BETWEEN
              '4.9406564584124654e-324'::numeric
              AND '1.7976931348623157e308'::numeric AS token_is_finite_float8
  FROM profile_token_candidates
), valid_profiles AS (
  SELECT route_profiles.*,
         cardinality(string_to_array(decoded_profile, '|')) AS profile_samples
  FROM route_profiles
  WHERE decoded_profile IS NOT NULL
    AND cardinality(string_to_array(decoded_profile, '|')) >= 2
    AND NOT EXISTS (
      SELECT 1
      FROM parsed_profile_tokens parsed
      WHERE parsed.id = route_profiles.id
        AND parsed.token_is_finite_float8 IS NOT TRUE
    )
), valid_profile_stats AS (
  SELECT length(elevation_string) AS profile_bytes,
         profile_samples,
         token.elevation
  FROM valid_profiles
  JOIN parsed_profile_tokens token USING (id)
), changed_peaks_routes AS (
  SELECT id
  FROM route_profiles
  WHERE owner = 'peaks'
    AND canonical_profile IS DISTINCT FROM elevation_string
), installed_encoder_capability AS (
  SELECT COALESCE(
           obj_description(
             'encode_route_elevation_profile(geography)'::regprocedure,
             'pg_proc'
           ) = 'peaks:route-elevation-profile:finite-float8-v1',
           false
         ) AS supports_full_float8
), segment_encoder_safety AS MATERIALIZED (
  SELECT segment.id,
         installed_encoder_capability.supports_full_float8,
         safety.unsafe_for_legacy_bigint
  FROM segments segment
  CROSS JOIN installed_encoder_capability
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
), profile_affected_routes AS (
  SELECT id
  FROM changed_peaks_routes
  UNION
  SELECT DISTINCT route.id
  FROM routes route
  JOIN route_segments linked ON linked.route_id = route.id
  JOIN segments segment ON segment.id = linked.segment_id
  JOIN proposed_path_profiles proposed_segment
    ON proposed_segment.source_kind = 'segment'
   AND proposed_segment.source_id = segment.id
  JOIN segment_encoder_safety safety ON safety.id = segment.id
  WHERE route.owner = 'peaks'
    AND CASE
      WHEN NOT safety.supports_full_float8 AND safety.unsafe_for_legacy_bigint
      THEN true
      ELSE encode_route_elevation_profile(segment.path) IS DISTINCT FROM
           proposed_segment.canonical_profile
    END
), route_job_fingerprints AS (
  SELECT r.id,
         md5(concat_ws('|', r.id, r.owner, r.status, COALESCE(r.name, ''),
             COALESCE(r.distance::text, ''), COALESCE(r.shape::text, ''),
             encode(ST_AsEWKB(r.path::geometry), 'hex'),
             COALESCE(proposed_route.canonical_profile, ''), COALESCE(r.gain::text, ''),
             COALESCE(r.gain_loss::text, ''), COALESCE(r.elevation_source, ''),
             COALESCE(r.elevation_source_url, ''), COALESCE(r.elevation_attribution, ''),
             COALESCE(r.elevation_license_url, ''),
             COALESCE(r.elevation_retrieved_at::text, ''),
             COALESCE((SELECT string_agg(concat_ws(':', rs.ordinal::text,
               rs.direction, s.id, COALESCE(encode(ST_AsEWKB(s.path::geometry), 'hex'), ''),
               COALESCE(proposed_segment.canonical_profile, ''), COALESCE(s.gain::text, ''),
               COALESCE(s.gain_loss::text, ''), COALESCE(s.provenance::text, '')),
               ',' ORDER BY rs.ordinal, rs.segment_id)
               FROM route_segments rs
               JOIN segments s ON s.id = rs.segment_id
               JOIN proposed_path_profiles proposed_segment
                 ON proposed_segment.source_kind = 'segment'
                AND proposed_segment.source_id = s.id
               WHERE rs.route_id = r.id), ''))) AS fingerprint
  FROM routes r
  JOIN proposed_path_profiles proposed_route
    ON proposed_route.source_kind = 'route' AND proposed_route.source_id = r.id
  WHERE r.owner = 'peaks'
    AND r.status IN ('active', 'pending')
    AND r.path IS NOT NULL
), elevation_json_documents AS (
  SELECT averages AS document FROM destinations WHERE averages IS NOT NULL
  UNION ALL SELECT averages_offset FROM destinations WHERE averages_offset IS NOT NULL
  UNION ALL SELECT metadata FROM destinations WHERE metadata IS NOT NULL
  UNION ALL SELECT external_ids FROM destinations WHERE external_ids IS NOT NULL
  UNION ALL SELECT amenities FROM destinations WHERE amenities IS NOT NULL
  UNION ALL SELECT provenance FROM segments WHERE provenance IS NOT NULL
  UNION ALL SELECT external_links FROM routes WHERE external_links IS NOT NULL
  UNION ALL SELECT provenance FROM routes WHERE provenance IS NOT NULL
  UNION ALL SELECT final_evidence FROM route_elevation_backfill_jobs WHERE final_evidence IS NOT NULL
  UNION ALL SELECT final_result FROM route_catalog_audit_jobs WHERE final_result IS NOT NULL
  UNION ALL SELECT target_reasons FROM standard_route_backfill_jobs WHERE target_reasons IS NOT NULL
  UNION ALL SELECT evidence FROM standard_route_backfill_jobs WHERE evidence IS NOT NULL
  UNION ALL SELECT candidate FROM standard_route_backfill_jobs WHERE candidate IS NOT NULL
  UNION ALL SELECT review FROM standard_route_backfill_jobs WHERE review IS NOT NULL
  UNION ALL SELECT candidate_artifact FROM standard_route_backfill_jobs WHERE candidate_artifact IS NOT NULL
  UNION ALL SELECT evidence FROM route_integrity_repairs WHERE evidence IS NOT NULL
  UNION ALL SELECT health_data FROM tracking_sessions WHERE health_data IS NOT NULL
  UNION ALL SELECT source_contributions FROM tracking_sessions WHERE source_contributions IS NOT NULL
), elevation_json_walk AS (
  SELECT NULL::text AS key,
         document AS value
  FROM elevation_json_documents
  UNION ALL
  SELECT child.key,
         child.value
  FROM elevation_json_walk parent
  CROSS JOIN LATERAL (
    SELECT object_member.key,
           object_member.value
    FROM jsonb_each(
      CASE WHEN jsonb_typeof(parent.value) = 'object'
           THEN parent.value ELSE '{}'::jsonb END
    ) object_member
    UNION ALL
    SELECT NULL::text AS key,
           array_member.value
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(parent.value) = 'array'
           THEN parent.value ELSE '[]'::jsonb END
    ) array_member
  ) child
), elevation_json_members AS (
  SELECT key, value
  FROM elevation_json_walk
  WHERE key ~* '(elevation|prominence|gain|loss|highest|altitude|(^|_)z($|_))'
)
SELECT
  (SELECT count(*) FROM destinations
   WHERE elevation IS NOT NULL AND (
     location IS NULL OR ST_Z(location::geometry) IS NULL
     OR elevation IS DISTINCT FROM ST_Z(location::geometry))) AS destination_mismatches,
  (SELECT count(*) FROM tracking_points
   WHERE elevation IS NOT NULL AND (
     location IS NULL OR ST_Z(location::geometry) IS NULL
     OR elevation IS DISTINCT FROM ST_Z(location::geometry))) AS tracking_point_mismatches,
  (SELECT count(*) FROM destinations
   WHERE elevation IS NOT NULL AND elevation = trunc(elevation)) AS integer_looking_destinations,
  (SELECT count(*) FROM destinations
   WHERE elevation IS NOT NULL AND elevation = trunc(elevation)
     AND external_ids IS NOT NULL AND external_ids <> '{}'::jsonb) AS destinations_with_source_ids,
  (SELECT count(*) FROM route_profiles
   WHERE decoded_profile ~ '^-?[0-9]+(\\|-?[0-9]+)+$') AS legacy_integer_profiles,
  (SELECT count(*) FROM route_profiles route_profile
   WHERE elevation_string IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM valid_profiles valid WHERE valid.id = route_profile.id
     )) AS malformed_or_out_of_range_profiles,
  (SELECT count(*) FROM route_profiles route_profile
   JOIN changed_peaks_routes changed USING (id)
   WHERE route_profile.canonical_profile IS NOT NULL) AS recoverable_peaks_profiles,
  (SELECT count(*) FROM route_profiles
   WHERE owner = 'peaks' AND canonical_profile IS NULL
     AND elevation_string IS NOT NULL) AS invalid_peaks_profiles,
  (SELECT count(*) FROM route_profiles
   WHERE owner <> 'peaks' AND elevation_string IS NOT NULL) AS user_profiles_preserved,
  (SELECT count(*) FROM route_elevation_backfill_jobs
   WHERE state = 'working' AND lease_expires_at >= now()) AS active_elevation_leases,
  (SELECT count(*) FROM route_catalog_audit_jobs
   WHERE state = 'auditing' AND lease_expires_at >= now()) AS active_catalog_leases,
  (SELECT count(*) FROM standard_route_backfill_jobs
   WHERE lease_token IS NOT NULL AND lease_expires_at >= now()) AS active_standard_route_leases,
  (SELECT count(*) FROM route_elevation_backfill_jobs job
   JOIN route_job_fingerprints current ON current.id = job.route_id
   WHERE job.path_fingerprint IS DISTINCT FROM current.fingerprint) AS stale_elevation_jobs,
  (SELECT count(DISTINCT job.destination_id)
   FROM route_catalog_audit_jobs job
   JOIN route_destinations linked ON linked.destination_id = job.destination_id
   JOIN profile_affected_routes affected ON affected.id = linked.route_id
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
      )) AS catalog_jobs_affected,
  (SELECT count(DISTINCT job.destination_id)
   FROM standard_route_backfill_jobs job
   JOIN changed_peaks_routes changed
     ON changed.id = job.published_route_id OR changed.id = job.replacement_route_id
   WHERE job.state = 'verified'
      OR job.evidence ? 'last_verification'
      OR job.evidence ? 'verification_action') AS standard_jobs_needing_verification,
  (SELECT count(*) FROM destinations
   WHERE elevation IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
      OR prominence IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)) AS nonfinite_destination_scalars,
  (SELECT count(*) FROM destinations
   WHERE location IS NOT NULL AND ST_Z(location::geometry) IN (
     'NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)) AS nonfinite_destination_z,
  (SELECT count(*) FROM tracking_points
   WHERE elevation IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)) AS nonfinite_tracking_scalars,
  (SELECT count(*) FROM tracking_points
   WHERE location IS NOT NULL AND ST_Z(location::geometry) IN (
     'NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)) AS nonfinite_tracking_z,
  (SELECT count(*) FROM routes
   WHERE gain IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
      OR gain_loss IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)) AS nonfinite_route_scalars,
  (SELECT count(*) FROM routes r CROSS JOIN LATERAL ST_DumpPoints(r.path::geometry) dumped
   WHERE ST_Z((dumped).geom) IN (
     'NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)) AS nonfinite_route_z,
  (SELECT count(*) FROM segments
   WHERE gain IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
      OR gain_loss IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)) AS nonfinite_segment_scalars,
  (SELECT count(*) FROM segments s CROSS JOIN LATERAL ST_DumpPoints(s.path::geometry) dumped
   WHERE ST_Z((dumped).geom) IN (
     'NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)) AS nonfinite_segment_z,
  (SELECT count(*) FROM tracking_sessions
   WHERE gain IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
      OR highest_point IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)) AS nonfinite_session_scalars,
  (SELECT count(*) FROM tracking_sessions session
   CROSS JOIN LATERAL ST_DumpPoints(session.path::geometry) dumped
   WHERE ST_Z((dumped).geom) IN (
     'NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)) AS nonfinite_session_path_z,
  (SELECT count(*) FROM session_markers
   WHERE location IS NOT NULL AND ST_Z(location::geometry) IN (
     'NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)) AS nonfinite_marker_z,
  (SELECT count(*) FROM plans
   WHERE gain IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)) AS nonfinite_plan_gain,
  (SELECT count(*) FROM elevation_json_members
   WHERE jsonb_typeof(value) = 'string'
     AND value #>> '{}' IN ('NaN', 'Infinity', '-Infinity')) AS nonfinite_elevation_jsonb,
  (SELECT count(*) FROM tracking_points
   WHERE location IS NOT NULL
     AND ST_Z(location::geometry) NOT IN (
       'NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
     AND ST_Z(location::geometry) <> trunc(ST_Z(location::geometry))) AS fractional_tracking_z,
  (SELECT count(*) FROM destinations
   WHERE location IS NOT NULL
     AND ST_Z(location::geometry) NOT IN (
       'NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
     AND ST_Z(location::geometry) <> trunc(ST_Z(location::geometry))) AS fractional_destination_z,
  (SELECT count(*) FROM routes
   WHERE (gain NOT IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
          AND gain <> trunc(gain))
      OR (gain_loss NOT IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
          AND gain_loss <> trunc(gain_loss))) AS fractional_route_scalars,
  (SELECT count(*) FROM routes r CROSS JOIN LATERAL ST_DumpPoints(r.path::geometry) dumped
   WHERE ST_Z((dumped).geom) NOT IN (
     'NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
     AND ST_Z((dumped).geom) <> trunc(ST_Z((dumped).geom))) AS fractional_route_z,
  (SELECT count(*) FROM segments
   WHERE (gain NOT IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
          AND gain <> trunc(gain))
      OR (gain_loss NOT IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
          AND gain_loss <> trunc(gain_loss))) AS fractional_segment_scalars,
  (SELECT count(*) FROM segments s CROSS JOIN LATERAL ST_DumpPoints(s.path::geometry) dumped
   WHERE ST_Z((dumped).geom) NOT IN (
     'NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
     AND ST_Z((dumped).geom) <> trunc(ST_Z((dumped).geom))) AS fractional_segment_z,
  (SELECT count(*) FROM tracking_sessions
   WHERE (gain NOT IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
          AND gain <> trunc(gain))
      OR (highest_point NOT IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
          AND highest_point <> trunc(highest_point))) AS fractional_session_scalars,
  (SELECT count(*) FROM tracking_sessions session
   CROSS JOIN LATERAL ST_DumpPoints(session.path::geometry) dumped
   WHERE ST_Z((dumped).geom) NOT IN (
     'NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
     AND ST_Z((dumped).geom) <> trunc(ST_Z((dumped).geom))) AS fractional_session_path_z,
  (SELECT count(*) FROM session_markers
   WHERE location IS NOT NULL
     AND ST_Z(location::geometry) NOT IN (
       'NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
     AND ST_Z(location::geometry) <> trunc(ST_Z(location::geometry))) AS fractional_marker_z,
  (SELECT count(*) FROM plans
   WHERE gain NOT IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
     AND gain <> trunc(gain)) AS fractional_plan_gain,
  (SELECT count(*) FROM elevation_json_members) AS elevation_like_jsonb_values,
  (SELECT count(*) FROM elevation_json_members
   WHERE jsonb_typeof(value) = 'number'
     AND (value #>> '{}')::numeric <> trunc((value #>> '{}')::numeric)) AS fractional_elevation_jsonb,
  (SELECT count(*) FROM valid_profiles) AS route_profile_count,
  (SELECT count(*) FROM valid_profile_stats) AS route_profile_samples,
  COALESCE((SELECT min(profile_samples) FROM valid_profile_stats), 0) AS min_profile_samples,
  COALESCE((SELECT max(profile_samples) FROM valid_profile_stats), 0) AS max_profile_samples,
  COALESCE((SELECT min(profile_bytes) FROM valid_profile_stats), 0) AS min_profile_bytes,
  COALESCE((SELECT max(profile_bytes) FROM valid_profile_stats), 0) AS max_profile_bytes,
  (SELECT min(elevation) FROM valid_profile_stats) AS min_profile_elevation,
  (SELECT max(elevation) FROM valid_profile_stats) AS max_profile_elevation
`;

export function parseAuditArgs(argv = process.argv.slice(2)): AuditArgs {
  let apply = false;
  let format: OutputFormat = "human";
  let expectedDatabase: string | null = null;
  let expectedInstance: string | null = null;
  let expectedHost: string | null = null;
  for (const argument of argv) {
    if (argument === "--apply") apply = true;
    else if (argument === "--format=json") format = "json";
    else if (argument === "--format=human") format = "human";
    else if (argument.startsWith("--expected-database=")) {
      expectedDatabase = argument.slice("--expected-database=".length);
      if (!expectedDatabase) throw new Error("--expected-database must not be empty");
    }
    else if (argument.startsWith("--expected-instance=")) {
      expectedInstance = argument.slice("--expected-instance=".length);
      if (!expectedInstance) throw new Error("--expected-instance must not be empty");
    }
    else if (argument.startsWith("--expected-host=")) {
      expectedHost = argument.slice("--expected-host=".length);
      if (!expectedHost) throw new Error("--expected-host must not be empty");
    }
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return { apply, format, expectedDatabase, expectedInstance, expectedHost };
}

export function resolveApplyTarget(
  args: AuditArgs,
  environment: NodeJS.ProcessEnv = process.env
): ApplyTarget {
  const database = args.expectedDatabase
    ?? environment.ELEVATION_PRECISION_EXPECTED_DATABASE;
  const instance = args.expectedInstance
    ?? environment.ELEVATION_PRECISION_EXPECTED_INSTANCE;
  const host = args.expectedHost
    ?? environment.ELEVATION_PRECISION_EXPECTED_HOST;
  if (!database || !instance || !host) {
    throw new Error(
      "--apply requires expected database, instance, and host flags or matching " +
      "ELEVATION_PRECISION_EXPECTED_* environment values"
    );
  }
  if (instance.split(":").length !== 3 || instance.split(":").some((part) => !part)) {
    throw new Error("expected instance must be PROJECT:REGION:INSTANCE");
  }
  return { database, instance, host };
}

const count = (value: number | string): number => Number(value);

export function buildElevationPrecisionReport(
  schemaTypes: SchemaTypeRow[],
  row: AuditCountRow,
  mode: "read_only" | "applied" = "read_only"
) {
  return {
    generatedAt: new Date().toISOString(),
    mode,
    schemaTypes,
    consistency: {
      destinationPlainZMismatches: count(row.destination_mismatches),
      trackingPointPlainZMismatches: count(row.tracking_point_mismatches),
    },
    locallyRecoverable: {
      routeProfiles: count(row.recoverable_peaks_profiles),
      staleInvalidPeaksProfiles: count(row.invalid_peaks_profiles),
    },
    needsTrustedOutsideSource: {
      integerLookingDestinations: count(row.integer_looking_destinations),
      destinationsWithSourceIds: count(row.destinations_with_source_ids),
    },
    profileInventory: {
      legacyIntegerProfiles: count(row.legacy_integer_profiles),
      malformedOrOutOfRangeProfiles: count(row.malformed_or_out_of_range_profiles),
      userProfilesPreserved: count(row.user_profiles_preserved),
    },
    activeLeases: {
      elevation: count(row.active_elevation_leases),
      catalog: count(row.active_catalog_leases),
      standardRoute: count(row.active_standard_route_leases),
    },
    jobEvidence: {
      staleElevationJobs: count(row.stale_elevation_jobs),
      catalogJobsAffected: count(row.catalog_jobs_affected),
      standardJobsNeedingVerification: count(row.standard_jobs_needing_verification),
    },
    nonFinite: {
      destinationScalars: count(row.nonfinite_destination_scalars),
      destinationZ: count(row.nonfinite_destination_z),
      trackingScalars: count(row.nonfinite_tracking_scalars),
      trackingZ: count(row.nonfinite_tracking_z),
      routeScalars: count(row.nonfinite_route_scalars),
      routeZ: count(row.nonfinite_route_z),
      segmentScalars: count(row.nonfinite_segment_scalars),
      segmentZ: count(row.nonfinite_segment_z),
      sessionScalars: count(row.nonfinite_session_scalars),
      sessionPathZ: count(row.nonfinite_session_path_z),
      markerZ: count(row.nonfinite_marker_z),
      planGain: count(row.nonfinite_plan_gain),
      elevationLikeJsonb: count(row.nonfinite_elevation_jsonb),
    },
    precisionInventory: {
      fractionalDestinationZ: count(row.fractional_destination_z),
      fractionalTrackingZ: count(row.fractional_tracking_z),
      fractionalRouteScalars: count(row.fractional_route_scalars),
      fractionalRouteZ: count(row.fractional_route_z),
      fractionalSegmentScalars: count(row.fractional_segment_scalars),
      fractionalSegmentZ: count(row.fractional_segment_z),
      fractionalSessionScalars: count(row.fractional_session_scalars),
      fractionalSessionPathZ: count(row.fractional_session_path_z),
      fractionalMarkerZ: count(row.fractional_marker_z),
      fractionalPlanGain: count(row.fractional_plan_gain),
      elevationLikeJsonbValues: count(row.elevation_like_jsonb_values),
      fractionalElevationJsonb: count(row.fractional_elevation_jsonb),
      routeProfiles: count(row.route_profile_count),
      profileSamples: count(row.route_profile_samples),
      profileSampleBounds: [count(row.min_profile_samples), count(row.max_profile_samples)],
      profileByteBounds: [count(row.min_profile_bytes), count(row.max_profile_bytes)],
      elevationBounds: [
        row.min_profile_elevation == null ? null : count(row.min_profile_elevation),
        row.max_profile_elevation == null ? null : count(row.max_profile_elevation),
      ],
    },
  };
}

async function auditWithClient(client: QueryClient, mode: "read_only" | "applied") {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL extra_float_digits = 1");
    const schema = await client.query(`
      SELECT c.relname AS table_name,
             a.attname AS column_name,
             format_type(a.atttypid, a.atttypmod) AS data_type
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND a.attnum > 0 AND NOT a.attisdropped
        AND (
          a.attname IN ('elevation', 'prominence', 'gain', 'gain_loss', 'highest_point')
          OR a.attname = 'path' OR a.attname = 'location'
        )
      ORDER BY c.relname, a.attnum
    `);
    const counts = await client.query(COUNTS_SQL);
    await client.query("COMMIT");
    return buildElevationPrecisionReport(
      schema.rows as SchemaTypeRow[],
      counts.rows[0] as AuditCountRow,
      mode
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function runElevationPrecisionAudit(
  pool: QueryPool = db as unknown as Pool,
  mode: "read_only" | "applied" = "read_only"
) {
  const client = await pool.connect();
  try {
    return await auditWithClient(client, mode);
  } finally {
    client.release();
  }
}

interface ApplyDependencies {
  readMigration?: () => Promise<string>;
  seedCatalogJobs?: () => number | null;
  realpath?: (socketPath: string) => Promise<string>;
}

export async function applyMigration(
  pool: Pool,
  expected: ApplyTarget,
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: ApplyDependencies = {}
): Promise<void> {
  // TCP proxies do not bind their listening address to a Cloud SQL instance.
  // Apply only through an instance-named Unix socket directory and verify that
  // the Pool was built from that exact DB_HOST. The final directory component
  // carries the project, region, and instance connection name.
  const configuredHost = environment.DB_HOST;
  const poolHost = pool.options.host;
  if (
    !configuredHost
    || !path.isAbsolute(configuredHost)
    || !path.isAbsolute(expected.host)
  ) {
    throw new Error(
      "Refusing elevation repair: DB_HOST must be an absolute instance-bound Unix socket directory"
    );
  }
  if (poolHost !== configuredHost) {
    throw new Error(
      `Refusing elevation repair: Pool host ${poolHost ?? "unknown"} does not match DB_HOST ${configuredHost}`
    );
  }
  const resolveRealpath = dependencies.realpath ?? fs.realpath;
  const [realConfiguredHost, realExpectedHost] = await Promise.all([
    resolveRealpath(configuredHost),
    resolveRealpath(expected.host),
  ]);
  if (
    realConfiguredHost !== realExpectedHost
    || path.basename(realConfiguredHost) !== expected.instance
  ) {
    throw new Error(
      "Refusing elevation repair: Unix socket does not match the expected host and " +
      `Cloud SQL instance ${expected.instance}`
    );
  }
  const target = await pool.query<{ current_database: string }>("SELECT current_database()");
  const currentDatabase = target.rows[0]?.current_database;
  if (currentDatabase !== expected.database) {
    throw new Error(
      `Refusing elevation repair: expected database ${expected.database}, connected to ${currentDatabase ?? "unknown"}`
    );
  }
  const migration = dependencies.readMigration
    ? await dependencies.readMigration()
    : await fs.readFile(path.resolve(
      __dirname,
      "../../migrations/20260810_elevation_double_precision.sql"
    ), "utf8");
  await pool.query(migration);

  const seedStatus = dependencies.seedCatalogJobs
    ? dependencies.seedCatalogJobs()
    : spawnSync(
      "npm",
      ["run", "routes:audit-jobs", "--", "seed", "--apply"],
      { cwd: path.resolve(__dirname, ".."), stdio: "inherit" }
    ).status;
  if (seedStatus !== 0) {
    throw new Error("elevation repair committed, but catalog audit job seeding failed");
  }
}

export function printHuman(report: ReturnType<typeof buildElevationPrecisionReport>): void {
  console.log("Elevation precision audit");
  console.log(`Mode: ${report.mode}`);
  console.log(`Local route-profile repairs: ${report.locallyRecoverable.routeProfiles}`);
  console.log(`Stale invalid Peaks profiles: ${report.locallyRecoverable.staleInvalidPeaksProfiles}`);
  console.log(`Malformed or out-of-range profiles: ${report.profileInventory.malformedOrOutOfRangeProfiles}`);
  console.log(`Destination plain/Z mismatches: ${report.consistency.destinationPlainZMismatches}`);
  console.log(`Tracking-point plain/Z mismatches: ${report.consistency.trackingPointPlainZMismatches}`);
  console.log(`Whole-metre destinations needing a trusted source: ${report.needsTrustedOutsideSource.integerLookingDestinations}`);
  console.log(`Reviewable through a source ID: ${report.needsTrustedOutsideSource.destinationsWithSourceIds}`);
  console.log(`Active elevation/catalog/standard leases: ${report.activeLeases.elevation}/${report.activeLeases.catalog}/${report.activeLeases.standardRoute}`);
  console.log(
    `Stale elevation/catalog/standard verification jobs: ` +
    `${report.jobEvidence.staleElevationJobs}/${report.jobEvidence.catalogJobsAffected}/` +
    `${report.jobEvidence.standardJobsNeedingVerification}`
  );
  console.log(
    "Non-finite destination/tracking/route/segment/session/marker/plan/JSONB: " +
    `${report.nonFinite.destinationScalars + report.nonFinite.destinationZ}/` +
    `${report.nonFinite.trackingScalars + report.nonFinite.trackingZ}/` +
    `${report.nonFinite.routeScalars + report.nonFinite.routeZ}/` +
    `${report.nonFinite.segmentScalars + report.nonFinite.segmentZ}/` +
    `${report.nonFinite.sessionScalars + report.nonFinite.sessionPathZ}/` +
    `${report.nonFinite.markerZ}/${report.nonFinite.planGain}/` +
    `${report.nonFinite.elevationLikeJsonb}`
  );
}

async function main(): Promise<void> {
  const args = parseAuditArgs();
  try {
    if (args.apply) {
      const target = resolveApplyTarget(args);
      await applyMigration(db, target);
    }
    const report = await runElevationPrecisionAudit(db, args.apply ? "applied" : "read_only");
    if (args.format === "json") console.log(JSON.stringify(report, null, 2));
    else printHuman(report);
  } finally {
    await db.end();
  }
}

if (/(?:^|[/\\])audit-elevation-precision\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
