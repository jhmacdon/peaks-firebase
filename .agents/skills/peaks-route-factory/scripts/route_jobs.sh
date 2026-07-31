#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"

exec "$script_dir/with_route_db.sh" \
  npm --prefix "$repo_root/cloud-sql/migrate" run routes:jobs -- "$@"
