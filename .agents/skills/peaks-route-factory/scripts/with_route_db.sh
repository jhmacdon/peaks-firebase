#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -eq 0 ]]; then
  printf '%s\n' "with_route_db.sh requires a command" >&2
  exit 2
fi

export DB_HOST="${PEAKS_ROUTE_DB_HOST:-${DB_HOST:-127.0.0.1}}"
export DB_PORT="${PEAKS_ROUTE_DB_PORT:-${DB_PORT:-5432}}"
export DB_NAME="${PEAKS_ROUTE_DB_NAME:-${DB_NAME:-peaks}}"
export DB_USER="${PEAKS_ROUTE_DB_USER:-${DB_USER:-postgres}}"
export DB_PASS="${PEAKS_ROUTE_DB_PASS:-${DB_PASS:-}}"

if [[ -z "$DB_PASS" ]]; then
  command -v gcloud >/dev/null 2>&1 || {
    printf '%s\n' "Database setup required: DB_PASS is unset and gcloud is unavailable" >&2
    exit 1
  }
  DB_PASS="$(
    gcloud secrets versions access latest \
      --secret=peaks-db-postgres-password \
      --project=donner-a8608 \
      2>/dev/null
  )"
  export DB_PASS
fi

if [[ -z "$DB_PASS" ]]; then
  printf '%s\n' "Database setup required: password lookup returned no value" >&2
  exit 1
fi

if ! (echo >/dev/tcp/"$DB_HOST"/"$DB_PORT") >/dev/null 2>&1; then
  printf '%s\n' \
    "Database setup required: Cloud SQL Auth Proxy is not reachable at ${DB_HOST}:${DB_PORT}" \
    >&2
  exit 1
fi

exec "$@"
