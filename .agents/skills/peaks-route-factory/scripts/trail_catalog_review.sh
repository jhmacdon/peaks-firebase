#!/bin/bash -p
# Operator-supervised trail review; credentials must come from the chosen lane.
set -euo pipefail
set +x
script_dir="${BASH_SOURCE[0]%/*}"
if [[ "$script_dir" != /* ]]; then script_dir="$PWD/$script_dir"; fi
builtin source "$script_dir/route_worker_environment.sh"
sanitize_route_worker_environment
unset PEAKS_ROUTE_FACTORY_DB_PASS PEAKS_ROUTE_REVIEW_DB_PASS PEAKS_ROUTE_DB_PASS
unset PEAKS_ROUTE_FACTORY_DB_USER PEAKS_ROUTE_REVIEW_DB_USER PEAKS_ROUTE_DB_USER
unset DATABASE_URL TEST_DATABASE_URL PGPASSWORD PGSERVICE PGSERVICEFILE PGUSER PGHOST PGPORT PGDATABASE NODE_ENV
case "${1:-}" in
  packet|review|heartbeat|release) lane_user="peaks-route-reviewer-worker" ;;
  activate|verify) lane_user="peaks-route-factory-worker" ;;
  *) printf '%s\n' "Choose packet, review, heartbeat, release, activate, or verify" >&2; exit 2 ;;
esac
if [[ -n "${PEAKS_ROUTE_DB_HOST:-}${PEAKS_ROUTE_DB_PORT:-}${PEAKS_ROUTE_DB_NAME:-}" ||
      ( -n "${DB_HOST:-}" && "$DB_HOST" != "127.0.0.1" ) ||
      ( -n "${DB_PORT:-}" && "$DB_PORT" != "5432" ) ||
      ( -n "${DB_NAME:-}" && "$DB_NAME" != "peaks" ) ||
      ( -n "${DB_USER:-}" && "$DB_USER" != "$lane_user" ) ]]; then
  printf '%s\n' "Supervised review target or lane user override is forbidden" >&2; exit 2
fi
if [[ -z "${DB_PASS:-}" ]]; then printf '%s\n' "Supervised review requires already loaded lane DB_PASS; no credential fallback" >&2; exit 2; fi
unset PEAKS_ROUTE_DB_HOST PEAKS_ROUTE_DB_PORT PEAKS_ROUTE_DB_NAME
export DB_HOST="127.0.0.1" DB_PORT="5432" DB_NAME="peaks" DB_USER="$lane_user"
repo_root="$(cd "$script_dir/../../../.." && pwd -P)"
cd "$repo_root"
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then printf '%s\n' "Supervised review requires a clean approved task checkout" >&2; exit 2; fi
exec "$repo_root/cloud-sql/migrate/scripts/run-tsx.sh" "$repo_root/cloud-sql/migrate/src/trail-catalog-review.ts" "$@"
