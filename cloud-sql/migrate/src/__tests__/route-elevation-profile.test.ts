import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  computeRouteElevationStats,
  canonicalElevationToken,
  decodeElevationProfile,
  decodeElevationProfileResult,
  encodeElevationProfile,
  profileIsUsable,
  routeProfileHasRealRange,
} from "../route-elevation-profile";

test("canonical tokens use plain decimal text and normalize negative zero", () => {
  assert.equal(canonicalElevationToken(-0), "0");
  assert.equal(canonicalElevationToken(1e-7), "0.0000001");
  assert.equal(canonicalElevationToken(1e21), "1000000000000000000000");
  assert.equal(canonicalElevationToken(Number.NaN), null);
});

test("route elevation profile keeps round-trippable decimal metre samples", () => {
  const elevations = [1234.567890123, -0.125, 0, 4321.0000001];
  const encoded = encodeElevationProfile(elevations);

  assert.deepEqual(decodeElevationProfile(encoded), elevations);
  assert.equal(decodeElevationProfile(encoded).length, elevations.length);
  assert.equal(
    Buffer.from(encoded!, "base64").toString("ascii"),
    "1234.567890123|-0.125|0|4321.0000001"
  );
});

test("route elevation profile encodes long profiles without line breaks", () => {
  const encoded = encodeElevationProfile(new Array(200).fill(1200));

  assert.equal(encoded?.includes("\n"), false);
  assert.equal(decodeElevationProfile(encoded).length, 200);
  assert.equal(routeProfileHasRealRange(decodeElevationProfile(encoded)), false);
  assert.equal(routeProfileHasRealRange([1200, 1200.49, 1201]), true);
  assert.equal(routeProfileHasRealRange([1200, 1200.999999999]), false);
});

test("route elevation profile rejects flat, empty, and non-finite samples", () => {
  assert.equal(profileIsUsable([0, 0, 0]), false);
  assert.equal(profileIsUsable([0.4, -0.4]), true);
  assert.equal(encodeElevationProfile([0, 0, 0]), null);
  assert.equal(encodeElevationProfile([]), null);
  assert.equal(encodeElevationProfile([1200]), null);
  assert.deepEqual(
    decodeElevationProfile(encodeElevationProfile([0.4, -0.4])),
    [0.4, -0.4]
  );
  assert.equal(encodeElevationProfile([1000, Number.NaN]), null);
  assert.equal(encodeElevationProfile([1000, Number.POSITIVE_INFINITY]), null);
});

test("route elevation profile rejects non-canonical base64 and mismatched counts", () => {
  assert.deepEqual(decodeElevationProfile("MQ"), []);
  assert.deepEqual(decodeElevationProfile("MTAwMHwxMDAy!"), []);
  assert.deepEqual(decodeElevationProfile("MTAwMHwxMDAy="), []);
  assert.deepEqual(decodeElevationProfile("MQ==junk"), []);
  assert.deepEqual(
    decodeElevationProfile(Buffer.from("1000|1000.5|-1.25|1e3").toString("base64")),
    [1000, 1000.5, -1.25, 1000]
  );
  for (const invalid of ["NaN", "Infinity", "-Infinity", "1.2.3", "", "+1"]) {
    assert.deepEqual(
      decodeElevationProfile(Buffer.from(`1000|${invalid}`).toString("base64")),
      []
    );
  }
  assert.deepEqual(decodeElevationProfile("MTAwMHwxMDAy", 3), []);
  assert.deepEqual(decodeElevationProfile("MTAwMHwxMDAy", 2), [1000, 1002]);
});

test("route elevation profile reports safe decode failure causes", () => {
  assert.equal(decodeElevationProfileResult(null).failure, "missing");
  assert.equal(
    decodeElevationProfileResult("MTAwMHwxMDAy=").failure,
    "noncanonical_base64"
  );
  assert.equal(
    decodeElevationProfileResult(
      Buffer.from("1000| 1001").toString("base64")
    ).failure,
    "invalid_sample"
  );
  assert.equal(
    decodeElevationProfileResult(
      Buffer.from("1000|1e999").toString("base64")
    ).failure,
    "nonfinite_sample"
  );
  assert.equal(
    decodeElevationProfileResult(
      Buffer.from("1000|12000.1").toString("base64")
    ).failure,
    "out_of_range_sample"
  );
  assert.equal(
    decodeElevationProfileResult("MTAwMHwxMDAy", -1).failure,
    "invalid_expected_count"
  );
  assert.equal(
    decodeElevationProfileResult("MTAwMHwxMDAy", 3).failure,
    "point_count_mismatch"
  );
  assert.deepEqual(decodeElevationProfileResult("MTAwMHwxMDAy", 2), {
    elevations: [1000, 1002],
    failure: null,
  });
  const decimalProfile = Buffer.from("1000.25|1.001e3|-0.5").toString(
    "base64"
  );
  assert.deepEqual(decodeElevationProfileResult(decimalProfile, 3), {
    elevations: [1000.25, 1001, -0.5],
    failure: null,
  });
});

