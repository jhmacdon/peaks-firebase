import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTS_SQL,
  applyMigration,
  buildElevationPrecisionReport,
  parseAuditArgs,
  printHuman,
  resolveApplyTarget,
  runElevationPrecisionAudit,
} from "../audit-elevation-precision";

test("profile inventory counts valid profile rows, not distinct profile text", () => {
  assert.match(COUNTS_SQL, /SELECT count\(\*\) FROM valid_profiles/);
  assert.doesNotMatch(COUNTS_SQL, /count\(DISTINCT elevation_string\)/);
  assert.match(
    COUNTS_SQL,
    /encode_route_elevation_profile\(segment\.path\) IS DISTINCT FROM\s+proposed_segment\.canonical_profile/
  );
  assert.match(COUNTS_SQL, /proposed_path_profiles/);
  assert.doesNotMatch(COUNTS_SQL, /pg_get_functiondef/);
  assert.match(COUNTS_SQL, /profile_affected_routes/);
  assert.match(COUNTS_SQL, /segment_encoder_safety AS MATERIALIZED/);
  assert.match(COUNTS_SQL, /unsafe_for_legacy_bigint/);
  assert.match(COUNTS_SQL, /peaks:route-elevation-profile:finite-float8-v1/);
  assert.match(COUNTS_SQL, /profile_token_candidates AS MATERIALIZED/);
  assert.match(COUNTS_SQL, /parsed_profile_tokens AS MATERIALIZED/);
  assert.match(COUNTS_SQL, /1\.7976931348623157e308/);
  assert.doesNotMatch(COUNTS_SQL, /pg_input_is_valid/);
  assert.match(COUNTS_SQL, /WITH RECURSIVE destination_audit_source AS MATERIALIZED/);
  assert.match(COUNTS_SQL, /profile_paths AS/);
  assert.match(COUNTS_SQL, /elevation_json_walk AS/);
  assert.match(COUNTS_SQL, /jsonb_typeof\(parent\.value\) = 'object'/);
  assert.match(COUNTS_SQL, /jsonb_typeof\(parent\.value\) = 'array'/);
  assert.doesNotMatch(COUNTS_SQL, /keyvalue\(\)/);
});

