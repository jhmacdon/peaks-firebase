import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import db from "../db";
import searchRouter, {
  buildAreaSearchQuery,
  buildDestinationSearchQuery,
  buildMixedSearchQueries,
  buildListSearchQuery,
  clampSearchLimit,
  runMixedSearchQueries,
  runSearchQuery,
} from "../routes/search";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeResponse extends EventEmitter {
  statusCode?: number;
  jsonBody?: unknown;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): this {
    this.jsonBody = body;
    return this;
  }
}

function getSearchRouteHandler() {
  const layer = (searchRouter as any).stack.find(
    (candidate: any) => candidate.route?.path === "/" && candidate.route?.methods?.get
  );
  assert.ok(layer, "expected search router to include GET /");
  return layer.route.stack[0].handle as (req: unknown, res: unknown, next: (error?: unknown) => void) => Promise<void>;
}

function getSearchFeaturesRouteHandler() {
  const layer = (searchRouter as any).stack.find(
    (candidate: any) => candidate.route?.path === "/features" && candidate.route?.methods?.get
  );
  assert.ok(layer, "expected search router to include GET /features");
  return layer.route.stack[0].handle as (req: unknown, res: unknown, next: (error?: unknown) => void) => Promise<void>;
}

function getMixedSearchRouteHandler() {
  const layer = (searchRouter as any).stack.find(
    (candidate: any) => candidate.route?.path === "/all" && candidate.route?.methods?.get
  );
  assert.ok(layer, "expected search router to include GET /all");
  return layer.route.stack[0].handle as (req: unknown, res: unknown, next: (error?: unknown) => void) => Promise<void>;
}

function whereClause(sql: string): string {
  const whereIndex = sql.lastIndexOf("\n       WHERE ");
  const orderIndex = sql.lastIndexOf("\n       ORDER BY ");
  assert.ok(whereIndex >= 0 && orderIndex > whereIndex, "expected SQL to include an outer WHERE clause before ORDER BY");
  return sql.slice(whereIndex + "\n       WHERE ".length, orderIndex);
}

function assertSelectsDestinationDisplayLocation(sql: string) {
  assert.match(sql, /\bcountry_code\b/);
  assert.match(sql, /\bstate_code\b/);
}

test("destination search keeps its filter on the indexed search_name", () => {
  const query = buildDestinationSearchQuery({
    normalizedQuery: "south sis",
    rawQuery: "South sis",
    limit: 20,
  });

  assertSelectsDestinationDisplayLocation(query.text);
  assert.match(query.text, /WHERE \(search_name % \$1\s+OR search_name LIKE \$2\)/);
  assert.doesNotMatch(query.text, /OR lower\(name\) (?:I?LIKE|%)/);
  assert.match(query.text, /destination_areas da/);
  assert.match(query.text, /JOIN areas a ON a\.id = da\.area_id/);
  assert.match(query.text, /COALESCE\(area_rows\.areas, '\[\]'::json\) AS areas/);
  assert.match(query.text, /LIMIT \$3/);
  assert.deepEqual(query.values, ["south sis", "south sis%", 20]);
});

test("geo destination search keeps its filter on the indexed search_name", () => {
  const query = buildDestinationSearchQuery({
    normalizedQuery: "south sis",
    rawQuery: "South sis",
    lat: 44.103,
    lng: -121.769,
    limit: 20,
  });

  assertSelectsDestinationDisplayLocation(query.text);
  assert.match(query.text, /WHERE \(search_name % \$1\s+OR search_name LIKE \$4\)/);
  assert.doesNotMatch(query.text, /OR lower\(name\) (?:I?LIKE|%)/);
  assert.match(query.text, /LIMIT \$5/);
  assert.deepEqual(query.values, ["south sis", 44.103, -121.769, "south sis%", 20]);
});

