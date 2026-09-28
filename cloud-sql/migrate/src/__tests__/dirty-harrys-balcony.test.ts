import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Client } from "pg";

const url = process.env.TEST_DATABASE_URL;
const sql = readFileSync(join(__dirname, "../../repairs/20260928_dirty_harrys_balcony.sql"), "utf8");
const keeper = "hYq0TiVHKb5zFQsm519H";
const duplicate = "2EF77C90D623341371D5";

test("balcony repair preserves links, repeats safely, and refuses unreviewed data", { skip: !url }, async () => {
  assert.match(new URL(url!).pathname, /_test$/, "Use only a database ending in _test");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '20s'");
    // Temporary tables shadow public tables. No live fixture rows or triggers
    // are used, and rollback removes every fixture, including on failure.
    await client.query(`
      CREATE TEMP TABLE destinations (LIKE public.destinations INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
      ALTER TABLE destinations ADD PRIMARY KEY (id);
      CREATE TEMP TABLE tracking_sessions (id text PRIMARY KEY, server_updated_at timestamptz);
      CREATE TEMP TABLE session_destinations (
        session_id text REFERENCES tracking_sessions(id),
        destination_id text REFERENCES destinations(id) ON DELETE CASCADE,
        relation text, source text, PRIMARY KEY (session_id, destination_id)
      );
      CREATE TEMP TABLE repair_other_links (
        destination_id text REFERENCES destinations(id) ON DELETE SET NULL
      );
    `);
    await client.query(`
      INSERT INTO destinations (id, name, search_name, location, elevation, features, metadata, external_ids)
      VALUES ($1, 'Dirty Harrys Balcony', 'dirty harrys balcony',
        ST_SetSRID(ST_MakePoint(-121.61243, 47.434126, 796), 4326), 796, '{summit}', '{"keep":"yes"}', '{}'),
        ($2, 'Dirty Harry''s Balcony', 'dirty harrys balcony',
        ST_SetSRID(ST_MakePoint(-121.6102647, 47.4337029, 769.43359375), 4326), 769.43359375,
        '{viewpoint}', '{"source":"openstreetmap"}', '{"osm_node":"1733479723"}');
    `, [keeper, duplicate]);
    await client.query("INSERT INTO tracking_sessions VALUES ('earlier', '2020-01-01'), ('recent', '2020-01-01')");
    await client.query(`INSERT INTO session_destinations VALUES
      ('earlier', $1, 'reached', 'auto'), ('earlier', $2, 'reached', 'auto'),
      ('recent', $1, 'reached', 'manual')`, [keeper, duplicate]);
    await client.query("INSERT INTO repair_other_links VALUES ($1)", [keeper]);

    async function refuses(change: string, expected: RegExp) {
      await client.query("SAVEPOINT changed_fixture");
      await client.query(change);
      await assert.rejects(client.query(sql), expected);
      await client.query("ROLLBACK TO SAVEPOINT changed_fixture");
      assert.equal((await client.query("SELECT count(*)::int n FROM destinations")).rows[0].n, 2);
    }

    await refuses(`INSERT INTO repair_other_links VALUES ('${duplicate}')`, /Duplicate has a reference/);
    await refuses(`UPDATE session_destinations SET source = 'manual' WHERE destination_id = '${duplicate}'`, /session link not already preserved/);
    await refuses(`UPDATE destinations SET name = 'A different place' WHERE id = '${keeper}'`, /identity or coordinates changed/);
    await refuses(`UPDATE destinations SET description = 'New content' WHERE id = '${duplicate}'`, /new content or offsets/);

    await client.query(sql);
    const rows = (await client.query(`SELECT id, name, ST_Y(location::geometry) lat,
      ST_X(location::geometry) lng, ST_Z(location::geometry) z, elevation, geohash,
      features::text[] features, metadata, external_ids FROM destinations`)).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, keeper);
    assert.equal(rows[0].name, "Dirty Harry's Balcony");
    assert.equal(rows[0].lat, 47.4337029);
    assert.equal(rows[0].lng, -121.6102647);
    assert.equal(rows[0].z, rows[0].elevation);
    assert.equal(rows[0].elevation, 769.43359375);
    assert.equal(rows[0].geohash.length, 12);
    assert.deepEqual(rows[0].features.sort(), ["summit", "viewpoint"]);
    assert.equal(rows[0].metadata.keep, "yes");
    assert.equal(rows[0].external_ids.osm_node, "1733479723");
    const links = (await client.query("SELECT * FROM session_destinations ORDER BY session_id")).rows;
    assert.equal(links.length, 2);
    assert.equal(links[1].source, "manual");
    assert.ok(links.every((row) => row.destination_id === keeper));
    assert.equal((await client.query("SELECT destination_id FROM repair_other_links")).rows[0].destination_id, keeper);
    assert.equal((await client.query("SELECT count(*)::int n FROM tracking_sessions WHERE server_updated_at > '2020-01-01'")).rows[0].n, 2);
    const beforeRepeat = (await client.query("SELECT to_jsonb(d) value FROM destinations d")).rows;
    await client.query(sql);
    assert.deepEqual((await client.query("SELECT to_jsonb(d) value FROM destinations d")).rows, beforeRepeat);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
