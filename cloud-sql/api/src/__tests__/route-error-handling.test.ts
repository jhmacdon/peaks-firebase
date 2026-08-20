// Express 4 ignores the promise an async handler returns, so a rejected query
// in a bare handler becomes an unhandled rejection — and under Node 20's
// default --unhandled-rejections=throw that kills the whole instance. These
// tests pin the systemic guard: every router wraps its handlers in asyncRoute
// (src/lib/async-route.ts), and the app-level error middleware in index.ts
// turns the forwarded error into a JSON 500. One representative DB-backed GET
// per router proves the wiring end to end.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import request from "supertest";
import db from "../db";
import { app } from "../index";

const REPRESENTATIVE_ROUTES = [
  "/api/destinations/dest123",
  "/api/routes/route123",
  "/api/areas/area123",
  "/api/sessions/session123",
  "/api/lists/list123",
  "/api/plans/plan123",
];

for (const path of REPRESENTATIVE_ROUTES) {
  test(`GET ${path} returns 500 when the handler's query rejects`, async (t) => {
    t.mock.method(console, "error", () => undefined);
    t.mock.method(db, "query", async () => {
      throw new Error("connection terminated unexpectedly");
    });
    t.mock.method(db, "connect", async () => {
      throw new Error("connection terminated unexpectedly");
    });

    const res = await request(app).get(path).set("X-Test-User", "test-user");

    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: "Request failed" });
  });
}
