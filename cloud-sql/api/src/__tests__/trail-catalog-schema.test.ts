import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";
import { normalizeSearchName } from "../search-utils";

const migration = readFileSync(join(__dirname,
  "../../../migrations/20261012_trail_catalog_metadata.sql"), "utf8");

const jobsMigration = readFileSync(join(__dirname,
  "../../../migrations/20261012_trail_catalog_refresh_jobs.sql"), "utf8");
const indexMigration = readFileSync(join(__dirname,
  "../../../migrations/20261012_trail_catalog_search_indexes.sql"), "utf8");

test("catalog migration leaves publication gates, names, paths, and statuses intact", () => {
  assert.doesNotMatch(migration, /CREATE(?: OR REPLACE)? FUNCTION (?:peaks_route_passes_publish_integrity|is_valid_route_provenance|enforce_peaks_route_cover_activation)/);
  assert.doesNotMatch(migration, /UPDATE routes SET (?:name|path|status)\s*=/);
  assert.match(migration, /UPDATE routes SET search_name = planned.search_name, slug = planned.slug\s+WHERE id = candidate_route_id/);
  assert.doesNotMatch(migration, /CREATE (?:UNIQUE )?INDEX|UPDATE routes SET search_name = NULLIF/);
  assert.doesNotMatch(indexMigration, /^\s*(?:BEGIN|COMMIT);/m);
  assert.doesNotMatch(indexMigration, /CREATE (?:UNIQUE )?INDEX (?!CONCURRENTLY)/);
  assert.match(indexMigration, /CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_routes_state_slug/);
  assert.match(migration, /NOT VALID/);
  assert.match(migration, /Cost:.*~\$0\/month/);
});

