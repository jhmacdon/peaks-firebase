# WA catalog loader

For a legacy WA snapshot, run the [rebase and merge workflow](REBASE.md) first.
It keeps legacy identities and session links instead of creating duplicates.

The default command makes a local dry-run plan. It opens no database connection:

```sh
TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/load-catalog.ts --prune-pending
```

Only composer `ok` rows enter the default plan. `--include-review` may stage review
rows as pending; those rows can never activate. There is no per-route approval
file or reviewer lane for this loader. The older trail-catalog factory keeps its
own review path and protected rows.

`load-plan.json` records SQL counts, skipped routes, destination matches, every
legacy-match decision and optional prune statements. Counts are insert attempts;
shared destination/segment IDs may occur in several route transactions. The
report also gives distinct IDs. No affected-row or live-overlap count is known
from the supplied snapshots, which omit legacy paths, segment geometry and
`external_ids`.

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

The new `20261016_wa_catalog_activation.sql` migration keeps canonical rights
validation and adds one strict `wa_catalog` provenance object. It holds the
loader marker, composer status/hash, notes, approximate flag and waypoint names.
Route descriptions stay NULL. Source provenance still carries its exact credit
and contributing OSM IDs. Slugs use `peaks_route_catalog_slug(name,id)`.

Each admitted route has its own transaction and rollback. A failure is recorded
and the run continues. Source geometry and manifest hashes must still match.
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

The loader caps activation batches at 50 attempts. Between batches, and after
the last, it polls the existing `session_rematch_queue` every 30 seconds until
empty. A 30-minute timeout stops further batches. No service or timer is added.

A legacy supersede also needs the same objective destination, start gap <=300 m,
end gap <=150 m, >=80% of the old path within 30 m of the new, and compatible
route-variant names. Old/New Mailbox, Easton/Squak and other distinct approaches
do not match. The live update repeats objective/end/overlap checks and binds the
legacy name. A unique durable claim permits at most one replacement per legacy
route. Missing paths are unverified, never an assumed overlap.

Superseding and session moves occur in the activation transaction. New session
links use `source='auto'`, NULL coverage/intervals and `is_primary=false`; an
existing new-route PK wins. All affected sessions enter the rematch queue before
the old rows are deleted. `processSession` computes the new facts.

`--prune-pending` adds a separate transaction to remove stale `wa-*` rows with
this loader's provenance marker. It keeps current composition IDs, all activated
receipts/assets, reviewed rows, and rows with user/foreign-key references. It
never deletes active routes or unmarked earlier imports. The latter cannot be
safely identified from an ID prefix alone. The flag stays dry-run unless apply
is explicitly requested.

Local checkout limits: the companion segment-model migration, PR #235's cover
trigger removal, and PR #236's added link-rematch triggers are not present here.
The existing `20261004_session_rematch_queue.sql` route trigger already ignores
pending inserts and pending-to-pending path changes. PR #236 must preserve that
rule for its new link triggers. Apply preflight also checks `session_routes.is_primary`.
No migration, live preflight, elevation fetch or activation ran in this task.
