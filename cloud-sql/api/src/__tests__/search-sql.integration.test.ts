import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import db from "../db";
import { buildMixedSearchQueries } from "../routes/search";
import { dbSkipReason as skipReason } from "./helpers/test-db";

after(async () => {
  await db.end();
});

test(
  "every mixed-search SQL variant executes against the current schema",
  { skip: skipReason ?? undefined },
  async () => {
    const inputs = [
      { normalizedQuery: "ra", rawQuery: "ra", limit: 20 },
      { normalizedQuery: "ra", rawQuery: "ra", lat: 47.64, lng: -122.35, limit: 20 },
      { normalizedQuery: "campo", rawQuery: "campo", limit: 20 },
      { normalizedQuery: "campo", rawQuery: "campo", lat: 47.64, lng: -122.35, limit: 20 },
    ];

    for (const input of inputs) {
      const queries = buildMixedSearchQueries(input);
      for (const query of Object.values(queries)) {
        const result = await db.query(query.text, query.values);
        assert.ok(Array.isArray(result.rows));
      }
    }
  }
);

test(
  "route search finds normalized aliases and shared physical trail names without exposing private routes",
  { skip: skipReason ?? undefined },
  async () => {
    const client = await db.connect();
    const suffix = randomUUID().replace(/-/g, "");
    const uid = `search-owner-${suffix}`;
    const routeId = `search-route-${suffix}`;
    const segmentId = `search-segment-${suffix}`;
    const trailQuery = `connector${suffix} trail`;
    const aliasQuery = `shortcut${suffix} mountain`;
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO routes (id, owner, name, aliases, status)
         VALUES ($1, $2, 'Unrelated route name', $3::text[], 'active')`,
        [routeId, uid, [`Shortcut${suffix} Mtn`]]
      );
      await client.query(
        "INSERT INTO segments (id, name, trail_names) VALUES ($1, 'Unnamed piece', $2::text[])",
        [segmentId, [`Connector${suffix} Trl`]]
      );
      await client.query(
        "INSERT INTO route_segments (route_id, segment_id, ordinal) VALUES ($1, $2, 0)",
        [routeId, segmentId]
      );
      for (const normalizedQuery of [trailQuery, aliasQuery]) {
        const query = buildMixedSearchQueries({ normalizedQuery, rawQuery: normalizedQuery, uid, limit: 20 }).routes;
        const result = await client.query(query.text, query.values);
        const route = result.rows.find((row) => row.id === routeId);
        assert.ok(route, `expected match for ${normalizedQuery}`);
        assert.equal(typeof route.score, "number");
        assert.equal(route.score, 1, "an exact alias or trail-name match shares the exact-name score");
        assert.deepEqual(route.aliases, [`Shortcut${suffix} Mtn`]);

        const privateQuery = buildMixedSearchQueries({ normalizedQuery, rawQuery: normalizedQuery, uid: "another-user", limit: 20 }).routes;
        const privateResult = await client.query(privateQuery.text, privateQuery.values);
        assert.ok(!privateResult.rows.some((row) => row.id === routeId));
      }
      // The catalog trigger keeps search_name current for user routes too, and
      // the migration backfills every existing route, so renames stay findable.
      await client.query("UPDATE routes SET name = 'Marmot Connector' WHERE id = $1", [routeId]);
      for (const normalizedQuery of ["marmott", "ma"]) {
        const query = buildMixedSearchQueries({ normalizedQuery, rawQuery: normalizedQuery, uid, limit: 20 }).routes;
        const result = await client.query(query.text, query.values);
        const route = result.rows.find((row) => row.id === routeId);
        assert.ok(route, `expected renamed user route to match ${normalizedQuery}`);
        assert.equal(typeof route.score, "number", "short and fuzzy scores stay numeric on the wire");
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
);
