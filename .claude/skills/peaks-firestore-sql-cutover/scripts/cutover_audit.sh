#!/usr/bin/env bash
set -euo pipefail

mode="${1:-audit}"
if [[ "$mode" != "audit" && "$mode" != "apply" ]]; then
  printf '%s\n' "Usage: cutover_audit.sh [audit|apply]" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"
migrate_root="$repo_root/cloud-sql/migrate"

if [[ ! -x "$migrate_root/node_modules/.bin/tsx" ]]; then
  printf '%s\n' "Setup required: run npm install in $migrate_root" >&2
  exit 1
fi

if ! /usr/bin/curl --fail --silent "http://127.0.0.1:9090/readiness" >/dev/null; then
  printf '%s\n' \
    "Setup required: use peaks-cloud-sql-proxy-recovery; the local proxy is not ready" >&2
  exit 1
fi

credential_path="${PEAKS_FIREBASE_CREDENTIALS:-$repo_root/functions/peaks-cred.json}"
if [[ ! -f "$credential_path" ]]; then
  canonical_credential="/Users/josiahm/projects/peaks/firebase/functions/peaks-cred.json"
  if [[ -f "$canonical_credential" ]]; then
    credential_path="$canonical_credential"
  else
    printf '%s\n' "Setup required: Peaks Firebase service credential not found" >&2
    exit 1
  fi
fi

source "$repo_root/.agents/skills/peaks-route-factory/scripts/load_route_db_password.sh" "$repo_root"
export DB_HOST="127.0.0.1"
export DB_PORT="5432"
export DB_NAME="peaks"
export DB_USER="postgres"
export GOOGLE_APPLICATION_CREDENTIALS="$credential_path"

if [[ "$mode" == "apply" ]]; then
  if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=normal)" ]]; then
    printf '%s\n' "Refusing apply from a dirty checkout" >&2
    exit 1
  fi
  if [[ "$(git -C "$repo_root" rev-parse HEAD)" != "$(git -C "$repo_root" rev-parse origin/main)" ]]; then
    printf '%s\n' "Refusing apply unless the checkout matches exact origin/main" >&2
    exit 1
  fi
  exec npm --prefix "$migrate_root" run audit:routes-recordings -- --apply --json
fi

exec npm --prefix "$migrate_root" run audit:routes-recordings -- --json
