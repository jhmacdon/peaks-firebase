#!/usr/bin/env bash
#
# Run the migrate suite with every DB-backed test switched on.
#
# TEST_DATABASE_URL supplies one connection string; this script fans it out to
# the per-suite variables below. Any of those can still be set individually to
# aim one suite somewhere else. Provision the database first — see
# cloud-sql/test-db/README.md.
#
# Usage:
#   TEST_DATABASE_URL=postgres://peaks_test:PASS@127.0.0.1:5432/peaks_test \
#     npm run test:db                                          # whole suite
#   ... npm run test:db -- src/__tests__/protected-areas-linking.test.ts

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${TEST_DATABASE_URL:?TEST_DATABASE_URL must be set — see cloud-sql/test-db/README.md}"

# Each suite and provision.sh enforce this too; failing here is just earlier.
db_path="${TEST_DATABASE_URL%%\?*}"
if [[ "$db_path" != *_test ]]; then
  echo "refusing: TEST_DATABASE_URL must name a database ending in _test" >&2
  exit 1
fi

export ROUTE_JOB_TEST_DATABASE_URL="${ROUTE_JOB_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"
export ROUTE_AUDIT_JOB_TEST_DATABASE_URL="${ROUTE_AUDIT_JOB_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"
export ROUTE_ELEVATION_JOB_TEST_DATABASE_URL="${ROUTE_ELEVATION_JOB_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"
export ROUTE_INTEGRITY_REPAIR_TEST_DATABASE_URL="${ROUTE_INTEGRITY_REPAIR_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"
export DESTINATION_SESSION_LINK_TEST_DATABASE_URL="${DESTINATION_SESSION_LINK_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"
export AREAS_LINKING_TEST_DATABASE_URL="${AREAS_LINKING_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"

if [[ $# -gt 0 ]]; then
  exec env NODE_ENV=test node --test --import tsx "$@"
fi
exec env NODE_ENV=test node --test --import tsx src/__tests__/*.test.ts
