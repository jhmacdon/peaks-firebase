#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
resolver="$script_dir/resolve_worker_checkout.sh"
identity_resolver="$script_dir/resolve_route_worker_id.sh"

check() {
  local path="$1"
  local expected_kind="$2"
  local expected_worker_id="$3"
  local actual_kind
  local actual_worker_id
  actual_kind="$("$resolver" "$path")"
  actual_worker_id="$("$identity_resolver" "$actual_kind")"
  if [[ "$actual_kind" != "$expected_kind" ]]; then
    printf 'expected %s for %s, got %s\n' \
      "$expected_kind" "$path" "$actual_kind" >&2
    exit 1
  fi
  if [[ "$actual_worker_id" != "$expected_worker_id" ]]; then
    printf 'expected %s for %s, got %s\n' \
      "$expected_worker_id" "$path" "$actual_worker_id" >&2
    exit 1
  fi
}

check /Users/josiahm/projects/peaks/.workers/firebase-route-factory \
  route-factory luna-route-worker-01
check /Users/josiahm/projects/peaks/.workers/firebase-route-factory-02 \
  route-factory-02 luna-route-worker-02
check /Users/josiahm/projects/peaks/.workers/firebase-route-factory-03 \
  route-factory-03 luna-route-worker-03
check /Users/josiahm/projects/peaks/.workers/firebase-route-factory-04 \
  route-factory-04 luna-route-worker-04
check /Users/josiahm/projects/peaks/.workers/firebase-route-repair \
  route-repair luna-route-repair-01

if "$resolver" /Users/josiahm/projects/peaks/.workers/firebase-route-factory-05 \
  >/dev/null 2>&1; then
  printf 'unapproved checkout was accepted\n' >&2
  exit 1
fi

printf 'worker checkout resolution: ok\n'
