# Pre-merge test-db gate — firebase-trailheads, `trailheads-phase0` @ 9652dd0

Run 2026-08-19.

**STATUS: FAIL** — 2 failing tests out of 686. Neither touches this branch's
work; both are pre-existing defects in suites CI has never run. Everything the
branch adds passes.

## Target database

The README's documented path, followed exactly: a second database, `peaks_test`,
on the same Cloud SQL instance as production, through the Auth Proxy already
running on `127.0.0.1:5432`.

- `SELECT current_database()` → `peaks_test`, checked before provisioning, after
  provisioning, and inside the runner script before each suite.
- Server: PostgreSQL 15.18, PostGIS 3.6.0.
- Production `peaks` was never written to. It was read three times, with
  `SELECT count(*)` and two list queries, for the drift comparison below.

## Provisioning

```
export CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.14
ADMIN_DATABASE_URL="postgres://postgres:$(gcloud secrets versions access latest --secret=peaks-db-postgres-password)@127.0.0.1:5432/peaks_test" \
  ./cloud-sql/test-db/provision.sh
```

```
provisioning peaks_test (test role: peaks_test)
  resetting public schema
  applying schema.sql
  skip  20260429_split_attempt_group.sql — trg_session_attempt_groups_updated already in schema.sql
  skip  20260503_destination_match_radius.sql — SET ROLE peaks-api; the function itself is already in schema.sql
  skip  20260612_protected_areas_geometry.sql — column already has the target type in schema.sql
  skip  20260720_session_comparisons.sql — session_comparisons already in schema.sql
  skip  20260725_rainier_massif_boundary.sql — production data fixup; needs the real Rainier row
  migrations: 143 applied, 5 skipped
  applying grants
  tables:    41
  triggers:  22
  postgis:   3.6.0
done.
```

All 143 non-skipped migrations applied, this branch's
`20260819_data_source_runs.sql` among them. Nothing failed, so there is no
schema.sql/migration conflict to reconcile and the skip list stays at five.

It takes about 12 minutes against Cloud SQL — every migration opens its own
`psql` connection through the proxy. A first attempt under a 10-minute cap was
killed part-way; that is a harness limit, not a script fault.

### The new objects, and the privileges the test role gets on them

```
data_source_runs present: 1
data_source_freshness present: 1
data_source_runs S/I/U/D: true/true/true/true
data_source_runs seq usage: true
data_source_freshness select: true
```

End-to-end read through the new view, as the `peaks_test` role:

```
$ npm run check:data-freshness
Data source freshness (stale after 90 days):
  usfs_fees [required]: no run recorded — NEVER RUN
  usfs_bathrooms [required]: no run recorded — NEVER RUN
Stale or missing required sources: usfs_fees, usfs_bathrooms
```

Correct for an empty table: both required sources report never run, and the
command fails as designed.

## Counts against the documented 29 tables + 1 view

| Thing | Documented | `peaks_test` | live `peaks` |
|---|---|---|---|
| tables (public, all) | 29 | 41 | 49 |
| tables less `spatial_ref_sys` | — | 40 | 48 |
| views (public, all) | — | 3 | 2 |
| views less PostGIS metadata | 1 | **1** | 0 |
| columns on tables | 292 | 392 | — |
| triggers | 17 | 22 | 21 |

**The view count matches. The table, column and trigger counts do not.** Only
`data_source_freshness` is a real view; `geography_columns` and
`geometry_columns` are PostGIS metadata. So "1 view" is right, and the new view
is the one.

The table gap is a stale document, not a broken provisioner. Diffing the two
live table lists:

- In `peaks`, not in `peaks_test` (9): `_bd_queue`,
  `areas_backup_predupe_20260613`, `areas_boundary_backup_20260613`,
  `areas_repair_worklist_20260613`, `dedupe_pass2_worklist_20260613`,
  `dedupe_skiplog_20260613`, `destination_areas_backup_predupe_20260613`,
  `destination_areas_pre_tolerance_20260613`,
  `destinations_features_backup_20260613`. Every one is a leftover backup or
  worklist from the June 2026 area dedupe — the same never-checked-in repair
  work the README already describes. None of it is schema.
