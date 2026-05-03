#!/usr/bin/env bash
# Cross-reference invariants for the codebase. CI fails if any check fails.
#
# When the schema or a load-bearing helper is referenced from multiple files
# (typed callers expecting a SQL function, parallel implementations that must
# stay in sync, etc.), add a check here so silent rot is caught at PR time
# instead of in production.
#
# Add new checks below by copying the existing pattern.

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

errors=0

check_callers() {
  local symbol="$1"
  local source_file="$2"
  shift 2
  local callers=("$@")

  if ! grep -q "$symbol" "$source_file" 2>/dev/null; then
    # Symbol not defined in source — nothing to check.
    return 0
  fi

  for caller in "${callers[@]}"; do
    if ! grep -q "$symbol" "$caller" 2>/dev/null; then
      echo "ERROR: $symbol is defined in $source_file but missing from $caller" >&2
      errors=$((errors + 1))
    fi
  done
}

# destination_match_radius: SQL function in schema.sql consumed by both the
# API's session-processing query and the web's destination-create backfill.
# All three must reference the function name or one of them is silently
# falling back to an inline CASE that drifts from the canonical radii.
check_callers \
  "destination_match_radius" \
  "cloud-sql/schema.sql" \
  "cloud-sql/api/src/processing.ts" \
  "web/src/lib/destination-backfill.ts"

if [ "$errors" -gt 0 ]; then
  echo "" >&2
  echo "$errors cross-reference check(s) failed." >&2
  exit 1
fi

echo "Cross-refs OK"
