# Async Processing Safety-Net

## Problem

`processSession` (destination/route matching) runs **inline, awaited** inside the
upload endpoints (`POST /api/sessions`, `POST /api/sessions/:id/points`,
`PUT /api/sessions/:id` via `autoProcessIfQueued`). Two consequences:

1. Every match competes with interactive traffic and is capped by the **web
   pool's 30s `statement_timeout`** — the guard that stops one slow query from
   starving the `db-f1-micro`'s 4-connection pool and 503-ing search/sync.
2. A long GPS track (e.g. an 86 km, dense-area session) makes the spatial
   matching expensive enough to approach/exceed 30s. On timeout the session is
   marked `failed`; if the worker dies first it wedges at `processing`. Nothing
   re-triggers a stuck session, so they accumulate.

The index/planar query fixes (shipped 2026-06-29, rev 00096) made matching fast
for ~all sessions, but track length still has *some* ceiling while matching is
inline under the interactive 30s guard. We want long tracks handled without
worry **and without simplifying geometry** (peakbagging fidelity is
non-negotiable — see memory `feedback_no_geometry_simplification`).

## Goal

Decouple processing from the interactive request budget so processing duration
is bounded by an isolated, relaxed budget instead of the web pool's 30s — while
keeping the web pool's guard intact, adding no external infrastructure, and not
regressing common-case latency.

## Approach (chosen: in-process sweep + isolated pool)

Keep inline processing for the common fast case; add an isolated pool with a
relaxed timeout and an in-process sweep that finishes anything the inline path
couldn't.

### 1. Isolated processing pool — `db.ts`

Add a second `pg.Pool`, `processingPool`:

- `max`: `DB_PROCESSING_POOL_MAX` (default **2**)
- `statement_timeout`: `DB_PROCESSING_STATEMENT_TIMEOUT_MS` (default **120000**)
- `idle_in_transaction_session_timeout`: 120000
- otherwise the same `dbClientConfig` connection settings

Exported alongside the default web pool. The web pool is unchanged (`max: 4`,
30s) so interactive queries keep their protective ceiling.

**Connection budget:** web `4 × maxScale(6) = 24` is already tuned just under
the `f1-micro` ~25-connection ceiling. The sweep adds connections, so the sweep
is gated by a Postgres **advisory lock** (below) such that **at most one sweep
runs fleet-wide**, bounding sweep usage to ~1–2 connections total regardless of
instance count.

### 2. `processSession` / `processPlan` accept a pool — `processing.ts`

Add an options arg: `processSession(sessionId, userId, { pool = db, force })`
(and `processPlan(planId, userId, { pool = db })`). Every internal query —
the claim, `pool.connect()` for the transaction, and the catch-block status
update — uses the passed pool.

- Inline callers (`autoProcessIfQueued`, `POST /:id/process`) pass nothing →
  default **web pool (30s)** → common-case latency unchanged; fast sessions
  still return `completed` on the upload response.
- The sweep passes `{ pool: processingPool }` → **120s** budget.

### 3. Inline timeout leaves `pending`, not `failed` — `processing.ts`

In the catch block, classify the error: a Postgres statement-timeout has
`err.code === '57014'`. On timeout, set `processing_state = 'pending'` (clear
`processing_error`) so the sweep re-claims and finishes it with the relaxed
budget. Any other error keeps the existing `failed` + `processing_error`
behavior (genuine data problems still surface as "Couldn't analyze").

A pure helper `isStatementTimeout(err): boolean` is unit-tested.

### 4. In-process sweep — `processing.ts` (`sweepStuckSessions`) + `index.ts`

`sweepStuckSessions(pool, { limit = 50 })`:

1. `SELECT pg_try_advisory_lock($KEY)` on a dedicated connection. If not
   acquired, return immediately (another instance owns the sweep).
2. Select up to `limit` stuck sessions across **all users** — the recovery
   script's candidate predicate, exported as `buildStuckSessionsSql()`: ended,
   has points, `processing_state IN ('pending','failed')` OR stale
   `processing`, oldest first.
3. For each, `await processSession(id, userId, { pool })` serially; `skipped`
   (already completed) and `already_processing` (live claim) are ignored.
