# Access-road processing store

Phase 2 of the trailhead work derives three facts for each trailhead — what
vehicle the drive needs, how rough the surface is, and when the gate is open.
This document covers both halves: loading the federal road data, cleaning it
and building the graph (`roads:import`), then walking that graph once per
trailhead to derive the facts (`roads:derive`, from "Deriving the per-trailhead
facts" onward). Importing the derived rows into `peaks` is a separate task.

The binding source is `docs/trailheads/research-roads.md`, Part A and Part D
Tier 1, in the `peaks` checkout. Read §A3 before touching any mapping code.

## Road data never goes in the `peaks` database

Only the derived per-trailhead facts will, later. The segments themselves live
in a local DuckDB file, by default at
`<data-dir>/processing/roads.duckdb` — beside the raw downloads in the `peaks`
checkout, never inside this repo. It runs about 4.5 GB.

The alternative was a scratch `peaks_roads` database on the shared Cloud SQL
instance. Both were tried before the choice:

| | Cloud SQL scratch database | Local DuckDB |
|---|---|---|
| PostGIS / pgRouting | 3.6.0 installed, pgRouting 3.6.2 available | no pgRouting; spatial extension only |
| Instance | `db-f1-micro`, shared core, 0.6 GB RAM, **serving production** | the developer's machine |
| Disk | 10 GB with auto-resize; production is already 3.1 GB, and Cloud SQL disks never shrink | a file you can delete |
| Cost | permanent, on the box the whole product runs on | none |
| Full load | not measured; a 25-million-vertex noding pass on a shared micro instance is not sensible | 30 seconds |

pgRouting being available was the one real argument for Cloud SQL, and it did
not survive the rest of the table: the graph work here is a breadth-first walk
over a few hundred thousand edges, which is a page of TypeScript, against
permanently growing the disk of the instance that serves every API request.
The repo's cost rules (root `CLAUDE.md`, "Infrastructure cost discipline") say
the same thing.

Local PostGIS was not an option on this host — Homebrew has `libpq` only, with
no server, and there is no Docker.

## Reading the sources

There is no `ogr2ogr` or GDAL on the host, and none is needed: DuckDB's spatial
extension carries GDAL, including the `OpenFileGDB` driver. `ST_Read` opens
both geodatabases straight out of their zip files through `/vsizip`, so nothing
is unpacked and a re-run needs no cleanup.

Two things to know about that path:

- **True curves.** 18 RoadCore rows (14 of them in the open layer) and 11 MVUM
  rows are stored as ArcGIS `MULTICURVE`, which the extension cannot parse.
  Every row is read as WKB and classified by its type bytes, so those rows load
  with their attributes and a `geom_kind` of `unsupported_curve` instead of
  failing the whole scan. The run prints what each source lost, one line per
  reason, under `dropped before the graph`.
- **The spheroid functions are broken in this build.** `ST_Length_Spheroid`
  and `ST_Distance_Spheroid` return `NaN` for every input, including literals.
  Lengths therefore come from the agency's own `GIS_MILES`, and distances from
  `metresBetween` in `roads/topology.ts` — which is the right answer anyway,
  since `GIS_MILES` is the figure a user should see quoted.

## Loading and normalizing

```bash
cd cloud-sql/migrate
npm run roads:import -- --data-dir=/path/to/peaks/docs/trailheads/data
```

Flags: `--store=` for a different file, `--map=` for a BLM class map other than
the repository's own, `--snap-tolerance=` in metres (default
10), `--memory-limit=` (default 6GB), and `--only=` with a comma-separated list
of stages — `roadcore, mvum, blm, normalize, seasons, link, topology`. A run
with every stage deletes the store first and rebuilds it, because DuckDB never
returns space after a `DROP` and the staging tables are large. A run with
`--only=` keeps the file and rebuilds just those tables.

Row counts are printed against `EXPECTED_ROW_COUNTS` in
`import-road-network.ts`, which is pinned in code rather than read from
`raw-datasets-manifest.jsonl`, so a short load is obvious:

