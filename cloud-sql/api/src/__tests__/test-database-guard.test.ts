// The integration suites write to every table they touch. What keeps them off
// production is not a convention or a comment — it is these two functions.
//
// The bug being pinned: DATABASE_URL used to gate the suites while
// DB_HOST/DB_NAME/DB_USER/DB_PASS supplied the actual connection. Any non-empty
// string un-skipped ~11 files of INSERT/UPDATE/DELETE and aimed them at
// whatever those vars held. Gate and connection must stay the same fact.

import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import {
  assertTestDatabaseUrl,
  resolveClientConfig,
  PRODUCTION_DATABASE_NAME,
} from "../db";

const TEST_URL = "postgres://peaks_test:pw@127.0.0.1:5432/peaks_test";

describe("assertTestDatabaseUrl", () => {
  test("accepts a database whose name ends in _test", () => {
    assertTestDatabaseUrl(TEST_URL);
    assertTestDatabaseUrl("postgres://u:p@db.example:5432/anything_test");
  });

  test("rejects the production database by name", () => {
    assert.throws(
      () => assertTestDatabaseUrl(`postgres://u:p@127.0.0.1:5432/${PRODUCTION_DATABASE_NAME}`),
      /production database/
    );
  });

  test("rejects any database not named *_test", () => {
    assert.throws(() => assertTestDatabaseUrl("postgres://u:p@h:5432/peaks_staging"), /not a test database/);
    // The trap worth naming: "test" alone does not end in "_test".
    assert.throws(() => assertTestDatabaseUrl("postgres://u:p@h:5432/test"), /not a test database/);
  });

  test("rejects a URL that names no database at all", () => {
    assert.throws(() => assertTestDatabaseUrl("postgres://u:p@127.0.0.1:5432"), /names no database/);
    assert.throws(() => assertTestDatabaseUrl("postgres://u:p@127.0.0.1:5432/"), /names no database/);
  });

  test("rejects an unparseable connection string", () => {
    assert.throws(() => assertTestDatabaseUrl("not-a-url"), /not a valid connection URL/);
  });
});

describe("resolveClientConfig", () => {
  test("TEST_DATABASE_URL wins outright — DB_* is never merged in", () => {
    const cfg = resolveClientConfig({
      TEST_DATABASE_URL: TEST_URL,
      // A developer shell with production values still exported. None of these
      // may survive into the resolved config.
      DB_HOST: "127.0.0.1",
      DB_NAME: PRODUCTION_DATABASE_NAME,
      DB_USER: "peaks-api",
      DB_PASS: "prod-password",
      INSTANCE_CONNECTION_NAME: "donner-a8608:us-central1:peaks-db",
    } as NodeJS.ProcessEnv);

    assert.equal(cfg.connectionString, TEST_URL);
    assert.equal(cfg.database, undefined);
    assert.equal(cfg.host, undefined);
    assert.equal(cfg.user, undefined);
    assert.equal(cfg.password, undefined);
  });

  test("a production TEST_DATABASE_URL throws instead of resolving", () => {
    assert.throws(
      () =>
        resolveClientConfig({
          TEST_DATABASE_URL: `postgres://u:p@127.0.0.1:5432/${PRODUCTION_DATABASE_NAME}`,
        } as NodeJS.ProcessEnv),
      /production database/
    );
  });

  test("under NODE_ENV=test with no test DB, it resolves somewhere unreachable", () => {
    const cfg = resolveClientConfig({
      NODE_ENV: "test",
      DB_HOST: "127.0.0.1",
      DB_NAME: PRODUCTION_DATABASE_NAME,
      DB_USER: "peaks-api",
      DB_PASS: "prod-password",
    } as NodeJS.ProcessEnv);

    // Every DB suite skips in this state, so nothing should connect. If one
    // queries anyway it must fail loudly rather than reach the DB_* target.
    assert.notEqual(cfg.database, PRODUCTION_DATABASE_NAME);
    assert.equal(cfg.host, "/nonexistent/peaks-test-database-not-configured");
    assert.equal(cfg.password, undefined);
  });

  test("outside tests, the production DB_* path is untouched", () => {
    const cfg = resolveClientConfig({
      DB_HOST: "127.0.0.1",
      DB_PORT: "5432",
      DB_NAME: PRODUCTION_DATABASE_NAME,
      DB_USER: "peaks-api",
      DB_PASS: "prod-password",
    } as NodeJS.ProcessEnv);

    assert.equal(cfg.host, "127.0.0.1");
    assert.equal(cfg.database, PRODUCTION_DATABASE_NAME);
    assert.equal(cfg.user, "peaks-api");
    assert.equal(cfg.password, "prod-password");
    assert.equal(cfg.port, 5432);
  });

  test("Cloud Run's unix-socket default still resolves", () => {
    const cfg = resolveClientConfig({
      INSTANCE_CONNECTION_NAME: "donner-a8608:us-central1:peaks-db",
    } as NodeJS.ProcessEnv);

    assert.equal(cfg.host, "/cloudsql/donner-a8608:us-central1:peaks-db");
    assert.equal(cfg.database, PRODUCTION_DATABASE_NAME);
    assert.equal(cfg.port, undefined);
  });
});
