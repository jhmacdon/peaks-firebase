# Rebase legacy WA routes before catalog loading

Compose reads the local `wa-legacy-routes-with-paths.ndjson` snapshot. It writes
`rebase-plans.ndjson`, `merge-plans.ndjson`, `rebase-summary.json` and the catalog
files under `.cache/compose`. Compose and dry-runs use no database or network.

Install the segment-model, activation and
`20261017_wa_catalog_source_bundles.sql` migrations before a future apply. From
`cloud-sql/migrate`, plan the work in this order:

```sh
npm run trail-graph:compose
TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/load-catalog.ts --prune-pending
TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/load-catalog.ts --rebase --elevation
TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/load-catalog.ts --elevation
```

These commands are dry-runs. A future apply needs a separate `--apply` argument,
`DATABASE_URL` and an operator connection. Never quote several flags as one shell
argument. The CLI rejects unknown, joined, repeated or incompatible arguments.
Prune only prunes; rebase only rebases; the default only loads the catalog.
`--elevation` fetches tiles only during apply. No apply or database connection ran
in this task.

The matcher places anchors about every 400 m along the old route. It penalizes
graph edges threefold beyond 25 m from the old line, then tenfold beyond the
route's matching tolerance. All catalog and legacy walks share one set of cuts,
including curated splits. Legacy spans outside the graph retain their geometry
and record their source route hash and attachment gap. Retaining an interior
span adds a note; the final route must still pass all acceptance checks. Copying
more than 80% of a route as retained geometry requires review.

Dense lines require symmetric maximum deviation <=50 m and length within 7% of
the supplied coordinates. Sparse means median vertex spacing strictly >50 m.
Sparse lines require mean deviation <=40 m, maximum <=150 m, and at least 80% of
the mapped graph length on names from the legacy route or its known trail names.
Their length change is reported but has no separate 7% gate. Deviation checks
exclude the first and last 100 m; short routes trim at most a quarter. Means use
length-weighted samples, at most 10 m apart, in both directions. The start must stay within 0.1 m of the snapshot for either class. The end
also stays within 0.1 m, except for the summit connector rule below. A route with 150 vertices
does not qualify as sparse unless its measured spacing passes the threshold.

The matcher retains a short old span around each linked summit that the source
already reaches within 5 m. A summit route whose Peaks objective is over 5 m but
at most 75 m from the path end receives one straight xc connector to the exact
Peaks location. The connector has three vertices, null display name, no OSM IDs,
Peaks license/credit and `source_kind=peaks-derived`. Its description and route
provenance notes say `summit connector`; elevation fills Z later. Its provenance
uses the contributing snapshot retrieval time. The segment stays xc/null in SQL;
the stretch list folds it into the preceding named stretch for display.

Place IDs first use the loader's snapshot/name/OSM dedupe rules. If a destination-
kind seed resolves to a Peaks summit (Poo Poo Point), the composer records that
type conflict in notes and uses summit kind. Loops and traverses keep their kinds.
This avoids checking one location and then loading a nearby, different summit.
The loader checks resolved summit contact again and refuses an objective which
needs recomposition against changed live data. Retained resolved IDs never appear
in the final SQL provenance's dropped-link list.

This rule also repairs old summit ends such as Pilchuck. It never applies to a
non-summit kind, a new OSM-only destination, an intermediate summit or a gap over
75 m. Larger gaps require review and are reported. The canonical 5 m contact
rule stays. Reviewed routes stay frozen. A factory state label alone does
not prove a live lease; the loader locks jobs and checks their live expiry.

Josiah confirmed that the pre-catalog Peaks-owned lines were drawn or recorded
by Peaks. A retained span copies valid live source rights. If those rights are
NULL or invalid, it receives `peaks-legacy` credit, Peaks license and attribution,
`https://peaks.app` URLs, no OSM IDs and `contains_osm_geometry=false`. Its retrieval
time is the locked legacy row's `created_at`, never the load date. That column
is absent from the offline snapshot, so the SQL binds it during a future apply.
The owner must be `peaks` and the creation time must exist.

