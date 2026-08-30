import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";
import {
  ROUTE_REVIEWER_WORKER_ID,
  canonicalJson,
} from "../standard-route-job-state";

const TEST_DATABASE_URL = process.env.ROUTE_JOB_TEST_DATABASE_URL;
const FACTORY_TEST_DATABASE_URL =
  process.env.ROUTE_JOB_FACTORY_TEST_DATABASE_URL;
const REVIEWER_TEST_DATABASE_URL =
  process.env.ROUTE_JOB_REVIEWER_TEST_DATABASE_URL;
const MIGRATE_ROOT = join(__dirname, "../..");

test(
  "a supervised claim selects only its named destination",
  {
    skip:
      TEST_DATABASE_URL &&
      FACTORY_TEST_DATABASE_URL &&
      REVIEWER_TEST_DATABASE_URL
        ? false
        : "operator, factory, and reviewer route-job test database URLs are required",
  },
  async () => {
    const databaseUrl = new URL(TEST_DATABASE_URL!);
    assert.match(
      databaseUrl.pathname,
      /_test$/,
      "route job integration tests require a disposable *_test database"
    );

    const suffix = `${process.pid}-${Date.now()}`;
    const targetId = `route-claim-target-${suffix}`;
    const otherId = `route-claim-other-${suffix}`;
    const candidateOutput =
      `cloud-sql/migrate/route-candidates/luna/worker-artifacts/${targetId}.geojson`;
    const resultOutput =
      `cloud-sql/migrate/route-candidates/luna/worker-artifacts/${targetId}-candidate.json`;
    const materializedCandidate = join(
      MIGRATE_ROOT,
      "route-candidates/luna/worker-artifacts",
      `${targetId}.geojson`
    );
    const materializedResult = join(
      MIGRATE_ROOT,
      "route-candidates/luna/worker-artifacts",
      `${targetId}-candidate.json`
    );
    const factoryDatabaseUrl = new URL(FACTORY_TEST_DATABASE_URL!);
    const reviewerDatabaseUrl = new URL(REVIEWER_TEST_DATABASE_URL!);
    assert.equal(factoryDatabaseUrl.pathname, databaseUrl.pathname);
    assert.equal(reviewerDatabaseUrl.pathname, databaseUrl.pathname);
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const factoryPool = new Pool({ connectionString: FACTORY_TEST_DATABASE_URL });
    const reviewerPool = new Pool({ connectionString: REVIEWER_TEST_DATABASE_URL });
    const environmentFor = (url: URL) => ({
      ...process.env,
      DB_HOST: url.hostname,
      DB_PORT: url.port || "5432",
      DB_NAME: url.pathname.slice(1),
      DB_USER: decodeURIComponent(url.username),
      DB_PASS: decodeURIComponent(url.password),
    });
    const commandFor = (url: URL) => (...args: string[]) => spawnSync(
      join(MIGRATE_ROOT, "node_modules/.bin/tsx"),
      [join(MIGRATE_ROOT, "src/standard-route-jobs.ts"), ...args],
      {
        cwd: MIGRATE_ROOT,
        encoding: "utf8",
        timeout: 15_000,
        env: environmentFor(url),
      }
    );
    const command = commandFor(factoryDatabaseUrl);
    const reviewCommand = commandFor(reviewerDatabaseUrl);

    try {
      await pool.query(
        `INSERT INTO destinations (
           id, name, search_name, features, country_code
         )
         VALUES
           ($1, 'Targeted route claim summit', 'targeted route claim summit',
            ARRAY['summit']::destination_feature[], 'US'),
           ($2, 'Higher priority untargeted summit', 'higher priority untargeted summit',
            ARRAY['summit']::destination_feature[], 'US')`,
        [targetId, otherId]
      );
      await pool.query(
        `INSERT INTO standard_route_backfill_jobs (
           destination_id, state, priority, target_reasons
         )
         VALUES
           ($1, 'queued', 1, '{"integrity_repair": true}'::jsonb),
           ($2, 'queued', 999999, '{"integrity_repair": false}'::jsonb)`,
        [targetId, otherId]
      );

      const claimed = command(
        "claim",
        "--worker-id", "targeted-claim-test",
        "--destination-id", targetId,
        "--integrity-repairs-only",
        "--stage", "research",
        "--apply"
      );
      assert.equal(claimed.status, 0, claimed.stderr || claimed.stdout);
      const result = JSON.parse(claimed.stdout.trim());
      assert.equal(result.requested_destination_id, targetId);
      assert.equal(result.integrity_repairs_only, true);
      assert.equal(result.job.destination_id, targetId);
      assert.equal(result.job.state, "researching");

      const wrongStageMaterialize = command(
        "materialize",
        "--destination-id", targetId,
        "--lease-token", result.job.lease_token,
        "--output", `/tmp/${targetId}.geojson`
      );
      assert.notEqual(wrongStageMaterialize.status, 0);
      assert.match(
        wrongStageMaterialize.stderr,
        /active candidate_ready import-stage lease/
      );

      const candidateArtifact = {
        type: "FeatureCollection",
        peaks_destination_id: targetId,
        features: [],
      };
      const candidateJson = canonicalJson(candidateArtifact);
      const candidateHash = createHash("sha256")
        .update(candidateJson)
        .digest("hex");
      await factoryPool.query(
        `UPDATE standard_route_backfill_jobs
         SET state = 'candidate_ready',
             candidate_artifact = $2::jsonb,
             candidate_sha256 = $3,
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL
         WHERE destination_id = $1`,
        [targetId, candidateJson, candidateHash]
      );
      await assert.rejects(
        factoryPool.query(
          `UPDATE standard_route_backfill_jobs
           SET state = 'approved'
           WHERE destination_id = $1`,
          [targetId]
        ),
        /factory database role cannot make this queue transition/
      );
      await assert.rejects(
        reviewerPool.query(
          `UPDATE standard_route_backfill_jobs
           SET updated_at = now()
           WHERE destination_id = $1`,
          [otherId]
        ),
        /reviewer database role may update only pending_review jobs/
      );
      const expiredResearchMaterialize = command(
        "materialize",
        "--destination-id", targetId,
        "--lease-token", result.job.lease_token,
        "--output", materializedCandidate
      );
      assert.notEqual(expiredResearchMaterialize.status, 0);
      assert.match(
        expiredResearchMaterialize.stderr,
        /active candidate_ready import-stage lease/
      );

      const importClaim = command(
        "claim",
        "--worker-id", "targeted-import-test",
        "--destination-id", targetId,
        "--integrity-repairs-only",
        "--stage", "import",
        "--apply"
      );
      assert.equal(importClaim.status, 0, importClaim.stderr || importClaim.stdout);
      const importResult = JSON.parse(importClaim.stdout.trim());
      assert.equal(importResult.job.destination_id, targetId);
      assert.equal(importResult.job.state, "candidate_ready");
      assert.notEqual(importResult.job.lease_token, result.job.lease_token);

      const importStageMaterialize = command(
        "materialize",
        "--destination-id", targetId,
        "--lease-token", importResult.job.lease_token,
        "--output", candidateOutput
      );
      assert.equal(
        importStageMaterialize.status,
        0,
        importStageMaterialize.stderr || importStageMaterialize.stdout
      );
      assert.deepEqual(
        JSON.parse(readFileSync(materializedCandidate, "utf8")),
        candidateArtifact
      );

      const candidateResult = {
        route_name: "Targeted route claim summit via Standard Route",
        route_shape: "out_and_back",
      };
      await factoryPool.query(
        `UPDATE standard_route_backfill_jobs
         SET state = 'pending_review',
             candidate = $2::jsonb,
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL
         WHERE destination_id = $1`,
        [targetId, JSON.stringify(candidateResult)]
      );
      await assert.rejects(
        factoryPool.query(
          `UPDATE standard_route_backfill_jobs
           SET lease_owner = $2,
               lease_token = 'forged-review-token',
               lease_expires_at = now() + interval '1 hour'
           WHERE destination_id = $1`,
          [targetId, ROUTE_REVIEWER_WORKER_ID]
        ),
        /factory database role cannot write review results or leases/
      );
      await assert.rejects(
        factoryPool.query(
          `DELETE FROM standard_route_backfill_jobs WHERE destination_id = $1`,
          [targetId]
        ),
        /permission denied/
      );
      const expiredImportResult = command(
        "materialize-result",
        "--destination-id", targetId,
        "--lease-token", importResult.job.lease_token,
        "--kind", "candidate",
        "--output", resultOutput
      );
      assert.notEqual(expiredImportResult.status, 0);
      assert.match(
        expiredImportResult.stderr,
        /active pending_review lease/
      );

      const forgedReviewClaim = command(
        "claim",
        "--worker-id", ROUTE_REVIEWER_WORKER_ID,
        "--destination-id", targetId,
        "--integrity-repairs-only",
        "--stage", "review",
        "--apply"
      );
      assert.notEqual(forgedReviewClaim.status, 0);
      assert.match(forgedReviewClaim.stderr, /cannot act as peaks-route-reviewer/);

      const reviewClaim = reviewCommand(
        "claim",
        "--worker-id", ROUTE_REVIEWER_WORKER_ID,
        "--destination-id", targetId,
        "--integrity-repairs-only",
        "--stage", "review",
        "--apply"
      );
      assert.equal(reviewClaim.status, 0, reviewClaim.stderr || reviewClaim.stdout);
      const reviewResult = JSON.parse(reviewClaim.stdout.trim());
      const restoredResult = reviewCommand(
        "materialize-result",
        "--destination-id", targetId,
        "--lease-token", reviewResult.job.lease_token,
        "--kind", "candidate",
        "--output", resultOutput
      );
      assert.equal(
        restoredResult.status,
        0,
        restoredResult.stderr || restoredResult.stdout
      );
      assert.deepEqual(
        JSON.parse(readFileSync(materializedResult, "utf8")),
        candidateResult
      );

      const untouched = await pool.query<{
        state: string;
        lease_token: string | null;
      }>(
        `SELECT state, lease_token
         FROM standard_route_backfill_jobs
         WHERE destination_id = $1`,
        [otherId]
      );
      assert.deepEqual(untouched.rows[0], {
        state: "queued",
        lease_token: null,
      });

      const noOrdinaryFallback = command(
        "claim",
        "--worker-id", "repairs-only-test",
        "--integrity-repairs-only",
        "--stage", "research",
        "--apply"
      );
      assert.equal(
        noOrdinaryFallback.status,
        0,
        noOrdinaryFallback.stderr || noOrdinaryFallback.stdout
      );
      assert.equal(
        JSON.parse(noOrdinaryFallback.stdout.trim()).job,
        null,
        "a repair-only claim must not take an ordinary high-priority job"
      );

      const missing = command(
        "claim",
        "--worker-id", "missing-target-test",
        "--destination-id", `missing-${suffix}`,
        "--stage", "research",
        "--apply"
      );
      assert.equal(missing.status, 0, missing.stderr || missing.stdout);
      assert.equal(JSON.parse(missing.stdout.trim()).job, null);
    } finally {
      rmSync(materializedCandidate, { force: true });
      rmSync(materializedResult, { force: true });
      await pool.query(
        `DELETE FROM standard_route_backfill_jobs
         WHERE destination_id = ANY($1::text[])`,
        [[targetId, otherId]]
      );
      await pool.query(
        `DELETE FROM destinations WHERE id = ANY($1::text[])`,
        [[targetId, otherId]]
      );
      await pool.end();
      await factoryPool.end();
      await reviewerPool.end();
    }
  }
);