test("2-character non-geo destination search uses full-text token prefix matching", () => {
  const query = buildDestinationSearchQuery({
    normalizedQuery: "ra",
    rawQuery: "Ra",
    limit: 20,
  });

  assertSelectsDestinationDisplayLocation(query.text);
  assert.match(query.text, /to_tsvector\('simple', COALESCE\(NULLIF\(search_name, ''\), lower\(name\)\)\)/);
  assert.match(query.text, /to_tsquery\('simple', \$1\)/);
  assert.doesNotMatch(query.text, /similarity\(/);
  assert.doesNotMatch(query.text, /% \$1/);
  assert.match(
    query.text,
    /FROM destinations\s+WHERE to_tsvector\('simple', COALESCE\(NULLIF\(search_name, ''\), lower\(name\)\)\) @@ to_tsquery\('simple', \$1\)/
  );
  assert.deepEqual(query.values, ["ra:*", "ra%", "ra%", "ra", "ra", 10]);
});

test("2-character geo destination search uses full-text token prefix matching with distance", () => {
  const query = buildDestinationSearchQuery({
    normalizedQuery: "ra",
    rawQuery: "Ra",
    lat: 46.85,
    lng: -121.7,
    limit: 20,
  });

  assertSelectsDestinationDisplayLocation(query.text);
  assert.match(query.text, /ST_Distance\(location, ST_MakePoint\(\$7, \$6\)::geography\)/);
  assert.doesNotMatch(query.text, /similarity\(/);
  assert.match(
    query.text,
    /FROM destinations\s+WHERE to_tsvector\('simple', COALESCE\(NULLIF\(search_name, ''\), lower\(name\)\)\) @@ to_tsquery\('simple', \$1\)/
  );
  assert.deepEqual(query.values, ["ra:*", "ra%", "ra%", "ra", "ra", 46.85, -121.7, 10]);
});

test("2-character invalid destination search stays on short empty path", () => {
  const query = buildDestinationSearchQuery({
    normalizedQuery: "r-",
    rawQuery: "r-",
    limit: 20,
  });

  assertSelectsDestinationDisplayLocation(query.text);
  assert.doesNotMatch(query.text, /similarity\(/);
  assert.doesNotMatch(query.text, /% \$1/);
  assert.match(query.text, /\bWHERE false\b/);
  assert.deepEqual(query.values, [10]);
});

test("3-character destination search keeps trigram matching", () => {
  const query = buildDestinationSearchQuery({
    normalizedQuery: "rai",
    rawQuery: "Rai",
    limit: 20,
  });

  assertSelectsDestinationDisplayLocation(query.text);
  assert.match(query.text, /similarity\(/);
  assert.match(query.text, /% \$1/);
  assert.deepEqual(query.values, ["rai", "rai%", 20]);
});

test("search limit is clamped to a small positive range", () => {
  assert.equal(clampSearchLimit(undefined), 20);
  assert.equal(clampSearchLimit("0"), 20);
  assert.equal(clampSearchLimit("-5"), 20);
  assert.equal(clampSearchLimit("7"), 7);
  assert.equal(clampSearchLimit("500"), 50);
});

test("mixed search builds destination, route, area, and list queries", () => {
  const queries = buildMixedSearchQueries({
    normalizedQuery: "rainier",
    rawQuery: "Rainier",
    lat: 46.85,
    lng: -121.7,
    limit: 20,
  });

  assert.match(queries.destinations.text, /FROM destinations/);
  assert.match(queries.destinations.text, /COALESCE\(area_rows\.areas, '\[\]'::json\) AS areas/);
  assert.match(queries.routes.text, /JOIN routes r/);
  assert.match(queries.routes.text, /FROM route_search_terms t/);
  assert.match(queries.routes.text, /COALESCE\(area_rows\.areas, '\[\]'::json\) AS areas/);
  assert.match(queries.areas.text, /FROM areas a/);
  assert.match(queries.areas.text, /destination_count/);
  assert.match(queries.areas.text, /route_count/);
  assert.match(queries.lists.text, /FROM lists l/);
  assert.match(queries.lists.text, /FROM list_routes lr/);
});

test("mixed search keeps two-letter abbreviation input as a token prefix", () => {
  const queries = buildMixedSearchQueries({ normalizedQuery: "bridge", rawQuery: " Br ", limit: 20 });
  for (const query of [queries.destinations, queries.routes, queries.areas, queries.lists]) {
    assert.equal(query.values[0], "br");
    assert.equal(query.values[1], "br%");
  }
  assert.equal(queries.routes.values[2], "br:*");
  assert.match(queries.routes.text, /to_tsvector\('simple', t\.term\) @@ to_tsquery\('simple', \$3::text\)/);
  const abbreviation = buildMixedSearchQueries({ normalizedQuery: "mount", rawQuery: "Mt", limit: 20 });
  assert.equal(abbreviation.routes.values[0], "mount", "an abbreviation with a different prefix still expands");
  const phrase = buildMixedSearchQueries({ normalizedQuery: "mount si", rawQuery: "Mt Si", limit: 20 });
  assert.equal(phrase.routes.values[0], "mount si", "longer phrases still expand abbreviations");
});

test("route search scores narrow term rows before loading route rows", () => {
  const queries = buildMixedSearchQueries({
    normalizedQuery: "silver peak",
    rawQuery: "silver peak",
    lat: 47.64,
    lng: -122.35,
    limit: 20,
  });

  const sql = queries.routes.text;
  const matchedIndex = sql.indexOf("matched_route_ids AS MATERIALIZED");
  const shortlistIndex = sql.indexOf("shortlist AS MATERIALIZED");
  const routeJoinIndex = sql.indexOf("JOIN routes r ON r.id = s.id");

  assert.ok(matchedIndex >= 0, "expected a materialized matched route set");
  assert.ok(shortlistIndex > matchedIndex, "expected a shortlist after matching");
  assert.ok(routeJoinIndex > shortlistIndex, "expected route rows only after the shortlist");
  assert.match(sql, /t\.term % \$1 OR t\.term %> \$1 OR t\.term LIKE \$3/);
  assert.match(sql, /LIMIT 200/);
  assert.match(sql, /r\.status = 'active'/);
  assert.match(sql, /s\.owner = 'peaks'/, "access narrows the shortlist");
  assert.match(sql, /r\.owner = 'peaks'/, "access is rechecked on the routes row");
  assert.doesNotMatch(sql, /peaks_search_names?\(/, "no per-row name normalization at query time");
  assert.doesNotMatch(sql, /candidate_route_ids|matched_terms|route_segments/);
  assert.doesNotMatch(sql, /t\.public/, "signed-in search reads every term");
  assert.match(sql, /ST_Distance\(s\.anchor, ST_MakePoint\(\$7, \$6\)::geography\)/);
  assert.doesNotMatch(sql, /r\.path/, "proximity never reads the route path");
});

test("signed-out route search skips private destination names", () => {
  const query = buildMixedSearchQueries({ normalizedQuery: "hidden tarn", rawQuery: "hidden tarn", limit: 20, publicOnly: true }).routes;
  const matched = query.text.slice(query.text.indexOf("matched_route_ids"), query.text.indexOf("scored_routes"));
  const scored = query.text.slice(query.text.indexOf("scored_routes"), query.text.indexOf("shortlist"));
  assert.match(matched, /AND t\.public/);
  assert.match(scored, /AND t\.public/);
});

test("2-character route search uses token prefixes instead of trigram scans", () => {
  const queries = buildMixedSearchQueries({
    normalizedQuery: "ra",
    rawQuery: "Ra",
    limit: 20,
  });

  const matched = queries.routes.text.slice(0, queries.routes.text.indexOf("scored_routes"));
  assert.match(matched, /to_tsvector\('simple', t\.term\) @@ to_tsquery\('simple', \$3::text\)/);
  assert.doesNotMatch(matched, /% \$1/);
  // Candidate selection must stay index-backed. The word-start bonus may use an
  // infix LIKE only when scoring matched routes.
  assert.doesNotMatch(matched, /LIKE \('% '/);
  assert.match(queries.routes.text, /LIMIT 200/);
  assert.equal(queries.routes.values[2], "ra:*");
});

test("2-character area search uses contiguous prefix parameters", () => {
  const query = buildAreaSearchQuery({
    normalizedQuery: "ra",
    rawQuery: "Ra",
    limit: 20,
  });

  assert.match(query.text, /a\.search_name LIKE \$2/);
  assert.match(query.text, /LIMIT \$3/);
  assert.doesNotMatch(query.text, /% \$1/);
  assert.deepEqual(query.values, ["ra", "ra%", 20, []]);
});

test("route search scores every term of a matched route and keeps the access check", () => {
  const query = buildMixedSearchQueries({ normalizedQuery: "ingalls way", rawQuery: "Ingalls Way", limit: 20 }).routes;
  assert.match(query.text, /JOIN route_search_terms t ON t\.route_id = m\.route_id/);
  assert.match(query.text, /bool_or\(t\.term = \$1\) AS exact_match/);
  assert.match(query.text, /r\.owner = 'peaks'\s+OR \(\$5 <> '' AND r\.owner = \$5\)/);
  assert.deepEqual(query.values, ["ingalls way", "ingalls way%", "%ingalls way%", 20, ""]);
});

test("list search excludes another user's private lists", () => {
  const query = buildListSearchQuery({ normalizedQuery: "cascades", rawQuery: "Cascades", limit: 20, uid: "viewer" });
  assert.match(query.text, /l\.owner = 'peaks' OR \(\$4 <> '' AND l\.owner = \$4\)/);
  assert.deepEqual(query.values, ["cascades", "cascades%", 20, "viewer"]);
});

test("area search expands Mt Baker Snoqualmie to PAD-US split forest records", () => {
  const query = buildAreaSearchQuery({
    normalizedQuery: "baker snoqualmie",
    rawQuery: "Baker Snoqualmie",
    limit: 20,
  });

  assert.match(query.text, /a\.search_name = ANY\(\$4::text\[\]\)/);
  assert.doesNotMatch(whereClause(query.text), /lower\(a\.name\)/);
  assert.match(query.text, /0\.85/);
  assert.deepEqual(query.values, [
    "baker snoqualmie",
    "baker snoqualmie%",
    20,
    ["mount baker national forest", "snoqualmie national forest"],
  ]);
});

test("search route without explicit coordinates skips IP geolocation", async (t) => {
  let capturedSql = "";
  let fetchCount = 0;
  const fakeClient = {
    query: async (text: string) => {
      if (text === "SELECT pg_backend_pid() AS pid") {
        return { rows: [{ pid: 246 }] };
      }
      capturedSql = text;
      return { rows: [] };
    },
    release: () => undefined,
  };
  t.mock.method(db, "connect", async () => fakeClient);
  t.mock.method(globalThis, "fetch", async () => {
    fetchCount += 1;
    throw new Error("IP geolocation should not run for search");
  });

  const req = Object.assign(new EventEmitter(), {
    query: { q: "Rainier" },
    headers: { "x-forwarded-for": "8.8.8.8" },
    socket: { remoteAddress: "8.8.8.8" },
  });
  const res = new FakeResponse();
  const handler = getSearchRouteHandler();

  await handler(req, res, (error?: unknown) => {
    if (error) {
      throw error;
    }
  });

  assert.equal(fetchCount, 0);
  assert.match(capturedSql, /FROM destinations/);
  assert.deepEqual(res.jsonBody, []);
});

test("mixed search route returns typed result buckets", async (t) => {
  const fakeClient = {
    query: async (text: string) => {
      if (text === "SELECT pg_backend_pid() AS pid") {
        return { rows: [{ pid: 246 }] };
      }
      // Area counts also join routes, so match the route query's own CTE.
      if (/FROM ranked_routes r/.test(text)) {
        return { rows: [{ id: "disappointment-cleaver", name: "Disappointment Cleaver", areas: [], score: 0.5 }] };
      }
      if (/FROM destinations/.test(text)) {
        return { rows: [{ id: "rainier", name: "Mount Rainier", areas: [], type: "point", score: 0.9 }] };
      }
      if (/FROM areas a/.test(text)) {
        return { rows: [{ id: "mora", name: "Mount Rainier National Park", kind: "national_park", score: 0.7 }] };
      }
      return { rows: [] };
    },
    release: () => undefined,
  };
  t.mock.method(db, "connect", async () => fakeClient);

  const req = Object.assign(new EventEmitter(), {
    query: { q: "Rainier", limit: "20" },
    headers: {},
    socket: {},
  });
  const res = new FakeResponse();
  const handler = getMixedSearchRouteHandler();

  await handler(req, res, (error?: unknown) => {
    if (error) {
      throw error;
    }
  });

  const body = res.jsonBody as any;
  assert.deepEqual(body.destinations, [{ id: "rainier", name: "Mount Rainier", areas: [], type: "point", score: 0.9 }]);
  assert.deepEqual(body.routes, [{ id: "disappointment-cleaver", name: "Disappointment Cleaver", areas: [], score: 0.5 }]);
  assert.deepEqual(body.areas, [{ id: "mora", name: "Mount Rainier National Park", kind: "national_park", score: 0.7 }]);
  assert.deepEqual(body.lists, []);
  assert.deepEqual(body.results.map((row: any) => [row.type, row.id]), [
    ["destination", "rainier"], ["area", "mora"], ["route", "disappointment-cleaver"],
  ]);
  assert.equal(body.results[0].data.type, "point", "destination geographic type stays intact");
});

test("mixed search exposes route failures as 500 instead of an empty route bucket", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const fakeClient = {
    query: async (text: string) => {
      if (text === "SELECT pg_backend_pid() AS pid") {
        return { rows: [{ pid: 246 }] };
      }
      if (/FROM ranked_routes r/.test(text)) {
        throw Object.assign(new Error("argument of OR must be type boolean, not type text"), { code: "42804" });
      }
      if (/FROM destinations/.test(text)) {
        return { rows: [{ id: "rainier", name: "Mount Rainier", areas: [] }] };
      }
      if (/FROM areas a/.test(text)) {
        return { rows: [{ id: "mora", name: "Mount Rainier National Park", kind: "national_park" }] };
      }
      return { rows: [] };
    },
    release: () => undefined,
  };
  t.mock.method(db, "connect", async () => fakeClient);

  const req = Object.assign(new EventEmitter(), {
    query: { q: "Rainier", limit: "20" },
    headers: {},
    socket: {},
  });
  const res = new FakeResponse();
  const handler = getMixedSearchRouteHandler();

  await handler(req, res, (error?: unknown) => {
    if (error) {
      throw error;
    }
  });

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.jsonBody, { error: "Search failed" });
});

test("mixed search keeps area failures optional and continues to lists", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const queries = buildMixedSearchQueries({ normalizedQuery: "si", rawQuery: "Si", limit: 20 });
  const fakeClient = {
    query: async (sql: string) => {
      if (sql === "SELECT pg_backend_pid() AS pid") return { rows: [{ pid: 246 }] };
      if (sql === queries.areas.text) throw new Error("area query failed");
      if (sql === queries.lists.text) return { rows: [{ id: "si-hikes", name: "Si Hikes", score: 0.6 }] };
      return { rows: [] };
    },
    release: () => undefined,
  };
  const result = await runMixedSearchQueries(new FakeResponse() as never, queries, { connect: async () => fakeClient });
  assert.deepEqual(result?.areas, []);
  assert.equal(result?.results[0].type, "list");
  assert.equal(result?.results[0].id, "si-hikes");
});

test("mixed search cancels the active backend query when the client disconnects", async () => {
  const queryStarted = deferred<void>();
  const queryDeferred = deferred<{ rows: unknown[] }>();
  const executedSql: string[] = [];
  const canceledPids: number[] = [];
  let releaseCount = 0;
  const fakeClient = {
    query: async (text: string) => {
      executedSql.push(text);
      if (text === "SELECT pg_backend_pid() AS pid") {
        return { rows: [{ pid: 741 }] };
      }
      queryStarted.resolve();
      return queryDeferred.promise;
    },
    release: () => {
      releaseCount += 1;
    },
  };
  const fakePool = { connect: async () => fakeClient };
  const res = new FakeResponse();
  const queries = buildMixedSearchQueries({
    normalizedQuery: "campo",
    rawQuery: "campo",
    limit: 20,
  });

  const searchPromise = runMixedSearchQueries(
    res as never,
    queries,
    fakePool as never,
    async (pid) => {
      canceledPids.push(pid);
    }
  );

  await queryStarted.promise;
  res.emit("close");
  const cancelError = new Error("canceling statement due to user request") as Error & { code: string };
  cancelError.code = "57014";
  queryDeferred.reject(cancelError);

  assert.equal(await searchPromise, undefined);
  assert.deepEqual(canceledPids, [741]);
  assert.equal(releaseCount, 1);
  assert.equal(executedSql.length, 2, "route and area buckets must not start after cancellation");
});

test("search route does not start DB work or write after response closes before pool checkout", async (t) => {
  const connectStarted = deferred<void>();
  const connectDeferred = deferred<any>();
  let connectCount = 0;
  const fakeClient = {
    query: async (text: string) => {
      if (text === "SELECT pg_backend_pid() AS pid") {
        return { rows: [{ pid: 246 }] };
      }
      return { rows: [{ id: "rainier" }] };
    },
    release: () => undefined,
  };
  t.mock.method(db, "connect", async () => {
    connectCount += 1;
    connectStarted.resolve();
    return connectDeferred.promise;
  });
  const req = Object.assign(new EventEmitter(), {
    query: { q: "Rainier" },
    headers: { "x-forwarded-for": "8.8.8.8" },
    socket: { remoteAddress: "8.8.8.8" },
  });
  const res = new FakeResponse();
  const handler = getSearchRouteHandler();

  const handlerPromise = handler(req, res, (error?: unknown) => {
    if (error) {
      throw error;
    }
  });

  await connectStarted.promise;
  res.emit("close");
  connectDeferred.resolve(fakeClient);
  await handlerPromise;

  assert.equal(connectCount, 1);
  assert.equal(res.statusCode, undefined);
  assert.equal(res.jsonBody, undefined);
});

test("feature search selects destination display location fields", async (t) => {
  let capturedSql = "";
  t.mock.method(db, "query", async (text: string) => {
    capturedSql = text;
    return { rows: [] };
  });

  const req = { query: { features: "summit", limit: "1" } };
  const res = new FakeResponse();
  const handler = getSearchFeaturesRouteHandler();

  await handler(req, res, (error?: unknown) => {
    if (error) {
      throw error;
    }
  });

  assertSelectsDestinationDisplayLocation(capturedSql);
  assert.deepEqual(res.jsonBody, []);
});

test("runSearchQuery starts backend cancellation when response closes during the search query", async () => {
  const queryStarted = deferred<void>();
  const queryDeferred = deferred<{ rows: unknown[] }>();
  let releaseCount = 0;
  const canceledPids: number[] = [];
  const fakeClient = {
    query: async (text: string) => {
      if (text === "SELECT pg_backend_pid() AS pid") {
        return { rows: [{ pid: 654 }] };
      }
      queryStarted.resolve();
      return queryDeferred.promise;
    },
    release: () => {
      releaseCount += 1;
    },
  };
  const fakePool = { connect: async () => fakeClient };
  const res = new FakeResponse();

  const searchPromise = runSearchQuery(
    {} as never,
    res as never,
    { text: "SELECT pg_sleep(30)", values: [] },
    fakePool as never,
    async (pid) => {
      canceledPids.push(pid);
    }
  );

  await queryStarted.promise;
  res.emit("close");
  const cancelError = new Error("canceling statement due to user request") as Error & { code: string };
  cancelError.code = "57014";
  queryDeferred.reject(cancelError);
  await searchPromise;

  assert.deepEqual(canceledPids, [654]);
  assert.equal(releaseCount, 1);
});

test("runSearchQuery waits for backend cancellation to settle before releasing the pool client", async () => {
  const queryStarted = deferred<void>();
  const queryDeferred = deferred<{ rows: unknown[] }>();
  const cancelDeferred = deferred<void>();
  const events: string[] = [];
  const fakeClient = {
    query: async (text: string) => {
      if (text === "SELECT pg_backend_pid() AS pid") {
        return { rows: [{ pid: 777 }] };
      }
      queryStarted.resolve();
      return queryDeferred.promise;
    },
    release: () => {
      events.push("release");
    },
  };
  const fakePool = { connect: async () => fakeClient };
  const res = new FakeResponse();

  const searchPromise = runSearchQuery(
    {} as never,
    res as never,
    { text: "SELECT pg_sleep(30)", values: [] },
    fakePool as never,
    async () => {
      events.push("cancel-start");
      await cancelDeferred.promise;
      events.push("cancel-done");
    }
  );

  await queryStarted.promise;
  res.emit("close");
  const cancelError = new Error("canceling statement due to user request") as Error & { code: string };
  cancelError.code = "57014";
  queryDeferred.reject(cancelError);

  const earlyResult = await Promise.race([
    searchPromise.then(() => "settled"),
    new Promise<"pending">((resolve) => setImmediate(() => resolve("pending"))),
  ]);

  assert.equal(earlyResult, "pending");
  assert.deepEqual(events, ["cancel-start"]);

  cancelDeferred.resolve();
  await searchPromise;

  assert.deepEqual(events, ["cancel-start", "cancel-done", "release"]);
});

test("runSearchQuery does not cancel after a successful open response", async () => {
  let releaseCount = 0;
  let cancelCount = 0;
  const fakeClient = {
    query: async (text: string) => {
      if (text === "SELECT pg_backend_pid() AS pid") {
        return { rows: [{ pid: 321 }] };
      }
      return { rows: [{ id: "rainier" }] };
    },
    release: () => {
      releaseCount += 1;
    },
  };
  const fakePool = { connect: async () => fakeClient };
  const res = new FakeResponse();

  await runSearchQuery(
    {} as never,
    res as never,
    { text: "SELECT * FROM destinations", values: [] },
    fakePool as never,
    async () => {
      cancelCount += 1;
    }
  );

  assert.deepEqual(res.jsonBody, [{ id: "rainier" }]);
  assert.equal(cancelCount, 0);
  assert.equal(releaseCount, 1);
});

test("runSearchQuery does not write JSON after the response is closed", async () => {
  const queryStarted = deferred<void>();
  const queryDeferred = deferred<{ rows: unknown[] }>();
  let releaseCount = 0;
  const fakeClient = {
    query: async (text: string) => {
      if (text === "SELECT pg_backend_pid() AS pid") {
        return { rows: [{ pid: 888 }] };
      }
      queryStarted.resolve();
      return queryDeferred.promise;
    },
    release: () => {
      releaseCount += 1;
    },
  };
  const fakePool = { connect: async () => fakeClient };
  const res = new FakeResponse();

  const searchPromise = runSearchQuery(
    {} as never,
    res as never,
    { text: "SELECT * FROM destinations", values: [] },
    fakePool as never,
    async () => undefined
  );

  await queryStarted.promise;
  res.emit("close");
  queryDeferred.resolve({ rows: [{ id: "rainier" }] });
  await searchPromise;

  assert.equal(res.statusCode, undefined);
  assert.equal(res.jsonBody, undefined);
  assert.equal(releaseCount, 1);
});

test("runSearchQuery suppresses PostgreSQL cancellation errors after response close", async (t) => {
  const queryStarted = deferred<void>();
  const queryDeferred = deferred<{ rows: unknown[] }>();
  const errorMock = t.mock.method(console, "error", () => undefined);
  const fakeClient = {
    query: async (text: string) => {
      if (text === "SELECT pg_backend_pid() AS pid") {
        return { rows: [{ pid: 999 }] };
      }
      queryStarted.resolve();
      return queryDeferred.promise;
    },
    release: () => undefined,
  };
  const fakePool = { connect: async () => fakeClient };
  const res = new FakeResponse();

  const searchPromise = runSearchQuery(
    {} as never,
    res as never,
    { text: "SELECT pg_sleep(30)", values: [] },
    fakePool as never,
    async () => undefined
  );

  await queryStarted.promise;
  res.emit("close");
  const cancelError = new Error("canceling statement due to user request") as Error & { code: string };
  cancelError.code = "57014";
  queryDeferred.reject(cancelError);
  await searchPromise;

  assert.equal(errorMock.mock.calls.length, 0);
  assert.equal(res.jsonBody, undefined);
});

test("runSearchQuery returns 500 for unexpected DB errors while response is open", async (t) => {
  const errorMock = t.mock.method(console, "error", () => undefined);
  let releaseCount = 0;
  const fakeClient = {
    query: async (text: string) => {
      if (text === "SELECT pg_backend_pid() AS pid") {
        return { rows: [{ pid: 123 }] };
      }
      throw new Error("database unavailable");
    },
    release: () => {
      releaseCount += 1;
    },
  };
  const fakePool = { connect: async () => fakeClient };
  const res = new FakeResponse();

  await runSearchQuery(
    {} as never,
    res as never,
    { text: "SELECT * FROM destinations", values: [] },
    fakePool as never,
    async () => undefined
  );

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.jsonBody, { error: "Search failed" });
  assert.equal(errorMock.mock.calls.length, 1);
  assert.equal(releaseCount, 1);
});

test("runSearchQuery releases without PID or search query work if response closes while waiting for a pool client", async () => {
  const executedSql: string[] = [];
  let releaseCount = 0;
  const fakeClient = {
    query: async (text: string) => {
      executedSql.push(text);
      return { rows: [{ pid: 123 }] };
    },
    release: () => {
      releaseCount += 1;
    },
  };
  const connectDeferred = deferred<typeof fakeClient>();
  const fakePool = { connect: async () => connectDeferred.promise };
  const res = new FakeResponse();

  const searchPromise = runSearchQuery(
    {} as never,
    res as never,
    { text: "SELECT * FROM destinations", values: [] },
    fakePool as never,
    async () => undefined
  );

  res.emit("close");
  connectDeferred.resolve(fakeClient);
  await searchPromise;

  assert.deepEqual(executedSql, []);
  assert.equal(releaseCount, 1);
  assert.equal(res.jsonBody, undefined);
});
