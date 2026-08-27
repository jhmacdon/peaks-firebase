# Worker contract

## Goal set

The target is the union of:

- every summit with at least 1,500 m prominence;
- every summit on any Peaks-owned list;
- every summit with at least 25 recorded sessions; and
- every summit in a queued integrity repair for an active Peaks-owned route.

A summit counts only when it has a Peaks-owned, active standard route that
links the right trailhead to the summit and works through the public API.

## Human-only setup

The scheduled worker must never perform these steps. An operator does them
after the code reaches the canonical `firebase` checkout:

1. Apply `cloud-sql/migrations/20260731_route_provenance_elevation.sql`, then
   `cloud-sql/migrations/20260731_standard_route_backfill_jobs.sql`, then
   `cloud-sql/migrations/20260731_standard_route_replacements.sql`, then
   `cloud-sql/migrations/20260827_listed_route_country_codes.sql`, then
   `cloud-sql/migrations/20260827_standard_route_worker_roles.sql`.
2. Start the Cloud SQL Auth Proxy and set `DB_HOST`, `DB_PORT`, `DB_NAME`,
   `DB_USER`, and `DB_PASS` for operator-only seed, cutover, recovery, and
   requeue commands.
3. Create two distinct login roles with random passwords. Use the fixed login
   names `peaks-route-factory-worker` and `peaks-route-reviewer-worker`. Give
   each login exactly its matching `peaks-route-factory` or
   `peaks-route-reviewer` marker role. Both logins must remain `NOSUPERUSER`,
   `NOCREATEDB`, and `NOCREATEROLE`, with `INHERIT` enabled. Neither login may
   be a member of the other marker role. Do not grant either login the
   operator or `peaks-api` role.
4. Give each lane its own password source. The wrappers always use the fixed
   login names from step 3; they reject worker username overrides, the operator
   password, and generic PostgreSQL credentials. If a task has an isolated
   environment, put `PEAKS_ROUTE_FACTORY_DB_PASS` only in factory tasks and
   `PEAKS_ROUTE_REVIEW_DB_PASS` only in the review task. Otherwise store each
   password in its fixed macOS Keychain item. These commands prompt for the
   password instead of putting it in shell history:

```bash
security add-generic-password -U \
  -a peaks-route-factory-worker \
  -s com.jhm.peaks.route-factory-db \
  -w
security add-generic-password -U \
  -a peaks-route-reviewer-worker \
  -s com.jhm.peaks.route-reviewer-db \
  -w
```

   Never put either password in the repo, `.workers`, a shell profile, a shared
   password file, or the other lane's environment. Keychain keeps routine lane
   setup separate, but tasks under the same macOS account are not a hard
   security boundary. The database roles and write guards remain the final
   boundary. Worker tasks must not set a database host, port, or database name;
   the wrapper fixes them to `127.0.0.1:5432/peaks`. Only the operator profile
   may override that target.
5. Reset legacy candidate and review jobs that predate the required AllTrails
   and Peakbagger checks. Inspect first, then apply the idempotent cutover:

```bash
.agents/skills/peaks-route-factory/scripts/route_jobs.sh cutover-discovery-checks
.agents/skills/peaks-route-factory/scripts/route_jobs.sh cutover-discovery-checks --apply
```

   The command deletes only an exclusive Peaks-owned pending route that still
   matches its saved candidate. It keeps any unclear route and moves that job
   to `needs_human`.

6. Create the clean operator checkout
   `/Users/josiahm/projects/peaks/.workers/firebase-route-operator`, install the
   same locked dependencies, and keep it at exact `origin/main`. It uses only
   the operator database profile and cannot claim worker jobs. Inspect and seed
   the queue from that checkout:

```bash
.agents/skills/peaks-route-factory/scripts/route_jobs.sh seed
.agents/skills/peaks-route-factory/scripts/route_jobs.sh seed --apply
```

   The supervisor repeats this idempotent seed before each supervision pass.
   This brings new Peaks-owned list members into the queue and reports a
   nonzero `unseeded` count as a setup fault. Worker logins cannot seed.

