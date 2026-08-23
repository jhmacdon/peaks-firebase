import type { PoolConfig } from "pg";

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Bounds interactive web database work without changing pool size or Cloud
 * Run capacity. The API uses the same 5-second acquire and 30-second
 * statement limits; the web app should not let one stalled query occupy a
 * connection for the full 300-second request timeout. */
export function buildWebPoolSafetyConfig(
  env: NodeJS.ProcessEnv = process.env
): Pick<
  PoolConfig,
  | "application_name"
  | "connectionTimeoutMillis"
  | "idle_in_transaction_session_timeout"
  | "statement_timeout"
> {
  return {
    application_name: "peaks-web",
    connectionTimeoutMillis: positiveInt(
      env.DB_POOL_CONNECTION_TIMEOUT_MS,
      5_000
    ),
    statement_timeout: positiveInt(env.DB_STATEMENT_TIMEOUT_MS, 30_000),
    idle_in_transaction_session_timeout: positiveInt(
      env.DB_IDLE_TXN_TIMEOUT_MS,
      30_000
    ),
  };
}
