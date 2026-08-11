---
name: peaks-route-elevation-backfill
description: Backfill one Peaks-owned route elevation profile. Use for recurring Luna queue work or a bounded Peaks route elevation/profile backfill.
---

# Peaks Route Elevation Backfill

Use only `/Users/josiahm/projects/peaks/.workers/firebase-route-elevation`.
Never use another checkout or a worker ID supplied by a caller.

Run only the wrapper. It runs the shared clean `origin/main` preflight and
lockfile dependency check before every queue command:

```bash
.claude/skills/peaks-route-elevation-backfill/scripts/route_elevation_jobs.sh stats
.claude/skills/peaks-route-elevation-backfill/scripts/route_elevation_jobs.sh claim --apply
```

Read [references/worker-contract.md](references/worker-contract.md). Run stats,
then claim exactly one job. If the claim returns no route, report stats and
stop. Process only the returned route ID and lease token:

```bash
.claude/skills/peaks-route-elevation-backfill/scripts/route_elevation_jobs.sh \
  process --route-id ROUTE_ID --lease-token LEASE_TOKEN --apply
```

If processing fails before it reaches a lease-cleared terminal outcome, release
that token with a short exact message. Use heartbeat only for the same token.
End with stats and a clean checkout; report the lease outcome, compact route
ID/name if returned, source kind, point count, queue totals, expired lease
count, safe profile hash, and blocker. Do not report coordinates. If processing
returns `blocked`, report its compact cause and stop; do not retry that route.
`sampled_elevation_profile_has_no_real_range_requires_route_factory` means the
worker rejected the terrain sample before any write; send it to route repair.

Do not research sources or use a browser. Do not edit route XY or shape data,
destinations, migrations, git state, or user-owned records. Do not run raw SQL,
raw npm commands, arbitrary worker IDs, or pass raw coordinates into chat. Do
not seed or work more than one job. Stop after one route or after three repeated
shared faults.

Use [references/luna-goal-prompt.md](references/luna-goal-prompt.md) unchanged
for the recurring Luna task.
