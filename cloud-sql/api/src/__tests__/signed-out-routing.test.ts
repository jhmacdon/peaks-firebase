import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { app, signedOutCatalogPaths } from "../index";
import db from "../db";
import { appRequest } from "./helpers/app-request";

const allowed = [
  "/destinations/nearby", "/destinations/viewport", "/destinations/averages",
  "/destinations/:id", "/destinations/:id/lists", "/destinations/:id/routes",
  "/lists/popular", "/lists/by-destinations", "/lists/:id", "/lists/:id/destinations",
  "/search", "/search/all", "/search/features", "/routes/near", "/routes/:id",
  "/routes/:id/destinations", "/routes/:id/sections", "/routes/:id/elevation", "/areas/:id",
];
afterEach(() => mock.restoreAll());

test("every registered non-allowlisted API route and every non-GET method requires auth", async () => {
  const logs = mock.method(console, "log", () => undefined);
  assert.deepEqual([...signedOutCatalogPaths].sort(), [...allowed].sort());
  const directory = join(__dirname, "../routes");
  let checked = 0;
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".ts") && !name.startsWith("public-"))) {
    const source = readFileSync(join(directory, file), "utf8");
    const mount = `/${file.replace(/\.ts$/, "")}`;
    assert.ok(readFileSync(join(__dirname, "../index.ts"), "utf8").includes(`"/api${mount}"`), `unmounted ${file}`);
    for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
      const path = mount + (match[2] === "/" ? "" : match[2]);
      const url = "/api" + path.replace(/:[^/]+/g, "fixture");
      const methods = new Set([match[1].toUpperCase(), "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
      for (const method of methods) {
        if (method === "GET" && allowed.includes(path)) continue;
        assert.equal((await appRequest(app, method, url)).status, 401, `${method} ${path}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 300, "the route inventory must include every API router");
  assert.equal((await appRequest(app, "GET", "/api/not-a-catalog-route")).status, 401);
  assert.equal(logs.mock.callCount(), 0, "401s must not count as signed-out catalog traffic");
});

test("each allowlisted handler accepts no uid and logs once without query text", async () => {
  const logs = mock.method(console, "log", () => undefined);
  const query = async () => ({ rows: [{ id: "public", name: "Public peak", owner: "peaks" }], rowCount: 1 });
  mock.method(db, "query", query);
  mock.method(db, "connect", async () => ({ query, release() {} }));
  const params = "?lat=47&lng=-122&minLat=46&maxLat=48&minLng=-123&maxLng=-121&q=peak&features=summit&ids=public";
  for (const path of allowed) {
    const url = `/api${path.replace(":id", "public")}`;
    assert.equal((await appRequest(app, "GET", url + params, { "X-Forwarded-For": "192.0.2.2" })).status, 200, path);
    assert.deepEqual(JSON.parse(logs.mock.calls.at(-1)!.arguments[0]), { event: "signed_out_request", path: url });
  }
  assert.equal(logs.mock.callCount(), allowed.length);
  assert.equal((await appRequest(app, "GET", "/api/lists/popular", { Authorization: "Bearer invalid" })).status, 401);
  assert.equal(logs.mock.callCount(), allowed.length, "invalid tokens must not log");
});

test("allowlist edge paths follow Express matching without opening private handlers", async () => {
  const logs = mock.method(console, "log", () => undefined);
  const queries: { text: string; values?: unknown[] }[] = [];
  const query = async (text: string, values?: unknown[]) => {
    if (text === "SELECT pg_backend_pid() AS pid") return { rows: [{ pid: 123 }] };
    queries.push({ text, values });
    return { rows: [{ id: "public", owner: "peaks" }] };
  };
  mock.method(db, "query", query);
  mock.method(db, "connect", async () => ({ query, release() {} }));
  const headers = { "X-Forwarded-For": "192.0.2.4" };
  for (const path of [
    "/api/lists/", "/api/routes/x/sessions/mine", "/api",
    "/api/", "/api/search/%61ll", "/api/%73earch/all",
  ]) {
    assert.equal((await appRequest(app, "GET", path, headers)).status, 401, path);
  }
  assert.equal(queries.length, 0);
  assert.equal(logs.mock.callCount(), 0);
  for (const path of ["/api/search/all/?q=peak", "/API/SEARCH/ALL?q=peak"]) {
    const response = await appRequest(app, "GET", path, headers);
    assert.equal(response.status, 200, path);
    assert.equal(response.body.destinations[0].id, "public");
  }
  // Express decodes parameter values, not literal route segments: this is a
  // public destination ID lookup, never the /nearby handler.
  queries.length = 0;
  const encoded = await appRequest(app, "GET", "/api/destinations/%6eearby", headers);
  assert.equal(encoded.status, 200);
  assert.deepEqual(queries[0].values, ["nearby"]);
  assert.match(queries[0].text, /d\.owner = 'peaks'/);
  assert.equal(logs.mock.callCount(), 3);
});

test("mixed search and destination routes apply catalog filters only when signed out", async () => {
  mock.method(console, "log", () => undefined);
  const queries: { text: string; values?: unknown[] }[] = [];
  const query = async (text: string, values?: unknown[]) => {
    if (text === "SELECT pg_backend_pid() AS pid") return { rows: [{ pid: 123 }] };
    queries.push({ text, values });
    return { rows: [{ id: "public" }] };
  };
  mock.method(db, "query", query);
  mock.method(db, "connect", async () => ({ query, release() {} }));

  for (const uid of ["", "member"]) {
    const headers: Record<string, string> = { "X-Forwarded-For": "192.0.2.3" };
    if (uid) headers["X-Test-User"] = uid;
    const assertVisibility = uid ? assert.doesNotMatch : assert.match;
    for (const params of ["q=peak", "q=pe", "q=peak&lat=47&lng=-122", "q=pe&lat=47&lng=-122"]) {
      queries.length = 0;
      const response = await appRequest(app, "GET", `/api/search/all?${params}`, headers);
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, {
        destinations: [{ id: "public" }], routes: [{ id: "public" }], areas: [{ id: "public" }],
      });
      assert.equal(queries.length, 3);
      const [destinations, routes, areas] = queries;
      assertVisibility(destinations.text, /destinations\.owner = 'peaks'/);
      // Private linked destination names must not affect discovery or ranking.
      assertVisibility(routes.text, /candidate_d\.owner = 'peaks'/);
      assertVisibility(routes.text, /\bd\.owner = 'peaks'/);
      assertVisibility(routes.text, /cover_destination\.owner = 'peaks'/);
      assert.equal(routes.values?.at(-1), uid);
      assert.match(routes.text, /\$\d <> '' AND r\.owner = \$\d/);
      for (const sql of [destinations.text, routes.text, areas.text]) {
        assertVisibility(sql, /a\.source = 'padus' OR a\.owner = 'peaks'/);
        assertVisibility(sql, /catalog_parent\.source = 'padus'/);
      }
      assertVisibility(areas.text, /\bd\.owner = 'peaks'/);
      assertVisibility(areas.text, /\br\.owner = 'peaks'/);
      assertVisibility(areas.text, /r\.status = 'active'/);
    }

    queries.length = 0;
    const response = await appRequest(app, "GET", "/api/destinations/public/routes", headers);
    assert.equal(response.status, 200);
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0].values, ["public", uid]);
    assert.match(queries[0].text, /d\.id = rd\.destination_id/);
    assertVisibility(queries[0].text, /\bd\.owner = 'peaks'/);
    assertVisibility(queries[0].text, /cover_destination\.owner = 'peaks'/);
    assertVisibility(queries[0].text, /a\.source = 'padus' OR a\.owner = 'peaks'/);
    assertVisibility(queries[0].text, /catalog_parent\.source = 'padus'/);
    assert.match(queries[0].text, /\$2 <> '' AND r\.owner = \$2/);
  }
});

test("signed-out IPs get 120 requests per minute, Retry-After, and signed-in callers bypass it", async () => {
  const logs = mock.method(console, "log", () => undefined);
  const path = "/api/destinations/averages"; // An empty ID list requires no database.
  for (let i = 0; i < 120; i++) {
    assert.equal((await appRequest(app, "GET", path, { "X-Forwarded-For": "192.0.2.30" })).status, 200);
  }
  // Changing an untrusted forwarded entry must not evade the last trusted hop.
  const blocked = await appRequest(app, "GET", path, { "X-Forwarded-For": "198.51.100.8, 192.0.2.30" });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers["retry-after"]) > 0);
  assert.equal(logs.mock.callCount(), 120, "429s must not log signed_out_request");
  assert.equal((await appRequest(app, "GET", path, { "X-Forwarded-For": "192.0.2.31" })).status, 200);
  for (let i = 0; i < 121; i++) {
    assert.equal((await appRequest(app, "GET", path, { "X-Forwarded-For": "192.0.2.30", "X-Test-User": "member" })).status, 200);
  }
  assert.equal(logs.mock.callCount(), 121);
});
