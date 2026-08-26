# Route Partial History — Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the server record and serve *which stretch* of a route a recording covered, so a partial hike of a long trail gets a row and an honest answer instead of nothing.

**Architecture:** `session_routes` gains a `covered_intervals JSONB` column. Route matching still measures vertex coverage in PostGIS, but now also returns each covered vertex's distance along the route; a pure TypeScript module merges those into `[start, end]` fractions with a gap tolerance and applies the new write gate. Every existing reader of `session_routes` gains a filter so a row still means "did this route" for them; one new authenticated endpoint reads the partial rows.

**Tech Stack:** TypeScript 5, Node 20, Express 4, PostgreSQL 15 + PostGIS (geography), `pg` 8, Node's built-in test runner (`node --test`) with `supertest`, Next.js 16 server actions (web admin).

**Spec:** `docs/superpowers/specs/2026-08-25-route-partial-history-design.md` — this plan implements **Section 1: Server**. Section 2 (iOS) is a separate plan in the Peaks-iOS repo.

## Global Constraints

Copied from the spec; every task's requirements implicitly include these.

- Vertex tolerance stays **30 m** (fraction of route vertices within 30 m of the session track).
- Write gate: write when **covered route length ≥ 500 m OR coverage ≥ 0.70**.
- Gap tolerance when merging intervals: bridge gaps under **100 m or 2% of route length, whichever is larger**.
- `covered_intervals` value: array of `[start, end]` pairs, fractions of the route linestring in `[0, 1]`, sorted, non-overlapping. Example: `[[0, 0.15]]`.
- `NULL` `covered_intervals` = legacy row (pre-backfill). Consumers treat a `NULL` on a ≥ 0.70 row as "whole route" for display.
- Scalar `coverage` keeps its meaning and stays.
- Consumer audit **must land in the same change as the gate**: existing readers assume a `session_routes` row means "did this route" — preserve that.
- `GET /api/routes/:id/sessions/mine` is authenticated, returns the requesting user's sessions newest first, unauthenticated → 401, no other user's data ever.
- **Running the backfill against prod is a separate, explicitly confirmed step — not part of code review, and no task in this plan runs it.**
- Cost: one-time reprocess; no new always-on infrastructure. **~$0/month recurring.**

Repo constraints that bind this work:

- `covered_intervals` is `JSONB`, not `BIGINT`/`NUMERIC` — no new wire-type parser needed. `EXTRACT(EPOCH ...)::bigint` in the new endpoint is covered by the existing global `types.setTypeParser(20, parseInt)` in `cloud-sql/api/src/db.ts`. Do not remove or move that parser.
- No background timers. Rematching after a route-geometry change piggybacks on the existing Cloud Scheduler → `POST /internal/sweep` request window.
- Schema objects are owned by `postgres`; migrations run as `postgres` and are applied by hand (CI does not run them).
- Tests never touch production: the DB-backed suites run only when `TEST_DATABASE_URL` names a database ending in `_test`.

## Decisions this plan locks in

The spec leaves four things open. Each is resolved here, with the reasoning, so no task has to re-decide it.

1. **Fractions are of route *length*, not vertex count.** The spec says "Covered length = sum of interval spans × route length", which only holds for length fractions. So the SQL returns each vertex's cumulative metres along the route and TypeScript divides by the route's own summed length.
2. **The merge runs in TypeScript, not SQL.** PostGIS measures (the expensive part); a pure module merges. This follows `comparison-geometry.ts` ("NO database access in this file — everything operates on plain arrays so it is unit-testable and shared verbatim by processSession, the backfill script, and the legs recompute script"), and it gives the spec's "interval merge + gap-tolerance unit tests" a home that needs no database.
3. **The consumer filter is `coverage IS NULL OR coverage >= 0.7`, not `coverage >= 0.7`.** A manually attached route (`PUT /api/sessions/:id` with `routeIds`) and every row the Firestore migration wrote have `coverage` NULL. A bare `>= 0.70` would delete those from session detail — a live regression on rows the user asserted themselves. `NULL` means "did this route" today and must keep meaning it.
4. **The consumer audit covers nine files, not two.** The spec names `lists.ts` and `sessions.ts`. `grep -rE "(FROM|JOIN) session_routes"` over `cloud-sql/api/src` and `web/src` finds seven more that carry the same "did this route" assumption — `trip-reports.ts` in the API, and `routes.ts`, `sessions.ts`, `public-sessions.ts`, `search.ts`, `areas.ts` and `trip-reports.ts` in the web app (ten reads between them). The spec's stated principle is "Existing readers assume a `session_routes` row means 'did this route.' Preserve that", and these are existing readers; leaving them out ships a public session page that calls a 15% approach hike a completed route on the day the gate lands. Tasks 3 and 4 cover them, and Task 4 adds a cross-reference guard that *discovers* readers so the next one cannot be missed.

## File structure

**New files**

| File | Responsibility |
|---|---|
| `cloud-sql/migrations/20260825_session_route_covered_intervals.sql` | Add the column to an existing database. |
| `cloud-sql/api/src/route-coverage.ts` | What a `session_routes` row means: interval merge, gap tolerance, covered length, write gate, and the "did this route" SQL predicate. Pure — no DB. |
| `cloud-sql/api/src/__tests__/route-coverage.test.ts` | Unit tests for the above. |
| `cloud-sql/api/src/__tests__/session-route-covered-intervals-migration.test.ts` | Pins the migration text and the live column. |
| `cloud-sql/api/src/__tests__/route-coverage-sql.test.ts` | Unit tests for `buildRouteCoverageSql`'s shape. |
| `cloud-sql/api/src/__tests__/route-coverage-gate.test.ts` | DB-backed write-gate floor tests through `processSession`. |
| `cloud-sql/api/src/__tests__/route-consumer-filters.test.ts` | Pins the filter on every API consumer. |
| `cloud-sql/api/src/__tests__/route-my-sessions-endpoint.test.ts` | Auth, ownership, ordering and shape of the new endpoint. |
| `cloud-sql/api/scripts/backfill-route-coverage.ts` | Batched, idempotent historical recompute. Never run against prod here. |
| `cloud-sql/api/src/__tests__/backfill-route-coverage-script.test.ts` | Pins the script's safety properties. |
| `web/src/lib/route-coverage.ts` | The web copy of the same predicate (separate npm package; kept byte-identical by a cross-ref check). |
| `web/src/lib/route-coverage.test.ts` | Unit test for the web copy. |
| `web/src/lib/route-consumer-filters.test.ts` | Pins the filter on every web consumer. |
| `web/src/lib/route-rematch-hook.test.ts` | Pins the rematch queued after a route-geometry recompute. |

**Modified files**

| File | Change |
|---|---|
| `cloud-sql/schema.sql:1352-1358` | `covered_intervals JSONB` on `session_routes`. |
| `cloud-sql/api/src/processing.ts:270-324` | `buildRouteCoverageSql`, `measureSessionRouteCoverage`, `upsertSessionRouteCoverage`, new `matchRoutes`. |
| `cloud-sql/api/src/routes/lists.ts:96-97` | Popularity `COUNT(*)` filter. |
| `cloud-sql/api/src/routes/sessions.ts:80-92, 963-975` | `SESSION_ROUTES_SQL` and `GET /:id/routes` filters. |
| `cloud-sql/api/src/routes/trip-reports.ts:288-295` | `trip_report_routes` derivation filter. |
| `cloud-sql/api/src/routes/routes.ts:103-104` | New `GET /:id/sessions/mine`. |
| `cloud-sql/api/package.json:16` | `backfill:route-coverage` script. |
| `web/src/lib/actions/routes.ts:246-252, 1016-1023, 1053-1060` | Popularity count + own-history filters. |
| `web/src/lib/actions/sessions.ts:378-387` | Session detail routes filter. |
| `web/src/lib/actions/public-sessions.ts:137-146` | Public session routes filter. |
| `web/src/lib/actions/search.ts:540-556, 641-652` | Route popularity ordering filters. |
| `web/src/lib/actions/areas.ts:306-310` | Area route session count filter. |
| `web/src/lib/actions/trip-reports.ts:370-376` | `trip_report_routes` derivation filter. |
| `web/src/lib/actions/segment-matcher.ts:836-882` | Queue affected recordings for rematch after a geometry recompute. |
| `scripts/check-cross-refs.sh:110-118` | Two new invariants, before the final error tally. |
| `cloud-sql/CLAUDE.md:177-197` | Endpoint table + a note on the column. |

## Running the tests

Every task's test commands assume these. The Cloud SQL Auth Proxy must be running:

```bash
cloud-sql-proxy donner-a8608:us-central1:peaks-db --port 5432
```

Provision the test database once (safe to repeat):

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history
export CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.14
ADMIN_DATABASE_URL="postgres://postgres:$(gcloud secrets versions access latest --secret=peaks-db-postgres-password)@127.0.0.1:5432/peaks_test" \
  ./cloud-sql/test-db/provision.sh
```

Then, for any DB-backed run:

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
export TEST_DATABASE_URL="postgres://peaks_test:$(gcloud secrets versions access latest --secret=peaks-test-db-password)@127.0.0.1:5432/peaks_test"
npm run test:db
```

`npm test` (no database) runs the same files with the DB-backed ones skipped.

---

### Task 1: The `covered_intervals` column

**Files:**
- Create: `cloud-sql/migrations/20260825_session_route_covered_intervals.sql`
- Modify: `cloud-sql/schema.sql:1352-1358`
- Test: `cloud-sql/api/src/__tests__/session-route-covered-intervals-migration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `session_routes.covered_intervals JSONB NULL` — every later task reads or writes it.

- [x] **Step 1: Write the failing test**

Create `cloud-sql/api/src/__tests__/session-route-covered-intervals-migration.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "node:test";
import db from "../db";
import { dbSkipReason as skipReason } from "./helpers/test-db";

const migration = readFileSync(
  resolve(__dirname, "../../../migrations/20260825_session_route_covered_intervals.sql"),
  "utf8"
);

test("the migration adds covered_intervals without rewriting session_routes", () => {
  assert.match(migration, /ALTER TABLE session_routes/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS covered_intervals JSONB/);
  // A NOT NULL or a DEFAULT would rewrite every row on a db-f1-micro.
  assert.doesNotMatch(migration, /covered_intervals JSONB[^;]*NOT NULL/);
  assert.doesNotMatch(migration, /covered_intervals JSONB[^;]*DEFAULT/);
  // Nothing here drops or rewrites the existing coverage column.
  assert.doesNotMatch(migration, /DROP COLUMN/);
  assert.doesNotMatch(migration, /UPDATE session_routes/);
});

test("schema.sql carries the same column so provisioning matches production", () => {
  const schema = readFileSync(resolve(__dirname, "../../../schema.sql"), "utf8");
  const table = schema.slice(
    schema.indexOf("CREATE TABLE session_routes"),
    schema.indexOf("CREATE TABLE trip_reports")
  );
  assert.match(table, /covered_intervals\s+JSONB/);
});

describe("session_routes.covered_intervals", { skip: skipReason ?? undefined }, () => {
  test("exists as a nullable jsonb column", async () => {
    const result = await db.query(
      `SELECT data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'session_routes' AND column_name = 'covered_intervals'`
    );
    assert.equal(result.rows.length, 1, "covered_intervals column is missing");
    assert.equal(result.rows[0].data_type, "jsonb");
    assert.equal(result.rows[0].is_nullable, "YES");
  });
});
```

- [x] **Step 2: Run the test and watch it fail**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
NODE_ENV=test node --test --import tsx \
  src/__tests__/session-route-covered-intervals-migration.test.ts
```

Expected: FAIL — `ENOENT: no such file or directory, open '.../20260825_session_route_covered_intervals.sql'`.

- [x] **Step 3: Write the migration**

Create `cloud-sql/migrations/20260825_session_route_covered_intervals.sql`:

```sql
-- Route Partial History: a session_routes row can now describe a STRETCH of a
-- route rather than the whole thing, so each row records which stretch.
--
-- covered_intervals is an array of [start, end] pairs — fractions of the route
-- linestring in [0, 1], sorted and non-overlapping, merged with a gap tolerance
-- of max(100 m, 2% of route length) so a GPS dropout does not shred one hike
-- into fragments. NULL means the row predates this column; a consumer treats
-- NULL on a coverage >= 0.70 row as the whole route.
--
-- Nullable with no default, so on Postgres 11+ this is a catalog-only change:
-- no table rewrite, no lock held while rows are touched. No new index — every
-- read is already keyed by (session_id, route_id) (the primary key) or by
-- route_id (idx_session_routes_route). A few MB of disk on the existing
-- instance: $0/month recurring.
--
-- Apply manually as postgres (CI does not run migrations):
--   psql -h 127.0.0.1 -U postgres -d peaks \
--     -f cloud-sql/migrations/20260825_session_route_covered_intervals.sql

BEGIN;

ALTER TABLE session_routes
    ADD COLUMN IF NOT EXISTS covered_intervals JSONB;

COMMIT;
```

