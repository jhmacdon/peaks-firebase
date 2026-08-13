---
name: peaks-route-catalog-audit
description: Audit Peaks-owned summit routes one destination at a time for wrong route identity, implausible distance or gain, bad default-route choice, missing trailheads, route/segment drift, source or rights gaps, duplicate or weaving lines, and wrong or incomplete multilingual peak names. Use when reviewing AI-added or migrated routes, investigating a peak such as Daedunsan or Mount Elbert, maintaining the route catalog, or running the durable Luna route-audit queue.
---

# Peaks Route Catalog Audit

Audit one destination per run. Keep route and destination data read-only. Write
only the durable audit job row and temporary evidence files.

## Start

1. Read [references/worker-contract.md](references/worker-contract.md) and
   [references/audit-rules.md](references/audit-rules.md).
2. Choose one mode:
   - For a recurring worker, work only from the clean audit checkout named in
     its automation prompt. It must be one of:
     `/Users/josiahm/projects/peaks/.workers/firebase-route-audit`,
     `/Users/josiahm/projects/peaks/.workers/firebase-route-audit-02`,
     `/Users/josiahm/projects/peaks/.workers/firebase-route-audit-03`, or
     `/Users/josiahm/projects/peaks/.workers/firebase-route-audit-04`.
   - For a one-off destination that the user names or identifies, use the
     current checkout and audit that destination without claiming or changing
     an audit job. Record the starting git status and leave it unchanged.
3. In recurring mode, run stats, then claim one job. The wrapper derives a
   unique worker ID from the checkout and rejects a mismatched explicit ID:

```bash
.claude/skills/peaks-route-catalog-audit/scripts/route_audit_jobs.sh stats
.claude/skills/peaks-route-catalog-audit/scripts/route_audit_jobs.sh \
  claim --lease-minutes 30 --apply
```

Treat every recurring turn as a fresh run. Execute the current stats wrapper
before reporting setup or queue state; never reuse a prior turn's result. If
the automation prompt confirms that the narrow local proxy wrappers are
allow-listed, run every `route_audit_jobs.sh` call and recurring
`audit_catalog_routes_worker.sh` and
`fetch_destination_identity_worker.sh` call directly on its first attempt. Do
not set `sandbox_permissions`; the installed prefix rules handle these exact
wrappers. Never prepend `bash`, `zsh`, `env`, `cd`, a variable assignment, or
another command. Do not report a setup failure unless a wrapper call in the
current turn produced it. If the proxy is unreachable, the bounded worker must
not claim; its supervisor must use `$peaks-cloud-sql-proxy-recovery` before
counting another shared setup fault. If setup fails, do not claim. If no job
is returned, inspect stats; do not infer completion from an empty claim. If claim returns
`existing_live_lease`, resume that returned destination; it is the worker's
one job. Never claim again. Never copy, retain, reconstruct, or pass a
`lease_token`; queue output omits it. For heartbeat, completion, and release,
the wrapper selects the checkout's single lease by its derived worker ID.

In one-off mode, do not run `route_audit_jobs.sh` at all. The audit queue may
not exist yet, and its checkout checks do not apply to a direct read-only
audit.

## Check Stored Data

Use one direct system-temp file prefix for the claimed destination:

```bash
AUDIT_PREFIX="/tmp/peaks-route-audit-DESTINATION_ID"
```

Replace `DESTINATION_ID` with the exact claimed ID. Never create an evidence
directory or place evidence inside the audit checkout; the clean-tree guard
will reject heartbeats and queue writes. In recurring mode, run the worker
catalog checker for the claimed destination and keep the full JSON in direct
files under the system temp root:

```bash
.claude/skills/peaks-route-catalog-audit/scripts/audit_catalog_routes_worker.sh \
  --destination-id DESTINATION_ID --status catalog --format json \
  --output "$AUDIT_PREFIX.catalog.json"

.claude/skills/peaks-route-catalog-audit/scripts/fetch_destination_identity_worker.sh \
  --catalog "$AUDIT_PREFIX.catalog.json" \
  --output "$AUDIT_PREFIX.identity.json"
```

In one-off mode, use `audit_catalog_routes.sh` and
`fetch_destination_identity.mjs` directly because the approved worker checkout
and queue do not apply.

Run the catalog checker with the command tool's `yield_time_ms` set to 30000.
The read-only query often takes longer than that on a large legacy route. If
the command returns a live `session_id`, call `write_stdin` on that same session
with empty input and `yield_time_ms` 30000 until the process exits. Do not read
`catalog.json`, run the identity step, or start a second checker while the first
session is live. If the session cannot finish, send Ctrl-C to that same session
before releasing the lease. The database also cancels a checker after five
minutes so a lost local session cannot leave a lasting query.

