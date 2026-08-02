#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"
"$script_dir/resolve_worker_checkout.sh" "$repo_root" >/dev/null

if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=normal)" ]]; then
  printf '%s\n' "setup_required: route worker checkout is dirty: $repo_root" >&2
  exit 1
fi

head_sha="$(git -C "$repo_root" rev-parse HEAD)"
main_sha="$(git -C "$repo_root" rev-parse origin/main)"
if [[ "$head_sha" != "$main_sha" ]]; then
  printf '%s\n' \
    "setup_required: route worker checkout is stale; supervisor must update it to origin/main" \
    >&2
  exit 1
fi

migrate_root="$repo_root/cloud-sql/migrate"
marker="$migrate_root/node_modules/.peaks-route-lock.sha256"
if [[ ! -x "$migrate_root/node_modules/.bin/tsx" || ! -f "$marker" ]]; then
  printf '%s\n' \
    "setup_required: run install_worker_dependencies.sh for the worker checkout" \
    >&2
  exit 1
fi

expected_lock_hash="$(
  shasum -a 256 "$migrate_root/package-lock.json" | awk '{print $1}'
)"
installed_lock_hash="$(tr -d '[:space:]' <"$marker")"
if [[ "$installed_lock_hash" != "$expected_lock_hash" ]]; then
  printf '%s\n' \
    "setup_required: worker dependencies do not match package-lock.json" \
    >&2
  exit 1
fi

if ! npm --prefix "$migrate_root" ls --all --silent >/dev/null 2>&1; then
  printf '%s\n' \
    "setup_required: worker dependency tree is incomplete or invalid" \
    >&2
  exit 1
fi

runtime_scripts=(
  "$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts"
  "$repo_root/.claude/skills/peaks-osm-route-approval/scripts/check_pending_osm_routes.mts"
  "$repo_root/.claude/skills/peaks-osm-route-approval/scripts/check_pending_usgs_routes.mts"
)
for runtime_script in "${runtime_scripts[@]}"; do
  if ! "$migrate_root/node_modules/.bin/tsx" \
    "$runtime_script" --help >/dev/null 2>&1; then
    printf '%s\n' \
      "setup_required: route runtime smoke check failed: $runtime_script" \
      >&2
    exit 1
  fi
done

printf '%s\n' "$repo_root"
