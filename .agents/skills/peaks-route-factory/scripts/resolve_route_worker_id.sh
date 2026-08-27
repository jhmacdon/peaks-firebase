#!/usr/bin/env bash
set -euo pipefail

checkout_kind="${1:-}"
case "$checkout_kind" in
  route-factory)
    printf '%s\n' "luna-route-worker-01"
    ;;
  route-factory-02)
    printf '%s\n' "luna-route-worker-02"
    ;;
  route-factory-03)
    printf '%s\n' "luna-route-worker-03"
    ;;
  route-factory-04)
    printf '%s\n' "luna-route-worker-04"
    ;;
  route-repair)
    printf '%s\n' "luna-route-repair-01"
    ;;
  route-review)
    printf '%s\n' "luna-route-reviewer-01"
    ;;
  canonical)
    printf '\n'
    ;;
  route-operator)
    printf '\n'
    ;;
  *)
    echo "worker ID requires an approved route-factory checkout" >&2
    exit 2
    ;;
esac
