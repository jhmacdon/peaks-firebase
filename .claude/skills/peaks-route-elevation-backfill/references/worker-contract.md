# Elevation Worker Contract

## One bounded run

- Use only `/Users/josiahm/projects/peaks/.workers/firebase-route-elevation`.
- Run stats, claim exactly one job, and process only its route ID and lease token.
- The wrapper assigns `luna-route-elevation-01`; never pass another ID.
- Complete or release the lease before stopping. A lease may remain only while work is active.
- Stop after one route or three repeated shared faults. Report the blocker; do not drain the queue.

## Outcomes and report

The only terminal process outcomes are `complete`, `path_changed_requeued`,
`out_of_scope`, `retry`, and `blocked`. Never call a run complete unless the
process response says `complete`. `path_changed_requeued` and `out_of_scope`
already clear the lease. On a tool failure, release the live lease; its result
is `retry` or `blocked`.

Report a compact route ID and name when returned, source kind, point count,
profile hash, queue totals, expired lease count, and any blocker. A `blocked`
result after a write means the worker saved safe elevation data but a separate
publish gate, such as summit contact, still failed. Do not retry it in the same
run. `sampled_elevation_profile_has_no_real_range_requires_route_factory`
blocks before any write and needs route repair. Do not include coordinates.

The script rebuilds Peaks route caches from their stored ordered segments. If a
bad segment is also linked to a user route, it clones that segment and moves
only Peaks links. It never changes the shared source segment or a user route.
Completion evidence in the queue keeps the elevation source, source endpoint,
license note, retrieval time, point count, and profile hash.

## Operator setup

An operator creates the exact clean checkout at `origin/main`, installs the
matching `cloud-sql/migrate` lockfile dependencies, runs the route-factory
`cache_route_db_password.sh` operator helper once, and seeds the queue outside
this worker. The helper writes only a mode-600 password cache beside the
dedicated checkouts; it never writes a secret into Git. The worker never
migrates, seeds, fetches, pulls, switches branch, refreshes credentials, or
changes tracked files. This local bounded worker adds near $0/month backend cost.
