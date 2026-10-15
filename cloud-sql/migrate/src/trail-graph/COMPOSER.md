# Washington catalog composer

Run from `cloud-sql/migrate` with the normal package dependencies available:

```sh
npm run trail-graph:build
npm run trail-graph:compose
TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/load-catalog.ts
TSX_DISABLE_CACHE=1 node --test --import tsx \
  src/__tests__/trail-graph.test.ts src/__tests__/trail-compose.test.ts
```

The build and compose use local files only. The catalog loader defaults to a
dry run and neither imports `pg` nor opens a database connection in that mode.
The elevation sampler imports only during an apply run with `--elevation`.

Composition accepts `--input DIR` (default: the local `private/wa-trail-data`
input root), `--graph DIR` (default: this worktree's `.cache/graph`), and
`--out DIR` (default: `.cache/compose`). Loader `--out DIR` selects the composition
directory. No input file is changed.

`seed_index` is zero-based. The composer reads all 409 seed rows and the destination, route, and popularity
snapshots. It writes:

- `routes.ndjson`: one result for every seed, including unresolved rows.
- `segments.ndjson`: graph segments and derived pieces used to describe routes.
- `summary.json`: counts by status, region, and tier.
- `report.md`: tier-1 exceptions, Rainier checks, ten random ok entries from a
  fixed random seed, every non-ok entry, and duplicate names/endpoint matches.

The loader writes `load-plan.json`, including SQL, parameters, per-route notes,
skip reasons, and exact statement counts. Counts describe planned statements;
actual inserts, conflict skips, and affected rows require a database. Statements
for an already stored pending import, protected elevation, and activation are
conditional. Apply also performs one schema preflight outside the route plans.

## Place and path decisions

Feature extraction retains `@type/@id`, aliases, and full named-area boundaries.
Node, way, and relation IDs therefore remain distinct. Feature coordinates stay
at the source point or area centroid; `graph_coord` records the nearest boundary
vertex separately. Unnamed features do not enter the named feature output, but
unnamed glacier footprints still classify terrain.

Trail matching strips guesses and numbers, folds case and punctuation, and
accepts common abbreviations and ordinals, final Trail/Route, and upper/lower/north/south
variants. It also searches longer local names and source relation names. A
resolved guess does not force review; an unmatched name does. Ozette's guessed
coast route maps to the local official Beach Travelway names. Emmons uses the
Emmons Glacier Route from the seed notes, including OSM way 330301489.

Known objectives constrain trailhead names before they set geographic context.
This rejects distant homonyms such as Hidden Lake near Lake Wenatchee when the
objective is the Hidden Lake lookout in the North Cascades. Named campgrounds
and visitor sites can locate a start without a trailhead record.

Trailheads use exact Peaks/OSM identities, then distinctive tokens within 5 km
of the preferred network. Generic words such as trailhead, trail, parking,
upper, and lower do not count as identity. Candidates snap to connected preferred
vertices; a closer parking spur cannot divert the hike into a separate component.
Nearby Peaks trailheads remain a fallback within 500 m.

The build streams roads-parking.opl twice. It keeps exact public road vertices
within 150 m of graph ends/junctions and all public parking points and area
centroids, including names. Private/no-access and motorway vertices do not prove
a start. Inference considers preferred-network ends/junctions within 150 m of
this index. Out-and-back inference maximizes network distance from the goal;
wide PCT/Commonwealth networks minimize it on the first seed trail. A known
campground/start anchor limits this choice. Parking within 150 m supplies the new
place coordinate; otherwise the source road vertex does. New places use source
`inferred_road_contact`; `inferred trailhead` is a reason note and does not change
an otherwise ok status.

Objectives search source aliases and local tokens as well as exact names,
keeping feature compatibility and the 5 km Peaks/source or trail-end check.
Lakes/glaciers keep polygons and choose reachable shore vertices within 150 m.
Summits accept 150–400 m gaps as review with the measured gap; greater gaps need
geometry. A named last trail's dead end can supply a missing destination/summit
when the objective shares a distinctive token. These candidates always say
`objective at trail end` and require review.

Loops search bounded source cycles containing the seed trails in order. Short
unnamed links and mapped connecting trails can join the listed trails. Missing
loops cannot become unrestricted round trips. Ordered trail occurrences act as
via points; a short approach may share the return trail's name. Only a shared
start/end stem may repeat without review. The Burroughs seed explicitly names
Second Burroughs: cycle search must reach it, and a mapped summit spur remains
in the route with an explicit repeat/review reason when no simple cycle does. Traverses need a far trailhead named after the final
`to` in the seed notes.

The build recovers raw pedestrian links up to 400 m that touch the kept network
before pruning. Named, foot-permitted cycleways in the extract (e.g. Palouse to
Cascades) also survive. Source road stretches up to 400 m can join graph contacts,
even when the full OSM way is longer. No gap receives a made-up straight line.
Agency-only endpoints can snap to OSM vertices within 30 m; the 15 m/80% name
conflation test stays unchanged.

Out-and-back lengths are one-way and compare with half the seed's approximate
round-trip distance. Loops use the full distance. Traverse notes describe one-way
trips, so their distances stay full. Differences through 25% pass, 25–50% need
review, and over 50% fail. Preferred-name coverage below 60%, roads above 10%,
and repeated edges outside a loop's shared stem require review. Missing source
links and endpoints need geometry. Unexpected errors stop the run. `--indices`
accepts comma-separated seed indices for checks; full runs omit it.

Waypoints include named points within 30 m and campsites/glaciers within 35 m.
For an area, crossing or entering its footprint also counts. Fractions follow
the walked line. A name match within 300 m reuses a Peaks destination. The
objective's resolved reference also wins when its OSM area appears as a waypoint.

Composition splits all consumed parent segments at the union of endpoint/via
cuts. Every route then refers to the same shared pieces with whole segment IDs
and directions; partial edges cannot add unseen geometry in the loader. New
piece IDs start with `wa-span-`. Route IDs bind place references, shape, shared
pieces, and their geometry/source manifest. Session popularity alone does not
change route identity. `composition_hash` separately binds all report fields.

## Catalog loader

Default plans include `ok` and `review` rows, both as **pending** routes. Use
`--only-ok` to narrow them. Failed/unresolved rows and any `catalog_reviewed`
endpoint match skip the load. A reviewed match requires the existing catalog
supersede process. Live review guards repeat that check during apply.

Each route has one transaction. It inserts new destinations with WA/US,
`outdoor-trek`, external OSM IDs, and source credit in `metadata.provenance`.
Destination enum values absent from this schema (glacier, ridge, pass, saddle,
meadow, beach, other) use `landform`, retaining the precise feature in metadata.
`camp` uses `campsite`. The Polygon destination column gets the largest part of
a MultiPolygon; metadata keeps the full footprint. Existing destinations stay
unchanged.

Only referenced segments are inserted. Conflicts use `DO NOTHING`; reviewed
segments never receive ordinary updates. Route links retain order and direction.
Destination links put the trailhead first, one occurrence of each waypoint in
fraction order, then the objective last. This respects the destination-link
primary key even when a loop visits a place twice. The loader calls
`rebuild_route_path(route_id)` from the companion
`20261015_segment_model_v2.sql`. That migration is not in this worktree; apply
checks for its function before starting route transactions.

The database accepts only the canonical nine provenance keys (or eleven with
elevation). A route's `segment_sources` list therefore lives in the composition
artifact and, in the DB, in its ordered `route_segments → segments.provenance`
links. Route provenance holds the union of OSM way IDs and the required ODbL
credit. An agency-only route uses its first geometry source as the primary
record; every segment retains its own complete source record.

Default geometry has Z=0 and no sampled gain. `--elevation` wires
`sampleTerrariumProfile` exactly as `route-elevation-jobs.ts` does, sampling source
vertices, caching tiles under the composition output, writing segment Z/gain/loss,
then rebuilding the route. Runtime network access and `sharp` are required.
The guarded update skips protected segments; if any skip, route-level elevation
source metadata also stays unset. A normal dry run never samples tiles. A dry
run with `--elevation` only adds sampling placeholders and guarded SQL to the plan.

## Activation

`--activate` acts only on rows with an approval in `--reviews FILE`:

```json
[
  {
    "route_id": "ID_FROM_ROUTES_NDJSON",
    "composition_hash": "HASH_FROM_ROUTES_NDJSON",
    "status": "approved",
    "reviewed_by": "REVIEWER_NAME",
    "reviewed_at": "ISO_8601_TIME"
  }
]
```

No approval file is generated automatically. The loader rejects changed route
or segment manifests, and checks the stored route fields, ordered links,
source records, and ordered XY geometry before activation. An existing pending
import can use the same flag later without rewriting its graph links. An
already active import is a no-op. Existing database review/cover guards remain
in force; this loader does not disable them.

After activation, a matched non-reviewed legacy route becomes superseded and
its session rows move to the new ID in the same transaction. All session fields
survive; if the target session link already exists it wins. Geometry-dependent
coverage/intervals may need the separate matching sweep. Reviewed catalog routes
never use this path. All apply/activation SQL remains unexercised against a DB
under this task's no-database rule; transaction behavior has mock-client tests.
