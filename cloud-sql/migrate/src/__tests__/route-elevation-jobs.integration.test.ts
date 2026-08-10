import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";
import { COUNTS_SQL } from "../audit-elevation-precision";
import { canonicalElevationToken } from "../route-elevation-profile";
import {
  ELEVATION_CANDIDATES_SQL,
  ELEVATION_ROUTE_FINGERPRINT_SQL,
  compactJob,
  elevationSegmentScopeIds,
  equalRouteIdSets,
  processCompletionOutput,
  publicElevationEvidenceMatches,
  publicRouteVerifierUrl,
  requireWorkerId,
  retryOutcome,
  routeElevationLineageEvidence,
  segmentNeedsTerrainSampling,
  segmentNeedsTerrainSamplingAcrossRoutes,
  statsOutput,
  validateArgs,
} from "../route-elevation-jobs";

const TEST_DATABASE_URL = process.env.ROUTE_ELEVATION_JOB_TEST_DATABASE_URL;
const MIGRATE_ROOT = join(__dirname, "../..");

function finiteParitySamples(): number[] {
  const samples = [
    -0,
    Number.MIN_VALUE,
    -Number.MIN_VALUE,
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
    Number.EPSILON,
    1e-7,
    1e20,
    1e21,
    1234.567890123,
  ];
  let state = 0x6d2b79f5;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  while (samples.length < 524) {
    view.setUint32(0, next());
    view.setUint32(4, next());
    const value = view.getFloat64(0);
    if (Number.isFinite(value)) samples.push(value);
  }
  return samples;
}

test("route elevation queue accepts only documented command flags", () => {
  assert.doesNotThrow(() => validateArgs("seed", ["--apply"]));
  assert.doesNotThrow(() => validateArgs("claim", ["--worker-id", "luna-route-elevation-01", "--apply"]));
  assert.doesNotThrow(() => validateArgs("process", ["--route-id", "route-1", "--lease-token", "token-1", "--apply"]));
  assert.doesNotThrow(() => validateArgs("show", ["--route-id", "route-1", "--state", "retry"]));
  assert.throws(() => validateArgs("complete", []), /Unknown command/);
  assert.throws(() => validateArgs("claim", ["--lease-minutes", "90"]), /Unknown flag/);
  assert.throws(() => validateArgs("stats", ["--apply"]), /Unknown flag/);
  assert.throws(() => validateArgs("seed", ["now"]), /Unexpected argument/);
  assert.equal(requireWorkerId("luna-route-elevation-01"), "luna-route-elevation-01");
  assert.throws(() => requireWorkerId("another-worker"), /luna-route-elevation-01/);
});

test("affected route set comparison ignores order but rejects membership changes", () => {
  assert.equal(
    equalRouteIdSets(["route-b", "route-a"], ["route-a", "route-b"]),
    true
  );
  assert.equal(
    equalRouteIdSets(["route-a", "route-b"], ["route-a", "route-c"]),
    false
  );
  assert.equal(equalRouteIdSets(["route-a"], ["route-a", "route-a"]), false);
});

test("clone scope is reserved before a user reference appears", () => {
  const scope = elevationSegmentScopeIds([
    {
      id: "source-segment",
      path_hash: "source-path-hash",
    },
  ]);
  assert.equal(scope.length, 2);
  assert.equal(scope.includes("source-segment"), true);
  assert.equal(
    scope.some((id) => id.startsWith("route-elevation-clone-")),
    true
  );
});

test("public elevation evidence requires exact profile bytes and stats", () => {
  const expected = {
    id: "route-a",
    status: "active",
    point_count: 2,
    elevation_string: "MTAwMHwxMDEw",
    profile_hash: "profile-hash",
    gain: 10,
    gain_loss: 0,
    elevation_source:
      "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)",
    elevation_source_url:
      "https://registry.opendata.aws/terrain-tiles/",
    elevation_attribution: "required attribution",
    elevation_license_url:
      "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
    elevation_retrieved_at: new Date("2026-08-03T12:34:56.000Z"),
    publish_integrity_valid: true,
  };
  const matching = {
    elevation_string: expected.elevation_string,
    profile_count: 2,
    profile_hash: expected.profile_hash,
    gain: 10,
    gain_loss: 0,
    elevation_source: expected.elevation_source,
    elevation_source_url: expected.elevation_source_url,
    elevation_attribution: expected.elevation_attribution,
    elevation_license_url: expected.elevation_license_url,
    elevation_retrieved_at: "2026-08-03T05:34:56-07:00",
    publish_integrity_valid: true,
  };
  assert.equal(publicElevationEvidenceMatches(expected, matching), true);
  assert.equal(
    publicElevationEvidenceMatches(expected, {
      ...matching,
      elevation_string: "MTAwMHwxMDA5",
    }),
    false
  );
  assert.equal(
    publicElevationEvidenceMatches(expected, { ...matching, gain: 9 }),
    false
  );
  assert.equal(
    publicElevationEvidenceMatches(expected, { ...matching, gain_loss: 1 }),
    false
  );
  assert.equal(
    publicElevationEvidenceMatches(expected, {
      ...matching,
      elevation_source: "wrong source",
    }),
    false
  );
  assert.equal(
    publicElevationEvidenceMatches(expected, {
      ...matching,
      elevation_retrieved_at: "2026-08-03T12:35:56.000Z",
    }),
    false
  );
  const {
    elevation_attribution: _missingAttribution,
    ...missingLineage
  } = matching;
  assert.equal(
    publicElevationEvidenceMatches(expected, missingLineage),
    false
  );
});

test("public route verification uses the deployed public API by default", () => {
  assert.equal(
    publicRouteVerifierUrl("route/a", "fingerprint 1", {}),
    "https://peaks-firebase--donner-a8608.us-central1.hosted.app" +
      "/api/public/routes/route%2Fa?elevation_fingerprint=fingerprint%201"
  );
  assert.equal(
    publicRouteVerifierUrl("route-1", "hash-1", {
      PEAKS_PUBLIC_WEB_URL: "https://example.test/",
    }),
    "https://example.test/api/public/routes/route-1" +
      "?elevation_fingerprint=hash-1"
  );
  assert.equal(
    publicRouteVerifierUrl("route-1", "hash-1", {
      PEAKS_PUBLIC_ROUTE_VERIFIER_BASE_URL:
        "https://verifier.example.test/custom/",
    }),
    "https://verifier.example.test/custom/routes/route-1" +
      "?elevation_fingerprint=hash-1"
  );
});

test("route range decides whether a valid flat segment needs terrain sampling", () => {
  const points = (elevations: Array<number | null>) =>
    elevations.map((elevation, index) => ({
      lat: 47 + index * 0.001,
      lng: -121 - index * 0.001,
      elevation,
    }));

  assert.equal(
    segmentNeedsTerrainSampling(
      points([1200, 1200]),
      points([1200, 1200])
    ),
    true,
    "a constant nonzero one-segment route needs real terrain"
  );
  assert.equal(
    segmentNeedsTerrainSampling(
      points([1200, 1200, 1300, 1300]),
      points([1200, 1200])
    ),
    false,
    "two flat source segments at different levels rebuild without terrain"
  );
  assert.equal(
    segmentNeedsTerrainSampling(
      points([1200, 1300]),
      points([null, null])
    ),
    true,
    "missing segment Z always needs terrain"
  );
  assert.equal(
    segmentNeedsTerrainSamplingAcrossRoutes(
      [
        points([1200, 1200, 1250]),
        points([1200, 1200]),
      ],
      points([1200, 1200])
    ),
    true,
    "a flat shared consumer forces sampling even when the claimed route varies"
  );
});

test("persisted Terrarium lineage survives a no-fetch retry", () => {
  const retrievedAt = new Date("2026-08-03T12:34:56.000Z");
  assert.deepEqual(
    routeElevationLineageEvidence({
      elevation_source:
        "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)",
      elevation_source_url:
        "https://registry.opendata.aws/terrain-tiles/",
      elevation_attribution: "required attribution",
      elevation_license_url:
        "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
      elevation_retrieved_at: retrievedAt,
    }),
    {
      source_kind: "terrarium_z14",
      terrain_source:
        "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)",
      terrain_source_url:
        "https://registry.opendata.aws/terrain-tiles/",
      terrain_source_endpoint:
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/{x}/{y}.png",
      terrain_data_license:
        "Source-specific license terms in Tilezen Joerd attribution.md",
      terrain_license_url:
        "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
      terrain_attribution: "required attribution",
      terrain_retrieved_at: retrievedAt,
    }
  );
});

