// Per-user rate guard on the heavy session-write endpoints. One account must
// never be able to take down the API: excess concurrent uploads are shed as
// 429 instead of draining the bounded DB pool into service-wide 503s.
//
// No DB: the limiter is pure, and the middleware is exercised with a fake
// req/res so the admit / 429 / slot-release behavior is fully verified.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import {
  ConcurrencyLimiter,
  perUserConcurrencyGuard,
  resolveHeavyInflightCap,
} from "../lib/rate-guard";

test("resolveHeavyInflightCap sits one below the DB pool so one user can't exhaust it", () => {
  // Deployed service runs DB_POOL_MAX=4 → cap 3 (leaves a connection for reads).
  assert.equal(resolveHeavyInflightCap({ DB_POOL_MAX: "4" }), 3);
  assert.equal(resolveHeavyInflightCap({ DB_POOL_MAX: "8" }), 7);
});

test("resolveHeavyInflightCap falls back to pool 8 (db.ts default) when unset", () => {
  assert.equal(resolveHeavyInflightCap({}), 7);
});

test("resolveHeavyInflightCap honors an explicit override", () => {
  assert.equal(resolveHeavyInflightCap({ DB_POOL_MAX: "4", HEAVY_INFLIGHT_CAP_PER_USER: "2" }), 2);
});

test("resolveHeavyInflightCap never returns below 1", () => {
  assert.equal(resolveHeavyInflightCap({ DB_POOL_MAX: "1" }), 1);
});

test("ConcurrencyLimiter admits up to max then sheds", () => {
  const lim = new ConcurrencyLimiter(2);
  assert.equal(lim.tryAcquire("u"), true);
  assert.equal(lim.tryAcquire("u"), true);
  assert.equal(lim.tryAcquire("u"), false, "third concurrent request is shed");
  assert.equal(lim.inFlight("u"), 2);
});

test("ConcurrencyLimiter release frees a slot", () => {
  const lim = new ConcurrencyLimiter(1);
  assert.equal(lim.tryAcquire("u"), true);
  assert.equal(lim.tryAcquire("u"), false);
  lim.release("u");
  assert.equal(lim.tryAcquire("u"), true, "slot reusable after release");
});

test("ConcurrencyLimiter release never drops below zero", () => {
  const lim = new ConcurrencyLimiter(2);
  lim.release("u"); // release with nothing in flight
  assert.equal(lim.inFlight("u"), 0);
  assert.equal(lim.tryAcquire("u"), true);
});

test("ConcurrencyLimiter keys are independent (one user can't starve another)", () => {
  const lim = new ConcurrencyLimiter(1);
  assert.equal(lim.tryAcquire("a"), true);
  assert.equal(lim.tryAcquire("a"), false, "user a is at its cap");
  assert.equal(lim.tryAcquire("b"), true, "user b is unaffected");
});

// --- middleware ---

class FakeRes extends EventEmitter {
  statusCode?: number;
  jsonBody?: unknown;
  headers: Record<string, string> = {};
  setHeader(k: string, v: string): void {
    this.headers[k] = v;
  }
  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  json(body: unknown): this {
    this.jsonBody = body;
    return this;
  }
}

test("guard calls next() under the cap and 429s at the cap", () => {
  const guard = perUserConcurrencyGuard(new ConcurrencyLimiter(1));
  const req = { uid: "u1" } as any;

  let nextCalls = 0;
  const res1 = new FakeRes();
  guard(req, res1 as any, () => nextCalls++);
  assert.equal(nextCalls, 1, "first request admitted");
  assert.equal(res1.statusCode, undefined, "no error status on admit");

  // Second concurrent request for the same uid (res1 not finished) is shed.
  const res2 = new FakeRes();
  guard(req, res2 as any, () => nextCalls++);
  assert.equal(nextCalls, 1, "second request not passed through");
  assert.equal(res2.statusCode, 429);
  assert.equal(res2.headers["Retry-After"], "5");
  assert.match((res2.jsonBody as any).error, /back off/i);
});

test("guard releases the slot when the response finishes", () => {
  const guard = perUserConcurrencyGuard(new ConcurrencyLimiter(1));
  const req = { uid: "u1" } as any;

  let nextCalls = 0;
  const res1 = new FakeRes();
  guard(req, res1 as any, () => nextCalls++);
  assert.equal(nextCalls, 1);

  // Finish the first request — its slot must free up.
  res1.emit("finish");

  const res2 = new FakeRes();
  guard(req, res2 as any, () => nextCalls++);
  assert.equal(nextCalls, 2, "slot reused after the first response finished");
  assert.equal(res2.statusCode, undefined);
});

test("guard releases the slot on socket close (dropped connection)", () => {
  const guard = perUserConcurrencyGuard(new ConcurrencyLimiter(1));
  const req = { uid: "u1" } as any;

  let nextCalls = 0;
  const res1 = new FakeRes();
  guard(req, res1 as any, () => nextCalls++);
  res1.emit("close");

  const res2 = new FakeRes();
  guard(req, res2 as any, () => nextCalls++);
  assert.equal(nextCalls, 2, "a dropped connection must not leak a slot");
});

test("guard does not double-release if both finish and close fire", () => {
  const lim = new ConcurrencyLimiter(2);
  const guard = perUserConcurrencyGuard(lim);
  const req = { uid: "u1" } as any;

  const res = new FakeRes();
  guard(req, res as any, () => {});
  assert.equal(lim.inFlight("u1"), 1);
  res.emit("finish");
  res.emit("close");
  assert.equal(lim.inFlight("u1"), 0, "released exactly once, not below zero");
});
