---
name: peaks-route-factory
description: Run or maintain the resumable Peaks standard-route backfill. Use when claiming a route job, researching a peak's standard route with public pages, comparing private GPX references to official or OSM geometry, building or reviewing a publishable official, OSM, or USGS candidate, publishing an approved route, checking goal coverage, or setting up a low-cost recurring Luna worker.
---

# Peaks Route Factory

Fill one queue job at a time. Favor finishing review, publication, and public
verification before starting new research. The database is the source of truth;
chat history is not.

## Start every run

1. Read [references/worker-contract.md](references/worker-contract.md).
2. Read [references/stage-commands.md](references/stage-commands.md) for the
   claimed stage and [references/result-schemas.md](references/result-schemas.md)
   before writing a result.
3. Run from the dedicated clean checkout fixed by the scheduled task. The
   approved general worker checkouts are
   `/Users/josiahm/projects/peaks/.workers/firebase-route-factory`,
   `/Users/josiahm/projects/peaks/.workers/firebase-route-factory-02`,
   `/Users/josiahm/projects/peaks/.workers/firebase-route-factory-03`, and
   `/Users/josiahm/projects/peaks/.workers/firebase-route-factory-04`. Never
   choose or switch checkouts during a run. The summit-contact repair lane uses
   `/Users/josiahm/projects/peaks/.workers/firebase-route-repair`. The independent
   review lane uses
   `/Users/josiahm/projects/peaks/.workers/firebase-route-review`. The
   canonical `/Users/josiahm/projects/peaks/firebase` checkout is also allowed
   only when clean and exactly at `origin/main`. Do not search another worktree,
   apply a migration, or seed the queue.
4. Use the wrapper for every queue command. It loads the database password
   without printing it and refuses a dirty, stale, unknown, or uninstalled
   checkout before it checks the local proxy. Run it from the repo root and
   always spell the wrapper path exactly as shown; do not add
   `cloud-sql/migrate/` before `.agents`:

```bash
.agents/skills/peaks-route-factory/scripts/route_jobs.sh stats
.agents/skills/peaks-route-factory/scripts/route_jobs.sh \
  claim --stage factory --apply
```

The wrapper derives the worker ID and allowed claim stage from a dedicated
checkout. General and repair checkouts cannot claim `review`; the review
checkout can claim only `review`. Never pass a worker ID there. A clean
canonical checkout must pass an explicit worker ID and cannot claim review.
Keep every candidate, result, packet, and review in the ignored
`cloud-sql/migrate/route-candidates/luna/worker-artifacts` directory in the
current checkout, with the lease token in its filename. The wrapper rejects
handoff paths outside that directory. Shared map and terrain caches contain
only atomic public tile files.

If no job is returned, run the audit in the contract. Do not infer completion
from an empty claim.

Only when the user or supervisor explicitly names one destination for a
supervised repair may that run add `--destination-id ID` to `claim`. The
filter never changes the job's stage or gates. A recurring worker must not
invent a destination filter or keep using one after that named run.

The repair lane must add `--integrity-repairs-only` to every claim. It must
stop if a claim ever returns a job whose `target_reasons.integrity_repair` is
not true. The general lane must not add that filter. Use
[references/luna-repair-goal-prompt.md](references/luna-repair-goal-prompt.md)
unchanged for the repair lane.

## Follow the returned stage

A claim authorizes exactly one stage. Its successful terminal queue action
clears that stage's lease. As soon as it succeeds, run final stats and stop the
turn. Never use the cleared lease, a local artifact, or a saved route ID to
start the next stage. A later heartbeat must claim the job again and receive
the next stage with a new lease.

- `research`: the claim moves queued or retry work to `researching`. Research
  and build one candidate. `candidate_ready` ends the turn.
