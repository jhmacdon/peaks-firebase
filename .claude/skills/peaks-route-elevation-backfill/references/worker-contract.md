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
queue totals, expired lease count, and any blocker. Do not include coordinates.

## Operator setup

An operator creates the exact clean checkout at `origin/main`, installs the
matching `cloud-sql/migrate` lockfile dependencies, and seeds the queue outside
this worker. The worker never migrates, seeds, fetches, pulls, switches branch,
or changes tracked files. This local bounded worker adds near $0/month backend
cost.