```
usfs_roadcore rows: 368,055 (matches 368,055)
usfs_mvum rows: 150,722 (matches 150,722)
blm_gtlf rows: 111,149 (matches 111,149)
roadcore open to public: 174,058 (+7 vs expected 174,051)
```

Those constants are a snapshot of one download, not a contract: the manifest's
own `row_count` for RoadCore already reads 367,971 against the pinned 368,055.
**Drift on a refresh is expected**, and the number to re-pin once the drift is
understood is the one the run prints.

Rather than walk 630,000 rows in JavaScript, each **distinct** raw value is
mapped once by the pure functions in `roads/road-enums.ts`,
`roads/mvum-seasons.ts` and `roads/blm-classes.ts`, written to a small lookup
table, and joined in SQL. The unit-tested functions stay the only authority on
what a value means, and the run stays fast.

### The open/closed split

The EDW publishes RoadCore as two layers — open, and closed to motorized use —
but the bulk geodatabase is one undivided feature class of 368,055 rows.
Probing the live service pinned the filter, and `isPublicMotorized` implements
it: `OPENFORUSETO` is `ALL` or `PUBLIC`, and the maintenance level is present
and is not level 1. Level 0 (15 rows) and `NA` (13 rows) are both inside the
published open layer, and both counts match the geodatabase exactly.

That yields 174,058 against the 174,051 measured live three days after the
snapshot was cut. RoadCore is rebuilt nightly, so a drift of seven rows is the
data moving, not the filter being wrong.

### The semantic rules, and where they live

Both §A3 rules are enforced in one place each, and both are pinned by tests:

- **Vehicle needed never comes from an MVUM permission flag.** It comes from
  `OPER_MAINT_LEVEL` (`vehicleRequirementFromMaintenanceLevel`) or the BLM
  observed class (`vehicleRequirementFromBlmClass`). The MVUM
  `passengervehicle` columns are loaded into `raw_mvum` and go no further.
  Levels 3, 4 and 5 are all passenger car — the difference between them is
  comfort, not capability — and level 2 is the high-clearance line.
- **`yearlong` and `01/01-12/31` mean no seasonal data.** A window is stored
  only where the cleaned `seasonal` flag is `seasonal` **and** the dates say
  something narrower than the whole year. `seasonWindowsForClass` returns
  `null`, never an empty list, so a caller cannot read "no window recorded" as
  "closed all year".

The MVUM date columns are dirtier than the research suggests. All of these are
real and all parse: `04/01-11/30`, `06/01 - 9/30`, `7/01-10/11`,
`01/01-10/11    10/22-12/31` (spaces), `04/01-09/27,10/14-11/30` (commas),
`05/16-03/14` (runs through New Year), `09/01-02/29` (a leap day, with no year
to check it against), and the filler values `' '` and `open`. The `seasonal`
column itself carries `Seasonal`, `seasonal `, a bare space, and one row
holding a date range where the word belongs — anything that is not one of the
two words is treated as no data.

Of 150,722 MVUM segments, 36,810 are flagged seasonal and 36,559 carry at least
one real window across the seventeen vehicle classes. For passenger vehicles
alone that is 31,741 segments, against the 31,254 the research measured live.

### BLM classes

`OBSRVE_ROUTE_USE_CLASS` is applied from the reviewed map at
`migrate/data/blm-route-use-class-map.jsonl`, which covers all 26 spellings in
the extract. This code does not rebuild that map. The canonical copy is in this
repository rather than in the data directory, because it is a reviewed
judgement rather than downloaded data — the sources it describes change, the
review does not, and an artifact with no history behind it cannot be reviewed
at all. `--map=FILE` reads another copy deliberately; any copy in a data
directory is derived, and a change belongs back here. A test asserts the repo
copy parses, holds all 26 rows, and carries a `drivable` verdict on every one.

