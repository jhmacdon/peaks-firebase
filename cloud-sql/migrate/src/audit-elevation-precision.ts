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
}

interface AuditCountRow {
  destination_mismatches: number | string;
  tracking_point_mismatches: number | string;
  integer_looking_destinations: number | string;
  destinations_with_source_ids: number | string;
  legacy_integer_profiles: number | string;
  recoverable_peaks_profiles: number | string;
  invalid_peaks_profiles: number | string;
  user_profiles_preserved: number | string;
  active_elevation_leases: number | string;
  active_catalog_leases: number | string;
  active_standard_route_leases: number | string;
  stale_elevation_jobs: number | string;
  queued_catalog_jobs: number | string;
  standard_jobs_needing_verification: number | string;
  nonfinite_destination_scalars: number | string;
  nonfinite_destination_z: number | string;
  nonfinite_tracking_scalars: number | string;
  nonfinite_tracking_z: number | string;
  nonfinite_route_z: number | string;
  fractional_destination_z: number | string;
  fractional_tracking_z: number | string;
  fractional_route_z: number | string;
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
WITH route_profiles AS (
  SELECT r.owner,
         r.path,
         r.elevation_string,
         encode_route_elevation_profile(r.path) AS canonical_profile,
         CASE
           WHEN r.elevation_string ~ '^[A-Za-z0-9+/]+={0,2}$'
             AND length(r.elevation_string) % 4 = 0
           THEN convert_from(decode(r.elevation_string, 'base64'), 'SQL_ASCII')
           ELSE NULL
         END AS decoded_profile
  FROM routes r
), valid_profiles AS (
  SELECT route_profiles.*,
         cardinality(string_to_array(decoded_profile, '|')) AS profile_samples
  FROM route_profiles
  WHERE decoded_profile IS NOT NULL
    AND cardinality(string_to_array(decoded_profile, '|')) >= 2
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(string_to_array(decoded_profile, '|')) invalid(value)
      WHERE invalid.value !~ '^-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?$'
    )
), valid_profile_stats AS (
  SELECT length(elevation_string) AS profile_bytes,
         profile_samples,
         token.value::DOUBLE PRECISION AS elevation
  FROM valid_profiles
  CROSS JOIN LATERAL unnest(string_to_array(decoded_profile, '|')) token(value)
  WHERE token.value::DOUBLE PRECISION NOT IN (
    'NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION
  )
), route_job_fingerprints AS (
  SELECT r.id,
         md5(concat_ws('|', r.id, r.owner, r.status, COALESCE(r.name, ''),
             COALESCE(r.distance::text, ''), COALESCE(r.shape::text, ''),
             encode(ST_AsEWKB(r.path::geometry), 'hex'),
             COALESCE(r.elevation_string, ''), COALESCE(r.gain::text, ''),
             COALESCE(r.gain_loss::text, ''), COALESCE(r.elevation_source, ''),
             COALESCE(r.elevation_source_url, ''), COALESCE(r.elevation_attribution, ''),
             COALESCE(r.elevation_license_url, ''),
             COALESCE(r.elevation_retrieved_at::text, ''),
             COALESCE((SELECT string_agg(concat_ws(':', rs.ordinal::text,
               rs.direction, s.id, COALESCE(encode(ST_AsEWKB(s.path::geometry), 'hex'), ''),
               COALESCE(encode_route_elevation_profile(s.path), ''), COALESCE(s.gain::text, ''),
               COALESCE(s.gain_loss::text, ''), COALESCE(s.provenance::text, '')),
               ',' ORDER BY rs.ordinal, rs.segment_id)
               FROM route_segments rs JOIN segments s ON s.id = rs.segment_id
               WHERE rs.route_id = r.id), ''))) AS fingerprint
  FROM routes r
  WHERE r.owner = 'peaks' AND r.path IS NOT NULL
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
  (SELECT count(*) FROM route_profiles
   WHERE owner = 'peaks' AND canonical_profile IS NOT NULL
     AND elevation_string IS DISTINCT FROM canonical_profile) AS recoverable_peaks_profiles,
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
  (SELECT count(*) FROM route_catalog_audit_jobs WHERE state = 'queued') AS queued_catalog_jobs,
  (SELECT count(*) FROM standard_route_backfill_jobs
   WHERE state = 'published'
     AND NOT (evidence ? 'last_verification')) AS standard_jobs_needing_verification,
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
  (SELECT count(*) FROM routes r CROSS JOIN LATERAL ST_DumpPoints(r.path::geometry) dumped
   WHERE ST_Z((dumped).geom) IN (
     'NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)) AS nonfinite_route_z,
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
  (SELECT count(*) FROM routes r CROSS JOIN LATERAL ST_DumpPoints(r.path::geometry) dumped
   WHERE ST_Z((dumped).geom) NOT IN (
     'NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
     AND ST_Z((dumped).geom) <> trunc(ST_Z((dumped).geom))) AS fractional_route_z,
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
  for (const argument of argv) {
    if (argument === "--apply") apply = true;
    else if (argument === "--format=json") format = "json";
    else if (argument === "--format=human") format = "human";
    else if (argument.startsWith("--expected-database=")) {
      expectedDatabase = argument.slice("--expected-database=".length);
      if (!expectedDatabase) throw new Error("--expected-database must not be empty");
    }
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return { apply, format, expectedDatabase };
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
      userProfilesPreserved: count(row.user_profiles_preserved),
    },
    activeLeases: {
      elevation: count(row.active_elevation_leases),
      catalog: count(row.active_catalog_leases),
      standardRoute: count(row.active_standard_route_leases),
    },
    jobEvidence: {
      staleElevationJobs: count(row.stale_elevation_jobs),
      queuedCatalogJobs: count(row.queued_catalog_jobs),
      standardJobsNeedingVerification: count(row.standard_jobs_needing_verification),
    },
    nonFinite: {
      destinationScalars: count(row.nonfinite_destination_scalars),
      destinationZ: count(row.nonfinite_destination_z),
      trackingScalars: count(row.nonfinite_tracking_scalars),
      trackingZ: count(row.nonfinite_tracking_z),
      routeZ: count(row.nonfinite_route_z),
    },
    precisionInventory: {
      fractionalDestinationZ: count(row.fractional_destination_z),
      fractionalTrackingZ: count(row.fractional_tracking_z),
      fractionalRouteZ: count(row.fractional_route_z),
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

async function applyMigration(pool: Pool, expectedDatabase: string): Promise<void> {
  const target = await pool.query<{ current_database: string }>("SELECT current_database()");
  const currentDatabase = target.rows[0]?.current_database;
  if (currentDatabase !== expectedDatabase) {
    throw new Error(
      `Refusing elevation repair: expected database ${expectedDatabase}, connected to ${currentDatabase ?? "unknown"}`
    );
  }
  const migrationPath = path.resolve(
    __dirname,
    "../../migrations/20260810_elevation_double_precision.sql"
  );
  const migration = await fs.readFile(migrationPath, "utf8");
  await pool.query(migration);

  const seeded = spawnSync(
    "npm",
    ["run", "routes:audit-jobs", "--", "seed", "--apply"],
    { cwd: path.resolve(__dirname, ".."), stdio: "inherit" }
  );
  if (seeded.status !== 0) {
    throw new Error("elevation repair committed, but catalog audit job seeding failed");
  }
}

function printHuman(report: ReturnType<typeof buildElevationPrecisionReport>): void {
  console.log("Elevation precision audit");
  console.log(`Mode: ${report.mode}`);
  console.log(`Local route-profile repairs: ${report.locallyRecoverable.routeProfiles}`);
  console.log(`Stale invalid Peaks profiles: ${report.locallyRecoverable.staleInvalidPeaksProfiles}`);
  console.log(`Destination plain/Z mismatches: ${report.consistency.destinationPlainZMismatches}`);
  console.log(`Tracking-point plain/Z mismatches: ${report.consistency.trackingPointPlainZMismatches}`);
  console.log(`Whole-metre destinations needing a trusted source: ${report.needsTrustedOutsideSource.integerLookingDestinations}`);
  console.log(`Reviewable through a source ID: ${report.needsTrustedOutsideSource.destinationsWithSourceIds}`);
  console.log(`Active elevation/catalog/standard leases: ${report.activeLeases.elevation}/${report.activeLeases.catalog}/${report.activeLeases.standardRoute}`);
}

async function main(): Promise<void> {
  const args = parseAuditArgs();
  try {
    if (args.apply) {
      const expectedDatabase = args.expectedDatabase
        ?? process.env.ELEVATION_PRECISION_EXPECTED_DATABASE;
      if (!expectedDatabase) {
        throw new Error(
          "--apply requires --expected-database=NAME or ELEVATION_PRECISION_EXPECTED_DATABASE"
        );
      }
      await applyMigration(db, expectedDatabase);
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
