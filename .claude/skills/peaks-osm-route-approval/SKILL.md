---
name: peaks-osm-route-approval
description: Independently check pending Peaks routes against the current OpenStreetMap ways recorded in their provenance. Use when deciding whether an OSM-derived pending route closely follows its cited OSM geometry, when reviewing OSM route drift after import, or before approving a Peaks route that must retain ODbL attribution.
---

# Peaks OSM Route Approval

Use for `/Users/josiahm/projects/peaks/firebase`.

Run this after import and before activation. The checker is read-only and does
not reuse the shortest-path builder. It fetches each cited OSM way again and
compares the stored Cloud SQL line directly with the current source geometry.

## Check

Start or reuse the Cloud SQL Auth Proxy on `127.0.0.1:5432`, set the database
variables used by `cloud-sql/migrate/src/db.ts`, then run:

```bash
cloud-sql/migrate/node_modules/.bin/tsx \
  .claude/skills/peaks-osm-route-approval/scripts/check_pending_osm_routes.mts \
  --route-id <pending-route-id> \
  --route-id <pending-route-id>
```

Add `--format json` for a machine-readable subagent handoff.

The check passes only when:

- the route is Peaks-owned and pending;
- its exact nine-field provenance passes the database constraint;
- route and source segment provenance agree;
- no active Peaks route already covers the summit;
- the first and last linked destinations are a trailhead and summit;
- the endpoint connectors lie within 125 m of the cited OSM lines;
- at least 99% of sampled core geometry lies within 3 m of those lines;
- maximum core offset is at most 5 m and p95 offset is at most 2 m;
- every cited OSM way contributes to the stored route; and
- current OSM pedestrian-access tags do not block the line.

Treat `PASS` as geometry approval only. It does not prove that the route is the
accepted standard ascent or that access and terrain conditions are current.

## Activation Gate

Do not activate from this skill. After a pass:

1. Confirm the written route-identity sources still name the same ascent.
2. Confirm OSM attribution and ODbL fields are deployed in every public route
   surface. Pending data may be checked before deployment; active data may not.
3. Run the standard-route segment review. Shared segment candidates must use
   the web admin segment review before activation.
4. Activate only when the user asks and all gates pass.

Report route id, pass/fail, connector offsets, sampled core maximum and p95
offsets, coverage, used way count, and any access override.