The old provenance model could not represent graph plus Peaks geometry: every
segment had to equal one route-level source kind, OSM flag and rights group.
An OSM segment with the flag true and a Peaks tail with the flag false cannot
both equal that header. The new migration adds a flat, strict `sources` array.
Each leaf must pass the original nine/eleven-field rights validator. Non-OSM
`peaks-derived` leaves use the same Peaks rights fields as `peaks-legacy`. Source
compatibility checks each segment leaf against a route leaf; source coverage
also requires every declared source and OSM way to occur in the linked segments.
The top-level header retains the primary source and union of OSM IDs. Elevation
metadata applies to each leaf. No credit is replaced by another source's credit.
`peaks_route_passes_publish_integrity` keeps its existing geometry, contact,
stats and elevation checks and calls these source helpers as before.

Each route has its own transaction. The loader checks the source path and old
segment links, inserts needed graph segments, obtains elevation, replaces the
ordered links, forms the union of stored segment sources, and rebuilds the route.
Both rebases and merges replace route destination links from their composed
manifest and set matching kind/shape/start/objective fields. A campsite objective
is a destination; a summit objective is a summit. A summit link must be within
5 m of the new path, including the endpoint rule for summit objectives. Other
waypoints use the existing 30 m contact radius (35 m for camps/glaciers). Areas
use source footprints; Peaks areas with only a boundary flag in the snapshot
can use a nearby same-name mapped source place. These area rules never apply to
summit contact, which always uses the exact Peaks point. Starts
use 125 m and ordinary objectives 250 m, with available area boundaries.
Untouched old places are removed from the links and recorded by ID, name, gap
and reason in `wa_catalog.dropped_links`. No return spur claims an intermediate
summit. DC therefore drops its untouched Southeast Crater Rim link. Missing
required start/objective contact requires review. Names, status and session links
stay intact in a pure rebase. Active
routes must pass canonical publish integrity or roll back. The existing path
trigger queues active-route rematches. Failures report individual guard results
and summit gaps; other route transactions continue.

After all checks pass, the same transaction writes a receipt bound to the
original source hash and ordered rebased segment hash. A catalog merge requires
that receipt and the completed rebase geometry/links. It cannot use the original
snapshot as a shortcut. A failed or skipped rebase blocks its merge before any
catalog insert or link change. A receipt also makes successful retries safe.

A merge needs at least 90% shared segment length in both directions, or the same
trailhead and objective IDs with length within 5%. Old/New variants cannot merge.
One catalog row and one legacy ID can take part in at most one merge. Non-ok
rebases or catalog rows produce blocked proposals, never duplicate new routes.
Four reviewed routes remain frozen.

A successful merge uses the legacy ID, status and sessions. It applies the
composer's segments, kind, shape, places and waypoints. WTA links append without
removing links. A nonempty slug stays. Valid legacy names stay; name differences
are reported for Josiah. Only abbreviation/case rules can change the legacy name.
Old whole-line segments are deleted only after no route, receipt or foreign key
references them. Cleanup rolls back with a failed replacement.

Josiah's overlap preflight stays unchanged: it excludes `triple-crown-%`, clips
the existing line to the incoming box, and buffers in the WA UTM zone. Dry-runs
cannot prove that live whole-line overlaps have cleared. A clone altered by an
earlier out-of-order catalog run may still fail source checks; this loader does
not undo those changes or weaken the checks. Use a fresh clone or a new reviewed
snapshot to plan that repair.

The migration uses positional `$1`/`$2` parameters throughout SQL-language
function bodies. This prevents an SRF's default `value` column from shadowing a
parameter, including in `wa_catalog_provenance_elevation`. It repeats the base
validator fix for clones where the prior activation migration already ran. The
`dropped_links` extension is typed and checked; source rights rules stay intact.

Plans go to `prune-plan.json`, `rebase-load-plan.json` and `load-plan.json`.
Future apply results go to `prune-results.json`, `rebase-load-results.json` and
`load-results.json`. Dry-runs leave prior apply result files intact.