- In `peaks_test`, not in `peaks` (1): `data_source_runs`, this branch's table,
  correctly absent from production because its migration has not been applied
  there yet.

So `peaks_test` reproduces the real production schema exactly, plus the new
table. "29 tables, 1 view, 292 columns, 17 triggers" is out of date by 11
tables, 100 columns and 5 triggers; this branch bumped the sentence without
re-measuring.

### One genuine trigger difference

`peaks_test` carries a trigger production lacks:
`session_areas.trg_session_areas_touch_session`. It is defined in both
`cloud-sql/schema.sql` and `cloud-sql/migrations/20260728_session_area_sync.sql`,
so production is the side that is behind. Not this branch's problem, but a
checked-in migration is unapplied in production.

## Suites run

### `cloud-sql/api` — `npm run test:db` — PASS

```
ℹ tests 309
ℹ pass 309
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 189820.807125
```

All 13 DB-gated suites woke up: without `TEST_DATABASE_URL` the same command
runs 235 tests and skips 13 suites. Zero skip markers in the run.

### `cloud-sql/migrate` — `npm test` with the DB variables set — FAIL

```
ℹ tests 377
ℹ pass 375
ℹ fail 2
ℹ skipped 0
ℹ duration_ms 309028.022791
```

The migrate suites do not read `TEST_DATABASE_URL`. Each names its own variable,
all pointed at the same `peaks_test` URL, each asserting the name ends in
`_test`:

`ROUTE_JOB_TEST_DATABASE_URL`, `ROUTE_AUDIT_JOB_TEST_DATABASE_URL`,
`ROUTE_ELEVATION_JOB_TEST_DATABASE_URL`,
`ROUTE_INTEGRITY_REPAIR_TEST_DATABASE_URL`,
`DESTINATION_SESSION_LINK_TEST_DATABASE_URL`, and `DATABASE_URL`.

The eight previously-skipped tests, one line each:

| Test | File | Result |
|---|---|---|
| PostGIS destination update trigger ignores Z-only edits and links true XY edits | destination-session-link-update | pass |
| audit jobs recover leases, requeue stale catalogs, and retire vanished candidates | route-catalog-audit-jobs.integration | pass |
| legacy elevation state upgrades through the real migration and stays unchanged on rerun | route-elevation-jobs.integration | pass |
| route elevation jobs seed Peaks paths, atomically lease distinct work, and recover expired leases | route-elevation-jobs.integration | pass |
| processing rebuilds every Peaks route sharing a sampled segment, leaves user routes alone, and rolls back a bad sampler | route-elevation-jobs.integration | pass |
| shared bad routes require every summit to be covered and feed the repair job safely | route-integrity-repairs.integration | **fail** |
| a supervised claim selects only its named destination | standard-route-claim.integration | pass |
| human requeue stores its reason and returns a pending route to review | standard-route-requeue.integration | pass |

Two further DB-backed migrate tests exist that the brief did not count, because
Node's summary line does not count tests skipped inside a suite. Both hang off
the legacy bare `DATABASE_URL` flag. I ran them too:

| Test | File | Result |
|---|---|---|
| route area write invariant | route-areas-linking | pass |
| links contained + within-tolerance summits, ignores non-summits and far summits | protected-areas-linking | **fail** |

## The two failures, verbatim

### 1. `route-integrity-repairs.integration.test.ts` — the test role cannot run the migration

