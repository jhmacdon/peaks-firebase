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

catalog_file=""
output_file=""
while (($#)); do
  case "$1" in
    --catalog)
      if [[ -n "$catalog_file" || $# -lt 2 ]]; then
        echo "setup_required: --catalog requires one file" >&2
        exit 1
      fi
      catalog_file="$2"
      shift 2
      ;;
    --output)
      if [[ -n "$output_file" || $# -lt 2 ]]; then
        echo "setup_required: --output requires one file" >&2
        exit 1
      fi
      output_file="$2"
      shift 2
      ;;
    *)
      echo "setup_required: identity worker accepts only --catalog and --output" >&2
      exit 1
      ;;
  esac
done
if [[ -z "$catalog_file" || -z "$output_file" ]]; then
  echo "setup_required: identity worker requires --catalog and --output" >&2
  exit 1
fi

"$factory_scripts/worker_preflight.sh" >/dev/null
exec node "$script_dir/write_audit_output_atomically.mjs" \
  "$output_file" -- \
  node "$script_dir/fetch_destination_identity.mjs" \
  --catalog "$catalog_file" --secure-audit-catalog
