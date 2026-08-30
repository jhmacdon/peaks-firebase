#!/usr/bin/env bash
#
# Provision a Peaks test database from the checked-in schema.
#
# Rebuilds the `public` schema from scratch, so it is safe to re-run and always
# lands on the same state. Works against any PostGIS-capable Postgres: a second
# database on the Cloud SQL instance (via the Auth Proxy), a Postgres service
# container in CI, or a local install.
#
# Usage:
#   ADMIN_DATABASE_URL=postgres://postgres:PASS@127.0.0.1:5432/peaks_test \
#     ./provision.sh
#
# Environment:
#   ADMIN_DATABASE_URL   required. Connects as a role that can create
#                        extensions and own the schema (Cloud SQL `postgres`,
#                        or the superuser in a container).
#   TEST_DB_ROLE         role the tests themselves connect as. Default
#                        `peaks_test`. Granted the same privileges `peaks-api`
#                        holds in production — see grants.sql.
#   TEST_DB_ROLE_PASSWORD  used only when the role has to be created (CI, local).
#                        On Cloud SQL the role already exists and is left alone.
#
# Why schema.sql is not enough on its own: it is a partially-maintained
# baseline. It carries most of the current schema but is missing everything
# added by later migrations that were never folded back in — the
# `link_sessions_on_destination_update` trigger, `areas_refresh_boundary_display`,
# destination place-copy and hero-credit columns, `areas.parent_area_id`, and the
# destination search vector. Applying schema.sql AND migrations/ reproduces the
# live schema exactly; applying either one alone does not.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUD_SQL_DIR="$(cd "$HERE/.." && pwd)"

: "${ADMIN_DATABASE_URL:?ADMIN_DATABASE_URL must be set}"
TEST_DB_ROLE="${TEST_DB_ROLE:-peaks_test}"
ROUTE_FACTORY_TEST_DB_ROLE="${ROUTE_FACTORY_TEST_DB_ROLE:-peaks-route-factory-test}"
ROUTE_FACTORY_TEST_DB_PASSWORD="${ROUTE_FACTORY_TEST_DB_PASSWORD:-peaks_route_factory_test}"
ROUTE_REVIEWER_TEST_DB_ROLE="${ROUTE_REVIEWER_TEST_DB_ROLE:-peaks-route-reviewer-test}"
ROUTE_REVIEWER_TEST_DB_PASSWORD="${ROUTE_REVIEWER_TEST_DB_PASSWORD:-peaks_route_reviewer_test}"

psql_admin() { psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"; }

# ---------------------------------------------------------------------------
# Safety gate. This script drops the whole `public` schema, so it must never be
# able to point at production. The database is asked for its own name rather
# than parsing the URL, so a hand-built or unusual connection string cannot slip
# past on a parsing quirk.
# ---------------------------------------------------------------------------
DB_NAME="$(psql "$ADMIN_DATABASE_URL" -tAc 'SELECT current_database()')"

if [[ "$DB_NAME" != *_test ]]; then
  cat >&2 <<EOF
refusing to provision "$DB_NAME": a test database name must end in "_test".

provision.sh drops and recreates the public schema. The name check is the last
line of defence against pointing it at production ("peaks"). Rename the target
database, or create a new one, rather than relaxing this check.
EOF
  exit 1
fi

echo "provisioning $DB_NAME (test role: $TEST_DB_ROLE)"

# ---------------------------------------------------------------------------
# Role. Already present on Cloud SQL; created on the fly for CI containers and
# local installs so the grant surface is identical everywhere.
# ---------------------------------------------------------------------------
ROLE_EXISTS="$(psql "$ADMIN_DATABASE_URL" -tAc \
  "SELECT 1 FROM pg_roles WHERE rolname = '$TEST_DB_ROLE'")"

if [[ -z "$ROLE_EXISTS" ]]; then
  echo "  creating role $TEST_DB_ROLE"
  psql_admin -c "CREATE ROLE \"$TEST_DB_ROLE\" LOGIN PASSWORD '${TEST_DB_ROLE_PASSWORD:-peaks_test}'"
fi

# Some production migrations grant directly to the production API role before
# this script applies its final test-role grants. Roles are cluster-wide, so
# Cloud SQL already has it; disposable CI and local Postgres do not.
PEAKS_API_ROLE_EXISTS="$(psql "$ADMIN_DATABASE_URL" -tAc \
  "SELECT 1 FROM pg_roles WHERE rolname = 'peaks-api'")"

if [[ -z "$PEAKS_API_ROLE_EXISTS" ]]; then
  echo "  creating migration grant role peaks-api"
  psql_admin -c 'CREATE ROLE "peaks-api" NOLOGIN'
fi

# ---------------------------------------------------------------------------
# Clean slate.
# ---------------------------------------------------------------------------
echo "  resetting public schema"
psql_admin -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
psql_admin -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# ---------------------------------------------------------------------------
# Baseline schema.
# ---------------------------------------------------------------------------
echo "  applying schema.sql"
psql_admin -f "$CLOUD_SQL_DIR/schema.sql" > /dev/null

# ---------------------------------------------------------------------------
# Migrations, oldest first.
#
# Two different reasons land a migration here, and they get different scrutiny:
#
# 1. It predates or duplicates what schema.sql already contains, so it cannot
#    apply on top of it. Each was checked against the live database: the
#    object it creates is already present and identical, so skipping it
#    changes nothing. A NEW migration that fails for THIS reason is a real
#    conflict — it means schema.sql and the migration have diverged — and
#    provisioning should fail loudly rather than gain another entry here.
# 2. It is a production-data fixup that asserts an exact count or value on
#    rows a bare schema can never hold — pre-existing Firestore-era catalog
#    or list-membership rows created outside migrations/ entirely (by the
#    one-time Firestore migration or the peakbagger importer script, neither
#    of which this script runs). Skipping changes nothing a fresh database
#    could have checked anyway; the assertion still guards prod, where the
#    migration is actually applied.
# ---------------------------------------------------------------------------
skip_reason() {
  case "$1" in
    20260429_split_attempt_group.sql)
      echo "trg_session_attempt_groups_updated already in schema.sql" ;;
    20260503_destination_match_radius.sql)
      echo "SET ROLE peaks-api; the function itself is already in schema.sql" ;;
    20260612_protected_areas_geometry.sql)
      echo "column already has the target type in schema.sql" ;;
    20260720_session_comparisons.sql)
      echo "session_comparisons already in schema.sql" ;;
    20260725_rainier_massif_boundary.sql)
      echo "production data fixup; needs the real Rainier row" ;;
    20260821_list_data_debts.sql)
      echo "production data fixup; asserts Oregon Volcanoes' real (importer-created) list membership holds exactly 11 rows" ;;
    20260827_listed_route_country_codes.sql)
      echo "production data fixup; asserts the exact 91 reviewed catalog destinations exist" ;;
    *) echo "" ;;
  esac
}

