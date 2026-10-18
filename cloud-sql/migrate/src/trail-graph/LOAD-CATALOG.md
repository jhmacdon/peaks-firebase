# WA catalog loader

The [state discovery composer](DISCOVERY.md) writes the same route and segment
schema for WA, OR, ID, and CA. Discovery rows must have status `ok`, even with
`--include-review`. This catalog loader applies and activates WA only, and
rejects other states before it opens a connection. To load Oregon, California
or Idaho, use the [bulk loader](LOAD-BULK.md).

For a legacy WA snapshot, follow the [rebase and merge workflow](REBASE.md).
It keeps legacy identities and session links instead of creating duplicates.
The apply order is migrations, retire-pilot, prune, rebase, catalog, activate,
then the required full session rematch backfill.

The default command makes a local dry-run plan. It opens no database connection:

```sh
TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/load-catalog.ts
```

Only composer `ok` rows enter the default plan. `--include-review` may stage review
rows as pending; those rows can never activate. There is no per-route approval
file or reviewer lane for this loader. The older trail-catalog factory keeps its
own review path and protected rows.

`load-plan.json` records SQL counts, skipped routes, destination matches, every
legacy-match decision. The exclusive prune mode writes `prune-plan.json`.
Counts are insert attempts;
shared destination/segment IDs may occur in several route transactions. The
report also gives distinct IDs. No affected-row or live-overlap count is known
from the supplied snapshots; live segment geometry and complete destination
`external_ids` still need the read-only preflight.

Before any apply writes, the same process completes a `BEGIN READ ONLY`
preflight. Apply requires an operator connection: the existing standard factory
and reviewer logins are bound to candidate leases and cannot run this bulk
loader. The migration grants activation execution to its operator after the
ownership transfer. It checks schema dependencies, loads current WA destinations and
legacy paths, and measures existing segment overlap with a 15 m buffer over at
least 80% of the new segment. Reviewed whole segments can replace an exact XY
match, in either direction, with their existing IDs and metadata. A partial
reviewed overlap cannot safely stand in for an entire segment: skip the route
and report that a split/recompose is needed. Other overlaps are allowed only
when all owning routes will be superseded by this activation run. The preflight
never alters reviewed geometry. Missing v2 kind/display metadata on a reused
reviewed segment stays unchanged.

The composer also adopts the fixed pieces in
`peaks-snapshot/wa-reviewed-catalog-segments.ndjson`, including frozen pending
catalog routes except the four approved pilots below. Reuse requires the same whole ID and XY. A transaction checks
the snapshot's full XYZ and refuses changed or missing assets. It never inserts
or samples a fixed segment. Route provenance unions the stored segment sources
after elevation so profiles from earlier imports retain their own source names.
Before inserting geometry shared with another replacement, a live guard checks
that its legacy owner is already superseded. A failed or later replacement
cannot authorize duplicates; the dependent route reports a retry instead.

Destination matching first uses `osm_node`, `osm_way`, or `osm_relation` IDs,
then normalized name and location: up to 400 m for trailheads/passes/camps, and
30 m for near-identical names with the same feature. The same resolver handles
new candidates across the load. Repeated route transactions retain idempotent
insert attempts so a failed earlier transaction cannot leave a later route
without its destination. Uncurated pass, saddle and glacier waypoints stay as
names in provenance. A new objective of those types needs an existing or curated
place; otherwise skip the route.

The `20261016_wa_catalog_activation.sql` migration keeps canonical rights
validation and adds one strict `wa_catalog` provenance object. It holds the
loader marker, composer status/hash, notes, approximate flag, waypoint names and dropped legacy links.
Route descriptions stay NULL. Source provenance still carries its exact credit
and contributing OSM IDs. `20261017_wa_catalog_source_bundles.sql` adds strict
source bundles for mixed graph/Peaks tails and completed-rebase receipts; see
[the rebase guide](REBASE.md). Both migrations must precede a future apply. Slugs use `peaks_route_catalog_slug(name,id)`.

The composed destination manifest is authoritative for both rebases and merges.
The composer resolves destination IDs before connector/contact checks. The loader
rechecks resolved summit contact before writes, so live dedupe cannot introduce a
false summit claim. Only contacted summit waypoints remain (<=5 m); omitted old places appear in
`wa_catalog.dropped_links`. Summit objectives can receive a Peaks-derived xc
endpoint connector over 5 m and at most 75 m, with null segment display name and
Z filled by elevation. This does not authorize spurs to intermediate summits or
connectors on non-summit kinds. See the rebase guide for the exact limits.

Each admitted route has its own transaction and rollback. A failure is recorded
and the run continues. Source geometry and manifest hashes must still match.
Every transaction sets `SET LOCAL peaks.defer_rematch = 'on'` immediately after
BEGIN. This requires PR #236's updated rematch triggers, which must all honor
the transaction setting. Each route inserts its ordered segment links in one
multi-row statement and its destination links in one multi-row statement.
Both segment loaders insert only; an existing ID never loses Z, gain or path.
The separate segment loader reports differing XY instead of replacing it.
`--elevation` uses the existing Terrarium sampler only during apply. It preserves
complete existing profiles and refuses protected incomplete profiles. An
ordinary dry run, including one with `--elevation`, fetches no tiles.