7. Create one to four clean checkouts named
   `/Users/josiahm/projects/peaks/.workers/firebase-route-factory`,
   `firebase-route-factory-02`, `firebase-route-factory-03`, and
   `firebase-route-factory-04`. Install dependencies in each with
   `.agents/skills/peaks-route-factory/scripts/install_worker_dependencies.sh`
   and keep each at the exact `origin/main` commit. Put one recurring Codex task
   on each checkout. Pick `gpt-5.6-luna` with Max reasoning, pin the task to its
   one checkout, and use `luna-goal-prompt.md` unchanged. Run four staggered
   workers as the steady bounded setup. The automation supplies the exact
   cadence. Each worker claims and completes at most one queue stage per run.

8. Create the clean checkout
   `/Users/josiahm/projects/peaks/.workers/firebase-route-review`, install the
   same locked dependencies, and keep it at exact `origin/main`. Put one
   recurring Codex task on it with `gpt-5.6-luna`, medium reasoning, and
   `luna-review-goal-prompt.md` unchanged. Its derived worker ID is
   `luna-route-reviewer-01`. It may claim only `review`; general and repair
   workers use `factory`, which excludes `pending_review`. The queue also checks
   the authenticated database login, and a database trigger rejects raw factory
   writes to the review lane.

This uses the existing Mac, Codex app, Cloud SQL proxy, browser, and cached
terrain tiles. These workers add no always-on service and about $0/month in
fixed backend cost. The two database roles are metadata in the existing Cloud
SQL instance. Cloud SQL stores small job records and keeps candidate JSON
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
| Reviewed official registry entry | Yes | Only when `ready_publishable` |
| OpenStreetMap | Yes | Yes, with ODbL provenance |
| USGS public-domain data | Yes | Yes, with public-domain provenance |
| AllTrails page | Yes | No, unless that exact file has a reuse license |
| Peakbagger page or GPX | Yes | Private comparison only |
| SummitPost page or GPX | Yes | Private comparison only |
| Trip report or user recording | Yes | No, absent a clear reuse license |

Never copy, trace, simplify, or average private geometry into the candidate.
Comparisons may answer only whether independently sourced geometry agrees.

## Official-source attempts

The claim's stored destination country code controls official coverage. Before
`candidate_ready`, save exactly one current `official_source_attempts` entry
for every registry source that lists that country. Do not use a guessed country
or omit a source because it did not return geometry. Each check records its
reviewed source URL, time, short true note, and one registry-compatible result:
selected reusable geometry, no complete geometry, not applicable,
validation-only, manual gap, or unavailable.

Save the same stored country as `official_source_country_code`. Import,
approval, publication, and verification compare that binding with the live
destination. The review packet shows both codes and requires a failed review
when they differ. A mismatch rejects the old candidate; research a new one
under the corrected country.

Use `ready_publishable` official geometry first. If those sources have no
complete route, use the existing USGS adapter. Use OSM only after both direct
official geometry and USGS have durable negative outcomes. The one selected
entry must match the candidate's exact geometry source and URL.

## Route identity and safety

Check both public AllTrails and Peakbagger pages as route-identity leads, then
confirm the choice with at least one strong source. Use a second strong source
when the route is technical, disputed, access-controlled, or not clearly
named. Keep both checks in `discovery_checks`: a `matched` direct page must
also appear in `identity_sources`, while `no_match` and `unavailable` need a
short true note and the exact public service search for the claimed destination
name. Every check needs a `checked_at` from the last 24 hours when the candidate enters
`candidate_ready`. A review delay does not expire that saved check. Check:

- standard route name and trailhead;
- season, permit, guide, closure, and private-land limits;
- one-way versus round-trip shape;
- whether the route truly reaches the selected summit;
- scrambling, glacier, avalanche, or climbing limits.

Do not hide a hard route by calling it a hike. A clear access ban blocks
publication even when geometry passes.

## Geometry review

The strict official, OSM, or USGS review requires:

- Peaks-owned pending route with complete provenance;
- every cited official feature, OSM way, or USGS object used;
- trailhead and summit links;
- endpoint connectors no longer than 125 m;
- joins between separate USGS source lines no longer than 5 m;
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
- General workers prefer `verify`, then `publish`, then `import`, then research.
  The separate reviewer claims only `review`.
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
