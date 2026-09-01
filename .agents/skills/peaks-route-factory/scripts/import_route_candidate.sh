#!/bin/bash -p
set -euo pipefail

initial_script_dir="${BASH_SOURCE[0]%/*}"
if [[ "$initial_script_dir" == "${BASH_SOURCE[0]}" ]]; then
  initial_script_dir="$PWD"
elif [[ "$initial_script_dir" != /* ]]; then
  initial_script_dir="$PWD/$initial_script_dir"
fi
builtin source "$initial_script_dir/route_worker_environment.sh"
sanitize_route_worker_environment

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"

worker_artifact_root="cloud-sql/migrate/route-candidates/luna/worker-artifacts"
absolute_worker_artifact_root="$repo_root/$worker_artifact_root"
args=("$@")

destination_id=""
lease_token=""
candidate_path=""
result_path=""
apply_requested=0
source_url_count=0
candidate_count=0
destination_count=0
lease_count=0
trailhead_count=0
name_count=0
route_shape_count=0
elevation_profile_count=0
result_count=0
apply_count=0
license_ack_count=0
map_ack_count=0

fail_usage() {
  printf '%s\n' "$1" >&2
  exit 2
}

for ((index = 0; index < ${#args[@]}; index++)); do
  argument="${args[$index]}"
  case "$argument" in
    --upgrade-active-route)
      fail_usage "--upgrade-active-route is forbidden in the route factory"
      ;;
    --replace-active-route|--replace-pending-route)
      fail_usage "$argument is derived from the leased queue job and must not be supplied"
      ;;
    --candidate|--destination-id|--lease-token|--trailhead-id|--name|--source-url|--route-shape|--elevation-profile|--result-file)
      if ((index + 1 >= ${#args[@]})) || [[ "${args[$((index + 1))]}" == --* ]]; then
        fail_usage "$argument requires one value"
      fi
      value="${args[$((index + 1))]}"
      case "$argument" in
        --destination-id)
          destination_count=$((destination_count + 1))
          destination_id="$value"
          ;;
        --lease-token)
          lease_count=$((lease_count + 1))
          lease_token="$value"
          ;;
        --candidate)
          candidate_count=$((candidate_count + 1))
          candidate_path="$value"
          ;;
        --trailhead-id) trailhead_count=$((trailhead_count + 1)) ;;
        --name) name_count=$((name_count + 1)) ;;
        --source-url) source_url_count=$((source_url_count + 1)) ;;
        --route-shape) route_shape_count=$((route_shape_count + 1)) ;;
        --elevation-profile)
          elevation_profile_count=$((elevation_profile_count + 1))
          ;;
        --result-file)
          result_count=$((result_count + 1))
          result_path="$value"
          ;;
      esac
      index=$((index + 1))
      ;;
    --apply|--acknowledge-geometry-license|--acknowledge-map-review)
      case "$argument" in
        --apply)
          apply_count=$((apply_count + 1))
          apply_requested=1
          ;;
        --acknowledge-geometry-license)
          license_ack_count=$((license_ack_count + 1))
          ;;
        --acknowledge-map-review)
          map_ack_count=$((map_ack_count + 1))
          ;;
      esac
      ;;
    --*)
      fail_usage "unsupported route-factory import flag: $argument"
      ;;
    *)
      fail_usage "unexpected route-factory import argument: $argument"
      ;;
  esac
done

require_singleton() {
  local flag="$1"
  local count="$2"
  if ((count > 1)); then
    fail_usage "$flag may be supplied only once"
  fi
}

require_singleton --candidate "$candidate_count"
require_singleton --destination-id "$destination_count"
require_singleton --lease-token "$lease_count"
require_singleton --trailhead-id "$trailhead_count"
require_singleton --name "$name_count"
require_singleton --route-shape "$route_shape_count"
require_singleton --elevation-profile "$elevation_profile_count"
require_singleton --result-file "$result_count"
require_singleton --apply "$apply_count"
require_singleton --acknowledge-geometry-license "$license_ack_count"
require_singleton --acknowledge-map-review "$map_ack_count"

[[ -n "$destination_id" ]] || fail_usage "--destination-id is required"
[[ -n "$lease_token" ]] || fail_usage "--lease-token is required"
[[ -n "$candidate_path" ]] || fail_usage "--candidate is required"
if [[ ! "$destination_id" =~ ^[A-Za-z0-9_-]+$ ]]; then
  fail_usage "--destination-id contains unsupported characters"
fi
if [[ ! "$lease_token" =~ ^[A-Za-z0-9_-]+$ ]]; then
  fail_usage "--lease-token contains unsupported characters"
fi
if ((source_url_count < 1 || source_url_count > 4)); then
  fail_usage "--source-url must be supplied from one through four times"
fi
if ((apply_requested == 1)) && [[ -z "$result_path" ]]; then
  fail_usage "--apply requires --result-file"
fi

resolve_bound_artifact() {
  local flag="$1"
  local supplied="$2"
  local expected_basename="$3"
  local require_existing="$4"
  local resolved=""

  case "$supplied" in
    "$worker_artifact_root"/*) resolved="$repo_root/$supplied" ;;
    "$absolute_worker_artifact_root"/*) resolved="$supplied" ;;
    *)
      fail_usage "$flag must stay inside this checkout's worker-artifacts directory"
      ;;
  esac
  if [[ "$(dirname "$resolved")" != "$absolute_worker_artifact_root" ||
        "$(basename "$resolved")" != "$expected_basename" ]]; then
    fail_usage "$flag must be named $expected_basename in this checkout's worker-artifacts directory"
  fi
  if [[ -L "$absolute_worker_artifact_root" || -L "$resolved" ]]; then
    fail_usage "$flag must not use a symlinked worker-artifacts path"
  fi
  if [[ "$require_existing" == "yes" && ! -f "$resolved" ]]; then
    fail_usage "$flag must name an existing regular file"
  fi
}

resolve_bound_artifact \
  "--candidate" "$candidate_path" "${destination_id}-${lease_token}.geojson" yes
if [[ -n "$result_path" ]]; then
  resolve_bound_artifact \
    "--result-file" "$result_path" "${destination_id}-${lease_token}-import.json" no
  mkdir -p "$absolute_worker_artifact_root"
fi

# This check gives the wrapper a clear error before terrain work. The importer
# repeats it with FOR UPDATE in the same transaction that creates and binds the
# pending route, so lease expiry or reassignment cannot create an orphan.
"$script_dir/route_jobs.sh" check-import-lease \
  --destination-id "$destination_id" --lease-token "$lease_token" >/dev/null

exec "$script_dir/with_route_db.sh" \
  "$repo_root/cloud-sql/migrate/scripts/run-tsx.sh" \
  "$repo_root/.claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts" \
  "$@"