- `import`: restore the saved candidate, cache its terrain bounds, run the
  importer first without and then with `--apply`, and save the pending route ID.
  Call `scripts/import_route_candidate.sh` directly for both importer runs.
  It owns the fixed terrain environment and database preflight. Never prefix it
  with environment assignments, `env`, or another shell command.
  Pass the full route name as one quoted `--name` value. The importer rejects
  names that do not name the linked destination. Confirm the dry run prints the
  full expected `Name:` before applying.
  The importer reads `replacement_route_id` and any prior pending route from
  the locked job; never pass a caller-chosen replacement ID.
  Distinct named routes may coexist on one peak. Never treat another route
  variant as the replacement or broaden the queue's replacement binding.
  The apply import binds the route and enters `pending_review` in one database
  transaction. That successful import ends the turn.
- `review`: run only in the dedicated review checkout under worker ID
  `luna-route-reviewer-01`. Spawn the project `peaks_route_reviewer` agent with only the
  filtered packet from `scripts/build_route_review_packet.mjs`. Restore the
  full candidate result from the durable queue with `materialize-result`; never
  trust a file left by another stage or attach the full result to the reviewer.
  The builder
  keeps every saved identity URL, up to the queue's four-source limit, plus one
  access URL, and retains known conflicts. It fetches those public pages in parallel with hard timeouts and
  stores only compact evidence. The reviewer never browses.
  The packet includes a route-specific `review_result_template`. Spawn the
  reviewer with one prompt field that names only the packet path; do not also
  attach the packet as a second input form. The reviewer copies that template,
  replaces the verdict and null gates, keeps the flat schema unchanged, and
  returns JSON only. An evidence item marked `ok` proves only that the page was
  fetched, not that its text supports the candidate fact.
  Run the source check only through
  `scripts/check_pending_route_source.sh`; it owns the fixed checker and result
  path, so never add redirection or another command. Do not give the reviewer
  the researcher's verdict. The queue accepts a review outcome only while this
  checkout owns a fresh review lease, derives the stored reviewer from that
  locked lease, and binds the same owner into the packet attestation. The review
  transition ends the turn.
- `publish`: plan segments and activate the approved pending route. If a prior
  run already activated it, do not activate it again; move it to `published`.
  `published` ends the turn.
- `verify`: run the single `route_jobs.sh verify` command. It alone chooses
  `verified`, a safe rebuild, a public-API retry, or a true human conflict.
  Never interpret the gates or transition a verify job by hand. Its returned
  action ends the turn.

Use `route_jobs.sh heartbeat` before a long browser or map step. Release the
lease with a short retry if the run must end. Use `route_jobs.sh transition`
for non-verify state changes and `route_jobs.sh verify` for verification. Never
edit the queue by hand.

Stop the lasting goal as blocked when the same tool fault or blocker appears on
three consecutive destinations. Release any lease first. Do not drain a whole
stage into one blocked state while assuming each peak is unrelated.

## Research stage

Check public AllTrails and Peakbagger pages first to identify the standard
route and trailhead. Record each matching direct page in `identity_sources`.
Use SummitPost and an official park, land manager, or local mountaineering
source to confirm the choice and current access when available. If either
AllTrails or Peakbagger has no credible match or cannot be reached, record an
exact `no_match` or `unavailable` entry in `discovery_checks`; never replace a
missing match with a guessed URL. A matched check must use a concrete public
trail, peak, ascent, or list result page that also appears in `identity_sources`
with type `alltrails` or `peakbagger`; a home or search page is not a match.
Every check must keep a fresh `checked_at`; negative checks also keep the exact
public service search for the claimed destination name in `attempted_url` and
a short true note. A search for another place does not count.
For official identity evidence, set the source type to the exact reviewed
official trail registry ID and use a URL on that source's recorded discovery
or endpoint host. Generic publisher labels do not pass the queue gate.
For an audited KFS route in a South Korean national park, use `knps` with both
the exact six-digit-`parkId` course page and the separately audited four-digit
`rstId` control-detail page for that destination. The dated KNPS fixture must
class the row as `proven_open` and still be fresh. A course page, a broad park
page, the KFS archive, or a KFS seasonal raster map does not prove current
access. Partial, unresolved, conditional, excluded, and blocked rows stop.

