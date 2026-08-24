import assert from "node:assert/strict";
import test from "node:test";

import { buildWebPoolSafetyConfig } from "./db-config";

test("web database waits and statements have bounded defaults", () => {
  assert.deepEqual(buildWebPoolSafetyConfig({}), {
    application_name: "peaks-web",
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 30_000,
  });
});

test("web database timeout settings accept positive environment overrides", () => {
  const config = buildWebPoolSafetyConfig({
    DB_POOL_CONNECTION_TIMEOUT_MS: "7000",
    DB_STATEMENT_TIMEOUT_MS: "45000",
    DB_IDLE_TXN_TIMEOUT_MS: "60000",
  });

  assert.equal(config.connectionTimeoutMillis, 7_000);
  assert.equal(config.statement_timeout, 45_000);
  assert.equal(config.idle_in_transaction_session_timeout, 60_000);
});

test("web database timeout settings reject zero and invalid overrides", () => {
  const config = buildWebPoolSafetyConfig({
    DB_POOL_CONNECTION_TIMEOUT_MS: "0",
    DB_STATEMENT_TIMEOUT_MS: "nope",
    DB_IDLE_TXN_TIMEOUT_MS: "-1",
  });

  assert.equal(config.connectionTimeoutMillis, 5_000);
  assert.equal(config.statement_timeout, 30_000);
  assert.equal(config.idle_in_transaction_session_timeout, 30_000);
});
