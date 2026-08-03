import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";
import {
  ELEVATION_CANDIDATES_SQL,
  ELEVATION_ROUTE_FINGERPRINT_SQL,
  compactJob,
  equalRouteIdSets,
  processCompletionOutput,
  publicElevationEvidenceMatches,
  requireWorkerId,
  retryOutcome,
  statsOutput,
  validateArgs,
} from "../route-elevation-jobs";

const TEST_DATABASE_URL = process.env.ROUTE_ELEVATION_JOB_TEST_DATABASE_URL;
const MIGRATE_ROOT = join(__dirname, "../..");
const MIGRATION = join(MIGRATE_ROOT, "../migrations/20260803_route_elevation_backfill.sql");

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

test("public elevation evidence requires exact profile bytes and stats", () => {
  const expected = {
    id: "route-a",
    status: "active",
    point_count: 2,
    elevation_string: "MTAwMHwxMDEw",
    profile_hash: "profile-hash",
    gain: 10,
    gain_loss: 0,
    publish_integrity_valid: true,
  };
  const matching = {
    elevation_string: expected.elevation_string,
    profile_count: 2,
    profile_hash: expected.profile_hash,
    gain: 10,
    gain_loss: 0,
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
});

test("elevation seed is fault-only and fingerprints every derived cache input", () => {
  assert.match(ELEVATION_CANDIDATES_SQL, /r\.status IN \('active', 'pending'\)/);
  assert.match(ELEVATION_CANDIDATES_SQL, /r\.elevation_string IS DISTINCT FROM\s+encode_route_elevation_profile\(r\.path\)/);
  assert.match(ELEVATION_CANDIDATES_SQL, /NOT route_elevation_profile_has_real_range\(r\.path\)/);
  assert.match(ELEVATION_CANDIDATES_SQL, /r\.gain IS DISTINCT FROM/);
  assert.match(ELEVATION_CANDIDATES_SQL, /r\.gain_loss IS DISTINCT FROM/);
  assert.match(ELEVATION_CANDIDATES_SQL, /segment_needs_elevation/);
  assert.match(ELEVATION_CANDIDATES_SQL, /COALESCE\(r\.elevation_string/);
  assert.match(ELEVATION_CANDIDATES_SQL, /COALESCE\(r\.gain::text/);
  assert.match(ELEVATION_CANDIDATES_SQL, /COALESCE\(r\.gain_loss::text/);
  assert.match(ELEVATION_CANDIDATES_SQL, /rs\.direction/);
  assert.match(ELEVATION_CANDIDATES_SQL, /COALESCE\(encode_route_elevation_profile\(s\.path\)/);
  assert.doesNotMatch(ELEVATION_CANDIDATES_SQL, /status = 'superseded'/);
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
      await pool.query(await readFile(MIGRATION, "utf8"));
      await insertRoute(routeA, "peaks");
      await insertRoute(routeB, "peaks");
      await insertRoute(validRoute, "peaks", "active");
      await pool.query(
        `UPDATE routes SET gain = 10, gain_loss = 0 WHERE id = $1`,
        [validRoute]
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
           route_id, state, path_fingerprint, source_kind
         ) VALUES ($1, 'complete', $2, 'existing_z')`,
        [validRoute, validFingerprint.rows[0]!.path_fingerprint]
      );
      await pool.query(
        `UPDATE routes
         SET elevation_string = encode(convert_to('999|999', 'SQL_ASCII'), 'base64')
         WHERE id = $1`,
        [validRoute]
      );
      command("seed", "--apply");
      assert.equal(
        (await pool.query(
          `SELECT state FROM route_elevation_backfill_jobs WHERE route_id = $1`,
          [validRoute]
        )).rows[0]?.state,
        "queued",
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
      await pool.query(`UPDATE routes SET path = ST_GeogFromText('SRID=4326;LINESTRING Z (-121 47 1100, -121.01 47.01 1110)') WHERE id = $1`, [recovered.route_id]);
      const changed = command("process", "--route-id", recovered.route_id, "--lease-token", recovered.lease_token, "--apply");
      assert.equal(changed.outcome, "path_changed_requeued");
      const requeued = await pool.query<{ state: string; lease_token: string | null }>(`SELECT state, lease_token FROM route_elevation_backfill_jobs WHERE route_id = $1`, [recovered.route_id]);
      assert.equal(requeued.rows[0]?.state, "queued");
      assert.equal(requeued.rows[0]?.lease_token, null);
      const stats = command("stats");
      assert.equal(typeof stats.expired_leases, "number");
    } finally {
      await pool.query(`DELETE FROM route_elevation_backfill_jobs WHERE route_id = ANY($1::text[])`, [[routeA, routeB, validRoute, supersededRoute, userRoute]]);
      await pool.query(`DELETE FROM routes WHERE id = ANY($1::text[])`, [[routeA, routeB, validRoute, supersededRoute, userRoute]]);
      await pool.end();
    }
  }
);

test("worker source clones user-shared segments and rebuilds route paths from ordered segments", async () => {
  const source = await readFile(join(MIGRATE_ROOT, "src/route-elevation-jobs.ts"), "utf8");
  assert.match(source, /user_route_reference_count/);
  assert.match(source, /route-elevation-clone-/);
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
    const line = "SRID=4326;LINESTRING Z (-121 47 0, -121.0001 47.0001 0)";
    try {
      await pool.query(await readFile(MIGRATION, "utf8"));
      await pool.query(`INSERT INTO segments (id, path) VALUES ($1, ST_GeogFromText($2))`, [segmentId, line]);
      for (const [id, owner] of [[sourceId, "peaks"], [peaksId, "peaks"], [userId, "user-test"]]) {
        await pool.query(`INSERT INTO routes (id, name, owner, status, path) VALUES ($1, $1, $2, 'pending', ST_GeogFromText($3))`, [id, owner, line]);
        await pool.query(`INSERT INTO route_segments (route_id, segment_id, ordinal) VALUES ($1, $2, 7)`, [id, segmentId]);
      }
      // A whole-tile, decoded cache avoids network I/O while still exercising the worker sampler path.
      const z = 14;
      const x = Math.floor(((-121 + 180) / 360) * 2 ** z);
      const latitude = 47 * Math.PI / 180;
      const y = Math.floor((1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2 * 2 ** z);
      const rgba = Buffer.alloc(256 * 256 * 4);
      for (let offset = 0; offset < rgba.length; offset += 4) { rgba[offset] = 128; rgba[offset + 1] = 1; rgba[offset + 3] = 255; }
      for (let pixel = 0; pixel < 256 * 256; pixel += 1) {
        rgba[pixel * 4 + 1] = pixel % 256;
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
      assert.match(
        String(fullEvidence.rows[0]?.final_evidence.terrain_data_license),
        /open data licenses/i
      );
      assert.match(
        String(fullEvidence.rows[0]?.final_evidence.terrain_retrieved_at),
        /^\d{4}-\d{2}-\d{2}T/
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
      assert.equal(byId.get(userId)?.minimum_z, 0);
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
      await pool.query(`DELETE FROM route_elevation_backfill_jobs WHERE route_id = ANY($1::text[])`, [[sourceId, peaksId, userId, badId]]);
      await pool.query(`DELETE FROM route_segments WHERE route_id = ANY($1::text[])`, [[sourceId, peaksId, userId, badId]]);
      await pool.query(`DELETE FROM routes WHERE id = ANY($1::text[])`, [[sourceId, peaksId, userId, badId]]);
      await pool.query(
        `DELETE FROM segments WHERE id = ANY($1::text[])`,
        [[segmentId, badSegmentId, clonedSegmentId].filter(Boolean)]
      );
      await pool.end();
      await rm(cacheDir, { recursive: true, force: true });
    }
  }
);