- [x] **Step 4: Add the column to the baseline schema**

In `cloud-sql/schema.sql`, replace the `session_routes` table definition:

```sql
CREATE TABLE session_routes (
    session_id      TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
    route_id        TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
    coverage        DOUBLE PRECISION,
    PRIMARY KEY (session_id, route_id)
);
```

with:

```sql
CREATE TABLE session_routes (
    session_id      TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
    route_id        TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
    coverage        DOUBLE PRECISION,
    -- Which stretch of the route the recording covered: [[start, end], ...]
    -- fractions of the route linestring in [0, 1], sorted and non-overlapping.
    -- NULL = written before the column existed (see
    -- migrations/20260825_session_route_covered_intervals.sql).
    covered_intervals JSONB,
    PRIMARY KEY (session_id, route_id)
);
```

- [x] **Step 5: Re-provision the test database and run the test**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history
export CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.14
ADMIN_DATABASE_URL="postgres://postgres:$(gcloud secrets versions access latest --secret=peaks-db-postgres-password)@127.0.0.1:5432/peaks_test" \
  ./cloud-sql/test-db/provision.sh
cd cloud-sql/api
export TEST_DATABASE_URL="postgres://peaks_test:$(gcloud secrets versions access latest --secret=peaks-test-db-password)@127.0.0.1:5432/peaks_test"
NODE_ENV=test node --test --import tsx \
  src/__tests__/session-route-covered-intervals-migration.test.ts
```

Expected: PASS, 3 tests. The provision run must apply the new migration, not skip it — the skip list in `provision.sh` must not gain an entry, because a migration that fails on top of `schema.sql` is a real conflict between the two.

- [x] **Step 6: Commit**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history
git add cloud-sql/migrations/20260825_session_route_covered_intervals.sql \
        cloud-sql/schema.sql \
        cloud-sql/api/src/__tests__/session-route-covered-intervals-migration.test.ts
git commit -m "feat(db): record which stretch of a route a session covered

Adds session_routes.covered_intervals (nullable JSONB). Catalog-only
change on Postgres 11+, no table rewrite, no new index. \$0/month."
```

---

### Task 2: The coverage module — merge, gate, predicate

**Files:**
- Create: `cloud-sql/api/src/route-coverage.ts`
- Test: `cloud-sql/api/src/__tests__/route-coverage.test.ts`

**Interfaces:**
- Consumes: Task 1's column (as the destination for `RouteMatch.covered_intervals`).
- Produces:
  - `ROUTE_VERTEX_TOLERANCE_M = 30`
  - `ROUTE_DONE_COVERAGE = 0.7`
  - `ROUTE_PARTIAL_MIN_COVERED_M = 500`
  - `GAP_TOLERANCE_MIN_M = 100`, `GAP_TOLERANCE_ROUTE_FRAC = 0.02`
  - `gapToleranceMeters(routeLengthM: number): number`
  - `mergeCoveredIntervals(coveredAlongM: number[], routeLengthM: number): Array<[number, number]>`
  - `coveredLengthMeters(intervals: Array<[number, number]>, routeLengthM: number): number`
  - `meetsRouteWriteGate(coverage: number, coveredM: number): boolean`
  - `interface RouteCoverageRow { route_id: string; length_m: number | null; total_points: number; matched_points: number; covered_along_m: number[] | null }`
  - `interface RouteMatch { route_id: string; coverage: number; covered_intervals: Array<[number, number]> }`
  - `selectRouteMatches(rows: RouteCoverageRow[]): RouteMatch[]`
  - `routeDoneCoverageSql(alias: string): string`

- [x] **Step 1: Write the failing tests**

Create `cloud-sql/api/src/__tests__/route-coverage.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  GAP_TOLERANCE_MIN_M,
  ROUTE_DONE_COVERAGE,
  ROUTE_PARTIAL_MIN_COVERED_M,
  ROUTE_VERTEX_TOLERANCE_M,
  coveredLengthMeters,
  gapToleranceMeters,
  meetsRouteWriteGate,
  mergeCoveredIntervals,
  routeDoneCoverageSql,
  selectRouteMatches,
} from "../route-coverage";

/** Distances along a route of vertices spaced `spacingM` apart, 0 through `throughM`. */
function everyMetres(spacingM: number, throughM: number): number[] {
  const out: number[] = [];
  for (let m = 0; m <= throughM; m += spacingM) out.push(m);
  return out;
}

test("the spec's constants are what the module uses", () => {
  assert.equal(ROUTE_VERTEX_TOLERANCE_M, 30);
  assert.equal(ROUTE_DONE_COVERAGE, 0.7);
  assert.equal(ROUTE_PARTIAL_MIN_COVERED_M, 500);
  assert.equal(GAP_TOLERANCE_MIN_M, 100);
});

test("gap tolerance is the larger of 100 m and 2% of route length", () => {
  // 2% of 1 km = 20 m, so the 100 m floor wins.
  assert.equal(gapToleranceMeters(1_000), 100);
  // 2% of 5 km = 100 m — the crossover.
  assert.equal(gapToleranceMeters(5_000), 100);
  // 2% of 29 km = 580 m, so the proportional term wins.
  assert.equal(gapToleranceMeters(29_000), 580);
  assert.equal(gapToleranceMeters(0), 100);
});

test("a contiguous run of covered vertices becomes one interval", () => {
  // A 10 km route with a vertex every 100 m; the first 1.5 km covered.
  const intervals = mergeCoveredIntervals(everyMetres(100, 1_500), 10_000);
  assert.deepEqual(intervals, [[0, 0.15]]);
});

test("a gap under the tolerance is bridged", () => {
  // 10 km route → tolerance = max(100, 200) = 200 m. The 150 m gap bridges.
  const intervals = mergeCoveredIntervals([0, 100, 250, 400], 10_000);
  assert.deepEqual(intervals, [[0, 0.04]]);
});

test("a gap over the tolerance splits the intervals", () => {
  // 10 km route → tolerance 200 m. The 800 m gap does not bridge.
  const intervals = mergeCoveredIntervals([0, 200, 1_000, 1_200], 10_000);
  assert.deepEqual(intervals, [[0, 0.02], [0.1, 0.12]]);
});

test("the tolerance floor bridges a 90 m dropout on a short route", () => {
  // 2 km route → 2% = 40 m, floor 100 m wins, so a 90 m dropout bridges.
  const intervals = mergeCoveredIntervals([0, 10, 100, 110], 2_000);
  assert.deepEqual(intervals, [[0, 0.055]]);
});

test("an isolated covered vertex contributes no interval", () => {
  // 10 km route, tolerance 200 m: the lone vertex at 5000 stands alone and has
  // zero length, so it is dropped rather than published as [0.5, 0.5].
  const intervals = mergeCoveredIntervals([0, 100, 5_000], 10_000);
  assert.deepEqual(intervals, [[0, 0.01]]);
});

test("no covered vertices and a zero-length route produce no intervals", () => {
  assert.deepEqual(mergeCoveredIntervals([], 10_000), []);
  assert.deepEqual(mergeCoveredIntervals([0, 100], 0), []);
});

test("a fully covered route ends at exactly 1", () => {
  // 90 m route, tolerance floor 100 m, every vertex covered.
  assert.deepEqual(mergeCoveredIntervals([0, 30, 60, 90], 90), [[0, 1]]);
});

test("fractions are rounded to six places", () => {
  assert.deepEqual(mergeCoveredIntervals([0, 1], 3), [[0, 0.333333]]);
});

test("covered length is the interval spans scaled by route length", () => {
  assert.equal(coveredLengthMeters([[0, 0.15]], 10_000), 1_500);
  // Binary fractions do not sum exactly, so compare within a millimetre.
  assert.ok(
    Math.abs(coveredLengthMeters([[0, 0.1], [0.5, 0.6]], 10_000) - 2_000) < 1e-3
  );
  assert.equal(coveredLengthMeters([], 10_000), 0);
});

test("the write gate takes 500 m of covered route OR 70% coverage", () => {
  // Drive past a trailhead: 200 m covered of a long route.
  assert.equal(meetsRouteWriteGate(0.02, 200), false);
  // Approach hike: 2.7 mi of an 18 mi trail.
  assert.equal(meetsRouteWriteGate(0.15, 4_345), true);
  // Exactly at the floor.
  assert.equal(meetsRouteWriteGate(0.01, 500), true);
  // A completed 400 m route: under the metre floor, over the coverage floor.
  assert.equal(meetsRouteWriteGate(1, 400), true);
  assert.equal(meetsRouteWriteGate(0.7, 100), true);
  assert.equal(meetsRouteWriteGate(0.69, 100), false);
});

test("selectRouteMatches applies the gate and shapes the write", () => {
  const matches = selectRouteMatches([
    {
      // 10 km route, vertex every 100 m, the first 1.5 km covered.
      route_id: "long-trail",
      length_m: 10_000,
      total_points: 101,
      matched_points: 16,
      covered_along_m: everyMetres(100, 1_500),
    },
    {
      // The same route, 200 m at the trailhead: a drive-by, not a hike.
      route_id: "drive-by",
      length_m: 10_000,
      total_points: 101,
      matched_points: 3,
      covered_along_m: everyMetres(100, 200),
    },
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].route_id, "long-trail");
  assert.equal(matches[0].coverage, 16 / 101);
  assert.deepEqual(matches[0].covered_intervals, [[0, 0.15]]);
});

test("selectRouteMatches skips rows a route can never honestly answer for", () => {
  const matches = selectRouteMatches([
    { route_id: "no-length", length_m: 0, total_points: 10, matched_points: 10, covered_along_m: [0] },
    { route_id: "no-points", length_m: 1_000, total_points: 0, matched_points: 0, covered_along_m: null },
    { route_id: "null-length", length_m: null, total_points: 10, matched_points: 10, covered_along_m: [0] },
  ]);
  assert.deepEqual(matches, []);
});

test("the did-this-route predicate keeps NULL coverage rows", () => {
  assert.equal(routeDoneCoverageSql("sr"), "(sr.coverage IS NULL OR sr.coverage >= 0.7)");
  assert.equal(routeDoneCoverageSql("x"), "(x.coverage IS NULL OR x.coverage >= 0.7)");
});
```

- [x] **Step 2: Run the tests and watch them fail**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
NODE_ENV=test node --test --import tsx src/__tests__/route-coverage.test.ts
```

Expected: FAIL — `Cannot find module '../route-coverage'`.

- [x] **Step 3: Write the module**

Create `cloud-sql/api/src/route-coverage.ts`:

```ts
// What a session_routes row means, and how a recording's track becomes one.
//
// NO database access in this file — everything operates on plain arrays, so
// the interval merge and the write gate are unit-testable without a database
// and are shared verbatim by processSession and the backfill script. The
// PostGIS half (measuring which route vertices the track came within
// ROUTE_VERTEX_TOLERANCE_M of, and how far along the route each one sits)
// lives in buildRouteCoverageSql in processing.ts.
//
// Design doc: docs/superpowers/specs/2026-08-25-route-partial-history-design.md

/** A route vertex within this many metres of the session track counts as covered. */
export const ROUTE_VERTEX_TOLERANCE_M = 30;

/**
 * Coverage at or above this fraction means the recording did the whole route.
 *
 * Two jobs, deliberately one constant: it is the OR branch of the write gate
 * that keeps completions of very short routes, and it is the cutoff every
 * existing reader uses to decide a row still means "did this route"
 * (routeDoneCoverageSql below). They must never drift apart.
 */
export const ROUTE_DONE_COVERAGE = 0.7;

/**
 * A recording that covered at least this much of a route's length earns a row
 * even when the fraction is small. Mirrors the iOS corridor engine's sanity
 * floor (MountainAttribution.minimumCorridorMeters): a drive past a trailhead
 * writes nothing, an approach hike writes a partial row.
 */
export const ROUTE_PARTIAL_MIN_COVERED_M = 500;

/** Gaps shorter than this never split an interval, however short the route. */
export const GAP_TOLERANCE_MIN_M = 100;
/** ...and on a long route the tolerance grows with it. */
export const GAP_TOLERANCE_ROUTE_FRAC = 0.02;

/** Fractions are stored to this many decimals — sub-metre on a 100 km route. */
const FRACTION_DECIMALS = 6;

/**
 * Bridge gaps under 100 m or 2% of route length, whichever is larger, so a GPS
 * dropout does not shred one continuous hike into fragments.
 */
export function gapToleranceMeters(routeLengthM: number): number {
  const proportional = Number.isFinite(routeLengthM) ? routeLengthM * GAP_TOLERANCE_ROUTE_FRAC : 0;
  return Math.max(GAP_TOLERANCE_MIN_M, proportional);
}

function roundFraction(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  const scale = 10 ** FRACTION_DECIMALS;
  return Math.round(clamped * scale) / scale;
}

