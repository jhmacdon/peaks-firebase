#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -eq 0 ]]; then
  printf '%s\n' "with_route_db.sh requires a command" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"
"$script_dir/worker_preflight.sh" >/dev/null

export DB_HOST="${PEAKS_ROUTE_DB_HOST:-${DB_HOST:-127.0.0.1}}"
export DB_PORT="${PEAKS_ROUTE_DB_PORT:-${DB_PORT:-5432}}"
export DB_NAME="${PEAKS_ROUTE_DB_NAME:-${DB_NAME:-peaks}}"
export DB_USER="${PEAKS_ROUTE_DB_USER:-${DB_USER:-postgres}}"
source "$script_dir/load_route_db_password.sh" "$repo_root"

if ! (echo >/dev/tcp/"$DB_HOST"/"$DB_PORT") >/dev/null 2>&1; then
  printf '%s\n' \
    "Database setup required: Cloud SQL Auth Proxy is not reachable at ${DB_HOST}:${DB_PORT}" \
    >&2
  exit 1
fi

exec "$@"
