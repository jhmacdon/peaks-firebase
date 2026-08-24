// Express 4 ignores the promise an async handler returns, so a rejected query
// in a bare handler becomes an unhandled rejection — and under Node 20's
// default --unhandled-rejections=throw that kills the whole instance. These
// tests pin the systemic guard: every router wraps its handlers in asyncRoute
// (src/lib/async-route.ts), and the app-level error middleware in index.ts
// turns the forwarded error into a JSON response. One representative DB-backed GET
// per router proves the wiring end to end. Search is the one router absent
// from the table: its handlers catch their own errors inside runSearchQuery
// (pinned in search-route.test.ts).

import { strict as assert } from "node:assert";
import { test } from "node:test";
import request from "supertest";
import db from "../db";
import { app } from "../index";
import destinationsRouter from "../routes/destinations";
import routesRouter from "../routes/routes";
import areasRouter from "../routes/areas";
import sessionsRouter from "../routes/sessions";
import listsRouter from "../routes/lists";
import plansRouter from "../routes/plans";
import searchRouter from "../routes/search";
import tripReportsRouter from "../routes/trip-reports";
import publicAirQualityRouter from "../routes/public-air-quality";

const REPRESENTATIVE_ROUTES = [
  "/api/destinations/dest123",
  "/api/routes/route123",
  "/api/areas/area123",
  "/api/sessions/session123",
  "/api/lists/list123",
  "/api/plans/plan123",
  "/api/trip-reports/report123",
];

for (const path of REPRESENTATIVE_ROUTES) {
  test(`GET ${path} returns retryable 503 when the database connection drops`, async (t) => {
    t.mock.method(console, "error", () => undefined);
    t.mock.method(db, "query", async () => {
      throw new Error("connection terminated unexpectedly");
    });
    t.mock.method(db, "connect", async () => {
      throw new Error("connection terminated unexpectedly");
    });

    const res = await request(app).get(path).set("X-Test-User", "test-user");

    assert.equal(res.status, 503);
    assert.equal(res.headers["retry-after"], "2");
    assert.deepEqual(res.body, { error: "Database temporarily unavailable" });
  });
}

test("broken SQL remains a non-retryable 500", async (t) => {
  t.mock.method(console, "error", () => undefined);
  t.mock.method(db, "query", async () => {
    throw Object.assign(new Error("syntax error at or near SELECT"), { code: "42601" });
  });

  const res = await request(app)
    .get("/api/areas/area123")
    .set("X-Test-User", "test-user");

  assert.equal(res.status, 500);
  assert.equal(res.headers["retry-after"], undefined);
  assert.deepEqual(res.body, { error: "Request failed" });
});

// express.json() rejections carry their own status (400 for malformed JSON,
// 413 for an oversized body). The error middleware must pass a 4xx through
// instead of flattening it to 500: the 413 in particular is load-bearing —
// the iOS chunked uploader is sized against the 5mb limit, and a 500 reads
// as transient and invites retry.

test("malformed JSON body returns 400, not 500", async (t) => {
  t.mock.method(console, "warn", () => undefined);

  const res = await request(app)
    .post("/api/sessions")
    .set("X-Test-User", "test-user")
    .set("Content-Type", "application/json")
    .send("{not json");

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Bad request" });
});

test("body over the 5mb JSON limit returns 413, not 500", async (t) => {
  t.mock.method(console, "warn", () => undefined);

  const res = await request(app)
    .post("/api/sessions")
    .set("X-Test-User", "test-user")
    .send({ data: "x".repeat(6 * 1024 * 1024) });

  assert.equal(res.status, 413);
  assert.deepEqual(res.body, { error: "Bad request" });
});

// Structural pin: every handler on every route must be the arity-3 function
// asyncRoute returns. Handlers here are written (req, res), so an unwrapped
// one — or a reverted wrap — shows up as arity 2 and fails this cleanly,
// instead of hanging a representative-route test above.

const ROUTERS: Array<[string, unknown]> = [
  ["destinations", destinationsRouter],
  ["routes", routesRouter],
  ["areas", areasRouter],
  ["sessions", sessionsRouter],
  ["lists", listsRouter],
  ["plans", plansRouter],
  ["search", searchRouter],
  ["trip-reports", tripReportsRouter],
  ["public-air-quality", publicAirQualityRouter],
];

test("every registered route handler takes (req, res, next)", () => {
  for (const [name, router] of ROUTERS) {
    const layers = (router as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (...args: unknown[]) => unknown }> } }> }).stack;
    for (const layer of layers) {
      if (!layer.route) continue;
      for (const handlerLayer of layer.route.stack) {
        assert.equal(
          handlerLayer.handle.length,
          3,
          `${name} ${layer.route.path}: handler has arity ${handlerLayer.handle.length}, expected 3 — is it missing asyncRoute?`
        );
      }
    }
  }
});

test("app-level routes (health, sweep) take (req, res, next) or are sync", () => {
  const appLayers = (app as unknown as { _router: { stack: Array<{ route?: { path: string; stack: Array<{ handle: (...args: unknown[]) => unknown }> } }> } })._router.stack;
  const sweep = appLayers.find((layer) => layer.route?.path === "/internal/sweep");
  assert.ok(sweep?.route, "expected /internal/sweep to be registered");
  for (const handlerLayer of sweep.route!.stack) {
    assert.equal(
      handlerLayer.handle.length,
      3,
      "/internal/sweep: async handler must go through asyncRoute"
    );
  }
});
