import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import db from "../db";
import { dbSkipReason } from "./helpers/test-db";

after(async () => { await db.end(); });

// route_search_terms is the narrow table route search reads. Triggers keep it
// in step with routes, aliases, linked places, and segment trail names.
test("route_search_terms follows route, segment, and destination changes", {
  skip: dbSkipReason ?? undefined,
}, async () => {
  const client = await db.connect();
  const prefix = `route-terms-${randomUUID()}`;
  const id = (key: string) => `${prefix}-${key}`;
  const terms = async () => (await client.query(
    `SELECT term, public, owner, popularity FROM route_search_terms
     WHERE route_id = $1 ORDER BY term, public`, [id("route")])).rows;
  const termNames = async () => (await terms()).map((row) => row.term);

  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO destinations (id, name, search_name, features, owner, state_code, country_code)
       VALUES ($1, 'Hidden Tarn', 'hidden tarn', ARRAY['lake'::destination_feature], $2, 'WA', 'US')`,
      [id("tarn"), id("someone")]);
    await client.query(
      `INSERT INTO routes (id, name, owner, status, objective_destination_id, aliases, popularity)
       VALUES ($1, 'Maple Pass Loop', 'peaks', 'active', $2, ARRAY['Heather Maple'], 7)`,
      [id("route"), id("tarn")]);

    assert.deepEqual(await terms(), [
      { term: "heather maple", public: true, owner: "peaks", popularity: 7 },
      { term: "hidden tarn", public: false, owner: "peaks", popularity: 7 },
      { term: "maple pass loop", public: true, owner: "peaks", popularity: 7 },
    ]);

    await client.query("INSERT INTO segments (id, trail_names) VALUES ($1, ARRAY['Pacific Crest Trl'])", [id("segment")]);
    await client.query(
      "INSERT INTO route_segments (route_id, segment_id, ordinal) VALUES ($1, $2, 0)", [id("route"), id("segment")]);
    assert.ok((await termNames()).includes("pacific crest trail"));

    await client.query("UPDATE segments SET trail_names = ARRAY['Rainy Lake Trl'] WHERE id = $1", [id("segment")]);
    const afterRename = await termNames();
    assert.ok(afterRename.includes("rainy lake trail"));
    assert.ok(!afterRename.includes("pacific crest trail"));

    await client.query("UPDATE destinations SET owner = 'peaks' WHERE id = $1", [id("tarn")]);
    assert.equal((await terms()).find((row) => row.term === "hidden tarn")?.public, true);

    await client.query(
      `INSERT INTO destinations (id, name, search_name, features, state_code, country_code)
       VALUES ($1, 'Lake Ann', 'lake ann', ARRAY['lake'::destination_feature], 'WA', 'US')`, [id("ann")]);
    await client.query(
      "INSERT INTO route_destinations (route_id, destination_id, ordinal) VALUES ($1, $2, 1)", [id("route"), id("ann")]);
    assert.ok((await termNames()).includes("lake ann"));
    await client.query("DELETE FROM route_destinations WHERE route_id = $1 AND destination_id = $2", [id("route"), id("ann")]);
    assert.ok(!(await termNames()).includes("lake ann"));

    await client.query("UPDATE routes SET popularity = 42 WHERE id = $1", [id("route")]);
    assert.ok((await terms()).every((row) => row.popularity === 42));

    // Proximity measures to the path's start, kept on every term row.
    const anchors = async () => (await client.query(
      `SELECT DISTINCT ST_AsText(anchor) AS anchor FROM route_search_terms WHERE route_id = $1`, [id("route")]))
      .rows.map((row) => row.anchor);
    assert.deepEqual(await anchors(), [null]);
    await client.query(
      `UPDATE routes SET path = ST_GeomFromText('LINESTRING Z(-120.7 48.5 1500, -120.8 48.6 2000)', 4326)::geography
       WHERE id = $1`, [id("route")]);
    assert.deepEqual(await anchors(), ["POINT(-120.7 48.5)"]);
    await client.query(
      `UPDATE routes SET path = ST_GeomFromText('LINESTRING Z(-120.6 48.4 1400, -120.8 48.6 2000)', 4326)::geography
       WHERE id = $1`, [id("route")]);
    assert.deepEqual(await anchors(), ["POINT(-120.6 48.4)"]);

    await client.query("UPDATE routes SET status = 'pending' WHERE id = $1", [id("route")]);
    assert.deepEqual(await terms(), []);
    await client.query("UPDATE routes SET status = 'active' WHERE id = $1", [id("route")]);
    assert.ok((await termNames()).includes("maple pass loop"));

    await client.query("DELETE FROM route_segments WHERE route_id = $1", [id("route")]);
    assert.ok(!(await termNames()).includes("rainy lake trail"));

    await client.query("DELETE FROM routes WHERE id = $1", [id("route")]);
    assert.deepEqual(await terms(), []);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

// Autovacuum and other writer roles run with their own search_path.
test("refresh_route_search_terms works with an empty search_path", {
  skip: dbSkipReason ?? undefined,
}, async () => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = ''");
    await client.query("SELECT public.refresh_route_search_terms(ARRAY[]::text[])");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
