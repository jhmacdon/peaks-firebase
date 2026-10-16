# Rebase legacy WA routes before catalog loading

Compose reads the optional local `wa-legacy-routes-with-paths.ndjson` snapshot.
It writes `rebase-plans.ndjson`, `merge-plans.ndjson`, `rebase-summary.json` and
the usual catalog files under `.cache/compose`. No database or network is used.

From `cloud-sql/migrate`, run these local plans in order:

```sh
npm run trail-graph:compose
TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/load-catalog.ts --rebase --elevation
TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/load-catalog.ts --elevation
```

Each command stays dry-run by default. A future apply requires `DATABASE_URL`
and an operator connection. `--elevation` fetches tiles only during apply.
No apply or database connection ran during development.

The matcher places anchors about every 400 m along the old route. It penalizes
graph edges threefold beyond 25 m from the old line and tenfold beyond 50 m.
All catalog and legacy walks share one set of cuts, including curated splits.
Legacy spans outside the graph keep their old geometry. A failed final graph
leg keeps the known end approach; unresolved interior graph legs require review.
Tails include short attachment chords to graph vertices, capped by the 40 m
anchor snap radius. Each tail records its attachment gap and source route hash.
No whole unmatched route can pass by copying itself as a tail.

Acceptance requires symmetric Hausdorff distance <=50 m, ignoring the first and
last 100 m, and length within 7%. Hausdorff checks vertices plus samples no more
than 10 m apart. Routes under 400 m trim at most a quarter of their length.
The length check uses the supplied coordinates, not the old stored distance,
which can be stale. Both endpoint coordinates stay within 0.1 m of the snapshot.
Reviewed routes stay frozen. A state label such as `researching` alone does not
prove a live lease; the loader locks factory jobs and checks their live expiry.

The snapshot has a provenance source label, not full license metadata. Tails
therefore carry an explicit unresolved source in the offline graph. They cannot
be inserted unless the locked live legacy route has valid provenance, which is
copied without inventing a license. Every final route must have valid source
coverage; active routes must pass `peaks_route_passes_publish_integrity` or their
transaction rolls back. Mixed sources that the canonical predicate cannot
represent also fail that check. Legacy rebase keeps place links, names, status,
and session links. The path trigger queues rematches for active route changes.

Each route has its own transaction. The loader checks the source path and old
segment links, inserts needed graph segments, obtains elevation, replaces the
ordered links, forms the union of segment source IDs, and rebuilds the route.
An existing segment ID must still have exactly the planned XY; no source path,
Z or gain is replaced by the insert path. Cleanup deletes old whole lines only
after no route or other foreign key references them. Failure rolls back cleanup
and the replacement together. Other routes continue and get their own result.

A merge needs at least 90% shared segment length in both directions, or the same
trailhead and objective IDs with length within 5%. Old/New trail variants cannot
merge. One catalog row and one legacy ID can take part in at most one merge.
Non-ok rebases or catalog rows produce blocked merge proposals, never duplicate
new routes. Four reviewed routes remain on their separate frozen path.

A successful catalog merge uses the legacy ID, status, and sessions. It applies
the composer's graph segments, kind, shape, places and waypoints. WTA links append
without removing existing links. A nonempty slug stays. Valid legacy names stay;
name differences are reported for Josiah. Only abbreviation/case rules can change
the stored legacy name. The merge accepts either the unchanged source snapshot
or its completed, source-bound rebase. This permits a wholly graph-sourced merge
when the old route's unlicensed tail cannot be staged first. The old segment is
removed in the same transaction only if all its users have released it.

Josiah's preflight query remains unchanged: it excludes `triple-crown-%`, clips
the existing line to the incoming box, and buffers in the WA UTM zone. Exact
canonical graph segments can be reused by rebased legacy routes and prior
marker-owned catalog loads. Partial reviewed overlaps and any other outstanding
legacy whole lines still block catalog loading. The local dry-run cannot prove
those live overlaps have cleared. Stale pending imports with different cuts may
still need the existing marker-scoped prune plan; active or reviewed rows stay.

Results go to `rebase-load-plan.json` and `load-plan.json`; future apply results
go to `rebase-load-results.json` and `load-results.json`. No legacy session facts
are copied, deleted or moved in either replacement mode.
