import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";

const readMigration = (name: string) => readFileSync(join(__dirname, "../../../migrations", name), "utf8");

test("route terrain floors use distinct geodesic lengths and reach every difficulty writer", {
  skip: process.env.TEST_DATABASE_URL ? false : "TEST_DATABASE_URL not set",
}, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.match(url.pathname, /_test$/, "terrain tests require a disposable *_test database");
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  const schema = `terrain_${process.pid}_${Date.now()}`;
  // The test login may create its own functions but cannot transfer them to
  // postgres. Provisioning applies the actual ownership statements as postgres.
  const isolated = (sql: string) => sql
    .replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, "")
    .replace(/^ALTER FUNCTION .* OWNER TO postgres;\s*$/gm, "")
    .replace(/SET search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/g,
      `SET search_path = pg_catalog, ${schema}, public, pg_temp`);
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path = ${schema}, public`);
    await client.query(`
      CREATE TABLE destinations (id text PRIMARY KEY, features destination_feature[],
        state_code text, country_code text);
      CREATE TABLE lists (id text PRIMARY KEY, name text);
      CREATE TABLE routes (id text PRIMARY KEY, name text, owner text DEFAULT 'peaks',
        status text DEFAULT 'pending', path geography(LineStringZ,4326), shape route_shape,
        distance float8, gain float8, gain_loss float8, elevation_string text);
      CREATE TABLE segments (id text PRIMARY KEY, path geography(LineStringZ,4326));
      CREATE TABLE route_segments (route_id text, segment_id text, ordinal integer);
      CREATE TABLE route_destinations (route_id text, destination_id text, ordinal integer);
      CREATE FUNCTION link_route_to_areas(text, boolean) RETURNS void LANGUAGE plpgsql AS 'BEGIN RETURN; END';
      CREATE FUNCTION encode_route_elevation_profile(geography) RETURNS text LANGUAGE SQL AS 'SELECT ''profile''::text';
    `);
    await client.query(isolated(readMigration("20261012_trail_catalog_metadata.sql")));
    await client.query(`INSERT INTO routes (id,name,path,shape,distance,gain,gain_loss)
      VALUES ('route','Example Peak',ST_GeogFromText('SRID=4326;LINESTRING Z (0 0 0,0.01 0 0)'),
        'out_and_back',1113,0,0)`);
    const fileNode = (await client.query("SELECT pg_relation_filenode('routes') AS node")).rows[0].node;
    const migration = isolated(readMigration("20261020_route_terrain_floor.sql"));
    await client.query(migration);
    assert.equal((await client.query("SELECT pg_relation_filenode('routes') AS node")).rows[0].node, fileNode);
    assert.equal((await client.query("SELECT difficulty FROM routes WHERE id='route'")).rows[0].difficulty, "easy");
    assert.equal((await client.query(`SELECT provolatile FROM pg_proc
      WHERE oid='peaks_route_terrain_floor(text)'::regprocedure`)).rows[0].provolatile, "s");

    const levels = ["easy", "moderate", "hard", "strenuous"];
    for (const [i, a] of levels.entries()) {
      for (const [j, b] of levels.entries()) {
        assert.equal((await client.query("SELECT peaks_harder_difficulty($1,$2) AS d", [a, b])).rows[0].d,
          levels[Math.max(i, j)]);
      }
      assert.equal((await client.query("SELECT peaks_harder_difficulty($1,NULL) AS d", [a])).rows[0].d, a);
      assert.equal((await client.query("SELECT peaks_harder_difficulty(NULL,$1) AS d", [a])).rows[0].d, null);
    }
    assert.equal((await client.query("SELECT peaks_harder_difficulty(NULL,NULL) AS d")).rows[0].d, null);

    let ordinal = 0;
    // ST_Project builds fixtures in metres. Give Z a large change to prove
    // ST_Length(geography) uses horizontal geodesic length, not 3-D length.
    const addSegment = async (id: string, metres: number, grade: string | null, copies = 1) => {
      await client.query(`INSERT INTO segments (id,path,osm_sac_scale)
        SELECT $1, ST_MakeLine(ST_SetSRID(ST_MakePoint(0,0,0),4326),
          ST_Force3DZ(ST_Project('SRID=4326;POINT(0 0)'::geography,$2::float8,pi()/2)::geometry,1000))::geography,$3`,
      [id, metres, grade]);
      for (let i = 0; i < copies; i++) {
        await client.query("INSERT INTO route_segments VALUES ('route',$1,$2)", [id, ordinal++]);
      }
    };
    const clear = async () => { await client.query("DELETE FROM route_segments; DELETE FROM segments"); ordinal = 0; };
    const floor = async () => (await client.query("SELECT peaks_route_terrain_floor('route') AS d")).rows[0].d;
    const difficulty = async () => (await client.query("SELECT difficulty FROM routes WHERE id='route'")).rows[0].difficulty;
    assert.equal(await floor(), null);
    assert.equal((await client.query("SELECT peaks_route_terrain_floor('missing') AS d")).rows[0].d, null);
    for (const grade of [null, "hiking", "mountain_hiking"]) {
      await addSegment("low", 100, grade);
      assert.equal(await floor(), null);
      await clear();
    }
    await addSegment("short", 30, "difficult_alpine_hiking", 2);
    assert.equal(await floor(), null, "repeated route links cannot double a segment's length");
    await clear();
    for (const [grade, expected] of [
      ["demanding_mountain_hiking", "moderate"], ["alpine_hiking", "hard"],
      ["demanding_alpine_hiking", "hard"], ["difficult_alpine_hiking", "hard"],
    ]) {
      await addSegment("near", 49.999, grade);
      assert.equal(await floor(), null);
      await addSegment("remainder", 0.002, grade);
      assert.equal(await floor(), expected, "separate segments sum across the threshold");
      await clear();
      await addSegment("boundary", 50, grade);
      assert.equal(await floor(), expected, "50 m itself counts");
      await clear();
    }
    await addSegment("t3", 30, "demanding_mountain_hiking");
    await addSegment("t4", 30, "alpine_hiking");
    assert.equal(await floor(), null, "T3 and alpine totals have separate thresholds");
    await clear();
    await addSegment("t4", 20, "alpine_hiking");
    await addSegment("t5", 20, "demanding_alpine_hiking");
    await addSegment("t6", 20, "difficult_alpine_hiking");
    assert.equal(await floor(), "hard", "all alpine grades share one total");
    await addSegment("t3", 100, "demanding_mountain_hiking");
    assert.equal(await floor(), "hard", "hard wins when both thresholds are met");

    // Rows inserted before their links start with effort only. The loader's
    // explicit refresh must apply the floor even while derivations are deferred.
    assert.equal(await difficulty(), "easy");
    await client.query("SET LOCAL peaks.defer_route_derivations = 'on'");
    await client.query("SELECT refresh_route_derivations(ARRAY['route'])");
    assert.equal(await difficulty(), "hard");
    await client.query("SET LOCAL peaks.defer_route_derivations = 'off'");
    await client.query("UPDATE routes SET distance=28000 WHERE id='route'");
    assert.equal(await difficulty(), "strenuous", "terrain never lowers harder effort");
    await client.query("UPDATE routes SET distance=1000 WHERE id='route'");
    assert.equal(await difficulty(), "hard", "the path/stats trigger keeps the floor");
    await client.query("UPDATE routes SET shape=NULL WHERE id='route'");
    assert.equal(await difficulty(), null, "unknown effort stays NULL despite hard terrain");
    await client.query("SELECT refresh_route_derivations(ARRAY['route'])");
    assert.equal(await difficulty(), null);
    await client.query("UPDATE routes SET shape='loop' WHERE id='route'");

    await client.query(`INSERT INTO destinations VALUES
      ('start',ARRAY['trailhead']::destination_feature[],'WA','US'),
      ('summit',ARRAY['summit']::destination_feature[],'WA','US');
      INSERT INTO route_destinations VALUES ('route','start',0),('route','summit',1)`);
    const plan = (await client.query("SELECT * FROM peaks_route_catalog_metadata_plan('route')")).rows[0];
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.difficulty, "hard");
    await client.query("UPDATE routes SET difficulty='easy' WHERE id='route'");
    await client.query("SELECT refresh_peaks_route_catalog_metadata('route')");
    assert.equal(await difficulty(), "hard", "the checked catalog refresh uses the floor too");

    await client.query("SAVEPOINT bad_grade");
    await assert.rejects(client.query("UPDATE segments SET osm_sac_scale='scrambling'"), /segments_osm_sac_scale_check/);
    await client.query("ROLLBACK TO SAVEPOINT bad_grade");
    // A reviewed source may gain its first grade, but no source or review
    // input may change with it. Only the computed route difficulty may follow.
    await client.query(`CREATE TABLE trail_catalog_candidate_jobs (proposed_route_id text, source_key text,
        batch_key text, state text, route_id text, rejection_reason text, result jsonb);
      CREATE TABLE trail_catalog_review_jobs (route_id text, state text, source_key text);
      INSERT INTO trail_catalog_candidate_jobs (proposed_route_id) VALUES ('route');
      INSERT INTO trail_catalog_review_jobs (route_id,state) VALUES ('route','approved');
      CREATE TABLE wa_catalog_activation_receipts (route_id text);
      CREATE TABLE session_routes (route_id text);
      CREATE TABLE IF NOT EXISTS list_routes (route_id text);
      CREATE TABLE plan_routes (route_id text);
      CREATE TABLE trip_report_routes (route_id text);
      CREATE FUNCTION retire_wa_catalog_pilot(text) RETURNS jsonb LANGUAGE SQL AS 'SELECT ''{}''::jsonb';
      CREATE FUNCTION trail_catalog_publish_authorized(text) RETURNS boolean LANGUAGE SQL AS 'SELECT false';
      CREATE TRIGGER reviewed_source BEFORE UPDATE OR DELETE ON segments
        FOR EACH ROW EXECUTE FUNCTION guard_trail_catalog_reviewed_links();
      CREATE TRIGGER reviewed_route BEFORE INSERT OR UPDATE OR DELETE ON routes
        FOR EACH ROW EXECUTE FUNCTION guard_trail_catalog_pending_only()`);
    await client.query(`INSERT INTO segments (id,path) SELECT 'reviewed',path FROM segments LIMIT 1;
      INSERT INTO route_segments VALUES ('route','reviewed',99);
      UPDATE segments SET osm_sac_scale='alpine_hiking' WHERE id='reviewed'`);
    await client.query("SAVEPOINT reviewed_guards");
    await assert.rejects(client.query("UPDATE segments SET osm_sac_scale='hiking' WHERE id='reviewed'"),
      /reviewed source segment is immutable/);
    await client.query("ROLLBACK TO SAVEPOINT reviewed_guards");
    await assert.rejects(client.query("UPDATE segments SET path=NULL WHERE id='reviewed'"),
      /reviewed source segment is immutable/);
    await client.query("ROLLBACK TO SAVEPOINT reviewed_guards");
    await assert.rejects(client.query("DELETE FROM segments WHERE id='reviewed'"),
      /reviewed source segment is immutable/);
    await client.query("ROLLBACK TO SAVEPOINT reviewed_guards");
    await assert.rejects(client.query("UPDATE routes SET difficulty='easy' WHERE id='route'"),
      /reviewed route is immutable/);
    await client.query("ROLLBACK TO SAVEPOINT reviewed_guards");
    await assert.rejects(client.query("UPDATE routes SET name='Unreviewed' WHERE id='route'"),
      /reviewed route is immutable/);
    await client.query("ROLLBACK TO SAVEPOINT reviewed_guards");
    await assert.rejects(client.query("UPDATE routes SET status='active' WHERE id='route'"),
      /requires independent review/);
    await client.query("ROLLBACK TO SAVEPOINT reviewed_guards");
    // Simulate the effort-only value left before this migration on an already
    // reviewed row, then exercise the real bounded refresh through its guard.
    await client.query("ALTER TABLE routes DISABLE TRIGGER reviewed_route");
    await client.query("UPDATE routes SET difficulty='easy' WHERE id='route'");
    await client.query("ALTER TABLE routes ENABLE TRIGGER reviewed_route");
    await client.query("SELECT refresh_route_derivations(ARRAY['route'])");
    assert.equal(await difficulty(), "hard");
    await client.query(migration);
    assert.equal(await floor(), "hard", "the migration can run twice");
    assert.equal(await difficulty(), "hard");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