applied=0
skipped=0
for migration in "$CLOUD_SQL_DIR"/migrations/*.sql; do
  name="$(basename "$migration")"
  reason="$(skip_reason "$name")"
  if [[ -n "$reason" ]]; then
    echo "  skip  $name — $reason"
    skipped=$((skipped + 1))
    continue
  fi
  if ! psql_admin -f "$migration" > /dev/null 2>"$HERE/.migration-error"; then
    echo "  FAIL  $name" >&2
    cat "$HERE/.migration-error" >&2
    rm -f "$HERE/.migration-error"
    exit 1
  fi
  applied=$((applied + 1))
done
rm -f "$HERE/.migration-error"
echo "  migrations: $applied applied, $skipped skipped"

# ---------------------------------------------------------------------------
# Route-worker login roles.
#
# The worker-role migration creates NOLOGIN marker roles. These disposable
# logins let CI exercise the real factory/reviewer grants and trigger guards,
# rather than skipping those tests or running them as the broad API test role.
# ---------------------------------------------------------------------------
if [[ "${CREATE_ROUTE_WORKER_TEST_LOGINS:-0}" == "1" ]]; then
  if [[ -n "$(psql "$ADMIN_DATABASE_URL" -tAc \
    "SELECT 1 FROM pg_database WHERE datname = 'peaks'")" ]]; then
    cat >&2 <<'EOF'
refusing to grant route-worker marker roles on a cluster that contains the
production "peaks" database. PostgreSQL role membership spans every database
in a cluster. Run these privilege tests only in the throwaway CI/local cluster.
EOF
    exit 1
  fi
  echo "  configuring route-worker test logins"
  psql_admin \
    -v factory_role="$ROUTE_FACTORY_TEST_DB_ROLE" \
    -v factory_password="$ROUTE_FACTORY_TEST_DB_PASSWORD" \
    -v reviewer_role="$ROUTE_REVIEWER_TEST_DB_ROLE" \
    -v reviewer_password="$ROUTE_REVIEWER_TEST_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'factory_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'factory_role')
\gexec
SELECT format('CREATE ROLE %I LOGIN', :'reviewer_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'reviewer_role')
\gexec

ALTER ROLE :"factory_role" LOGIN PASSWORD :'factory_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
ALTER ROLE :"reviewer_role" LOGIN PASSWORD :'reviewer_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;

SELECT format('REVOKE %I FROM %I', granted.rolname, member.rolname)
FROM pg_auth_members membership
JOIN pg_roles granted ON granted.oid = membership.roleid
JOIN pg_roles member ON member.oid = membership.member
WHERE member.rolname = :'factory_role'
  AND granted.rolname <> 'peaks-route-factory'
\gexec
SELECT format('REVOKE %I FROM %I', granted.rolname, member.rolname)
FROM pg_auth_members membership
JOIN pg_roles granted ON granted.oid = membership.roleid
JOIN pg_roles member ON member.oid = membership.member
WHERE member.rolname = :'reviewer_role'
  AND granted.rolname <> 'peaks-route-reviewer'
\gexec
GRANT "peaks-route-factory" TO :"factory_role";
GRANT "peaks-route-reviewer" TO :"reviewer_role";
SQL
else
  echo "  route-worker test logins: skipped"
fi

# ---------------------------------------------------------------------------
# Privileges.
# ---------------------------------------------------------------------------
echo "  applying grants"
psql_admin -v "db_name=$DB_NAME" -v "test_role=$TEST_DB_ROLE" \
  -f "$HERE/grants.sql" > /dev/null

# ---------------------------------------------------------------------------
# Report. A structural summary makes drift visible without a second tool: these
# counts are what the live `peaks` database reports for the same queries.
# ---------------------------------------------------------------------------
psql "$ADMIN_DATABASE_URL" -tA <<'SQL'
SELECT '  tables:    ' || count(*) FROM pg_tables WHERE schemaname = 'public';
SELECT '  triggers:  ' || count(*) FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal AND n.nspname = 'public';
SELECT '  postgis:   ' || extversion FROM pg_extension WHERE extname = 'postgis';
SQL

echo "done."