A spelling the map has not
seen is matched again with case and slash spacing ignored, and if it still does
not resolve it is **reported in the run summary as unmapped**, not folded into
`unknown` — a value that appears in a later refresh should be reviewed and
added to the map.

**The field is far thinner than the headline coverage suggests.** The research
reports it as 87.3% populated, and that is true — 97,085 of 111,149 rows have
something in the column. But 48,784 of those populated rows say literally
"Unknown", so counting the blanks too, **62,848 rows have no usable class and
only 48,301 (43.5%) carry one you can act on**. That is the number to plan
against, and it is why 55% of BLM edges have no `vehicleRank` and why the
unknown rule in the traversal contract matters.

### Which BLM routes are drivable

The layer is called "public display" and every row is planned motorized, but
that does not make every row a road. 334 are excluded from the graph:

- **306 by reviewed class** — the map's `drivable` flag. Six spellings are
  false: Non-Motorized, Non-Mechanized, Motorized Single Track (a motorcycle
  trail, both spellings) and Over Snow Vehicle. The canonical class folds all
  of these into `unknown`, which is the right answer for "what vehicle" and the
  wrong one for "is this a road": left in, a walk crosses a motorcycle track
  and reports nothing worse than the gravel before it.
- **28 by allowed mode** — `PLAN_ALLOW_MODE_TRNSPRT` of `MTC_ONLY` or
  `MTC_ATV_UTV_ONLY`, the two codes that admit only vehicles narrower than a
  car. This half stays in code rather than the map because it reads a different
  field; the allowed-mode check runs first, so a route excluded on both counts
  is reported here. The `*_SHARED` codes are not exclusive and stay in, and
  `TECH_HI_CLEAR_VEH_ONLY` is a vehicle — a demanding one, which its rank says.

**The class half lives in the reviewed map, not in code.** `drivable` sits
beside `canonical_class` on each of the 26 rows, so a spelling that arrives in
a later refresh cannot decide for itself whether it is a road. A class the map
does not cover, or covers without a flag, is **kept out and reported** — the
same warning an unmapped class gets, because it is the same hazard. Failing
that way costs a missing road, which surfaces as "no approach found"; failing
the other way invents a drive to a trailhead nothing can reach.

The other two planning fields carry no signal and are not used:
`PLAN_MODE_TRNSPRT` is `Motorized` on all 111,149 rows, `PLAN_ASSET_CLASS` is
always Road or Primitive Road, and `OHV_ROUTE_DSGNTN_LIM` says only that a
limit exists, never that a car is barred.

ATV and UTV routes are flagged drivable on purpose. They are motorized,
`vehicleRank` already says "ATV only", and dropping them would break
connections rather than improve an answer.

## Tables

| Table | Rows | What it is |
|---|---|---|
| `raw_roadcore` | 368,055 | RoadCore as read, plus `geom` and `geom_kind` |
| `raw_mvum` | 150,722 | MVUM as read, including the permission flags |
| `raw_blm` | 111,149 | BLM GTLF as read, geometry rebuilt from the ArcGIS paths |
| `road_segment` | 479,204 | RoadCore + BLM, normalized; `in_graph` marks the drivable, mapped ones |
| `mvum_segment` | 150,722 | MVUM normalized — an attribute overlay, not a graph source |
| `mvum_season_window` | 406,589 | one row per segment, vehicle class and window |
| `roadcore_mvum_link` | 147,658 | MVUM segment to the open RoadCore segments it describes |
| `road_node` | 441,370 | graph nodes |
| `road_edge` | 429,514 | graph edges, with the attributes a walk aggregates |
| `road_load_run` | 3 | one provenance row per source file |

MVUM is deliberately **not** in the graph. Its geometry repeats RoadCore's, so
including it would lay a second copy of every forest road over the first. It
attaches through `roadcore_mvum_link` instead, which pairs the two on `RTE_CN`
plus overlapping mileposts — `RTE_CN` names the route, not the segment, and
31,087 RoadCore route numbers repeat. 146,931 of 150,722 MVUM segments link;
the 3,791 that do not are mostly roads absent from the open RoadCore layer.

