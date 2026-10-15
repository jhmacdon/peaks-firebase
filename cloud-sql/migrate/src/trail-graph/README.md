# Washington trail graph

The next step is the [catalog composer and loader](COMPOSER.md). The original
[run report](RUN-REPORT.md) records the first task, before the relation-polygon
re-extract; current build and composition results live in `.cache/`.

Build and route from local OSM and agency files. The builder and router use Node
built-ins and `tsx`. They make no network requests and do not import a database
client. The loader imports `pg` only after an explicit `--apply`.

Run from `cloud-sql/migrate`:

```sh
npm run trail-graph:build
npm run trail-graph:route -- --from 'Skyline Trailhead' --to 'Camp Muir' \
  --prefer 'Skyline Trail' --prefer 'Camp Muir Route'
TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/check-routes.ts
TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/load-segments.ts
TSX_DISABLE_CACHE=1 node --test --import tsx src/__tests__/trail-graph.test.ts
```

`--input DIR` changes the build input root. It must contain `extract/trails.opl`,
`extract/features.geojsonseq`, `extract/roads-parking.opl`, and `raw/agency/{usfs,nps,wa_state_parks}_trails.geojson`.
The default is `/Users/josiahm/projects/peaks/private/wa-trail-data`.

Every command accepts `--out DIR`; the default is the worktree's `.cache/graph`.
The build writes `segments.ndjson`, `nodes.ndjson`, `features.ndjson`, and
`access.ndjson` and `stats.json` there. The route checks write `route-checks.json` there. Build files
are staged before replacement, with `stats.json` replaced last. Do not read the
output directory while a build runs.

The trail OPL reader streams relations, kept ways, short connector candidates,
then needed node coordinates. The road/parking reader makes two passes. It never loads the OPL text into memory. Agency JSON is small
enough to read one source at a time. The metre tests use haversine lengths and
local equirectangular point-to-line distances. A fixed Washington grid supplies
candidates; it does not decide whether a distance meets a threshold.

## Graph and sources

OSM nodes define connectivity. Crossings that lack a shared OSM node stay separate.
The builder splits at shared nodes, repeated nodes, way ends, and kind changes.
It joins degree-2 chains only when names, ref, relation membership, kind,
`sac_scale`, and `trail_visibility` agree. Closed cycles survive. Pruning happens
before agency additions: a component needs a name or hiking relation and 500 m.
Raw footway/track connectors up to 400 m that touch kept ways join before pruning.
Named, foot-permitted cycleways also survive. Short source road stretches join
trail contacts after conflation; both road and trail split at each contact.
See [composition rules](COMPOSER.md) for the road index and inferred starts.

Segments retain `node_ids` and `osm_edge_way_ids` alongside `coords`. Each OSM
coordinate pair has an exact source way ID, including after agency joins split a
segment. Relations retain IDs, names, refs, and networks. `nodes.ndjson` lists
segment endpoints, including degree-2 nodes where trail details change. Internal
source vertices stay on their segment, so they need not become tiny stored edges.

The usual ID is `wa-osm-` plus 20 hex characters from SHA-256 of the canonical
start node, end node, and sorted way IDs. Parallel arcs of a closed source way can
share that tuple. For those collisions only, append ten hex characters from the
node/coordinate chain's hash. `stable_id_collisions` reports them. This exception
keeps both arcs and avoids IDs that depend on build order or agency names.

Agency matching samples length at intervals of at most 10 m. A match needs 80%
within 15 m of the same official identity (source, name, number), including its
multipart records. Each record that contributes remains in `alt_sources`. USFS
uses `trail_no`; NPS uses `TRLNAME`/`TRLALTNAME`; State Parks uses
`TR_NM`/`TR_ALT_NM`/`TR_NUM`. Agency names supplement OSM names.

Unmatched agency runs need 1 km of unmatched length. One sample of overlap at
each transition permits a join back to OSM. Only ends within 30 m of an existing
OSM source vertex snap; an internal vertex becomes a segment boundary. Other
agency ends share a node only when their coordinates match exactly. Agency-only
lines are not joined at arbitrary crossings or projected onto edge interiors.

USFS winter-only lines, explicit agency closures, and restricted pedestrian lines
are excluded. Unknown motor access does not by itself make an OSM track a road.
Glacier polygons override SAC kinds; a glacier named with `Snowfield` gives that
kind. Unnamed glacier polygons still count. Agency-only runs use their midpoint
for glacier classification.

Provenance has the nine keys required by `is_valid_route_provenance`, including
the exact OSM ODbL license and `© OpenStreetMap contributors` credit. USFS and NPS
use public-domain credit. State Parks retains its own credit and source link;
the local input supplies no separate license text. Agency endpoint snapping can
move an end by at most 30 m. The graph as a whole derives from OSM and carries
the ODbL obligations accepted in the Washington design note. Source file mtimes
supply `retrieved_at`; the local inputs have no upstream retrieval manifest.

## Features and routing

Only named features enter `features.ndjson`. The builder merges duplicate closed
way/area records. Point coordinates stay as supplied. For a line or area with a
graph vertex within 50 m of its boundary, the output records that vertex in
`graph_coord`, with `location_method=boundary_nearest_graph` and the boundary
gap. The area centroid and its full boundary stay available. Endpoint snapping
uses the boundary, so lakes can end at the shore. Elevations in feet convert to metres.

```ts
const router = new TrailRouter(segments, features);
const result = router.route(from, to, {
  preferNames: ['Skyline Trail', 'Camp Muir Route'],
  via: [panoramaPoint],
  avoidKinds: ['road'],
});
```

Endpoints can be `[lon, lat]`, `{lon, lat}`, an exact feature name, or an
`osm_id` from `features.ndjson`. Duplicate names require an ID. Partial names
produce suggestions and an error; they never select a different named place.
CLI endpoints also accept `lon,lat`. Repeat `--via`, `--prefer`, and `--avoid`.

Each endpoint snaps to a source vertex within 150 m. The router splits an edge
in memory at an internal snap, then runs Dijkstra through each via in order.
Preferred names get multiplier 1; other edges get 1.6; roads get a further 2.5.
Name matching ignores case and punctuation and accepts a full preferred phrase
within an official name such as a name followed by its trail number.

The result contains ordered segment IDs and directions, total physical length,
snap gaps, and named features within 30 m of the walked line. Each step also has
`start_vertex` and `end_vertex`; consumers **must honor these intervals** for
partial segments. Adjacent forward travel through a via on one segment merges
into one step. A via list does not forbid retracing. A loop may need an extra
source vertex to choose its return side.

## Loader

The default dry-run reads and validates geometry, prints counts, and opens no DB
connection. It cannot count reviewed rows without a database. `--apply` requires
`DATABASE_URL` and the companion `20261015_segment_model_v2.sql` migration. It
upserts by ID, sets `state_code='WA'`, and writes geography LineStringZ with Z=0.
It clears the stored polyline and gain/loss values on update; the elevation job
must fill height later. Extra source and topology fields remain in the NDJSON.

The upsert skips the exact states protected by
`guard_trail_catalog_reviewed_links`: approved, publish_leased, published,
verify_leased, verified, and rejected. The existing trigger also catches a
concurrent review; the loader rolls back that row to a savepoint and reports it.
No database run is part of the local verification.

See [the run report](RUN-REPORT.md) for actual counts, commands, route results,
and source gaps.

See [stretch names and curation](STRETCHES.md) for shared display names, waypoint
splits, route notes, review exports, and source checks for final xc approaches.
The latest local results live in `.cache/compose/stretches-report.md` at the
worktree root; `RUN-REPORT.md` records the earlier build.
