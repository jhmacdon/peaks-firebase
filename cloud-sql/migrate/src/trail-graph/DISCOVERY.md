# State trail discovery

Build and compose from local files, without a hike seed or a database connection.
Run from `cloud-sql/migrate`:

```sh
npm run trail-graph:build -- --state WA
npm run trail-graph:discover -- --state WA
npm run trail-graph:typecheck
npm run trail-graph:test-discovery
```

Repeat with `OR`, `ID`, or `CA`. Both commands use a 6 GiB V8 heap limit. States
run in separate processes. `--input`, `--graph` (discovery), and `--out` override
paths. Discovery rejects unknown options and unsupported states before reading inputs.

## Inputs and bounds

WA reads `/Users/josiahm/projects/peaks/private/wa-trail-data`. Other states read
`/Users/josiahm/projects/peaks/private/west-trail-data/{oregon,idaho,california}`.
Each input root contains:

- `extract/trails.opl`
- `extract/features.geojsonseq`
- `extract/roads-parking.opl`
- `raw/agency/usfs_trails.geojson`
- `raw/agency/nps_trails.geojson`

`raw/agency/wa_state_parks_trails.geojson` is optional. The builder clips input
selection to the buffered state bounds in `state.ts`. It keeps whole intersecting
lines so it does not invent source nodes at rectangle edges. These bounds do not
replace a state boundary polygon. Frozen WA catalog segments remain WA-only.
The spatial index uses degree cells and latitude-aware query bounds; metre checks
still use haversine and local point-to-line distances.

Graph files go under `.cache/{wa,or,id,ca}/graph`; discovery writes under the
matching `compose` directory. The original WA seed composer remains available
through `trail-graph:compose`; it reads the WA graph by default.

## Candidate walks

The composer attaches starts and objectives to exact source vertices and cuts a
small routing graph at these contacts and junctions. It then streams candidates:

1. Each named OSM `route=hiking|foot` relation supplies one walk. A closed relation
   gives a loop; two contacted ends give a traverse; one contacted end gives an
   out-and-back. Disconnected or branched relations require review. Their shown
   geometry never implies that missing branches or gaps were resolved.
2. Each explicit trailhead or named parking area at trail contact supplies starts
   for named summits, lakes, waterfalls, viewpoints, lookouts, huts, passes, hot
   springs, arches, and meadows within 15 km one way. A bounded shortest-path search
   prefers named trails and retains shorter or cleaner alternatives. A path needs
   at least 70% named trail. The composer keeps one approach per start and objective.
   Search labels can use at most 4.5 km of unnamed path and 1.5 km of road: beyond
   either limit, no route within 15 km can pass the 30% unnamed or 10% road gate.
   Prefix ratios never prune a path that a later named section could bring within
   those limits.
   A cheapest-cost pass settles suitable approaches first. Remaining objectives
   use a separate search with reverse distance and cost bounds. It preserves
   longer named bypasses that repair the final percentage gates, and forbids
   repeated routing nodes. Prefix pruning also checks visited nodes so it cannot
   discard a valid simple continuation.
   Reverse resource bounds, available named distance, and articulation branches
   can prove a goal or edge unusable before path search. These checks protect all
   objective contacts. Small search regions use exact visited-node bit masks;
   larger regions retain ancestor checks. Every trailhead and objective is considered.
   An unresolved goal stops after 25,000 expanded states and keeps a shortest
   physical approach for review, within 15 km including any summit connector.
   A checked qualifying physical approach can still pass. Review walks do not
   suppress uncovered named-trail discovery.
   Area objectives can use any mapped shore contact, including disconnected shore
   trails; the best reachable contact supplies that start's single approach.
   Lake objectives exclude explicit fountain, swimming pool, wastewater, river,
   canal, stream, ditch, drain, and moat tags that the source classifier groups
   with lakes. Lakes, ponds, reservoirs, and sparse lake tags remain eligible.
3. Named trail components at least 2 km long supply an out-and-back from an end
   trailhead when relations and objective approaches have not covered that walk.
   If that end has no explicit trailhead, a public road or parking point within
   125 m can prove an inferred start, as in the seed composer. The source records
   the access identity and gap; a bare trail end never proves access. This fallback
   applies only to named-trail discovery, not objective searches.
4. Two named trails can supply a 3–30 km loop with a shared approach and return stem.
   Loop search builds a cycle basis for each pair of names meeting at a junction.
   A third trail cannot hide that pair's outer loop. It still does not enumerate
   all combinations of park circuits.

For hard objective searches, the CLI can use an already installed local Python 3
and SciPy `optimize.milp`. It installs nothing and makes no network requests. The
helper models a simple path with flow, node order, distance, and percentage gates.
A checked feasible path completes an approach; skipping an infeasible pair
requires a solver proof. Hard cases need not prove the globally lowest weighted
cost. A missing solver, error, or time limit without a usable path leaves the
TypeScript search active within that state budget. The CLI sets a ten-second
native solver limit and kills a subprocess after fifteen seconds. The composer
checks returned paths again. Input-bound proof receipts live under
`compose/solver`, keyed by the helper code and graph request, so unchanged runs
can reuse them. The CLI also reuses prior no-path limits only when the full
request and time budget match. These advisory results still run the bounded
TypeScript search; they never prove infeasibility or make a route loadable.
For a bounded offline pass, `--solver-call-limit 20` caps new native solves per
state. Cached paths and proofs remain eligible after the cap; all other goals
continue the same TypeScript search. Skipped native work supplies no cache entry
or infeasibility claim. The default leaves new native calls uncapped.

