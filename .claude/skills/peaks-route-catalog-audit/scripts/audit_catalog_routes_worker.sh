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

case "$output_file" in
  /tmp/peaks-route-audit.*/catalog.json|\
  /tmp/peaks-route-audit-*/catalog.json|\
  /private/tmp/peaks-route-audit.*/catalog.json|\
  /private/tmp/peaks-route-audit-*/catalog.json)
    ;;
  *)
    echo "setup_required: catalog output must be a Peaks audit temp file" >&2
    exit 1
    ;;
esac

output_dir="$(dirname "$output_file")"
if [[ ! -d "$output_dir" ]]; then
  echo "setup_required: catalog output directory does not exist" >&2
  exit 1
fi
resolved_output_dir="$(cd "$output_dir" && pwd -P)"
case "$resolved_output_dir" in
  /tmp/peaks-route-audit.*|/tmp/peaks-route-audit-*|\
  /private/tmp/peaks-route-audit.*|/private/tmp/peaks-route-audit-*)
    ;;
  *)
    echo "setup_required: catalog output directory escaped the temp root" >&2
    exit 1
    ;;
esac

temporary_file="$(mktemp "$resolved_output_dir/.catalog.json.tmp.XXXXXX")"
trap 'rm -f "$temporary_file"' EXIT
"$factory_scripts/with_route_db.sh" \
  "$script_dir/audit_catalog_routes.sh" "${forward_args[@]}" \
  >"$temporary_file"
chmod 600 "$temporary_file"
node -e '
  const { renameSync } = require("node:fs");
  renameSync(process.argv[1], process.argv[2]);
' "$temporary_file" "$resolved_output_dir/catalog.json"
trap - EXIT
