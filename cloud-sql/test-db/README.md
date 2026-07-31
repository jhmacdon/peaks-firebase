# Test database

The DB-backed suites under `cloud-sql/api/src/__tests__/` used to run against the
production `peaks` database. They INSERT, UPDATE and DELETE across fifteen
tables. This directory provisions a database they can safely own.

## Quick start

The Cloud SQL Auth Proxy must be running:

```bash
cloud-sql-proxy donner-a8608:us-central1:peaks-db --port 5432
```

Provision once (safe to repeat — it rebuilds the schema from scratch):

```bash
export CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.14
ADMIN_DATABASE_URL="postgres://postgres:$(gcloud secrets versions access latest --secret=peaks-db-postgres-password)@127.0.0.1:5432/peaks_test" \
  ./cloud-sql/test-db/provision.sh
```

Then run the suite:

```bash
cd cloud-sql/api
export TEST_DATABASE_URL="postgres://peaks_test:$(gcloud secrets versions access latest --secret=peaks-test-db-password)@127.0.0.1:5432/peaks_test"
npm run test:db
```

`npm test` still works and needs no database — the DB-backed files skip.

## What exists

| Thing | Where | Notes |
|---|---|---|
| Database `peaks_test` | same Cloud SQL instance as `peaks` | separate database, no shared rows |
| Role `peaks_test` | same instance | holds exactly what `peaks-api` holds in production |
| Password | Secret Manager `peaks-test-db-password` | |

The instance is shared; the data is not. `peaks_test` has no privileges on any
`peaks` table, and the only thing `PUBLIC` can read there is PostGIS metadata
(`geometry_columns`, `geography_columns`, `spatial_ref_sys`).

## TEST_DATABASE_URL

`TEST_DATABASE_URL` both switches the suites on and supplies the connection.
That pairing is the point. It replaced `DATABASE_URL`, which only ever switched
them on: the connection still came from `DB_HOST` / `DB_NAME` / `DB_USER` /
`DB_PASS`, so setting `DATABASE_URL` to any non-empty string turned on eleven
files of writes and aimed them at whatever those variables held — production, on
most developer machines.

Two rules now hold, both in `api/src/db.ts` and both covered by
`api/src/__tests__/test-database-guard.test.ts`:

- When `TEST_DATABASE_URL` is set it is the only source. `DB_*` is ignored, not
  merged, so a stale production value cannot leak in through a field the URL
  leaves out.
- The database it names must end in `_test`. Anything else throws, and `peaks`
  throws with a message that says so. Note that `test` on its own does not end
  in `_test` and is rejected.

`provision.sh` applies the same name rule before it touches anything, because it
drops the `public` schema.

## Running in parallel

`--test-concurrency=1` is no longer needed. `npm run test:db` defaults to 6 and
takes `TEST_CONCURRENCY` to override.

What made parallel runs fail was never the test code — it was connections. Each
test file is its own child process with its own pool. At the old default of 8
per pool, twelve files at once asked for around ninety connections; the
instance allows 25, of which about five are already taken by system processes.
The pool default now drops to 2 under `NODE_ENV=test`, which is what makes
parallel runs fit.

Measured on the shared instance: 6, 12 and 16 all pass. 6 is the default because
this instance also serves production, and the spare speed is not worth crowding
it — 12 finished in 61s against 79s at 6.

## How the schema is built

`provision.sh` applies `schema.sql`, then every file in `migrations/`, then
`grants.sql`.

Some migrations grant to the production `peaks-api` role. That role already
exists on Cloud SQL because roles are cluster-wide. The provisioner creates a
NOLOGIN stand-in on disposable CI and local Postgres so those migrations replay
unchanged; tests still connect only as `peaks_test`.

**`schema.sql` alone is not enough**, despite what its header implies. It is a
partly-maintained baseline. Building a database from it and diffing against live
`peaks` shows it missing the `link_sessions_on_destination_update` trigger,
`areas_refresh_boundary_display`, the destination place-copy and hero-credit
columns, `areas.parent_area_id`, and the destination search vector. Applying
`schema.sql` **and** `migrations/` reproduces live `peaks` exactly: 28 tables,
281 columns, 17 triggers, all matching.

`schema.sql` also carries no `GRANT` statements — production privileges were
applied by hand when the instance was built — so `grants.sql` restates them.
Tests connect as `peaks_test`, holding the same rights `peaks-api` holds in
production, which is what lets a missing `INSERT` privilege on a new table fail
in a test rather than in production.

Five migrations are skipped, each named in `provision.sh` with its reason. Four
create something `schema.sql` already contains; the fifth is a data fixup that
needs the real Mount Rainier row. **A new migration that fails provisioning is a
real conflict** between it and `schema.sql`. Reconcile the two rather than adding
a sixth entry to that list.

Three functions exist in live `peaks` and not here — `merge_area_group`,
`merge_area_group_robust`, `repair_areas_batch_20260613`. They are one-off repair
helpers from the June 2026 area dedupe, never checked in, and nothing uses them.

## CI

The `test-api` job in `.github/workflows/deploy.yml` runs the whole suite against
a throwaway `postgis/postgis:15-3.5` service container, and `deploy-api` now
depends on it. Before that job existed these suites skipped in CI — nothing set
the gate — so the triggers, plpgsql and spatial matching they cover reached
production unexercised.

Production is PostgreSQL 15.17 with PostGIS 3.6.0. The `postgis` images stop at
3.5 for Postgres 15. Matching the Postgres major matters more: every spatial
function the suite touches is unchanged between PostGIS 3.5 and 3.6.

## Local Postgres instead

Nothing here is specific to Cloud SQL. Point `ADMIN_DATABASE_URL` at any
PostGIS-capable Postgres and provisioning works the same way; `provision.sh`
creates the `peaks_test` role if it is missing. On a Mac that means
`brew install postgresql@17 postgis` — budget several GB, since PostGIS pulls in
GDAL, PROJ and SFCGAL.
