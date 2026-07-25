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

# session_destination_rejections: the user's "I didn't reach this" veto. Every
# path that inserts an auto 'reached' row must anti-join it, or a rejection is
# silently resurrected by the next re-process / destination create / boundary
# edit / backfill.
#
# Naming the known writers is not enough — that is exactly how the fourth one
# (link_sessions_on_destination_update) went unguarded for months. So DISCOVER
# the writers instead: every file that inserts into session_destinations must
# also mention session_destination_rejections, or be allowlisted with a reason.
#
# Scope notes:
#  - Older migrations are historical text; they are not re-applied and are not
#    scanned. 20260411_boundary_update_trigger.sql is the exception: it is the
#    only definition site of a live trigger function that schema.sql does not
#    carry, so it must point at the migration that patches it.
#  - __tests__ files stage rows directly as fixtures. They are not production
#    writers and cannot resurrect a rejection, so they are out of scope.
rejection_writers=$(
  {
    grep -rl "INSERT INTO session_destinations" cloud-sql/api/src web/src 2>/dev/null \
      | grep -v "__tests__"
    grep -l "INSERT INTO session_destinations" \
      cloud-sql/schema.sql \
      cloud-sql/migrations/20260411_boundary_update_trigger.sql 2>/dev/null
  } | sort -u
)

# Writers that legitimately do NOT anti-join. Every entry needs a reason.
#
# Currently empty: routes/sessions.ts used to sit here (it writes only manual
# rows, which the user is asserting directly) but it now owns the rejection
# writes themselves, so it references the table like every other writer.
#
# An allowlist entry that has since started mentioning the table is stale — the
# loop below fails on it rather than letting a dead exemption sit there quietly
# waiving a file that no longer needs waiving.
rejection_allowlist=()

for writer in $rejection_writers; do
  allowed=0
  for entry in ${rejection_allowlist[@]+"${rejection_allowlist[@]}"}; do
    if [ "$writer" = "$entry" ]; then allowed=1; fi
  done

  if [ "$allowed" -eq 1 ]; then
    if grep -q "session_destination_rejections" "$writer" 2>/dev/null; then
      echo "ERROR: $writer is in rejection_allowlist but already mentions" >&2
      echo "       session_destination_rejections — stale allowlist entry, remove it." >&2
      echo "       Edit rejection_allowlist in $0." >&2
      errors=$((errors + 1))
    fi
    continue
  fi

  if ! grep -q "session_destination_rejections" "$writer" 2>/dev/null; then
    echo "ERROR: $writer inserts into session_destinations but never mentions" >&2
    echo "       session_destination_rejections. An auto 'reached' writer must" >&2
    echo "       anti-join the user's rejections, or resurrect them silently." >&2
    echo "       Add the anti-join, or add $writer to rejection_allowlist in" >&2
    echo "       $0 with the reason it does not need one." >&2
    errors=$((errors + 1))
  fi
done

if [ "$errors" -gt 0 ]; then
  echo "" >&2
  echo "$errors cross-reference check(s) failed." >&2
  exit 1
fi

echo "Cross-refs OK"
