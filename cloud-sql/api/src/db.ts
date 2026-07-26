import { Client, Pool, types, type ClientConfig, type PoolConfig } from "pg";

// Cloud SQL connection via Unix socket (Cloud SQL Auth Proxy)
// or TCP for local development.
//
// In Cloud Run, set:
//   INSTANCE_CONNECTION_NAME = project:region:instance
//   DB_NAME, DB_USER, DB_PASS
//
// The Cloud SQL Auth Proxy provides the Unix socket at:
//   /cloudsql/INSTANCE_CONNECTION_NAME

// Return `BIGINT` (OID 20, `INT8`) as a JS `Number` instead of the pg-types
// default of `String`. The only BIGINT column in use today is
// `tracking_points.time` — a unix-seconds timestamp comfortably below 2^53,
// so precision is safe. Keeping the default string behavior caused iOS to
// parse `d["time"] as? Int` as nil, zero every tracking point's timestamp,
// and completely invalidate the session timeline + flyover day/night cycle.
// If a future BIGINT column needs >2^53 precision, give it its own typed
// parser or return it via `::text` in the query.
types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const PRODUCTION_DATABASE_NAME = "peaks";

/**
 * Reject any test connection string that does not name a test database.
 *
 * The suffix rule is deliberately blunt. `DATABASE_URL` used to be nothing but
 * a skip-flag — the connection itself still came from DB_HOST/DB_NAME/DB_USER/
 * DB_PASS — so setting it to literally any non-empty string un-skipped every
 * integration suite and pointed it at whatever those vars held, which on a
 * developer machine is production. Naming the database is now the only way to
 * enable those suites, and the name has to end in `_test`.
 *
 * @throws if the URL is unparseable, names no database, or names one that is
 *   not a test database.
 */
export function assertTestDatabaseUrl(url: string): void {
  let database: string;
  try {
    database = decodeURIComponent(new URL(url).pathname).replace(/^\//, "");
  } catch {
    throw new Error(
      `TEST_DATABASE_URL is not a valid connection URL. ` +
        `Expected postgres://user:password@host:port/<name>_test`
    );
  }

  if (!database) {
    throw new Error(
      `TEST_DATABASE_URL names no database. ` +
        `Expected postgres://user:password@host:port/<name>_test`
    );
  }

  if (database === PRODUCTION_DATABASE_NAME) {
    throw new Error(
      `TEST_DATABASE_URL points at the production database ("${database}"). ` +
        `The integration suites create, update and delete rows — point them at ` +
        `a database provisioned by cloud-sql/test-db/provision.sh instead.`
    );
  }

  if (!database.endsWith("_test")) {
    throw new Error(
      `TEST_DATABASE_URL names "${database}", which is not a test database. ` +
        `The name must end in "_test" — the integration suites write to every ` +
        `table they touch, so the name is what keeps them off real data.`
    );
  }
}

/**
 * Where the process connects.
 *
 * `TEST_DATABASE_URL`, when set, is the ONLY source — DB_HOST/DB_NAME/DB_USER/
 * DB_PASS are ignored outright rather than merged, so a production value left
 * exported in a shell cannot leak into a test run through a field the URL
 * happens not to specify.
 */
export function resolveClientConfig(env: NodeJS.ProcessEnv = process.env): ClientConfig {
  const testUrl = env.TEST_DATABASE_URL?.trim();
  if (testUrl) {
    assertTestDatabaseUrl(testUrl);
    return { connectionString: testUrl };
  }

  if (env.NODE_ENV === "test") {
    // Under `npm test` with no test database configured, every DB-backed suite
    // skips, so nothing should open a connection. Point at a socket path that
    // cannot exist so a suite that starts querying anyway fails immediately and
    // visibly, instead of quietly reaching whatever DB_* vars are exported.
    return {
      host: "/nonexistent/peaks-test-database-not-configured",
      database: "peaks_test_unconfigured",
      user: "peaks_test",
    };
  }

  return {
    host: env.DB_HOST || `/cloudsql/${env.INSTANCE_CONNECTION_NAME}`,
    database: env.DB_NAME || PRODUCTION_DATABASE_NAME,
    user: env.DB_USER || "peaks-api",
    password: env.DB_PASS,
    port: env.DB_HOST ? parseInt(env.DB_PORT || "5432") : undefined,
  };
}

export const dbClientConfig: ClientConfig = resolveClientConfig();

// Build the pool tuning policy from an explicit env object. Pure + exported so
// the connection-safety guarantees (statement timeout, idle-txn timeout, bounded
// pool) can be asserted without constructing a real Pool or a DB.
//
// Why each guard matters on the db-f1-micro (~25 max_connections, shared CPU):
//  - `statement_timeout`: a single slow/runaway query otherwise pins one of the
//    few pool slots until it finishes. A couple of those starve every other
//    request into a 5s connect-timeout → service-wide 503s. The timeout caps
//    the worst case so a slot always comes back.
//  - `idle_in_transaction_session_timeout`: a transaction that opens then stalls
//    (client died mid-request) would hold its connection indefinitely; this
//    reaps it.
//  - `max`: total connections across all Cloud Run instances must stay under the
//    DB ceiling. Env-overridable so it can be tuned alongside Cloud Run maxScale
//    without a code change.
//  - under `npm test` the default drops to 2. Each test FILE is its own child
//    process with its own Pool, so the ceiling that matters is
//    (files running at once × pool max), not one pool. At the old default of 8
//    a 12-file parallel run asks for ~96 connections; the Cloud SQL instance
//    allows 25. Exhausting it is what made parallel runs look like statement
//    timeouts, and what forced --test-concurrency=1.
export function buildPoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  return {
    ...resolveClientConfig(env),
    max: parsePositiveInt(env.DB_POOL_MAX, env.NODE_ENV === "test" ? 2 : 8),
    connectionTimeoutMillis: parsePositiveInt(env.DB_POOL_CONNECTION_TIMEOUT_MS, 5_000),
    statement_timeout: parsePositiveInt(env.DB_STATEMENT_TIMEOUT_MS, 30_000),
    idle_in_transaction_session_timeout: parsePositiveInt(
      env.DB_IDLE_TXN_TIMEOUT_MS,
      30_000
    ),
  };
}

const pool = new Pool(buildPoolConfig());

// Isolated pool for background processing (the in-process sweep + relaxed
// inline retries). A separate pool with a longer statement_timeout so a slow
// long-track match runs to completion WITHOUT borrowing from the web pool —
// interactive queries (search/sync) keep their protective 30s ceiling. Kept
// small (max 2) and gated by the sweep's advisory lock so combined web +
// processing connections stay under the db-f1-micro ceiling.
export function buildProcessingPoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const timeout = parsePositiveInt(env.DB_PROCESSING_STATEMENT_TIMEOUT_MS, 120_000);
  return {
    ...resolveClientConfig(env),
    max: parsePositiveInt(env.DB_PROCESSING_POOL_MAX, env.NODE_ENV === "test" ? 1 : 2),
    connectionTimeoutMillis: parsePositiveInt(env.DB_POOL_CONNECTION_TIMEOUT_MS, 5_000),
    statement_timeout: timeout,
    idle_in_transaction_session_timeout: timeout,
  };
}

export const processingPool = new Pool(buildProcessingPoolConfig());

export function createDbClient(): Client {
  return new Client(dbClientConfig);
}

export default pool;