/**
 * Merge the distances-along-route of covered vertices into [start, end]
 * fractions of the route linestring.
 *
 * `coveredAlongM` must be ascending — buildRouteCoverageSql aggregates it in
 * vertex order and distance along a linestring is non-decreasing in that order.
 *
 * A run that starts and ends on the same vertex covers no ground, so it is
 * dropped rather than published as a zero-width [f, f]: a lone vertex within
 * 30 m of the track, with no neighbour inside the gap tolerance, is noise, and
 * a client cannot tint a stretch of zero length.
 */
export function mergeCoveredIntervals(
  coveredAlongM: number[],
  routeLengthM: number
): Array<[number, number]> {
  if (!Number.isFinite(routeLengthM) || routeLengthM <= 0) return [];
  if (coveredAlongM.length === 0) return [];

  const tolerance = gapToleranceMeters(routeLengthM);
  const runs: Array<[number, number]> = [];
  for (const along of coveredAlongM) {
    if (!Number.isFinite(along)) continue;
    const last = runs[runs.length - 1];
    if (last && along - last[1] <= tolerance) {
      last[1] = along;
    } else {
      runs.push([along, along]);
    }
  }

  return runs
    .map(([start, end]): [number, number] => [
      roundFraction(start / routeLengthM),
      roundFraction(end / routeLengthM),
    ])
    .filter(([start, end]) => end > start);
}

/** How much of the route's length the intervals actually cover, in metres. */
export function coveredLengthMeters(
  intervals: Array<[number, number]>,
  routeLengthM: number
): number {
  return intervals.reduce((sum, [start, end]) => sum + (end - start) * routeLengthM, 0);
}

/**
 * Write a session_routes row when the recording covered at least
 * ROUTE_PARTIAL_MIN_COVERED_M of the route, OR when it covered at least
 * ROUTE_DONE_COVERAGE of its vertices. The OR keeps completions of routes
 * shorter than about 700 m, which the metre floor alone would drop.
 */
export function meetsRouteWriteGate(coverage: number, coveredM: number): boolean {
  return coveredM >= ROUTE_PARTIAL_MIN_COVERED_M || coverage >= ROUTE_DONE_COVERAGE;
}

/** One measured (session, route) pair, straight from buildRouteCoverageSql. */
export interface RouteCoverageRow {
  route_id: string;
  /** Route length in metres, summed over its own vertices. */
  length_m: number | null;
  total_points: number;
  matched_points: number;
  /** Distance along the route, in metres, of each covered vertex. Ascending. */
  covered_along_m: number[] | null;
}

/** One row to write to session_routes. */
export interface RouteMatch {
  route_id: string;
  coverage: number;
  covered_intervals: Array<[number, number]>;
}

/** Apply the write gate to a batch of measurements and shape the rows to write. */
export function selectRouteMatches(rows: RouteCoverageRow[]): RouteMatch[] {
  const matches: RouteMatch[] = [];
  for (const row of rows) {
    const total = Number(row.total_points);
    const lengthM = Number(row.length_m ?? 0);
    if (!Number.isFinite(total) || total <= 0) continue;
    if (!Number.isFinite(lengthM) || lengthM <= 0) continue;

    const coverage = Number(row.matched_points) / total;
    const intervals = mergeCoveredIntervals(row.covered_along_m ?? [], lengthM);
    if (!meetsRouteWriteGate(coverage, coveredLengthMeters(intervals, lengthM))) continue;

    matches.push({ route_id: row.route_id, coverage, covered_intervals: intervals });
  }
  return matches;
}

/**
 * SQL predicate for "this session_routes row means the user did this route".
 *
 * A NULL coverage is kept on purpose. Manually attached routes (PUT
 * /api/sessions/:id with routeIds) and every row the Firestore migration wrote
 * carry NULL, and they meant "did this route" long before coverage existed.
 * Only the new partial rows carry a non-NULL value below ROUTE_DONE_COVERAGE.
 *
 * `alias` is always a literal written in this repo's own SQL, never user input.
 */
export function routeDoneCoverageSql(alias: string): string {
  return `(${alias}.coverage IS NULL OR ${alias}.coverage >= ${ROUTE_DONE_COVERAGE})`;
}
```

- [x] **Step 4: Run the tests and watch them pass**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
NODE_ENV=test node --test --import tsx src/__tests__/route-coverage.test.ts
```

Expected: PASS, 15 tests.

- [x] **Step 5: Typecheck and lint**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
npm run typecheck && npm run lint
```

Expected: both clean.

- [x] **Step 6: Commit**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history
git add cloud-sql/api/src/route-coverage.ts \
        cloud-sql/api/src/__tests__/route-coverage.test.ts
git commit -m "feat(api): add the route coverage interval merge and write gate"
```

---

### Task 3: Consumer filters in the Cloud Run API

Nothing writes a partial row yet, so every change here is a no-op against today's data — which is exactly what makes it reviewable on its own. It must land before the gate loosens.

**Files:**
- Modify: `cloud-sql/api/src/routes/lists.ts:96-97`
- Modify: `cloud-sql/api/src/routes/sessions.ts:80-92, 963-975`
- Modify: `cloud-sql/api/src/routes/trip-reports.ts:288-295`
- Test: `cloud-sql/api/src/__tests__/route-consumer-filters.test.ts`
- Test: `cloud-sql/api/src/__tests__/list-destinations-enrichment.test.ts` (extend)

**Interfaces:**
- Consumes: `routeDoneCoverageSql` from Task 2.
- Produces: nothing new; three query strings that carry the predicate.

- [x] **Step 1: Write the failing test**

Create `cloud-sql/api/src/__tests__/route-consumer-filters.test.ts`:

```ts
// Every API reader of session_routes assumed a row meant "did this route".
// Partial rows break that assumption, so each reader filters. These tests are
// the pins: a reader that loses its filter starts counting approach hikes as
// completions of the route.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { buildListDestinationsQuery } from "../routes/lists";
import { SESSION_ROUTES_SQL } from "../routes/sessions";
import { routeDoneCoverageSql } from "../route-coverage";

test("list popularity counts only routes the session actually did", () => {
  const { text } = buildListDestinationsQuery("cascade-volcanoes");
  assert.match(text, /FROM session_routes sr/);
  assert.ok(
    text.includes(routeDoneCoverageSql("sr")),
    "the best-route popularity COUNT must carry the did-this-route predicate"
  );
});

test("session detail lists only routes the session actually did", () => {
  assert.ok(
    SESSION_ROUTES_SQL.includes(routeDoneCoverageSql("sr")),
    "SESSION_ROUTES_SQL must carry the did-this-route predicate"
  );
});

test("GET /api/sessions/:id/routes carries the same predicate", () => {
  const source = readFileSync(resolve(__dirname, "../routes/sessions.ts"), "utf8");
  const handler = source.slice(
    source.indexOf("// GET /api/sessions/:id/routes"),
    source.indexOf("// GET /api/sessions/:id/comparisons/:otherId")
  );
  assert.ok(
    handler.includes("routeDoneCoverageSql(\"sr\")"),
    "the routes endpoint must carry the did-this-route predicate"
  );
});

test("a trip report links only routes the activity actually did", () => {
  const source = readFileSync(resolve(__dirname, "../routes/trip-reports.ts"), "utf8");
  const derive = source.slice(
    source.indexOf("async function deriveLinks"),
    source.indexOf("async function reportById")
  );
  assert.match(derive, /INSERT INTO trip_report_routes/);
  assert.ok(
    derive.includes("routeDoneCoverageSql(\"sr\")"),
    "trip report route links must carry the did-this-route predicate"
  );
});
```

- [x] **Step 2: Run the test and watch it fail**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
NODE_ENV=test node --test --import tsx src/__tests__/route-consumer-filters.test.ts
```

Expected: FAIL — four tests, each reporting a missing predicate.

- [x] **Step 3: Filter the list popularity count**

In `cloud-sql/api/src/routes/lists.ts`, add the import under `import db from "../db";`:

```ts
import { routeDoneCoverageSql } from "../route-coverage";
```

Then replace, inside `buildListDestinationsQuery`:

```ts
              (SELECT COUNT(*) FROM session_routes sr
                WHERE sr.route_id = r.id) AS session_count
```

with:

```ts
              (SELECT COUNT(*) FROM session_routes sr
                WHERE sr.route_id = r.id
                  AND ${routeDoneCoverageSql("sr")}) AS session_count
```

- [x] **Step 4: Filter the two session readers**

In `cloud-sql/api/src/routes/sessions.ts`, add to the import from `../processing`'s neighbourhood — put this line directly after `import db from "../db";`:

```ts
import { routeDoneCoverageSql } from "../route-coverage";
```

Replace the `WHERE` inside `SESSION_ROUTES_SQL`:

```ts
  WHERE sr.session_id = s.id
    AND r.status IN ('active', 'superseded')),
```

with:

```ts
  WHERE sr.session_id = s.id
    AND ${routeDoneCoverageSql("sr")}
    AND r.status IN ('active', 'superseded')),
```

Then replace the `GET /:id/routes` query:

```ts
    `SELECT r.id, r.name, r.polyline6,
            r.distance, r.gain, r.gain_loss, r.provenance,
            sr.source, sr.coverage
     FROM routes r
     JOIN session_routes sr ON sr.route_id = r.id
     JOIN tracking_sessions s ON s.id = sr.session_id
     WHERE sr.session_id = $1
       AND (s.user_id = $2 OR s.is_public = true)
       AND r.status IN ('active', 'superseded')`,
```

with:

```ts
    `SELECT r.id, r.name, r.polyline6,
            r.distance, r.gain, r.gain_loss, r.provenance,
            sr.source, sr.coverage
     FROM routes r
     JOIN session_routes sr ON sr.route_id = r.id
     JOIN tracking_sessions s ON s.id = sr.session_id
     WHERE sr.session_id = $1
       AND ${routeDoneCoverageSql("sr")}
       AND (s.user_id = $2 OR s.is_public = true)
       AND r.status IN ('active', 'superseded')`,
```

- [x] **Step 5: Filter the trip-report link derivation**

In `cloud-sql/api/src/routes/trip-reports.ts`, add after `import db from "../db";`:

```ts
import { routeDoneCoverageSql } from "../route-coverage";
```

Replace, inside `deriveLinks`:

```ts
    `INSERT INTO trip_report_routes (report_id, route_id)
     SELECT $1, sr.route_id
     FROM session_routes sr
     JOIN routes r ON r.id = sr.route_id
     WHERE sr.session_id = $2 AND r.status = 'active'
     ON CONFLICT DO NOTHING`,
```

with:

```ts
    `INSERT INTO trip_report_routes (report_id, route_id)
     SELECT $1, sr.route_id
     FROM session_routes sr
     JOIN routes r ON r.id = sr.route_id
     WHERE sr.session_id = $2
       AND ${routeDoneCoverageSql("sr")}
       AND r.status = 'active'
     ON CONFLICT DO NOTHING`,
```

- [x] **Step 6: Extend the existing list-enrichment test**

In `cloud-sql/api/src/__tests__/list-destinations-enrichment.test.ts`, replace:

```ts
  assert.match(query.text, /session_routes/);
```

with:

```ts
  assert.match(query.text, /session_routes/);
  // A partial-coverage row is not a climb of the route — see route-coverage.ts.
  assert.match(query.text, /sr\.coverage IS NULL OR sr\.coverage >= 0\.7/);
```

- [x] **Step 7: Run the tests and watch them pass**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
export TEST_DATABASE_URL="postgres://peaks_test:$(gcloud secrets versions access latest --secret=peaks-test-db-password)@127.0.0.1:5432/peaks_test"
npm run test:db
```

Expected: the whole suite passes. `trip-reports-endpoints.test.ts` in particular still passes — its fixture route is stored at `coverage = 0.92`, so the new filter keeps it.

- [x] **Step 8: Typecheck, lint and commit**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
npm run typecheck && npm run lint
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history
git add cloud-sql/api/src/routes/lists.ts \
        cloud-sql/api/src/routes/sessions.ts \
        cloud-sql/api/src/routes/trip-reports.ts \
        cloud-sql/api/src/__tests__/route-consumer-filters.test.ts \
        cloud-sql/api/src/__tests__/list-destinations-enrichment.test.ts
git commit -m "feat(api): keep partial route rows out of did-this-route reads"
```

---

### Task 4: Consumer filters in the web app, and a guard that finds the next one

**Files:**
- Create: `web/src/lib/route-coverage.ts`
- Create: `web/src/lib/route-coverage.test.ts`
- Create: `web/src/lib/route-consumer-filters.test.ts`
- Modify: `web/src/lib/actions/routes.ts:246-252, 1016-1023, 1053-1060`
- Modify: `web/src/lib/actions/sessions.ts:378-387`
- Modify: `web/src/lib/actions/public-sessions.ts:137-146`
- Modify: `web/src/lib/actions/search.ts:540-556, 641-652`
- Modify: `web/src/lib/actions/areas.ts:306-310`
- Modify: `web/src/lib/actions/trip-reports.ts:370-376`
- Modify: `scripts/check-cross-refs.sh`

**Interfaces:**
- Consumes: the same predicate text as Task 2's `routeDoneCoverageSql`.
- Produces: `web/src/lib/route-coverage.ts` exporting `ROUTE_DONE_COVERAGE` and `routeDoneCoverageSql(alias: string): string`, byte-identical to the API's definitions.

- [x] **Step 1: Write the failing tests**

Create `web/src/lib/route-coverage.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { ROUTE_DONE_COVERAGE, routeDoneCoverageSql } from "./route-coverage";