test("large elevation sources feed one materialized aggregate pass", () => {
  for (const aggregate of [
    "profile_aggregates",
    "destination_metrics",
    "tracking_point_metrics",
    "route_segment_metrics",
    "tracking_session_metrics",
    "session_marker_metrics",
    "plan_metrics",
    "elevation_json_metrics",
    "profile_inventory_metrics",
  ]) {
    assert.match(COUNTS_SQL, new RegExp(`${aggregate} AS MATERIALIZED`));
  }

  assert.equal(COUNTS_SQL.match(/\bFROM destinations\b/g)?.length, 1);
  assert.equal(COUNTS_SQL.match(/\bFROM tracking_points\b/g)?.length, 1);
  assert.equal(COUNTS_SQL.match(/\bFROM tracking_sessions\b/g)?.length, 1);
  assert.equal(COUNTS_SQL.match(/\bFROM session_markers\b/g)?.length, 1);
  assert.equal(COUNTS_SQL.match(/\bFROM plans\b/g)?.length, 1);
  assert.equal(COUNTS_SQL.match(/ST_DumpPoints\(/g)?.length, 2);

  const finalSelect = COUNTS_SQL.slice(COUNTS_SQL.lastIndexOf("\nSELECT\n"));
  assert.doesNotMatch(finalSelect, /FROM (?:destinations|tracking_points|tracking_sessions|session_markers|plans)\b/);
  assert.doesNotMatch(finalSelect, /ST_DumpPoints\(/);
});

test("elevation audit is dry-run JSON by default and apply is explicit", () => {
  const emptyTarget = { expectedDatabase: null, expectedInstance: null, expectedHost: null };
  assert.deepEqual(parseAuditArgs([]), { apply: false, format: "human", ...emptyTarget });
  assert.deepEqual(parseAuditArgs(["--format=json"]), { apply: false, format: "json", ...emptyTarget });
  assert.deepEqual(parseAuditArgs([
    "--apply",
    "--expected-database=peaks_test",
    "--expected-instance=donner-a8608:us-central1:peaks-db",
    "--expected-host=/cloudsql/donner-a8608:us-central1:peaks-db",
  ]), {
    apply: true,
    format: "human",
    expectedDatabase: "peaks_test",
    expectedInstance: "donner-a8608:us-central1:peaks-db",
    expectedHost: "/cloudsql/donner-a8608:us-central1:peaks-db",
  });
  assert.throws(() => parseAuditArgs(["--write"]), /Unknown argument/);
});

test("audit report separates recoverable rows from outside-source review", () => {
  const report = buildElevationPrecisionReport(
    [{ table_name: "destinations", column_name: "elevation", data_type: "double precision" }],
    {
      destination_mismatches: 0,
      tracking_point_mismatches: 0,
      integer_looking_destinations: 12,
      destinations_with_source_ids: 7,
      legacy_integer_profiles: 3,
      malformed_or_out_of_range_profiles: 2,
      recoverable_peaks_profiles: 3,
      invalid_peaks_profiles: 1,
      user_profiles_preserved: 4,
      active_elevation_leases: 0,
      active_catalog_leases: 0,
      active_standard_route_leases: 0,
      stale_elevation_jobs: 2,
      catalog_jobs_affected: 1,
      standard_jobs_needing_verification: 1,
      nonfinite_destination_scalars: 0,
      nonfinite_destination_z: 0,
      nonfinite_tracking_scalars: 0,
      nonfinite_tracking_z: 0,
      nonfinite_route_scalars: 0,
      nonfinite_route_z: 0,
      nonfinite_segment_scalars: 0,
      nonfinite_segment_z: 0,
      nonfinite_session_scalars: 0,
      nonfinite_session_path_z: 0,
      nonfinite_marker_z: 0,
      nonfinite_plan_gain: 0,
      nonfinite_elevation_jsonb: 0,
      fractional_destination_z: 7,
      fractional_tracking_z: 9,
      fractional_route_scalars: 8,
      fractional_route_z: 8,
      fractional_segment_scalars: 6,
      fractional_segment_z: 5,
      fractional_session_scalars: 4,
      fractional_session_path_z: 3,
      fractional_marker_z: 2,
      fractional_plan_gain: 1,
      elevation_like_jsonb_values: 10,
      fractional_elevation_jsonb: 2,
      route_profile_count: 3,
      route_profile_samples: 12,
      min_profile_samples: 2,
      max_profile_samples: 6,
      min_profile_bytes: 8,
      max_profile_bytes: 40,
      min_profile_elevation: -0.125,
      max_profile_elevation: 4321.0000001,
    }
  );

  assert.equal(report.locallyRecoverable.routeProfiles, 3);
  assert.equal(report.needsTrustedOutsideSource.integerLookingDestinations, 12);
  assert.equal(report.needsTrustedOutsideSource.destinationsWithSourceIds, 7);
  assert.equal(report.profileInventory.malformedOrOutOfRangeProfiles, 2);
  assert.equal("ids" in report, false);

  const messages: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => messages.push(String(message));
  try {
    printHuman(report);
  } finally {
    console.log = originalLog;
  }
  assert.equal(messages.some((message) => message.includes("Malformed or out-of-range profiles: 2")), true);
  assert.equal(messages.some((message) => message.includes("Stale elevation/catalog/standard verification jobs: 2/1/1")), true);
  assert.equal(messages.some((message) => message.startsWith("Non-finite destination/tracking")), true);
});

test("dry-run audit uses one repeatable-read, read-only transaction", async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("information_schema.columns")) return { rows: [] };
      if (sql.includes("destination_mismatches")) {
        return { rows: [{
          destination_mismatches: 0,
          tracking_point_mismatches: 0,
          integer_looking_destinations: 0,
          destinations_with_source_ids: 0,
          legacy_integer_profiles: 0,
          malformed_or_out_of_range_profiles: 0,
          recoverable_peaks_profiles: 0,
          invalid_peaks_profiles: 0,
          user_profiles_preserved: 0,
          active_elevation_leases: 0,
          active_catalog_leases: 0,
          active_standard_route_leases: 0,
          stale_elevation_jobs: 0,
          catalog_jobs_affected: 0,
          standard_jobs_needing_verification: 0,
          nonfinite_destination_scalars: 0,
          nonfinite_destination_z: 0,
          nonfinite_tracking_scalars: 0,
          nonfinite_tracking_z: 0,
          nonfinite_route_scalars: 0,
          nonfinite_route_z: 0,
          nonfinite_segment_scalars: 0,
          nonfinite_segment_z: 0,
          nonfinite_session_scalars: 0,
          nonfinite_session_path_z: 0,
          nonfinite_marker_z: 0,
          nonfinite_plan_gain: 0,
          nonfinite_elevation_jsonb: 0,
          fractional_destination_z: 0,
          fractional_tracking_z: 0,
          fractional_route_scalars: 0,
          fractional_route_z: 0,
          fractional_segment_scalars: 0,
          fractional_segment_z: 0,
          fractional_session_scalars: 0,
          fractional_session_path_z: 0,
          fractional_marker_z: 0,
          fractional_plan_gain: 0,
          elevation_like_jsonb_values: 0,
          fractional_elevation_jsonb: 0,
          route_profile_count: 0,
          route_profile_samples: 0,
          min_profile_samples: 0,
          max_profile_samples: 0,
          min_profile_bytes: 0,
          max_profile_bytes: 0,
          min_profile_elevation: null,
          max_profile_elevation: null,
        }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };

  await runElevationPrecisionAudit(pool as never);

  assert.match(queries[0], /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.equal(queries[1], "SET LOCAL extra_float_digits = 1");
  assert.equal(queries.some((sql) => /\b(?:UPDATE|INSERT|DELETE|ALTER)\b/i.test(sql)), false);
  assert.equal(queries.at(-1), "COMMIT");
});

test("apply verifies database, host, project/instance and completes catalog seeding", async () => {
  const args = parseAuditArgs(["--apply"]);
  const environment = {
    ELEVATION_PRECISION_EXPECTED_DATABASE: "peaks_test",
    ELEVATION_PRECISION_EXPECTED_INSTANCE: "donner-a8608:us-central1:peaks-db",
    ELEVATION_PRECISION_EXPECTED_HOST: "/cloudsql/donner-a8608:us-central1:peaks-db",
    DB_HOST: "/cloudsql/donner-a8608:us-central1:peaks-db",
  };
  const target = resolveApplyTarget(args, environment);
  const queries: string[] = [];
  let seeded = false;
  const pool = {
    options: { host: "/cloudsql/donner-a8608:us-central1:peaks-db" },
    async query(sql: string) {
      queries.push(sql);
      if (sql === "SELECT current_database()") {
        return { rows: [{ current_database: "peaks_test" }] };
      }
      return { rows: [] };
    },
  };

  await applyMigration(pool as never, target, environment, {
    async readMigration() { return "BEGIN; SELECT 'migration'; COMMIT;"; },
    seedCatalogJobs() { seeded = true; return 0; },
    async realpath(socketPath) { return socketPath; },
  });

  assert.equal(seeded, true);
  assert.equal(queries.at(-1), "BEGIN; SELECT 'migration'; COMMIT;");
  await assert.rejects(
    applyMigration(pool as never, target, {
      ...environment,
      DB_HOST: "/cloudsql/other-project:us-central1:peaks-db",
    }),
    /Pool host/
  );
  await assert.rejects(
    applyMigration(pool as never, target, {
      ...environment,
      DB_HOST: "127.0.0.1",
      INSTANCE_CONNECTION_NAME: "donner-a8608:us-central1:peaks-db",
    }),
    /absolute instance-bound Unix socket/
  );
  const wrongInstancePool = {
    ...pool,
    options: { host: "/cloudsql/other-project:us-central1:peaks-db" },
  };
  await assert.rejects(
    applyMigration(wrongInstancePool as never, target, {
      ...environment,
      DB_HOST: "/cloudsql/other-project:us-central1:peaks-db",
    }, {
      async realpath(socketPath) { return socketPath; },
    }),
    /Unix socket does not match/
  );
});
