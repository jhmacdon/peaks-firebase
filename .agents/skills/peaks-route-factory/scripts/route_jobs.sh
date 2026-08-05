#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"

args=("$@")
if [[ "${args[0]:-}" == "claim" ]]; then
  checkout_kind="$("$script_dir/resolve_worker_checkout.sh" "$repo_root")"
  case "$checkout_kind" in
    route-factory)
      expected_worker_id="luna-route-worker-01"
      ;;
    route-repair)
      expected_worker_id="luna-route-repair-01"
      ;;
    *)
      echo "claim requires an approved route-factory checkout" >&2
      exit 2
      ;;
  esac
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
    args+=("--worker-id" "$expected_worker_id")
  elif [[ "$supplied_worker_id" != "$expected_worker_id" ]]; then
    echo "worker ID $supplied_worker_id does not match checkout $checkout_kind" >&2
    exit 2
  fi
  if ((integrity_repairs_only_count > 1)); then
    echo "--integrity-repairs-only may be supplied only once" >&2
    exit 2
  fi
  if [[ "$checkout_kind" == "route-repair" && "$integrity_repairs_only_count" == "0" ]]; then
    args+=("--integrity-repairs-only")
  elif [[ "$checkout_kind" == "route-factory" && "$integrity_repairs_only_count" != "0" ]]; then
    echo "--integrity-repairs-only requires the route-repair checkout" >&2
    exit 2
  fi
fi

exec "$script_dir/with_route_db.sh" \
  npm --prefix "$repo_root/cloud-sql/migrate" run routes:jobs -- "${args[@]}"
