#!/bin/bash -p
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"
entrypoint="$script_dir/accept_pending_route_with_segments.mts"
esbuild="$repo_root/cloud-sql/migrate/node_modules/.bin/esbuild"
node_binary="$(command -v node || true)"

if [[ ! -x "$esbuild" ]]; then
  printf '%s\n' "Run npm install in cloud-sql/migrate first." >&2
  exit 1
fi
if [[ -z "$node_binary" || "$node_binary" != /* || ! -x "$node_binary" ]]; then
  printf '%s\n' "Node is missing from the trusted executable path." >&2
  exit 1
fi
if [[ -z "${DB_HOST:-}" && " $* " != *" --help "* && " $* " != *" -h "* ]]; then
  printf '%s\n' "DB_HOST must point to the local Cloud SQL Auth Proxy." >&2
  exit 1
fi
if [[ -z "${DB_HOST:-}" ]]; then
  export DB_HOST="127.0.0.1"
fi

bundle_dir="$(mktemp -d "$repo_root/cloud-sql/migrate/.route-accept.XXXXXX")"
trap 'rm -rf "$bundle_dir"' EXIT

"$esbuild" "$entrypoint" \
  --bundle \
  --platform=node \
  --format=esm \
  --packages=external \
  --external:@google-cloud/cloud-sql-connector \
  --log-level=warning \
  --outfile="$bundle_dir/accept.mjs"

"$node_binary" "$bundle_dir/accept.mjs" "$@"