In recurring mode, always pass the catalog path with the wrapper's `--output`
flag. Never use shell redirection for the catalog checker. The fixed wrapper
output keeps the approved command prefix stable across temporary directories.

Read compact fields with `jq`; never paste path coordinates or full source
pages into chat. Every `ERROR` blocks PASS. Research every `WARN` and `REVIEW`.
Render route pairs behind crossing, overlap, duplicate, or start-spread
findings.

All four Luna workers must also confirm that every linked summit is within 5 m
of the stored path, that out-and-back and point-to-point routes end within 5 m
of their final summit, and that the canonical elevation profile matches the
path. A route failure is `needs_repair`; a public HTTP 200 or a plausible
outside source never waives it.

## Check Outside Facts

Renew the lease before browser work. Find the accepted normal ascent, not just a
route that touches the summit.

- Use a current park, land-manager, tourism-board, or trail authority source
  when one exists.
- Use a second independent route source such as AllTrails, Peakbagger,
  SummitPost, a national hiking body, or a strong local mountaineering source.
- Confirm route name, trailhead, distance basis, shape, gain, activity or
  technical class, access, season limits, and whether it is the normal ascent.
- AllTrails round-trip distance is not stored one-way distance. Record the
  basis and shape before comparing.
- Never sign in, evade a block, or copy private GPX points. This audit compares
  facts and independently sourced stored geometry.

Audit the display name too. OSM and Wikidata evidence comes from
`identity.json`. For Peaks' English catalog, use a reliable English name as the
display name when one exists. Preserve the local-script name and sourced
aliases; do not invent a translation or transliteration.

Write the compact source record defined in
[references/source-facts.md](references/source-facts.md), then run:

```bash
node .claude/skills/peaks-route-catalog-audit/scripts/compare_route_source_facts.mjs \
  --catalog "$AUDIT_PREFIX.catalog.json" \
  --identity "$AUDIT_PREFIX.identity.json" \
  --facts "$AUDIT_PREFIX.facts.json" \
  --output "$AUDIT_PREFIX.result.json"
```

If a second source or required fact is unavailable, use the reference's
`evidence_gaps` form and still run the comparator. Do not release a job merely
because public evidence is incomplete. A stale OSM or Wikidata link appears as
an identity review finding, not a tool failure.

Record each publisher's own route facts. Never create one standard route by
mixing distance, gain, shape, or trailhead facts from different route variants.
Keep conflicting values in their source records and let the comparator return
`REVIEW`.

## Finish

The comparator alone may produce `PASS`. A source conflict or missing second
source is `REVIEW`; never guess. In recurring mode, complete the job with the
exact comparator state:

```bash
.claude/skills/peaks-route-catalog-audit/scripts/route_audit_jobs.sh complete \
  --destination-id DESTINATION_ID --state passed \
  --result-file "$AUDIT_PREFIX.result.json" --apply
```

Use `needs_repair` for `FAIL` and `needs_human` for `REVIEW`. If the run cannot
produce a valid result, release its lease with a short exact error, without a
lease token. End with stats and a clean checkout. In one-off mode, do not write
an audit job; report the result and preserve the checkout's starting git
status.

Read the completion response. `completed` is final.
`catalog_changed_requeued` and `out_of_scope` have already cleared the lease;
do not release them again. Report the outcome and stop that run.

If heartbeat, completion, or release reports `No single live audit lease
matched`, `No live audit lease matched`, `No single audit lease matched`, or
`No audit lease matched`, do not run release again. Diagnose the claimed
destination once:

```bash
.claude/skills/peaks-route-catalog-audit/scripts/route_audit_jobs.sh \
  diagnose-loss --destination-id DESTINATION_ID
```

If the outcome is `destination_deleted`, the destination and its cascading job
were deleted during the audit. Treat it as terminal `out_of_scope`, run final
stats, confirm a clean checkout, and stop without operator action. If the
outcome is `lease_live`, retry the failed lease command once. For any other
outcome, do not release or claim; report the diagnosis for operator action.

Report the destination, stored and preferred names, standard-route facts,
sources, current default, each route action (`keep`, `repair`, `supersede`, or
`needs human review`), final state, lease health, and remaining total. Do not
repair or publish routes during an audit run.

Use [references/luna-goal-prompt.md](references/luna-goal-prompt.md) unchanged
for each recurring Luna task. The automation prompt supplies its one checkout.