### Reading the link, and its quality

The link is many-to-many by construction, and two properties of it change what
a caller should do:

- **2,895 RoadCore segments link to more than one MVUM segment, and 1,537 of
  them end up carrying two or more different passenger-vehicle windows.** A
  RoadCore segment can span a stretch that MVUM splits at a gate. **Intersect
  every window the link returns** rather than picking one: the intersection is
  the conservative read, and picking the first or the longest would publish a
  road as open on a date one of its own halves says it is shut.
- **`overlap_miles` is the shared milepost length, and 6,330 links overlap less
  than 0.05 mi** (the median is 0.6 mi, the smallest 0.0001). Those are
  end-to-end touches between segments that merely abut, not real shared road.
  The column is there so a caller can weight or filter on it. Nothing is
  dropped here on that basis, because a short overlap is sometimes a genuinely
  short segment — the judgement belongs to the task that reads it.

## The graph

Snapping segment endpoints alone is not enough, and it fails quietly. A spur
joining the middle of a forest road shares no endpoint with it, so both sides
dangle. Measured on this data, the endpoint-only graph came apart into 165,323
components, the largest holding 0.4% of the nodes — useless for a walk that has
to reach a maintenance level 4 road. So the build has three steps:

1. Snap segment endpoints within the tolerance into junction positions.
2. Split any segment that passes within the tolerance of one of those
   positions, at the single vertex closest to it. Splitting at every vertex
   inside the tolerance instead cuts roads into stubs shorter than the
   tolerance, whose two ends then snap to the same node — that mistake
   produced 506,664 self-loops before it was fixed. A junction within the
   tolerance of the segment's own start or end is skipped, since endpoint
   snapping already handles those.
3. Snap the endpoints of the split edges. A spur that stopped a few metres
   short of the through road now merges with the node the split created.

Step 2 measures 25 million road vertices against 441,785 junction positions —
far too much to bring into JavaScript — so DuckDB buckets both on a plain
integer grid and measures the pairs with `metresBetweenSql`, which builds the
same formula `metresBetween` uses. `roads-topology.test.ts` runs both over the
same pairs and asserts they agree, so the split tolerance cannot drift from the
clustering tolerance.

Result at the 10 m default: 138,828 mid-segment splits, 429,514 edges over
441,370 nodes, 7,276 closed loops. Nodes of degree three went from 32,471 to
163,326 — real T-junctions now exist — and the share of nodes in components of
ten or more went from 17% to 71%.

**But connectedness is not the number that matters.** A component with no
maintenance level 4 or 5 edge in it has no anchor: a walk inside it runs to the
end of the component and returns nothing, however large and well-stitched that
component is. The figure the traversal task actually starts from is:

> **3,673 of 49,873 components hold a level 4/5 road, covering 142,753 of
> 441,370 nodes — 32%.**

The run prints it as `anchor reach` beside the noding stats. Two thirds of the
graph cannot answer the question at all today, and adding TIGER S1500 so that a
state highway also counts as an anchor is the change most likely to move it.

**What it still misses.** A crossroads where neither road ends and neither
carries a vertex at the crossing is not noded. Nor is a spur that ends within
the tolerance of another road's centreline but far from any of its vertices,
because the split only cuts at vertices that already exist. Raising the
tolerance is not the lever: at 20 m the trailheads that reach a level 4/5 road
rose only from 55% to 58% of those snapped, while closed loops doubled. The fix
worth trying first, if the traversal task needs better coverage, is projecting
each remaining dangling endpoint onto the nearby road and inserting a vertex
there.

## The traversal interface

`roads/graph.ts` is the interface between the load and the derivation. It gives
a way onto the graph and a way to step across it; the walk itself is in
`roads/approach.ts`, described in the next section.

