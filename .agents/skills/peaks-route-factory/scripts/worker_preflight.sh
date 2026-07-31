#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"
canonical_root="/Users/josiahm/projects/peaks/firebase"
worker_root="/Users/josiahm/projects/peaks/.workers/firebase-route-factory"

case "$repo_root" in
  "$canonical_root"|"$worker_root")
    ;;
  *)
    printf '%s\n' \
      "setup_required: route worker checkout is not an approved path: $repo_root" \
      >&2
    exit 1
    ;;
esac

if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=normal)" ]]; then
  printf '%s\n' "setup_required: route worker checkout is dirty: $repo_root" >&2
  exit 1
fi

head_sha="$(git -C "$repo_root" rev-parse HEAD)"
main_sha="$(git -C "$repo_root" rev-parse origin/main)"
if [[ "$head_sha" != "$main_sha" && "${PEAKS_ROUTE_ALLOW_UNMERGED:-0}" != "1" ]]; then
  printf '%s\n' \
    "setup_required: route worker checkout is stale; supervisor must update it to origin/main" \
    >&2
  exit 1
fi

if [[ ! -x "$repo_root/cloud-sql/migrate/node_modules/.bin/tsx" ]]; then
  printf '%s\n' \
    "setup_required: run npm ci in cloud-sql/migrate for the worker checkout" \
    >&2
  exit 1
fi

printf '%s\n' "$repo_root"