Out-and-back routes store the **outbound** path and `length_m`, matching the seed
composer and loader. `approx_roundtrip_mi`, report tables, and sample `length_km`
show the full hiking distance. Loops store the whole walk. A named trail without a
natural objective gets a landform at its exact mapped end, with `trail_end` source
and a clear source note. A traverse without a natural objective uses its far
trailhead. No seed, WTA page, AllTrails link, or copied description is used.

## Names, checks, and dedupe

Names use `names.ts`, `display-names.ts`, and `discovery-names.ts`: expand Mount,
Mountain, Peak, and Pacific Crest Trail; title-case agency capitals and words
after hyphens. Road names cannot supply preferred trails or viewpoint objectives.
Only a mapped official trailhead can retain a road-containing name. Parking codes,
truncated labels, bare numbers, inventory codes, and generic labels such as
`Trail 024` or `Foot Trail` cannot name a hike. A proper trail name loses its
`#number` in display and keeps that spelling as an alias. Parentheticals choose a
full trail name where available, otherwise keep the outer name. Seasonal notes
move to `flags`. Objective aliases remain available for overlap and search.
Source tags remain available for source checks. A `via` clause keeps the full
trail name, appending `Trail` when the source omits a generic word.

A walk must connect by source node and coordinate. Roads may make up at most 10%
of the walk; preferred trail names must cover at least 60% where present. Objective
approaches shorter than 100 m require review, since an adjacent parking area or
lake shore otherwise yields a few-metre hike. Summits need 5 m end contact; the
existing helper may add a credited, straight connector of at most 75 m. Other
point objectives need 30 m contact; area objectives can contact their footprint.
Only a loop's shared start/end stem may repeat edges. Expected length comes from
the discovered walk, so it supplies no independent distance check.

Dedupe compares physical shared length, not vertex counts. The same objective and
named trail with at least 60% of the shorter approach shared keeps one candidate,
even when starts differ. The same objective and start also dedupe at 80% shared
length. Status wins first, then a mapped trailhead, popularity, name and road
shares, and shorter distance. After dedupe, `from <start>` distinguishes only
remaining approaches to the same objective by the same trail. It never uses an
invented trailhead label, parking code, or truncated source name. No two retained
routes share a normalized name within 5 km.

A search-budget review means a qualifying named alternative remains unresolved;
it does not prove that none exists. This bound can reduce the number of ok routes.
Rows have `ok`, `review`, or `failed` status. Only `ok` discovery rows can pass the
loader planner, even with `--include-review`. This is a geometry and source check,
not a review of seasonal access, hazards, or route suitability.

## Output and scale

The three NDJSON files are `routes`, `segments`, and `places`. Routes retain the
existing `ComposedRoute` fields and hashes, with optional `state_code`,
`discovery_source`, `discovery_identity`, `popularity`, `popularity_score`,
`popularity_signals`, and `flags`. Places are the
unique new-place records embedded in those routes, with ID and state added.
Shared route cuts produce shared whole-segment IDs and exact path assembly.
Catalog segments omit AllTrails links from copied relation and agency tags before
manifest hashes are built. Trail segment display labels use the same name cleanup;
raw `trail_names` and relation names retain their source spellings for aliases
and checks. Road segments keep their road labels as physical route facts. The
local graph keeps its raw tags for source checks.
`report.md` contains counts by kind, source, shape, and status, 30 fixed-seed random
ok samples, and suspect candidates. `summary.json` includes ten samples, runtime,
peak RSS, and dedupe counts. Build stats record runtime and peak RSS too.
Discovery also reports the optional solver's returned peak RSS and the sum of the
parent and returned-child peaks, which may occur at different times. A hard-killed
child cannot return its final RSS; the report marks that missing measurement.

Large OPL, feature sequences, agency FeatureCollections, and output files stream.
The graph and its coordinates stay in memory; full route drafts and repeated
feature polygons spool to disk during dedupe. Dedupe retains compact walk
manifests. A later pass splits shared geometry at the union of selected route cuts.
The 6 GiB heap cap bounds each process; it does not promise constant memory as
input size grows.

`popularity` is a numeric 0–1 loading priority; `popularity_score` retains the
same value for compatibility. It uses hiking relation membership and network
(`iwn`, `nwn`, `rwn`, `lwn`), objective and trail Wikidata/Wikipedia tags, summit
prominence and elevation, mapped landmark and waterfall height tags, national
trail designations, NPS or explicit park/wilderness evidence, and trailhead
junctions, parking, capacity, and facilities. Correlated trail hierarchy signals
share a cap so a brief national-trail connection cannot outweigh a known
objective. Approaches over 25 km one way get a distance penalty. Source OPL files
stream to recover tags omitted from graph geometry; the composer installs
nothing. It records signal contributions on each route, writes rows in descending
popularity, and sets tiers 1/2/3 from ok-score terciles while preserving ties.
This ranks mapped evidence, not visits. Park and wilderness credit needs source
tags or NPS geometry; no boundary polygons are supplied for a full containment
check. The supplied extractor must include each objective type; absent meadow
records cannot be recovered by composition.

WA also writes `seed-overlap.json`. An overlap needs route, alias, or objective
name agreement plus a compatible named start or a mapped seed trailhead within
150 m. The report also counts name-only matches. This measures approach coverage,
not full geometry equivalence to the 409 seed hikes.

The existing loader can read the route and segment schema and build state-correct
pending SQL plans offline. Its production apply and activation path still uses
WA-specific guards and functions; non-WA apply or activation is blocked before a
connection. No production load is part of this task.

## Credits

OSM-derived geometry carries `© OpenStreetMap contributors` and Open Data Commons
Open Database License (ODbL) 1.0 credit. USFS and NPS lines carry public-domain agency
credit. WA State Parks keeps its own source credit. Each OSM place cites its own
node, way, or relation, independent of the route's geometry source. Source file
mtimes supply local retrieval-time evidence, as in the existing builder.