test("the web predicate matches the API's, NULL coverage included", () => {
  assert.equal(ROUTE_DONE_COVERAGE, 0.7);
  assert.equal(routeDoneCoverageSql("sr"), "(sr.coverage IS NULL OR sr.coverage >= 0.7)");
});
```

Create `web/src/lib/route-consumer-filters.test.ts`:

```ts
// Every web reader of session_routes assumed a row meant "did this route".
// Partial rows break that assumption. These are the pins.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const libDir = fileURLToPath(new URL(".", import.meta.url));
const read = (file: string) => readFileSync(join(libDir, "actions", file), "utf8");

const READERS = [
  "routes.ts",
  "sessions.ts",
  "public-sessions.ts",
  "search.ts",
  "areas.ts",
  "trip-reports.ts",
];

test("every web action that reads session_routes carries the predicate", () => {
  for (const file of READERS) {
    const source = read(file);
    assert.match(source, /(FROM|JOIN) session_routes/, `${file} should still read session_routes`);
    assert.match(
      source,
      /routeDoneCoverageSql/,
      `${file} reads session_routes without the did-this-route predicate`
    );
  }
});

test("each web read carries its own predicate call", () => {
  const counts: Record<string, number> = {
    "routes.ts": 3,
    "sessions.ts": 1,
    "public-sessions.ts": 1,
    "search.ts": 3,
    "areas.ts": 1,
    "trip-reports.ts": 1,
  };
  for (const [file, expected] of Object.entries(counts)) {
    const uses = read(file).match(/routeDoneCoverageSql\(/g) ?? [];
    assert.equal(uses.length, expected, `${file} should call the predicate ${expected} time(s)`);
  }
});
```

- [x] **Step 2: Run the tests and watch them fail**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/web
node --test --import tsx src/lib/route-coverage.test.ts src/lib/route-consumer-filters.test.ts
```

Expected: FAIL — `Cannot find module './route-coverage'`.

- [x] **Step 3: Write the web predicate module**

Create `web/src/lib/route-coverage.ts`:

```ts
// What a session_routes row means, for the web app's queries.
//
// A sync module, not a server action: "use server" files may export only async
// functions, so shared SQL fragments live here alongside search-sql.ts.
//
// This is a deliberate copy of the same two definitions in
// cloud-sql/api/src/route-coverage.ts — the two packages share no code — and
// scripts/check-cross-refs.sh fails the build if the bodies ever differ.

export const ROUTE_DONE_COVERAGE = 0.7;
export function routeDoneCoverageSql(alias: string): string {
  return `(${alias}.coverage IS NULL OR ${alias}.coverage >= ${ROUTE_DONE_COVERAGE})`;
}
```

- [x] **Step 4: Filter the three reads in `web/src/lib/actions/routes.ts`**

Add to the imports, directly after `import { extractSubPoints } from "../segment-geometry";`:

```ts
import { routeDoneCoverageSql } from "../route-coverage";
```

Replace, in `getRouteSessionCount`:

```ts
    `SELECT COUNT(*)::int AS count
     FROM session_routes sr
     ${publicJoin}
     WHERE sr.route_id = $1${publicFilter}`,
```

with:

```ts
    `SELECT COUNT(*)::int AS count
     FROM session_routes sr
     ${publicJoin}
     WHERE sr.route_id = $1
       AND ${routeDoneCoverageSql("sr")}${publicFilter}`,
```

Replace, in `getUserRouteHistory`:

```ts
    `SELECT ts.id AS session_id, ts.start_time, ts.total_time
     FROM session_routes sr
     JOIN tracking_sessions ts ON ts.id = sr.session_id
     WHERE sr.route_id = $1 AND ts.user_id = $2
     ORDER BY ts.start_time ASC`,
```

with:

```ts
    `SELECT ts.id AS session_id, ts.start_time, ts.total_time
     FROM session_routes sr
     JOIN tracking_sessions ts ON ts.id = sr.session_id
     WHERE sr.route_id = $1 AND ts.user_id = $2
       AND ${routeDoneCoverageSql("sr")}
     ORDER BY ts.start_time ASC`,
```

Replace, in `getUserRouteHistoryBatch`:

```ts
    `SELECT sr.route_id, ts.id AS session_id, ts.start_time, ts.total_time
     FROM session_routes sr
     JOIN tracking_sessions ts ON ts.id = sr.session_id
     WHERE sr.route_id = ANY($1::text[]) AND ts.user_id = $2
     ORDER BY ts.start_time ASC`,
```

with:

```ts
    `SELECT sr.route_id, ts.id AS session_id, ts.start_time, ts.total_time
     FROM session_routes sr
     JOIN tracking_sessions ts ON ts.id = sr.session_id
     WHERE sr.route_id = ANY($1::text[]) AND ts.user_id = $2
       AND ${routeDoneCoverageSql("sr")}
     ORDER BY ts.start_time ASC`,
```

Then update the stale comment above `getUserRouteHistory` — replace:

```ts
 * A route can be matched to a session either 'manual' (no coverage
 * recorded) or 'auto' (coverage ~0.7-1 in production); both count as a real
 * attempt; there's no principled coverage cutoff that wouldn't also drop
 * legitimate manual matches, which never set coverage at all.
```

with:

```ts
 * A route can be matched to a session either 'manual' (no coverage
 * recorded) or 'auto'. Both count as a real attempt, which is why the cutoff
 * keeps NULL coverage — see routeDoneCoverageSql. What it does drop is the
 * partial rows added in 2026-08 for the route page's "Your History": a 15%
 * approach hike is real ground covered but it is not an attempt at the route.
```

- [x] **Step 5: Filter the session readers**

In `web/src/lib/actions/sessions.ts`, add after `import db from "../db";`:

```ts
import { routeDoneCoverageSql } from "../route-coverage";
```

Replace:

```ts
    `SELECT r.id, r.name, r.polyline6, r.distance, r.gain, r.provenance
     FROM session_routes sr
     JOIN routes r ON r.id = sr.route_id
     JOIN tracking_sessions ts ON ts.id = sr.session_id
     WHERE sr.session_id = $1
       AND (ts.user_id = $2 OR ts.is_public = true)
       AND r.status IN ('active', 'superseded')
     ORDER BY r.name ASC NULLS LAST`,
```

with:

```ts
    `SELECT r.id, r.name, r.polyline6, r.distance, r.gain, r.provenance
     FROM session_routes sr
     JOIN routes r ON r.id = sr.route_id
     JOIN tracking_sessions ts ON ts.id = sr.session_id
     WHERE sr.session_id = $1
       AND ${routeDoneCoverageSql("sr")}
       AND (ts.user_id = $2 OR ts.is_public = true)
       AND r.status IN ('active', 'superseded')
     ORDER BY r.name ASC NULLS LAST`,
```

In `web/src/lib/actions/public-sessions.ts`, add after `import db from "../db";`:

```ts
import { routeDoneCoverageSql } from "../route-coverage";
```

Replace:

```ts
        `SELECT r.id, r.name, r.polyline6, r.distance, r.gain, r.provenance
         FROM session_routes sr
         JOIN routes r ON r.id = sr.route_id
         JOIN tracking_sessions ts ON ts.id = sr.session_id
         WHERE sr.session_id = $1 AND ts.is_public = true
           AND r.status IN ('active', 'superseded')
         ORDER BY r.name ASC NULLS LAST`,
```

with:

```ts
        `SELECT r.id, r.name, r.polyline6, r.distance, r.gain, r.provenance
         FROM session_routes sr
         JOIN routes r ON r.id = sr.route_id
         JOIN tracking_sessions ts ON ts.id = sr.session_id
         WHERE sr.session_id = $1 AND ts.is_public = true
           AND ${routeDoneCoverageSql("sr")}
           AND r.status IN ('active', 'superseded')
         ORDER BY r.name ASC NULLS LAST`,
```

- [x] **Step 6: Filter the search and area popularity counts**

In `web/src/lib/actions/search.ts`, add after `import db from "../db";`:

```ts
import { routeDoneCoverageSql } from "../route-coverage";
```

Replace:

```ts
            (SELECT COUNT(*) FROM session_routes sr WHERE sr.route_id = r.id)::int AS session_count
     FROM routes r
     WHERE r.owner = 'peaks'
       AND r.status = 'active'
       AND r.name ILIKE $1
     ORDER BY
       CASE WHEN r.name ILIKE $2 THEN 0 ELSE 1 END,
       (SELECT COUNT(*) FROM session_routes sr WHERE sr.route_id = r.id) DESC,
```

with:

```ts
            (SELECT COUNT(*) FROM session_routes sr
              WHERE sr.route_id = r.id
                AND ${routeDoneCoverageSql("sr")})::int AS session_count
     FROM routes r
     WHERE r.owner = 'peaks'
       AND r.status = 'active'
       AND r.name ILIKE $1
     ORDER BY
       CASE WHEN r.name ILIKE $2 THEN 0 ELSE 1 END,
       (SELECT COUNT(*) FROM session_routes sr
         WHERE sr.route_id = r.id
           AND ${routeDoneCoverageSql("sr")}) DESC,
```

Replace:

```ts
     LEFT JOIN session_routes sr ON sr.route_id = r.id
```

with (the predicate belongs in the JOIN, not a WHERE, or the LEFT JOIN collapses to an inner one):

```ts
     LEFT JOIN session_routes sr ON sr.route_id = r.id
       AND ${routeDoneCoverageSql("sr")}
```

In `web/src/lib/actions/areas.ts`, add after `import db from "../db";`:

```ts
import { routeDoneCoverageSql } from "../route-coverage";
```

Replace:

```ts
              (
                SELECT count(*)::int
                FROM session_routes sr
                WHERE sr.route_id = r.id
              ) AS session_count
```

with:

```ts
              (
                SELECT count(*)::int
                FROM session_routes sr
                WHERE sr.route_id = r.id
                  AND ${routeDoneCoverageSql("sr")}
              ) AS session_count
```

- [x] **Step 7: Filter the web trip-report link derivation**

In `web/src/lib/actions/trip-reports.ts`, add after `import db from "../db";`:

```ts
import { routeDoneCoverageSql } from "../route-coverage";
```

Replace:

```ts
      `INSERT INTO trip_report_routes (report_id, route_id)
       SELECT $1, sr.route_id FROM session_routes sr
       JOIN routes r ON r.id = sr.route_id
       WHERE sr.session_id = $2 AND r.status = 'active'`,
```

with:

```ts
      `INSERT INTO trip_report_routes (report_id, route_id)
       SELECT $1, sr.route_id FROM session_routes sr
       JOIN routes r ON r.id = sr.route_id
       WHERE sr.session_id = $2
         AND ${routeDoneCoverageSql("sr")}
         AND r.status = 'active'`,
```

- [x] **Step 8: Run the web tests, build and lint**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/web
npm test
npm run build && npm run lint
```

Expected: tests pass (including the two new files), build and lint clean.

- [x] **Step 9: Add the two cross-reference invariants**

In `scripts/check-cross-refs.sh`, insert immediately before the final `if [ "$errors" -gt 0 ]; then` block:

```bash
# The "did this route" predicate: the API and the web app are separate npm
# packages and cannot share a module, so each has its own copy. Both bodies
# must be byte-identical or a partial route row means one thing on iOS and
# another on the web.
api_predicate="cloud-sql/api/src/route-coverage.ts"
web_predicate="web/src/lib/route-coverage.ts"
if [ -f "$api_predicate" ] && [ -f "$web_predicate" ]; then
  api_body="$(sed -n '/^export function routeDoneCoverageSql/,/^}/p' "$api_predicate")"
  web_body="$(sed -n '/^export function routeDoneCoverageSql/,/^}/p' "$web_predicate")"
  api_const="$(grep '^export const ROUTE_DONE_COVERAGE' "$api_predicate" || true)"
  web_const="$(grep '^export const ROUTE_DONE_COVERAGE' "$web_predicate" || true)"
  if [ -z "$api_body" ] || [ -z "$api_const" ] \
     || [ "$api_body" != "$web_body" ] || [ "$api_const" != "$web_const" ]; then
    echo "ERROR: routeDoneCoverageSql or ROUTE_DONE_COVERAGE differs between" >&2
    echo "       $api_predicate and $web_predicate. Keep them identical." >&2
    errors=$((errors + 1))
  fi
fi

# session_routes readers: a row used to mean "did this route" and now can mean
# "covered a stretch of it". Naming the known readers is not enough — the
# design doc's own audit named two of the nine — so DISCOVER them: every
# non-test file that SELECTs from or JOINs session_routes must apply
# routeDoneCoverageSql, or be allowlisted with a reason. DELETE statements are
# not reads and are excluded.
route_readers=$(
  grep -rn --include="*.ts" -E "(FROM|JOIN) session_routes" \
    cloud-sql/api/src web/src 2>/dev/null \
    | grep -v "__tests__" \
    | grep -v "\.test\.ts:" \
    | grep -v "DELETE FROM session_routes" \
    | cut -d: -f1 | sort -u
)

# Readers that legitimately do NOT filter. Every entry needs a reason.
route_reader_allowlist=()

for reader in $route_readers; do
  allowed=0
  for entry in ${route_reader_allowlist[@]+"${route_reader_allowlist[@]}"}; do
    if [ "$reader" = "$entry" ]; then allowed=1; fi
  done

  if [ "$allowed" -eq 1 ]; then
    if grep -q "routeDoneCoverageSql" "$reader" 2>/dev/null; then
      echo "ERROR: $reader is in route_reader_allowlist but already applies" >&2
      echo "       routeDoneCoverageSql — stale allowlist entry, remove it." >&2
      errors=$((errors + 1))
    fi
    continue
  fi

  if ! grep -q "routeDoneCoverageSql" "$reader" 2>/dev/null; then
    echo "ERROR: $reader reads session_routes but never applies" >&2
    echo "       routeDoneCoverageSql. A partial-coverage row is not a climb" >&2
    echo "       of the route. Add the predicate, or add $reader to" >&2
    echo "       route_reader_allowlist in $0 with the reason it reads raw." >&2
    errors=$((errors + 1))
  fi
done
```

- [x] **Step 10: Run the cross-reference checks**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history
./scripts/check-cross-refs.sh
```

Expected: `Cross-refs OK`.

- [x] **Step 11: Commit**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history
git add web/src/lib/route-coverage.ts \
        web/src/lib/route-coverage.test.ts \
        web/src/lib/route-consumer-filters.test.ts \
        web/src/lib/actions/routes.ts \
        web/src/lib/actions/sessions.ts \
        web/src/lib/actions/public-sessions.ts \
        web/src/lib/actions/search.ts \
        web/src/lib/actions/areas.ts \
        web/src/lib/actions/trip-reports.ts \
        scripts/check-cross-refs.sh
git commit -m "feat(web): keep partial route rows out of did-this-route reads

Adds a cross-reference check that discovers session_routes readers rather
than naming them, so the next one cannot be missed."
```

---

### Task 5: The write gate — partial rows and covered intervals

**Files:**
- Modify: `cloud-sql/api/src/processing.ts:280-324`
- Test: `cloud-sql/api/src/__tests__/route-coverage-sql.test.ts`
- Test: `cloud-sql/api/src/__tests__/route-coverage-gate.test.ts`

**Interfaces:**
- Consumes: `RouteCoverageRow`, `RouteMatch`, `selectRouteMatches`, `ROUTE_VERTEX_TOLERANCE_M` from Task 2; `session_routes.covered_intervals` from Task 1.
- Produces:
  - `buildRouteCoverageSql(sessionId: string, routeIds: string[]): { text: string; values: unknown[] }`
  - `measureSessionRouteCoverage(q: RowQueryable, sessionId: string): Promise<RouteMatch[]>`
  - `upsertSessionRouteCoverage(q: RowQueryable, sessionId: string, matches: RouteMatch[]): Promise<number>`
  - `interface RowQueryable { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> }`

- [x] **Step 1: Write the failing SQL-shape test**

Create `cloud-sql/api/src/__tests__/route-coverage-sql.test.ts`:

```ts
// Phase 2 of route matching. It measures three things per candidate route:
// how many vertices lie within 30 m of the track, how far along the route each
// covered vertex sits, and the route's own length. The merge into intervals
// happens in route-coverage.ts, not here. Pure builder, no live DB.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildRouteCoverageSql } from "../processing";

test("coverage SQL measures vertices against the session's stored track", () => {
  const { text, values } = buildRouteCoverageSql("sess1", ["route-a", "route-b"]);
  assert.match(text, /FROM tracking_sessions s WHERE s\.id = \$1/);
  assert.match(text, /ST_DumpPoints\(r\.path::geometry\)/);
  assert.match(text, /ST_DWithin\(rp\.pt::geography, st\.track, 30\)/);
  assert.deepEqual(values, ["sess1", ["route-a", "route-b"]]);
});

test("coverage SQL returns distance along the route for every covered vertex", () => {
  const { text } = buildRouteCoverageSql("sess1", ["route-a"]);
  // Cumulative metres from the previous vertex, in vertex order.
  assert.match(text, /lag\(rp\.pt\) OVER \(PARTITION BY rp\.route_id ORDER BY rp\.idx\)/);
  assert.match(text, /ST_Distance\(pt::geography, prev_pt::geography, false\)/);
  assert.match(text, /ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW/);
  assert.match(text, /array_agg\(along_m ORDER BY idx\) FILTER \(WHERE covered\)/);
  assert.match(text, /MAX\(along_m\) AS length_m/);
  assert.match(text, /COUNT\(\*\) FILTER \(WHERE covered\) AS matched_points/);
});

test("coverage SQL applies no gate of its own", () => {
  const { text } = buildRouteCoverageSql("sess1", ["route-a"]);
  // The 0.70 cutoff moved into selectRouteMatches; leaving one here too would
  // silently re-impose the old behaviour on partial rows.
  assert.doesNotMatch(text, /0\.70/);
  assert.doesNotMatch(text, /INSERT INTO/);
});
```

- [x] **Step 2: Write the failing gate test**

Create `cloud-sql/api/src/__tests__/route-coverage-gate.test.ts`:

```ts
// The write gate's floors, end to end through processSession against a live
// database. Fixtures use a fixed metres-per-degree of latitude so the intended
// lengths are readable in the test rather than derived from geodesy; that puts
// them about 0.1% off PostGIS's own measure, which is why the partial
// assertion below is a range rather than an exact fraction.
//
// Every fixture sits on the same meridian on purpose, so a session is a
// candidate for every route created before it. Each assertion reads one
// (session, route) pair, so the extra rows that produces are harmless.

import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import db from "../db";
import { processSession } from "../processing";
import { dbSkipReason as skipReason } from "./helpers/test-db";

const prefix = `route-gate-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const user = `${prefix}-user`;

// One degree of latitude is ~111_320 m; longitude is held constant so every
// fixture line runs due north and its length is exactly metres / 111_320.
const M_PER_DEG = 111_320;
const BASE_LAT = 47;
const BASE_LNG = -121.5;

function lineWkt(fromM: number, toM: number, steps: number): string {
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const m = fromM + ((toM - fromM) * i) / steps;
    points.push(`${BASE_LNG} ${BASE_LAT + m / M_PER_DEG} 1000`);
  }
  return `SRID=4326;LINESTRING Z (${points.join(", ")})`;
}

async function makeRoute(id: string, lengthM: number, steps: number): Promise<void> {
  await db.query(
    `INSERT INTO routes (id, name, status, path)
     VALUES ($1, $2, 'active', ST_GeogFromText($3))`,
    [id, id, lineWkt(0, lengthM, steps)]
  );
}

/** A session whose track runs from `fromM` to `toM` along the same line. */
async function makeSession(id: string, fromM: number, toM: number, steps: number): Promise<void> {
  await db.query(
    `INSERT INTO tracking_sessions (id, user_id, start_time, ended, processing_state)
     VALUES ($1, $2, '2026-05-02T15:00:00Z', true, 'pending')`,
    [id, user]
  );
  for (let i = 0; i <= steps; i++) {
    const m = fromM + ((toM - fromM) * i) / steps;
    await db.query(
      `INSERT INTO tracking_points (session_id, time, location, segment_number)
       VALUES ($1, $2, ST_GeogFromText($3), 0)`,
      [
        id,
        1_746_200_000 + i * 60,
        `SRID=4326;POINT Z (${BASE_LNG} ${BASE_LAT + m / M_PER_DEG} 1000)`,
      ]
    );
  }
}

async function storedRow(sessionId: string, routeId: string) {
  const result = await db.query(
    `SELECT coverage, covered_intervals FROM session_routes
     WHERE session_id = $1 AND route_id = $2`,
    [sessionId, routeId]
  );
  return result.rows[0] ?? null;
}

async function cleanup(): Promise<void> {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id = $1`, [user]);
  await db.query(`DELETE FROM routes WHERE id LIKE $1`, [`${prefix}-%`]);
}

