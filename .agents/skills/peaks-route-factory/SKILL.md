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
3. Work from the firebase repo root and confirm the database proxy and `DB_*`
   values.
4. Run:

```bash
npm --prefix cloud-sql/migrate run routes:jobs -- stats
npm --prefix cloud-sql/migrate run routes:jobs -- \
  claim --worker-id luna-route-worker-01 --stage next --apply
```

If no job is returned, run the audit in the contract. Do not infer completion
from an empty claim.

## Follow the returned stage

- `research`: the claim moves queued or retry work to `researching`. Research
  and build one candidate.
- `import`: restore the saved candidate, cache its terrain bounds, run the
  importer first without and then with `--apply`, and save the pending route ID.
- `review`: spawn the project `peaks_route_reviewer` agent with only the
  source manifest, destination, trailhead, pending route ID, and fresh source
  check. Do not give it the researcher's verdict.
- `publish`: plan segments and activate the approved pending route. If a prior
  run already activated it, do not activate it again; move it to `published`.
- `verify`: run the bundled verifier. Mark `verified` only when every returned
  gate passes.

Use `routes:jobs heartbeat` before a long browser or map step. Release the lease
with a short retry if the run must end. Make every state change through
`routes:jobs transition`; never edit the queue by hand.

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

Read that skill before choosing a builder. Build, compare, render, and inspect
the local map. Cache only the route bounding area from AWS terrain tiles. Raw
HTML, GPX, OSM XML, and terrain tiles stay out of model context and git.

Before `candidate_ready`, run:

```bash
cloud-sql/migrate/node_modules/.bin/tsx \
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