```ts
import { openRoadStore } from "./roads/store";
import { snapTrailhead, loadGraph, otherNode } from "./roads/graph";

const store = await openRoadStore(storePath, { readOnly: true });
const { adjacency, byId, nodes } = await loadGraph(store);  // ~1.2 s, 430k edges

const candidates = await snapTrailhead(store, { lon, lat, radiusMetres: 250 });
```

- `snapTrailhead` returns the nearest edges, closest first, each with the
  metres from the trailhead to the edge and where along it that point falls.
  The database filter is a plane box the R-tree can answer, sized to always
  reach at least the requested radius on the ground; the exact distance is then
  measured properly and the over-wide candidates dropped. **A trailhead with no
  candidate has no approach — report it. Do not widen the radius until
  something matches**: the research found a naive 1.3 km box picked the wrong
  road twice in eight.
- `loadGraph` reads every edge once and returns the adjacency map plus an index
  by edge id. The whole graph fits in memory, so the walk needs no database
  round trip per step.
- Walk outward from the snapped edge's two nodes, using `otherNode` to step.
  Stop on an edge with `approachTerminus` — maintenance level 4 or 5, a road
  built for passenger comfort. State highways are not in these sources; adding
  TIGER S1500 would extend the stopping rule to them.
- Pass the path to **`summarizeApproach`**. It applies the worst-on-the-path
  rule and the unknown rule together, and returns the segment that set each
  answer: "the last 6.2 mi of FR 3512 is high-clearance gravel."
- Seasonal windows are not on the edge. Join the path's `segmentKey` values
  through `roadcore_mvum_link` to `mvum_season_window` and intersect the
  windows. **An edge with no window has no seasonal data — never render that as
  open all year.**

### Store the segment key, never the edge id

`summarizeApproach` returns `limitingSegmentKey` and `limitingEdgeId`. Only the
first belongs in a stored answer.

An edge id is an artefact of this build. 46% of them carry an `@piece` suffix
from the noding, and the piece numbers and node ids are both positional, so a
source refresh renumbers them and every stored reference silently points
somewhere else. `segmentKey` is `<source>:<GLOBALID or OBJECTID>` — the
agency's own identifier, carried through unchanged — and it is what makes a
Tier-1 answer auditable a year after it was derived. `summary.segmentKeys`
gives the whole path in the same terms.

### An unknown edge poisons the whole path

This is the §A3 failure mode in another costume, and the plain
maximum-over-the-path rule walks straight into it.

**55% of BLM edges (71,158 of 129,888) have no `vehicleRank`**, because BLM's
observed class is literally "Unknown" across nearly half its network, and 3,071
edges have no length because the source carried no `GIS_MILES`. Take a plain
maximum over a path holding one of those and you report the second-worst
*known* edge as though it were the answer — a confident claim about a road
nobody rated. Sum the lengths and a missing one counts as zero, making the
drive shorter than it is.

So the contract is: **a path containing even one unranked edge has an unknown
vehicle answer**, one containing an unranked surface has an unknown surface
answer, and one containing an unmeasured edge has an unknown length.
`summarizeApproach` enforces all three and returns `unrankedEdges`,
`unsurfacedEdges` and `unmeasuredEdges` so a caller can say *why* it does not
know. Render the unknown as unknown; do not fall back to the best-known edge.

Measured today the rule changes nothing: none of the 314 production trailheads
that reach a terminus has an unranked edge on its path, because those paths are
Forest Service roads and the unranked edges are almost all BLM. That is exactly
why it needs pinning now — the first desert peak added to the catalog is the
first wrong answer, and nothing in the measurement would have warned you.

Ranks are ordinals, so "worst on the path" is a maximum:

- `vehicleRank`: 1 passenger car, 2 high clearance, 3 four-wheel drive,
  4 four-wheel drive with high clearance, 5 ATV only, 6 not maintained.
- `surfaceRank`: 1 asphalt, 2 bituminous, 3 aggregate, 4 improved native,
  5 native. `other` has no rank and cannot be compared.

## Deriving the per-trailhead facts

