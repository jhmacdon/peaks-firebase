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
test("route search triggers work for a writer with an empty search_path", {
  skip: dbSkipReason ?? undefined,
}, async () => {
  const client = await db.connect();
  const routeId = `route-terms-path-${randomUUID()}`;
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO routes (id, name, owner, status, aliases, path)
       VALUES ($1, 'Empty Path Ridge', 'peaks', 'active', ARRAY['Mt Path Trl'],
         ST_GeomFromText('LINESTRING Z(-121 47 900, -121.1 47.1 1000)', 4326)::geography)`, [routeId]);
    await client.query("SET LOCAL search_path = ''");
    // Only the triggers may call refresh_route_search_terms.
    await client.query("UPDATE public.routes SET popularity = 9 WHERE id = $1", [routeId]);
    const rows = (await client.query(
      `SELECT term, public.ST_AsText(anchor) AS anchor, popularity FROM public.route_search_terms
       WHERE route_id = $1 ORDER BY term`, [routeId])).rows;
    assert.deepEqual(rows, [
      { term: "empty path ridge", anchor: "POINT(-121 47)", popularity: 9 },
      { term: "mount path trail", anchor: "POINT(-121 47)", popularity: 9 },
    ]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("renames and deletes upstream of a route reach its search terms", {
  skip: dbSkipReason ?? undefined,
}, async () => {
  const client = await db.connect();
  const prefix = `route-terms-edits-${randomUUID()}`;
  const id = (key: string) => `${prefix}-${key}`;
  const termNames = async () => (await client.query(
    "SELECT term FROM route_search_terms WHERE route_id = $1 ORDER BY term", [id("route")])).rows.map((row) => row.term);
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO routes (id, name, owner, status) VALUES ($1, 'Copper Ridge', 'peaks', 'active')`, [id("route")]);
    // A BEFORE trigger rewrites search_name; the statement sets only name.
    await client.query("UPDATE routes SET name = 'Copper Ridge Loop' WHERE id = $1", [id("route")]);
    assert.deepEqual(await termNames(), ["copper ridge loop"]);

    await client.query(
      `INSERT INTO destinations (id, name, search_name, features, state_code, country_code)
       VALUES ($1, 'Egg Lake', 'egg lake', ARRAY['lake'::destination_feature], 'WA', 'US')`, [id("lake")]);
    await client.query("INSERT INTO route_destinations (route_id, destination_id, ordinal) VALUES ($1, $2, 0)", [id("route"), id("lake")]);
    await client.query("INSERT INTO segments (id, trail_names) VALUES ($1, ARRAY['Chilliwack Trl'])", [id("segment")]);
    await client.query("INSERT INTO route_segments (route_id, segment_id, ordinal) VALUES ($1, $2, 0)", [id("route"), id("segment")]);
    assert.deepEqual(await termNames(), ["chilliwack trail", "copper ridge loop", "egg lake"]);

    await client.query("DELETE FROM destinations WHERE id = $1", [id("lake")]);
    await client.query("DELETE FROM segments WHERE id = $1", [id("segment")]);
    assert.deepEqual(await termNames(), ["copper ridge loop"]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("a term named by both the route and a private place is public once", {
  skip: dbSkipReason ?? undefined,
}, async () => {
  const client = await db.connect();
  const prefix = `route-terms-dupe-${randomUUID()}`;
  const id = (key: string) => `${prefix}-${key}`;
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO destinations (id, name, search_name, features, owner, state_code, country_code)
       VALUES ($1, 'Twin Tarns', 'twin tarns', ARRAY['lake'::destination_feature], 'someone', 'WA', 'US')`, [id("tarn")]);
    await client.query(
      `INSERT INTO routes (id, name, owner, status, objective_destination_id)
       VALUES ($1, 'Twin Tarns', 'peaks', 'active', $2)`, [id("route"), id("tarn")]);
    const rows = (await client.query(
      "SELECT term, public FROM route_search_terms WHERE route_id = $1", [id("route")])).rows;
    assert.deepEqual(rows, [{ term: "twin tarns", public: true }]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

// A segment rename and a new destination link can refresh one route from two
// transactions at once. The second must not fail on rows the first inserted.
test("concurrent refreshes of one route do not fail the second writer", {
  skip: dbSkipReason ?? undefined,
}, async () => {
  const prefix = `route-terms-race-${randomUUID()}`;
  const id = (key: string) => `${prefix}-${key}`;
  await db.query(
    `INSERT INTO routes (id, name, owner, status) VALUES ($1, 'Race Ridge', 'peaks', 'active')`, [id("route")]);
  await db.query("INSERT INTO segments (id, trail_names) VALUES ($1, ARRAY['Race Trl'])", [id("segment")]);
  await db.query("INSERT INTO route_segments (route_id, segment_id, ordinal) VALUES ($1, $2, 0)", [id("route"), id("segment")]);
  await db.query(
    `INSERT INTO destinations (id, name, search_name, features, state_code, country_code)
     VALUES ($1, 'Race Lake', 'race lake', ARRAY['lake'::destination_feature], 'WA', 'US')`, [id("lake")]);
  const first = await db.connect();
  const second = await db.connect();
  try {
    await first.query("BEGIN");
    await first.query("UPDATE segments SET trail_names = ARRAY['Race Ridge Trl'] WHERE id = $1", [id("segment")]);
    await second.query("BEGIN");
    const secondWrite = second.query(
      "INSERT INTO route_destinations (route_id, destination_id, ordinal) VALUES ($1, $2, 1)", [id("route"), id("lake")]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await first.query("COMMIT");
    await secondWrite;
    await second.query("COMMIT");
    // The pool holds two connections; both are checked out here.
    const terms = (await first.query(
      "SELECT term FROM route_search_terms WHERE route_id = $1 ORDER BY term", [id("route")])).rows.map((row) => row.term);
    assert.deepEqual(terms, ["race lake", "race ridge", "race ridge trail"]);
  } finally {
    await first.query("ROLLBACK").catch(() => undefined);
    await second.query("ROLLBACK").catch(() => undefined);
    first.release();
    second.release();
    await db.query("DELETE FROM routes WHERE id = $1", [id("route")]);
    await db.query("DELETE FROM segments WHERE id = $1", [id("segment")]);
    await db.query("DELETE FROM destinations WHERE id = $1", [id("lake")]);
  }
});
