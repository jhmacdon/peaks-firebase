#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"
"$script_dir/resolve_worker_checkout.sh" "$repo_root" >/dev/null

command -v gcloud >/dev/null 2>&1 || {
  printf '%s\n' "Database setup required: gcloud is unavailable" >&2
  exit 1
}

credential_file="${PEAKS_ROUTE_DB_PASSWORD_FILE:-$(cd "$repo_root/.." && pwd)/.peaks-route-db-password}"
if [[ -L "$credential_file" || ( -e "$credential_file" && ! -f "$credential_file" ) ]]; then
  printf '%s\n' "Database setup required: password cache target must be a regular file" >&2
  exit 1
fi

credential_dir="$(cd "$(dirname "$credential_file")" && pwd)"
umask 077
temporary_file="$(mktemp "$credential_dir/.peaks-route-db-password.tmp.XXXXXX")"
cleanup() {
  rm -f "$temporary_file"
}
trap cleanup EXIT

gcloud secrets versions access latest \
  --secret=peaks-db-postgres-password \
  --project=donner-a8608 \
  --out-file="$temporary_file" \
  >/dev/null
chmod 600 "$temporary_file"
if file_mode="$(stat -f '%Lp' "$temporary_file" 2>/dev/null)"; then
  file_owner="$(stat -f '%u' "$temporary_file")"
else
  file_mode="$(stat -c '%a' "$temporary_file")"
  file_owner="$(stat -c '%u' "$temporary_file")"
fi
if [[ -L "$temporary_file" || ! -f "$temporary_file" \
  || "$file_mode" != "600" || "$file_owner" != "$(id -u)" ]]; then
  printf '%s\n' "Database setup required: temporary password cache is not private" >&2
  exit 1
fi
mv -f "$temporary_file" "$credential_file"
trap - EXIT
printf '%s\n' "Cached route-worker database credentials at $credential_file"