```bash
cd cloud-sql/migrate
npm run roads:derive -- --data-dir=/path/to/peaks/docs/trailheads/data --sample=20
```

One JSONL row per trailhead, written by default to
`<data-dir>/trailhead-road-access.jsonl`. The database is read once, read-only,
for the trailheads themselves — id, name and coordinates. Nothing is written to
it; the import of these rows is a separate task.

Flags: `--out=` for a different file, `--store=` for a different processing
store, `--snap-radius=` (default 250 m), `--max-straight-line-km=` (40) and
`--max-path-miles=` (60) to bound the walk, `--prefer=` (below), `--season-year=`
for the year the gate dates are anchored to, `--sample=N --sample-seed=N` to
print narratives for a repeatable random sample, `--limit=N` for a quick run,
and `--trailheads=` to read the trailhead list from a file instead of the
database so a run can be repeated without it.

Each leaf carries its own source and is shaped exactly like
`TrailheadRoadAccess` in `lib/amenities.ts`, so the import that follows is a
copy rather than a translation:

```json
{"destination_id":"jXA6aSVbxBSw2YfdwI4Q","destination_name":"South Climb Trailhead",
 "snapped":true,"snap_distance_m":18,"anchor_reached":true,
 "high_clearance":{"value":"required","source":{"kind":"usfs_roadcore","name":"...","url":"..."},
   "retrieved_at":"2026-08-19"},
 "surface":{"value":"dirt","source":{...},"retrieved_at":"2026-08-19"},
 "seasonal_window":{"value":{"opens":"2026-04-02","closes":"2026-11-30"},...},
 "limiting_segment_ref":{"value":"FR 8040-550",...},
 "derivation":{"limiting_segment_key":"usfs_roadcore:{CCD3DB30-...}","path_miles":39.17, ...}}
```

The `derivation` block is the audit trail: the snapped and anchor segments, the
path's segment keys, the segment that set each answer, the unknown counts, how
many path segments carried a gate window, and which preference chose the path.
**`limiting_segment_key` is the agency's own id and is the thing to store;
`snap_edge_id` is this build's, and is for debugging only.**

**Everything in `derivation` is diagnostic, and `path_miles` most of all —
never publish it.** Wherever the way out of the forest is a state highway,
which these sources do not contain, the walk runs on to the next level 4/5
forest road and the figure is far longer than the drive: 39.17 miles for the
Mount Adams South Climb trailhead against about 13 real ones from pavement.
It says how far the walk went, not how far anybody drives. It becomes a
publishable number when TIGER S1500 gives the walk a highway to stop at.

**Three leaves and no leaves.** Where the worst edge on the path is ATV-only or
unmaintained the row publishes **nothing** — not the surface, not the gate
window, not the limiting road — and says `skip_reason: not_car_passable`.
"Dirt road, gate opens in April" is a true sentence about a route no highway
vehicle belongs on, and it reads as an invitation.

### The walk

Snap, then walk outward to the nearest anchor — an edge with
`approachTerminus`, meaning maintenance level 4 or 5. The search is a Dijkstra
over road miles rather than a breadth-first hop count, because the edges are
artefacts of the noding: four long segments are a shorter drive than twelve
short ones. It starts at both ends of the snapped edge, each charged its share
of that edge, so the first anchor it settles is the nearest one. A missing
length searches as the straight line between its nodes — an ordering, never a
reported distance.

The path carries **both** the whole snapped edge and the whole anchor edge:
both are roads that get driven, and both can carry a gate. `path_miles` is the
narrower thing — the drive from the trailhead to the near end of the anchor,
counting only the part of the snapped edge actually driven and none of the
anchor. A trailhead that snaps straight onto a level 4/5 road therefore has a
zero-mile approach, which is the truth about it. `derivation.path_edge_miles`
holds the full-edge sum for anyone comparing against an earlier measurement.

