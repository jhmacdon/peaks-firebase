#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"
entrypoint="$script_dir/verify_standard_route.mts"
esbuild="$repo_root/cloud-sql/migrate/node_modules/.bin/esbuild"

if [[ ! -x "$esbuild" ]]; then
  printf '%s\n' "Run npm install in cloud-sql/migrate first." >&2
  exit 1
fi
if [[ -z "${DB_HOST:-}" && " $* " != *" --help "* && " $* " != *" -h "* ]]; then
  printf '%s\n' "DB_HOST must point to the local Cloud SQL Auth Proxy." >&2
  exit 1
fi
if [[ -z "${DB_HOST:-}" ]]; then
  export DB_HOST="127.0.0.1"
fi

bundle_dir="$(mktemp -d "$repo_root/cloud-sql/migrate/.route-verify.XXXXXX")"
trap 'rm -rf "$bundle_dir"' EXIT

"$esbuild" "$entrypoint" \
  --bundle \
  --platform=node \
  --format=esm \
  --packages=external \
  --external:@google-cloud/cloud-sql-connector \
  --log-level=warning \
  --outfile="$bundle_dir/verify.mjs"

node "$bundle_dir/verify.mjs" "$@"
