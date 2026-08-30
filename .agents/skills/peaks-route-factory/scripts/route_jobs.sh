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
source "$script_dir/route_job_claim_role.sh"

args=("$@")
checkout_kind="$("$script_dir/resolve_worker_checkout.sh" "$repo_root")"
expected_worker_id="$("$script_dir/resolve_route_worker_id.sh" "$checkout_kind")"

worker_artifact_root="cloud-sql/migrate/route-candidates/luna/worker-artifacts"
absolute_worker_artifact_root="$repo_root/$worker_artifact_root"

flag_value() {
  local flag="$1"
  local index
  for ((index = 0; index < ${#args[@]}; index++)); do
    if [[ "${args[$index]}" == "$flag" && $((index + 1)) -lt ${#args[@]} ]]; then
      printf '%s\n' "${args[$((index + 1))]}"
      return 0
    fi
  done
  return 1
}

require_worker_artifact_path() {
  local flag="$1"
  local expected_basename="$2"
  local require_existing="$3"
  local value
  local resolved
  local resolved_parent
  value="$(flag_value "$flag")" || {
    echo "$flag is required" >&2
    exit 2
  }
  case "$value" in
    "$worker_artifact_root"/*)
      resolved="$repo_root/$value"
      ;;
    "$absolute_worker_artifact_root"/*)
      resolved="$value"
      ;;
    *)
      echo "$flag must stay inside this checkout's worker-artifacts directory" >&2
      exit 2
      ;;
  esac
  resolved_parent="$(dirname "$resolved")"
  if [[ "$resolved_parent" != "$absolute_worker_artifact_root" ||
        "$(basename "$resolved")" != "$expected_basename" ]]; then
    echo "$flag must name $expected_basename in this checkout's worker-artifacts directory" >&2
    exit 2
  fi
  mkdir -p "$absolute_worker_artifact_root"
  if [[ -L "$absolute_worker_artifact_root" ||
        -L "$resolved" ]]; then
    echo "$flag must not use a symlinked worker-artifacts path" >&2
    exit 2
  fi
  if [[ "$require_existing" == "yes" && ! -f "$resolved" ]]; then
    echo "$flag must name an existing regular file" >&2
    exit 2
  fi
}

destination_id="$(flag_value "--destination-id" || true)"
lease_token="$(flag_value "--lease-token" || true)"
case "${args[0]:-}" in
  materialize)
    [[ -n "$destination_id" && -n "$lease_token" ]] || {
      echo "materialize requires --destination-id and --lease-token" >&2
      exit 2
    }
    require_worker_artifact_path \
      "--output" "${destination_id}-${lease_token}.geojson" no
    ;;
  materialize-result)
    [[ -n "$destination_id" && -n "$lease_token" ]] || {
      echo "materialize-result requires --destination-id and --lease-token" >&2
      exit 2
    }
    require_worker_artifact_path \
      "--output" "${destination_id}-${lease_token}-candidate.json" no
    ;;
  transition)
    [[ -n "$destination_id" && -n "$lease_token" ]] || {
      echo "transition requires --destination-id and --lease-token" >&2
      exit 2
    }
    transition_state="$(flag_value "--to" || true)"
    if flag_value "--artifact-path" >/dev/null; then
      require_worker_artifact_path \
        "--artifact-path" "${destination_id}-${lease_token}.geojson" yes
    fi
    if flag_value "--result-file" >/dev/null; then
      case "$transition_state" in
        candidate_ready) result_suffix="candidate" ;;
        approved) result_suffix="review" ;;
        needs_revision)
          if [[ "$checkout_kind" == "route-review" ]]; then
            result_suffix="review"
          else
            result_suffix="needs_revision"
          fi
          ;;
        waiting_rights|waiting_access|needs_human)
          if [[ "$checkout_kind" == "route-review" ]]; then
            result_suffix="review"
          else
            result_suffix="$transition_state"
          fi
          ;;
        pending_review) result_suffix="import" ;;
        *) result_suffix="$transition_state" ;;
      esac
      [[ -n "$result_suffix" ]] || {
        echo "--result-file requires --to" >&2
        exit 2
      }
      require_worker_artifact_path \
        "--result-file" \
        "${destination_id}-${lease_token}-${result_suffix}.json" yes
    fi
    if flag_value "--review-packet" >/dev/null; then
      [[ "$checkout_kind" == "route-review" &&
         "$transition_state" =~ ^(approved|needs_revision|waiting_rights|waiting_access|needs_human)$ ]] || {
        echo "--review-packet is allowed only for a route-review outcome" >&2
        exit 2
      }
      require_worker_artifact_path \
        "--review-packet" \
        "${destination_id}-${lease_token}-review-packet.json" yes
    fi
    if flag_value "--source-check" >/dev/null; then
      [[ "$checkout_kind" == "route-review" &&
         "$transition_state" =~ ^(approved|needs_revision|waiting_rights|waiting_access|needs_human)$ ]] || {
        echo "--source-check is allowed only for a route-review outcome" >&2
        exit 2
      }
      require_worker_artifact_path \
        "--source-check" \
        "${destination_id}-${lease_token}-source-check.json" yes
    fi
    ;;
esac

if [[ "${args[0]:-}" == "claim" ]]; then
  supplied_worker_id=""
  worker_id_count=0
  integrity_repairs_only_count=0
  for ((index = 0; index < ${#args[@]}; index++)); do
    if [[ "${args[$index]}" == "--integrity-repairs-only" ]]; then
      integrity_repairs_only_count=$((integrity_repairs_only_count + 1))
      continue
    fi
    if [[ "${args[$index]}" != "--worker-id" ]]; then
      continue
    fi
    worker_id_count=$((worker_id_count + 1))
    if ((worker_id_count > 1)); then
      echo "--worker-id may be supplied only once" >&2
      exit 2
    fi
    if ((index + 1 >= ${#args[@]})); then
      echo "--worker-id requires a value" >&2
      exit 2
    fi
    supplied_worker_id="${args[$((index + 1))]}"
  done
  if [[ -z "$supplied_worker_id" ]]; then
    if [[ -z "$expected_worker_id" ]]; then
      echo "canonical checkout claims require an explicit --worker-id" >&2
      exit 2
    fi
    args+=("--worker-id" "$expected_worker_id")
  elif [[ -n "$expected_worker_id" && "$supplied_worker_id" != "$expected_worker_id" ]]; then
    echo "worker ID $supplied_worker_id does not match checkout $checkout_kind" >&2
    exit 2
  fi
  if ((integrity_repairs_only_count > 1)); then
    echo "--integrity-repairs-only may be supplied only once" >&2
    exit 2
  fi
  if [[ "$checkout_kind" == "route-repair" && "$integrity_repairs_only_count" == "0" ]]; then
    args+=("--integrity-repairs-only")
  elif [[ "$checkout_kind" != "route-repair" && "$integrity_repairs_only_count" != "0" ]]; then
    echo "--integrity-repairs-only requires the route-repair checkout" >&2
    exit 2
  fi
  route_job_validate_claim_stage "$checkout_kind" "${args[@]}"
fi

exec "$script_dir/with_route_db.sh" \
  "$repo_root/cloud-sql/migrate/scripts/run-tsx.sh" \
  "$repo_root/cloud-sql/migrate/src/standard-route-jobs.ts" \
  "${args[@]}"