`--prefer=easiest` is the default: it takes the way out that demands least of a
vehicle and settles ties on distance, which is what a driver does — nobody
takes the rough short cut when a graded road leaves the same trailhead.
`--prefer=nearest` is §A4 read literally and remains a flag. Measured over the
catalog the two agree on 320 of 328 answers; on the other 8 `easiest` finds a
passenger-car way out where `nearest` reports high clearance, for **3.11 extra
miles across all 328 trailheads**, a longest single detour of 1.37 mi, and no
seasonal window changing at all. Those eight rows carry
`derivation.differs_from_nearest`, so the difference stays auditable row by
row, and the run prints how many there are.

**Watch item.** An unranked edge searches as rank 7 under `easiest`, one worse
than the worst real value, so the search routes *around* unranked ground. No
path touches BLM today, but once BLM-served trailheads enter the catalog
`easiest` can return a confident answer down a longer known road where
`nearest` would have crossed the unranked edge and honestly returned nothing.
That trade is right only while the detour is a road somebody would really
drive. Revisit it at the first desert-peak data — **together with
`season_restricted_without_dates`**, which trips on the same day: a path that
crosses BLM ground can publish an MVUM window off its Forest Service segments
while a BLM stretch of the same drive is closed on dates nobody has recorded,
and the row would read as a gate schedule for a road half of which has none.
Both are the same question — what a mixed path may claim — and neither can be
answered from today's data.

**A tie names the first road, not the last.** `summarizeApproach` replaces its
limiting segment only on a strictly worse rank, and the path runs from the
trailhead outward, so where several segments share the worst rank — 204 of the
328 answers today — the one named is the one nearest the trailhead. That is the
right end to name: it is the first rough road a driver meets and the last place
they can still turn round.

### Vehicle, surface and gate

| worst on the path | stored |
|---|---|
| `passenger_car` (levels 3, 4, 5) | `high_clearance: not_required`, `four_wheel_drive: false` |
| `high_clearance` (level 2, BLM high clearance) | `high_clearance: required`, no four-wheel-drive claim |
| `four_wheel_drive`, `four_wheel_drive_high_clearance` | `high_clearance: required`, `four_wheel_drive: true` |
| `atv_only`, `not_maintained` | no vehicle leaf at all; `skip_reason: not_car_passable` |

Levels 3, 4 and 5 store `not_required`, not `recommended`. §A3 is explicit that
the difference between those levels is comfort rather than capability, the
roughness is said by the surface leaf beside it ("Gravel", "Dirt"), and
softening every level 3 road to "high clearance recommended" would both tell a
hiker with a hatchback to stay home from a road the Forest Service maintains
for passenger cars and leave nothing to say about the level 2 road that
genuinely needs the clearance.

Surfaces are stored as words a driver uses — paved, chip seal, gravel, improved
dirt, dirt — because the client prints anything it does not recognise verbatim,
and `improved_native` on a detail sheet reads as a database column.

**Gate windows.** Two MVUM classes are read: `passenger_vehicle`, falling back
to `high_clearance_vehicle` where a segment has no passenger window. The two
agree on 31,641 of the 31,713 segments carrying both, and the fallback covers
1,270 segments where only the high-clearance class has dates — exactly the
rough approaches this pipeline exists to describe. Windows are then intersected
across every MVUM segment the link returns and across every segment on the
path, on a leap-shaped 366-day calendar so that February 29 survives.

- A segment with no window is **not** a constraint, and is not an open gate
  either — it is simply left out of the intersection, and
  `derivation.season_segments_with_window` records how thin the evidence is.
- **A segment MVUM never described is a different thing again, and no window
  is emitted at all for a path holding one.** A segment MVUM describes and
  leaves unflagged is evidence of no gate; a segment with no
  `roadcore_mvum_link` row at all is no evidence either way, so a window
  intersected without it is a claim about a road nobody checked.
  `buildApproachRow` withholds the leaf — beside the `not_car_passable`
  suppression, and for the same reason: a rule enforced only in the importer is
  a rule the next reader of these rows copies without.
  `derivation.season_segments_without_evidence` and `season_windows_found` stay
  in the audit block so a withheld window can still be traced, and the run
  prints the count — **1 withheld today, "Trailhead: Jordan Creek"**, whose
  path has two undescribed segments out of seven. The importer checks the same
  condition again and treats a window arriving with a gap as a loud validation
  failure, since it could only mean this gate regressed.
