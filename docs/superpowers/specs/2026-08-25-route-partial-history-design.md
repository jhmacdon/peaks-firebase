# Route Partial History — Design

**Date:** 2026-08-25
**Status:** Approved (designed interactively with Josiah; sections 1 and 2 approved in conversation)
**Repos:** peaks-firebase (server), Peaks-iOS (client)

## Problem

A user who hiked part of a route's trail — e.g. 2.7 of the Hoh River Trail's 18 miles, turning
around at Mineral Creek Falls — gets no acknowledgment of that when they open the route's
detail page. `RouteDetailView` shows no personal data at all. The server's `session_routes`
table computes real coverage (`matched_points / total_points`, 30 m vertex tolerance) but only
writes a row at ≥ 70% coverage, so a partial approach hike produces nothing; the table is also
only queryable session→routes, never route→my-sessions, and the one endpoint returning
`coverage` has zero iOS callers.

Companion change already shipped: peak "Your Activity" gating (Peaks-iOS PR #240) stopped
partial approach hikes from rendering as climbs of the peak. This feature gives that hike its
correct home: the route page.

## Decision summary

- **Server is the single computer of truth** (option B). No client-side geometry engine.
- **Client caches the server's answer** for offline reads. No dual compute, no reconciliation.
  Accepted gap: a session recorded offline appears on the route page only after server
  processing — consistent with everything else server-derived.
- **Display:** a "Your History" section on `RouteDetailView` plus a covered-stretch tint on
  the elevation profile.

## Section 1: Server (peaks-firebase, `cloud-sql/`)

### Schema

`session_routes` gains one column:

```sql
ALTER TABLE session_routes ADD COLUMN covered_intervals JSONB;
```

- Value: array of `[start, end]` pairs, fractions of the route linestring in `[0, 1]`,
  sorted, non-overlapping. Example: `[[0, 0.15]]`.
- Intervals are merged with a gap tolerance: bridge gaps under **100 m or 2% of route
  length, whichever is larger**, so GPS dropouts don't shred one hike into fragments.
- `NULL` = legacy row (pre-backfill). Consumers treat a `NULL` on a ≥ 0.70 row as
  "whole route" for display purposes.
- Scalar `coverage` stays and keeps its meaning (fraction of route vertices within 30 m
  of the session track).

### Write gate (`matchRoutes` in `cloud-sql/api/src/processing.ts`)

Current: write only when `coverage >= 0.70`.
New: write when **covered route length ≥ 500 m OR coverage ≥ 0.70**.

- The 500 m floor mirrors the iOS corridor engine's sanity floor
  (`MountainAttribution.minimumCorridorMeters`): a drive past a trailhead writes nothing.
- The OR keeps completions of routes shorter than ~700 m.
- Vertex tolerance stays 30 m. Covered length = sum of interval spans × route length.

### Consumer audit (must land in the same change as the gate)

Existing readers assume a `session_routes` row means "did this route." Preserve that:

1. `cloud-sql/api/src/routes/lists.ts` (~88–93): community "best route" popularity
   `COUNT(*)` → add `WHERE coverage >= 0.70`.
2. `cloud-sql/api/src/routes/sessions.ts`: `SESSION_ROUTES_SQL` (session-detail `routes`
   array) and `GET /api/sessions/:id/routes` → filter `coverage >= 0.70`.

Partial rows are read only by the new endpoint. A test pins each filter.

### New endpoint

`GET /api/routes/:id/sessions/mine` — authenticated (same auth middleware as other
user-scoped reads).

- Returns the **requesting user's** sessions matched to this route, newest first:

```json
[
  {
    "sessionId": "…",
    "coverage": 0.15,
    "coveredIntervals": [[0, 0.15]],
    "startDate": 1746200000
  }
]
```

- Unauthenticated → 401. No other user's data is ever returned.
- `startDate` is the session's start epoch seconds (BIGINT — see iOS parsing rule).

### Backfill and refresh

- One-time batch job re-running the route match over historical sessions to write partial
  rows and populate `covered_intervals` on all rows (including existing ≥ 0.70 rows).
  Batched; idempotent; runs via the established cloud-sql proxy pattern. **Running it
  against prod is a separate, explicitly confirmed step — not part of code review.**
- Whenever a route's materialized geometry is recomputed (segment change), its
  `session_routes` rows must be rematched — stale intervals would highlight the wrong
  stretch. Hook this where `routes.path` recompute already happens.
- Cost: one-time reprocess; no new always-on infrastructure. ~$0/month recurring.

## Section 2: iOS (Peaks-iOS)

### Data layer

- `PeaksAPI.routeMySessions(routeId:completion:)` → `[RouteSessionCoverage]`, a value
  struct: `sessionId: String`, `coverage: Double`, `intervals: [(Double, Double)]`,
  `startDate: Date?`.
- **All numerics parse through the `asInt`/`asDouble`-style safe helpers** (BIGINT rule —
  never bare `as? Int`/`as? Double` on JSON; three shipped bugs of that shape).
- On success, the response persists to a small Core Data record keyed by route id
  (alongside the cached `Route`). Offline opens render from that record. Core Data access
  follows repo rules: `makeBackgroundContext()`, value-type snapshots across queues,
  Combine publisher delivering on main.

### "Your History" section on `RouteDetailView`

Placement: directly after the route's title/stats row (personal activity high on the page,
per house order). Design system: muted `.headline` secondary header on the page background,
one `peaksSectionContainer()`, flat interior, hairline dividers, monospaced digits, middot
sublines, no boxed stats.