```
test at src/__tests__/route-integrity-repairs.integration.test.ts:2:1411
✖ shared bad routes require every summit to be covered and feed the repair job safely (5959.72ms)
  error: permission denied for schema public
      at /Users/josiahm/projects/peaks/firebase-trailheads/cloud-sql/migrate/node_modules/pg-pool/index.js:45:11
      at async TestContext.<anonymous> (/Users/josiahm/projects/peaks/firebase-trailheads/cloud-sql/migrate/src/__tests__/route-integrity-repairs.integration.test.ts:89:7)
    severity: 'ERROR',
    code: '42501',
```

Line 89 is `await pool.query(await readFile(REPAIR_MIGRATION, "utf8"))` — the
test applies `cloud-sql/migrations/20260803_route_integrity_repairs.sql` while
connected as `peaks_test`. That file creates functions, a table, indexes and a
trigger in schema `public`, which needs `CREATE` on the schema.

`grants.sql` grants `CREATE ON DATABASE` and `USAGE ON SCHEMA public`, and
deliberately no more, because production's `peaks-api` holds no DDL rights.
Confirmed on the provisioned database:

```
has_schema_privilege('peaks_test','public','CREATE') = false
```

So the test asks for a privilege the documented grant set is designed to
withhold. It would fail the same way in CI — except CI never runs it:
`.github/workflows/test-route-worker.yml` sets `ROUTE_JOB_*`,
`ROUTE_AUDIT_JOB_*` and `ROUTE_ELEVATION_JOB_*`, and never
`ROUTE_INTEGRITY_REPAIR_TEST_DATABASE_URL`. This suite has never run anywhere.

The fix is a choice between two designs: give the test its own schema and apply
the migration there, or apply the migration as the admin role during
provisioning and let the test connect as `peaks_test` to exercise it. Relaxing
`grants.sql` would destroy the point of the grant mirror, so it is the wrong
answer.

### 2. `protected-areas-linking.test.ts` — the fixture park swallows real summits

```
test at src/__tests__/protected-areas-linking.test.ts:22:358
✖ links contained + within-tolerance summits, ignores non-summits and far summits (3487.7605ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

    [
  +   '3BB52B238882AC74E14C',
  +   '430BEEBA48D5504F8690',
  +   '624B0D39DF066202F74C',
  +   '7C2624B9B96F187533A9',
  +   '8C37AB7C9E7607E25493',
  +   '90B5C0F8EE53C7983E97',
  +   'A5175DAC6CFC2F7E475F',
  +   'A874F9C18612142E190C',
      'area-link-1787196814036-772588-boundary',
      'area-link-1787196814036-772588-inside',
      'area-link-1787196814036-772588-near',
  +   'B068DEE08B0F3AB226F0',
  +   'B67DC579F5DDBF31AD4E',
  +   'BC28AD85F912A921CA26',
  +   'C1787AF807245041FFA7'
    ]

      at TestContext.<anonymous> (/Users/josiahm/projects/peaks/firebase-trailheads/cloud-sql/migrate/src/__tests__/protected-areas-linking.test.ts:89:12)
    code: 'ERR_ASSERTION',
    operator: 'deepStrictEqual',
```

Not pollution from a parallel test. The fixture area's boundary is

```sql
ST_GeomFromText('SRID=4326;MULTIPOLYGON(((-122 46,-121 46,-121 47,-122 47,-122 46)))')
```

— a full one-degree box over latitude 46–47, longitude −122 to −121, which is
the Mount Rainier and Goat Rocks country. `20260721_cascades_coverage_summits.sql`
inserts twelve real summits inside it, all created in the same batch during
provisioning:

```
3BB52B238882AC74E14C | 46.7090,-121.2327 | summit
430BEEBA48D5504F8690 | 46.6978,-121.2747 | summit
624B0D39DF066202F74C | 46.4353,-121.4489 | summit
...
C1787AF807245041FFA7 | 46.5696,-121.4793 | summit
```

The test calls `link_summit_destinations_to_areas(false)`, which is global, then
asserts the links on its own area are exactly its three fixture rows. On any
correctly provisioned database, twelve real summits link as well — correctly.
The assertion, not the function, is wrong: it should scope to the fixture ids
rather than demand an exact list. Like the other failure, this suite has never
run in CI, so nobody has seen it.

