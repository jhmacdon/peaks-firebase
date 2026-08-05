import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";
import { canonicalJson } from "../standard-route-job-state";

const TEST_DATABASE_URL = process.env.ROUTE_JOB_TEST_DATABASE_URL;
const MIGRATE_ROOT = join(__dirname, "../..");

test(
  "a supervised claim selects only its named destination",
  { skip: TEST_DATABASE_URL ? false : "ROUTE_JOB_TEST_DATABASE_URL not set" },
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
    const materializedCandidate = `/tmp/${targetId}.geojson`;
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const environment = {
      ...process.env,
      DB_HOST: databaseUrl.hostname,
      DB_PORT: databaseUrl.port || "5432",
      DB_NAME: databaseUrl.pathname.slice(1),
      DB_USER: decodeURIComponent(databaseUrl.username),
      DB_PASS: decodeURIComponent(databaseUrl.password),
    };
    const command = (...args: string[]) => spawnSync(
      join(MIGRATE_ROOT, "node_modules/.bin/tsx"),
      [join(MIGRATE_ROOT, "src/standard-route-jobs.ts"), ...args],
      {
        cwd: MIGRATE_ROOT,
        encoding: "utf8",
        timeout: 15_000,
        env: environment,
      }
    );

    try {
      await pool.query(
        `INSERT INTO destinations (id, name, features)
         VALUES
           ($1, 'Targeted route claim summit',
            ARRAY['summit']::destination_feature[]),
           ($2, 'Higher priority untargeted summit',
            ARRAY['summit']::destination_feature[])`,
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

      await pool.query(
        `UPDATE standard_route_backfill_jobs
         SET candidate_artifact = '{}'::jsonb,
             candidate_sha256 = 'not-used-outside-import'
         WHERE destination_id = $1`,
        [targetId]
      );
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
      await pool.query(
        `UPDATE standard_route_backfill_jobs
         SET state = 'candidate_ready',
             candidate_artifact = $2::jsonb,
             candidate_sha256 = $3
         WHERE destination_id = $1`,
        [targetId, candidateJson, candidateHash]
      );
      const importStageMaterialize = command(
        "materialize",
        "--destination-id", targetId,
        "--lease-token", result.job.lease_token,
        "--output", materializedCandidate
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
    }
  }
);