Activation requires `--elevation`. The loader refuses it while
`trg_enforce_peaks_route_cover_activation` exists, even if disabled. Only
`activate_wa_catalog_route(route_id)`, owned by an isolated NOLOGIN role, can
activate these imported routes. It requires the composer-ok marker, real
nonzero Z at every route point, gain, canonical elevation lineage and the
existing `peaks_route_passes_publish_integrity` predicate. That predicate checks
exact directed XYZ segment assembly, source rights/coverage, stats, all linked
summits within 5 m, and the existing kind-specific objective/loop contact rules.
The function records activated route and asset IDs so pruning cannot remove
something that once went live.

The loader caps activation batches at 50 attempts and pauses one second between
batches. It does not poll or wait for the rematch queue during loading.

After each successful active-route change or activation, the loader records the
route ID locally. It enqueues no sessions per route. At the end it prints and
writes `.cache/compose/rematch-needed.json` (or `--out/rematch-needed.json`).
The file accumulates affected IDs across rebase, catalog and activation runs,
with checkpoints after commits. Failed, rolled-back, skipped and pending-only
routes add no IDs. A supersede includes the former route if it was active.
Retire-pilot and prune add none: their guards allow pending routes only.
Dry-runs never write or clear this receipt.

**Required final step after apply:** run PR #236's
`cloud-sql/migrate/src/rematch-all-sessions.ts` backfill in batches while the
sweep drains. From `cloud-sql/migrate`, an authorized operator runs:

```sh
TSX_DISABLE_CACHE=1 node --import tsx src/rematch-all-sessions.ts --apply --batch-size 100
```

This is a separate database write; it did not run here. Watch the queue and
sweep, and pause/resume with the printed `--after <session-id>` cursor as needed.
The route ID file is an audit list, not a filter: the backfill must rematch all
eligible sessions, including old route links and sessions near the new paths.
Wait for the final queue drain before archiving `rematch-needed.json`. Do not
clear it between loader modes. Session route/segment facts remain stale until
this backfill and sweep finish.

A legacy supersede also needs the same objective destination, start gap <=300 m,
end gap <=150 m, >=80% of the old path within 30 m of the new, and compatible
route-variant names. Old/New Mailbox, Easton/Squak and other distinct approaches
do not match. The live update repeats objective/end/overlap checks and binds the
legacy name. A unique durable claim permits at most one replacement per legacy
route. Missing paths are unverified, never an assumed overlap.

Superseding and session moves occur in the activation transaction. New session
links use `source='auto'`, NULL coverage/intervals and `is_primary=false`; an
existing new-route PK wins. The loader deletes the old rows without queueing
sessions. The required final backfill queues sessions; `processSession` computes
the new facts.

`--retire-pilot` is an exclusive mode. It plans four transactions and needs no
graph outputs. The owned `retire_wa_catalog_pilot` function permits only the
four approved identities in batch `wa-cascades-20261013`: Skyline Loop (Paradise),
Lake Serene Trail, Rattlesnake Ledge via Rattlesnake Ledge Trail, and Lake
Twentytwo via Lake Twenty Two Trail. Apply requires the candidate table owner's
operator login. Each job and route must still be pending, with no lease, review
job, activation receipt, or session/list/plan/trip-report route reference.
The function keeps the job receipt, sets it rejected with reason
`superseded_by_wa_graph_catalog` and NULL route_id, retires the route as
superseded, detaches its links, and deletes only unreferenced segments. A repeat
recognizes the retained audit receipt. Absent pilots need no change.

The old pending-only trigger blocks even this operator status change. The
corrected 20261017 migration adds an exception for these exact pending route
identities, after their job receipt has the retirement audit and only while no
review/publication/user links exist. The base body comes from PR #235's cover
migration and retains all eight cover-column exemptions on reviewed rows.
Retirement itself still changes only status and updated_at.
Candidate-job, receipt-removal and reviewed-link guards remain unchanged.
Later apply modes check that all four pilots have retired before any writes.
Frozen inputs may still list their segments: only pilot-owned pieces are
ignored; pieces shared with any other frozen owner remain fixed. The four hikes
then enter the catalog as ordinary seed routes, without a stale reviewed-match
skip. Retirement handles their old overlaps; ordinary supersede matching does
not target them.

`--prune-pending` is an exclusive mode: it runs only a prune transaction and
never loads or merges catalog routes. It removes stale `wa-*` rows with this
loader's provenance marker. It keeps current composition IDs, all activated
receipts/assets, reviewed rows, and rows with user/foreign-key references. It
never deletes active routes or unmarked earlier imports. The latter cannot be
safely identified from an ID prefix alone. The flag stays dry-run unless apply
is explicitly requested. `--rebase` is also exclusive. After composing and
installing migrations, retire the pilots, prune, rebase with elevation, load
the catalog with elevation, activate with elevation, then run the full rematch
backfill and wait for its queue to drain. A catalog merge requires
a matching completed-rebase receipt and the expected rebased geometry/links;
it refuses the original snapshot even if that source still matches. Each option
must be a separate shell argument. Unknown, joined and incompatible flags fail
before input reads or a database connection.

Local checkout limits: the companion segment-model migration, PR #235's cover
trigger removal, and PR #236's added link-rematch triggers are not present here.
The updated PR #236 migration must preserve its pending-route checks and add
the `peaks.defer_rematch` opt-out to every rematch trigger. Apply preflight also
checks `session_routes.is_primary`.
No migration, live preflight, elevation fetch or activation ran in this task.