## Attribution

Neither failure belongs to this branch. Its own commits under `cloud-sql/`
touch only the trailhead-facts and freshness code, two api response tests, and
`test-db/README.md`:

```
cloud-sql/CLAUDE.md
cloud-sql/api/src/__tests__/destination-amenities-response.test.ts
cloud-sql/api/src/__tests__/route-destinations-embed.test.ts
cloud-sql/api/src/routes/destinations.ts
cloud-sql/api/src/routes/routes.ts
cloud-sql/migrate/docs/trailhead-data-refresh.md
cloud-sql/migrate/package.json
cloud-sql/migrate/src/__tests__/check-data-freshness.test.ts
cloud-sql/migrate/src/__tests__/import-trailhead-facts.test.ts
cloud-sql/migrate/src/__tests__/trailhead-facts-utils.test.ts
cloud-sql/migrate/src/check-data-freshness.ts
cloud-sql/migrate/src/import-trailhead-facts.ts
cloud-sql/migrate/src/trailhead-facts-utils.ts
cloud-sql/test-db/README.md
```

Neither failing test file, nor `grants.sql`, nor the cascades migration is in
that list. The local `main` ref is 137 commits behind and is not a usable
baseline for attribution, so this list — not a diff against `main` — is the
evidence.

## Concerns

1. **The documented counts are stale.** `test-db/README.md` and
   `cloud-sql/CLAUDE.md` both say 29 tables, 292 columns, 17 triggers. The real
   figures are 41 (40 excluding `spatial_ref_sys`), 392 and 22. Only the view
   count survives. Worth correcting in this branch, since this branch is the one
   that edited the sentence.
2. **`route-integrity-repairs.integration.test.ts` cannot pass under the
   documented grants**, and CI never runs it because
   `ROUTE_INTEGRITY_REPAIR_TEST_DATABASE_URL` appears in no workflow.
3. **`protected-areas-linking.test.ts` asserts an exact link list against a
   one-degree fixture park** that contains twelve real catalog summits. It fails
   on any fully migrated database.
4. **Two migrate suites still hang off the bare legacy `DATABASE_URL` flag** —
   `protected-areas-linking.test.ts` and `route-areas-linking.test.ts`. They do
   take the connection from that same variable, so gate and connection are one
   fact, but neither checks that the name ends in `_test`. `cloud-sql/CLAUDE.md`
   names this pattern as the thing never to reintroduce; these two predate the
   rule and were missed. A developer with `DATABASE_URL` pointed at production
   would run writes against it.
5. **The migrate package has no `test:db` script and no README of its own.**
   Its five environment variables are discoverable only by reading the test
   files. `test-db/README.md` documents the api path alone.
6. **Production is missing `trg_session_areas_touch_session`**, which both
   `schema.sql` and `20260728_session_area_sync.sql` create.
7. **Provisioning against Cloud SQL takes about 12 minutes** — 148 migrations,
   one connection each. Fine, but budget for it; a 10-minute timeout kills it
   mid-run.
8. **The machine's disk was full during the run** (926 GB volume at 100%, under
   1 GB free). An `ENOSPC` killed the first api attempt outright:
   `errno: -28, syscall: 'write', code: 'ENOSPC'`. Space freed on its own and
   the retry was clean, but the box is one large write away from failing again.
9. **The two packages share one `peaks_test` database here; CI gives each its
   own throwaway container.** Provisioning-inserted catalog rows are what
   failure 2 trips over, so a shared database is closer to the truth, not
   further from it — but the difference is worth knowing when comparing results
   with CI.

## Housekeeping

The repository is untouched: `git status` clean at 9652dd0, nothing committed.
Logs from the run are in the scratchpad — `provision.log`, `api-db.log`,
`migrate-db.log`, and the `-baseline` pair taken without database variables.
