import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";

const MIGRATE_ROOT = join(__dirname, "../..");
const CLOUD_SQL_ROOT = join(MIGRATE_ROOT, "..");
const MIGRATION = readFileSync(
  join(
    CLOUD_SQL_ROOT,
    "migrations/20260831_route_cover_activation_gate.sql"
  ),
  "utf8"
);
const SCHEMA = readFileSync(join(CLOUD_SQL_ROOT, "schema.sql"), "utf8");
const TEST_DATABASE_URL = process.env.ROUTE_JOB_TEST_DATABASE_URL;

function assertGate(sql: string): void {
  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER trg_enforce_peaks_route_cover_activation/
  );
  assert.match(sql, /AFTER UPDATE ON routes/);
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(sql, /NEW\.owner = 'peaks'/);
  assert.match(sql, /NEW\.status = 'active'/);
  assert.match(sql, /OLD\.status IS DISTINCT FROM 'active'/);
  assert.match(sql, /FROM public\.routes current_route/);
  assert.match(sql, /JOIN public\.destinations destination/);
  assert.match(sql, /NULLIF\(btrim\(destination\.hero_image\), ''\) IS NOT NULL/);
  assert.match(sql, /destination\.hero_image_attribution/);
  assert.match(sql, /destination\.hero_image_attribution_url/);
  assert.match(sql, /requires a fully credited derived cover/);
}

function requireDisposableDatabase(value: string): URL {
  const url = new URL(value);
  assert.match(url.pathname, /_test$/, "route-cover tests require a *_test database");
  return url;
}

test("route-cover activation gate is present in migration and baseline schema", () => {
  assertGate(MIGRATION);
  assertGate(SCHEMA);
  assert.doesNotMatch(MIGRATION, /UPDATE\s+public\.routes\s+SET\s+status/i);
});

test(
  "route-cover activation gate rejects an uncovered route and accepts credit",
  {
    skip: TEST_DATABASE_URL
      ? false
      : "ROUTE_JOB_TEST_DATABASE_URL is required",
  },
  async () => {
    requireDisposableDatabase(TEST_DATABASE_URL!);
    const suffix = `${process.pid}-${Date.now()}`;
    const uncoveredDestination = `cover-gate-uncovered-destination-${suffix}`;
    const uncoveredRoute = `cover-gate-uncovered-route-${suffix}`;
    const coveredDestination = `cover-gate-covered-destination-${suffix}`;
    const coveredRoute = `cover-gate-covered-route-${suffix}`;
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO destinations (id, name, search_name, features)
         VALUES ($1, 'Uncovered summit', 'uncovered summit',
                 ARRAY['summit']::destination_feature[])`,
        [uncoveredDestination]
      );
      await client.query(
        `INSERT INTO routes (id, name, owner, status)
         VALUES ($1, 'Uncovered route', 'peaks', 'pending')`,
        [uncoveredRoute]
      );
      await client.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, 0)`,
        [uncoveredRoute, uncoveredDestination]
      );
      await client.query(
        `UPDATE routes SET status = 'active' WHERE id = $1`,
        [uncoveredRoute]
      );
      await assert.rejects(
        client.query("COMMIT"),
        /requires a fully credited derived cover/
      );
      await client.query("ROLLBACK").catch(() => undefined);

      await client.query("BEGIN");
      await client.query(
        `INSERT INTO destinations (
           id, name, search_name, features,
           hero_image, hero_image_attribution, hero_image_attribution_url
         ) VALUES (
           $1, 'Covered summit', 'covered summit',
           ARRAY['summit']::destination_feature[],
           'https://upload.wikimedia.org/example.jpg',
           'Example Photographer',
           'https://commons.wikimedia.org/wiki/File:Example.jpg'
         )`,
        [coveredDestination]
      );
      await client.query(
        `INSERT INTO routes (id, name, owner, status)
         VALUES ($1, 'Covered route', 'peaks', 'pending')`,
        [coveredRoute]
      );
      await client.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, 0)`,
        [coveredRoute, coveredDestination]
      );
      await client.query(
        `UPDATE routes SET status = 'active' WHERE id = $1`,
        [coveredRoute]
      );
      await client.query("COMMIT");

      const saved = await client.query<{ status: string }>(
        `SELECT status FROM routes WHERE id = $1`,
        [coveredRoute]
      );
      assert.equal(saved.rows[0]?.status, "active");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.query(`DELETE FROM routes WHERE id = ANY($1::text[])`, [
        [uncoveredRoute, coveredRoute],
      ]);
      await client.query(`DELETE FROM destinations WHERE id = ANY($1::text[])`, [
        [uncoveredDestination, coveredDestination],
      ]);
      client.release();
      await pool.end();
    }
  }
);
