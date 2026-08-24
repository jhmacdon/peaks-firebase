import type { PoolConfig } from "pg";

type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Bounds interactive web database work. App Hosting may create several
 * instances, each with its own pool, while the db-f1-micro allows about 25
 * total connections. Two connections per web instance are enough for page
 * rendering and leave room for the iOS API and Cloud SQL administration. */
export function buildWebPoolSafetyConfig(
  env: EnvironmentVariables = process.env
): Pick<
  PoolConfig,
  | "application_name"
  | "connectionTimeoutMillis"
  | "idle_in_transaction_session_timeout"
  | "max"
  | "statement_timeout"
> {
  return {
    application_name: "peaks-web",
    max: positiveInt(env.DB_POOL_MAX, 2),
    connectionTimeoutMillis: positiveInt(
      env.DB_POOL_CONNECTION_TIMEOUT_MS,
      5_000
    ),
    statement_timeout: positiveInt(env.DB_STATEMENT_TIMEOUT_MS, 15_000),
    idle_in_transaction_session_timeout: positiveInt(
      env.DB_IDLE_TXN_TIMEOUT_MS,
      30_000
    ),
  };
}