test("route elevation profile counts gain and loss beyond the four-metre dead band", () => {
  assert.deepEqual(computeRouteElevationStats([1000, 1010, 1008]), {
    gain: 10,
    loss: 0,
  });
  assert.deepEqual(computeRouteElevationStats([1000, 990, 992]), {
    gain: 0,
    loss: 10,
  });
  assert.deepEqual(computeRouteElevationStats([1000, 1003, 1000]), {
    gain: 0,
    loss: 0,
  });
  assert.deepEqual(computeRouteElevationStats([1000, 1004, 1000]), {
    gain: 0,
    loss: 0,
  });
});

test("route elevation SQL materializes only valid Peaks-owned paths", () => {
  const migrateRoot = path.resolve(__dirname, "../..");
  const sources = [
    fs.readFileSync(
      path.join(migrateRoot, "../migrations/20260810_elevation_double_precision.sql"),
      "utf8"
    ),
    fs.readFileSync(path.join(migrateRoot, "../schema.sql"), "utf8"),
  ];

  for (const source of sources) {
    assert.match(source, /ST_GeometryType\(path::geometry\) <> 'ST_LineString'/);
    assert.match(source, /point_count < 2/);
    assert.match(source, /has_nonzero_elevation/);
    assert.match(source, /CREATE OR REPLACE FUNCTION route_elevation_profile_has_real_range/);
    assert.match(source, /max_elevation - min_elevation >= 1/);
    assert.doesNotMatch(source, /round\(elevation/);
    assert.match(source, /FILTER \(WHERE elevation_is_finite\)/);
    assert.match(source, /FROM \([\s\S]+?\) valid_points/);
    assert.match(source, /canonical_elevation_token[\s\S]+?SET extra_float_digits = 1/);
    assert.doesNotMatch(source, /isfinite\(elevation\)/);
  }

  const schema = sources[1];
  assert.match(schema, /NEW\.elevation_string = encode_route_elevation_profile\(NEW\.path\)/);
  assert.match(schema, /WHEN \(NEW\.owner = 'peaks'\)/);
  assert.match(schema, /GRANT SELECT, INSERT, UPDATE, DELETE\s+ON route_elevation_backfill_jobs TO "peaks-api"/);
});

test("double-precision migration rebuilds canonical profiles and guards duplicate Z values", () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, "../../../migrations/20260810_elevation_double_precision.sql"),
    "utf8"
  );

  const beginOffsets = Array.from(migration.matchAll(/^BEGIN;$/gm), (match) => match.index!);
  const commitOffsets = Array.from(migration.matchAll(/^COMMIT;$/gm), (match) => match.index!);
  assert.equal(beginOffsets.length, 3);
  assert.equal(commitOffsets.length, 3);
  assert.ok(beginOffsets[0] < commitOffsets[0]);
  assert.ok(commitOffsets[0] < beginOffsets[1]);
  assert.ok(beginOffsets[1] < commitOffsets[1]);
  assert.ok(commitOffsets[1] < beginOffsets[2]);
  assert.ok(beginOffsets[2] < commitOffsets[2]);
  assert.match(migration, /owner = 'peaks'/);
  assert.match(migration, /old_elevation_string IS DISTINCT FROM new_elevation_string/);
  assert.match(migration, /CONSTRAINT destinations_elevation_matches_location_z/);
  assert.match(migration, /CONSTRAINT tracking_points_elevation_matches_location_z/);
  assert.match(migration, /ST_Z\(location::geometry\)/);
  assert.match(migration, /RAISE EXCEPTION/);
  assert.match(migration, /profile_ordinal/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /NOT VALID/);
  assert.match(migration, /ELSIF NOT constraint_is_validated THEN/);
  assert.match(migration, /lease_expires_at >= now\(\)/);
  const matcherOffset = migration.indexOf("CREATE OR REPLACE FUNCTION elevation_matches_location_z");
  const addConstraintOffset = migration.indexOf("ADD CONSTRAINT destinations_elevation_matches_location_z");
  const lockOffset = migration.indexOf("LOCK TABLE");
  const preflightOffset = migration.indexOf("SELECT count(*) INTO destination_mismatches");
  const timestampSnapshotOffset = migration.indexOf(
    "CREATE TEMP TABLE elevation_precision_route_timestamps_before"
  );
  const changedRoutesOffset = migration.indexOf(
    "CREATE TEMP TABLE elevation_precision_changed_routes"
  );
  const changedPathSnapshotOffset = migration.indexOf(
    "CREATE TEMP TABLE elevation_precision_changed_route_paths_before"
  );
  const affectedRoutesOffset = migration.indexOf(
    "CREATE TEMP TABLE elevation_precision_profile_affected_routes"
  );
  const validateOffset = migration.indexOf(
    "VALIDATE CONSTRAINT destinations_elevation_matches_location_z"
  );
  assert.ok(matcherOffset > beginOffsets[0] && matcherOffset < addConstraintOffset);
  assert.ok(addConstraintOffset < commitOffsets[0]);
  assert.ok(lockOffset > beginOffsets[1] && lockOffset < commitOffsets[1]);
  assert.ok(lockOffset >= 0 && lockOffset < preflightOffset);
  assert.ok(lockOffset < timestampSnapshotOffset);
  assert.ok(timestampSnapshotOffset < changedRoutesOffset);
  assert.ok(changedRoutesOffset < changedPathSnapshotOffset);
  assert.ok(changedPathSnapshotOffset < affectedRoutesOffset);
  assert.ok(validateOffset > beginOffsets[2] && validateOffset < commitOffsets[2]);
  assert.ok(validateOffset > commitOffsets[1]);
  let previousTableOffset = -1;
  for (const table of [
    "route_elevation_backfill_jobs",
    "route_catalog_audit_jobs",
    "standard_route_backfill_jobs",
    "routes",
    "segments",
    "route_segments",
    "route_destinations",
  ]) {
    const tableOffset = migration.slice(lockOffset, preflightOffset).indexOf(table);
    assert.ok(tableOffset > previousTableOffset, `${table} must follow the prior locked table`);
    previousTableOffset = tableOffset;
  }
  const lockStatement = migration.slice(lockOffset, migration.indexOf(";", lockOffset) + 1);
  assert.match(lockStatement, /SHARE ROW EXCLUSIVE MODE/);
  assert.doesNotMatch(lockStatement, /\bdestinations\b/);
  assert.doesNotMatch(lockStatement, /\btracking_points\b/);
  assert.doesNotMatch(
    migration.slice(timestampSnapshotOffset, changedRoutesOffset),
    /ST_AsEWKB/
  );
  assert.match(
    migration.slice(changedPathSnapshotOffset, affectedRoutesOffset),
    /JOIN elevation_precision_changed_routes changed USING \(id\)/
  );
  assert.doesNotMatch(migration, /elevation_precision_route_before/);
  assert.match(migration, /FULL JOIN profile_tokens/);
  assert.match(migration, /md5\(encode\(ST_AsEWKB/);
  assert.match(migration, /SET elevation_string = changed\.new_elevation_string/);
  assert.match(migration, /elevation_precision_segment_profiles_before/);
  assert.match(migration, /segment_safety AS MATERIALIZED/);
  assert.match(migration, /unsafe_for_legacy_bigint/);
  assert.match(migration, /COMMENT ON FUNCTION encode_route_elevation_profile/);
  assert.match(migration, /peaks:route-elevation-profile:finite-float8-v1/);
  assert.match(migration, /elevation_precision_profile_affected_routes/);
  assert.match(migration, /job\.path_fingerprint IS DISTINCT FROM current\.path_fingerprint/);
  assert.match(migration, /state = CASE WHEN current\.in_worker_scope THEN 'queued' ELSE 'out_of_scope' END/);
  assert.match(migration, /final_evidence = NULL/);
  assert.doesNotMatch(migration, /profile_precision_upgraded_from_postgis_path/);
  assert.match(migration, /SET extra_float_digits = 1/);
  assert.doesNotMatch(migration, /UPDATE\s+(?:destinations|tracking_points)/i);
});
