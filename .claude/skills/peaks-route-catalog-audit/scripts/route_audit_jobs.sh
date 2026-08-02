#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"

args=("$@")
if [[ "${args[0]:-}" == "claim" ]]; then
  checkout_resolver="$repo_root/.agents/skills/peaks-route-factory/scripts/resolve_worker_checkout.sh"
  expected_worker_id="$("$checkout_resolver" "$repo_root")"
  case "$expected_worker_id" in
    luna-route-audit-01|luna-route-audit-02|luna-route-audit-03|luna-route-audit-04)
      ;;
    *)
      echo "claim requires an approved recurring audit checkout" >&2
      exit 2
      ;;
  esac
  supplied_worker_id=""
  for ((index = 0; index < ${#args[@]}; index++)); do
    if [[ "${args[$index]}" != "--worker-id" ]]; then
      continue
    fi
    if ((index + 1 >= ${#args[@]})); then
      echo "--worker-id requires a value" >&2
      exit 2
    fi
    supplied_worker_id="${args[$((index + 1))]}"
    break
  done
  if [[ -z "$supplied_worker_id" ]]; then
    args+=("--worker-id" "$expected_worker_id")
  elif [[ "$supplied_worker_id" != "$expected_worker_id" ]]; then
    echo "worker ID $supplied_worker_id does not match checkout $expected_worker_id" >&2
    exit 2
  fi
fi

exec "$repo_root/.agents/skills/peaks-route-factory/scripts/with_route_db.sh" \
  npm --prefix "$repo_root/cloud-sql/migrate" run routes:audit-jobs -- "${args[@]}"
