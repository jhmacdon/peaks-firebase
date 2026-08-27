import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";

const TEST_DATABASE_URL = process.env.ROUTE_JOB_TEST_DATABASE_URL;
const MIGRATE_ROOT = join(__dirname, "../..");

test(
  "human requeue stores its reason and returns a pending route to review",
  { skip: TEST_DATABASE_URL ? false : "ROUTE_JOB_TEST_DATABASE_URL not set" },
  async () => {
    const databaseUrl = new URL(TEST_DATABASE_URL!);
    assert.match(
      databaseUrl.pathname,
      /_test$/,
      "route job integration tests require a disposable *_test database"
    );

    const suffix = `${process.pid}-${Date.now()}`;
    const destinationId = `route-requeue-destination-${suffix}`;
    const routeId = `route-requeue-route-${suffix}`;
    const reason = "Confirmed checker repair against the unchanged pending route";
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });

    try {
      await pool.query(
        `INSERT INTO destinations (id, name, search_name, features)
         VALUES ($1, 'Route requeue test summit', 'route requeue test summit',
                 ARRAY['summit']::destination_feature[])`,
        [destinationId]
      );
      await pool.query(
        `INSERT INTO routes (id, name, owner, status)
         VALUES ($1, 'Route requeue test route', 'peaks', 'pending')`,
        [routeId]
      );
      await pool.query(
        `INSERT INTO standard_route_backfill_jobs (
           destination_id, state, published_route_id
         )
         VALUES ($1, 'needs_revision', $2)`,
        [destinationId, routeId]
      );

      const result = spawnSync(
        join(MIGRATE_ROOT, "node_modules/.bin/tsx"),
        [
          join(MIGRATE_ROOT, "src/standard-route-jobs.ts"),
          "requeue",
          "--destination-id",
          destinationId,
          "--from",
          "needs_revision",
          "--reason",
          reason,
          "--acknowledge-human-review",
          "--apply",
        ],
        {
          cwd: MIGRATE_ROOT,
          encoding: "utf8",
          timeout: 15_000,
          env: {
            ...process.env,
            DB_HOST: databaseUrl.hostname,
            DB_PORT: databaseUrl.port || "5432",
            DB_NAME: databaseUrl.pathname.slice(1),
            DB_USER: decodeURIComponent(databaseUrl.username),
            DB_PASS: decodeURIComponent(databaseUrl.password),
            PEAKS_ALLOW_ROUTE_REQUEUE: "1",
          },
        }
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const saved = await pool.query<{
        state: string;
        evidence: { requeue_reason?: string };
      }>(
        `SELECT state, evidence
         FROM standard_route_backfill_jobs
         WHERE destination_id = $1`,
        [destinationId]
      );
      assert.equal(saved.rows[0]?.state, "pending_review");
      assert.equal(saved.rows[0]?.evidence.requeue_reason, reason);
    } finally {
      await pool.query(
        `DELETE FROM standard_route_backfill_jobs WHERE destination_id = $1`,
        [destinationId]
      );
      await pool.query(`DELETE FROM routes WHERE id = $1`, [routeId]);
      await pool.query(`DELETE FROM destinations WHERE id = $1`, [
        destinationId,
      ]);
      await pool.end();
    }
  }
);

test(
  "human requeue can discard one stale superseded route and restart research",
  { skip: TEST_DATABASE_URL ? false : "ROUTE_JOB_TEST_DATABASE_URL not set" },
  async () => {
    const databaseUrl = new URL(TEST_DATABASE_URL!);
    assert.match(
      databaseUrl.pathname,
      /_test$/,
      "route job integration tests require a disposable *_test database"
    );

    const suffix = `${process.pid}-${Date.now()}-stale`;
    const destinationId = `route-requeue-destination-${suffix}`;
    const trailheadId = `route-requeue-trailhead-${suffix}`;
    const routeId = `route-requeue-route-${suffix}`;
    const reason = "Human selected a different standard route after map review";
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });

    try {
      await pool.query(
        `INSERT INTO destinations (id, name, search_name, features)
         VALUES
           ($1, 'Stale route test summit', 'stale route test summit',
            ARRAY['summit']::destination_feature[]),
           ($2, 'Stale route test trailhead', 'stale route test trailhead',
            ARRAY['trailhead']::destination_feature[])`,
        [destinationId, trailheadId]
      );
      await pool.query(
        `INSERT INTO routes (id, name, owner, status)
         VALUES ($1, 'Rejected short route', 'peaks', 'superseded')`,
        [routeId]
      );
      await pool.query(
        `INSERT INTO standard_route_backfill_jobs (
           destination_id, state, candidate, review, trailhead_id,
           candidate_path, candidate_sha256, candidate_artifact,
           published_route_id, replacement_route_id, blocker_code
         )
         VALUES (
           $1, 'needs_human', '{"route_name":"Rejected short route"}',
           '{"verdict":"FAIL"}', $2, '/tmp/rejected.geojson', $3,
           '{"type":"FeatureCollection"}', $4, $4,
           'stale_replacement_route'
         )`,
        [destinationId, trailheadId, "a".repeat(64), routeId]
      );

      const result = spawnSync(
        join(MIGRATE_ROOT, "node_modules/.bin/tsx"),
        [
          join(MIGRATE_ROOT, "src/standard-route-jobs.ts"),
          "requeue",
          "--destination-id",
          destinationId,
          "--from",
          "needs_human",
          "--reason",
          reason,
          "--discard-superseded-route",
          "--acknowledge-human-review",
          "--apply",
        ],
        {
          cwd: MIGRATE_ROOT,
          encoding: "utf8",
          timeout: 15_000,
          env: {
            ...process.env,
            DB_HOST: databaseUrl.hostname,
            DB_PORT: databaseUrl.port || "5432",
            DB_NAME: databaseUrl.pathname.slice(1),
            DB_USER: decodeURIComponent(databaseUrl.username),
            DB_PASS: decodeURIComponent(databaseUrl.password),
            PEAKS_ALLOW_ROUTE_REQUEUE: "1",
          },
        }
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const saved = await pool.query<{
        state: string;
        evidence: {
          requeue_reason?: string;
          discarded_superseded_route_id?: string;
        };
        candidate: Record<string, unknown>;
        review: Record<string, unknown>;
        trailhead_id: string | null;
        candidate_path: string | null;
        candidate_sha256: string | null;
        candidate_artifact: unknown;
        published_route_id: string | null;
        replacement_route_id: string | null;
        blocker_code: string | null;
      }>(
        `SELECT state, evidence, candidate, review, trailhead_id,
                candidate_path, candidate_sha256, candidate_artifact,
                published_route_id, replacement_route_id, blocker_code
         FROM standard_route_backfill_jobs
         WHERE destination_id = $1`,
        [destinationId]
      );
      assert.deepEqual(saved.rows[0], {
        state: "queued",
        evidence: {
          requeue_reason: reason,
          discarded_superseded_route_id: routeId,
        },
        candidate: {},
        review: {},
        trailhead_id: null,
        candidate_path: null,
        candidate_sha256: null,
        candidate_artifact: null,
        published_route_id: null,
        replacement_route_id: null,
        blocker_code: null,
      });
    } finally {
      await pool.query(
        `DELETE FROM standard_route_backfill_jobs WHERE destination_id = $1`,
        [destinationId]
      );
      await pool.query(`DELETE FROM routes WHERE id = $1`, [routeId]);
      await pool.query(
        `DELETE FROM destinations WHERE id = ANY($1::text[])`,
        [[destinationId, trailheadId]]
      );
      await pool.end();
    }
  }
);
