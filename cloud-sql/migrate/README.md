# peaks-migrate

Firestore → PostGIS backfill scripts, data importers, and the route-factory
job workers. See `package.json` scripts for the full command list.

## Tests

```bash
npm test          # no database needed; DB-backed suites skip
npm run test:db   # everything, against a provisioned *_test database
```

`test:db` wants one variable and fans it out to every DB-backed suite:

```bash
export TEST_DATABASE_URL="postgres://peaks_test:$(gcloud secrets versions access latest --secret=peaks-test-db-password)@127.0.0.1:5432/peaks_test"
npm run test:db
npm run test:db -- src/__tests__/protected-areas-linking.test.ts   # one file
```

Provision the database first — see `../test-db/README.md`. The URL must name a
database ending in `_test`; the runner and each suite refuse anything else.

## Per-suite variables

`test:db` sets these from `TEST_DATABASE_URL` unless already set. Setting one
by hand (with plain `npm test`) switches only its suites on.

| Variable | Suites |
|---|---|
| `ROUTE_JOB_TEST_DATABASE_URL` | standard-route-claim, standard-route-requeue, standard-route-worker-dml operator setup |
| `ROUTE_JOB_FACTORY_TEST_DATABASE_URL` | standard-route-claim and standard-route-worker-dml factory checks; the runner builds this from the disposable factory login |
| `ROUTE_JOB_REVIEWER_TEST_DATABASE_URL` | standard-route-claim and standard-route-worker-dml reviewer checks; the runner builds this from the disposable reviewer login |
| `ROUTE_AUDIT_JOB_TEST_DATABASE_URL` | route-catalog-audit-jobs |
| `ROUTE_ELEVATION_JOB_TEST_DATABASE_URL` | route-elevation-jobs |
| `ROUTE_INTEGRITY_REPAIR_TEST_DATABASE_URL` | route-integrity-repairs |
| `DESTINATION_SESSION_LINK_TEST_DATABASE_URL` | destination-session-link-update (falls back to `ROUTE_ELEVATION_JOB_TEST_DATABASE_URL`) |
| `AREAS_LINKING_TEST_DATABASE_URL` | protected-areas-linking, route-areas-linking |
| `PHOTO_CANDIDATE_TEST_DATABASE_URL` | listed-destination-photo-candidates |

The DB-backed files run serially by default: several suites run global
job-seed commands against shared tables, so concurrent test files collide.
`TEST_CONCURRENCY` overrides that — raise it only when passing an explicit
file list known to be safe.

Setting a per-suite variable by hand skips the runner's `_test` name gate.
Each suite still checks the name itself before connecting.

There is no bare `DATABASE_URL` gate. There used to be; `cloud-sql/CLAUDE.md`
explains why it must not come back.

CI runs the whole set: `.github/workflows/test-route-worker.yml` provisions a
throwaway PostGIS container with `test-db/provision.sh`, then runs
`npm run test:db`.

## Listed route and cover goal

After the route-cover view migration is applied, audit every destination on a
Peaks-owned list and every active Peaks-owned route:

```bash
.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/scripts/audit-listed-route-cover-goal.sh \
  --format summary
```

Use `--format tsv --incomplete-only` or `--format json --incomplete-only` for
the exact gaps. Detail rows identify either a `listed_destination` or an
`active_peaks_route`, so an orphan or unlisted route cannot disappear from the
report. The final cutover check adds `--require-complete`; it exits 1
until every listed destination is a summit with a fully credited cover, every
listed destination has a publish-valid active standard route with a derived
cover, and no active Peaks-owned route lacks a cover. The command uses operator
database access; route-factory, route-repair, and route-review checkouts reject
it.

The audit forces read-only database transactions. It adds no service or stored
copy and has a fixed cost of $0/month.

Apply `20260831_route_cover_activation_gate.sql` after the route-cover view.
Its deferred trigger stops a pending Peaks-owned route from becoming active
unless one linked destination supplies an image, named credit, and credit link.
The final zero-gap audit still checks old active routes and later photo changes.
The trigger adds no service and has a fixed cost of $0/month.