4. `pg_advisory_unlock($KEY)` in a `finally`; release the connection.

`index.ts` starts a `setInterval` at boot (`SWEEP_INTERVAL_MS`, default
**120000**) calling `sweepStuckSessions(processingPool)`, guarded by a
module-local `isSweeping` boolean so a slow sweep never overlaps itself on the
same instance. The advisory lock prevents cross-instance overlap.

### 5. Deploy — `.github/workflows/deploy.yml` + manual deploy flags

Add `--no-cpu-throttling` so the interval timer runs reliably between requests
(Cloud Run otherwise throttles CPU to ~0 outside request handling). `min-instances`
stays 1; the always-on instance now bills full CPU (modest, bounded). New env
vars `DB_PROCESSING_POOL_MAX`, `DB_PROCESSING_STATEMENT_TIMEOUT_MS`,
`SWEEP_INTERVAL_MS` are optional (defaults above).

## Components & interfaces

- `db.ts` — exports `default` (web pool) and `processingPool`; `buildPoolConfig`
  gains a sibling `buildProcessingPoolConfig(env)` (pure, unit-tested for the
  120s timeout + bounded max).
- `processing.ts` — `processSession(id, uid, opts)`, `processPlan(id, uid, opts)`,
  `isStatementTimeout(err)`, `buildStuckSessionsSql()`, `sweepStuckSessions(pool, opts)`.
- `index.ts` — boot-time interval starting the sweep; not started under
  `NODE_ENV=test`.
- `scripts/reprocess-stuck-sessions.ts` — unchanged; its candidate SQL is
  superseded by the exported `buildStuckSessionsSql()` (script can import it,
  but keeping the script standalone is fine).

## Data flow

```
upload (create/points/PUT)
  → markSessionPendingIfReady → autoProcessIfQueued
      → processSession(web pool, 30s)
          ├─ completes  → 'completed'  (response carries it; common case)
          ├─ 57014 timeout → 'pending'  (sweep will finish it)
          └─ other error   → 'failed'

every ~120s, one instance (advisory lock):
  sweepStuckSessions(processingPool, 120s)
      → drain pending/failed/stale, serial
          → processSession(processingPool, 120s) → 'completed'
```

iOS already polls `GET /processing-status` and re-fetches changed sessions, so
`pending → completed` surfaces with no client change.

## Error handling

- Advisory lock auto-releases when its connection closes (instance crash) — the
  next tick on any instance re-acquires.
- A sweep that dies mid-session leaves that row `processing`; the claim's
  existing 10-min stale-recovery re-claims it on a later tick.
- `processSession` remains idempotent (completed-skip + atomic claim), so a
  concurrent inline run and sweep cannot double-process — the loser throws
  `already_processing` and is ignored.
- `updateDestinationAverages` is unchanged; a session is counted once because a
  successful run sets `completed` and the completed-skip prevents re-runs.

## Testing

DB-free unit tests in the repo's `node:test` + pure-builder style:

- `isStatementTimeout` — true for `{ code: '57014' }`, false for other codes/shapes.
- `buildProcessingPoolConfig` — 120s `statement_timeout`, bounded `max`,
  env overrides honored.
- `buildStuckSessionsSql` — selects ended + has-points + (pending/failed/stale
  processing), all users, oldest first; parameterless.
- Sweep unit: with an injected fake pool/queryable, asserts it (a) no-ops when
  the advisory lock is not acquired, (b) processes serially and releases the
  lock when acquired, (c) honors `limit`.

Manual validation after deploy: confirm `--no-cpu-throttling` is set, watch a
sweep tick in logs draining 0 in steady state, and confirm a forced long-track
`pending` completes within one interval. No `statement timeout` errors should
appear from the sweep path.

## Out of scope / non-goals

- No geometry simplification (`ST_Simplify`) — fidelity is preserved; the
  shipped index/planar prefilters stay as the fast path.
- No Cloud Scheduler / Cloud Tasks / external queue (approach B/C, rejected for
  infra overhead at this scale).
- No DB tier change (separate, orthogonal lever).
- Per-session push (lowest latency) is not a goal; ~2-min worst-case latency for
  the *rare* slow session is acceptable since iOS already shows "Processing".
```
