# Shared trail conflicts: measured result and repair plan

Neither conflict can use the existing admin segment review. Both parents carry
OSM provenance and serve active Peaks routes; `assertSegmentSplitsHaveNoCatalogSource`
in `web/src/lib/segment-split-source.ts` refuses them before any split write.
The two lake jobs are rejected, with no pending route for admin activation.
Leave both lake imports blocked. No repair, approval, source edit or production
write forms part of this analysis. Infrastructure cost remains $0/month.

## Evidence and bounds

The operator's `production-inspection-2.json`, captured on 2026-10-13 at
15:36:59.327162 UTC, contains both public parents and three affected public routes.
Inventory is complete: 712 parent vertices, 2,406 materialized route vertices,
zero private route references and zero private place references. No export cap
was exceeded. This clears the privacy/inventory prerequisite only; it does not
approve repair. Any new private reference or changed public binding blocks repair.

`analysis.json` binds the snapshot, manifest and place inventory by SHA-256 and
records the saved source/DEM hashes, measurements and affected route IDs. The
analysis loads just the two named candidates through existing `buildCandidate`
and `prepareElevation`. It compares exact XY coordinates, then checks shared
source edges independently with `proveOsmSegmentSource` in strict mode. It runs
`analyzeRouteSegmentsWithClient` with exact matching and source cuts retained,
but supplies only the captured target parent to its read-only in-memory client.
This reproduces each reported conflict; it does not claim a full live matcher
scan. Each parent/candidate comparison stays below 500,000 point/edge pairs.
All indices below are zero-based and inclusive.

Projection fractions and interpolated DEM values describe mismatches only.
They do not authorize new points, snapped geometry, connectors or interpolated
repair elevations. Saved evidence is not a fresh live source or closure check.

## Snow Lake

Candidate `wa:osm-relation:4793517` has 512 exact source vertices, 5,386.96 m
one-way length, 554.35 m gain and 229.99 m loss. Parent
`L4JeIhjFWrqIGzkkZ1fk` has 406 vertices and serves only
`ilRTqqEXD7S7nxfV8XPf` (The Tooth via South Face), ordinal 1, forward.

Parent vertices 1–264 equal candidate vertices 0–263 in XY: one continuous
264-vertex span on way `162620236`, with exact edge proof and 100% coverage.
Every old Z equals the saved new DEM rounded to one decimal place. The raw Z
difference is at most 0.05 m (mean 0.02667 m, p95 0.04844 m).
This explains the strict XYZ matcher fragmentation. It finds 12 small matches
of 2–4 vertices and proposes 24 internal parent cuts, rather than one shared
span. Those cuts would make 25 parent pieces, many below the current five-vertex
review floor. Do not accept this decomposition or raise XYZ tolerances to force
reuse. The durable planner correctly rejects the split.

The Tooth's materialized path includes all 406 parent XYZ vertices unchanged.
Its stored stats, source coverage, contacts and current publish integrity pass.
Its false pending binding reflects an older route without a new candidate receipt.
The Snow bundle covers only the common way, not the parent's five other cited
ways. Failure to prove the entire parent against that partial bundle is therefore
not evidence that the rest of The Tooth is off trail. Its first edge and branch
remainder need their own source review.

The smallest possible scope is a reviewed split at the common span boundaries
(parent 1 and 264), with source boundaries inside each child where needed, and
one canonical checked elevation profile for the shared way. That is a proposal,
not an approved split: the leading two-point portion and the Tooth continuation
cannot be accepted as new catalog children without exact proof and the existing
vertex/geometry gates. Preserve the currently valid Tooth route and all links
until the whole proposed assembly passes. Do not round the new DEM merely to
make reuse pass or update The Tooth's elevations without a separate review.

## Ingalls Lake

Candidate `wa:osm-relation:5626186` has 1,008 exact source vertices, 7,107.04 m
one-way length, 907.22 m gain and 226.64 m loss. Parent
`vTRZQyeAZpTecyFjAGIr` has 306 vertices and serves two active routes at ordinal 0,
forward: `aXEHeJetvshw8lnmHEZD` (Ingalls Peak via Ingalls Way and South Ridge)
and `wCtFia9bHjfOnGeXeyEQ` (Mount Stuart via Cascadian Couloir).

Parent vertices 1–304 equal candidate vertices 1–304 in XY. Their 303 interior
edges pass strict source proof on ways `1193241119` and `236470870`, with 100%
coverage. This is largely an elevation and endpoint conflict, not a resampled
interior path. Raw saved DEM Z differs by up to 7.97031 m (mean 2.71107 m,
p95 5.93359 m); only 5 of 304 old elevations match DEM rounded to one decimal.
The parent rises on every edge, whereas the saved DEM has descents. Missing
lineage prevents a claim about how the old elevation profile was made.

