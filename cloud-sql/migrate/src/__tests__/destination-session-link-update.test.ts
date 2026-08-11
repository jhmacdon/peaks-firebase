import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";

const MIGRATE_ROOT = join(__dirname, "../..");
const MIGRATION_PATH = join(
  MIGRATE_ROOT,
  "../migrations/20260810_session_link_update_xy_guard.sql"
);
const BASELINE_MIGRATION_PATH = join(
  MIGRATE_ROOT,
  "../migrations/20260725_session_destination_rejections.sql"
);
const TEST_DATABASE_URL =
  process.env.DESTINATION_SESSION_LINK_TEST_DATABASE_URL ??
  process.env.ROUTE_ELEVATION_JOB_TEST_DATABASE_URL;
const SAFE_COMMENT =
  "peaks:destination-session-link-update:xy-only-with-rejection-v1";

test("destination update migration is fail-closed and marks the XY-only guard", async () => {
  const migration = await readFile(MIGRATION_PATH, "utf8");
  assert.match(migration, /9997517e801c4dc233f86b26a5168fde/);
  assert.match(migration, /refusing to replace unknown link_sessions_on_destination_update/);
  assert.match(migration, /peaks_destination_session_link_xy_guard_v1/);
  assert.match(
    migration,
    /ST_X\(OLD\.location::geometry\) IS DISTINCT FROM ST_X\(NEW\.location::geometry\)/
  );
  assert.match(
    migration,
    /ST_Y\(OLD\.location::geometry\) IS DISTINCT FROM ST_Y\(NEW\.location::geometry\)/
  );
  assert.match(
    migration,
    /\(OLD\.location IS NULL\) IS DISTINCT FROM \(NEW\.location IS NULL\)/
  );
  assert.match(migration, /FROM session_destination_rejections r/);
  assert.match(migration, new RegExp(SAFE_COMMENT));
});

