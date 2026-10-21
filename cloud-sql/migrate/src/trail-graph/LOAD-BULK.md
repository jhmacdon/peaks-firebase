# Bulk catalog load for US states and DC

Run the stages in this order: install migrations, then build, discover, select,
load, and activate each non-WA state or DC, then rematch all sessions. Use the
migration operator connection in `DATABASE_URL`. The factory and reviewer
logins cannot run this loader. WA keeps its existing catalog path.

## 1. Install the migrations

This branch is cut from PR #237 and does not carry two migrations that are
already on `main`: `20261015_route_covers.sql` (PR #235, which drops
`trg_enforce_peaks_route_cover_activation`) and `20261015_segment_model_v2.sql`
(PR #236, which defines `rebuild_route_path(text)` and makes every rematch
trigger honour `SET LOCAL peaks.defer_rematch = 'on'`). `rematch-all-sessions.ts`
also lives on `main`. Run from a checkout that has both, or merge `main` first.
Do not begin an overnight load without the final rematch command available.
With the 20261015 migrations applied, run these in order as `postgres`:

```sh
set -e
: "${DATABASE_URL:?Set DATABASE_URL to the migration operator connection}"
test -f src/rematch-all-sessions.ts
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f ../migrations/20261016_wa_catalog_activation.sql
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f ../migrations/20261017_wa_catalog_source_bundles.sql
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f ../migrations/20261018_bulk_catalog_load.sql
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f ../migrations/20261021_us_catalog_states.sql
```

The bulk migration can run again. It adds no tables or indexes and rewrites no
tables. Four derivation triggers gain a transaction-local opt-out; all guard
triggers keep running. `refresh_route_derivations(text[])` restores area links,
the materialized elevation profile, catalog names and estimates before commit.
The setting clears at transaction end.

The new functions and replaced derivation/source functions belong to
`postgres`. One existing function, `activate_wa_catalog_route(text)`, keeps its
isolated `peaks-wa-catalog-publisher` NOLOGIN owner. The unchanged activation
guard requires that exact owner during status changes. The migration extends
only its state/ID eligibility and removes its temporary role membership before
commit. All review, elevation, rights, geometry and receipt checks stay intact.

## 2. Build, select, load and activate each state

Run from `cloud-sql/migrate`. Set one uppercase state code and its lowercase
cache key. `select-final` removes non-loadable discovery rows, copies the
segment file, and writes hard routes to `research.ndjson`.

```sh
set -e
: "${DATABASE_URL:?Set DATABASE_URL to the migration operator connection}"
catalog_state=CO
catalog_key=co
catalog_compose="../../.cache/$catalog_key/compose"
catalog_final="../../.cache/$catalog_key/final"

npm run trail-graph:build -- --state "$catalog_state"
npm run trail-graph:discover -- --state "$catalog_state"
npm run trail-graph:select-final -- --state "$catalog_state" \
  --from "$catalog_compose" --out "$catalog_final" --order research-first
TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/load-catalog.ts \
  --bulk --state "$catalog_state" --dir "$catalog_final" --batch-size 50 --apply
TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/load-catalog.ts \
  --bulk --state "$catalog_state" --dir "$catalog_final" --batch-size 50 --activate --apply
```

`--activate` selects a separate activation pass over already-loaded pending
routes for the current composition. It does not load routes. Activation calls
`activate_wa_catalog_routes(text[])` in chunks of at most 50 IDs. Each route
keeps the owned activation function's composer, elevation, source, geometry and
publish-integrity checks. One failed activation rolls back that route and leaves
the other results available. Failures are reported and do not abort the run.

Bulk loading admits composer `ok` rows only. It rejects review rows and performs
no legacy rebase. Existing Peaks routes stay in place. A live read-only query
checks destination dedupe and segment overlap once per batch; a new route that
overlaps another Peaks route is skipped with reason
`overlaps existing Peaks route`. This loader's own rows can be reused on a
repeat run. Frozen assets retain their existing identity, XYZ and rights.

Before each load transaction, the loader samples missing elevation with the
Terrarium sampler and its disk cache. Tile fetches use bounded concurrency.
Inside the transaction it defers rematching and route derivations, inserts
places, segments, routes and the two link sets with one statement each, rebuilds
paths on the server, then refreshes derived facts. Nothing commits until the
rebuild and refresh both succeed. When a rebuild fails, the loader drops the
routes it names and retries the rest once; any other failure splits the batch in
half until the failing route stands alone. One bad route costs extra server work
but never strands the other 199. Stable IDs and insert conflicts let a repeat
skip routes that already committed. Lower `--batch-size` if a batch holds locks
too long.

The loader appends load, skip, failure and activation results to
`../../.cache/<state>/bulk-results.ndjson`. Keep this file across runs. Check it
after each state and retry failed pending activations after fixing their cause.
It does not replace the final full-session rematch.

At the default 50 routes, a successful load batch uses one read-only preflight
query plus 12 transaction statements: BEGIN, two local settings, five collection
inserts, one stored-binding check, rebuild, refresh and COMMIT. Activation uses
one preflight plus four transaction statements: BEGIN, the rematch setting, one
activation call and COMMIT. The session advisory lock adds one query per process.
These counts stay fixed as the route count in a batch changes. Empty admitted
batches issue no load transaction.

## 3. Rematch all sessions

After the last state's activation pass, run the merged PR #236 backfill while
the normal sweep drains its bounded queue:

```sh
TSX_DISABLE_CACHE=1 node --import tsx src/rematch-all-sessions.ts --apply --max-queue 200
```

Use the backfill's printed cursor to resume an interrupted run. Rematch all
eligible sessions, including old links and sessions near the new routes; do
not filter by this load's route IDs. Wait for the final queue drain. Session
matches remain stale until the backfill and sweep finish.

This mode adds about $0/month in fixed costs. Batch writes, terrain fetches and
the final rematch consume the existing instance and network resources; there
is no added service, schedule, minimum instance or CPU allocation. Statement
counts describe client round trips, not the server work inside triggers and
functions. Run a small batch on a production clone before choosing an overnight
batch size for the shared CPU instance.

## What bulk mode saves, and what it does not

Bulk mode removes the client round trips (about 20 per route at about 100 ms
each through the proxy) and the per-row link and rematch trigger work. It does
not remove the derivation work itself. `refresh_route_derivations` runs the same
functions the skipped triggers would have run, once per route: area links,
the elevation profile, names and the two estimates. Each route row is still
updated twice, once by `rebuild_route_path` and once by the refresh, so the row
guards run twice per route. Budget server time per route from the
prod-clone measurements (estimates about 1.0 s, area links about 0.5 s, profile
about 0.25 s, guard about 0.23 s per write, plus the path assembly), not from the
statement count. Time the first batch on the clone; the DB test below prints a
per-statement breakdown.

## DB test

`src/__tests__/trail-graph-bulk-load.db.test.ts` needs the migration operator
on a disposable `*_test` database provisioned with `schema.sql`, every migration
including the two 20261015 files, and 20261016 through 20261018:

```sh
BULK_LOAD_TEST_DATABASE_URL=postgres://postgres:PASS@127.0.0.1:5432/bulk_load_test \
BULK_LOAD_TEST_ROUTES=200 \
  NODE_ENV=test node --test --import tsx src/__tests__/trail-graph-bulk-load.db.test.ts
```

It runs in one transaction and rolls back. It checks that the opt-out skips
the four triggers only inside its transaction, that a bulk batch refreshes to
the same values the per-row triggers write, that a repeat run plans nothing,
and that the rebuild and activation wrappers report a bad route without
failing the others. It prints the batch time and a per-statement breakdown.
