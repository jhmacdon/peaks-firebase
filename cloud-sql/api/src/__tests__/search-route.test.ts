import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import db from "../db";
import searchRouter, {
  buildAreaSearchQuery,
  buildDestinationSearchQuery,
  buildMixedSearchQueries,
  clampSearchLimit,
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

test("destination search falls back to destination name when search_name is missing", () => {
  const query = buildDestinationSearchQuery({
    normalizedQuery: "south sis",
    rawQuery: "South sis",
    limit: 20,
  });

  assertSelectsDestinationDisplayLocation(query.text);
  assert.match(query.text, /COALESCE\(NULLIF\(search_name, ''\), lower\(name\)\)/);
  assert.match(query.text, /lower\(name\) ILIKE/);
  assert.match(query.text, /destination_areas da/);
  assert.match(query.text, /JOIN areas a ON a\.id = da\.area_id/);
  assert.match(query.text, /COALESCE\(area_rows\.areas, '\[\]'::json\) AS areas/);
  assert.deepEqual(query.values, ["south sis", "south sis%", "south sis%", 20]);
});

test("geo destination search uses the same name fallback", () => {
  const query = buildDestinationSearchQuery({
    normalizedQuery: "south sis",
    rawQuery: "South sis",
    lat: 44.103,
    lng: -121.769,
    limit: 20,
  });

  assertSelectsDestinationDisplayLocation(query.text);
  assert.match(query.text, /COALESCE\(NULLIF\(search_name, ''\), lower\(name\)\)/);
  assert.match(query.text, /lower\(name\) ILIKE/);
  assert.deepEqual(query.values, ["south sis", 44.103, -121.769, "south sis%", "south sis%", 20]);
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
  assert.doesNotMatch(whereClause(query.text), / ILIKE /);
  assert.equal(
    whereClause(query.text).trim(),
    "to_tsvector('simple', COALESCE(NULLIF(search_name, ''), lower(name))) @@ to_tsquery('simple', $1)"
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
  assert.doesNotMatch(whereClause(query.text), / ILIKE /);
  assert.equal(
    whereClause(query.text).trim(),
    "to_tsvector('simple', COALESCE(NULLIF(search_name, ''), lower(name))) @@ to_tsquery('simple', $1)"
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
  assert.deepEqual(query.values, ["rai", "rai%", "rai%", 20]);
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
  assert.match(queries.routes.text, /FROM routes r/);
  assert.match(queries.routes.text, /route_destinations/);
  assert.match(queries.routes.text, /COALESCE\(area_rows\.areas, '\[\]'::json\) AS areas/);
  assert.match(queries.areas.text, /FROM areas a/);
  assert.match(queries.areas.text, /destination_count/);
  assert.match(queries.areas.text, /route_count/);
});

test("area search expands Mt Baker Snoqualmie to PAD-US split forest records", () => {
  const query = buildAreaSearchQuery({
    normalizedQuery: "baker snoqualmie",
    rawQuery: "Baker Snoqualmie",
    limit: 20,
  });

  assert.match(query.text, /a\.search_name = ANY\(\$5::text\[\]\)/);
  assert.match(query.text, /0\.45/);
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
      if (/FROM destinations/.test(text)) {
        return { rows: [{ id: "rainier", name: "Mount Rainier", areas: [] }] };
      }
      if (/FROM routes r/.test(text)) {
        return { rows: [{ id: "disappointment-cleaver", name: "Disappointment Cleaver", areas: [] }] };
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
  });
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
