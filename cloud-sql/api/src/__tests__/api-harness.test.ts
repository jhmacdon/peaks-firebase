// Pins the test-harness scaffolding: app must be importable without binding a
// port, the `/health` route must respond unauthenticated, and the test-mode
// auth shim must reject requests without X-Test-User. Subsequent test files
// (e.g. session-groups.test.ts) rely on this.
//
// The third smoke test ("authenticated routes accept with X-Test-User header")
// is intentionally omitted: every authenticated route hits the DB, and there
// is no test DB configured. The two tests below already prove both sides of
// the auth shim (reject without header, unauthenticated route always passes).

import { strict as assert } from "node:assert";
import { test } from "node:test";
import request from "supertest";
import { app } from "../index";

test("/health returns 200 without auth", async () => {
  const res = await request(app).get("/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: "ok" });
});

test("authenticated routes reject when X-Test-User missing", async () => {
  const res = await request(app).get("/api/sessions/anything");
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "Test mode requires X-Test-User header");
});
