import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Pool, type PoolClient } from "pg";

const MIGRATE_ROOT = join(__dirname, "../..");
const CLOUD_SQL_ROOT = join(MIGRATE_ROOT, "..");
const INVARIANT_MIGRATION = readFileSync(
  join(
    CLOUD_SQL_ROOT,
    "migrations/20260901_active_route_cover_invariant.sql"
  ),
  "utf8"
);
const SCHEMA = readFileSync(join(CLOUD_SQL_ROOT, "schema.sql"), "utf8");
const TEST_DATABASE_URL = process.env.ROUTE_JOB_TEST_DATABASE_URL;

function assertInvariant(sql: string): void {
  assert.match(sql, /FUNCTION assert_active_peaks_route_has_cover/);
  assert.match(sql, /FROM public\.routes route/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /JOIN public\.destinations destination/);
  assert.match(sql, /NULLIF\(btrim\(destination\.hero_image\), ''\) IS NOT NULL/);
  assert.match(sql, /destination\.hero_image_attribution/);
  assert.match(sql, /destination\.hero_image_attribution_url/);
  assert.match(sql, /requires a fully credited derived cover/);

  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER trg_enforce_active_peaks_route_cover[\s\S]*AFTER INSERT OR UPDATE ON routes[\s\S]*DEFERRABLE INITIALLY DEFERRED[\s\S]*WHEN \(NEW\.owner = 'peaks' AND NEW\.status = 'active'\)/
  );
  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER trg_enforce_active_peaks_route_link_cover[\s\S]*AFTER INSERT OR UPDATE OR DELETE ON route_destinations[\s\S]*DEFERRABLE INITIALLY DEFERRED/
  );
  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER trg_enforce_active_peaks_destination_cover[\s\S]*AFTER UPDATE OF[\s\S]*hero_image[\s\S]*hero_image_attribution[\s\S]*hero_image_attribution_url[\s\S]*ON destinations[\s\S]*DEFERRABLE INITIALLY DEFERRED/
  );
}

function requireDisposableDatabase(value: string): URL {
  const url = new URL(value);
  assert.match(url.pathname, /_test$/, "route-cover tests require a *_test database");
  return url;
}

async function rollbackAfterRejectedCommit(client: PoolClient): Promise<void> {
  await assert.rejects(
    client.query("COMMIT"),
    /requires a fully credited derived cover/
  );
  await client.query("ROLLBACK").catch(() => undefined);
}

function rejectedCommitReason(
  results: PromiseSettledResult<unknown>[]
): unknown {
  assert.deepEqual(
    results.map((result) => result.status).sort(),
    ["fulfilled", "rejected"]
  );
  return results.find((result) => result.status === "rejected")?.reason;
}

test("active route-cover invariant is present in migration and baseline schema", () => {
  assertInvariant(INVARIANT_MIGRATION);
  assertInvariant(SCHEMA);
  assert.doesNotMatch(
    INVARIANT_MIGRATION,
    /UPDATE\s+public\.routes\s+SET\s+status/i
  );
});

