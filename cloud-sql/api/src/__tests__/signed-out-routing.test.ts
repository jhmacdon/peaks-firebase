import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { app, signedOutCatalogPaths } from "../index";
import db from "../db";
import { appRequest } from "./helpers/app-request";

const allowed = [
  "/destinations/nearby", "/destinations/viewport", "/destinations/averages",
  "/destinations/:id", "/destinations/:id/lists",
  "/lists/popular", "/lists/by-destinations", "/lists/:id", "/lists/:id/destinations",
  "/search", "/search/features", "/routes/near", "/routes/:id",
  "/routes/:id/destinations", "/routes/:id/sections", "/routes/:id/elevation", "/areas/:id",
];
afterEach(() => mock.restoreAll());

test("every registered non-allowlisted API route and every non-GET method requires auth", async () => {
  mock.method(console, "log", () => undefined);
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
  assert.equal(logs.mock.callCount(), 121);
  assert.equal((await appRequest(app, "GET", path, { "X-Forwarded-For": "192.0.2.31" })).status, 200);
  for (let i = 0; i < 121; i++) {
    assert.equal((await appRequest(app, "GET", path, { "X-Forwarded-For": "192.0.2.30", "X-Test-User": "member" })).status, 200);
  }
  assert.equal(logs.mock.callCount(), 122);
});
