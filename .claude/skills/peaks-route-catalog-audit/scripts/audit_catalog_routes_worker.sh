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
    echo "setup_required: catalog worker requires an approved audit checkout" >&2
    exit 1
    ;;
esac

output_file=""
forward_args=()
while (($#)); do
  case "$1" in
    --output)
      if [[ -n "$output_file" || $# -lt 2 ]]; then
        echo "setup_required: --output requires one file" >&2
        exit 1
      fi
      output_file="$2"
      shift 2
      ;;
    *)
      forward_args+=("$1")
      shift
      ;;
  esac
done

if [[ -z "$output_file" ]]; then
  exec "$factory_scripts/with_route_db.sh" \
    "$script_dir/audit_catalog_routes.sh" "${forward_args[@]}"
fi

exec node "$script_dir/write_audit_output_atomically.mjs" \
  "$output_file" -- \
  "$factory_scripts/with_route_db.sh" \
  "$script_dir/audit_catalog_routes.sh" "${forward_args[@]}"
