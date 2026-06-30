// The pg Pool must defend the tiny db-f1-micro instance from a single slow or
// abandoned query pinning one of its few connections forever. Without a
// statement timeout, a runaway query holds a pool slot until it finishes; with
// only a handful of slots, a couple of those starve every other request (search
// included) into a 5s connect-timeout → service-wide 503s. These guards are
// what let one user's session backlog NOT take the whole API down.
//
// buildPoolConfig is pure (reads an explicit env object) so the timeout/limit
// policy can be asserted without constructing a real Pool or touching a DB.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildPoolConfig } from "../db";

test("statement_timeout is set so no query can pin a connection forever", () => {
  const cfg = buildPoolConfig({});
  assert.ok(
    typeof cfg.statement_timeout === "number" && cfg.statement_timeout > 0,
    "expected a positive statement_timeout"
  );
});

test("idle_in_transaction_session_timeout is set so a stuck txn can't hold a slot", () => {
  const cfg = buildPoolConfig({});
  assert.ok(
    typeof cfg.idle_in_transaction_session_timeout === "number" &&
      cfg.idle_in_transaction_session_timeout > 0,
    "expected a positive idle_in_transaction_session_timeout"
  );
});

test("connectionTimeoutMillis defaults to a bounded value", () => {
  const cfg = buildPoolConfig({});
  assert.ok(
    typeof cfg.connectionTimeoutMillis === "number" && cfg.connectionTimeoutMillis > 0,
    "expected a positive connectionTimeoutMillis"
  );
});

test("pool max is env-overridable and falls back to a sane default", () => {
  assert.equal(buildPoolConfig({}).max, 8, "default pool max");
  assert.equal(buildPoolConfig({ DB_POOL_MAX: "10" }).max, 10, "env override");
  assert.equal(buildPoolConfig({ DB_POOL_MAX: "0" }).max, 8, "non-positive falls back");
  assert.equal(buildPoolConfig({ DB_POOL_MAX: "garbage" }).max, 8, "garbage falls back");
});

test("statement_timeout is env-overridable", () => {
  assert.equal(buildPoolConfig({ DB_STATEMENT_TIMEOUT_MS: "45000" }).statement_timeout, 45000);
});

import { buildProcessingPoolConfig } from "../db";

test("buildProcessingPoolConfig: relaxed 120s timeout, bounded pool, env overrides", () => {
  const def = buildProcessingPoolConfig({} as NodeJS.ProcessEnv);
  assert.equal(def.statement_timeout, 120_000);
  assert.equal(def.idle_in_transaction_session_timeout, 120_000);
  assert.equal(def.max, 2);

  const over = buildProcessingPoolConfig({
    DB_PROCESSING_POOL_MAX: "3",
    DB_PROCESSING_STATEMENT_TIMEOUT_MS: "90000",
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(over.max, 3);
  assert.equal(over.statement_timeout, 90_000);
});