describe("route write gate", { skip: skipReason ?? undefined }, () => {
  before(cleanup);
  after(cleanup);

  test("a short clip of a long route writes no row", async () => {
    const route = `${prefix}-long`;
    const session = `${prefix}-clip`;
    await makeRoute(route, 10_000, 100);          // 10 km, a vertex every 100 m
    await makeSession(session, 0, 200, 20);       // 200 m covered
    await processSession(session, user);
    assert.equal(await storedRow(session, route), null, "200 m must not earn a row");
  });

  test("a 500 m partial writes a row with the covered stretch", async () => {
    const route = `${prefix}-partial-route`;
    const session = `${prefix}-partial`;
    await makeRoute(route, 10_000, 100);
    await makeSession(session, 0, 1_500, 60);     // 1.5 km of a 10 km route
    await processSession(session, user);
    const row = await storedRow(session, route);
    assert.ok(row, "1.5 km of a 10 km route must earn a row");
    assert.ok(row.coverage < 0.7, `expected a partial coverage, got ${row.coverage}`);
    assert.equal(row.covered_intervals.length, 1);
    assert.equal(row.covered_intervals[0][0], 0);
    assert.ok(
      row.covered_intervals[0][1] > 0.12 && row.covered_intervals[0][1] < 0.18,
      `expected the first ~15% of the route, got ${JSON.stringify(row.covered_intervals)}`
    );
  });

  test("a completed short route writes a row despite the metre floor", async () => {
    const route = `${prefix}-short-route`;
    const session = `${prefix}-short`;
    await makeRoute(route, 400, 20);              // 400 m, under the 500 m floor
    await makeSession(session, 0, 400, 40);       // walked end to end
    await processSession(session, user);
    const row = await storedRow(session, route);
    assert.ok(row, "a completed 400 m route must earn a row via the coverage floor");
    assert.equal(row.coverage, 1);
    assert.deepEqual(row.covered_intervals, [[0, 1]]);
  });

  test("re-processing is idempotent", async () => {
    const session = `${prefix}-partial`;
    const route = `${prefix}-partial-route`;
    const first = await storedRow(session, route);
    assert.ok(first, "the partial test above must have run first");
    await processSession(session, user, { force: true });
    assert.deepEqual(await storedRow(session, route), first);
  });
});
```

- [x] **Step 3: Run both tests and watch them fail**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
export TEST_DATABASE_URL="postgres://peaks_test:$(gcloud secrets versions access latest --secret=peaks-test-db-password)@127.0.0.1:5432/peaks_test"
NODE_ENV=test node --test --import tsx \
  src/__tests__/route-coverage-sql.test.ts \
  src/__tests__/route-coverage-gate.test.ts
```

Expected: FAIL — `buildRouteCoverageSql is not a function`, and the gate tests report `null` rows for the partial cases.

- [x] **Step 4: Add the coverage builder and helpers to `processing.ts`**

In `cloud-sql/api/src/processing.ts`, add to the imports after `import { matchComparisons } from "./comparisons";`:

```ts
import {
  ROUTE_VERTEX_TOLERANCE_M,
  selectRouteMatches,
  type RouteCoverageRow,
  type RouteMatch,
} from "./route-coverage";
```

Add, directly after the existing `interface Queryable` block:

```ts
/**
 * Row-returning query interface, so the coverage helpers accept the pool
 * (`db`), a transaction client (`PoolClient`), or a stub in tests.
 */
interface RowQueryable {
  query: (
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: unknown[]; rowCount: number | null }>;
}
```

Then replace the whole of `matchRoutes` (the doc comment and the function) with:

```ts
/**
 * Build the Phase-2 coverage measurement for a session against candidate routes.
 *
 * Returns one row per candidate route with:
 *  - `length_m`    the route's own length, summed vertex to vertex
 *  - `total_points` / `matched_points` — the coverage fraction's numerator and
 *    denominator, unchanged in meaning from the pre-2026-08 query
 *  - `covered_along_m` — how far along the route each covered vertex sits
 *
 * Distance along the route is summed here rather than taken from
 * ST_LineLocatePoint, which is O(n) per vertex and so O(n²) per route, and
 * rather than from planar degrees, which over-weights east-west stretches by
 * 1/cos(latitude) — 47% at 47°N — and would tint the wrong part of the profile.
 * `ST_Distance(..., false)` measures on the sphere instead of the spheroid:
 * about 0.1% off, immaterial against a 500 m floor, and much cheaper. Using the
 * summed length (rather than ST_Length or routes.distance) keeps fractions and
 * metres exactly consistent with each other.
 *
 * No gate here. The merge and the gate live in route-coverage.ts so they are
 * unit-testable without a database.
 *
 * Pure builder so its shape is unit-testable without a live DB.
 */
export function buildRouteCoverageSql(
  sessionId: string,
  routeIds: string[]
): { text: string; values: unknown[] } {
  return {
    text: `WITH session_track AS (
        SELECT s.path AS track FROM tracking_sessions s WHERE s.id = $1
    ),
    route_points AS (
        SELECT sub.route_id,
               (sub.dp).path[1] AS idx,
               (sub.dp).geom AS pt
        FROM (
          SELECT r.id AS route_id, ST_DumpPoints(r.path::geometry) AS dp
          FROM routes r
          WHERE r.id = ANY($2::text[])
        ) sub
    ),
    stepped AS (
        SELECT rp.route_id, rp.idx, rp.pt,
               lag(rp.pt) OVER (PARTITION BY rp.route_id ORDER BY rp.idx) AS prev_pt,
               ST_DWithin(rp.pt::geography, st.track, ${ROUTE_VERTEX_TOLERANCE_M}) AS covered
        FROM route_points rp, session_track st
    ),
    measured AS (
        SELECT route_id, idx, covered,
               SUM(
                 CASE WHEN prev_pt IS NULL THEN 0
                      ELSE ST_Distance(pt::geography, prev_pt::geography, false)
                 END
               ) OVER (PARTITION BY route_id ORDER BY idx
                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS along_m
        FROM stepped
    )
    SELECT route_id,
           MAX(along_m) AS length_m,
           COUNT(*) AS total_points,
           COUNT(*) FILTER (WHERE covered) AS matched_points,
           COALESCE(
             array_agg(along_m ORDER BY idx) FILTER (WHERE covered),
             ARRAY[]::double precision[]
           ) AS covered_along_m
    FROM measured
    GROUP BY route_id`,
    values: [sessionId, routeIds],
  };
}

/**
 * Measure one session against every active route near its track and return the
 * rows that clear the write gate. Read-only — the caller decides how to write,
 * because processSession and the backfill script differ on conflicts.
 */
export async function measureSessionRouteCoverage(
  q: RowQueryable,
  sessionId: string
): Promise<RouteMatch[]> {
  const candidateSql = buildRouteCandidateSql(sessionId);
  const candidates = await q.query(candidateSql.text, candidateSql.values);
  if (candidates.rows.length === 0) return [];

  const candidateIds = (candidates.rows as Array<{ id: string }>).map((r) => r.id);
  const coverageSql = buildRouteCoverageSql(sessionId, candidateIds);
  const measured = await q.query(coverageSql.text, coverageSql.values);
  return selectRouteMatches(measured.rows as RouteCoverageRow[]);
}

/**
 * Refresh coverage and covered_intervals on rows that already exist, adding any
 * that do not. Only 'auto' rows are updated: a 'manual' row is the user saying
 * they did this route, and overwriting its NULL coverage with a measured 0.15
 * would delete their own claim from session detail.
 *
 * Used by scripts/backfill-route-coverage.ts. processSession does NOT use it —
 * it clears its 'auto' rows first, so DO NOTHING is the right conflict there.
 */
export async function upsertSessionRouteCoverage(
  q: RowQueryable,
  sessionId: string,
  matches: RouteMatch[]
): Promise<number> {
  if (matches.length === 0) return 0;
  const result = await q.query(
    `INSERT INTO session_routes (session_id, route_id, source, coverage, covered_intervals)
     SELECT $1::text, m.route_id, 'auto', m.coverage, m.covered_intervals
     FROM jsonb_to_recordset($2::jsonb)
       AS m(route_id text, coverage double precision, covered_intervals jsonb)
     ON CONFLICT (session_id, route_id) DO UPDATE
       SET coverage = EXCLUDED.coverage,
           covered_intervals = EXCLUDED.covered_intervals
       WHERE session_routes.source = 'auto'`,
    [sessionId, JSON.stringify(matches)]
  );
  return result.rowCount ?? 0;
}

/**
 * Match routes the session followed using two phases:
 * 1. Find candidate routes near the session's stored linestring (planar
 *    superset — see buildRouteCandidateSql).
 * 2. Measure each candidate (buildRouteCoverageSql), merge the covered vertices
 *    into intervals and apply the write gate (route-coverage.ts): a row is
 *    written when at least 500 m of the route was covered OR coverage reached
 *    0.70. Before 2026-08 the gate was 0.70 alone, so an approach hike of a
 *    long trail produced nothing at all.
 *
 * Reads tracking_sessions.path (set by processSession Step 0) so both phases
 * run as indexed lookups instead of rebuilding the line per query. Step 1 of
 * processSession has already deleted this session's 'auto' rows, so the
 * conflict clause only guards rows the user attached by hand.
 */
async function matchRoutes(client: PoolClient, sessionId: string): Promise<number> {
  const matches = await measureSessionRouteCoverage(client, sessionId);
  if (matches.length === 0) return 0;

  const result = await client.query(
    `INSERT INTO session_routes (session_id, route_id, source, coverage, covered_intervals)
     SELECT $1::text, m.route_id, 'auto', m.coverage, m.covered_intervals
     FROM jsonb_to_recordset($2::jsonb)
       AS m(route_id text, coverage double precision, covered_intervals jsonb)
     ON CONFLICT (session_id, route_id) DO NOTHING`,
    [sessionId, JSON.stringify(matches)]
  );
  return result.rowCount ?? 0;
}
```

- [x] **Step 5: Run the tests and watch them pass**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
export TEST_DATABASE_URL="postgres://peaks_test:$(gcloud secrets versions access latest --secret=peaks-test-db-password)@127.0.0.1:5432/peaks_test"
NODE_ENV=test node --test --import tsx \
  src/__tests__/route-coverage-sql.test.ts \
  src/__tests__/route-coverage-gate.test.ts
```

Expected: PASS, 7 tests (3 SQL-shape, 4 gate).

- [x] **Step 6: Run the whole suite for regressions**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
npm run test:db && npm run typecheck && npm run lint
```

Expected: green. `route-candidate-sql.test.ts` still passes untouched — Phase 1 did not change.

- [x] **Step 7: Commit**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history
git add cloud-sql/api/src/processing.ts \
        cloud-sql/api/src/__tests__/route-coverage-sql.test.ts \
        cloud-sql/api/src/__tests__/route-coverage-gate.test.ts
git commit -m "feat(api): record partial route coverage and the stretch covered

A recording that covered at least 500 m of a route now earns a
session_routes row, with covered_intervals saying which stretch. The old
0.70 gate stays as the OR branch so short-route completions still count."
```

---

### Task 6: `GET /api/routes/:id/sessions/mine`

**Files:**
- Modify: `cloud-sql/api/src/routes/routes.ts:103-104`
- Modify: `scripts/check-cross-refs.sh` (allowlist entry)
- Test: `cloud-sql/api/src/__tests__/route-my-sessions-endpoint.test.ts`

**Interfaces:**
- Consumes: `session_routes.covered_intervals` (Task 1), the rows Task 5 writes.
- Produces: `buildRouteMySessionsQuery(routeId: string, uid: string): { text: string; values: unknown[] }` and `mapRouteSessionRow(row: any): { sessionId: string; coverage: number | null; coveredIntervals: Array<[number, number]> | null; startDate: number | null }`, both exported from `routes/routes.ts`.

- [x] **Step 1: Write the failing test**

Create `cloud-sql/api/src/__tests__/route-my-sessions-endpoint.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import request from "supertest";
import db from "../db";
import { app } from "../index";
import { dbSkipReason as skipReason } from "./helpers/test-db";

const prefix = `route-mine-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const owner = `${prefix}-owner`;
const other = `${prefix}-other`;
const route = `${prefix}-route`;
const otherRoute = `${prefix}-other-route`;
const older = `${prefix}-older`;
const newer = `${prefix}-newer`;
const theirs = `${prefix}-theirs`;
const elsewhere = `${prefix}-elsewhere`;

async function cleanup(): Promise<void> {
  await db.query(`DELETE FROM tracking_sessions WHERE user_id = ANY($1)`, [[owner, other]]);
  await db.query(`DELETE FROM routes WHERE id = ANY($1)`, [[route, otherRoute]]);
}

describe("GET /api/routes/:id/sessions/mine", { skip: skipReason ?? undefined }, () => {
  before(async () => {
    await cleanup();
    await db.query(
      `INSERT INTO routes (id, name, status) VALUES ($1, 'Hoh River Trail', 'active'),
                                                    ($2, 'Elsewhere', 'active')`,
      [route, otherRoute]
    );
    await db.query(
      `INSERT INTO tracking_sessions (id, user_id, start_time, ended, processing_state)
       VALUES ($1, $2, '2026-05-02T15:00:00Z', true, 'completed'),
              ($3, $2, '2026-07-11T13:00:00Z', true, 'completed'),
              ($4, $5, '2026-06-01T13:00:00Z', true, 'completed'),
              ($6, $2, '2026-06-20T13:00:00Z', true, 'completed')`,
      [older, owner, newer, theirs, other, elsewhere]
    );
    await db.query(
      `INSERT INTO session_routes (session_id, route_id, source, coverage, covered_intervals)
       VALUES ($1, $3, 'auto', 0.15, '[[0, 0.15]]'::jsonb),
              ($2, $3, 'auto', 0.94, '[[0, 0.94]]'::jsonb),
              ($4, $3, 'auto', 0.88, '[[0, 0.88]]'::jsonb),
              ($5, $6, 'auto', 0.91, '[[0, 0.91]]'::jsonb)`,
      [older, newer, route, theirs, elsewhere, otherRoute]
    );
  });

  after(cleanup);

  test("unauthenticated requests are rejected", async () => {
    const response = await request(app).get(`/api/routes/${route}/sessions/mine`);
    assert.equal(response.status, 401);
  });

  test("returns only the caller's sessions on this route, newest first", async () => {
    const response = await request(app)
      .get(`/api/routes/${route}/sessions/mine`)
      .set("X-Test-User", owner);
    assert.equal(response.status, 200);
    assert.deepEqual(
      response.body.map((row: { sessionId: string }) => row.sessionId),
      [newer, older]
    );
  });

  test("a partial row keeps its coverage and its covered stretch", async () => {
    const response = await request(app)
      .get(`/api/routes/${route}/sessions/mine`)
      .set("X-Test-User", owner);
    const partial = response.body.find((row: { sessionId: string }) => row.sessionId === older);
    assert.equal(partial.coverage, 0.15);
    assert.deepEqual(partial.coveredIntervals, [[0, 0.15]]);
    // Epoch seconds for 2026-05-02T15:00:00Z, as a number not a string.
    assert.equal(typeof partial.startDate, "number");
    assert.equal(partial.startDate, Date.parse("2026-05-02T15:00:00Z") / 1000);
  });

  test("another user on the same route sees only their own row", async () => {
    // `theirs` is the other user's session on the SAME route, so this proves
    // the scoping in both directions at once: they get their row, not the
    // owner's two, and the owner's list above never held theirs.
    const response = await request(app)
      .get(`/api/routes/${route}/sessions/mine`)
      .set("X-Test-User", other);
    assert.equal(response.status, 200);
    assert.deepEqual(
      response.body.map((row: { sessionId: string }) => row.sessionId),
      [theirs]
    );
  });

  test("a route the caller has never done returns an empty list", async () => {
    const response = await request(app)
      .get(`/api/routes/${prefix}-nonexistent/sessions/mine`)
      .set("X-Test-User", owner);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, []);
  });
});
```

- [x] **Step 2: Run the test and watch it fail**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
export TEST_DATABASE_URL="postgres://peaks_test:$(gcloud secrets versions access latest --secret=peaks-test-db-password)@127.0.0.1:5432/peaks_test"
NODE_ENV=test node --test --import tsx src/__tests__/route-my-sessions-endpoint.test.ts
```

Expected: FAIL — the authenticated requests 404 (no such route registered).

- [x] **Step 3: Add the endpoint**

In `cloud-sql/api/src/routes/routes.ts`, replace the imports:

```ts
import { Router, Response } from "express";
import { asyncRoute } from "../lib/async-route";
import db from "../db";
import { normalizeExternalLinks } from "../lib/external-links";
```

with:

```ts
import { Router, Request, Response } from "express";
import { asyncRoute } from "../lib/async-route";
import { getUid } from "../auth";
import db from "../db";
import { normalizeExternalLinks } from "../lib/external-links";
```

Then insert, directly after the `GET /api/routes/:id/destinations` handler and before the `GET /api/routes/:id/elevation` comment:

```ts
/**
 * The requesting user's own recordings matched to one route, newest first.
 *
 * The one reader of partial-coverage rows. Every other reader of
 * session_routes filters them out (routeDoneCoverageSql), because a row there
 * means "did this route"; here a row means "covered some of this route", which
 * is the whole point of the route page's "Your History" section.
 *
 * Strictly own-data: scoped by the verified caller's uid, never a parameter,
 * so it cannot return another user's recordings. No cross-user comparison, no
 * leaderboard.
 *
 * `coverage` and `coveredIntervals` are both null on a route the user attached
 * by hand — nothing measured it, and the user's own claim is the answer, so a
 * client treats null as done. `coveredIntervals` is also null on a row written
 * before 2026-08; on a row at or above 0.70 a client reads that as the whole
 * route.
 *
 * `startDate` is epoch seconds. The `::bigint` cast comes back as a JS number
 * through the global BIGINT parser in db.ts — see the wire-type policy in
 * cloud-sql/CLAUDE.md before changing it.
 */
export function buildRouteMySessionsQuery(
  routeId: string,
  uid: string
): { text: string; values: unknown[] } {
  return {
    text: `SELECT s.id AS session_id,
            sr.coverage,
            sr.covered_intervals,
            EXTRACT(EPOCH FROM s.start_time)::bigint AS start_date
     FROM session_routes sr
     JOIN tracking_sessions s ON s.id = sr.session_id
     WHERE sr.route_id = $1 AND s.user_id = $2
     ORDER BY s.start_time DESC, s.id DESC`,
    values: [routeId, uid],
  };
}

export function mapRouteSessionRow(row: any): {
  sessionId: string;
  coverage: number | null;
  coveredIntervals: Array<[number, number]> | null;
  startDate: number | null;
} {
  return {
    sessionId: row.session_id,
    coverage: row.coverage ?? null,
    coveredIntervals: Array.isArray(row.covered_intervals) ? row.covered_intervals : null,
    startDate: typeof row.start_date === "number" ? row.start_date : null,
  };
}

// GET /api/routes/:id/sessions/mine
router.get("/:id/sessions/mine", asyncRoute(async (req: Request, res: Response) => {
  const uid = getUid(req);
  const query = buildRouteMySessionsQuery(req.params.id, uid);
  const result = await db.query(query.text, query.values);
  res.json(result.rows.map(mapRouteSessionRow));
}));
```

- [x] **Step 4: Allowlist the endpoint in the cross-reference check**

`routes/routes.ts` now reads `session_routes` without the predicate, on purpose. In `scripts/check-cross-refs.sh`, replace:

```bash
route_reader_allowlist=()
```

with:

```bash
route_reader_allowlist=(
  # The one reader of partial rows. GET /:id/sessions/mine exists to serve the
  # route page's "Your History", where a 15% approach hike is the answer.
  "cloud-sql/api/src/routes/routes.ts"
)
```

- [x] **Step 5: Run the tests and the cross-reference check**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
export TEST_DATABASE_URL="postgres://peaks_test:$(gcloud secrets versions access latest --secret=peaks-test-db-password)@127.0.0.1:5432/peaks_test"
NODE_ENV=test node --test --import tsx src/__tests__/route-my-sessions-endpoint.test.ts
npm run typecheck && npm run lint
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history
./scripts/check-cross-refs.sh
```

Expected: 5 endpoint tests pass; typecheck, lint and `Cross-refs OK`.

- [x] **Step 6: Commit**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history
git add cloud-sql/api/src/routes/routes.ts \
        cloud-sql/api/src/__tests__/route-my-sessions-endpoint.test.ts \
        scripts/check-cross-refs.sh
git commit -m "feat(api): add GET /api/routes/:id/sessions/mine

The route page's own-history read: the caller's recordings on one route,
newest first, with the stretch each one covered. Own data only."
```

---

### Task 7: Rematch a route's recordings when its geometry is recomputed

A route whose line moved leaves every `covered_intervals` on it measured against the old line, which would tint the wrong stretch. The only place `routes.path` changes shape is `rematerializeRoute` in the admin route builder (the elevation jobs change Z only, and per `cloud-sql/CLAUDE.md` a Z-only change must not rerun historical session matching).

**Files:**
- Modify: `web/src/lib/actions/segment-matcher.ts:836-882`
- Modify: `scripts/check-cross-refs.sh` (allowlist entry)
- Test: `web/src/lib/route-rematch-hook.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no exported symbol — one extra statement inside the existing private `rematerializeRoute`.

- [x] **Step 1: Write the failing test**

Create `web/src/lib/route-rematch-hook.test.ts`:

```ts
// A route's line moved, so every auto-matched recording on it now carries
// coverage and covered_intervals measured against the old geometry. The fix is
// to hand those recordings back to the API's existing stuck-session sweep
// rather than recompute here: processSession owns the one implementation of
// the coverage maths, and the sweep already runs inside a Cloud Scheduler
// request (no timer, no always-on CPU, no new cost).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = readFileSync(
  join(fileURLToPath(new URL(".", import.meta.url)), "actions", "segment-matcher.ts"),
  "utf8"
);

const rematerialize = source.slice(source.indexOf("async function rematerializeRoute"));

test("a geometry recompute queues its recordings for rematching", () => {
  assert.match(rematerialize, /UPDATE routes SET path = ST_GeomFromText/);
  assert.match(rematerialize, /UPDATE tracking_sessions/);
  assert.match(rematerialize, /SET processing_state = 'pending'/);
  assert.match(rematerialize, /FROM session_routes sr/);
  assert.match(rematerialize, /sr\.route_id = \$1 AND sr\.source = 'auto'/);
});

test("the hook never steals a live processing claim or touches manual rows", () => {
  assert.match(rematerialize, /processing_state <> 'processing'/);
  assert.match(rematerialize, /ended = true/);
  assert.doesNotMatch(rematerialize, /DELETE FROM session_routes/);
});

test("the hook adds no timer and no direct coverage maths", () => {
  assert.doesNotMatch(rematerialize, /setInterval|setTimeout/);
  assert.doesNotMatch(rematerialize, /covered_intervals/);
});
```

- [x] **Step 2: Run the test and watch it fail**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/web
node --test --import tsx src/lib/route-rematch-hook.test.ts
```

Expected: FAIL — no `UPDATE tracking_sessions` inside `rematerializeRoute`.

- [x] **Step 3: Add the hook**

In `web/src/lib/actions/segment-matcher.ts`, replace the closing statement of `rematerializeRoute`:

```ts
  await client.query(
    `UPDATE routes SET path = ST_GeomFromText($1, 4326)::geography,
                       polyline6 = $2, distance = $3, gain = $4, gain_loss = $5,
                       updated_at = NOW()
     WHERE id = $6`,
    [wkt, poly, Math.round(dist), elev.gain, elev.loss, routeId]
  );
}
```

with:

```ts
  await client.query(
    `UPDATE routes SET path = ST_GeomFromText($1, 4326)::geography,
                       polyline6 = $2, distance = $3, gain = $4, gain_loss = $5,
                       updated_at = NOW()
     WHERE id = $6`,
    [wkt, poly, Math.round(dist), elev.gain, elev.loss, routeId]
  );

  // The line moved, so every auto-matched recording on this route now carries
  // coverage and covered_intervals measured against the OLD geometry — stale
  // intervals would tint the wrong stretch of the elevation profile. Hand
  // those recordings to the API's existing stuck-session sweep (Cloud
  // Scheduler → POST /internal/sweep, every 2 minutes, 50 per run) instead of
  // recomputing here: processSession is idempotent and owns the one
  // implementation of the coverage maths, and the sweep runs inside a request
  // that already exists. No new service, no timer, $0/month.
  //
  // 'manual' rows are the user's own claim and are left alone, as they are
  // everywhere else. A session mid-run keeps its claim; the next sweep gets it.
  await client.query(
    `UPDATE tracking_sessions
     SET processing_state = 'pending', processing_error = NULL
     WHERE ended = true
       AND processing_state <> 'processing'
       AND id IN (
         SELECT sr.session_id FROM session_routes sr
         WHERE sr.route_id = $1 AND sr.source = 'auto'
       )`,
    [routeId]
  );
}
```

- [x] **Step 4: Allowlist the hook in the cross-reference check**

The hook reads `session_routes` without the predicate — it must rematch partial rows too. In `scripts/check-cross-refs.sh`, replace:

```bash
route_reader_allowlist=(
  # The one reader of partial rows. GET /:id/sessions/mine exists to serve the
  # route page's "Your History", where a 15% approach hike is the answer.
  "cloud-sql/api/src/routes/routes.ts"
)
```

with:

```bash
route_reader_allowlist=(
  # The one reader of partial rows. GET /:id/sessions/mine exists to serve the
  # route page's "Your History", where a 15% approach hike is the answer.
  "cloud-sql/api/src/routes/routes.ts"
  # Queues recordings for rematch after a geometry recompute. A partial row is
  # exactly as stale as a complete one, so this must see every 'auto' row.
  "web/src/lib/actions/segment-matcher.ts"
)
```

- [x] **Step 5: Run the tests, build, lint and cross-refs**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/web
npm test
npm run build && npm run lint
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history
./scripts/check-cross-refs.sh
```

