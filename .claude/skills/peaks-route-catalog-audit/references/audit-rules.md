# Route Audit Rules

## What the Checker Proves

The script reads Peaks-owned routes linked to summit destinations. It reports
four record types:

- `scope`: confirms how many routes and summits were checked.
- `route`: checks one stored route and its materialized segments.
- `pair`: compares two routes linked to the same summit.
- `selection`: shows the route chosen by the current list API order.

`ERROR` means a stored contract or strong geometry invariant failed. `WARN`
means the line or links need review. `REVIEW` means sources must settle route
identity or default-route choice. `INFO` records expected facts such as two
named trailheads far apart.

## Route Checks

The script reports errors for:

- a missing, invalid, short, or self-crossing line;
- missing source records or invalid source fields;
- no source segment, repeated segment ordinals, a segment gap over 100 m, or a
  materialized route more than 30 m from its segments;
- route and segment source records that differ;
- no ordered destinations, a first destination that is not a trailhead, a last
  destination that is not a summit, or endpoint gaps over 300 m and 250 m;
- missing distance or gain values; and
- a flat stored elevation line paired with material elevation gain.

It warns about smaller route/segment drift, measured distance or segment-stat
drift, missing shape or polyline, point jumps over 250 m, repeated destination
ordinals, and a summit elevation mismatch over 100 m.

These thresholds match the current import and approval contracts where one
exists. Re-read the live importer before changing a threshold.

## Pair Checks

`probable_duplicate_routes` means both lines stay within 30 m of each other for
at least 95 percent of their length and start within 300 m. Do not keep both
active without a clear route-identity reason.

`route_pair_weaves` means the lines cross at least three times, remain within 30
m for at least 500 m, and do not share that path exactly. This often means two
independent traces represent the same trail. Prefer one reviewed source line or
shared segments. Do not average the traces.

`route_pair_crosses` means the lines cross inside their endpoints but do not
meet the weave rule. Check whether the crossing is a real junction, route
variant, bridge, switchback, or bad geometry.

`unexplained_start_separation` means starts are over 1 km apart while at least
one route lacks a trailhead link or both name the same trailhead. Fix the link or
route line after source review. `distinct_trailheads` is information, not a
failure.

Exact shared line length and close overlap are different. Exact shared geometry
shows segment reuse. Close overlap without exact reuse can produce the visible
criss-cross pattern that this audit is meant to catch.

## Default Route Check

At the time this skill was written, `cloud-sql/api/src/routes/lists.ts` selects
an active Peaks-owned route by:

1. linked session count, descending;
2. one-way distance, ascending; then
3. route id, ascending.

That order measures use, not route class or whether a route is the accepted
normal ascent. When a summit has several active routes, research the accepted
normal route. A technical snow, ski, scramble, or climbing line must not become
the default merely because it has more linked sessions.

## Repair Rules

- Keep valid distinct approaches and link each to its real trailhead.
- Rebuild legacy routes that have no source record or source segments. Do not
  invent provenance after the fact.
- When two routes share a real trail, reuse reviewed segments so the app draws
  one line on that section.
- Keep the old active route until a reviewed replacement is ready. Publish the
  replacement and mark the old route superseded in one controlled transaction.
- Preserve existing session and plan links to superseded routes.
- Never copy another user's trace or change its owner without direct permission
  and a source-rights review.
- Re-run this catalog audit and the source-specific approval after every repair.
