# Worker contract

## Goal set

The target is the union of:

- every summit with at least 1,500 m prominence;
- every summit on a Peaks-owned `Ultras %` list;
- Colorado 14ers;
- Smoot's 100;
- Washington Home Court 100; and
- every summit with at least 25 recorded sessions.

A summit counts only when it has a Peaks-owned, active standard route that
links the right trailhead to the summit and works through the public API.

## Human-only setup

The scheduled worker must never perform these steps. An operator does them
after the code reaches the canonical `firebase` checkout:

1. Apply `cloud-sql/migrations/20260731_route_provenance_elevation.sql`, then
   `cloud-sql/migrations/20260731_standard_route_backfill_jobs.sql`, then
   `cloud-sql/migrations/20260731_standard_route_replacements.sql`.
2. Start the Cloud SQL Auth Proxy and set `DB_HOST`, `DB_PORT`, `DB_NAME`,
   `DB_USER`, and `DB_PASS`.
3. Inspect and seed the queue:

```bash
.agents/skills/peaks-route-factory/scripts/route_jobs.sh seed
.agents/skills/peaks-route-factory/scripts/route_jobs.sh seed --apply
```

4. Create one to four clean checkouts named
   `/Users/josiahm/projects/peaks/.workers/firebase-route-factory`,
   `firebase-route-factory-02`, `firebase-route-factory-03`, and
   `firebase-route-factory-04`. Install dependencies in each with
   `.agents/skills/peaks-route-factory/scripts/install_worker_dependencies.sh`
   and keep each at the exact `origin/main` commit. Put one recurring Codex task
   on each checkout. Pick `gpt-5.6-luna` with Max reasoning, pin the task to its
   one checkout, and use `luna-goal-prompt.md` unchanged. For the current budget
   ramp, run each worker every 15 minutes with starts at minute 0, 4, 8, and 12.
   End the ramp at 2026-08-07 21:25 America/Denver, before the usage reset.
   Then run every 30 minutes with starts at minute 0, 7, 15, and 22. Claim one
   job per run.

This uses the existing Mac, Codex app, Cloud SQL proxy, browser, and cached
terrain tiles. Four workers add no always-on service and about $0/month in
fixed backend cost. Cloud SQL stores small job records and keeps candidate JSON
only until verification.

## State machine

```text
queued -> researching -> candidate_ready -> pending_review
       -> approved -> published -> verified
```

Revision and blocked states:

- `needs_revision`: review found a fixable fault.
- `needs_geometry`: no publishable route geometry yet; retry later.
- `waiting_rights`: the only geometry found lacks reuse rights.
- `waiting_access`: access is closed, disputed, or needs a permit decision.
- `needs_human`: the facts conflict or a production repair is needed.

Blocked jobs remain in the queue. Only `needs_geometry` retries on its own.
Rights, access, and human blocks require an explicit move back to `queued`.

The seed classifies an active route as `published` only when it already has
valid provenance, an exact non-flat elevation profile, contact within five
metres of every linked summit, and a matching segment assembly. An older active route enters research
for an independent replacement. It stays active for users during that work.
The queue carries its ID as `replacement_route_id`. Import the new route as
pending beside it. Publication changes the old route to `superseded` and the
reviewed route to `active` in one transaction.

## Source rights

| Source | Use for route facts | Use as published geometry |
|---|---:|---:|
| OpenStreetMap | Yes | Yes, with ODbL provenance |
| USGS public-domain data | Yes | Yes, with public-domain provenance |
| AllTrails page | Yes | No, unless that exact file has a reuse license |
| Peakbagger page or GPX | Yes | Private comparison only |
| SummitPost page or GPX | Yes | Private comparison only |
| Trip report or user recording | Yes | No, absent a clear reuse license |

Never copy, trace, simplify, or average private geometry into the candidate.
Comparisons may answer only whether independently sourced geometry agrees.

## Route identity and safety

Research at least one strong source. Use a second source when the route is
technical, disputed, access-controlled, or not clearly named. Check:

- standard route name and trailhead;
- season, permit, guide, closure, and private-land limits;
- one-way versus round-trip shape;
- whether the route truly reaches the selected summit;
- scrambling, glacier, avalanche, or climbing limits.

Do not hide a hard route by calling it a hike. A clear access ban blocks
publication even when geometry passes.

## Geometry review

The strict OSM or USGS review requires:

- Peaks-owned pending route with complete provenance;
- every cited OSM way or USGS object used;
- trailhead and summit links;
- endpoint connectors no longer than 125 m;
- correct loop handling;
- at least 99% of core geometry within 3 m of cited source lines;
- maximum core distance at most 5 m;
- p95 core distance at most 2 m; and
- no blocked OSM access when OSM supplies the geometry.

Publication also fails unless every linked summit has a catalog location and
lies within five metres of the route path. Out-and-back and point-to-point
routes must end within five metres of a final summit. Loops and lollipops may
contact the summit inside the path. The route and each segment must carry
usable Z elevations, and the encoded route profile must match the exact
direction-aware segment assembly.

Luna and the reviewer must not infer the summit, profile, or assembly gates.
The leased `transition --to approved` command calls
`peaks_route_passes_publish_integrity(route_id, destination_id, 'pending')`
itself and replaces those three review fields and their count-only evidence.
That database result is final; a false result rejects approval.

For a shared bad route, activating one replacement covers only the claimed
destination link. The old route stays active until every repair-ledger link
has valid active coverage. The last activation retires the old route in the
same transaction. Luna must not retire a shared route by hand.

The route identity and access review is separate and must also pass.

## Cost and context limits

- Claim one job per scheduled run.
- Prefer `verify`, then `publish`, then `review`, then `import`, then research.
- Never paste source dumps into chat. Use saved files and compact JSON.
- Cache terrain tiles by route bounds and reuse them.
- Stop browser work after a source blocks public access; do not retry in a loop.
- Heartbeat the lease during long work.

## Recovery

- Expired leases become claimable without changing the saved state.
- Run `release` when a run ends early.
- Only an operator reruns `seed --apply` to add new targets. Seed preserves
  leases and all in-flight work.
- Run
  `.agents/skills/peaks-route-factory/scripts/with_route_db.sh
  cloud-sql/migrate/scripts/audit-standard-route-goal.sh --format summary`
  to check the target set outside the queue.
- An empty claim with nonzero remaining work means jobs are blocked or leased;
  inspect `stats` and `show` rather than declaring success.
- Only a human may reopen `waiting_rights`, `waiting_access`, or `needs_human`.
  The `requeue` command requires `PEAKS_ALLOW_ROUTE_REQUEUE=1`, the old state,
  a reason, and an explicit human-review acknowledgement.
- `recover-legacy` is a narrow operator repair for jobs that the first worker
  wrongly blocked with `active_route_missing_provenance_segments`. It requeues
  only active Peaks routes that still fail those exact machine checks.
- `npm --prefix cloud-sql/migrate run routes:integrity-repairs -- retire-covered
  --route-id ID` is an operator-only
  dry run for an old route whose ledger links were all covered before these
  publish gates shipped. Add `--apply` only after its compact count-only output
  shows zero invalid links. The serializable command locks and rechecks every
  active Peaks replacement, requeues stale coverage, and never changes a user
  route.