Expected: web tests pass, build and lint clean, `Cross-refs OK`.

- [x] **Step 6: Commit**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history
git add web/src/lib/actions/segment-matcher.ts \
        web/src/lib/route-rematch-hook.test.ts \
        scripts/check-cross-refs.sh
git commit -m "feat(web): rematch a route's recordings after a geometry recompute

Queues them for the existing stuck-session sweep rather than adding a
timer or a second copy of the coverage maths. \$0/month."
```

---

### Task 8: The historical backfill script

**Code only.** No step in this task runs the script against production. Running it against `peaks` is a separate, explicitly confirmed operation — see the header comment the script carries.

**Files:**
- Create: `cloud-sql/api/scripts/backfill-route-coverage.ts`
- Modify: `cloud-sql/api/package.json:16`
- Test: `cloud-sql/api/src/__tests__/backfill-route-coverage-script.test.ts`

**Interfaces:**
- Consumes: `measureSessionRouteCoverage`, `upsertSessionRouteCoverage` from Task 5.
- Produces: `npm run backfill:route-coverage`.

- [x] **Step 1: Write the failing test**

Create `cloud-sql/api/src/__tests__/backfill-route-coverage-script.test.ts`:

```ts
// The backfill rewrites session_routes across the whole history. These pins
// are the properties that make that safe to run twice, and safe to interrupt.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const script = readFileSync(
  resolve(__dirname, "../../scripts/backfill-route-coverage.ts"),
  "utf8"
);

test("the backfill reuses the live matching code rather than copying it", () => {
  assert.match(script, /from "\.\.\/src\/processing"/);
  assert.match(script, /measureSessionRouteCoverage/);
  assert.match(script, /upsertSessionRouteCoverage/);
  // No second copy of the merge or the gate.
  assert.doesNotMatch(script, /mergeCoveredIntervals/);
  assert.doesNotMatch(script, /ST_DumpPoints/);
});

test("the backfill is batched, resumable and gentle on a db-f1-micro", () => {
  assert.match(script, /--dry-run/);
  assert.match(script, /--limit/);
  assert.match(script, /--delay-ms/);
  assert.match(script, /s\.path IS NOT NULL/);
  assert.match(script, /ORDER BY s\.start_time ASC, s\.id ASC/);
});

test("the backfill never deletes and never overwrites a manual row", () => {
  assert.doesNotMatch(script, /DELETE FROM session_routes/);
  assert.doesNotMatch(script, /DELETE FROM tracking_sessions/);
  assert.doesNotMatch(script, /processing_state/);
});

test("the script says out loud that running it on prod is a separate decision", () => {
  assert.match(script, /separate, explicitly confirmed step/);
});

test("package.json exposes the backfill the way the other backfills are exposed", () => {
  const pkg = JSON.parse(
    readFileSync(resolve(__dirname, "../../package.json"), "utf8")
  ) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["backfill:route-coverage"], "tsx scripts/backfill-route-coverage.ts");
});
```

- [x] **Step 2: Run the test and watch it fail**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
NODE_ENV=test node --test --import tsx \
  src/__tests__/backfill-route-coverage-script.test.ts
```

Expected: FAIL — `ENOENT: ... scripts/backfill-route-coverage.ts`.

- [x] **Step 3: Write the script**

Create `cloud-sql/api/scripts/backfill-route-coverage.ts`:

```ts
/**
 * Recompute session_routes coverage and covered_intervals across ALL history.
 *
 * Two things it fixes at once, and they are the same computation: recordings
 * that covered a real stretch of a route but never earned a row under the old
 * 0.70-only gate, and rows that have a coverage but no covered_intervals
 * because they predate the column.
 *
 * Running this against production is a separate, explicitly confirmed step.
 * It is not part of implementing or reviewing the feature. Do a --dry-run
 * first, read the counts, and only then run it with --apply.
 *
 * Safe to interrupt and re-run: every write is an upsert keyed by
 * (session_id, route_id), so a second run recomputes the same values. It never
 * deletes a row, never touches a 'manual' row (the user's own claim), and never
 * changes a session's processing_state.
 *
 *   # proxy in another terminal:
 *   cloud-sql-proxy donner-a8608:us-central1:peaks-db --port 5433
 *
 *   cd cloud-sql/api
 *   DB_HOST=127.0.0.1 DB_PORT=5433 DB_NAME=peaks DB_USER=peaks-api \
 *   DB_PASS=... DB_POOL_MAX=2 \
 *     npm run backfill:route-coverage -- --dry-run
 *
 * Flags:
 *   --dry-run        measure and report; write nothing (the default)
 *   --apply          actually write
 *   --limit <n>      cap sessions processed this run
 *   --delay-ms <n>   pause between sessions (default 300)
 *   --user <uid>     restrict to one user
 */

import db from "../src/db";
import {
  measureSessionRouteCoverage,
  upsertSessionRouteCoverage,
} from "../src/processing";

function intFlag(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const n = Number.parseInt(process.argv[i + 1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function strFlag(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

const APPLY = process.argv.includes("--apply");
const DELAY_MS = intFlag("--delay-ms", 300);
const LIMIT = intFlag("--limit", Number.MAX_SAFE_INTEGER);
const USER = strFlag("--user");

if (APPLY && process.argv.includes("--dry-run")) {
  console.error("Pass --dry-run or --apply, not both.");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log(`[backfill-route-coverage] apply=${APPLY} delay=${DELAY_MS}ms`);
  if (!APPLY) {
    console.log("[backfill-route-coverage] dry run: measuring only, no writes");
  }

  // Only sessions whose track is already materialized. A recording with points
  // but no path has never been processed at all; queueing those is
  // processSession's job, not this script's, so they are counted and left.
  const { rows } = await db.query<{ id: string }>(
    `SELECT s.id
     FROM tracking_sessions s
     WHERE s.path IS NOT NULL
       AND ($1::text IS NULL OR s.user_id = $1)
     ORDER BY s.start_time ASC, s.id ASC`,
    [USER]
  );

  const unpathed = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM tracking_sessions s
     WHERE s.ended = true AND s.path IS NULL
       AND ($1::text IS NULL OR s.user_id = $1)
       AND EXISTS (SELECT 1 FROM tracking_points tp WHERE tp.session_id = s.id)`,
    [USER]
  );

  const targets = rows.slice(0, LIMIT);
  console.log(
    `[backfill-route-coverage] ${targets.length} of ${rows.length} sessions with a path; ` +
      `${unpathed.rows[0].count} ended sessions have points but no path and are skipped`
  );

  let measured = 0;
  let written = 0;
  let failed = 0;

  for (const [index, session] of targets.entries()) {
    try {
      const matches = await measureSessionRouteCoverage(db, session.id);
      measured += matches.length;
      if (APPLY && matches.length > 0) {
        written += await upsertSessionRouteCoverage(db, session.id, matches);
      }
    } catch (err) {
      failed++;
      console.error(`[backfill-route-coverage] ${session.id} failed:`, err);
    }
    if ((index + 1) % 100 === 0 || index + 1 === targets.length) {
      console.log(`[backfill-route-coverage] ${index + 1}/${targets.length} sessions`);
    }
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  console.log(
    `[backfill-route-coverage] done: ${measured} route matches measured, ` +
      `${written} rows written, ${failed} sessions failed`
  );
  await db.end();
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Route coverage backfill failed:", err);
  process.exit(1);
});
```

- [x] **Step 4: Register the script**

In `cloud-sql/api/package.json`, replace:

```json
    "backfill:area-descriptions": "tsx scripts/backfill-area-descriptions.ts",
```

with:

```json
    "backfill:area-descriptions": "tsx scripts/backfill-area-descriptions.ts",
    "backfill:route-coverage": "tsx scripts/backfill-route-coverage.ts",
```

- [x] **Step 5: Run the test and watch it pass**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
NODE_ENV=test node --test --import tsx \
  src/__tests__/backfill-route-coverage-script.test.ts
```

Expected: PASS, 5 tests.

- [x] **Step 6: Prove the script runs, against the TEST database only**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
TEST_DATABASE_URL="postgres://peaks_test:$(gcloud secrets versions access latest --secret=peaks-test-db-password)@127.0.0.1:5432/peaks_test" \
  npm run backfill:route-coverage -- --dry-run --limit 5 --delay-ms 0
```

Expected: it prints the two count lines and `done: ... 0 rows written`. `db.ts` refuses any `TEST_DATABASE_URL` whose database name does not end in `_test`, so this cannot reach production. **Do not run this command with `DB_*` variables pointed at `peaks`.**

- [x] **Step 7: Typecheck, lint and commit**

`tsconfig.json` has `"include": ["src"]` and `npm run lint` runs `eslint src/`,
so neither covers `scripts/` — the same as every other backfill script here.
Step 6's dry run is what proves this file loads and runs.

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
npm run typecheck && npm run lint
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history
git add cloud-sql/api/scripts/backfill-route-coverage.ts \
        cloud-sql/api/package.json \
        cloud-sql/api/src/__tests__/backfill-route-coverage-script.test.ts
git commit -m "feat(api): add the historical route coverage backfill

Batched, resumable, dry-run by default, and never run against production
as part of this change. One-time compute on the existing instance; no new
service and \$0/month recurring."
```

---

### Task 9: Documentation and the cost statement

**Files:**
- Modify: `cloud-sql/CLAUDE.md:177-197`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing executable.

- [x] **Step 1: Add the endpoint to the API table**

In `cloud-sql/CLAUDE.md`, replace:

```
| GET | `/api/routes/...` | Route queries |
```

with:

```
| GET | `/api/routes/...` | Route queries |
| GET | `/api/routes/:id/sessions/mine` | The caller's own recordings on one route, newest first, with the stretch each covered (owner-only; the one reader of partial `session_routes` rows) |
```

- [x] **Step 2: Document what a `session_routes` row means**

In `cloud-sql/CLAUDE.md`, insert a new section directly before `## Session comparisons ("Your Efforts")`:

```markdown
## Route coverage and partial history

A `session_routes` row used to mean "did this route": nothing was written
below 0.70 vertex coverage. Since 2026-08 a row is also written when the
recording covered at least **500 m** of the route, so an approach hike of a
long trail gets an honest answer instead of nothing, and `covered_intervals`
records which stretch — `[[start, end]]` fractions of the route linestring,
merged with a gap tolerance of max(100 m, 2% of route length) so a GPS dropout
does not shred one hike into fragments.

Two rules, both pinned by tests and by `scripts/check-cross-refs.sh`:

- **Every reader filters, except the two that must not.** A partial row is not
  a climb of the route, so popularity counts, session detail, trip-report links
  and the web's own-history reads all apply `routeDoneCoverageSql`. The
  predicate keeps `coverage IS NULL`: a manually attached route and every row
  the Firestore migration wrote carry NULL and have always meant "did this
  route". The two exceptions are allowlisted with their reasons —
  `GET /api/routes/:id/sessions/mine`, which exists to serve partial rows, and
  the route-geometry rematch hook, which must see every `auto` row.
- **The merge and the gate live in `api/src/route-coverage.ts`, and only
  there.** PostGIS measures (`buildRouteCoverageSql`); that module decides.
  The backfill script and `processSession` share it verbatim. Two definitions
  are duplicated into `web/src/lib/route-coverage.ts` because the packages
  cannot share code, and the cross-ref check fails the build if they drift.

A route whose materialized geometry is recomputed leaves stale intervals
behind, so `rematerializeRoute` (web admin route builder) queues that route's
`auto`-matched recordings back to `pending` and the existing Cloud Scheduler
sweep rematches them. No timer, no new service.

Historical rows are filled by `npm run backfill:route-coverage` in
`cloud-sql/api` — dry-run by default, batched, resumable, never run as part of
a code change.
```

- [x] **Step 3: Verify the docs describe the code that exists**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history
grep -n "sessions/mine" cloud-sql/CLAUDE.md cloud-sql/api/src/routes/routes.ts
grep -n "backfill:route-coverage" cloud-sql/CLAUDE.md cloud-sql/api/package.json
./scripts/check-cross-refs.sh
```

Expected: each grep hits both files; `Cross-refs OK`.

- [x] **Step 4: Run everything one last time**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/cloud-sql/api
export TEST_DATABASE_URL="postgres://peaks_test:$(gcloud secrets versions access latest --secret=peaks-test-db-password)@127.0.0.1:5432/peaks_test"
npm run test:db && npm run typecheck && npm run lint
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history/web
npm test && npm run build && npm run lint
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history
./scripts/check-cross-refs.sh
```

Expected: all green.

- [x] **Step 5: Commit, with the cost statement**

The repo's **Infrastructure cost discipline** rule requires an explicit $/month
figure in the commit message and in the PR body. Use this text in both:

```bash
cd /Users/josiahm/projects/peaks/.worktrees/route-partial-history
git add cloud-sql/CLAUDE.md
git commit -m "docs: record what a session_routes row means after partial history

Cost: ~\$0/month recurring. One nullable JSONB column on an existing table
(catalog-only change, a few MB of existing disk), no new index, no new
service, no scheduler job, no min-instance and no always-on CPU. The
route-geometry rematch runs inside the Cloud Scheduler sweep request that
already exists. The only new compute is the one-time historical backfill:
a single batched pass over existing sessions on the current db-f1-micro,
run by hand, delayed 300 ms per session so it cannot crowd production."
```

- [x] **Step 6: State the cost in the PR body**

When the PR is opened, its body must carry the same paragraph, under a
**Cost** heading, per `CLAUDE.md`'s "Any design or config change that raises
that floor must state an explicit $/month estimate in the PR or commit
message". The baseline is unchanged: ~$10–15/month.

---

## Self-review

**1. Spec coverage.** Every requirement in Section 1 maps to a task:

| Spec requirement | Task |
|---|---|
| `ALTER TABLE session_routes ADD COLUMN covered_intervals JSONB` | 1 |
| `[start, end]` fractions, sorted, non-overlapping | 2 |
| Gap tolerance max(100 m, 2% of length) | 2 |
| `NULL` = legacy row; scalar `coverage` keeps its meaning | 1, 2, 6 |
| Write gate: covered length ≥ 500 m OR coverage ≥ 0.70 | 2 (decision), 5 (applied) |
| Vertex tolerance stays 30 m | 2, 5 |
| Covered length = interval spans × route length | 2 |
| `lists.ts` popularity `COUNT(*)` filter | 3 |
| `SESSION_ROUTES_SQL` + `GET /:id/routes` filter | 3 |
| "A test pins each filter" | 3, 4 |
| `GET /api/routes/:id/sessions/mine`, auth, own data, newest first, 401 | 6 |
| Response shape (`sessionId`, `coverage`, `coveredIntervals`, `startDate` epoch seconds) | 6 |
| Batched, idempotent backfill via the proxy pattern; never run on prod here | 8 |
| Rematch where `routes.path` recompute happens | 7 |
| Cost: ~$0/month recurring | 9 |
| Testing: interval merge + gap tolerance | 2 |
| Testing: gate floors (short clip / 500 m partial / short-route completion) | 5 |
| Testing: consumer-filter regressions | 3, 4 |
| Testing: endpoint auth (401 unauth, only own sessions) | 6 |

No gaps. Section 2 (iOS) and "Out of scope" are deliberately absent.

**2. Placeholder scan.** No "TBD", no "similar to Task N", no "add error
handling". Every code step carries the literal text to write; every test step
carries a runnable command and the expected result. The one deliberately
open-ended step is Task 9 Step 6 (write the cost paragraph into the PR body),
and its exact text is given in Step 5.

**3. Type consistency.** Checked across tasks:

- `routeDoneCoverageSql(alias: string): string` — defined Task 2, used by the
  same name in Tasks 3, 4 and the cross-ref check; the web copy in Task 4 has
  a byte-identical body, which Task 4 Step 9 enforces.
- `ROUTE_DONE_COVERAGE = 0.7` — one constant, both jobs (write-gate OR branch
  and consumer cutoff). The tests assert the rendered predicate says `0.7`,
  which is what `${0.7}` produces.
- `RouteCoverageRow` fields (`route_id`, `length_m`, `total_points`,
  `matched_points`, `covered_along_m`) match the `SELECT` aliases in
  `buildRouteCoverageSql` exactly, and the test fixtures in Task 2 use the same
  names.
- `RouteMatch` fields (`route_id`, `coverage`, `covered_intervals`) match the
  `jsonb_to_recordset` column list in both writers in Task 5, and the column
  names in `session_routes`.
- `measureSessionRouteCoverage` / `upsertSessionRouteCoverage` are exported in
  Task 5 and imported under those names in Task 8.
- `buildRouteMySessionsQuery` / `mapRouteSessionRow` are only used inside Task 6.
- `RowQueryable` is defined once (Task 5) and satisfied by `PoolClient` and by
  the `db` pool, which is what Task 8 passes.
