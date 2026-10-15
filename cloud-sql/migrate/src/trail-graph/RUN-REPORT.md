# Local Washington graph run — 2026-10-15

Implemented only in `/Users/josiahm/projects/peaks/.worktrees/wa-trail-graph`,
branch `feat/wa-trail-graph`. The initial `test -w .` passed. All source data stayed
read-only. No git write commands, network requests, database connections, or
`--apply` runs took place.

Files added: `types.ts`, `io.ts`, `geo.ts`, `opl.ts`, `topology.ts`, `agency.ts`,
`features.ts`, `build.ts`, `router.ts`, `route.ts`, `check-routes.ts`,
`load-segments.ts`, `README.md`, and this report in `src/trail-graph/`;
`src/__tests__/trail-graph.test.ts`; and the small fixtures
`src/__tests__/fixtures/trail-graph.opl` and `trail-graph-features.geojsonseq`.
`package.json` adds `trail-graph:build` and `trail-graph:route`. No dependencies
were added. Local ignored links use the cached tsx package and TypeScript/pg
packages already installed in the sibling admin-route-covers worktree.

Commands below ran from `cloud-sql/migrate`, except where noted:

| Command | Actual result |
| --- | --- |
| `node node_modules/typescript/lib/tsc.js --noEmit --strict --esModuleInterop --skipLibCheck --target es2020 --module commonjs src/trail-graph/*.ts src/__tests__/trail-graph.test.ts` | Passed, exit 0. |
| `TSX_DISABLE_CACHE=1 node --test --import tsx src/__tests__/trail-graph.test.ts` | 15 tests passed; 0 failures, skips, or DB connections. |
| `npm run trail-graph:build` | Passed on all local inputs. Final stats report 19.882 seconds before output serialization. |
| `npm run --silent trail-graph:route -- --from 'Skyline Trailhead' --to 'Camp Muir' --prefer 'Skyline Trail' --prefer 'Camp Muir Route'` | Passed; 6,589.424 m, 12 segments. |
| `TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/check-routes.ts` | Finished all 10 checks: 8 routed and 2 endpoint errors retained in the report. |
| `TSX_DISABLE_CACHE=1 node --import tsx src/trail-graph/load-segments.ts` | Dry-run validated 57,764 rows; 0 writes. Reviewed-row counts remain unknown without a DB. |
| `python3 .cache/graph/validate-output.py` (worktree root) | Passed: unique IDs, all 57,764 canonical provenance objects, exact per-edge way ID sets, node/feature links, node degrees, and all recomputed geodesic lengths. |
| `git diff --check` (worktree root) | Passed. |

The tsx CLI first failed because the sandbox blocks its IPC socket. The npm
scripts use `node --import tsx` and disable the compile cache. The first tests
also caught an agency transition trimmed beyond its 15 m join radius. One
sample of overlap fixes that join; overlap does not count toward the 1 km gate.
The first full build caught parallel-arc ID collisions. The final build includes
the deterministic suffix described below. Later runs and counts supersede those
failed attempts.

Final outputs are in `.cache/graph/`: the four build files, `route-checks.json`,
`skyline-muir.json`, and logs `build.log`, `tests.log`, `route-checks.log`,
`load-dry-run.json`, and `validation.log`. The small independent output checker
is saved there as `validate-output.py`. These files are git-ignored.

The final `stats.json` reports 57,764 segments, 54,631 endpoint nodes,
2,432,446 stored vertices, 9,063 named features, and 2,906
features within 50 m of a graph vertex. Total geometry is **46,098.089 km**.

| Kind | Segments | km |
| --- | ---: | ---: |
| trail | 56,187 | 44,221.691 |
| road | 856 | 1,143.282 |
| scramble | 365 | 392.252 |
| climb | 330 | 335.401 |
| glacier | 26 | 5.463 |
| snowfield | 0 | 0.000 |
| xc | 0 | 0.000 |

| Geometry source | Segments | km |
| --- | ---: | ---: |
| nps | 48 | 97.812 |
| openstreetmap | 56,695 | 42,775.732 |
| usfs | 862 | 2,365.132 |
| wa_state_parks | 159 | 859.413 |

OSM: 518,219 input ways; 68,371 kept after tag filters;
449,848 filtered; 0 missing-node ways; 1,254 hiking relations.
Component pruning dropped 18,720 components / 36,553 segments /
4,501.637 km and retained 4,874 OSM components. Of the dropped
components, 15,740 lacked a name/relation and 17,101 were short;
these reason counts overlap.