test(
  "PostGIS destination update trigger ignores Z-only edits and links true XY edits",
  {
    skip: TEST_DATABASE_URL
      ? false
      : "DESTINATION_SESSION_LINK_TEST_DATABASE_URL not set",
  },
  async () => {
    const databaseUrl = new URL(TEST_DATABASE_URL!);
    assert.match(
      databaseUrl.pathname,
      /_test$/,
      "destination session-link tests require a disposable *_test database"
    );
    const pool = new Pool({
      host: databaseUrl.hostname,
      port: Number(databaseUrl.port || "5432"),
      database: databaseUrl.pathname.slice(1),
      user: decodeURIComponent(databaseUrl.username),
      password: process.env.DESTINATION_SESSION_LINK_TEST_DB_PASS ??
        decodeURIComponent(databaseUrl.password),
    });
    const client = await pool.connect();
    const schema = `destination_session_link_${process.pid}_${Date.now()}`;
    const quotedSchema = `"${schema}"`;
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(`CREATE SCHEMA ${quotedSchema}`);
      await client.query(`SET LOCAL search_path TO ${quotedSchema}, public`);
      await client.query(`
        CREATE TYPE destination_feature AS ENUM ('summit', 'trailhead');
        CREATE TYPE session_destination_relation AS ENUM ('reached', 'goal');
        CREATE TABLE destinations (
          id text PRIMARY KEY,
          location geography(PointZ, 4326),
          boundary geography(Polygon, 4326),
          features destination_feature[] NOT NULL DEFAULT '{}'
        );
        CREATE TABLE tracking_sessions (
          id text PRIMARY KEY,
          ended boolean NOT NULL DEFAULT false
        );
        CREATE TABLE tracking_points (
          session_id text NOT NULL REFERENCES tracking_sessions(id),
          time bigint NOT NULL,
          location geography(PointZ, 4326),
          PRIMARY KEY (session_id, time)
        );
        CREATE TABLE session_destinations (
          session_id text NOT NULL REFERENCES tracking_sessions(id),
          destination_id text NOT NULL REFERENCES destinations(id),
          relation session_destination_relation NOT NULL,
          source text NOT NULL,
          PRIMARY KEY (session_id, destination_id)
        );
        CREATE TABLE session_destination_rejections (
          session_id text NOT NULL REFERENCES tracking_sessions(id),
          destination_id text NOT NULL REFERENCES destinations(id),
          PRIMARY KEY (session_id, destination_id)
        );
      `);

      const baselineMigration = await readFile(BASELINE_MIGRATION_PATH, "utf8");
      const baselineFunction = baselineMigration.match(
        /CREATE OR REPLACE FUNCTION link_sessions_on_destination_update\(\)\nRETURNS TRIGGER AS \$fn\$[\s\S]*?\$fn\$ LANGUAGE plpgsql;/
      )?.[0];
      assert.ok(baselineFunction, "reviewed deployed function fixture is missing");
      await client.query(baselineFunction);
      await client.query(`
        CREATE TRIGGER trg_destination_update_link_sessions
          AFTER UPDATE OF boundary, location ON destinations
          FOR EACH ROW
          EXECUTE FUNCTION link_sessions_on_destination_update()
      `);

      const migration = await readFile(MIGRATION_PATH, "utf8");
      const migrationBody = migration
        .replace(/^BEGIN;\s*/, "")
        .replace(/\s*COMMIT;\s*$/, "");
      await client.query(migrationBody);

      const installed = await client.query<{
        comment: string | null;
        definition: string;
      }>(`
        SELECT obj_description(p.oid, 'pg_proc') AS comment,
               pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = current_schema()
          AND p.proname = 'link_sessions_on_destination_update'
          AND p.pronargs = 0
      `);
      assert.equal(installed.rows[0]?.comment, SAFE_COMMENT);
      assert.match(installed.rows[0]?.definition ?? "", /peaks_destination_session_link_xy_guard_v1/);

      await client.query(`
        INSERT INTO tracking_sessions (id, ended) VALUES ('session-1', true);
        INSERT INTO tracking_points (session_id, time, location)
        VALUES (
          'session-1', 1,
          ST_SetSRID(ST_MakePoint(-121.5, 46.5, 100), 4326)::geography
        );
        INSERT INTO destinations (id, location, features)
        VALUES (
          'destination-1',
          ST_SetSRID(ST_MakePoint(-121.5, 46.5, 100), 4326)::geography,
          ARRAY['summit']::destination_feature[]
        );
      `);

      await client.query(`
        UPDATE destinations
        SET location = ST_SetSRID(ST_MakePoint(-121.5, 46.5, 100.5), 4326)::geography
        WHERE id = 'destination-1'
      `);
      let links = await client.query(
        "SELECT * FROM session_destinations WHERE destination_id = 'destination-1'"
      );
      assert.equal(links.rowCount, 0, "a Z-only edit created a session link");

      await client.query(`
        INSERT INTO session_destination_rejections (session_id, destination_id)
        VALUES ('session-1', 'destination-1');
        UPDATE destinations
        SET location = ST_SetSRID(ST_MakePoint(-121.50001, 46.5, 100.5), 4326)::geography
        WHERE id = 'destination-1'
      `);
      links = await client.query(
        "SELECT * FROM session_destinations WHERE destination_id = 'destination-1'"
      );
      assert.equal(links.rowCount, 0, "the rejection anti-join was lost");

      await client.query(`
        DELETE FROM session_destination_rejections
        WHERE session_id = 'session-1' AND destination_id = 'destination-1';
        UPDATE destinations
        SET location = ST_SetSRID(ST_MakePoint(-121.50002, 46.5, 100.5), 4326)::geography
        WHERE id = 'destination-1'
      `);
      links = await client.query<{
        session_id: string;
        relation: string;
        source: string;
      }>(`
        SELECT session_id, relation::text, source
        FROM session_destinations
        WHERE destination_id = 'destination-1'
      `);
      assert.deepEqual(links.rows, [{
        session_id: "session-1",
        relation: "reached",
        source: "auto",
      }]);
    } finally {
      if (transactionOpen) await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  }
);
