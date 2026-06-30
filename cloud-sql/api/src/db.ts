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

export const dbClientConfig: ClientConfig = {
  host: process.env.DB_HOST || `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
  database: process.env.DB_NAME || "peaks",
  user: process.env.DB_USER || "peaks-api",
  password: process.env.DB_PASS,
  port: process.env.DB_HOST ? parseInt(process.env.DB_PORT || "5432") : undefined,
};

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
export function buildPoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  return {
    ...dbClientConfig,
    max: parsePositiveInt(env.DB_POOL_MAX, 8),
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
    ...dbClientConfig,
    max: parsePositiveInt(env.DB_PROCESSING_POOL_MAX, 2),
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