test("SQL catalog formulas and metadata behave on real PostGIS paths", {
  skip: process.env.TEST_DATABASE_URL ? false : "TEST_DATABASE_URL not set",
}, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.match(url.pathname, /_test$/, "catalog tests require a disposable *_test database");
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  const schema = `catalog_${process.pid}_${Date.now()}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path = ${schema}, public`);
    // The migration is tested against an isolated pre-migration catalog. Never
    // alter the public schema or depend on another test's catalog data.
    await client.query(`
      CREATE TABLE destinations (id text PRIMARY KEY, features destination_feature[],
        state_code text, country_code text);
      CREATE TABLE lists (id text PRIMARY KEY, name text);
      CREATE TABLE routes (
        id text PRIMARY KEY, name text, owner text DEFAULT 'peaks',
        status text DEFAULT 'pending', path geography(LineStringZ, 4326),
        shape route_shape, distance float8, gain float8, gain_loss float8
      );
      CREATE TABLE segments (id text PRIMARY KEY);
      CREATE TABLE route_segments (route_id text, segment_id text, ordinal integer);
      CREATE TABLE route_destinations (route_id text REFERENCES routes(id),
        destination_id text REFERENCES destinations(id), ordinal integer);
      INSERT INTO routes (id, name) VALUES ('old-a', 'Mt Si Trl'), ('old-b', 'Mt Si Trl');
    `);
    const isolatedMigration = migration.replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, "");
    await client.query(isolatedMigration);
    await client.query(jobsMigration.replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, ""));
    // The provision script and refresh integration test apply these indexes
    // concurrently. This rollback-only formula fixture uses ordinary builds.
    await client.query(indexMigration.replace(/INDEX CONCURRENTLY/g, "INDEX"));
    assert.equal((await client.query("SELECT search_name FROM routes WHERE id='old-a'")).rows[0].search_name, null,
      "DDL does not scan or backfill existing routes");
    await client.query("SELECT refresh_route_catalog_names('old-a'); SELECT refresh_route_catalog_names('old-b')");

    const oldRows = (await client.query(`SELECT * FROM routes ORDER BY id`)).rows;
    assert.equal(oldRows[0].name, "Mt Si Trl");
    assert.equal(oldRows[0].search_name, "mount si trail");
    assert.notEqual(oldRows[0].slug, oldRows[1].slug);
    assert.equal(oldRows[0].kind, null, "an incomplete legacy route stays unclassified");
    assert.equal(oldRows[0].objective_destination_id, null);
    assert.equal(oldRows[0].difficulty, null);
    assert.equal(oldRows[0].est_moving_seconds, null);

    const names = ["  Mt Si Trl  ", "LK Serene", "NE Crk Jct", "Mtn  View", "", "St Helens"];
    for (const name of names) {
      const row = (await client.query("SELECT peaks_search_name($1) AS name", [name])).rows[0];
      assert.equal(row.name, normalizeSearchName(name));
    }
    assert.equal((await client.query(`SELECT peaks_search_names(ARRAY['Mt Si', 'LK  Serene']) AS names`)).rows[0].names,
      "mount si lake serene");

    // Thresholds are explicit and include equality at every boundary.
    const difficulties = (await client.query(`
      SELECT distance, peaks_route_difficulty(distance, 0, 0, 0, 'loop') AS difficulty
      FROM unnest(ARRAY[7999,8000,15999,16000,27999,28000]::float8[]) distance
      ORDER BY distance
    `)).rows.map(row => row.difficulty);
    assert.deepEqual(difficulties, ["easy", "moderate", "moderate", "hard", "hard", "strenuous"]);
    const effort = (await client.query(`SELECT
      peaks_route_difficulty(5000, 100, 400, 0.1, 'point_to_point') AS one_way,
      peaks_route_difficulty(5000, 100, 400, 0.1, 'out_and_back') AS round_trip,
      peaks_route_difficulty(5000, 0, 0, 0.6, 'loop') AS steep,
      peaks_route_difficulty('NaN', 0, 0, 0, 'loop') AS nan_distance,
      peaks_route_difficulty(1, 'Infinity', 0, 0, 'loop') AS infinite_gain,
      peaks_route_difficulty(1, 0, -1, 0, 'loop') AS negative_loss,
      peaks_route_difficulty(1, 0, 0, 0, NULL) AS missing_shape
    `)).rows[0];
    assert.deepEqual(effort, { one_way: "moderate", round_trip: "hard", steep: "hard",
      nan_distance: null, infinite_gain: null, negative_loss: null, missing_shape: null });

    const estimates = (await client.query(`WITH paths AS (
      SELECT ST_GeogFromText('SRID=4326;LINESTRING Z (0 0 0, 0.01 0 0)') AS flat,
             ST_GeogFromText('SRID=4326;LINESTRING Z (0 0 0, 0.01 0 111.319490793)') AS hill
    ) SELECT ST_Length(flat) AS distance,
      peaks_route_est_moving_seconds(flat, 'loop') AS flat,
      peaks_route_est_moving_seconds(flat, 'out_and_back') AS flat_round,
      peaks_route_est_moving_seconds(hill, 'point_to_point') AS uphill,
      peaks_route_est_moving_seconds(ST_Reverse(hill::geometry)::geography, 'point_to_point') AS downhill,
      peaks_route_est_moving_seconds(hill, 'out_and_back') AS hill_round,
      peaks_route_max_grade(hill) AS grade
    FROM paths`)).rows[0];
    assert.equal(estimates.flat, Math.ceil(estimates.distance * 3.6 / (6 * Math.exp(-3.5 * 0.05))));
    assert.equal(estimates.flat_round, Math.ceil(estimates.distance * 7.2 / (6 * Math.exp(-3.5 * 0.05))));
    assert.ok(estimates.uphill > estimates.downhill);
    assert.ok(Math.abs(estimates.hill_round - estimates.uphill - estimates.downhill) <= 1);
    assert.ok(Math.abs(estimates.grade - 0.1) < 0.00001);
    const speeds = (await client.query(`SELECT peaks_route_walking_speed(-0.05) AS best,
      peaks_route_walking_speed(1000) AS steep, peaks_route_walking_speed('Infinity') AS invalid`)).rows[0];
    assert.deepEqual(speeds, { best: 6, steep: 0.5, invalid: null });

    const invalid = (await client.query(`SELECT
      peaks_route_est_moving_seconds(NULL, 'loop') AS missing,
      peaks_route_est_moving_seconds(ST_GeogFromText('SRID=4326;LINESTRING Z (0 0 0, 0 0 100, 0.01 0 100)'), 'loop') AS vertical,
      peaks_route_max_grade(ST_GeogFromText('SRID=4326;LINESTRING Z (0 0 0, 0 0 100, 0.01 0 100)')) AS vertical_grade,
      peaks_route_est_moving_seconds(ST_GeogFromText('SRID=4326;LINESTRING Z (0 0 1, 0 0 1)'), 'loop') AS zero_distance,
      peaks_route_est_moving_seconds(ST_GeogFromText('SRID=4326;LINESTRING Z (0 0 NaN, 0.01 0 1)'), 'loop') AS nan_height
    `)).rows[0];
    assert.deepEqual(invalid, { missing: null, vertical: null, vertical_grade: null, zero_distance: null, nan_height: null });

    const smooth = (await client.query(`SELECT
      peaks_route_max_grade(ST_GeogFromText('SRID=4326;LINESTRING Z (0 0 0, 0.0004 0 0, 0.00041 0 10, 0.00042 0 0, 0.002 0 0)')) AS grade,
      peaks_route_max_grade(ST_GeogFromText('SRID=4326;LINESTRING Z (0 0 0, 0.0001 0 1.11319490793)')) AS short_grade
    `)).rows[0];
    assert.equal(smooth.grade, 0, "small isolated vertex noise cannot set maximum grade");
    assert.ok(Math.abs(smooth.short_grade - 0.1) < 0.00001);

    await client.query(`INSERT INTO routes (id, name, path, shape, distance, gain, gain_loss)
      VALUES ('new-a', 'Lake Si', ST_GeogFromText('SRID=4326;LINESTRING Z (0 0 0, 0.01 0 100)'),
              'out_and_back', 1113.19490793, 100, 0)`);
    const inserted = (await client.query(`SELECT * FROM routes WHERE id='new-a'`)).rows[0];
    assert.equal(inserted.search_name, "lake si");
    assert.ok(inserted.est_moving_seconds > 0);
    assert.equal(inserted.difficulty, "easy");
    await client.query(`UPDATE routes SET name='Lake Si Trail' WHERE id='new-a'`);
    const renamed = (await client.query(`SELECT * FROM routes WHERE id='new-a'`)).rows[0];
    assert.equal(renamed.slug, inserted.slug, "name edits keep stable URLs");
    assert.equal(renamed.search_name, "lake si trail");
    assert.equal(renamed.est_moving_seconds, inserted.est_moving_seconds);
    await client.query(`UPDATE routes SET shape='loop' WHERE id='new-a'`);
    assert.ok((await client.query(`SELECT est_moving_seconds FROM routes WHERE id='new-a'`)).rows[0].est_moving_seconds < inserted.est_moving_seconds);

    const incomplete = (await client.query(`SELECT * FROM peaks_route_catalog_metadata_plan('old-a')`)).rows[0];
    assert.ok(incomplete.errors.includes("first_trailhead_missing"));
    assert.ok(incomplete.errors.includes("summit_objective_missing"));
    assert.ok(incomplete.errors.includes("route_stats_missing_or_invalid"));
    assert.equal((await client.query(`SELECT * FROM peaks_route_catalog_metadata_plan('missing')`)).rows[0].errors[0],
      "route_missing");
    await client.query(`INSERT INTO destinations (id,features,state_code,country_code) VALUES
      ('start', ARRAY['trailhead']::destination_feature[], 'WA', 'US'),
      ('peak', ARRAY['summit']::destination_feature[], 'WA', 'US');
      INSERT INTO route_destinations (route_id,destination_id,ordinal) VALUES
      ('new-a','start',0),('new-a','peak',1);`);
    assert.ok((await client.query(`SELECT errors FROM peaks_route_catalog_metadata_plan('new-a')`)).rows[0].errors
      .includes("segments_missing_or_invalid"));
    await client.query(`INSERT INTO segments (id) VALUES ('new-segment');
      INSERT INTO route_segments (route_id,segment_id,ordinal) VALUES ('new-a','new-segment',0)`);
    const plan = (await client.query(`SELECT * FROM peaks_route_catalog_metadata_plan('new-a')`)).rows[0];
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.objective_destination_id, "peak");
    assert.equal(plan.trailhead_destination_id, "start");
    assert.equal(plan.kind, "summit");
    assert.equal(plan.state_code, "WA");
    await client.query(`SELECT refresh_peaks_route_catalog_metadata('new-a', 7)`);
    const refreshed = (await client.query(`SELECT * FROM routes WHERE id='new-a'`)).rows[0];
    assert.equal(refreshed.kind, "summit");
    assert.equal(refreshed.popularity, 7);
    assert.equal(refreshed.name, "Lake Si Trail", "the checked refresh never renames a route");
    assert.equal(refreshed.slug, inserted.slug);
    assert.equal(refreshed.status, "pending");
    await client.query("SAVEPOINT blocked_refresh");
    await assert.rejects(client.query(`SELECT refresh_peaks_route_catalog_metadata('old-a')`), /metadata refresh blocked/);
    await client.query("ROLLBACK TO SAVEPOINT blocked_refresh");
    await client.query(`UPDATE routes SET kind='destination' WHERE id='new-a'`);
    assert.deepEqual((await client.query(`SELECT errors FROM peaks_route_catalog_metadata_plan('new-a')`)).rows[0].errors,
      ["kind_requires_review"]);
    assert.equal((await client.query(`SELECT kind FROM routes WHERE id='new-a'`)).rows[0].kind, "destination");

    // Reapplying the additive migration keeps ids, names and slugs stable.
    await client.query(isolatedMigration);
    assert.equal((await client.query(`SELECT slug FROM routes WHERE id='new-a'`)).rows[0].slug, inserted.slug);
    await client.query("SAVEPOINT unique_slug");
    await assert.rejects(client.query(`UPDATE routes SET slug=$1 WHERE id='old-a'`, [oldRows[1].slug]),
      /duplicate key/, "NULL states must not bypass slug uniqueness");
    await client.query("ROLLBACK TO SAVEPOINT unique_slug");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
