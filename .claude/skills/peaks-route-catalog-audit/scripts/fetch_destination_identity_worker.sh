#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"
factory_scripts="$repo_root/.agents/skills/peaks-route-factory/scripts"

worker_id="$("$factory_scripts/resolve_worker_checkout.sh" "$repo_root")"
case "$worker_id" in
  luna-route-audit-01|luna-route-audit-02|luna-route-audit-03|luna-route-audit-04)
    ;;
  *)
    echo "setup_required: identity worker requires an approved audit checkout" >&2
    exit 1
    ;;
esac

"$factory_scripts/worker_preflight.sh" >/dev/null
exec node "$script_dir/fetch_destination_identity.mjs" "$@"