test("elevation seed is fault-only and fingerprints every derived cache input", () => {
  assert.match(ELEVATION_CANDIDATES_SQL, /r\.status IN \('active', 'pending'\)/);
  assert.match(ELEVATION_CANDIDATES_SQL, /r\.elevation_string IS DISTINCT FROM\s+encode_route_elevation_profile\(r\.path\)/);
  assert.match(ELEVATION_CANDIDATES_SQL, /NOT route_elevation_profile_has_real_range\(r\.path\)/);
  assert.match(ELEVATION_CANDIDATES_SQL, /r\.gain IS DISTINCT FROM/);
  assert.match(ELEVATION_CANDIDATES_SQL, /r\.gain_loss IS DISTINCT FROM/);
  assert.match(ELEVATION_CANDIDATES_SQL, /segment_needs_elevation/);
  assert.match(
    ELEVATION_CANDIDATES_SQL,
    /s\.gain IS DISTINCT FROM[\s\S]+?route_elevation_stats\(s\.path\)/
  );
  assert.match(
    ELEVATION_CANDIDATES_SQL,
    /s\.gain_loss IS DISTINCT FROM[\s\S]+?route_elevation_stats\(s\.path\)/
  );
  assert.match(ELEVATION_CANDIDATES_SQL, /COALESCE\(r\.elevation_string/);
  assert.match(ELEVATION_CANDIDATES_SQL, /COALESCE\(r\.gain::text/);
  assert.match(ELEVATION_CANDIDATES_SQL, /COALESCE\(r\.gain_loss::text/);
  assert.match(ELEVATION_CANDIDATES_SQL, /COALESCE\(r\.elevation_source/);
  assert.match(ELEVATION_CANDIDATES_SQL, /COALESCE\(r\.elevation_source_url/);
  assert.match(ELEVATION_CANDIDATES_SQL, /COALESCE\(r\.elevation_attribution/);
  assert.match(ELEVATION_CANDIDATES_SQL, /COALESCE\(r\.elevation_license_url/);
  assert.match(ELEVATION_CANDIDATES_SQL, /COALESCE\(r\.elevation_retrieved_at::text/);
  assert.match(ELEVATION_CANDIDATES_SQL, /rs\.direction/);
  assert.match(ELEVATION_CANDIDATES_SQL, /COALESCE\(encode_route_elevation_profile\(s\.path\)/);
  assert.doesNotMatch(ELEVATION_CANDIDATES_SQL, /status = 'superseded'/);
  const source = readFileSync(
    join(MIGRATE_ROOT, "src/route-elevation-jobs.ts"),
    "utf8"
  );
  assert.match(source, /requeued_changed_complete/);
  assert.match(source, /j\.state = 'complete'/);
  assert.match(source, /requeued_changed_blocked/);
  assert.match(source, /j\.state = 'blocked'/);
  assert.match(source, /attempt_count = 0/);
  assert.match(source, /j\.path_fingerprint <> current_route\.path_fingerprint/);
});

test("compact worker output exposes names and safe completion evidence only", () => {
  const job = {
    route_id: "route-a",
    route_name: "Mailbox Peak Trail",
    state: "complete",
    priority: 100,
    attempt_count: 1,
    source_kind: "terrarium_z14",
    next_attempt_at: "2026-08-03T00:00:00Z",
    lease_token: null,
    lease_expires_at: null,
      final_evidence: {
      source_kind: "terrarium_z14",
      point_count: 42,
      verification: "public_profile_count_verified",
      path: "must-not-leak",
      latitude: 47.4,
      profile_hash: "abc123",
      terrain_source_endpoint:
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
      terrain_data_license: "AWS Open Data Terrain Tiles source metadata",
      terrain_retrieved_at: "2026-08-03T00:00:00.000Z",
    },
  };

  assert.deepEqual(compactJob(job as never), {
    route_id: "route-a",
    route_name: "Mailbox Peak Trail",
    state: "complete",
    priority: 100,
    attempt_count: 1,
    source_kind: "terrarium_z14",
    next_attempt_at: "2026-08-03T00:00:00Z",
    lease_token: null,
    lease_expires_at: null,
    final_evidence: {
      source_kind: "terrarium_z14",
      point_count: 42,
      verification: "public_profile_count_verified",
      profile_hash: "abc123",
    },
  });
  assert.deepEqual(processCompletionOutput(job as never), {
    outcome: "complete",
    state: "complete",
    route_id: "route-a",
    route_name: "Mailbox Peak Trail",
    source_kind: "terrarium_z14",
    point_count: 42,
    verification: "public_profile_count_verified",
    profile_hash: "abc123",
  });
  assert.deepEqual(
    compactJob({
      ...job,
      state: "retry",
      final_evidence: null,
      last_error: "Terrain tile request failed with HTTP 503",
    } as never),
    {
      route_id: "route-a",
      route_name: "Mailbox Peak Trail",
      state: "retry",
      priority: 100,
      attempt_count: 1,
      source_kind: "terrarium_z14",
      next_attempt_at: "2026-08-03T00:00:00Z",
      lease_token: null,
      lease_expires_at: null,
      blocker: "Terrain tile request failed with HTTP 503",
    }
  );
  assert.equal(retryOutcome("blocked"), "blocked");
  assert.equal(retryOutcome("retry"), "retry");
  assert.deepEqual(
    statsOutput([
      { state: "retry", count: 2, expired_leases: 0 },
      { state: "working", count: 3, expired_leases: 1 },
    ]),
    {
      states: { retry: 2, working: 3 },
      total: 5,
      expired_leases: 1,
    }
  );
});

test("elevation writes cast arrays and derive persisted stats from rebuilt paths", () => {
  const source = readFileSync(
    join(MIGRATE_ROOT, "src/route-elevation-jobs.ts"),
    "utf8"
  );
  assert.equal(
    source.match(/\(\$2::float8\[\]\)\[n\]/g)?.length,
    2,
    "segment and legacy route writes must give PostgreSQL a concrete array type"
  );
  assert.doesNotMatch(source, /\$2\[n\]/);
  assert.equal(
    source.match(
      /CROSS JOIN LATERAL route_elevation_stats\(rebuilt\.path\) elevation_stats/g
    )?.length,
    2,
    "segment and legacy writes must store the database's stats for the rebuilt path"
  );
  assert.doesNotMatch(
    source,
    /computeRouteElevationStats\(elevations\)/,
    "persisted double stats must not cross the JavaScript/PostgreSQL boundary"
  );
});

test("sampled profiles without a real range block before writes", () => {
  const source = readFileSync(
    join(MIGRATE_ROOT, "src/route-elevation-jobs.ts"),
    "utf8"
  );
  assert.match(
    source,
    /if \(!routeProfileHasRealRange\(elevations\)\) \{\s+throw new SampledElevationProfileNoRealRangeError\(\)/
  );
  assert.match(
    source,
    /sampled_elevation_profile_has_no_real_range_requires_route_factory/
  );
  assert.match(
    source,
    /error instanceof SampledElevationProfileNoRealRangeError[\s\S]+?blockLease\(/
  );
  assert.match(
    source,
    /error instanceof SampledElevationProfileNoRealRangeError[\s\S]+?hasLiveLease\(routeId, token\)[\s\S]+?currentFingerprint\(db, routeId\)[\s\S]+?path_changed_requeued/
  );
  assert.match(
    source,
    /async function blockLease[\s\S]+?lease_expires_at >= now\(\)/
  );
});

test(
  "legacy elevation state upgrades through the real migration and stays unchanged on rerun",
  { skip: TEST_DATABASE_URL ? false : "ROUTE_ELEVATION_JOB_TEST_DATABASE_URL not set" },
  async () => {
    const url = new URL(TEST_DATABASE_URL!);
    assert.match(url.pathname, /_test$/);
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const client = await pool.connect();
    const schema = `elevation_precision_${process.pid}_${Date.now()}`;
    const migration = readFileSync(
      join(MIGRATE_ROOT, "../migrations/20260810_elevation_double_precision.sql"),
      "utf8"
    );
    const beginOffsets = Array.from(migration.matchAll(/^BEGIN;$/gm), (match) => match.index!);
    const commitOffsets = Array.from(migration.matchAll(/^COMMIT;$/gm), (match) => match.index!);
    assert.equal(beginOffsets.length, 3);
    assert.equal(commitOffsets.length, 3);
    assert.deepEqual(
      beginOffsets.map((beginOffset, index) => beginOffset < commitOffsets[index]),
      [true, true, true]
    );
    assert.ok(commitOffsets[0] < beginOffsets[1]);
    assert.ok(commitOffsets[1] < beginOffsets[2]);
    const mainLockOffset = migration.indexOf("LOCK TABLE");
    const mainLockStatement = migration.slice(
      mainLockOffset,
      migration.indexOf(";", mainLockOffset) + 1
    );
    assert.doesNotMatch(mainLockStatement, /\bdestinations\b|\btracking_points\b/);
    const changedPathSnapshotOffset = migration.indexOf(
      "CREATE TEMP TABLE elevation_precision_changed_route_paths_before"
    );
    const affectedRoutesOffset = migration.indexOf(
      "CREATE TEMP TABLE elevation_precision_profile_affected_routes"
    );
    assert.match(
      migration.slice(changedPathSnapshotOffset, affectedRoutesOffset),
      /JOIN elevation_precision_changed_routes changed USING \(id\)/
    );
    assert.ok(
      migration.indexOf("VALIDATE CONSTRAINT destinations_elevation_matches_location_z") >
        commitOffsets[1]
    );
    const legacyProfile = Buffer.from("1235|1236", "ascii").toString("base64");
    const preciseProfile = Buffer.from(
      "1234.567890123|1236.125",
      "ascii"
    ).toString("base64");
    const outOfRangeProfile = Buffer.from("1000|1e999999", "ascii").toString("base64");
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}", public`);
      await client.query(`
        CREATE TABLE destinations (
          id text PRIMARY KEY,
          elevation double precision,
          prominence double precision,
          location geography(PointZ, 4326),
          features destination_feature[] NOT NULL DEFAULT '{}',
          averages jsonb,
          averages_offset jsonb,
          metadata jsonb,
          external_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
          amenities jsonb
        );
        CREATE TABLE tracking_points (
          id text PRIMARY KEY,
          elevation double precision,
          location geography(PointZ, 4326)
        );
        CREATE TABLE routes (
          id text PRIMARY KEY,
          name text,
          owner text NOT NULL,
          status text NOT NULL,
          shape text,
          path geography(LineStringZ, 4326),
          distance double precision,
          gain double precision,
          gain_loss double precision,
          elevation_string text,
          elevation_source text,
          elevation_source_url text,
          elevation_attribution text,
          elevation_license_url text,
          elevation_retrieved_at timestamptz,
          external_links jsonb,
          provenance jsonb,
          completion text NOT NULL DEFAULT 'none',
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE segments (
          id text PRIMARY KEY,
          path geography(LineStringZ, 4326),
          gain double precision,
          gain_loss double precision,
          provenance jsonb
        );
        CREATE TABLE route_segments (
          route_id text NOT NULL,
          segment_id text NOT NULL,
          ordinal integer NOT NULL,
          direction text NOT NULL
        );
        CREATE TABLE route_destinations (
          route_id text NOT NULL,
          destination_id text NOT NULL
        );
        CREATE TABLE route_elevation_backfill_jobs (
          route_id text PRIMARY KEY,
          state text NOT NULL,
          path_fingerprint text NOT NULL,
          priority integer NOT NULL DEFAULT 0,
          attempt_count integer NOT NULL DEFAULT 0,
          source_kind text NOT NULL DEFAULT 'unknown',
          last_error text,
          final_evidence jsonb,
          next_attempt_at timestamptz NOT NULL DEFAULT now(),
          lease_owner text,
          lease_token text,
          lease_expires_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE route_catalog_audit_jobs (
          destination_id text PRIMARY KEY,
          state text NOT NULL,
          attempt_count integer NOT NULL DEFAULT 0,
          catalog_fingerprint text NOT NULL,
          last_error text,
          final_result jsonb,
          audited_at timestamptz,
          lease_owner text,
          lease_token text,
          lease_expires_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE standard_route_backfill_jobs (
          destination_id text PRIMARY KEY,
          state text NOT NULL,
          target_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
          evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
          candidate jsonb NOT NULL DEFAULT '{}'::jsonb,
          review jsonb NOT NULL DEFAULT '{}'::jsonb,
          candidate_artifact jsonb,
          published_route_id text,
          replacement_route_id text,
          next_attempt_at timestamptz NOT NULL DEFAULT now(),
          last_error text,
          lease_token text,
          lease_expires_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE route_integrity_repairs (
          route_id text NOT NULL,
          destination_id text NOT NULL,
          evidence jsonb NOT NULL DEFAULT '{}'::jsonb
        );
        CREATE TABLE tracking_sessions (
          id text PRIMARY KEY,
          gain double precision,
          highest_point double precision,
          path geography(LineStringZ, 4326),
          health_data jsonb,
          source_contributions jsonb NOT NULL DEFAULT '[]'::jsonb
        );
        CREATE TABLE session_markers (
          id text PRIMARY KEY,
          location geography(PointZ, 4326)
        );
        CREATE TABLE plans (
          id text PRIMARY KEY,
          gain double precision,
          path geography(Geometry, 4326)
        );

        CREATE FUNCTION encode_route_elevation_profile(path geography)
        RETURNS text
        LANGUAGE SQL
        IMMUTABLE
        AS $legacy$
          SELECT encode(convert_to(string_agg(
            round(ST_Z((dumped).geom))::bigint::text,
            '|' ORDER BY (dumped).path
          ), 'SQL_ASCII'), 'base64')
          FROM ST_DumpPoints(path::geometry) dumped;
        $legacy$;

        CREATE FUNCTION route_elevation_profile_has_real_range(path geography)
        RETURNS boolean
        LANGUAGE SQL
        IMMUTABLE
        AS $legacy$ SELECT path IS NOT NULL; $legacy$;

        CREATE FUNCTION route_elevation_stats(path geography)
        RETURNS TABLE(gain double precision, loss double precision)
        LANGUAGE SQL
        IMMUTABLE
        AS $legacy$ SELECT 0::double precision, 0::double precision; $legacy$;
      `);

      await client.query(
        `INSERT INTO destinations (id, elevation, location) VALUES
           ('destination', 100.25, ST_SetSRID(ST_MakePoint(-121, 47, 100.25), 4326)::geography);
         UPDATE destinations
         SET averages = '{"elevation":1.25,"mixed":[{"gain":2.5},3,["scalar",{"highestPoint":"NaN"}]]}'::jsonb
         WHERE id = 'destination';
         INSERT INTO tracking_points (id, elevation, location) VALUES
           ('point', 100.25, ST_SetSRID(ST_MakePoint(-121, 47, 100.25), 4326)::geography);`
      );
      await client.query(
        `INSERT INTO routes (
           id, name, owner, status, path, gain, gain_loss, elevation_string, updated_at
         ) VALUES
           ('peaks-valid', 'Valid', 'peaks', 'active', ST_GeogFromText(
             'SRID=4326;LINESTRING Z (-121 47 1234.567890123, -121.01 47.01 1236.125)'
           ), 0, 0, $1, '2026-01-01T00:00:00Z'),
           ('peaks-current', 'Current', 'peaks', 'active', ST_GeogFromText(
             'SRID=4326;LINESTRING Z (-121 47 1234.567890123, -121.01 47.01 1236.125)'
           ), 0, 0, $2, '2026-01-02T00:00:00Z'),
           ('peaks-extreme', 'Extreme segment', 'peaks', 'active', ST_GeogFromText(
             'SRID=4326;LINESTRING Z (-121 47 1234.567890123, -121.01 47.01 1236.125)'
           ), 0, 0, $2, '2026-01-02T12:00:00Z'),
           ('peaks-invalid', 'Invalid', 'peaks', 'active', NULL, 0, 0, $1,
             '2026-01-03T00:00:00Z'),
           ('peaks-superseded', 'Superseded', 'peaks', 'superseded', ST_GeogFromText(
             'SRID=4326;LINESTRING Z (-121 47 1234.567890123, -121.01 47.01 1236.125)'
           ), 0, 0, $1, '2026-01-03T12:00:00Z'),
           ('user-valid', 'User', 'user-1', 'active', ST_GeogFromText(
             'SRID=4326;LINESTRING Z (-121 47 1234.567890123, -121.01 47.01 1236.125)'
           ), 0, 0, $1, '2026-01-04T00:00:00Z'),
           ('user-out-of-range', 'User malformed', 'user-1', 'active', ST_GeogFromText(
             'SRID=4326;LINESTRING Z (-121 47 1000, -121.01 47.01 1001)'
           ), 0, 0, $3, '2026-01-05T00:00:00Z')`,
        [legacyProfile, preciseProfile, outOfRangeProfile]
      );
      await client.query(
        `INSERT INTO route_destinations VALUES ('peaks-valid', 'destination');
         INSERT INTO segments (id, path, gain, gain_loss) VALUES
           ('fractional-segment', ST_GeogFromText(
             'SRID=4326;LINESTRING Z (-121 47 1234.567890123, -121.01 47.01 1236.125)'
           ), 0, 0),
           ('extreme-segment', ST_GeogFromText(
             'SRID=4326;LINESTRING Z (-121 47 1e20, -121.01 47.01 1.0000000000000002e20)'
           ), 0, 0);
         INSERT INTO route_segments VALUES
           ('peaks-current', 'fractional-segment', 0, 'forward'),
           ('peaks-extreme', 'extreme-segment', 0, 'forward');
         INSERT INTO route_elevation_backfill_jobs (
           route_id, state, path_fingerprint, attempt_count, last_error, final_evidence,
           updated_at
         ) VALUES
           ('peaks-valid', 'blocked', 'legacy-valid', 3, 'old failure', '{"old":true}',
             '2026-02-01T00:00:00Z'),
           ('peaks-current', 'complete', 'legacy-current', 1, NULL, '{"old":true}',
             '2026-02-01T12:00:00Z'),
           ('peaks-extreme', 'complete', 'legacy-extreme', 1, NULL, '{"old":true}',
             '2026-02-01T18:00:00Z'),
           ('peaks-invalid', 'complete', 'legacy-invalid', 1, NULL, '{"old":true}',
             '2026-02-02T00:00:00Z'),
           ('peaks-superseded', 'complete', 'legacy-superseded', 1, NULL, '{"old":true}',
             '2026-02-02T12:00:00Z');
         INSERT INTO route_catalog_audit_jobs (
           destination_id, state, attempt_count, catalog_fingerprint, final_result,
           audited_at, updated_at
         ) VALUES (
           'destination', 'passed', 2, 'truthful-old-fingerprint', '{"old":true}',
           '2026-02-03T00:00:00Z', '2026-02-03T00:00:00Z'
         );
         INSERT INTO standard_route_backfill_jobs (
           destination_id, state, evidence, published_route_id, last_error, updated_at
         ) VALUES (
           'destination', 'verified',
           '{"keep":"yes","last_verification":{"old":true},"verification_action":"old"}',
           'peaks-valid', 'old failure', '2026-02-04T00:00:00Z'
         );`
      );

      await client.query(
        `UPDATE route_elevation_backfill_jobs job
         SET path_fingerprint = current.path_fingerprint
         FROM (${ELEVATION_ROUTE_FINGERPRINT_SQL}) current
         WHERE current.route_id = job.route_id
           AND job.route_id <> 'peaks-extreme'`
      );

      await client.query("SET extra_float_digits = 1");
      const legacyAudit = await client.query<{
        recoverable_peaks_profiles: string;
        stale_elevation_jobs: string;
        catalog_jobs_affected: string;
        standard_jobs_needing_verification: string;
        malformed_or_out_of_range_profiles: string;
        elevation_like_jsonb_values: string;
        fractional_elevation_jsonb: string;
        nonfinite_elevation_jsonb: string;
      }>(COUNTS_SQL);
      assert.equal(Number(legacyAudit.rows[0].recoverable_peaks_profiles), 2);
      assert.equal(Number(legacyAudit.rows[0].stale_elevation_jobs), 3);
      assert.equal(Number(legacyAudit.rows[0].catalog_jobs_affected), 1);
      assert.equal(Number(legacyAudit.rows[0].standard_jobs_needing_verification), 1);
      assert.equal(Number(legacyAudit.rows[0].malformed_or_out_of_range_profiles), 1);
      assert.equal(Number(legacyAudit.rows[0].elevation_like_jsonb_values), 3);
      assert.equal(Number(legacyAudit.rows[0].fractional_elevation_jsonb), 2);
      assert.equal(Number(legacyAudit.rows[0].nonfinite_elevation_jsonb), 1);

      const pathHashesBefore = await client.query<{ id: string; path_hash: string | null }>(
        `SELECT id,
                CASE WHEN path IS NULL THEN NULL
                  ELSE md5(encode(ST_AsEWKB(path::geometry), 'hex')) END AS path_hash
         FROM routes ORDER BY id`
      );

      await client.query(migration);

      const paritySamples = finiteParitySamples();
      await client.query("SET extra_float_digits = -15");
      const sqlTokens = await client.query<{ ordinal: number; token: string }>(
        `SELECT ordinality::int AS ordinal, canonical_elevation_token(value) AS token
         FROM unnest($1::double precision[]) WITH ORDINALITY sample(value, ordinality)
         ORDER BY ordinality`,
        [paritySamples]
      );
      assert.deepEqual(
        sqlTokens.rows.map((row) => row.token),
        paritySamples.map((value) => canonicalElevationToken(value))
      );
      const functionConfig = await client.query<{ proconfig: string[] | null }>(
        `SELECT proconfig
         FROM pg_proc
         WHERE oid = 'canonical_elevation_token(double precision)'::regprocedure`
      );
      assert.deepEqual(functionConfig.rows[0]?.proconfig, ["extra_float_digits=1"]);
      await client.query("RESET extra_float_digits");

      const routesAfterFirst = await client.query<{
        id: string;
        elevation_string: string | null;
        updated_at: Date;
      }>(`SELECT id, elevation_string, updated_at FROM routes ORDER BY id`);
      const validRoute = routesAfterFirst.rows.find((row) => row.id === "peaks-valid")!;
      const currentRoute = routesAfterFirst.rows.find((row) => row.id === "peaks-current")!;
      const invalidRoute = routesAfterFirst.rows.find((row) => row.id === "peaks-invalid")!;
      const supersededRoute = routesAfterFirst.rows.find((row) => row.id === "peaks-superseded")!;
      const userRoute = routesAfterFirst.rows.find((row) => row.id === "user-valid")!;
      const outOfRangeUserRoute = routesAfterFirst.rows.find((row) => row.id === "user-out-of-range")!;
      assert.equal(validRoute.elevation_string, preciseProfile);
      assert.equal(currentRoute.elevation_string, preciseProfile);
      assert.equal(currentRoute.updated_at.toISOString(), "2026-01-02T00:00:00.000Z");
      assert.equal(invalidRoute.elevation_string, null);
      assert.equal(supersededRoute.elevation_string, preciseProfile);
      assert.equal(userRoute.elevation_string, legacyProfile);
      assert.equal(userRoute.updated_at.toISOString(), "2026-01-04T00:00:00.000Z");
      assert.equal(outOfRangeUserRoute.elevation_string, outOfRangeProfile);

      const elevationJobs = await client.query<{
        route_id: string;
        state: string;
        attempt_count: number;
        last_error: string | null;
        final_evidence: Record<string, unknown> | null;
      }>(
        `SELECT route_id, state, attempt_count, last_error, final_evidence
         FROM route_elevation_backfill_jobs ORDER BY route_id`
      );
      const invalidJob = elevationJobs.rows.find((row) => row.route_id === "peaks-invalid")!;
      const supersededJob = elevationJobs.rows.find((row) => row.route_id === "peaks-superseded")!;
      const validJob = elevationJobs.rows.find((row) => row.route_id === "peaks-valid")!;
      const currentJob = elevationJobs.rows.find((row) => row.route_id === "peaks-current")!;
      const extremeJob = elevationJobs.rows.find((row) => row.route_id === "peaks-extreme")!;
      assert.equal(invalidJob.state, "out_of_scope");
      assert.equal(invalidJob.final_evidence, null);
      assert.equal(supersededJob.state, "out_of_scope");
      assert.equal(supersededJob.final_evidence, null);
      assert.equal(validJob.state, "queued");
      assert.equal(validJob.attempt_count, 0);
      assert.equal(validJob.last_error, null);
      assert.equal(validJob.final_evidence, null);
      assert.equal(currentJob.state, "queued");
      assert.equal(currentJob.final_evidence, null);
      assert.equal(extremeJob.state, "queued");
      assert.equal(extremeJob.final_evidence, null);

      const catalogJob = (await client.query<{
        state: string;
        catalog_fingerprint: string;
        final_result: { stale_reason?: string; previous_catalog_fingerprint?: string };
      }>(`SELECT state, catalog_fingerprint, final_result FROM route_catalog_audit_jobs`)).rows[0];
      assert.equal(catalogJob.state, "queued");
      assert.equal(catalogJob.catalog_fingerprint, "truthful-old-fingerprint");
      assert.equal(catalogJob.final_result.stale_reason, "elevation_profile_format_changed");
      assert.equal(catalogJob.final_result.previous_catalog_fingerprint, "truthful-old-fingerprint");

      const standardJob = (await client.query<{
        state: string;
        evidence: Record<string, unknown>;
        last_error: string | null;
      }>(`SELECT state, evidence, last_error FROM standard_route_backfill_jobs`)).rows[0];
      assert.equal(standardJob.state, "published");
      assert.deepEqual(standardJob.evidence, { keep: "yes" });
      assert.equal(standardJob.last_error, null);

      const constraintsAfterFirst = await client.query<{
        conname: string;
        oid: number;
        convalidated: boolean;
        definition: string;
      }>(
        `SELECT conname, oid, convalidated, pg_get_constraintdef(oid, true) AS definition
         FROM pg_constraint
         WHERE conrelid IN ('destinations'::regclass, 'tracking_points'::regclass)
           AND conname IN (
             'destinations_elevation_matches_location_z',
             'tracking_points_elevation_matches_location_z'
           )
         ORDER BY conname`
      );
      assert.equal(constraintsAfterFirst.rowCount, 2);
      assert.equal(constraintsAfterFirst.rows.every((row) => row.convalidated), true);
      assert.equal(
        constraintsAfterFirst.rows.every(
          (row) => row.definition === "CHECK (elevation_matches_location_z(elevation, location))"
        ),
        true
      );

      const snapshotAfterFirst = await client.query<{ snapshot: string }>(`
        SELECT jsonb_build_object(
          'routes', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM routes r),
          'elevation_jobs', (SELECT jsonb_agg(to_jsonb(j) ORDER BY j.route_id)
            FROM route_elevation_backfill_jobs j),
          'catalog_jobs', (SELECT jsonb_agg(to_jsonb(j) ORDER BY j.destination_id)
            FROM route_catalog_audit_jobs j),
          'standard_jobs', (SELECT jsonb_agg(to_jsonb(j) ORDER BY j.destination_id)
            FROM standard_route_backfill_jobs j)
        )::text AS snapshot
      `);

      await client.query(migration);

      const pathHashesAfter = await client.query<{ id: string; path_hash: string | null }>(
        `SELECT id,
                CASE WHEN path IS NULL THEN NULL
                  ELSE md5(encode(ST_AsEWKB(path::geometry), 'hex')) END AS path_hash
         FROM routes ORDER BY id`
      );
      assert.deepEqual(pathHashesAfter.rows, pathHashesBefore.rows);

      const snapshotAfterSecond = await client.query<{ snapshot: string }>(`
        SELECT jsonb_build_object(
          'routes', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM routes r),
          'elevation_jobs', (SELECT jsonb_agg(to_jsonb(j) ORDER BY j.route_id)
            FROM route_elevation_backfill_jobs j),
          'catalog_jobs', (SELECT jsonb_agg(to_jsonb(j) ORDER BY j.destination_id)
            FROM route_catalog_audit_jobs j),
          'standard_jobs', (SELECT jsonb_agg(to_jsonb(j) ORDER BY j.destination_id)
            FROM standard_route_backfill_jobs j)
        )::text AS snapshot
      `);
      assert.equal(snapshotAfterSecond.rows[0].snapshot, snapshotAfterFirst.rows[0].snapshot);

      const constraintsAfterSecond = await client.query<{
        conname: string;
        oid: number;
        convalidated: boolean;
        definition: string;
      }>(
        `SELECT conname, oid, convalidated, pg_get_constraintdef(oid, true) AS definition
         FROM pg_constraint
         WHERE conrelid IN ('destinations'::regclass, 'tracking_points'::regclass)
           AND conname IN (
             'destinations_elevation_matches_location_z',
             'tracking_points_elevation_matches_location_z'
           )
         ORDER BY conname`
      );
      assert.deepEqual(constraintsAfterSecond.rows, constraintsAfterFirst.rows);
    } finally {
      await client.query(`RESET search_path`);
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      client.release();
      await pool.end();
    }
  }
);

test(
  "route elevation jobs seed Peaks paths, atomically lease distinct work, and recover expired leases",
  { skip: TEST_DATABASE_URL ? false : "ROUTE_ELEVATION_JOB_TEST_DATABASE_URL not set" },
  async () => {
    const url = new URL(TEST_DATABASE_URL!);
    assert.match(url.pathname, /_test$/, "route elevation job tests require a disposable *_test database");
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const suffix = `${process.pid}-${Date.now()}`;
    const routeA = `route-elevation-a-${suffix}`;
    const routeB = `route-elevation-b-${suffix}`;
    const validRoute = `route-elevation-valid-${suffix}`;
    const validSegment = `route-elevation-valid-segment-${suffix}`;
    const supersededRoute = `route-elevation-superseded-${suffix}`;
    const userRoute = `route-elevation-user-${suffix}`;
    const command = (...args: string[]) => {
      const result = spawnSync(join(MIGRATE_ROOT, "node_modules/.bin/tsx"), [join(MIGRATE_ROOT, "src/route-elevation-jobs.ts"), ...args], {
        cwd: MIGRATE_ROOT,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          DB_HOST: url.hostname,
          DB_PORT: url.port || "5432",
          DB_NAME: url.pathname.slice(1),
          DB_USER: decodeURIComponent(url.username),
          DB_PASS: decodeURIComponent(url.password),
        },
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return JSON.parse(result.stdout.trim());
    };
    const insertRoute = async (
      id: string,
      owner: string,
      status = "pending"
    ) => {
      await pool.query(
        `INSERT INTO routes (id, name, owner, status, path)
         VALUES ($1, $1, $2, $3, ST_GeogFromText('SRID=4326;LINESTRING Z (-121 47 1000, -121.01 47.01 1010)'))`,
        [id, owner, status]
      );
    };
    try {
      await insertRoute(routeA, "peaks");
      await insertRoute(routeB, "peaks");
      await insertRoute(validRoute, "peaks", "active");
      await pool.query(
        `UPDATE routes SET gain = 10, gain_loss = 0 WHERE id = $1`,
        [validRoute]
      );
      await pool.query(
        `INSERT INTO segments (id, path, gain, gain_loss)
         VALUES (
           $1,
           ST_GeogFromText('SRID=4326;LINESTRING Z (-121 47 1000, -121.01 47.01 1010)'),
           10,
           0
         )`,
        [validSegment]
      );
      await pool.query(
        `INSERT INTO route_segments (route_id, segment_id, ordinal)
         VALUES ($1, $2, 0)`,
        [validRoute, validSegment]
      );
      await insertRoute(supersededRoute, "peaks", "superseded");
      await insertRoute(userRoute, "user-test");
      const dry = command("seed");
      assert.equal(dry.mode, "dry_run");
      assert.equal((await pool.query(`SELECT count(*)::int AS count FROM route_elevation_backfill_jobs`)).rows[0]?.count, 0);
      command("seed", "--apply");
      const seeded = await pool.query<{ route_id: string }>(`SELECT route_id FROM route_elevation_backfill_jobs ORDER BY route_id`);
      assert.deepEqual(seeded.rows.map((row) => row.route_id), [routeA, routeB].sort());

      const validFingerprint = await pool.query<{ path_fingerprint: string }>(
        `SELECT path_fingerprint
         FROM (${ELEVATION_ROUTE_FINGERPRINT_SQL}) fingerprint
         WHERE route_id = $1`,
        [validRoute]
      );
      await pool.query(
        `INSERT INTO route_elevation_backfill_jobs (
           route_id, state, path_fingerprint, source_kind, attempt_count
         ) VALUES ($1, 'complete', $2, 'existing_z', 4)`,
        [validRoute, validFingerprint.rows[0]!.path_fingerprint]
      );
      await pool.query(
        `UPDATE routes
         SET elevation_string = encode(convert_to('999|999', 'SQL_ASCII'), 'base64')
         WHERE id = $1`,
        [validRoute]
      );
      command("seed", "--apply");
      assert.deepEqual(
        (await pool.query(
          `SELECT state, attempt_count
           FROM route_elevation_backfill_jobs WHERE route_id = $1`,
          [validRoute]
        )).rows[0],
        { state: "queued", attempt_count: 0 },
        "an elevation_string-only break requeues a completed job"
      );
      await pool.query(
        `UPDATE routes SET path = path, gain = 10, gain_loss = 0 WHERE id = $1`,
        [validRoute]
      );
      const repairedFingerprint = await pool.query<{ path_fingerprint: string }>(
        `SELECT path_fingerprint
         FROM (${ELEVATION_ROUTE_FINGERPRINT_SQL}) fingerprint
         WHERE route_id = $1`,
        [validRoute]
      );
      await pool.query(
        `UPDATE route_elevation_backfill_jobs
         SET state = 'complete', path_fingerprint = $2
         WHERE route_id = $1`,
        [validRoute, repairedFingerprint.rows[0]!.path_fingerprint]
      );
      await pool.query(`UPDATE routes SET gain = 11 WHERE id = $1`, [validRoute]);
      command("seed", "--apply");
      assert.equal(
        (await pool.query(
          `SELECT state FROM route_elevation_backfill_jobs WHERE route_id = $1`,
          [validRoute]
        )).rows[0]?.state,
        "queued",
        "a stats-only break requeues a completed job"
      );
      await pool.query(
        `UPDATE routes SET path = path, gain = 10, gain_loss = 0 WHERE id = $1`,
        [validRoute]
      );
      const beforeSegmentDrift = await pool.query<{ path_fingerprint: string }>(
        `SELECT path_fingerprint
         FROM (${ELEVATION_ROUTE_FINGERPRINT_SQL}) fingerprint
         WHERE route_id = $1`,
        [validRoute]
      );
      await pool.query(
        `UPDATE route_elevation_backfill_jobs
         SET state = 'complete', path_fingerprint = $2
         WHERE route_id = $1`,
        [validRoute, beforeSegmentDrift.rows[0]!.path_fingerprint]
      );
      await pool.query(
        `UPDATE segments
         SET path = ST_GeogFromText(
           'SRID=4326;LINESTRING Z (-121 47 1000, -121.02 47.02 1020)'
         ),
         gain = 20
         WHERE id = $1`,
        [validSegment]
      );
      command("seed", "--apply");
      assert.equal(
        (await pool.query(
          `SELECT state FROM route_elevation_backfill_jobs WHERE route_id = $1`,
          [validRoute]
        )).rows[0]?.state,
        "queued",
        "segment-only drift requeues an existing complete job"
      );
      const driftSnapshot = async () => (
        await pool.query<{ snapshot: Record<string, unknown> }>(
          `SELECT jsonb_build_object(
             'route', jsonb_build_object(
               'path_hash', md5(encode(ST_AsEWKB(r.path::geometry), 'hex')),
               'elevation_string', r.elevation_string,
               'gain', r.gain,
               'gain_loss', r.gain_loss,
               'polyline6', r.polyline6,
               'geohashes', r.geohashes,
               'updated_at', r.updated_at
             ),
             'segment', jsonb_build_object(
               'path_hash', md5(encode(ST_AsEWKB(s.path::geometry), 'hex')),
               'gain', s.gain,
               'gain_loss', s.gain_loss,
               'polyline6', s.polyline6,
               'updated_at', s.updated_at
             )
           ) AS snapshot
           FROM routes r
           CROSS JOIN segments s
           WHERE r.id = $1 AND s.id = $2`,
          [validRoute, validSegment]
        )
      ).rows[0]!.snapshot;
      const beforeXyDriftBlock = await driftSnapshot();
      const drifted = command(
        "claim",
        "--worker-id",
        "luna-route-elevation-01",
        "--apply"
      ).job;
      assert.equal(drifted.route_id, validRoute);
      const driftOutcome = command(
        "process",
        "--route-id",
        drifted.route_id,
        "--lease-token",
        drifted.lease_token,
        "--apply"
      );
      assert.equal(driftOutcome.outcome, "blocked");
      assert.equal(
        driftOutcome.blocker,
        "segment_xy_drift_requires_route_factory"
      );
      assert.deepEqual(
        await driftSnapshot(),
        beforeXyDriftBlock,
        "XY drift blocks before route, segment, or cache mutation"
      );
      command("seed", "--apply");
      assert.equal(
        (await pool.query(
          `SELECT state FROM route_elevation_backfill_jobs WHERE route_id = $1`,
          [validRoute]
        )).rows[0]?.state,
        "blocked",
        "an unchanged blocked job remains manual"
      );
      await pool.query(
        `UPDATE segments
         SET path = ST_GeogFromText(
           'SRID=4326;LINESTRING Z (-121 47 1000, -121.01 47.01 1010)'
         ),
         gain = 10,
         gain_loss = 0
         WHERE id = $1`,
        [validSegment]
      );
      await pool.query(`UPDATE routes SET gain = 11 WHERE id = $1`, [validRoute]);
      assert.equal(
        (await pool.query(
          `SELECT count(*)::int AS count
           FROM (${ELEVATION_CANDIDATES_SQL}) candidates
           WHERE route_id = $1`,
          [validRoute]
        )).rows[0]?.count,
        1,
        "the repaired blocked route remains an elevation candidate"
      );
      command("seed", "--apply");
      const repairedBlocked = await pool.query<{
        state: string;
        attempt_count: number;
        last_error: string | null;
        final_evidence: Record<string, unknown> | null;
      }>(
        `SELECT state, attempt_count, last_error, final_evidence
         FROM route_elevation_backfill_jobs
         WHERE route_id = $1`,
        [validRoute]
      );
      assert.deepEqual(repairedBlocked.rows[0], {
        state: "queued",
        attempt_count: 0,
        last_error: null,
        final_evidence: null,
      });
      await pool.query(`UPDATE routes SET gain = 10 WHERE id = $1`, [validRoute]);
      const currentValidFingerprint = await pool.query<{
        path_fingerprint: string;
      }>(
        `SELECT path_fingerprint
         FROM (${ELEVATION_ROUTE_FINGERPRINT_SQL}) fingerprint
         WHERE route_id = $1`,
        [validRoute]
      );
      await pool.query(
        `UPDATE route_elevation_backfill_jobs
         SET state = 'complete', path_fingerprint = $2
         WHERE route_id = $1`,
        [validRoute, currentValidFingerprint.rows[0]!.path_fingerprint]
      );
      const first = command("claim", "--worker-id", "luna-route-elevation-01", "--apply").job;
      const second = command("claim", "--worker-id", "luna-route-elevation-01", "--apply").job;
      assert.equal(first.route_name, first.route_id);
      assert.equal(second.route_name, second.route_id);
      assert.notEqual(first.route_id, second.route_id);
      assert.notEqual(first.lease_token, second.lease_token);
      await pool.query(`UPDATE route_elevation_backfill_jobs SET lease_expires_at = now() - interval '1 minute' WHERE route_id = $1`, [first.route_id]);
      command("seed", "--apply");
      const seededExpired = await pool.query<{ state: string; lease_token: string | null }>(
        `SELECT state, lease_token FROM route_elevation_backfill_jobs WHERE route_id = $1`, [first.route_id]
      );
      assert.equal(seededExpired.rows[0]?.state, "retry");
      assert.equal(seededExpired.rows[0]?.lease_token, null);
      const recovered = command("claim", "--worker-id", "luna-route-elevation-01", "--apply").job;
      assert.equal(recovered.route_id, first.route_id);
      assert.notEqual(recovered.lease_token, first.lease_token);
      await pool.query(
        `UPDATE route_elevation_backfill_jobs
         SET attempt_count = 4,
             final_evidence = '{"stale":true}'::jsonb
         WHERE route_id = $1`,
        [recovered.route_id]
      );
      await pool.query(`UPDATE routes SET path = ST_GeogFromText('SRID=4326;LINESTRING Z (-121 47 1100, -121.01 47.01 1110)') WHERE id = $1`, [recovered.route_id]);
      const changed = command("process", "--route-id", recovered.route_id, "--lease-token", recovered.lease_token, "--apply");
      assert.equal(changed.outcome, "path_changed_requeued");
      const requeued = await pool.query<{
        state: string;
        lease_token: string | null;
        attempt_count: number;
        final_evidence: Record<string, unknown> | null;
      }>(
        `SELECT state, lease_token, attempt_count, final_evidence
         FROM route_elevation_backfill_jobs WHERE route_id = $1`,
        [recovered.route_id]
      );
      assert.equal(requeued.rows[0]?.state, "queued");
      assert.equal(requeued.rows[0]?.lease_token, null);
      assert.equal(requeued.rows[0]?.attempt_count, 0);
      assert.equal(requeued.rows[0]?.final_evidence, null);
      const stats = command("stats");
      assert.equal(typeof stats.expired_leases, "number");
    } finally {
      await pool.query(`DELETE FROM route_elevation_backfill_jobs WHERE route_id = ANY($1::text[])`, [[routeA, routeB, validRoute, supersededRoute, userRoute]]);
      await pool.query(`DELETE FROM route_segments WHERE route_id = $1`, [validRoute]);
      await pool.query(`DELETE FROM routes WHERE id = ANY($1::text[])`, [[routeA, routeB, validRoute, supersededRoute, userRoute]]);
      await pool.query(`DELETE FROM segments WHERE id = $1`, [validSegment]);
      await pool.end();
    }
  }
);

test("worker source clones user-shared segments and rebuilds route paths from ordered segments", async () => {
  const source = await readFile(join(MIGRATE_ROOT, "src/route-elevation-jobs.ts"), "utf8");
  assert.match(source, /user_route_reference_count/);
  assert.match(source, /route-elevation-clone-/);
  assert.match(
    source,
    /const segmentScopeIds = elevationSegmentScopeIds\(segments\)[\s\S]+?affectedPeaksRoutes\(db, segmentScopeIds\)/
  );
  assert.match(
    source,
    /WHERE segment_id = ANY\(\$1::text\[\]\)[\s\S]+?\[segmentScopeIds\]/
  );
  assert.match(
    source,
    /segment\.user_route_reference_count =[\s\S]+?segment\.user_route_reference_count > 0[\s\S]+?cloneUserSharedSegment/
  );
  assert.match(source, /INSERT INTO segments/);
  assert.match(source, /UPDATE route_segments[\s\S]+?SET segment_id =/);
  assert.match(source, /r\.owner = 'peaks'/);
  assert.match(source, /CASE rs\.direction[\s\S]+?WHEN 'reverse' THEN ST_Reverse/);
  assert.match(source, /row_number\(\) OVER \(ORDER BY rs\.ordinal, rs\.segment_id\) AS segment_sequence/);
  assert.match(source, /segment_sequence = 1 OR \(dumped\)\.path\[1\] > 1/);
  assert.doesNotMatch(source, /ordered_segments\.ordinal = 0 OR \(dumped\)\.path\[1\] > 1/);
  assert.match(source, /ST_MakeLine/);
  assert.match(source, /peaks_route_passes_publish_integrity/);
  assert.match(source, /state = 'blocked'/);
  assert.match(source, /terrain_source_endpoint/);
  assert.match(source, /terrain_data_license/);
  assert.match(source, /terrain_retrieved_at/);
  assert.match(source, /https:\/\/registry\.opendata\.aws\/terrain-tiles\//);
  assert.match(source, /docs\/attribution\.md/);
  assert.match(source, /ArcticDEM terrain data/);
  assert.match(source, /courtesy of the U\.S\. Geological Survey/);
  assert.match(source, /elevation_attribution =/);
  assert.match(source, /sourceAssemblyMatchesRouteXY\(db, route\.id\)/);
  assert.match(source, /sourceAssemblyMatchesRouteXY\(client, route\.id\)/);
  assert.match(source, /segment_xy_drift_requires_route_factory/);
  assert.match(source, /affected_route_ids: xyDriftRouteIds\.sort\(\)/);
  assert.match(source, /ST_Force2D\(r\.path::geometry\)/);
  assert.match(source, /sourceAssemblyPoints\(db, route\.id\)/);
  assert.match(source, /segmentNeedsTerrainSamplingAcrossRoutes\(/);
  assert.match(source, /consumersBySegment\.get\(segmentId\)/);
  assert.match(source, /completeProfile\(\s*segment\.points,\s*true\s*\)/);
  assert.match(source, /needsStatsRepair/);
  assert.match(source, /sourceKind: "existing_z"/);
  assert.match(source, /applySegmentProfile/);
  assert.match(source, /processLegacyRoute/);
  assert.match(source, /missing_route_segments_requires_route_factory/);
  assert.match(source, /verifyPersistedRoute\(\s*completeClient,\s*routeId\s*\)/);
  assert.match(source, /finalRouteEvidence\.publish_integrity_valid/);
  assert.doesNotMatch(source, /UPDATE routes SET path = rebuilt\.path[\s\S]+?\$2\[n\]/);
});

test(
  "processing rebuilds every Peaks route sharing a sampled segment, leaves user routes alone, and rolls back a bad sampler",
  { skip: TEST_DATABASE_URL ? false : "ROUTE_ELEVATION_JOB_TEST_DATABASE_URL not set" },
  async () => {
    const url = new URL(TEST_DATABASE_URL!);
    assert.match(url.pathname, /_test$/, "route elevation job tests require a disposable *_test database");
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const suffix = `${process.pid}-${Date.now()}`;
    const segmentId = `route-elevation-segment-${suffix}`;
    const sourceId = `aaa-route-elevation-source-${suffix}`;
    const peaksId = `bbb-route-elevation-shared-${suffix}`;
    const userId = `ccc-route-elevation-user-shared-${suffix}`;
    const cloneReuseId = `ccd-route-elevation-clone-reuse-${suffix}`;
    const legacyFlatId = `ddd-route-elevation-legacy-flat-${suffix}`;
    const legacyVariedId = `eee-route-elevation-legacy-varied-${suffix}`;
    const userLegacyId = `fff-route-elevation-user-legacy-${suffix}`;
    const badId = `zzz-route-elevation-bad-${suffix}`;
    const badSegmentId = `zzz-route-elevation-bad-segment-${suffix}`;
    let clonedSegmentId: string | null = null;
    const cacheDir = await mkdtemp(join(tmpdir(), "peaks-route-elevation-terrarium-test-"));
    const command = (...args: string[]) => {
      const result = spawnSync(join(MIGRATE_ROOT, "node_modules/.bin/tsx"), [join(MIGRATE_ROOT, "src/route-elevation-jobs.ts"), ...args], {
        cwd: MIGRATE_ROOT, encoding: "utf8", timeout: 30_000,
        env: { ...process.env, DB_HOST: url.hostname, DB_PORT: url.port || "5432", DB_NAME: url.pathname.slice(1), DB_USER: decodeURIComponent(url.username), DB_PASS: decodeURIComponent(url.password), PEAKS_TERRARIUM_CACHE_DIR: cacheDir },
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return JSON.parse(result.stdout.trim());
    };
    const line = "SRID=4326;LINESTRING Z (-121 47 1200, -121.0001 47.0001 1200)";
    try {
      await pool.query(`INSERT INTO segments (id, path) VALUES ($1, ST_GeogFromText($2))`, [segmentId, line]);
      for (const [id, owner] of [[sourceId, "peaks"], [peaksId, "peaks"], [userId, "user-test"]]) {
        await pool.query(`INSERT INTO routes (id, name, owner, status, path) VALUES ($1, $1, $2, 'pending', ST_GeogFromText($3))`, [id, owner, line]);
        await pool.query(`INSERT INTO route_segments (route_id, segment_id, ordinal) VALUES ($1, $2, 7)`, [id, segmentId]);
      }
      await pool.query(
        `UPDATE routes
         SET path = ST_GeogFromText(
           'SRID=4326;LINESTRING Z (-121 47 1200, -121.0002 47.0002 1200)'
         )
         WHERE id = $1`,
        [peaksId]
      );
      const sharedWriteSnapshot = async () => {
        const routes = await pool.query(
          `SELECT id,
                  md5(encode(ST_AsEWKB(path::geometry), 'hex')) AS path_hash,
                  elevation_string, gain, gain_loss, polyline6, geohashes,
                  elevation_source, elevation_source_url,
                  elevation_attribution, elevation_license_url,
                  elevation_retrieved_at, updated_at
           FROM routes
           WHERE id = ANY($1::text[])
           ORDER BY id`,
          [[sourceId, peaksId, userId]]
        );
        const segment = await pool.query(
          `SELECT md5(encode(ST_AsEWKB(path::geometry), 'hex')) AS path_hash,
                  gain, gain_loss, polyline6, updated_at
           FROM segments
           WHERE id = $1`,
          [segmentId]
        );
        return { routes: routes.rows, segment: segment.rows[0] };
      };
      const beforeSharedXyBlock = await sharedWriteSnapshot();
      command("seed", "--apply");
      const xyClaim = command(
        "claim",
        "--worker-id",
        "luna-route-elevation-01",
        "--apply"
      ).job;
      assert.equal(xyClaim.route_id, sourceId);
      const sharedXyBlocked = command(
        "process",
        "--route-id",
        xyClaim.route_id,
        "--lease-token",
        xyClaim.lease_token,
        "--apply"
      );
      assert.equal(sharedXyBlocked.outcome, "blocked");
      assert.equal(
        sharedXyBlocked.blocker,
        "segment_xy_drift_requires_route_factory"
      );
      assert.deepEqual(
        await sharedWriteSnapshot(),
        beforeSharedXyBlock,
        "an affected shared-route XY mismatch blocks every write"
      );
      assert.deepEqual(await readdir(cacheDir), [], "XY drift skips terrain sampling");
      const sharedXyEvidence = await pool.query<{
        final_evidence: { affected_route_ids?: string[] };
      }>(
        `SELECT final_evidence
         FROM route_elevation_backfill_jobs
         WHERE route_id = $1`,
        [sourceId]
      );
      assert.deepEqual(
        sharedXyEvidence.rows[0]?.final_evidence.affected_route_ids,
        [peaksId]
      );
      await pool.query(
        `UPDATE routes SET path = ST_GeogFromText($2) WHERE id = $1`,
        [peaksId, line]
      );
      await pool.query(
        `UPDATE route_elevation_backfill_jobs
         SET state = 'queued',
             attempt_count = 0,
             next_attempt_at = now(),
             last_error = NULL,
             final_evidence = NULL
         WHERE route_id = $1`,
        [sourceId]
      );
      await pool.query(
        `UPDATE route_elevation_backfill_jobs j
         SET state = 'complete',
             path_fingerprint = fingerprint.path_fingerprint,
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL
         FROM (${ELEVATION_ROUTE_FINGERPRINT_SQL}) fingerprint
         WHERE j.route_id = $1
           AND fingerprint.route_id = j.route_id`,
        [peaksId]
      );
      // A whole-tile, decoded cache avoids network I/O while still exercising the worker sampler path.
      const z = 14;
      const x = Math.floor(((-121 + 180) / 360) * 2 ** z);
      const latitude = 47 * Math.PI / 180;
      const y = Math.floor((1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2 * 2 ** z);
      const rgba = Buffer.alloc(256 * 256 * 4);
      for (let offset = 0; offset < rgba.length; offset += 4) { rgba[offset] = 128; rgba[offset + 1] = 1; rgba[offset + 3] = 255; }
      for (let pixel = 0; pixel < 256 * 256; pixel += 1) {
        rgba[pixel * 4 + 1] = pixel % 256;
        rgba[pixel * 4 + 2] = pixel % 251;
      }
      await mkdir(cacheDir, { recursive: true });
      await writeFile(join(cacheDir, `terrarium-z${z}-x${x}-y${y}.rgba`), rgba);
      const beforeSharedWrite = await pool.query<{
        segment_hash: string;
        user_hash: string;
        user_profile: string | null;
        user_gain: number | null;
        user_loss: number | null;
      }>(
        `SELECT
           md5(encode(ST_AsEWKB(s.path::geometry), 'hex')) AS segment_hash,
           md5(encode(ST_AsEWKB(r.path::geometry), 'hex')) AS user_hash,
           r.elevation_string AS user_profile,
           r.gain AS user_gain,
           r.gain_loss AS user_loss
         FROM segments s
         CROSS JOIN routes r
         WHERE s.id = $1 AND r.id = $2`,
        [segmentId, userId]
      );
      command("seed", "--apply");
      const claimed = command("claim", "--worker-id", "luna-route-elevation-01", "--apply").job;
      assert.equal(claimed.route_id, sourceId);
      const done = command("process", "--route-id", sourceId, "--lease-token", claimed.lease_token, "--apply");
      assert.equal(done.outcome, "complete");
      assert.equal(done.state, "complete");
      assert.equal(done.route_id, sourceId);
      assert.equal(done.route_name, sourceId);
      assert.equal(done.source_kind, "terrarium_z14");
      assert.equal(done.point_count, 2);
      assert.equal(done.verification, "public_not_applicable: pending");
      assert.match(done.profile_hash, /^[0-9a-f]{32}$/);
      const fractionalSegmentStats = await pool.query<{
        has_fractional_z: boolean;
        stats_valid: boolean;
      }>(
        `SELECT bool_or(
                  ST_Z((dumped).geom) <> trunc(ST_Z((dumped).geom))
                ) AS has_fractional_z,
                s.gain IS NOT DISTINCT FROM stats.gain
                  AND s.gain_loss IS NOT DISTINCT FROM stats.loss
                  AS stats_valid
         FROM route_segments rs
         JOIN segments s ON s.id = rs.segment_id
         CROSS JOIN LATERAL ST_DumpPoints(s.path::geometry) dumped
         CROSS JOIN LATERAL route_elevation_stats(s.path) stats
         WHERE rs.route_id = $1
         GROUP BY s.gain, s.gain_loss, stats.gain, stats.loss`,
        [sourceId]
      );
      assert.equal(
        fractionalSegmentStats.rows[0]?.has_fractional_z,
        true,
        "the process fixture must exercise fractional terrain samples"
      );
      assert.equal(fractionalSegmentStats.rows[0]?.stats_valid, true);
      const shown = command("show", "--route-id", sourceId);
      assert.equal(shown[0]?.route_name, sourceId);
      assert.deepEqual(shown[0]?.final_evidence, {
        source_kind: "terrarium_z14",
        point_count: 2,
        verification: "public_not_applicable: pending",
        profile_hash: done.profile_hash,
      });
      const fullEvidence = await pool.query<{ final_evidence: Record<string, unknown> }>(
        `SELECT final_evidence
         FROM route_elevation_backfill_jobs
         WHERE route_id = $1`,
        [sourceId]
      );
      assert.equal(
        fullEvidence.rows[0]?.final_evidence.terrain_source_endpoint,
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/{x}/{y}.png"
      );
      assert.equal(
        fullEvidence.rows[0]?.final_evidence.terrain_license_url,
        "https://github.com/tilezen/joerd/blob/master/docs/attribution.md"
      );
      assert.match(
        String(fullEvidence.rows[0]?.final_evidence.terrain_attribution),
        /ArcticDEM terrain data[\s\S]+courtesy of the U\.S\. Geological Survey/
      );
      clonedSegmentId = (await pool.query<{ segment_id: string }>(
        `SELECT segment_id
         FROM route_segments
         WHERE route_id = $1`,
        [sourceId]
      )).rows[0]!.segment_id;
      await pool.query(
        `UPDATE route_elevation_backfill_jobs j
         SET state = 'complete',
             path_fingerprint = fingerprint.path_fingerprint
         FROM (${ELEVATION_ROUTE_FINGERPRINT_SQL}) fingerprint
         WHERE j.route_id = $1
           AND fingerprint.route_id = j.route_id`,
        [peaksId]
      );
      await pool.query(
        `INSERT INTO routes (id, name, owner, status, path)
         VALUES ($1, $1, 'peaks', 'pending', ST_GeogFromText($2))`,
        [cloneReuseId, line]
      );
      await pool.query(
        `INSERT INTO route_segments (
           route_id, segment_id, ordinal
         ) VALUES ($1, $2, 7)`,
        [cloneReuseId, segmentId]
      );
      command("seed", "--apply");
      const cloneReuseClaim = command(
        "claim",
        "--worker-id",
        "luna-route-elevation-01",
        "--apply"
      ).job;
      assert.equal(cloneReuseClaim.route_id, cloneReuseId);
      const cloneReuseDone = command(
        "process",
        "--route-id",
        cloneReuseId,
        "--lease-token",
        cloneReuseClaim.lease_token,
        "--apply"
      );
      assert.equal(cloneReuseDone.outcome, "complete");
      const cloneReuseRows = await pool.query<{
        id: string;
        segment_id: string;
        profile_valid: boolean;
        stats_valid: boolean;
      }>(
        `SELECT r.id,
                rs.segment_id,
                r.elevation_string =
                  encode_route_elevation_profile(r.path) AS profile_valid,
                r.gain IS NOT DISTINCT FROM stats.gain
                  AND r.gain_loss IS NOT DISTINCT FROM stats.loss
                  AS stats_valid
         FROM routes r
         JOIN route_segments rs ON rs.route_id = r.id
         CROSS JOIN LATERAL route_elevation_stats(r.path) stats
         WHERE r.id = ANY($1::text[])
         ORDER BY r.id`,
        [[sourceId, peaksId, cloneReuseId]]
      );
      assert.equal(cloneReuseRows.rows.length, 3);
      assert.equal(
        cloneReuseRows.rows.every(
          (row) =>
            row.segment_id === clonedSegmentId &&
            row.profile_valid &&
            row.stats_valid
        ),
        true,
        "clone reuse rebuilds every old and new Peaks consumer"
      );
      const routeCredits = await pool.query<{
        id: string;
        elevation_source: string | null;
        elevation_source_url: string | null;
        elevation_attribution: string | null;
        elevation_license_url: string | null;
        elevation_retrieved_at: Date | null;
      }>(
        `SELECT id, elevation_source, elevation_source_url,
                elevation_attribution, elevation_license_url,
                elevation_retrieved_at
         FROM routes
         WHERE id = ANY($1::text[])
         ORDER BY id`,
        [[sourceId, peaksId, userId]]
      );
      for (const routeCredit of routeCredits.rows.filter(
        (row) => row.id !== userId
      )) {
        assert.match(routeCredit.elevation_source ?? "", /Terrarium/);
        assert.equal(
          routeCredit.elevation_source_url,
          "https://registry.opendata.aws/terrain-tiles/"
        );
        assert.match(routeCredit.elevation_attribution ?? "", /ArcticDEM/);
        assert.equal(
          routeCredit.elevation_license_url,
          "https://github.com/tilezen/joerd/blob/master/docs/attribution.md"
        );
        assert.ok(routeCredit.elevation_retrieved_at);
      }
      assert.equal(
        routeCredits.rows.find((row) => row.id === userId)?.elevation_source,
        null
      );
      assert.match(
        String(fullEvidence.rows[0]?.final_evidence.terrain_data_license),
        /source-specific license terms/i
      );
      assert.match(
        String(fullEvidence.rows[0]?.final_evidence.terrain_retrieved_at),
        /^\d{4}-\d{2}-\d{2}T/
      );
      const originalRetrievedAt = routeCredits.rows
        .find((row) => row.id === sourceId)!
        .elevation_retrieved_at!
        .toISOString();
      await pool.query(
        `UPDATE route_elevation_backfill_jobs j
         SET state = 'complete',
             path_fingerprint = fingerprint.path_fingerprint
         FROM (${ELEVATION_ROUTE_FINGERPRINT_SQL}) fingerprint
         WHERE j.route_id = $1
           AND fingerprint.route_id = j.route_id`,
        [peaksId]
      );
      await pool.query(
        `UPDATE route_elevation_backfill_jobs j
         SET state = 'retry',
             path_fingerprint = fingerprint.path_fingerprint,
             next_attempt_at = now(),
             last_error = 'simulated public verification failure'
         FROM (${ELEVATION_ROUTE_FINGERPRINT_SQL}) fingerprint
         WHERE j.route_id = $1
           AND fingerprint.route_id = j.route_id`,
        [sourceId]
      );
      const retryClaim = command(
        "claim",
        "--worker-id",
        "luna-route-elevation-01",
        "--apply"
      ).job;
      assert.equal(retryClaim.route_id, sourceId);
      const retried = command(
        "process",
        "--route-id",
        sourceId,
        "--lease-token",
        retryClaim.lease_token,
        "--apply"
      );
      assert.equal(retried.outcome, "complete");
      assert.equal(
        retried.source_kind,
        "terrarium_z14",
        "a no-fetch retry keeps the persisted terrain lineage"
      );
      const retryLineage = await pool.query<{
        elevation_retrieved_at: Date;
        final_evidence: Record<string, unknown>;
      }>(
        `SELECT r.elevation_retrieved_at, j.final_evidence
         FROM routes r
         JOIN route_elevation_backfill_jobs j ON j.route_id = r.id
         WHERE r.id = $1`,
        [sourceId]
      );
      assert.equal(
        retryLineage.rows[0]!.elevation_retrieved_at.toISOString(),
        originalRetrievedAt
      );
      assert.equal(
        retryLineage.rows[0]!.final_evidence.source_kind,
        "terrarium_z14"
      );
      assert.equal(
        new Date(
          String(
            retryLineage.rows[0]!.final_evidence.terrain_retrieved_at
          )
        ).toISOString(),
        originalRetrievedAt
      );
      const rows = await pool.query<{ id: string; profile: string | null; points: number; minimum_z: number }>(
        `SELECT id, elevation_string AS profile, ST_NPoints(path::geometry)::int AS points,
                (SELECT min(ST_Z((dumped).geom)) FROM ST_DumpPoints(routes.path::geometry) dumped) AS minimum_z
         FROM routes WHERE id = ANY($1::text[]) ORDER BY id`, [[sourceId, peaksId, userId]]
      );
      const byId = new Map(rows.rows.map((row) => [row.id, row]));
      assert.equal(byId.get(sourceId)?.points, 2);
      assert.equal(byId.get(peaksId)?.points, 2);
      assert.match(byId.get(sourceId)?.profile ?? "", /./);
      assert.match(byId.get(peaksId)?.profile ?? "", /./);
      assert.equal(byId.get(userId)?.profile, null);
      assert.equal(byId.get(userId)?.minimum_z, 1200);
      const linkRows = await pool.query<{ route_id: string; segment_id: string }>(
        `SELECT route_id, segment_id
         FROM route_segments
         WHERE route_id = ANY($1::text[])
         ORDER BY route_id`,
        [[sourceId, peaksId, userId]]
      );
      assert.equal(
        linkRows.rows.find((row) => row.route_id === userId)?.segment_id,
        segmentId
      );
      const peaksSegmentIds = new Set(
        linkRows.rows
          .filter((row) => row.route_id !== userId)
          .map((row) => row.segment_id)
      );
      assert.equal(peaksSegmentIds.size, 1);
      clonedSegmentId = [...peaksSegmentIds][0] ?? null;
      assert.notEqual(clonedSegmentId, segmentId);
      const markSharedPeerComplete = () => pool.query(
        `UPDATE route_elevation_backfill_jobs j
         SET state = 'complete',
             path_fingerprint = fingerprint.path_fingerprint
         FROM (${ELEVATION_ROUTE_FINGERPRINT_SQL}) fingerprint
         WHERE j.route_id = ANY($1::text[])
           AND fingerprint.route_id = j.route_id`,
        [[peaksId, cloneReuseId]]
      );
      await pool.query(
        `UPDATE segments SET gain = gain + 5 WHERE id = $1`,
        [clonedSegmentId]
      );
      command("seed", "--apply");
      const segmentStatsClaim = command(
        "claim",
        "--worker-id",
        "luna-route-elevation-01",
        "--apply"
      ).job;
      assert.equal(segmentStatsClaim.route_id, sourceId);
      command(
        "process",
        "--route-id",
        sourceId,
        "--lease-token",
        segmentStatsClaim.lease_token,
        "--apply"
      );
      assert.equal(
        (await pool.query<{ valid: boolean }>(
          `SELECT s.gain IS NOT DISTINCT FROM stats.gain
             AND s.gain_loss IS NOT DISTINCT FROM stats.loss AS valid
           FROM segments s
           CROSS JOIN LATERAL route_elevation_stats(s.path) stats
           WHERE s.id = $1`,
          [clonedSegmentId]
        )).rows[0]?.valid,
        true,
        "correct route plus wrong segment stats repairs from existing Z"
      );
      await markSharedPeerComplete();
      await pool.query(
        `UPDATE segments SET gain = gain + 3 WHERE id = $1`,
        [clonedSegmentId]
      );
      await pool.query(
        `UPDATE routes SET gain = gain + 2 WHERE id = $1`,
        [sourceId]
      );
      command("seed", "--apply");
      const allStatsClaim = command(
        "claim",
        "--worker-id",
        "luna-route-elevation-01",
        "--apply"
      ).job;
      assert.equal(allStatsClaim.route_id, sourceId);
      command(
        "process",
        "--route-id",
        sourceId,
        "--lease-token",
        allStatsClaim.lease_token,
        "--apply"
      );
      assert.equal(
        (await pool.query<{ valid: boolean }>(
          `SELECT s.gain IS NOT DISTINCT FROM segment_stats.gain
             AND s.gain_loss IS NOT DISTINCT FROM segment_stats.loss
             AND r.gain IS NOT DISTINCT FROM route_stats.gain
             AND r.gain_loss IS NOT DISTINCT FROM route_stats.loss AS valid
           FROM segments s
           CROSS JOIN routes r
           CROSS JOIN LATERAL route_elevation_stats(s.path) segment_stats
           CROSS JOIN LATERAL route_elevation_stats(r.path) route_stats
           WHERE s.id = $1 AND r.id = $2`,
          [clonedSegmentId, sourceId]
        )).rows[0]?.valid,
        true,
        "wrong route and segment stats repair together"
      );
      await markSharedPeerComplete();
      const afterSharedWrite = await pool.query<{
        segment_hash: string;
        user_hash: string;
        user_profile: string | null;
        user_gain: number | null;
        user_loss: number | null;
      }>(
        `SELECT
           md5(encode(ST_AsEWKB(s.path::geometry), 'hex')) AS segment_hash,
           md5(encode(ST_AsEWKB(r.path::geometry), 'hex')) AS user_hash,
           r.elevation_string AS user_profile,
           r.gain AS user_gain,
           r.gain_loss AS user_loss
         FROM segments s
         CROSS JOIN routes r
         WHERE s.id = $1 AND r.id = $2`,
        [segmentId, userId]
      );
      assert.deepEqual(afterSharedWrite.rows[0], beforeSharedWrite.rows[0]);
      const legacyFlatLine =
        "SRID=4326;LINESTRING Z (-121 47 1200, -121.0001 47.0001 1200)";
      const legacyVariedLine =
        "SRID=4326;LINESTRING Z (-121 47 1200, -121.0001 47.0001 1260)";
      await pool.query(
        `INSERT INTO routes (id, name, owner, status, path)
         VALUES
           ($1, $1, 'peaks', 'pending', ST_GeogFromText($4)),
           ($2, $2, 'peaks', 'pending', ST_GeogFromText($5)),
           ($3, $3, 'user-test', 'pending', ST_GeogFromText($4))`,
        [
          legacyFlatId,
          legacyVariedId,
          userLegacyId,
          legacyFlatLine,
          legacyVariedLine,
        ]
      );
      await pool.query(
        `UPDATE routes
         SET elevation_string = NULL,
             gain = NULL,
             gain_loss = NULL
         WHERE id = ANY($1::text[])`,
        [[legacyFlatId, legacyVariedId, userLegacyId]]
      );
      const legacyBefore = await pool.query<{
        id: string;
        status: string;
        xy_hash: string;
      }>(
        `SELECT id, status,
                md5(encode(
                  ST_AsEWKB(ST_Force2D(path::geometry)),
                  'hex'
                )) AS xy_hash
         FROM routes
         WHERE id = ANY($1::text[])
         ORDER BY id`,
        [[legacyFlatId, legacyVariedId, userLegacyId]]
      );
      command("seed", "--apply");
      const legacyFlatClaim = command(
        "claim",
        "--worker-id",
        "luna-route-elevation-01",
        "--apply"
      ).job;
      assert.equal(legacyFlatClaim.route_id, legacyFlatId);
      const legacyFlatBlocked = command(
        "process",
        "--route-id",
        legacyFlatId,
        "--lease-token",
        legacyFlatClaim.lease_token,
        "--apply"
      );
      assert.equal(legacyFlatBlocked.outcome, "blocked");
      assert.equal(
        legacyFlatBlocked.blocker,
        "missing_route_segments_requires_route_factory"
      );
      const legacyVariedClaim = command(
        "claim",
        "--worker-id",
        "luna-route-elevation-01",
        "--apply"
      ).job;
      assert.equal(legacyVariedClaim.route_id, legacyVariedId);
      const legacyVariedBlocked = command(
        "process",
        "--route-id",
        legacyVariedId,
        "--lease-token",
        legacyVariedClaim.lease_token,
        "--apply"
      );
      assert.equal(legacyVariedBlocked.outcome, "blocked");
      assert.equal(
        legacyVariedBlocked.blocker,
        "missing_route_segments_requires_route_factory"
      );
      const legacyAfter = await pool.query<{
        id: string;
        status: string;
        xy_hash: string;
        canonical: boolean;
        stats_valid: boolean;
        has_range: boolean;
        has_fractional_z: boolean;
        elevation_source: string | null;
      }>(
        `SELECT r.id,
                r.status,
                md5(encode(
                  ST_AsEWKB(ST_Force2D(r.path::geometry)),
                  'hex'
                )) AS xy_hash,
                r.elevation_string =
                  encode_route_elevation_profile(r.path) AS canonical,
                r.gain IS NOT DISTINCT FROM stats.gain
                  AND r.gain_loss IS NOT DISTINCT FROM stats.loss
                  AS stats_valid,
                route_elevation_profile_has_real_range(r.path)
                  AS has_range,
                EXISTS (
                  SELECT 1
                  FROM ST_DumpPoints(r.path::geometry) dumped
                  WHERE ST_Z((dumped).geom) <>
                    trunc(ST_Z((dumped).geom))
                ) AS has_fractional_z,
                r.elevation_source
         FROM routes r
         CROSS JOIN LATERAL route_elevation_stats(r.path) stats
         WHERE r.id = ANY($1::text[])
         ORDER BY r.id`,
        [[legacyFlatId, legacyVariedId]]
      );
      assert.deepEqual(
        legacyAfter.rows.map(({ id, status, xy_hash }) => ({
          id,
          status,
          xy_hash,
        })),
        legacyBefore.rows
          .filter((row) => row.id !== userLegacyId)
      );
      assert.equal(
        legacyAfter.rows.every(
          (row) => row.canonical && row.stats_valid && row.has_range
        ),
        true
      );
      assert.match(
        legacyAfter.rows.find((row) => row.id === legacyFlatId)
          ?.elevation_source ?? "",
        /Terrarium/
      );
      assert.equal(
        legacyAfter.rows.find((row) => row.id === legacyFlatId)
          ?.has_fractional_z,
        true,
        "legacy processing must persist fractional terrain samples"
      );
      assert.equal(
        legacyAfter.rows.find((row) => row.id === legacyVariedId)
          ?.elevation_source,
        null,
        "varied legacy Z repairs without AWS"
      );
      assert.equal(
        (await pool.query(
          `SELECT count(*)::int AS count
           FROM route_elevation_backfill_jobs
           WHERE route_id = $1`,
          [userLegacyId]
        )).rows[0]?.count,
        0,
        "user legacy routes remain out of scope"
      );
      await pool.query(`DELETE FROM route_elevation_backfill_jobs WHERE route_id = $1`, [peaksId]);
      await pool.query(
        `INSERT INTO segments (id, path)
         VALUES ($1, ST_GeogFromText('SRID=4326;LINESTRING Z (-122 46 0, -122.0001 46.0001 0)'))`,
        [badSegmentId]
      );
      await pool.query(`INSERT INTO routes (id, owner, status, path) VALUES ($1, 'peaks', 'pending', ST_GeogFromText('SRID=4326;LINESTRING Z (-122 46 0, -122.0001 46.0001 0)'))`, [badId]);
      await pool.query(
        `INSERT INTO route_segments (route_id, segment_id, ordinal)
         VALUES ($1, $2, 7)`,
        [badId, badSegmentId]
      );
      command("seed", "--apply");
      const badClaim = command("claim", "--worker-id", "luna-route-elevation-01", "--apply").job;
      assert.equal(badClaim.route_id, badId);
      const beforeFailure = await pool.query<{ path_hash: string; profile: string | null }>(
        `SELECT md5(encode(ST_AsEWKB(path::geometry), 'hex')) AS path_hash, elevation_string AS profile FROM routes WHERE id = $1`, [badId]
      );
      process.env.PEAKS_TERRARIUM_TEST_RESPONSE = "404";
      command("process", "--route-id", badId, "--lease-token", badClaim.lease_token, "--apply");
      delete process.env.PEAKS_TERRARIUM_TEST_RESPONSE;
      const bad = await pool.query<{ state: string; minimum_z: number }>(
        `SELECT j.state, (SELECT min(ST_Z((dumped).geom)) FROM ST_DumpPoints(r.path::geometry) dumped) AS minimum_z
         FROM route_elevation_backfill_jobs j JOIN routes r ON r.id = j.route_id WHERE j.route_id = $1`, [badId]
      );
      assert.equal(bad.rows[0]?.state, "retry");
      assert.equal(bad.rows[0]?.minimum_z, 0);
      const afterFailure = await pool.query<{ path_hash: string; profile: string | null }>(
        `SELECT md5(encode(ST_AsEWKB(path::geometry), 'hex')) AS path_hash, elevation_string AS profile FROM routes WHERE id = $1`, [badId]
      );
      assert.deepEqual(afterFailure.rows[0], beforeFailure.rows[0]);
    } finally {
      delete process.env.PEAKS_TERRARIUM_TEST_RESPONSE;
      await pool.query(`DELETE FROM route_elevation_backfill_jobs WHERE route_id = ANY($1::text[])`, [[sourceId, peaksId, userId, cloneReuseId, legacyFlatId, legacyVariedId, userLegacyId, badId]]);
      await pool.query(`DELETE FROM route_segments WHERE route_id = ANY($1::text[])`, [[sourceId, peaksId, userId, cloneReuseId, legacyFlatId, legacyVariedId, userLegacyId, badId]]);
      await pool.query(`DELETE FROM routes WHERE id = ANY($1::text[])`, [[sourceId, peaksId, userId, cloneReuseId, legacyFlatId, legacyVariedId, userLegacyId, badId]]);
      await pool.query(
        `DELETE FROM segments WHERE id = ANY($1::text[])`,
        [[segmentId, badSegmentId, clonedSegmentId].filter(Boolean)]
      );
      await pool.end();
      await rm(cacheDir, { recursive: true, force: true });
    }
  }
);
