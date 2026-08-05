---
name: peaks-route-factory
description: Run or maintain the resumable Peaks standard-route backfill. Use when claiming a route job, researching a peak's standard route with public pages, comparing private GPX references to OSM, building or reviewing a publishable OSM or USGS candidate, publishing an approved route, checking goal coverage, or setting up a low-cost recurring Luna worker.
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
3. Run from the dedicated clean checkout at
   `/Users/josiahm/projects/peaks/.workers/firebase-route-factory`. The
   summit-contact repair lane instead uses
   `/Users/josiahm/projects/peaks/.workers/firebase-route-repair`. The
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
  claim --worker-id luna-route-worker-01 --stage next --apply
```

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
  If the job has `replacement_route_id`, pass it to both importer runs.
  Distinct named routes may coexist on one peak. Never treat another route
  variant as the replacement or broaden the queue's replacement binding.
  `pending_review` ends the turn.
- `review`: spawn the project `peaks_route_reviewer` agent with only the
  source manifest, destination, trailhead, pending route ID, and fresh source
  check. Run the source check only through
  `scripts/check_pending_route_source.sh`; it owns the fixed checker and result
  path, so never add redirection or another command. Do not give the reviewer
  the researcher's verdict. The review transition ends the turn.
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

Use the public AllTrails, Peakbagger, and SummitPost pages to identify the
standard route and trailhead. Add an official park, land manager, or local
mountaineering source when possible.

Do not sign in, evade a block, or automate an authenticated GPX download.
AllTrails, Peakbagger, SummitPost, and other trip-report GPX files are private
comparison evidence unless their exact file has a clear reusable license. Never
publish their points or a traced copy. Publish geometry only from OSM under
ODbL, USGS public-domain data, or another source whose license plainly permits
reuse.

Then use the existing deterministic tools:

```text
.claude/skills/peaks-standard-route-backfill/scripts/
```

Run the OSM and USGS discovery helpers only through the exact
`with_route_db.sh` commands in `references/stage-commands.md`. Do not call a
helper directly, prefix it with `bash`, or replace it with raw `curl`; the
preflighted wrapper supplies the database connection and the installed rule
allows only the named read-only helpers.

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
named review gate set to true, and the queue reruns the current OSM or USGS
source check. A failed review goes to `needs_revision`.
Unclear rights, access, or route identity goes to `waiting_rights`,
`waiting_access`, or `needs_human`; it never becomes a quiet skip.

An old active route with missing provenance or segments is rebuild work, not a
human block. Never copy its path. Research an independent OSM or USGS
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

Use [references/luna-goal-prompt.md](references/luna-goal-prompt.md) as the
scheduled task prompt. Do not rewrite it into a looser goal.
