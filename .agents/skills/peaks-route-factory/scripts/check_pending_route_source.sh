#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"

source_kind=""
destination_id=""
route_id=""
replacement_route_id=""
lease_token=""

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --source)
      source_kind="${2:-}"
      shift 2
      ;;
    --destination-id)
      destination_id="${2:-}"
      shift 2
      ;;
    --route-id)
      route_id="${2:-}"
      shift 2
      ;;
    --lease-token)
      lease_token="${2:-}"
      shift 2
      ;;
    --replace-active-route)
      replacement_route_id="${2:-}"
      shift 2
      ;;
    *)
      printf '%s\n' "Unsupported source-check argument: $1" >&2
      exit 2
      ;;
  esac
done

for required_id in "$destination_id" "$route_id" "$lease_token"; do
  if [[ ! "$required_id" =~ ^[A-Za-z0-9_-]+$ ]]; then
    printf '%s\n' "Source check requires safe destination and route IDs" >&2
    exit 2
  fi
done
if [[ -n "$replacement_route_id" && ! "$replacement_route_id" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf '%s\n' "Source check requires a safe replacement route ID" >&2
  exit 2
fi

case "$source_kind" in
  osm)
    checker="$repo_root/.claude/skills/peaks-osm-route-approval/scripts/check_pending_osm_routes.mts"
    ;;
  usgs)
    checker="$repo_root/.claude/skills/peaks-osm-route-approval/scripts/check_pending_usgs_routes.mts"
    ;;
  *)
    printf '%s\n' "Source check requires --source osm or --source usgs" >&2
    exit 2
    ;;
esac

output_dir="$repo_root/cloud-sql/migrate/route-candidates/luna/worker-artifacts"
output_file="$output_dir/$destination_id-$lease_token-source-check.json"
temporary_file="$output_file.tmp.$$"
mkdir -p "$output_dir"
trap 'rm -f "$temporary_file"' EXIT

checker_args=(--route-id "$route_id" --format json)
if [[ -n "$replacement_route_id" ]]; then
  checker_args+=(--replace-active-route "$replacement_route_id")
fi

set +e
"$script_dir/with_route_db.sh" \
  "$repo_root/cloud-sql/migrate/scripts/run-tsx.sh" \
  "$checker" \
  "${checker_args[@]}" >"$temporary_file"
checker_status=$?
set -e

if [[ "$checker_status" -ne 0 && "$checker_status" -ne 2 ]]; then
  exit "$checker_status"
fi
if [[ ! -s "$temporary_file" ]]; then
  printf '%s\n' "Source checker returned no JSON" >&2
  exit 1
fi

chmod 600 "$temporary_file"
mv "$temporary_file" "$output_file"
trap - EXIT
printf '{"status":"%s","result_file":"%s"}\n' \
  "$([[ "$checker_status" -eq 0 ]] && printf pass || printf fail)" \
  "$output_file"
exit "$checker_status"
