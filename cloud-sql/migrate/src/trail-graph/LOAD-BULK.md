# Bulk catalog load for Oregon, California and Idaho

Run the stages in this order: install migrations, then compose, load and activate
each state, then rematch all sessions. Use the existing Cloud SQL instance and
proxy with a migration operator connection in `DATABASE_URL`. The factory and
reviewer logins cannot run this loader. No production step ran during development.

Run the commands below from `cloud-sql/migrate`. Set `OR_INPUT_DIR`,
`CA_INPUT_DIR` and `ID_INPUT_DIR` to the prepared input directories for each state.
Each state also needs its built graph at `../../.cache/<state>/graph`, where the
state directory uses lowercase letters. Keep states in separate directories.

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

## 2. Compose, load and activate each state

The current composer has `--input`, `--graph` and `--out`; it has no `--state`
flag. Its input filenames still use `wa-` internally. Each configured input
directory must hold that state's data under these names:

- `seed/wa-hike-seed.json`
- `peaks-snapshot/wa-destinations.ndjson`
- `peaks-snapshot/wa-routes.ndjson`
- `peaks-snapshot/wa-route-popularity.ndjson`
- `peaks-snapshot/wa-reviewed-catalog-segments.ndjson`, when frozen assets exist

Each graph directory needs `segments.ndjson`, `features.ndjson` and
`access.ndjson`. The composer writes `routes.ndjson` and `segments.ndjson` to
the output directory; route records carry their place references. Keep those
files together. The loader checks the source composition before adding state
prefixes to new route and segment IDs. Frozen IDs stay unchanged. New rows
carry `state_code`; the route's `wa_catalog` provenance marker also records it.
The internal `wa_catalog` key and loader name retain the existing guard checks.

Set the three input variables, then run this sequence. Each dry run uses local
files, opens no database connection and fetches no elevation tiles. Review
`bulk-plan.json` in that state's compose directory before its apply command.

```sh
set -e
: "${OR_INPUT_DIR:?Set OR_INPUT_DIR to the prepared Oregon input directory}"
: "${CA_INPUT_DIR:?Set CA_INPUT_DIR to the prepared California input directory}"
: "${ID_INPUT_DIR:?Set ID_INPUT_DIR to the prepared Idaho input directory}"
: "${DATABASE_URL:?Set DATABASE_URL to the migration operator connection}"

for catalog_state in OR CA ID; do
  case "$catalog_state" in
    OR) catalog_key=or; catalog_input="$OR_INPUT_DIR" ;;
    CA) catalog_key=ca; catalog_input="$CA_INPUT_DIR" ;;
    ID) catalog_key=id; catalog_input="$ID_INPUT_DIR" ;;
  esac
  catalog_graph="../../.cache/$catalog_key/graph"
  catalog_compose="../../.cache/$catalog_key/compose"

  TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/compose.ts \
    --input "$catalog_input" --graph "$catalog_graph" --out "$catalog_compose"

  TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/load-catalog.ts \
    --bulk --state "$catalog_state" --dir "$catalog_compose" --batch-size 50

  TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/load-catalog.ts \
    --bulk --state "$catalog_state" --dir "$catalog_compose" --batch-size 50 --apply

  TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/load-catalog.ts \
    --bulk --state "$catalog_state" --dir "$catalog_compose" --batch-size 50 --activate

  TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/load-catalog.ts \
    --bulk --state "$catalog_state" --dir "$catalog_compose" --batch-size 50 --activate --apply
done
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
