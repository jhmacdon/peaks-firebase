# Audit Worker Contract

## Goal

Audit every summit that has an active Peaks-owned route or a quarantined legacy
coverage route. A destination counts only when its durable job is `passed`,
`needs_repair`, or `needs_human` with a complete source-backed result. Blocked
work stays visible.

## One bounded run

- Claim exactly one queued destination.
- Audit only that destination.
- Keep route and destination tables read-only.
- Write only the audit job row and temporary evidence files.
- Heartbeat before browser or map work.
- Complete or release the lease before ending.
- Treat `catalog_changed_requeued` and `out_of_scope` completion responses as
  lease-cleared terminal outcomes for that run.
- Stop after three consecutive destinations hit the same tool fault or shared
  blocker. Report the pattern instead of draining the queue.

These queue rules apply to the recurring worker. When the user asks for one
named destination, audit it read-only without running the audit-job script,
claiming a job, or changing a job. Preserve the checkout's starting git status.

## Source and context limits

- Use public pages only. Stop after a source blocks public access.
- Never sign in, bypass a block, or download private GPX geometry.
- Keep raw HTML, GPX, OSM payloads, path coordinates, and screenshots out of
  model context and git.
- Use compact JSON and `jq` for evidence.
- Use only route facts from AllTrails, Peakbagger, SummitPost, and trip
  reports; do not republish their geometry.

## Human setup

An operator must:

1. merge and apply the quarantine and audit-job migrations;
2. seed the audit queue with `route_audit_jobs.sh seed --apply`;
3. create
   `/Users/josiahm/projects/peaks/.workers/firebase-route-audit` at exact
   `origin/main`;
4. install `cloud-sql/migrate` dependencies there; and
5. schedule Luna Max with `luna-goal-prompt.md`.

The worker must never apply migrations, seed, fetch, pull, switch branches, or
edit tracked files.

This uses the existing Mac, Cloud SQL proxy, browser, and Codex heartbeat. It
adds no always-on service. Added backend cost is near $0; the audit table holds
small job and result JSON rows.
