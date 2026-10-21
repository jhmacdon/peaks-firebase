# Discovery quality verification — 2026-10-21

Implemented all six requested rules in `feat/discovery-quality`. All work stayed
in this worktree. No push, PR, database connection, or `--apply` run took place.

Built VT and NM from scratch copies of the supplied PBF and agency files under
`.cache/input`. Agency files arrived within the 30-minute wait. Both discovery
runs used `--solver-call-limit 20`; repeat checks reused the local solver receipts.
Ran `select-final` for both states. The saved comparison inputs in the
`us-catalog-states` worktree remained read-only.

| State | Saved discovery ok | New discovery ok | Saved final routes | New final routes |
| --- | ---: | ---: | ---: | ---: |
| VT | 679 | 542 | 436 | 337 |
| NM | 1,506 | 940 | 619 | 363 |

The old final-route counts come from the exact `compose-final/routes.ndjson`
paths in the request. The old discovery counts come from the adjacent
`compose/summary.json` files. These totals compare complete runs. Changes to
public-road contacts, foot overrides, trail names, routing, and dedupe also affect
which candidates survive, so total differences do not equal the demotion counts.

| Rule | VT demotions | NM demotions |
| --- | ---: | ---: |
| 1. Generated start names | 0 — names and source notes changed | 0 — names and source notes changed |
| 2. Note-like objective | 0 | 11 |
| 2. Only Emergency via candidates | 0 | 2 |
| 3. Alternative at most half as long | 95 | 229 |
| 4. Start lacks road/parking within 250 m | 0 | 31 |
| 4. Far trailhead lacks road/parking within 250 m | 0 | 0 |
| 5. Private/no pedestrian segment | 0 | 0 |
| 6. Name cleanup | 0 — names and aliases changed | 0 — names and aliases changed |

Counts cover each new rule that failed an otherwise ok retained route. A route
can count under more than one rule. Before dedupe, NM had 63 note-name failures,
78 start-access failures, and 2 Emergency-only failures among otherwise ok
candidates; VT had none. The long-alternative check runs only after dedupe and
uses only surviving ok alternatives with the same Peaks destination ID or new
OSM objective ID. Its reason is exactly:
`a route under half this length reaches the same objective`.

The builder already dropped restricted pedestrian ways. It now honors explicit
`foot=yes|designated|permissive` overrides, carries access tags through topology,
and keeps access changes as segment boundaries. Composition checks retained
tags and can recover restrictions from OPL for older graphs. Neither rebuilt
state needed a private-segment demotion.

The road index now retains contacts through 250 m and accepts drivable public
roads, excluding pedestrian-only ways and roads closed to cars. Both mapped and
generated starts and traverse ends receive the same composition check. Existing
connectivity, road share, preferred-name share, endpoint contact, distance,
repeated-edge, and unique-name checks remain active. The existing unique-name
check suppressed 26 VT and 171 NM collisions in the new runs.

Across matches to saved final routes, 18 VT route titles and 80 VT start names
changed; 46 NM route titles and 60 NM start names changed. These counts match
`discovery_identity`, not route hashes. The route-title examples below also
include changes in the selected via trail after rebuilding.

