#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"
migrate_root="$repo_root/cloud-sql/migrate"

npm --prefix "$migrate_root" ci
npm --prefix "$migrate_root" ls --all --silent >/dev/null

lock_hash="$(
  shasum -a 256 "$migrate_root/package-lock.json" | awk '{print $1}'
)"
printf '%s\n' "$lock_hash" \
  >"$migrate_root/node_modules/.peaks-route-lock.sha256"