test(
  "active route-cover invariant guards inserts, links, and later cover edits",
  {
    skip: TEST_DATABASE_URL
      ? false
      : "ROUTE_JOB_TEST_DATABASE_URL is required",
  },
  async () => {
    requireDisposableDatabase(TEST_DATABASE_URL!);
    const suffix = `${process.pid}-${Date.now()}`;
    const uncoveredDestination = `cover-invariant-uncovered-destination-${suffix}`;
    const firstCoveredDestination = `cover-invariant-covered-a-destination-${suffix}`;
    const secondCoveredDestination = `cover-invariant-covered-b-destination-${suffix}`;
    const directUncoveredRoute = `cover-invariant-direct-uncovered-route-${suffix}`;
    const pendingUncoveredRoute = `cover-invariant-pending-uncovered-route-${suffix}`;
    const guardedRoute = `cover-invariant-guarded-route-${suffix}`;
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const client = await pool.connect();

    try {
      // A direct active insert must not bypass the old activation-only gate.
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO destinations (id, name, search_name, features)
         VALUES ($1, 'Uncovered summit', 'uncovered summit',
                 ARRAY['summit']::destination_feature[])`,
        [uncoveredDestination]
      );
      await client.query(
        `INSERT INTO routes (id, name, owner, status)
         VALUES ($1, 'Direct uncovered route', 'peaks', 'active')`,
        [directUncoveredRoute]
      );
      await client.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, 0)`,
        [directUncoveredRoute, uncoveredDestination]
      );
      await rollbackAfterRejectedCommit(client);

      // A direct insert passes when its final transaction state has a cover.
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO destinations (
           id, name, search_name, features,
           hero_image, hero_image_attribution, hero_image_attribution_url
         ) VALUES (
           $1, 'First covered summit', 'first covered summit',
           ARRAY['summit']::destination_feature[],
           'https://upload.wikimedia.org/first.jpg',
           'First Photographer',
           'https://commons.wikimedia.org/wiki/File:First.jpg'
         )`,
        [firstCoveredDestination]
      );
      await client.query(
        `INSERT INTO destinations (
           id, name, search_name, features,
           hero_image, hero_image_attribution, hero_image_attribution_url
         ) VALUES (
           $1, 'Second covered summit', 'second covered summit',
           ARRAY['summit']::destination_feature[],
           'https://upload.wikimedia.org/second.jpg',
           'Second Photographer',
           'https://commons.wikimedia.org/wiki/File:Second.jpg'
         )`,
        [secondCoveredDestination]
      );
      await client.query(
        `INSERT INTO destinations (id, name, search_name, features)
         VALUES ($1, 'Uncovered summit', 'uncovered summit',
                 ARRAY['summit']::destination_feature[])`,
        [uncoveredDestination]
      );
      await client.query(
        `INSERT INTO routes (id, name, owner, status)
         VALUES ($1, 'Guarded route', 'peaks', 'active')`,
        [guardedRoute]
      );
      await client.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, 0)`,
        [guardedRoute, firstCoveredDestination]
      );
      await client.query("COMMIT");

      // Pending work may stay uncovered, but it cannot then become active.
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO routes (id, name, owner, status)
         VALUES ($1, 'Pending uncovered route', 'peaks', 'pending')`,
        [pendingUncoveredRoute]
      );
      await client.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, 0)`,
        [pendingUncoveredRoute, uncoveredDestination]
      );
      await client.query("COMMIT");
      await client.query("BEGIN");
      await client.query(
        `UPDATE routes SET status = 'active' WHERE id = $1`,
        [pendingUncoveredRoute]
      );
      await rollbackAfterRejectedCommit(client);

      // Removing the sole route link must fail.
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM route_destinations
         WHERE route_id = $1 AND destination_id = $2`,
        [guardedRoute, firstCoveredDestination]
      );
      await rollbackAfterRejectedCommit(client);

      // Deleting the sole covered destination must fail through its FK cascade.
      await client.query("BEGIN");
      await client.query(`DELETE FROM destinations WHERE id = $1`, [
        firstCoveredDestination,
      ]);
      await rollbackAfterRejectedCommit(client);

      // Clearing the last cover must fail.
      await client.query("BEGIN");
      await client.query(
        `UPDATE destinations SET hero_image = NULL WHERE id = $1`,
        [firstCoveredDestination]
      );
      await rollbackAfterRejectedCommit(client);

      // Replacing the only covered link with an uncovered link must fail.
      await client.query("BEGIN");
      await client.query(
        `UPDATE route_destinations
         SET destination_id = $1
         WHERE route_id = $2 AND destination_id = $3`,
        [uncoveredDestination, guardedRoute, firstCoveredDestination]
      );
      await rollbackAfterRejectedCommit(client);

      // A cover handoff may finish safely in one transaction.
      await client.query("BEGIN");
      await client.query(
        `UPDATE destinations SET hero_image = NULL WHERE id = $1`,
        [firstCoveredDestination]
      );
      await client.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, 1)`,
        [guardedRoute, secondCoveredDestination]
      );
      await client.query("COMMIT");

      // Concurrent removals serialize on the route. One may commit; the other
      // must see that final state and fail rather than leave no cover.
      await client.query(
        `UPDATE destinations
         SET hero_image = 'https://upload.wikimedia.org/first.jpg'
         WHERE id = $1`,
        [firstCoveredDestination]
      );
      const firstConcurrentClient = await pool.connect();
      const secondConcurrentClient = await pool.connect();
      try {
        await Promise.all([
          firstConcurrentClient.query("BEGIN"),
          secondConcurrentClient.query("BEGIN"),
        ]);
        await Promise.all([
          firstConcurrentClient.query(
            `UPDATE destinations SET hero_image = NULL WHERE id = $1`,
            [firstCoveredDestination]
          ),
          secondConcurrentClient.query(
            `UPDATE destinations SET hero_image = NULL WHERE id = $1`,
            [secondCoveredDestination]
          ),
        ]);
        const commits = await Promise.allSettled([
          firstConcurrentClient.query("COMMIT"),
          secondConcurrentClient.query("COMMIT"),
        ]);
        assert.match(
          String(rejectedCommitReason(commits)),
          /requires a fully credited derived cover/
        );
      } finally {
        await firstConcurrentClient.query("ROLLBACK").catch(() => undefined);
        await secondConcurrentClient.query("ROLLBACK").catch(() => undefined);
        firstConcurrentClient.release();
        secondConcurrentClient.release();
      }
      const coversAfterRace = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM route_cover_photos
         WHERE route_id = $1`,
        [guardedRoute]
      );
      assert.equal(coversAfterRace.rows[0]?.count, "1");

      // A route may be demoted while both linked destinations are removed.
      await client.query("BEGIN");
      await client.query(
        `UPDATE routes SET status = 'superseded' WHERE id = $1`,
        [guardedRoute]
      );
      await client.query(
        `DELETE FROM destinations WHERE id = ANY($1::text[])`,
        [[firstCoveredDestination, secondCoveredDestination]]
      );
      await client.query("COMMIT");

      const saved = await client.query<{ status: string }>(
        `SELECT status FROM routes WHERE id = $1`,
        [guardedRoute]
      );
      assert.equal(saved.rows[0]?.status, "superseded");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.query(`DELETE FROM routes WHERE id = ANY($1::text[])`, [
        [directUncoveredRoute, pendingUncoveredRoute, guardedRoute],
      ]);
      await client.query(`DELETE FROM destinations WHERE id = ANY($1::text[])`, [
        [
          uncoveredDestination,
          firstCoveredDestination,
          secondCoveredDestination,
        ],
      ]);
      client.release();
      await pool.end();
    }
  }
);
