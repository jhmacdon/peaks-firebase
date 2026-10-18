import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";

// Exercise the CLI's actual queries in API CI's disposable PostGIS database.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- The CLI belongs to a separate TypeScript package.
const { runRefresh, sha256 } = require("../../../migrate/src/refresh-trail-catalog") as {
  runRefresh(db: unknown, options: unknown, report?: string): Promise<any>;
  sha256(contents: string): string;
};

test("trail refresh executes reviewed SQL, holds rejected routes, and replays its receipt", {
  skip: process.env.TEST_DATABASE_URL ? false : "TEST_DATABASE_URL not set",
}, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.match(url.pathname, /_test$/);
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  const schema = `refresh_${process.pid}_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path=${schema},public`);
    await client.query(`
      CREATE TABLE destinations (id text PRIMARY KEY,name text,features destination_feature[],
        state_code text,country_code text,session_count_offset integer DEFAULT 0,updated_at timestamptz DEFAULT now());
      CREATE TABLE lists (id text PRIMARY KEY,name text);
      CREATE TABLE routes (id text PRIMARY KEY,name text,owner text DEFAULT 'peaks',status text DEFAULT 'pending',
        path geography(LineStringZ,4326),shape route_shape,distance float8,gain float8,gain_loss float8,
        updated_at timestamptz DEFAULT now());
      CREATE TABLE segments (id text PRIMARY KEY,updated_at timestamptz DEFAULT now());
      CREATE TABLE route_segments (route_id text,segment_id text,ordinal integer,direction text DEFAULT 'forward');
      CREATE TABLE route_destinations (route_id text,destination_id text,ordinal integer);
      CREATE TABLE session_routes (route_id text,session_id text,coverage float8);
      CREATE TABLE trip_reports (LIKE public.trip_reports INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
      CREATE TABLE trip_report_routes (route_id text,report_id text);
      CREATE TABLE data_source_runs (LIKE public.data_source_runs INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
      CREATE SEQUENCE test_run_ids;
      ALTER TABLE data_source_runs ALTER COLUMN id SET DEFAULT nextval('test_run_ids');
      CREATE TRIGGER route_timestamp BEFORE UPDATE ON routes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
    `);
    for (const file of ["20261012_trail_catalog_metadata.sql", "20261012_trail_catalog_refresh_jobs.sql"]) {
      await client.query(readFileSync(join(__dirname, "../../../migrations", file), "utf8"));
    }
    const indexes = readFileSync(join(__dirname, "../../../migrations/20261012_trail_catalog_search_indexes.sql"), "utf8");
    for (const statement of indexes.replace(/^--.*$/gm, "").split(";").filter(value => value.trim())) {
      // Each concurrent build must reach PostgreSQL as its own autocommit query.
      await client.query(statement);
    }
    const validation = readFileSync(join(__dirname, "../../../migrations/20261012_trail_catalog_validate_constraints.sql"), "utf8");
    for (const statement of validation.replace(/^--.*$/gm, "").split(";").filter(value => value.trim())) {
      await client.query(statement);
    }
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM pg_constraint
      WHERE conrelid='routes'::regclass AND NOT convalidated`)).rows[0].count, 0);
    await client.query(`INSERT INTO destinations (id,name,features,state_code,country_code,session_count_offset) VALUES
      ('start','Start',ARRAY['trailhead']::destination_feature[],'WA','US',0),
      ('peak','Example Peak',ARRAY['summit']::destination_feature[],'WA','US',8);
      INSERT INTO routes (id,name,path,shape,distance,gain,gain_loss) VALUES
      ('ready','Example Peak',ST_GeogFromText('SRID=4326;LINESTRING Z (0 0 0,0.01 0 100)'),
       'out_and_back',1113.19490793,100,0),
      ('blocked','Missing Links',NULL,NULL,NULL,NULL,NULL);
      INSERT INTO segments (id) VALUES ('shared');
      INSERT INTO route_segments (route_id,segment_id,ordinal) VALUES ('ready','shared',0);
      INSERT INTO route_destinations (route_id,destination_id,ordinal) VALUES ('ready','start',0),('ready','peak',1);
      INSERT INTO session_routes VALUES ('ready','completed',0.7),('ready','manual',NULL),('ready','partial',0.3);
      INSERT INTO trip_reports (id,moderation_state,user_id,title,activity_date) VALUES
      ('published','published','test-user','Test report',now()),('hidden','hidden','test-user','Hidden report',now());
      INSERT INTO trip_report_routes VALUES ('ready','published'),('ready','hidden');`);
    const options = { mode: "metadata", apply: false, report: "/tmp/test-report.json", rejections: "/tmp/test-rejected.jsonl",
      routeIds: [], batchSize: 1 };
    const dryRun = await runRefresh(client, options);
    assert.equal(dryRun.error, undefined);
    assert.equal(dryRun.counts.ready, 1);
    assert.equal(dryRun.counts.rejected, 1);
    assert.equal(dryRun.rows.find((row: any) => row.route_id === "ready").popularity, 11);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM trail_catalog_refresh_jobs")).rows[0].count, 0);
    const contents = JSON.stringify(dryRun);
    const applyOptions = { ...options, apply: true, routeIds: ["ready"], expectedSha256: sha256(contents) };
    const applied = await runRefresh(client, applyOptions, contents);
    assert.equal(applied.error, undefined);
    assert.equal(applied.counts.applied, 1, JSON.stringify(applied));
    assert.equal(applied.review_scope.unselected[0].route_id, "blocked");
    const row = (await client.query("SELECT kind,popularity,name,status FROM routes WHERE id='ready'")).rows[0];
    assert.deepEqual(row, { kind: "summit", popularity: 11, name: "Example Peak", status: "pending" });
    assert.equal((await client.query("SELECT kind FROM routes WHERE id='blocked'")).rows[0].kind, null);
    const repeated = await runRefresh(client, applyOptions, contents);
    assert.equal(repeated.counts.already_applied, 1, JSON.stringify(repeated));
    assert.equal((await client.query("SELECT attempt_count,state FROM trail_catalog_refresh_jobs")).rows[0].attempt_count, 1);
    assert.deepEqual((await client.query("SELECT status FROM data_source_runs ORDER BY id")).rows.map(row => row.status),
      ["partial", "success", "success"]);
    // Legacy names include personal active and blocked current catalog routes.
    await client.query(`INSERT INTO routes (id,name,owner,status) VALUES
      ('personal','Mt Si Trl','personal-user','active'),('retired','Mt Si Old','peaks','superseded');
      UPDATE routes SET search_name=NULL,slug=NULL WHERE id IN ('personal','blocked','retired');`);
    const namesOptions = { ...options, mode: "names" };
    const namesDryRun = await runRefresh(client, namesOptions);
    assert.equal(namesDryRun.error, undefined);
    assert.deepEqual(namesDryRun.rows.map((item: any) => item.route_id), ["blocked", "personal", "ready"]);
    assert.equal(namesDryRun.counts.ready, 3);
    const namesContents = JSON.stringify(namesDryRun);
    const namesApply = { ...namesOptions, apply: true, expectedSha256: sha256(namesContents) };
    const namesApplied = await runRefresh(client, namesApply, namesContents);
    assert.equal(namesApplied.counts.applied, 3, JSON.stringify(namesApplied));
    assert.deepEqual((await client.query(`SELECT search_name,kind FROM routes WHERE id='personal'`)).rows[0],
      { search_name: "mount si trail", kind: null });
    assert.deepEqual((await client.query(`SELECT search_name,kind FROM routes WHERE id='blocked'`)).rows[0],
      { search_name: "missing links", kind: null });
    assert.equal((await client.query(`SELECT search_name FROM routes WHERE id='retired'`)).rows[0].search_name, null);
    assert.equal((await runRefresh(client, namesApply, namesContents)).counts.already_applied, 3);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM trail_catalog_refresh_jobs WHERE route_id='ready'`)).rows[0].count, 2,
      "names and metadata retain separate reviewed receipts");
  } finally {
    await client.query("ROLLBACK");
    await client.query("SET search_path=public");
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
    await pool.end();
  }
});
