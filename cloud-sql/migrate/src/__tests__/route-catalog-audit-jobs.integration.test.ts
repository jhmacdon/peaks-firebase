import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { Pool } from "pg";

const TEST_DATABASE_URL = process.env.ROUTE_AUDIT_JOB_TEST_DATABASE_URL;
const MIGRATE_ROOT = join(__dirname, "../..");

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
    const secondDestinationId = `route-audit-destination-2-${suffix}`;
    const routeId = `route-audit-route-${suffix}`;
    const segmentId = `route-audit-segment-${suffix}`;
    const resultFile = join(
      "/tmp",
      `peaks-route-audit-integration-${suffix}.result.json`
    );
    const commandEnvironment = {
      ...process.env,
      DB_HOST: databaseUrl.hostname,
      DB_PORT: databaseUrl.port || "5432",
      DB_NAME: databaseUrl.pathname.slice(1),
      DB_USER: decodeURIComponent(databaseUrl.username),
      DB_PASS: decodeURIComponent(databaseUrl.password),
    };
    const commandArguments = (...args: string[]) => [
      join(MIGRATE_ROOT, "src/route-catalog-audit-jobs.ts"),
      ...args,
    ];
    const runCommand = (...args: string[]) =>
      spawnSync(
        join(MIGRATE_ROOT, "node_modules/.bin/tsx"),
        commandArguments(...args),
        {
          cwd: MIGRATE_ROOT,
          encoding: "utf8",
          timeout: 30_000,
          env: commandEnvironment,
        }
      );
    const runCommandAsync = (...args: string[]) =>
      new Promise<{ status: number | null; stdout: string; stderr: string }>(
        (resolve, reject) => {
          const child = spawn(
            join(MIGRATE_ROOT, "node_modules/.bin/tsx"),
            commandArguments(...args),
            {
              cwd: MIGRATE_ROOT,
              env: commandEnvironment,
              timeout: 30_000,
            }
          );
          let stdout = "";
          let stderr = "";
          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");
          child.stdout.on("data", (chunk) => {
            stdout += chunk;
          });
          child.stderr.on("data", (chunk) => {
            stderr += chunk;
          });
          child.on("error", reject);
          child.on("close", (status) => {
            resolve({ status, stdout, stderr });
          });
        }
      );
    const command = (...args: string[]) => {
      const result = runCommand(...args);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return JSON.parse(result.stdout.trim());
    };

    try {
      await pool.query(
        `INSERT INTO destinations (id, name, features)
         VALUES
           ($1, 'Route audit test summit',
            ARRAY['summit']::destination_feature[]),
           ($2, 'Second route audit test summit',
            ARRAY['summit']::destination_feature[])`,
        [destinationId, secondDestinationId]
      );
      await pool.query(
        `INSERT INTO routes (id, name, owner, status)
         VALUES ($1, 'Route audit test route', 'peaks', 'active')`,
        [routeId]
      );
      await pool.query(
        `INSERT INTO segments (id, path, gain, gain_loss)
         VALUES (
           $1,
           ST_GeogFromText(
             'SRID=4326;LINESTRING Z (-121 47 100, -121.0001 47.0001 100)'
           ),
           0,
           0
         )`,
        [segmentId]
      );
      await pool.query(
        `INSERT INTO route_segments (route_id, segment_id, ordinal)
         VALUES ($1, $2, 0)`,
        [routeId, segmentId]
      );
      await pool.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, 0), ($1, $3, 1)`,
        [routeId, destinationId, secondDestinationId]
      );

      command("seed", "--apply");
      const concurrentClaims = await Promise.all([
        runCommandAsync(
          "claim", "--worker-id", "concurrency-test", "--apply"
        ),
        runCommandAsync(
          "claim", "--worker-id", "concurrency-test", "--apply"
        ),
      ]);
      for (const result of concurrentClaims) {
        assert.equal(result.status, 0, result.stderr || result.stdout);
      }
      const concurrentJobs = concurrentClaims.map((result) =>
        JSON.parse(result.stdout.trim())
      );
      assert.equal(
        concurrentJobs[0].job.destination_id,
        concurrentJobs[1].job.destination_id
      );
      assert.equal(
        concurrentJobs[0].job.lease_token,
        concurrentJobs[1].job.lease_token
      );
      assert.ok(
        concurrentJobs.some(
          (result) => result.outcome === "existing_live_lease"
        )
      );
      const concurrentLeaseCounts = await pool.query<{
        auditing: number;
        queued: number;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE state = 'auditing')::int AS auditing,
           COUNT(*) FILTER (WHERE state = 'queued')::int AS queued
         FROM route_catalog_audit_jobs
         WHERE destination_id = ANY($1::text[])`,
        [[destinationId, secondDestinationId]]
      );
      assert.deepEqual(concurrentLeaseCounts.rows[0], {
        auditing: 1,
        queued: 1,
      });
      command(
        "release",
        "--lease-token", concurrentJobs[0].job.lease_token,
        "--message", "concurrency test cleanup"
      );
      const firstClaim = command(
        "claim", "--worker-id", "integration-test",
        "--destination-id", destinationId, "--apply"
      );
      assert.equal(firstClaim.job.destination_id, destinationId);
      const rejectedWrongOwner = runCommand(
        "heartbeat", "--worker-id", "wrong-integration-worker"
      );
      assert.notEqual(rejectedWrongOwner.status, 0);
      assert.match(
        rejectedWrongOwner.stderr,
        /No single live audit lease matched worker/
      );
      const workerHeartbeat = command(
        "heartbeat", "--worker-id", "integration-test",
        "--lease-minutes", "30"
      );
      assert.equal(workerHeartbeat.lease_token, firstClaim.job.lease_token);
      const leaseWindow = await pool.query<{ lease_seconds: number }>(
        `SELECT EXTRACT(
           EPOCH FROM (lease_expires_at - now())
         )::int AS lease_seconds
         FROM route_catalog_audit_jobs
         WHERE destination_id = $1`,
        [destinationId]
      );
      assert.ok(
        leaseWindow.rows[0]!.lease_seconds > 1_700 &&
          leaseWindow.rows[0]!.lease_seconds <= 1_800,
        "the runtime default lease must be 30 minutes"
      );
      const rejectedLongLease = runCommand(
        "heartbeat",
        "--lease-token", firstClaim.job.lease_token,
        "--lease-minutes", "31"
      );
      assert.notEqual(rejectedLongLease.status, 0);
      assert.match(
        rejectedLongLease.stderr,
        /--lease-minutes must not exceed 30/
      );
      await pool.query(
        `UPDATE route_catalog_audit_jobs
         SET lease_expires_at = now() + interval '90 minutes'
         WHERE destination_id = $1`,
        [destinationId]
      );
      const resumedClaim = command(
        "claim", "--worker-id", "integration-test", "--apply"
      );
      assert.equal(resumedClaim.outcome, "existing_live_lease");
      assert.equal(resumedClaim.job.destination_id, destinationId);
      assert.equal(resumedClaim.job.lease_token, firstClaim.job.lease_token);
      assert.equal(resumedClaim.job.attempt_count, 1);
      const cappedLeaseWindow = await pool.query<{ lease_seconds: number }>(
        `SELECT EXTRACT(
           EPOCH FROM (lease_expires_at - now())
         )::int AS lease_seconds
         FROM route_catalog_audit_jobs
         WHERE destination_id = $1`,
        [destinationId]
      );
      assert.ok(
        cappedLeaseWindow.rows[0]!.lease_seconds > 1_700 &&
          cappedLeaseWindow.rows[0]!.lease_seconds <= 1_800,
        "resuming must cap an old long lease at 30 minutes"
      );
      await pool.query(
        `UPDATE route_catalog_audit_jobs
         SET lease_expires_at = now() + interval '1 minute'
         WHERE destination_id = $1`,
        [destinationId]
      );
      const renewedClaim = command(
        "claim", "--worker-id", "integration-test", "--apply"
      );
      assert.equal(renewedClaim.outcome, "existing_live_lease");
      assert.equal(renewedClaim.job.lease_token, firstClaim.job.lease_token);
      const renewedLeaseWindow = await pool.query<{ lease_seconds: number }>(
        `SELECT EXTRACT(
           EPOCH FROM (lease_expires_at - now())
         )::int AS lease_seconds
         FROM route_catalog_audit_jobs
         WHERE destination_id = $1`,
        [destinationId]
      );
      assert.ok(
        renewedLeaseWindow.rows[0]!.lease_seconds > 1_700 &&
          renewedLeaseWindow.rows[0]!.lease_seconds <= 1_800,
        "resuming must renew a near-expiry lease to 30 minutes"
      );
      const untouchedSecondJob = await pool.query<{
        state: string;
        lease_token: string | null;
      }>(
        `SELECT state, lease_token
         FROM route_catalog_audit_jobs
         WHERE destination_id = $1`,
        [secondDestinationId]
      );
      assert.deepEqual(untouchedSecondJob.rows[0], {
        state: "queued",
        lease_token: null,
      });
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
        "--worker-id", "integration-test",
        "--state", "passed",
        "--result-file", resultFile,
        "--apply"
      );
      assert.equal(changed.outcome, "catalog_changed_requeued");
      assert.equal(changed.job.state, "queued");
      assert.equal(changed.job.lease_token, null);

      const passedClaim = command(
        "claim", "--worker-id", "integration-test",
        "--destination-id", destinationId, "--apply"
      );
      const passed = command(
        "complete",
        "--destination-id", destinationId,
        "--lease-token", passedClaim.job.lease_token,
        "--state", "passed",
        "--result-file", resultFile,
        "--apply"
      );
      assert.equal(passed.outcome, "completed");
      const beforeSegmentPathChange = await pool.query<{
        updated_at: string;
        gain: number;
        gain_loss: number;
      }>(
        `SELECT updated_at, gain, gain_loss FROM segments WHERE id = $1`,
        [segmentId]
      );
      await pool.query(
        `UPDATE segments
         SET path = ST_GeogFromText(
           'SRID=4326;LINESTRING Z (-121.01 47.01 100, -121.0101 47.0101 100)'
         )
         WHERE id = $1`,
        [segmentId]
      );
      const afterSegmentPathChange = await pool.query<{
        updated_at: string;
        gain: number;
        gain_loss: number;
      }>(
        `SELECT updated_at, gain, gain_loss FROM segments WHERE id = $1`,
        [segmentId]
      );
      assert.deepEqual(
        afterSegmentPathChange.rows[0],
        beforeSegmentPathChange.rows[0],
        "segment path changes leave updated_at and stored stats untouched"
      );
      command("seed", "--apply");
      const requeuedForSegmentPath = await pool.query(
        `SELECT state FROM route_catalog_audit_jobs WHERE destination_id = $1`,
        [destinationId]
      );
      assert.equal(requeuedForSegmentPath.rows[0]?.state, "queued");
      await pool.query(
        `UPDATE route_catalog_audit_jobs
        SET audit_rule_version = 2
         WHERE destination_id = $1`,
        [destinationId]
      );
      command("seed", "--apply");
      const requeuedV2 = await pool.query(
        `SELECT state, audit_rule_version, final_result, audited_at, last_error
         FROM route_catalog_audit_jobs WHERE destination_id = $1`,
        [destinationId]
      );
      assert.deepEqual(requeuedV2.rows[0], {
        state: "queued",
        audit_rule_version: 3,
        final_result: null,
        audited_at: null,
        last_error: null,
      });

      const activeV1 = command(
        "claim", "--worker-id", "integration-test",
        "--destination-id", destinationId, "--apply"
      );
      await pool.query(
        `UPDATE route_catalog_audit_jobs
        SET audit_rule_version = 2
         WHERE destination_id = $1`,
        [destinationId]
      );
      command("seed", "--apply");
      const protectedLease = await pool.query(
        `SELECT state, audit_rule_version, lease_token
         FROM route_catalog_audit_jobs WHERE destination_id = $1`,
        [destinationId]
      );
      assert.deepEqual(protectedLease.rows[0], {
        state: "auditing",
        audit_rule_version: 2,
        lease_token: activeV1.job.lease_token,
      });
      command("release", "--worker-id", "integration-test");
      command("seed", "--apply");
      const releasedV2 = await pool.query(
        `SELECT state, audit_rule_version FROM route_catalog_audit_jobs
         WHERE destination_id = $1`,
        [destinationId]
      );
      assert.deepEqual(releasedV2.rows[0], {
        state: "queued",
        audit_rule_version: 3,
      });

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
        `DELETE FROM route_catalog_audit_jobs
         WHERE destination_id = ANY($1::text[])`,
        [[destinationId, secondDestinationId]]
      );
      await pool.query(`DELETE FROM routes WHERE id = $1`, [routeId]);
      await pool.query(`DELETE FROM segments WHERE id = $1`, [segmentId]);
      await pool.query(
        `DELETE FROM destinations WHERE id = ANY($1::text[])`,
        [[destinationId, secondDestinationId]]
      );
      await pool.end();
      await rm(resultFile, { force: true });
    }
  }
);
