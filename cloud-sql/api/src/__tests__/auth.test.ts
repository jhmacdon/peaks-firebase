import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import express from "express";
import { appRequest } from "./helpers/app-request";
import admin from "firebase-admin";
import { AuthRequest, optionalAuth, requireAuth } from "../auth";

const originalEnv = process.env.NODE_ENV;
afterEach(() => {
  mock.restoreAll();
  process.env.NODE_ENV = originalEnv;
  delete process.env.K_SERVICE;
  delete process.env.K_REVISION;
});
function authApp(optional = true) {
  const app = express();
  app.get("/", optional ? optionalAuth : requireAuth, (req, res) => {
    const { uid, authToken } = req as AuthRequest;
    res.json({ uid, authToken });
  });
  return app;
}

test("optionalAuth verifies a valid bearer token and preserves the decoded token", async () => {
  process.env.NODE_ENV = "development";
  const decoded = { uid: "member", firebase: { sign_in_provider: "password" } };
  const verify = mock.method(admin.auth(), "verifyIdToken", async (token: string) => {
    assert.equal(token, "valid-token");
    return decoded;
  });
  const response = await appRequest(authApp(), "GET", "/", { Authorization: "Bearer valid-token" });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { uid: "member", authToken: decoded });
  assert.equal(verify.mock.callCount(), 1);
});

test("optionalAuth accepts no token without inventing a uid or token", async () => {
  process.env.NODE_ENV = "development";
  const verify = mock.method(admin.auth(), "verifyIdToken", async () => { throw new Error("unexpected"); });
  const response = await appRequest(authApp(), "GET", "/");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {});
  assert.equal(verify.mock.callCount(), 0);
});

test("optionalAuth rejects expired, malformed and empty credentials", async () => {
  process.env.NODE_ENV = "development";
  mock.method(admin.auth(), "verifyIdToken", async () => { throw new Error("expired"); });
  for (const header of ["Bearer expired", "Basic invalid", "", "Bearer "]) {
    const response = await appRequest(authApp(), "GET", "/", { Authorization: header });
    assert.equal(response.status, 401, header);
  }
});

test("the test shim allows missing optional identity and still protects required auth", async () => {
  process.env.NODE_ENV = "test";
  assert.equal((await appRequest(authApp(), "GET", "/")).status, 200);
  assert.equal((await appRequest(authApp(false), "GET", "/")).status, 401);
  const response = await appRequest(authApp(), "GET", "/", { "X-Test-User": "test-user" });
  assert.equal(response.body.uid, "test-user");
  assert.equal(response.body.authToken.uid, "test-user");
  assert.equal((await appRequest(authApp(), "GET", "/", { Authorization: "Bearer invalid" })).status, 401);
});

test("neither auth shim may run inside Cloud Run", async () => {
  process.env.NODE_ENV = "test";
  for (const key of ["K_SERVICE", "K_REVISION"]) {
    process.env[key] = "cloud-run";
    for (const optional of [true, false]) {
      assert.equal((await appRequest(authApp(optional), "GET", "/", { "X-Test-User": "test-user" })).status, 500);
    }
    delete process.env[key];
  }
});
