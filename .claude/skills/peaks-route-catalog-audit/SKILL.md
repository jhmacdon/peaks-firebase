---
name: peaks-route-catalog-audit
description: Audit Peaks-owned summit routes in Cloud SQL for bad geometry, missing or reversed trailhead and summit links, route/segment drift, missing source records, duplicate or weaving route lines, unexplained start-point spread, and a wrong default route choice. Use when maintaining known Peaks routes, reviewing AI-added routes, investigating routes that cross or start far apart, checking one peak such as Mount Elbert, or running a catalog-wide route quality pass.
---

# Peaks Route Catalog Audit

Use for `/Users/josiahm/projects/peaks/firebase`. Keep every audit read-only.

## Audit

1. Read `cloud-sql/api/src/routes/lists.ts` to confirm the current default-route
   rule. Do not rely on the rule quoted here if the code changed.
2. Start or reuse the Cloud SQL Auth Proxy on `127.0.0.1:5432`.
3. Run the bundled checker for the smallest useful scope:

```bash
bash .claude/skills/peaks-route-catalog-audit/scripts/audit_catalog_routes.sh \
  --destination-name "Mount Elbert"
```

Use `--destination-id <id>`, `--route-id <id>`, or `--all --limit <n>` when
needed. Add `--status all` to include pending routes and `--format json` for a
machine-readable handoff.

The script checks structure and geometry. Read
[references/audit-rules.md](references/audit-rules.md) before judging its
findings or changing a route.

## Judge the Result

Treat script output as evidence, not a repair order.

- Block activation or publication on every `ERROR` and unresolved `WARN`.
- Research every `REVIEW`. Geometry cannot prove which named ascent should be
  the default route.
- Treat different named trailheads as normal when sources confirm distinct
  approaches. Treat a large start spread with a missing or shared trailhead as
  suspect.
- Treat repeated crossings plus a long close overlap as a shared-path error.
  Two source traces can weave around the same real trail even when each line is
  simple by itself.
- Do not mark a route bad merely because another valid route reaches the same
  summit.

For each route identity check, use a current land-manager or state trail source
when one exists, then a strong climbing source. Confirm the route name,
trailhead, path or ridge, class or activity, season limits, and whether it is a
normal ascent or a technical variation. Give direct links and state what each
source proves.

## Inspect Geometry

Render every route pair behind a crossing, overlap, duplicate, or start-spread
finding. Inspect the full lines, their trailhead and summit markers, and the
reported crossing area. A table alone cannot distinguish a real trail junction
from two poor traces of the same trail.

For OSM- or USGS-derived pending routes, also run
`$peaks-osm-route-approval`. That skill checks the stored line against its cited
source. This skill checks how the route fits the wider catalog.

## Report

Return:

1. audit time, database scope, and route-selection rule;
2. one row per route with id, status, trailhead, endpoint gaps, source state,
   segment state, and findings;
3. one row per suspect pair with crossings, close overlap, shared line, and
   start separation;
4. the current default route and a source-backed judgment of that choice;
5. `keep`, `repair`, `supersede`, or `needs human review` for each route; and
6. the exact next safe step.

Do not write, activate, supersede, or delete a route unless the user asks. Never
repair a migrated route by reading from Firestore. Fix Cloud SQL data, the
import path, and every current writer.
