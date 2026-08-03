#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"
"$script_dir/resolve_worker_checkout.sh" "$repo_root" >/dev/null

command -v gcloud >/dev/null 2>&1 || {
  printf '%s\n' "Database setup required: gcloud is unavailable" >&2
  exit 1
}

credential_file="$(cd "$repo_root/.." && pwd)/.peaks-route-db-password"
umask 077
gcloud secrets versions access latest \
  --secret=peaks-db-postgres-password \
  --project=donner-a8608 \
  --out-file="$credential_file" \
  >/dev/null
chmod 600 "$credential_file"
printf '%s\n' "Cached route-worker database credentials at $credential_file"