- An intersection that covers the whole year is reported as **no window**: a
  gate open every day is the §A3 filler value in another costume.
- Where the intersection leaves several windows the longest is stored and
  `derivation.season_windows_found` says how many there were. Storing the
  longest understates access, which is the safe direction.
- Dates are stored as `YYYY-MM-DD`. The source carries no year — the window
  recurs every season and the client prints only the month and day — but the
  client parses ISO first and treats `MM/DD` as a provider fallback, so a bare
  month-day is a downgrade there is no reason to ship. A window through New
  Year closes in the following year. **February 29 is never emitted**: it
  survives the 366-day intersection, but publishing it would put a gate date on
  the row that exists one year in four, and anchoring the window to the next
  leap year instead — which is what this used to do — put dates two years from
  the run on a row nobody reads literally. A leap day moves one day in the
  direction that cannot overstate access: an opening leap day opens March 1, a
  closing one closes February 28.

Filtering the MVUM link on `overlap_miles` was measured and makes no
difference: dropping every link under 0.05 mi changes **0** of the 328 windows,
so the contract's "intersect everything the link returns" stands unqualified.

### What this measures today

Against the 918 trailhead destinations in production, at a 250 m snap radius
and the default preference:

- 568 (62%) snap to a road.
- **328 (58% of those) reach a maintenance level 4 or 5 road** and produce a
  full vehicle, surface and distance answer — 36% of the catalog, and the
  honest ceiling today. 172 are passenger car, 156 high clearance; the surfaces
  are 137 gravel, 102 dirt, 48 paved, 21 improved dirt, 20 chip seal.
- 104 of those carry a gate window. A 105th intersects to a window but rests on
  a path segment MVUM never described, so it is withheld at emission.
- **None has an unranked or unmeasured edge on its path**, so the unknown rule
  changes no answer today. No reaching path touches BLM ground at all, which is
  why the rule is pinned by unit test rather than by data.
- 240 snap but their component holds no level 4/5 road.
- 350 have no road within 250 m at all — 56 of them are outside the United
  States, and the rest are National Park, state park or county trailheads.
  These sources cover Forest Service and BLM land only.

**The 240 are mostly not a stitching problem.** For 194 of them the nearest
level 4/5 road of any component is more than 3 km away in a straight line, and
for 115 it is more than 10 km. Projecting each dangling endpoint onto the
centreline it nearly touches — the second noding pass left undone by the load
task — was measured at four tolerances and would newly reach an anchor for 12
trailheads at 10 m, 17 at 20 m, 20 at 30 m and 21 at 50 m. That is not worth a
second full pass over 25 million vertices, and the tolerances that reach 20
would start welding parallel switchbacks together. **Not implemented**; TIGER
S1500 is the change that moves this number.

Trying snap candidates beyond the nearest, within the same 250 m, would add 12
more reaching trailheads. It is not done either: the research found a naive
wide box picked the wrong road twice in eight, and a trailhead 3 m from a spur
should be described by that spur.

Both coverage figures are floors, not ceilings, and both are worth re-measuring
after any change to the noding or the sources.

## Re-running

The load is fully repeatable: a full run deletes the store and rebuilds it from
the three source files in about 30 seconds, and the derivation over all 918
trailheads takes about eight. Neither writes to the `peaks` database. To
refresh the sources themselves, re-download per `raw-datasets-manifest.jsonl`,
re-run `roads:import` and then `roads:derive`; watch the printed row counts and
the unmapped-BLM-class warning for anything the agencies changed, and the
derivation's own funnel for coverage that moved.