The first parent point is the catalog trailhead coordinate, approximately
5.986 m from the saved mapped polyline; its first edge fails exact source proof.
The last point lies inside candidate edge 304 at fraction 0.9814745711 rather
than on its mapped endpoint; the last edge also fails exact edge proof. Do not
reuse either edge, add a connector, or carry this interior split point into a
new exact-source path. The candidate already starts at a mapped source node;
its trailhead contact passes without a connector.

The parent cites 12 ways, while its provable interior uses two. The other ten
cited ways are absent from this lake bundle and have no positive geometry in
that interior. Do not copy the full Stuart source list onto shared children.
Ingalls Peak's route source list lacks those ten ways, consistent with its
failed source-coverage gate. The exact matcher finds no reusable XYZ span and
proposes four new source spans; the same-source overlap guard correctly blocks
that duplicate trail geometry.

There is also stored route/segment drift: at 305 common XY vertices, Ingalls
Peak differs from its linked parent in Z at 184 vertices, by up to 2.1 m.
Mount Stuart matches the parent at all 305 common XY vertices; neither
materialized route includes the parent's inserted last point. Both routes fail
current publish integrity and route stats checks. The parent's 329.3 m stored
gain differs from computed gain by only 0.00926 m; that small rounding difference
is separate from the larger source/assembly failures. All linked summit contacts
currently pass. A parent-only elevation update cannot repair either route.

The smallest possible scope is a joint review of these two routes and their
shared first source interval: retain their route IDs/names, use exact source
boundaries and checked DEM, replace the parent source list with each child's
actual contributors, and rebuild both route assemblies and stats together.
An exact mapped node must replace the inserted end boundary on both sides of
the join. This requires the adjoining segment evidence before choosing the node.
The saved Ingalls Peak candidate also reports a 118.7 m unmapped final summit
span. Do not reconstruct that summit route from the lake bundle or lose its
linked summit contact to make the lake import pass.

## Smallest safe next steps

1. Keep both jobs rejected and all three active route identities unchanged.
   No current tool provides a safe apply command for these two catalog parents.
   `route-integrity-repairs.ts` tracks coverage/retirement; it does not repair
   source geometry. Do not use retirement, deletion or new source keys here.
2. Obtain a separately approved, bounded read-only export of the four adjoining
   public segments `jEoW6JjvEGP0WwgDB0gr`, `4iSCsdGqrnhPfqGc9ame`,
   `QLv4kiKc94TsKGwmhSK0`, and `dzvzs3gzMWimVjitNE1q`, including their complete
   reference inventory. Reapply the same privacy rules; any private reference
   blocks repair. The current export intentionally includes only two parents.
3. Save exact current contributing source ways and DEM evidence for the proposed
   shared children, adjoining intervals and full affected assemblies. Prove every
   child, rights/access, joins, all linked summits within 5 m, XYZ/profile/stats,
   current vertex floor and cover gates. Resolve Ingalls' unmapped summit span
   honestly; if proof is missing, keep the repair blocked.
4. Only then design a narrow source-aware repair with an exact preview hash,
   stale-input checks on all three routes and every affected segment/link, row
   locks, mandatory audit, no private references, atomic relinking and rebuilt
   route paths/profiles/stats. Preserve IDs and record old/new bindings for a
   reviewed rollback. Do not delete a live parent while any reference remains.
   This command is missing; it needs separate implementation and approval.
5. Add isolated DB regressions using the captured public cases: Snow precision
   fragmentation must not yield tiny catalog children; Ingalls must reject
   mismatched Z, non-source endpoints and overclaimed ways; affected-route drift
   and any private/stale reference must abort the whole repair. Require exact
   source child proof, full route assembly, all summit/contact gates and no
   duplicate source corridor before an apply preview can pass.
6. After an approved repair, rerun the read-only inventory and full exact planner,
   then use explicit audited recovery for the rejected jobs. The current job
   claim only accepts queued/expired-leased state; ordinary retry cannot clear
   these terminal rejections. Preserve their original rejection receipts.
   Fresh independent review, current source proof, credited cover, activation
   lease, rematch drain and canonical public/search verification still apply.

The existing read-only snapshot command is in `README.md`. The local analysis
uses `cloud-sql/migrate/src/trail-catalog/{candidate-source,sources,pending-plan}.ts`,
`cloud-sql/migrate/src/osm-segment-source-proof.ts`, and
`web/src/lib/segment-matcher-core.ts`. Later dry/import commands belong to
`npm run routes:pilot -- --manifest FILE --report FILE.jsonl`; independent
review/activation follows `cloud-sql/migrate/docs/trail-catalog-review.md`.
These are post-repair checks, not repair commands; none ran against production
for this analysis.
