import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import db from "../db";
import { buildMixedSearchQueries } from "../routes/search";
import { rankSearchResults, SearchBuckets } from "../lib/search-ranking";
import { normalizeSearchName } from "../search-utils";
import { dbSkipReason } from "./helpers/test-db";

after(async () => { await db.end(); });

// These small, rolled-back fixtures test search signals and ordering only.
// Their names are the product design's golden queries, not imported trail data.
test("golden trail queries execute against real PostgreSQL names, aliases, objectives, and shared segments", {
  skip: dbSkipReason ?? undefined,
}, async (t) => {
  const client = await db.connect();
  const prefix = `search-golden-${randomUUID()}`;
  const id = (key: string) => `${prefix}-${key}`;
  const user = id("viewer");
  await client.query("BEGIN");
  try {
    const destinations = [
      ["mount-si", "Mount Si", "summit"],
      ["little-si", "Little Si", "summit"],
      ["ingalls-peak", "Ingalls Peak", "summit"],
      ["ingalls-lake", "Ingalls Lake", "lake"],
      ["lake-serene", "Lake Serene", "lake"],
      ["trailhead", "Golden Fixture Trailhead", "trailhead"],
    ];
    for (const [key, name, feature] of destinations) {
      await client.query(
        `INSERT INTO destinations (id, name, search_name, features, state_code, country_code)
         VALUES ($1, $2, $3, ARRAY[$4::destination_feature], 'WA', 'US')`,
        [id(key), name, normalizeSearchName(name), feature]
      );
    }
    const routes = [
      { key: "si-trail", name: "Mount Si Trail", kind: "summit", objective: "mount-si", aliases: ["Si Trail"], popularity: 1000 },
      { key: "little-trail", name: "Little Si", kind: "summit", objective: "little-si", aliases: ["Little Si Trail"], popularity: 0 },
      { key: "lake-trail", name: "Ingalls Lake via Ingalls Way", kind: "destination", objective: "ingalls-lake", aliases: ["Ingalls Lake Trail"], popularity: 0 },
      { key: "peak-trail", name: "Ingalls Peak South Ridge", kind: "summit", objective: "ingalls-peak", aliases: [], popularity: 0 },
      { key: "serene-trail", name: "Lake Serene Trail", kind: "destination", objective: "lake-serene", aliases: ["First alias", ...Array.from({ length: 12 }, (_, n) => `Unrelated approach alternative ${n}`), "Bridal Veil Lake Hike"], popularity: 0 },
      { key: "objective-only", name: "A Hidden Approach", kind: "destination", objective: "lake-serene", aliases: [], popularity: 0 },
    ];
    for (const route of routes) {
      await client.query(
        `INSERT INTO routes (id, name, owner, status, kind, objective_destination_id,
          trailhead_destination_id, aliases, popularity, state_code, country_code)
         VALUES ($1, $2, $3, 'active', $4, $5, $6, $7::text[], $8, 'WA', 'US')`,
        [id(route.key), route.name, user, route.kind, id(route.objective), id("trailhead"), route.aliases, route.popularity]
      );
    }
    // Only the named hikes appear in the four product ordering checks. The
    // objective-only row is held pending until its separate matching check.
    await client.query("UPDATE routes SET status = 'pending' WHERE id = $1", [id("objective-only")]);
    for (const [key, names] of [
      ["ingalls-shared", ["Trail 1390", "Ingalls Way", "Esmeralda Connector"]],
      ["si-shared", ["Mount Si Trail"]],
    ] as const) {
      await client.query("INSERT INTO segments (id, trail_names) VALUES ($1, $2::text[])", [id(key), names]);
    }
    for (const [route, segment] of [["lake-trail", "ingalls-shared"], ["peak-trail", "ingalls-shared"], ["si-trail", "si-shared"], ["little-trail", "si-shared"]]) {
      await client.query("INSERT INTO route_segments (route_id, segment_id) VALUES ($1, $2)", [id(route), id(segment)]);
    }

    // viewer null searches signed out.
    const search = async (query: string, geo = false, viewer: string | null = user) => {
      const queries = buildMixedSearchQueries({
        normalizedQuery: normalizeSearchName(query), rawQuery: query, limit: 20, uid: viewer ?? undefined,
        publicOnly: viewer === null,
        ...(geo ? { lat: 47.5, lng: -121.5 } : {}),
      });
      const buckets: SearchBuckets = { destinations: [], routes: [], areas: [], lists: [] };
      for (const key of ["destinations", "routes", "areas", "lists"] as const) {
        buckets[key] = (await client.query(queries[key].text, queries[key].values)).rows
          .filter((row) => row.id.startsWith(prefix));
      }
      return { buckets, results: rankSearchResults(buckets, queries.limit) };
    };

    await t.test("mount si ranks the peak before its popular trail, then Little Si", async () => {
      const { results } = await search("mount si");
      assert.deepEqual(results.slice(0, 3).map((r) => r.id), [id("mount-si"), id("si-trail"), id("little-trail")]);
      assert.equal((await search("Mount Si Trail")).results[0].id, id("si-trail"));
    });

    await t.test("ingalls ranks the lake hike, peak, then lake", async () => {
      const { results } = await search("ingalls");
      assert.deepEqual(results.slice(0, 3).map((r) => r.id), [id("lake-trail"), id("ingalls-peak"), id("ingalls-lake")]);
    });

    await t.test("a route that only borrows a trail name ranks below the places that bear it", async () => {
      // Mount Stuart's Cascadian Couloir route walks Ingalls Way from the
      // Esmeralda trailhead; nothing in its own name or objective says Ingalls.
      await client.query(
        `INSERT INTO destinations (id, name, search_name, features, state_code, country_code)
         VALUES ($1, 'Mount Stuart', 'mount stuart', ARRAY['summit'::destination_feature], 'WA', 'US')`, [id("stuart")]);
      await client.query(
        `INSERT INTO routes (id, name, owner, status, kind, objective_destination_id, popularity)
         VALUES ($1, 'Mount Stuart via Cascadian Couloir', $2, 'active', 'summit', $3, 0)`,
        [id("stuart-trail"), user, id("stuart")]);
      await client.query("INSERT INTO route_segments (route_id, segment_id) VALUES ($1, $2)", [id("stuart-trail"), id("ingalls-shared")]);
      try {
        const { results } = await search("ingalls");
        const rank = (key: string) => results.findIndex((r) => r.id === id(key));
        assert.ok(rank("stuart-trail") >= 0, "the trail name still finds the route");
        assert.ok(rank("stuart-trail") > rank("ingalls-peak"), "below Ingalls Peak");
        assert.ok(rank("stuart-trail") > rank("ingalls-lake"), "below Ingalls Lake");
        assert.ok((await search("ingalls way")).buckets.routes.some((r) => r.id === id("stuart-trail")));
      } finally {
        await client.query("DELETE FROM routes WHERE id = $1", [id("stuart-trail")]);
      }
    });

    await t.test("ingalls way finds both routes through their one shared segment", async () => {
      const { buckets, results } = await search("ingalls way");
      assert.deepEqual(results.slice(0, 2).map((r) => r.id), [id("lake-trail"), id("peak-trail")]);
      assert.ok(buckets.routes.some((r) => r.id === id("peak-trail")), "the peak route has no Ingalls Way name or alias");
      const shared = await client.query("SELECT count(DISTINCT route_id)::int AS count FROM route_segments WHERE segment_id = $1", [id("ingalls-shared")]);
      assert.equal(shared.rows[0].count, 2);
    });

    await t.test("lake serene ranks its hike above its objective, including null geometry with geo ranking", async () => {
      for (const geo of [false, true]) {
        const { results } = await search("lake serene", geo);
        assert.deepEqual(results.slice(0, 2).map((r) => r.id), [id("serene-trail"), id("lake-serene")]);
        assert.ok(results.every((r) => Number.isFinite(r.score)));
      }
    });

    await t.test("later aliases and trail names match short token prefixes", async () => {
      await client.query(
        `INSERT INTO routes (id, name, owner, status)
         SELECT $1 || '-private-' || n, 'Esmeralda Private ' || n, $2, 'active'
         FROM generate_series(1, 250) n`,
        [prefix, id("other-viewer")]
      );
      assert.ok((await search("br")).buckets.routes.some((r) => r.id === id("serene-trail")));
      assert.ok((await search("es")).buckets.routes.some((r) => r.id === id("peak-trail")), "only a later shared trail name starts with es");
      assert.equal((await search("Bridal Veil Lake Hike")).results[0].id, id("serene-trail"));
    });

    // #272 dropped the trigram fallback (about 10 s on production): a query
    // with no whole-word match returns nothing at once rather than a slow
    // fuzzy guess. The correctly spelled names still match.
    await t.test("typos return no results instead of a fuzzy match", async () => {
      assert.deepEqual((await search("Bridal Veil Lake Hikf")).results, []);
      assert.equal((await search("ingallz way")).buckets.routes.length, 0);
      assert.equal((await search("Bridal Veil Lake Hike")).results[0].id, id("serene-trail"));
      assert.ok((await search("ingalls way")).buckets.routes.some((r) => r.id === id("peak-trail")));
    });

    await t.test("an explicit objective matches without a route_destinations link", async () => {
      await client.query("UPDATE routes SET status = 'active' WHERE id = $1", [id("objective-only")]);
      assert.ok((await search("lake serene")).buckets.routes.some((r) => r.id === id("objective-only")));
    });

    await t.test("pending and private routes stay out of results", async () => {
      assert.equal((await search("ingalls", false, id("other-viewer"))).buckets.routes.length, 0);
      await client.query("UPDATE routes SET status = 'pending' WHERE id = $1", [id("lake-trail")]);
      assert.ok(!(await search("ingalls way")).buckets.routes.some((r) => r.id === id("lake-trail")));
      // A stale search row cannot bring a pending route back: status is
      // rechecked on the routes row.
      await client.query(
        `INSERT INTO route_search_terms (route_id, term, public, owner, popularity)
         VALUES ($1, 'ingalls way', true, $2, 0)`, [id("lake-trail"), user]);
      assert.ok(!(await search("ingalls way")).buckets.routes.some((r) => r.id === id("lake-trail")));
    });

    await t.test("a private place name finds a public route only for signed-in callers", async () => {
      await client.query(
        `INSERT INTO destinations (id, name, search_name, features, owner, state_code, country_code)
         VALUES ($1, 'Quillback Tarn', 'quillback tarn', ARRAY['lake'::destination_feature], $2, 'WA', 'US')`,
        [id("private-tarn"), user]);
      await client.query(
        `INSERT INTO routes (id, name, owner, status, kind, objective_destination_id)
         VALUES ($1, 'Unmarked Approach', 'peaks', 'active', 'destination', $2)`,
        [id("public-route"), id("private-tarn")]);
      assert.ok((await search("quillback tarn")).buckets.routes.some((r) => r.id === id("public-route")));
      assert.ok(!(await search("quillback tarn", false, null)).buckets.routes.some((r) => r.id === id("public-route")));
      assert.ok((await search("unmarked approach", false, null)).buckets.routes.some((r) => r.id === id("public-route")),
        "the route's own name still finds it signed out");
    });

    await t.test("lists join the ranked results and retain destination and trail counts", async () => {
      await client.query("INSERT INTO lists (id, name, owner) VALUES ($1, 'Ingalls Hikes', $2), ($3, 'Ingalls Private', $4)", [id("list"), user, id("private-list"), id("other-viewer")]);
      await client.query("INSERT INTO list_destinations (list_id, destination_id) VALUES ($1, $2)", [id("list"), id("ingalls-lake")]);
      await client.query("INSERT INTO list_routes (list_id, route_id) VALUES ($1, $2)", [id("list"), id("peak-trail")]);
      const { buckets, results } = await search("Ingalls Hikes");
      assert.equal(results[0].type, "list");
      assert.equal(results[0].id, id("list"));
      assert.equal(buckets.lists[0].destination_count, 1);
      assert.equal(buckets.lists[0].route_count, 1);
      assert.ok(!(await search("Ingalls Private")).buckets.lists.some((l) => l.id === id("private-list")));
    });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

// A bare one-word campsite or trailhead name must not bury the bigger place
// people mean, while typing a trailhead's own name still finds it first.
test("namesake queries rank the summit over a one-word campsite and keep a typed trailhead first", {
  skip: dbSkipReason ?? undefined,
}, async () => {
  const client = await db.connect();
  const prefix = `search-namesake-${randomUUID()}`;
  const id = (key: string) => `${prefix}-${key}`;
  await client.query("BEGIN");
  try {
    for (const [key, name, features] of [
      ["summit", "Mount Zqpilchuck", "{summit,fire-lookout}"],
      ["camp", "Zqpilchuck", "{campsite}"],
      ["ridge", "Zqheybrook Ridge", "{summit}"],
      ["trailhead", "Zqheybrook Trailhead", "{trailhead}"],
    ]) {
      await client.query(
        `INSERT INTO destinations (id, name, search_name, features, state_code, country_code)
         VALUES ($1, $2, $3, $4::destination_feature[], 'WA', 'US')`,
        [id(key), name, normalizeSearchName(name), features]
      );
    }
    const top = async (query: string) => {
      const q = normalizeSearchName(query);
      const queries = buildMixedSearchQueries({ normalizedQuery: q, rawQuery: query, limit: 20, uid: id("viewer") });
      const destinations = (await client.query(queries.destinations.text, queries.destinations.values)).rows;
      const buckets: SearchBuckets = { destinations, routes: [], areas: [], lists: [] };
      return rankSearchResults(buckets, 20).map((r) => r.data.name);
    };
    const pilchuck = await top("zqpilchuck");
    assert.ok(pilchuck.indexOf("Mount Zqpilchuck") < pilchuck.indexOf("Zqpilchuck"), pilchuck.join(" | "));
    assert.equal((await top("zqheybrook tr"))[0], "Zqheybrook Trailhead");
    assert.equal((await top("zqheybrook trailhead"))[0], "Zqheybrook Trailhead");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