Agency inputs: USFS 3,366 features (597 winter-only features excluded); NPS 1,577;
State Parks 2,514 (13 closed/restricted features excluded). The build matched
agency names to 7,214 OSM segments, added 1,069 agency-only runs
covering 3,322.357 km, snapped 870 agency ends, and made 740
OSM cuts. End snapping can shorten a retained run slightly after its 1 km test.

Top five name totals (aliases overlap):

- Pacific Crest National Scenic Trail: 807.830 km.
- Pacific Crest Trail: 806.019 km.
- Palouse to Cascades State Park Trail: 390.744 km.
- Palouse to Cascades: 385.515 km.
- Columbia Plateau: 208.819 km.

Route checks use the exact feature IDs where names repeat. Features below list
only the named points within the fixed 30 m limit. Segment counts include
retraced approach/spur segments and honor partial source-vertex intervals.

| Check | km one way / loop | Segment traversals | Features passed / error |
| --- | ---: | ---: | --- |
| Skyline Trailhead → Camp Muir | 6.589 | 12 | Skyline Trailhead; Camp Muir |
| Camp Muir → Columbia Crest | 5.177 | 4 | Camp Muir; Cathedral Rocks; Disappointment Cleaver; Columbia Crest |
| Mount Si Trailhead → Haystack summit | 6.317 | 17 | Mount Si Trailhead; Mount Si / q̓əlbc̓ |
| Rattlesnake Lake → Rattlesnake Ledge | 3.184 | 5 | Rattlesnake Lake; Rattlesnake Ledge Trailhead; Rattlesnake Ledge |
| Lake Serene Trailhead → Lake Serene | — | — | Lake feature is near Lynnwood; no graph vertex within 150 m. |
| Stuart Lake Trailhead → Colchuck Lake | — | — | Colchuck Lake feature is missing; Little Colchuck Lake is a distinct place. |
| Maple Pass loop | 10.934 | 10 | Rainy Pass Trailhead; Heather Pass; Maple Pass |
| Skyline → Camp Muir via Panorama Point (viewpoint) | 7.465 | 16 | Skyline Trailhead; Panorama Point; Camp Muir |
| Lake Serene Trailhead → relation stop (supplemental) | 5.315 | 6 | Lake Serene Trailhead; Bridal Veil Falls-Lower East Cascade |
| Stuart Lake Trailhead → Colchuck trail end (supplemental) | 7.316 | 15 | Stuart Lake Trailhead |

Source gaps and decisions:

- The shortest Skyline/Muir walk follows Skyline, Pebble Creek Trail, and Camp
  Muir Route. It passes 157.0 m from the Panorama Point summit and 297.2 m from
  the viewpoint. The extra via check reaches the viewpoint and gives 7.465 km.
  Pebble Creek is a trail name here; the feature extract has no point with that
  name.
- The DC geometry is connected. Ingraham Flats lies 34.6 m from that line, so it
  stays outside the 30 m passed-feature list. No gap was bridged to force a hit.
- The input lacks the hiking lake features for Lake Serene and Colchuck Lake,
  and lacks a named Muir Snowfield area. No segment therefore received the
  snowfield kind. Local polygons, not inferred terrain, decide glacier kinds.
- The Lake Serene supplement uses stop node 4505639650 from hiking relation
  4807642. The Colchuck supplement uses node 46862432, the end of way 844433058
  in hiking relation 4152031. It includes travel along the lake. Neither check
  claims to replace a missing lake feature.
- Maple Pass starts at Rainy Pass Trailhead and visits Heather Pass, Maple Pass,
  then eastern-ridge source node 12564704208. Without that third via, Dijkstra
  may take the shorter west-side retrace. The 10.934 km loop includes the short
  trailhead approach twice and the 60 m Heather Pass spur out and back.
- 103 endpoint/way-ID tuples describe distinct parallel arcs. Their IDs keep
  the requested base hash and add a deterministic geometry suffix. No duplicate
  rows were removed. Source direction does not affect ordinary IDs.
- Internal source vertices remain on segments for snapping. Partial routes
  return vertex intervals as well as segment IDs/directions; a composer must
  use those intervals.
- Agency matching unions pieces of the same official source/name/number and
  samples by length at no more than 10 m. Unknown track motor access stays
  trail; explicit motor permission makes it road. Roads get cost multiplier
  2.5. Agency-only geometry receives glacier kind by its midpoint.
- OSM provenance uses the exact nine-key DB shape and required copyright text;
  USFS/NPS use public-domain credit. State Parks receives its own credit, with
  no claim of federal public-domain status. Source file mtimes stand in for an
  unavailable retrieval manifest. Licensing terms beyond the supplied design
  note and local metadata were not checked over the network.
- The loader needs the companion segment-model migration before apply. Its
  guarded SQL and trigger-error handling received local code/type checks only;
  database behavior was not exercised under this task's no-DB rule.
