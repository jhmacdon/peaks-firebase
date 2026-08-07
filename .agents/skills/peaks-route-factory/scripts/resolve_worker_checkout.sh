#!/usr/bin/env bash
set -euo pipefail

checkout_path="${1:-}"
if [[ -z "$checkout_path" ]]; then
  echo "checkout path is required" >&2
  exit 2
fi

case "$checkout_path" in
  /Users/josiahm/projects/peaks/firebase)
    printf '%s\n' "canonical"
    ;;
  /Users/josiahm/projects/peaks/.workers/firebase-route-factory)
    printf '%s\n' "route-factory"
    ;;
  /Users/josiahm/projects/peaks/.workers/firebase-route-factory-02)
    printf '%s\n' "route-factory-02"
    ;;
  /Users/josiahm/projects/peaks/.workers/firebase-route-factory-03)
    printf '%s\n' "route-factory-03"
    ;;
  /Users/josiahm/projects/peaks/.workers/firebase-route-factory-04)
    printf '%s\n' "route-factory-04"
    ;;
  /Users/josiahm/projects/peaks/.workers/firebase-route-repair)
    printf '%s\n' "route-repair"
    ;;
  /Users/josiahm/projects/peaks/.workers/firebase-route-audit)
    printf '%s\n' "luna-route-audit-01"
    ;;
  /Users/josiahm/projects/peaks/.workers/firebase-route-audit-02)
    printf '%s\n' "luna-route-audit-02"
    ;;
  /Users/josiahm/projects/peaks/.workers/firebase-route-audit-03)
    printf '%s\n' "luna-route-audit-03"
    ;;
  /Users/josiahm/projects/peaks/.workers/firebase-route-audit-04)
    printf '%s\n' "luna-route-audit-04"
    ;;
  /Users/josiahm/projects/peaks/.workers/firebase-route-elevation)
    printf '%s\n' "luna-route-elevation-01"
    ;;
  *)
    echo "setup_required: route worker checkout is not an approved path: $checkout_path" >&2
    exit 1
    ;;
esac
