---
name: peaks-osm-route-approval
description: Independently check pending Peaks routes against current allowlisted official, OpenStreetMap, or USGS source geometry. Use when deciding whether a pending route follows its cited source, when reviewing drift after import, or before approving a route with reviewed reuse rights.
---

# Peaks Source Route Approval

Use for `/Users/josiahm/projects/peaks/firebase`.

Run this after import and before activation. The checker is read-only and does
not reuse the shortest-path builder. It fetches each cited source feature again
and compares the stored Cloud SQL line directly with current source geometry.

## Check

Start or reuse the Cloud SQL Auth Proxy on `127.0.0.1:5432`, set the database
variables used by `cloud-sql/migrate/src/db.ts`, then run:

```bash
cloud-sql/migrate/scripts/run-tsx.sh \
  .claude/skills/peaks-osm-route-approval/scripts/check_pending_osm_routes.mts \
  --route-id <pending-route-id>
```

Add `--format json` for a machine-readable subagent handoff.

For a public-domain USGS National Map route, run:

```bash
cloud-sql/migrate/scripts/run-tsx.sh \
  .claude/skills/peaks-osm-route-approval/scripts/check_pending_usgs_routes.mts \
  --route-id <pending-route-id> \
  --format json
```

For a route built from a publishable entry in the official trail registry,
run:

```bash
cloud-sql/migrate/scripts/run-tsx.sh \
  .claude/skills/peaks-osm-route-approval/scripts/check_pending_official_routes.mts \
  --route-id <pending-route-id> \
  --format json
```

Each checker fetches the named source again. The check passes only when:

- the route is Peaks-owned and pending;
- its canonical provenance, including paired elevation fields when present,
  passes the database constraint;
- route and source segment provenance agree;
- no active Peaks route already covers the summit;
- the first and last linked destinations are a trailhead and summit;
- each endpoint connector follows the stored path for no more than 125 m and
  joins the cited source line within 5 m;
- loop and lollipop routes also place the catalog summit on the stored line;
  only the two short segments touching that internal summit count as summit
  connectors rather than core source geometry, and each segment must be no more
  than 125 m long and must join the cited source within 5 m;
- at least 99% of sampled core geometry lies within 3 m of those lines;
- maximum core offset is at most 5 m and p95 offset is at most 2 m;
- every cited OSM way, USGS object, or official feature contributes to the
  stored route; and
- current OSM pedestrian-access tags do not block an OSM line.

Simple geometry remains required for normal routes and loops. A lollipop may
retrace one joined, contiguous stored stem. It may also retrace a trailhead
connector no longer than 125 m. The checker rejects separate retrace groups,
partial overlaps, crossings, and endpoint-on-interior crossings. Treat
`foot=permit`, `access=permit`, and a foot-specific override of blocked generic
access as warnings, then verify the current permit terms before activation.

Treat `PASS` as geometry approval only. It does not prove that the route is the
accepted standard ascent or that access and terrain conditions are current.

## Activation Gate

Do not activate from this skill. After a pass:

1. Confirm the written route-identity sources still name the same ascent.
2. Confirm the registry or OSM license and credit fields are deployed in every
   public route surface. Pending data may be checked before deployment; active
   data may not.
3. Run the standard-route segment review. Shared segment candidates must use
   the web admin segment review before activation.
4. Activate only when the user asks and all gates pass.

Report route id, pass/fail, connector offsets, sampled core maximum and p95
offsets, coverage, used way count, and any access override.
