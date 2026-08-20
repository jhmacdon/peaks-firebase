# Access-road processing store

Phase 2 of the trailhead work derives three facts for each trailhead — what
vehicle the drive needs, how rough the surface is, and when the gate is open.
This document covers the first half: loading the federal road data, cleaning
it, and building the graph. Deriving the per-trailhead facts is a separate
task, and the handover to it is the last section here.

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

- **True curves.** 18 RoadCore rows and 11 MVUM rows are stored as ArcGIS
  `MULTICURVE`, which the extension cannot parse. Every row is read as WKB and
  classified by its type bytes, so those rows load with their attributes and a
  `geom_kind` of `unsupported_curve` instead of failing the whole scan.
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

Flags: `--store=` for a different file, `--snap-tolerance=` in metres (default
10), `--memory-limit=` (default 6GB), and `--only=` with a comma-separated list
of stages — `roadcore, mvum, blm, normalize, seasons, link, topology`. A run
with every stage deletes the store first and rebuilds it, because DuckDB never
returns space after a `DROP` and the staging tables are large. A run with
`--only=` keeps the file and rebuilds just those tables.

Row counts are printed against the counts in `raw-datasets-manifest.jsonl` so a
short load is obvious:

```
usfs_roadcore rows: 368,055 (matches 368,055)
usfs_mvum rows: 150,722 (matches 150,722)
blm_gtlf rows: 111,149 (matches 111,149)
roadcore open to public: 174,058 (+7 vs expected 174,051)
```

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
`<data-dir>/blm-route-use-class-map.jsonl`, which covers all 26 spellings in
the extract. This code does not rebuild that map. A spelling the map has not
seen is matched again with case and slash spacing ignored, and if it still does
not resolve it is **reported in the run summary as unmapped**, not folded into
`unknown` — a value that appears in a later refresh should be reviewed and
added to the map.

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
| `road_node` | 441,692 | graph nodes |
| `road_edge` | 429,978 | graph edges, with the attributes a walk aggregates |
| `road_load_run` | 3 | one provenance row per source file |

MVUM is deliberately **not** in the graph. Its geometry repeats RoadCore's, so
including it would lay a second copy of every forest road over the first. It
attaches through `roadcore_mvum_link` instead, which pairs the two on `RTE_CN`
plus overlapping mileposts — `RTE_CN` names the route, not the segment, and
31,087 RoadCore route numbers repeat. 146,931 of 150,722 MVUM segments link;
the 3,791 that do not are mostly roads absent from the open RoadCore layer.

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

Result at the 10 m default: 138,951 mid-segment splits, 429,978 edges over
441,692 nodes, 7,299 closed loops. Nodes of degree three went from 32,471 to
163,326 — real T-junctions now exist — and the share of nodes in components of
ten or more went from 17% to 71%.

**What it still misses.** A crossroads where neither road ends and neither
carries a vertex at the crossing is not noded. Nor is a spur that ends within
the tolerance of another road's centreline but far from any of its vertices,
because the split only cuts at vertices that already exist. Raising the
tolerance is not the lever: at 20 m the trailheads that reach a level 4/5 road
rose only from 55% to 58% of those snapped, while closed loops doubled. The fix
worth trying first, if the traversal task needs better coverage, is projecting
each remaining dangling endpoint onto the nearby road and inserting a vertex
there.

## Handing over to the approach-path traversal

`roads/graph.ts` is the interface. It gives the next task a way onto the graph
and a way to step across it; the walk and its rules belong to that task.

```ts
import { openRoadStore } from "./roads/store";
import { snapTrailhead, loadGraph, otherNode } from "./roads/graph";

const store = await openRoadStore(storePath, { readOnly: true });
const { adjacency, byId } = await loadGraph(store);   // ~1.2 s, 430k edges

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
- Along the chosen path take the **maximum** `vehicleRank` and the **maximum**
  `surfaceRank`, and keep the edge that set each. That edge id is the
  explanation the user reads: "the last 6.2 mi of FR 3512 is high-clearance
  gravel."
- Seasonal windows are not on the edge. Join the path's `segmentKey` values
  through `roadcore_mvum_link` to `mvum_season_window` and intersect the
  windows. **An edge with no window has no seasonal data — never render that as
  open all year.**

Ranks are ordinals, so "worst on the path" is a maximum:

- `vehicleRank`: 1 passenger car, 2 high clearance, 3 four-wheel drive,
  4 four-wheel drive with high clearance, 5 ATV only, 6 not maintained.
- `surfaceRank`: 1 asphalt, 2 bituminous, 3 aggregate, 4 improved native,
  5 native. `other` has no rank and cannot be compared.

### What this measures today

Against the 918 trailhead destinations in production, at a 250 m snap radius:

- 568 (62%) snap to a road.
- Of those, 314 (55%) reach a maintenance level 4 or 5 road.
- 254 snap but their component holds no such road. Most of those components are
  small — median 5 edges, 81 of them only one or two — so this is mostly the
  remaining fragmentation described above, not a genuine absence.
- 350 have no road within 250 m at all. These sources cover Forest Service and
  BLM land only: a trailhead on a county road, a state highway or a National
  Park road has nothing here to snap to. TIGER S1500 is the documented next
  source for that gap.

Both figures are floors, not ceilings, and both are worth re-measuring after
any change to the noding.

## Re-running

The load is fully repeatable: a full run deletes the store and rebuilds it from
the three source files in about 30 seconds. Nothing about it touches the
`peaks` database. To refresh the sources themselves, re-download per
`raw-datasets-manifest.jsonl` and re-run; watch the printed row counts and the
unmapped-BLM-class warning for anything the agencies changed.