| State | Before | After | New status |
| --- | --- | --- | --- |
| VT | Chipman Hill viewpoint via North Country National Scenic Trail | Chipman Hill Viewpoint via North Country National Scenic Trail | ok |
| VT | Crest: Bolton-Nebraska notch trail via Long Trail from Stevensville Trailhead | Crest: Bolton-Nebraska Notch Trail via Long Trail from Stevensville Trailhead | ok |
| VT | Zion Hill via Alyssa trail | Zion Hill via Alyssa Trail | ok |
| VT | red loop | Red Loop | review |
| VT | Moose mountain overlook via Moose Mountain Trail from Moose Mountain Trail | Moose Mountain Overlook via Moose Mountain Trail from Moose Mountain Trail | ok |
| VT | Mount Ascutney observation tower via Weathersfield Trail | Mount Ascutney Observation Tower via Weathersfield Trail | ok |
| VT | Little Cascade Falls via Weathersfield Trail from Weathersfield trailhead parking | Little Cascade Falls via Weathersfield Trail from Weathersfield Trailhead Parking | ok |
| NM | Central Pond via Paseo del Bosque Trail | Central Pond via Paseo Del Bosque Trail | ok |
| NM | El Calderon viewpoint via Continental Divide National Scenic Trail | El Calderon Viewpoint via Continental Divide National Scenic Trail | review |
| NM | El Calderon cinder cone via El Calderon Loop | El Calderon Cinder Cone via El Calderon Loop | ok |
| NM | lava caves via El Calderon Loop | Lava Caves via El Calderon Loop | ok |
| NM | Gila / Lightfeather Hot Springs via Cdt ja- New Mexico Alternates Trail | Gila / Lightfeather Hot Springs via Continental Divide Trail Alternate Routes | review |
| NM | Crater Lake via Emergency Use Trail | Crater Lake via Stone Wall Pass - Toothache Spring Trail | ok |
| NM | Webster Resevoir via Emergency Use Trail from Webster Trailhead | Webster Resevoir from Webster Trailhead | review |
| NM | no access to trail via De Na Zin Wilderness Trail | No Access to Trail via De Na Zin Wilderness Trail | review |

The requested NM checks pass:

- `Dangerous Cliffs & 6' of Winter Snow. via Domingo Baca/Twa Trail` is `review`.
  It fails both the objective-note and start-access checks.
- `East Pecos Baldy via Jacks Creek Trail` remains `ok`. Its old start was
  `East Pecos Baldy via Jacks Creek Trail Trailhead`; its new start is
  `Pecos River Trailhead`, from the first named trail at that start. It has
  `source.name_is_fallback=true`, a source note, and a generated-name route flag.
  It cannot supply a `from` suffix.

For example, the VT start `Jay Peak via Long Trail Trailhead` became
`Long Trailhead`; the NM start `Penitente Peak via Ravens Ridge Trail Trailhead`
became `Winsor Trailhead`. Nearby named parking or trailheads take precedence
within 125 m. Generated names do not claim official status.

All required checks passed:

- `npm run trail-graph:typecheck`
- `npx tsc --noEmit -p .`
- `npm run trail-graph:test-discovery` — 187 tests
- Graph, composer, and final-selection unit tests — 57 tests
- `git diff --check`

A separate audit checked all 757 retained VT and 1,737 retained NM rows for valid
composition hashes. It checked every ok row for a unique normalized name,
public-road/parking access at both relevant ends, a usable via name, an objective
that passes the note rule, no restricted pedestrian segments, and no remaining
half-length alternative. It also checked generated start notes/flags and the
absence of generated `from` suffixes. The audit passed.

Files changed:

- Discovery and checks: `compose-discover.ts`, `discovery.ts`,
  `discovery-catalog.ts`, `discovery-access.ts`, `discovery-eligibility.ts`.
- Names: `discovery-names.ts`, `display-names.ts`.
- Source access and topology: `pedestrian-access.ts`, `opl.ts`, `topology.ts`,
  `road-access.ts`, `types.ts`, `catalog-types.ts`.
- Tests: `trail-discovery-quality.test.ts`, `trail-discovery.test.ts`,
  `trail-discovery-destinations.test.ts`, `trail-discovery-output.test.ts`,
  `trail-discovery-ranking.test.ts`, `trail-graph-state.test.ts`.
- Docs: `README.md`, `DISCOVERY.md`, `COMPOSER.md`, and this report.

Code and docs listed above live under `cloud-sql/migrate/src/trail-graph`;
tests live under `cloud-sql/migrate/src/__tests__`.

Local evidence remains in `.cache/{vt,nm}/{graph,compose,compose-final}`,
`.cache/quality-comparison.json`, `.cache/quality-audit.log`, and the test/build
logs under `.cache`. The four large scratch OPL files were removed after checks.
The source input folders remain unchanged.

No other states were rebuilt; the requested real-data scope was VT and NM.
No push, PR, database work, or production changes were attempted, as requested.

Git could not create the shared worktree `index.lock` because the sandbox denies
writes to the Git directory outside this worktree. Staging failed, so all changes
remain uncommitted, as permitted by the request. No permission change or retry
outside the sandbox was attempted.
