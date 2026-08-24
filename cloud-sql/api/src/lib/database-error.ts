type DatabaseErrorLike = {
  code?: unknown;
  message?: unknown;
};

const TRANSIENT_CODES = new Set([
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08003", // connection_does_not_exist
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "08006", // connection_failure
  "08007", // transaction_resolution_unknown
  "08P01", // protocol_violation
  "53300", // too_many_connections
  "57P03", // cannot_connect_now (startup/recovery)
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
]);

const TRANSIENT_MESSAGES = [
  "timeout exceeded when trying to connect",
  "connection terminated",
  "connection refused",
  "database system is in recovery mode",
  "database system is starting up",
  "database system is not yet accepting connections",
  "remaining connection slots are reserved",
  "too many clients",
];

/** True when another attempt may succeed without changing the request.
 * These failures describe pool pressure or a short database restart, not bad
 * input or a broken query. They are served as 503 so clients can back off. */
export function isTransientDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error) && (typeof error !== "object" || error === null)) {
    return false;
  }

  const candidate = error as DatabaseErrorLike;
  const code = typeof candidate.code === "string" ? candidate.code : "";
  if (TRANSIENT_CODES.has(code)) return true;

  const message = typeof candidate.message === "string"
    ? candidate.message.toLowerCase()
    : "";
  return TRANSIENT_MESSAGES.some((part) => message.includes(part));
}
