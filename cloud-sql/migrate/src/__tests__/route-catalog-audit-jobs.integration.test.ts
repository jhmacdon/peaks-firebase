import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Pool } from "pg";

const TEST_DATABASE_URL = process.env.ROUTE_AUDIT_JOB_TEST_DATABASE_URL;
const MIGRATE_ROOT = join(__dirname, "../..");
const MIGRATION = join(
  MIGRATE_ROOT,
  "../migrations/20260801_route_catalog_audit_jobs.sql"
);

test(
  "audit jobs recover leases, requeue stale catalogs, and retire vanished candidates",
  {
    skip: TEST_DATABASE_URL
      ? false
      : "ROUTE_AUDIT_JOB_TEST_DATABASE_URL not set",
  },
  async () => {
    const databaseUrl = new URL(TEST_DATABASE_URL!);
    assert.match(
      databaseUrl.pathname,
      /_test$/,
      "route audit job tests require a disposable *_test database"
    );
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const suffix = `${process.pid}-${Date.now()}`;
    const destinationId = `route-audit-destination-${suffix}`;
    const routeId = `route-audit-route-${suffix}`;
    const evidenceDir = await mkdtemp(join(tmpdir(), "route-audit-job-test-"));
    const resultFile = join(evidenceDir, "result.json");
    const command = (...args: string[]) => {
      const result = spawnSync(
        join(MIGRATE_ROOT, "node_modules/.bin/tsx"),
        [join(MIGRATE_ROOT, "src/route-catalog-audit-jobs.ts"), ...args],
        {
          cwd: MIGRATE_ROOT,
          encoding: "utf8",
          timeout: 30_000,
          env: {
            ...process.env,
            DB_HOST: databaseUrl.hostname,
            DB_PORT: databaseUrl.port || "5432",
            DB_NAME: databaseUrl.pathname.slice(1),
            DB_USER: decodeURIComponent(databaseUrl.username),
            DB_PASS: decodeURIComponent(databaseUrl.password),
          },
        }
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return JSON.parse(result.stdout.trim());
    };

    try {
      await pool.query(await readFile(MIGRATION, "utf8"));
      await pool.query(
        `INSERT INTO destinations (id, name, features)
         VALUES ($1, 'Route audit test summit',
                 ARRAY['summit']::destination_feature[])`,
        [destinationId]
      );
      await pool.query(
        `INSERT INTO routes (id, name, owner, status)
         VALUES ($1, 'Route audit test route', 'peaks', 'active')`,
        [routeId]
      );
      await pool.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, 0)`,
        [routeId, destinationId]
      );

      command("seed", "--apply");
      const firstClaim = command(
        "claim", "--worker-id", "integration-test",
        "--destination-id", destinationId, "--apply"
      );
      assert.equal(firstClaim.job.destination_id, destinationId);
      await pool.query(
        `UPDATE route_catalog_audit_jobs
         SET lease_expires_at = now() - interval '1 minute'
         WHERE destination_id = $1`,
        [destinationId]
      );
      const recoveredClaim = command(
        "claim", "--worker-id", "integration-test",
        "--destination-id", destinationId, "--apply"
      );
      assert.equal(recoveredClaim.job.destination_id, destinationId);
      assert.equal(recoveredClaim.job.attempt_count, 2);

      await writeFile(resultFile, JSON.stringify({
        destination_id: destinationId,
        verdict: "PASS",
        state: "passed",
      }));
      await pool.query(
        `UPDATE routes
         SET name = 'Changed during audit',
             updated_at = now() + interval '1 second'
         WHERE id = $1`,
        [routeId]
      );
      const changed = command(
        "complete",
        "--destination-id", destinationId,
        "--lease-token", recoveredClaim.job.lease_token,
        "--state", "passed",
        "--result-file", resultFile,
        "--apply"
      );
      assert.equal(changed.outcome, "catalog_changed_requeued");
      assert.equal(changed.job.state, "queued");
      assert.equal(changed.job.lease_token, null);

      const finalClaim = command(
        "claim", "--worker-id", "integration-test",
        "--destination-id", destinationId, "--apply"
      );
      await pool.query(
        `UPDATE routes
         SET status = 'superseded',
             updated_at = now() + interval '2 seconds'
         WHERE id = $1`,
        [routeId]
      );
      const retired = command(
        "complete",
        "--destination-id", destinationId,
        "--lease-token", finalClaim.job.lease_token,
        "--state", "passed",
        "--result-file", resultFile,
        "--apply"
      );
      assert.equal(retired.outcome, "out_of_scope");
      assert.equal(retired.job.state, "out_of_scope");
      assert.equal(retired.job.lease_token, null);
    } finally {
      await pool.query(
        `DELETE FROM route_catalog_audit_jobs WHERE destination_id = $1`,
        [destinationId]
      );
      await pool.query(`DELETE FROM routes WHERE id = $1`, [routeId]);
      await pool.query(`DELETE FROM destinations WHERE id = $1`, [
        destinationId,
      ]);
      await pool.end();
      await rm(evidenceDir, { recursive: true, force: true });
    }
  }
);
