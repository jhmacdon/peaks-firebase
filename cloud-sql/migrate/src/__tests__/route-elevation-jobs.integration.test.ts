import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";
import {
  equalRouteIdSets,
  requireWorkerId,
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
    const insertRoute = async (id: string, owner: string) => {
      await pool.query(
        `INSERT INTO routes (id, name, owner, status, path)
         VALUES ($1, $1, $2, 'pending', ST_GeogFromText('SRID=4326;LINESTRING Z (-121 47 1000, -121.01 47.01 1010)'))`,
        [id, owner]
      );
    };
    try {
      await pool.query(await readFile(MIGRATION, "utf8"));
      await insertRoute(routeA, "peaks");
      await insertRoute(routeB, "peaks");
      await insertRoute(userRoute, "user-test");
      const dry = command("seed");
      assert.equal(dry.mode, "dry_run");
      assert.equal((await pool.query(`SELECT count(*)::int AS count FROM route_elevation_backfill_jobs`)).rows[0]?.count, 0);
      command("seed", "--apply");
      const seeded = await pool.query<{ route_id: string }>(`SELECT route_id FROM route_elevation_backfill_jobs ORDER BY route_id`);
      assert.deepEqual(seeded.rows.map((row) => row.route_id), [routeA, routeB].sort());
      const first = command("claim", "--worker-id", "luna-route-elevation-01", "--apply").job;
      const second = command("claim", "--worker-id", "luna-route-elevation-01", "--apply").job;
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
    } finally {
      await pool.query(`DELETE FROM route_elevation_backfill_jobs WHERE route_id = ANY($1::text[])`, [[routeA, routeB, userRoute]]);
      await pool.query(`DELETE FROM routes WHERE id = ANY($1::text[])`, [[routeA, routeB, userRoute]]);
      await pool.end();
    }
  }
);

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
        await pool.query(`INSERT INTO routes (id, owner, status, path) VALUES ($1, $2, 'pending', ST_GeogFromText($3))`, [id, owner, line]);
        await pool.query(`INSERT INTO route_segments (route_id, segment_id, ordinal) VALUES ($1, $2, 0)`, [id, segmentId]);
      }
      // A whole-tile, decoded cache avoids network I/O while still exercising the worker sampler path.
      const z = 14;
      const x = Math.floor(((-121 + 180) / 360) * 2 ** z);
      const latitude = 47 * Math.PI / 180;
      const y = Math.floor((1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2 * 2 ** z);
      const rgba = Buffer.alloc(256 * 256 * 4);
      for (let offset = 0; offset < rgba.length; offset += 4) { rgba[offset] = 128; rgba[offset + 1] = 1; rgba[offset + 3] = 255; }
      await mkdir(cacheDir, { recursive: true });
      await writeFile(join(cacheDir, `terrarium-z${z}-x${x}-y${y}.rgba`), rgba);
      command("seed", "--apply");
      const claimed = command("claim", "--worker-id", "luna-route-elevation-01", "--apply").job;
      assert.equal(claimed.route_id, sourceId);
      const done = command("process", "--route-id", sourceId, "--lease-token", claimed.lease_token, "--apply");
      assert.equal(done.outcome, "complete");
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
      await pool.query(`DELETE FROM route_elevation_backfill_jobs WHERE route_id = $1`, [peaksId]);
      await pool.query(`INSERT INTO routes (id, owner, status, path) VALUES ($1, 'peaks', 'pending', ST_GeogFromText('SRID=4326;LINESTRING Z (-122 46 0, -122.0001 46.0001 0)'))`, [badId]);
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
      await pool.query(`DELETE FROM segments WHERE id = $1`, [segmentId]);
      await pool.end();
      await rm(cacheDir, { recursive: true, force: true });
    }
  }
);