Do not sign in, evade a block, or automate an authenticated GPX download.
AllTrails, Peakbagger, SummitPost, and other trip-report GPX files are private
comparison evidence unless their exact file has a clear reusable license. Never
publish their points or a traced copy. After route identity is clear, map it
against a source in the reviewed official trail registry. Publish geometry
only from an allowlisted official source, OSM under ODbL, or USGS
public-domain data.

Filter `cloud-sql/migrate/data/official-trail-sources.json` by the claimed
country before choosing geometry. Check relevant `validation_only` and
`manual_gap` agency pages for route identity, current access, or alignment.
Never copy their geometry. Use the exact registry ID and a recorded host when
one becomes an identity source. Save exactly one fresh
`official_source_attempts` result for every registry entry that covers the
claim's stored country code, and repeat it in
`official_source_country_code`. Use `ready_publishable` official geometry first,
the existing USGS adapter next, and OSM only after both earlier tiers have
durable negative outcomes. The selected attempt must match the candidate's
exact geometry source and URL.

Then use the existing deterministic tools:

```text
.claude/skills/peaks-standard-route-backfill/scripts/
```

Run the official, OSM, and USGS discovery helpers only through the exact
`with_route_db.sh` commands in `references/stage-commands.md`. Do not call a
helper directly, prefix it with `bash`, or replace it with raw `curl`; the
preflighted wrapper supplies the database connection and the installed rule
allows only the named read-only helpers.

Factory and review tasks use different database logins from isolated task
environments. Never read, copy, request, cache, or reuse the other lane's
credentials. A caller-set worker ID is not authority: the queue checks the
authenticated database role for every claim and state transition.

Read that skill before choosing a builder. Build, compare, render, and inspect
the local map. Cache only the route bounding area from AWS terrain tiles. Raw
HTML, GPX, OSM XML, and terrain tiles stay out of model context and git.

Before `candidate_ready`, run:

```bash
cloud-sql/migrate/scripts/run-tsx.sh \
  .agents/skills/peaks-route-factory/scripts/audit_route_candidates.mts \
  --file <candidate.geojson> --format summary
```

Save the candidate result JSON from the required schema. Transition with
`--artifact-path` and `--result-file`. The queue stores the full candidate and
its checksum, so the next run can recover after a lost worktree.

## Review and publication gates

The reviewer must apply every gate in:

```text
.claude/skills/peaks-osm-route-approval/SKILL.md
```

A model opinion is not enough. `approved` requires `verdict: PASS` and every
named review gate set to true, and the queue reruns the current official, OSM, or USGS
source check. A failed review goes to `needs_revision`.
Unclear rights, access, or route identity goes to `waiting_rights`,
`waiting_access`, or `needs_human`; it never becomes a quiet skip.

An old active route with missing provenance or segments is rebuild work, not a
human block. Never copy its path. Research independent official, OSM, or USGS
replacement while the old route remains active for users.

Importers default to dry-run and create `pending` routes. An exact retry reuses
the same pending row. Activation requires the approved job lease, explicit
apply flags, the independent PASS, and a segment plan with no unreviewed shared
splits. The queue reruns live Cloud SQL and public API checks before `verified`.
Never activate a route merely because it looks close.

## Finish every run

Release or clear the lease, run `routes:jobs stats`, and report:

- destination and stage;
- sources checked;
- files and database rows changed;
- state reached and exact blocker, if any;
- next safe action;
- total verified and remaining.

Do not call the listed-peak goal complete until this read-only final gate exits
zero:

```bash
.agents/skills/peaks-route-factory/scripts/with_route_db.sh \
  cloud-sql/migrate/scripts/audit-listed-route-cover-goal.sh \
  --format summary --require-complete
```

It also requires a fully credited destination cover and a derived cover for
every active Peaks-owned route. Run this final gate from an operator checkout;
factory, repair, and reviewer checkouts reject it. A route-only zero is not the
finished goal.

Use [references/luna-goal-prompt.md](references/luna-goal-prompt.md) for general
workers, [references/luna-repair-goal-prompt.md](references/luna-repair-goal-prompt.md)
for repair, and [references/luna-review-goal-prompt.md](references/luna-review-goal-prompt.md)
for the separate reviewer. Do not rewrite them into looser goals.
