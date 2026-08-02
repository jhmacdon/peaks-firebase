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
  claim --apply
```

If setup fails, do not claim. If no job is returned, inspect stats; do not infer
completion from an empty claim.

In one-off mode, do not run `route_audit_jobs.sh` at all. The audit queue may
not exist yet, and its checkout checks do not apply to a direct read-only
audit.

## Check Stored Data

Create the evidence directory outside the checkout:

```bash
AUDIT_DIR="$(mktemp -d /tmp/peaks-route-audit.XXXXXX)"
```

Never create evidence inside the audit checkout; the clean-tree guard will
reject heartbeats and queue writes. Run the catalog checker for the claimed
destination and keep the full JSON in the system temporary directory:

```bash
bash .claude/skills/peaks-route-catalog-audit/scripts/audit_catalog_routes.sh \
  --destination-id DESTINATION_ID --status catalog --format json \
  > "$AUDIT_DIR/catalog.json"

node .claude/skills/peaks-route-catalog-audit/scripts/fetch_destination_identity.mjs \
  --catalog "$AUDIT_DIR/catalog.json" --output "$AUDIT_DIR/identity.json"
```

Read compact fields with `jq`; never paste path coordinates or full source
pages into chat. Every `ERROR` blocks PASS. Research every `WARN` and `REVIEW`.
Render route pairs behind crossing, overlap, duplicate, or start-spread
findings.

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
  --catalog "$AUDIT_DIR/catalog.json" \
  --identity "$AUDIT_DIR/identity.json" \
  --facts "$AUDIT_DIR/facts.json" \
  --output "$AUDIT_DIR/result.json"
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
  --destination-id DESTINATION_ID --lease-token LEASE_TOKEN \
  --state passed --result-file "$AUDIT_DIR/result.json" --apply
```

Use `needs_repair` for `FAIL` and `needs_human` for `REVIEW`. If the run cannot
produce a valid result, release its lease with a short exact error. End with
stats and a clean checkout. In one-off mode, do not write an audit job; report
the result and preserve the checkout's starting git status.

Read the completion response. `completed` is final.
`catalog_changed_requeued` and `out_of_scope` have already cleared the lease;
do not release them again. Report the outcome and stop that run.

Report the destination, stored and preferred names, standard-route facts,
sources, current default, each route action (`keep`, `repair`, `supersede`, or
`needs human review`), final state, lease health, and remaining total. Do not
repair or publish routes during an audit run.

Use [references/luna-goal-prompt.md](references/luna-goal-prompt.md) unchanged
for each recurring Luna task. The automation prompt supplies its one checkout.
