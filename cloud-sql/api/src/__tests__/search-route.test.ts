import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import db from "../db";
import searchRouter, {
  buildAreaSearchQuery,
  buildDestinationSearchQuery,
  buildMixedSearchQueries,
  clampSearchLimit,
  mergeMixedSearchResults,
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
  assert.match(query.text, /WHERE search_name % \$1\s+OR search_name LIKE \$2/);
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
  assert.match(query.text, /WHERE search_name % \$1\s+OR search_name LIKE \$4/);
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

test("mixed search builds destination, route, and area queries", () => {
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
  assert.match(queries.routes.text, /route_destinations/);
  assert.match(queries.routes.text, /COALESCE\(area_rows\.areas, '\[\]'::json\) AS areas/);
  assert.match(queries.areas.text, /FROM areas a/);
  assert.match(queries.areas.text, /destination_count/);
  assert.match(queries.areas.text, /route_count/);
});

test("mixed search ranks every type on the same text terms without changing bucket order", () => {
  const queries = buildMixedSearchQueries({ normalizedQuery: "rainier", rawQuery: "Rainier", limit: 20 });
  for (const [bucket, query] of Object.entries(queries)) {
    // rank_score is the shared cross-type scale: the same text-match terms...
    assert.match(query.text, /similarity\([^\n]+\* 0\.70/, bucket);
    assert.match(query.text, /THEN 0\.20 ELSE 0 END/, bucket);
    assert.match(query.text, /THEN 1\.0 ELSE/, bucket);
    assert.match(query.text, /AS rank_score/, bucket);
    // ...while score keeps the legacy per-bucket order old clients read.
    assert.match(query.text, /\) AS score/, bucket);
  }
  assert.match(queries.destinations.text, /similarity\(search_name, \$1\) \* 0\.60/);
  assert.match(queries.areas.text, /similarity\(a\.search_name, \$1\) \* 0\.70\s+\+ CASE/);
});

test("mixed search binds every parameter for short, full, and geo queries", () => {
  for (const normalizedQuery of ["ra", "rainier", "baker snoqualmie", "r-"]) {
    for (const geo of [{}, { lat: 46.85, lng: -121.7 }]) {
      const queries = buildMixedSearchQueries({ normalizedQuery, rawQuery: normalizedQuery, limit: 20, ...geo });
      for (const query of Object.values(queries)) {
        const parameters = [...new Set([...query.text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
        assert.deepEqual(parameters, query.values.map((_, i) => i + 1), `${normalizedQuery}: every binding must be typed by the SQL`);
      }
    }
  }
});

test("short mixed scores use float8 rather than the numeric wire-string type", () => {
  const queries = buildMixedSearchQueries({ normalizedQuery: "ra", rawQuery: "Ra", limit: 20 });
  for (const query of Object.values(queries)) {
    assert.match(query.text, /::double precision/);
  }
});

test("route search matches aliases, objectives, and physical trail names", () => {
  const { routes: query } = buildMixedSearchQueries({ normalizedQuery: "ingalls way", rawQuery: "Ingalls Way", limit: 20 });
  assert.match(query.text, /candidate_r\.search_name % \$1/);
  // Alias and trail-name candidates go through the indexed expression only.
  assert.match(query.text, /alias_r\.aliases <> '\{\}'\s+AND \$1 <% peaks_search_names_text\(alias_r\.aliases\)/);
  assert.match(query.text, /candidate_s\.trail_names <> '\{\}'\s+AND \$1 <% peaks_search_names_text\(candidate_s\.trail_names\)/);
  assert.doesNotMatch(query.text, /unnest\(candidate_r\.aliases\)|unnest\(candidate_s\.trail_names\)/);
  assert.match(query.text, /objective_r\.objective_destination_id = candidate_d\.id/);
  assert.match(query.text, /JOIN route_segments candidate_rs ON candidate_rs\.segment_id = candidate_s\.id/);
  assert.match(query.text, /MAX\(/);
  for (const field of ["kind", "slug", "aliases", "objective_destination_id", "trailhead_destination_id", "difficulty", "est_moving_seconds", "state_code", "country_code", "description", "description_source_name", "description_source_url", "description_source_license", "popularity"]) {
    assert.equal(query.text.split(`r.${field}`).length - 1 >= 2, true, `${field} must reach the outer route rows`);
  }
});

test("route search never evaluates a per-row function over the whole routes table", () => {
  const { routes: query } = buildMixedSearchQueries({ normalizedQuery: "ingals", rawQuery: "Ingals", limit: 20 });
  assert.doesNotMatch(query.text, /peaks_normalize_search_name\(candidate_r\.name\)/);
  const { routes: short } = buildMixedSearchQueries({ normalizedQuery: "in", rawQuery: "In", limit: 20 });
  assert.doesNotMatch(short.text, /<%/, "two-letter queries skip trigram word similarity");
});

test("merged results include every bucket row once and sort comparable scores", () => {
  const results = mergeMixedSearchResults({
    destinations: [{ id: "same-id", score: 0.6 }],
    routes: [{ id: "same-id", score: 0.9 }],
    areas: [{ id: "area", score: 0.8 }],
  });
  assert.deepEqual(results.map(({ type, id }) => ({ type, id })), [
    { type: "route", id: "same-id" }, { type: "area", id: "area" }, { type: "destination", id: "same-id" },
  ]);
  assert.ok(results.every((row) => row.score >= 0 && row.score <= 1));
  assert.equal(new Set(results.map((row) => `${row.type}:${row.id}`)).size, 3);
});

test("destination routes beat their objective and summit routes follow theirs, even at score bounds", () => {
  const results = mergeMixedSearchResults({
    destinations: [{ id: "lake", score: 1 }, { id: "summit", score: 0 }],
    routes: [
      { id: "lake-trail", score: 0.3, kind: "destination", objective_destination_id: "lake" },
      { id: "summit-trail", score: 1, kind: "summit", objective_destination_id: "summit" },
      { id: "other-trail", score: 0.5, kind: "destination", objective_destination_id: "absent" },
    ],
    areas: [],
  });
  assert.deepEqual(results.map((row) => row.id), ["lake-trail", "lake", "other-trail", "summit", "summit-trail"]);
  assert.ok(results.every((row) => row.score >= 0 && row.score <= 1));
  assert.ok(results.every((row, i) => i === 0 || results[i - 1].score >= row.score));
});

test("merged results keep bucket popularity order on text-score ties", () => {
  const results = mergeMixedSearchResults({
    destinations: [], areas: [],
    routes: [{ id: "popular", score: 1, popularity: 20 }, { id: "less-popular", score: 1, popularity: 1 }],
  });
  assert.deepEqual(results.map((row) => row.id), ["popular", "less-popular"]);
});

test("route search narrows candidate IDs before loading route geometry", () => {
  const queries = buildMixedSearchQueries({
    normalizedQuery: "silver peak",
    rawQuery: "silver peak",
    lat: 47.64,
    lng: -122.35,
    limit: 20,
  });

  const sql = queries.routes.text;
  const candidateIndex = sql.indexOf("candidate_route_ids AS MATERIALIZED");
  const routeJoinIndex = sql.indexOf("JOIN routes r ON r.id = candidate.id");
  const destinationTextIndex = sql.indexOf("SELECT MAX(");

  assert.ok(candidateIndex >= 0, "expected a materialized candidate route set");
  assert.ok(routeJoinIndex > candidateIndex, "expected route rows after the candidate set");
  assert.ok(destinationTextIndex > routeJoinIndex, "expected destination text only for candidate routes");
  assert.match(sql, /candidate_d\.search_name % \$1/);
  assert.match(sql, /candidate_rd\.destination_id = candidate_d\.id/);
  assert.doesNotMatch(sql, /missing_d|missing_rd/);
  assert.match(sql, /linked_r\.status = 'active'/);
  assert.doesNotMatch(sql, /WHERE route_dest_names\.names.*% \$1/s);
});

test("2-character route search uses prefix candidates instead of trigram scans", () => {
  const queries = buildMixedSearchQueries({
    normalizedQuery: "ra",
    rawQuery: "Ra",
    limit: 20,
  });

  assert.match(queries.routes.text, /candidate_d\.search_name LIKE \$2/);
  assert.doesNotMatch(queries.routes.text, /% \$1/);
  assert.doesNotMatch(queries.routes.text, /similarity\(/);
  assert.match(queries.routes.text, /candidate_r\.search_name LIKE \$2/);
});

test("2-character area search uses contiguous prefix parameters", () => {
  const query = buildAreaSearchQuery({
    normalizedQuery: "ra",
    rawQuery: "Ra",
    limit: 20,
  });

  assert.match(query.text, /a\.search_name LIKE \$1/);
  assert.match(query.text, /lower\(a\.name\) LIKE \$2/);
  assert.match(query.text, /LIMIT \$3/);
  assert.doesNotMatch(query.text, /% \$1/);
  assert.deepEqual(query.values, ["ra%", "ra%", 10]);
});

test("area search expands Mt Baker Snoqualmie to PAD-US split forest records", () => {
  const query = buildAreaSearchQuery({
    normalizedQuery: "baker snoqualmie",
    rawQuery: "Baker Snoqualmie",
    limit: 20,
  });

  assert.match(query.text, /a\.search_name = ANY\(\$5::text\[\]\)/);
  assert.doesNotMatch(whereClause(query.text), /lower\(a\.name\)/);
  assert.match(query.text, /GREATEST\([\s\S]*THEN 0\.85 ELSE 0 END\)/);
  assert.deepEqual(query.values, [
    "baker snoqualmie",
    "baker snoqualmie%",
    "baker snoqualmie%",
    10,
    ["mt baker national forest", "snoqualmie national forest"],
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
      if (/JOIN routes r/.test(text)) {
        return { rows: [{ id: "disappointment-cleaver", name: "Disappointment Cleaver", areas: [] }] };
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

  assert.deepEqual(res.jsonBody, {
    destinations: [{ id: "rainier", name: "Mount Rainier", areas: [] }],
    routes: [{ id: "disappointment-cleaver", name: "Disappointment Cleaver", areas: [] }],
    areas: [{ id: "mora", name: "Mount Rainier National Park", kind: "national_park" }],
    results: [
      { type: "destination", id: "rainier", score: 0.01 },
      { type: "route", id: "disappointment-cleaver", score: 0.01 },
      { type: "area", id: "mora", score: 0.01 },
    ],
  });
});

test("mixed search degrades secondary buckets to empty on failure instead of 500", async (t) => {
  const errorMock = t.mock.method(console, "error", () => undefined);
  const fakeClient = {
    query: async (text: string) => {
      if (text === "SELECT pg_backend_pid() AS pid") {
        return { rows: [{ pid: 246 }] };
      }
      if (/JOIN routes r/.test(text)) {
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

  assert.notEqual(res.statusCode, 500);
  assert.deepEqual(res.jsonBody, {
    destinations: [{ id: "rainier", name: "Mount Rainier", areas: [] }],
    routes: [],
    areas: [{ id: "mora", name: "Mount Rainier National Park", kind: "national_park" }],
    results: [
      { type: "destination", id: "rainier", score: 0.01 },
      { type: "area", id: "mora", score: 0.01 },
    ],
  });
  assert.equal(errorMock.mock.calls.length, 1);
  assert.equal(errorMock.mock.calls[0].arguments[0], "Mixed search routes bucket failed");
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
