import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTS_SQL,
  buildElevationPrecisionReport,
  parseAuditArgs,
  runElevationPrecisionAudit,
} from "../audit-elevation-precision";

test("profile inventory counts valid profile rows, not distinct profile text", () => {
  assert.match(COUNTS_SQL, /SELECT count\(\*\) FROM valid_profiles/);
  assert.doesNotMatch(COUNTS_SQL, /count\(DISTINCT elevation_string\)/);
});

test("elevation audit is dry-run JSON by default and apply is explicit", () => {
  assert.deepEqual(parseAuditArgs([]), { apply: false, format: "human", expectedDatabase: null });
  assert.deepEqual(parseAuditArgs(["--format=json"]), { apply: false, format: "json", expectedDatabase: null });
  assert.deepEqual(parseAuditArgs(["--apply", "--expected-database=peaks_test"]), {
    apply: true,
    format: "human",
    expectedDatabase: "peaks_test",
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
      recoverable_peaks_profiles: 3,
      invalid_peaks_profiles: 1,
      user_profiles_preserved: 4,
      active_elevation_leases: 0,
      active_catalog_leases: 0,
      active_standard_route_leases: 0,
      stale_elevation_jobs: 2,
      queued_catalog_jobs: 1,
      standard_jobs_needing_verification: 1,
      nonfinite_destination_scalars: 0,
      nonfinite_destination_z: 0,
      nonfinite_tracking_scalars: 0,
      nonfinite_tracking_z: 0,
      nonfinite_route_z: 0,
      fractional_destination_z: 7,
      fractional_tracking_z: 9,
      fractional_route_z: 8,
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
  assert.equal("ids" in report, false);
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
          recoverable_peaks_profiles: 0,
          invalid_peaks_profiles: 0,
          user_profiles_preserved: 0,
          active_elevation_leases: 0,
          active_catalog_leases: 0,
          active_standard_route_leases: 0,
          stale_elevation_jobs: 0,
          queued_catalog_jobs: 0,
          standard_jobs_needing_verification: 0,
          nonfinite_destination_scalars: 0,
          nonfinite_destination_z: 0,
          nonfinite_tracking_scalars: 0,
          nonfinite_tracking_z: 0,
          nonfinite_route_z: 0,
          fractional_destination_z: 0,
          fractional_tracking_z: 0,
          fractional_route_z: 0,
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
  assert.equal(queries.some((sql) => /\b(?:UPDATE|INSERT|DELETE|ALTER)\b/i.test(sql)), false);
  assert.equal(queries.at(-1), "COMMIT");
});
