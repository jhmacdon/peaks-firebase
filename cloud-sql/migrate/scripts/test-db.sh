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
route_worker_test_url() {
  node -e '
    const url = new URL(process.argv[1]);
    url.username = process.argv[2];
    url.password = process.argv[3];
    process.stdout.write(url.toString());
  ' "$TEST_DATABASE_URL" "$1" "$2"
}
if [[ "${ROUTE_WORKER_TEST_LOGINS_AVAILABLE:-0}" == "1" ]]; then
  export ROUTE_JOB_FACTORY_TEST_DATABASE_URL="${ROUTE_JOB_FACTORY_TEST_DATABASE_URL:-$(
    route_worker_test_url \
      "${ROUTE_FACTORY_TEST_DB_ROLE:-peaks-route-factory-test}" \
      "${ROUTE_FACTORY_TEST_DB_PASSWORD:-peaks_route_factory_test}"
  )}"
  export ROUTE_JOB_REVIEWER_TEST_DATABASE_URL="${ROUTE_JOB_REVIEWER_TEST_DATABASE_URL:-$(
    route_worker_test_url \
      "${ROUTE_REVIEWER_TEST_DB_ROLE:-peaks-route-reviewer-test}" \
      "${ROUTE_REVIEWER_TEST_DB_PASSWORD:-peaks_route_reviewer_test}"
  )}"
fi
export ROUTE_AUDIT_JOB_TEST_DATABASE_URL="${ROUTE_AUDIT_JOB_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"
export ROUTE_ELEVATION_JOB_TEST_DATABASE_URL="${ROUTE_ELEVATION_JOB_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"
export ROUTE_INTEGRITY_REPAIR_TEST_DATABASE_URL="${ROUTE_INTEGRITY_REPAIR_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"
export DESTINATION_SESSION_LINK_TEST_DATABASE_URL="${DESTINATION_SESSION_LINK_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"
export AREAS_LINKING_TEST_DATABASE_URL="${AREAS_LINKING_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"
export PHOTO_CANDIDATE_TEST_DATABASE_URL="${PHOTO_CANDIDATE_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"

# These DB-backed suites share one database, and several run global job-seed
# commands (e.g. "seed" CLI invocations that scan/claim across a shared job
# queue table) rather than scoping to rows they created. Node runs test files
# concurrently by default, so two such suites racing against the same tables
# collide. Test files must not run concurrently here. Raise TEST_CONCURRENCY
# only when passing an explicit file list known not to collide.
if [[ $# -gt 0 ]]; then
  exec env NODE_ENV=test node --test --test-concurrency="${TEST_CONCURRENCY:-1}" --import tsx "$@"
fi
exec env NODE_ENV=test node --test --test-concurrency="${TEST_CONCURRENCY:-1}" --import tsx src/__tests__/*.test.ts