States:

- **Partial** (no session ≥ 0.70): headline "2.7 mi · 15% of this route" — *unique route
  ground covered*, the union of all sessions' intervals. Percent-plus-miles deliberately
  sidesteps the out-and-back ×2 display rule: unique ground is honest regardless of
  direction. When the route's own destination timeline (already on the screen) has a stop
  inside the covered stretch, append the furthest one: "to Mineral Creek Falls".
- **Completed** (any session ≥ 0.70): "Completed · May 2, 2026", with "×N" appended for
  repeats. 0.70 matches the server's established route-done semantic (turnaround/GPS
  shave tolerance).
- Beneath the headline: one hairline row per matched session, newest first, capped at 3 —
  date + that session's stats, tappable → session detail.

### Elevation profile highlight

The union of covered intervals tints the region under the existing elevation curve across
those stretches — Peaks teal, low-opacity fill, narrow pale edge, per accent-restraint
rules. Overlay only: no chart reflow, axes and geometry untouched.

### Absent states

Signed out, no matched sessions, endpoint error, or offline with no cache → the section
does not render at all. No placeholder that later collapses (the yank-the-page-up bug the
climb rail guards against). Mirrors the Trip Reports async-load pattern on the same screen.

### Testing

- **Server:** interval merge + gap-tolerance unit tests; write-gate floor tests (short
  clip → no row; 500 m partial → row; short-route completion → row); consumer-filter
  regression tests (lists popularity, session routes); endpoint auth test (401 unauth,
  only own sessions).
- **iOS:** parsing tests including numeric-safety shapes (string-encoded BIGINT, Double,
  NSNumber); view-model tests for interval union, state selection (partial / completed /
  ×N), landmark pick, and cap-at-3; a `route_history_snapshot` debug action
  (`-debugVariant partial|completed|multi|hidden`, fixture-fed, no network) following the
  `route_trailhead_snapshot` precedent.

## Out of scope

- Client-side coverage computation (revisit only if the processing-lag gap ever hurts).
- Linking the peak sheet's "via <landmark>" pill to the route entity.
- Surfacing history on the route rail cards ("N routes here" pager) — route detail only.
- Web surfaces (the endpoint makes them possible later).
