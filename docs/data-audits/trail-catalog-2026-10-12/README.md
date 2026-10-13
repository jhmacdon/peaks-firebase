# Trail catalog: schema and search

This phase extends `routes` and `segments`; it creates no trails table. It adds
catalog metadata, stable slugs, SQL estimates, a checked metadata refresh, and
ranked search across destinations, trails, areas, and lists. Existing search
buckets remain available. Route-query failures now fail the request.

Cost: about $0/month added fixed cost. The change uses the current database and
sweep, adds indexes, and runs bounded local jobs. It adds no hosted worker,
timer, service, minimum instance, or CPU setting. Pull-request checks use a
disposable PostGIS service in GitHub Actions; deployment jobs run only on a push
to main.

## Production preflight

Read-only scalar counts on 2026-10-12 (Los Angeles):

| Status | Peaks-owned routes | Missing distance/gain/loss fields |
| --- | ---: | ---: |
| Active | 260 | 3 |
| Pending | 27 | 0 |
| Superseded | 14,972 | 14,966 |
| Total | 15,259 | 14,969 |

The database has 15,477 routes across all owners. These counts do not prove
valid geometry, provenance, segment assembly, covers, or complete metadata.
The [preflight report](preflight.json) and [rejection JSONL](preflight.rejected.jsonl)
account for every row. Of 287 current routes, 112 pass the scalar checks
(96 active and 16 pending); 175 need repair. Among those rejected current rows,
120 lack a shape and segments, 49 lack a state, 19 lack a first trailhead,
eight lack a country, five lack a summit objective, three have invalid
destination ordinals, and three lack elevation stats. Reasons overlap.
All 14,972 retired rows remain outside the approved backfill scope.

The [current-route repair plan](current-route-repair-plan.json) groups the 175
current failures: 38 need region evidence, 14 lack a first trailhead and source
provenance, 120 lack shape/segments and source provenance, and three long-distance
routes need a separate traverse review. Saved scalar evidence alone proves no
repair safe. Empty segment sets must not be treated as a simple ordinal fix.

The report includes observed catalog-name matches for every golden query. A name match is a
candidate for review, not proof of the intended trail. Production search ranks
remain unverified until deployment.

Josiah approved these decisions during this task:

- Backfill current active and pending routes; report superseded rows separately.
- Add kind-aware publication and segment-level source coverage checks while
  retaining summit contact, exact geometry/elevation assembly, source rights,
  independent review, and credited covers.

## Publish checks for the next phase

The current gate requires a linked summit and exact equality between each
segment's provenance and the route's full provenance object. The source
checker also requires every cited source feature to contribute to the route.
A common superset source list therefore cannot make divergent routes share a
segment honestly.

The pilot needs kind-specific objective or loop-closure checks and exact
per-segment source contribution. It must retain the existing summit checks for
summit routes, `is_valid_route_provenance`, the cover gate, credited elevation,
contiguous segment ordinals, connected XYZ endpoints, and equality between the
assembled segments and materialized route. Mixed OSM/USFS paths need explicit
credit for both sources; do not label USFS geometry as OSM.

Use the existing segment matcher and reuse guard. A second matcher would create
two definitions of shared trail. Do not change existing summit route names or
delete catalog rows. Phase 1 does not activate new routes.

## Validation

- API lint, typecheck, and build pass.
- API CI at `348981a`: 550 passed, 0 failed, 0 skipped, including PostGIS tests.
- Route-worker CI at `348981a`: passed, including web typecheck and lint.
- Read-only preflight: 12 unit tests pass; migrate TypeScript build passes.
- Cross-reference checks pass.
- Database tests cover formula thresholds, uphill/return estimates, invalid
  path inputs, grade smoothing, metadata refresh, stable slugs, and the four
  product-design search queries with real PostgreSQL fixtures.

The formula and response contract are documented in
[`cloud-sql/CLAUDE.md`](../../../cloud-sql/CLAUDE.md).

## Production rollout

The first rollback-only migration trial held table locks during index creation
and briefly blocked reads. We canceled it; production confirmed that it left
no new schema objects and no blocked queries. The revised migration separates
short schema DDL, bounded data writes, and concurrent index creation. Its final
CI and production results will be recorded here before deployment.
