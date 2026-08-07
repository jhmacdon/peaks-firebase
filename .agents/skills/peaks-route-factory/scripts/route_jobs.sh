#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"

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
  if [[ "$resolved_parent" != "$absolute_worker_artifact_root" ]]; then
    echo "$flag must name a direct worker-artifacts file without path traversal" >&2
    exit 2
  fi
  mkdir -p "$absolute_worker_artifact_root"
  if [[ -L "$absolute_worker_artifact_root" ||
        -L "$resolved" ]]; then
    echo "$flag must not use a symlinked worker-artifacts path" >&2
    exit 2
  fi
}

if [[ "$checkout_kind" != "canonical" ]]; then
  case "${args[0]:-}" in
    materialize|materialize-result)
      require_worker_artifact_path "--output"
      ;;
    transition)
      if flag_value "--result-file" >/dev/null; then
        require_worker_artifact_path "--result-file"
      fi
      if flag_value "--artifact-path" >/dev/null; then
        require_worker_artifact_path "--artifact-path"
      fi
      ;;
  esac
fi

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
fi

exec "$script_dir/with_route_db.sh" \
  npm --prefix "$repo_root/cloud-sql/migrate" run routes:jobs -- "${args[@]}"
