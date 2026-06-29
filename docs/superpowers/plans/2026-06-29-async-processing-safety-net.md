# Async Processing Safety-Net Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple session/plan processing from the interactive 30s DB budget so long GPS tracks process under a relaxed, isolated budget — without simplifying geometry, without new external infrastructure, and without regressing common-case latency.

**Architecture:** Add a second isolated `pg.Pool` (`processingPool`, max 2, 120s `statement_timeout`). `processSession`/`processPlan` take an optional pool — inline upload callers keep the 30s web pool, an in-process sweep uses the 120s pool. Inline statement-timeouts drop the session to `pending` (not `failed`); a boot-time interval sweep (advisory-lock-guarded so ≤1 runs fleet-wide) drains stuck sessions across all users.

**Tech Stack:** Node 20, TypeScript, Express, `pg` (node-postgres), `node:test` + `tsx`, Cloud Run.

## Global Constraints

- DB is `db-f1-micro`, ~25 max connections. Web pool stays `max: 4` × maxScale 6 = 24; the sweep MUST stay ≤1 concurrent fleet-wide (advisory lock) so combined connections stay under the ceiling.
- No geometry simplification anywhere (fidelity). This plan does not touch matching SQL.
- Tests are DB-free, `node:test` + `tsx`, pure-builder / dependency-injection style (no mocking framework). Run with `npm test`.
- `processSession`/`processPlan` must remain idempotent (completed-skip + atomic claim).
- Build (`npm run build` = `tsc`) and lint (`npx eslint src/`) must stay clean (0 errors).
- Branch: `feat/async-processing-safety-net` (already created, spec committed).

---

### Task 1: Isolated processing pool

**Files:**
- Modify: `cloud-sql/api/src/db.ts` (after `buildPoolConfig`, ~line 62; after `const pool`, ~line 64)
- Test: `cloud-sql/api/src/__tests__/db-pool-config.test.ts` (append)

**Interfaces:**
- Produces: `buildProcessingPoolConfig(env?): PoolConfig`, `processingPool: Pool` (exported from `db.ts`).

- [ ] **Step 1: Write the failing test** — append to `src/__tests__/db-pool-config.test.ts`:

```ts
import { buildProcessingPoolConfig } from "../db";

test("buildProcessingPoolConfig: relaxed 120s timeout, bounded pool, env overrides", () => {
  const def = buildProcessingPoolConfig({} as NodeJS.ProcessEnv);
  assert.equal(def.statement_timeout, 120_000);
  assert.equal(def.idle_in_transaction_session_timeout, 120_000);
  assert.equal(def.max, 2);

  const over = buildProcessingPoolConfig({
    DB_PROCESSING_POOL_MAX: "3",
    DB_PROCESSING_STATEMENT_TIMEOUT_MS: "90000",
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(over.max, 3);
  assert.equal(over.statement_timeout, 90_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cloud-sql/api && npm test 2>&1 | grep -A2 buildProcessingPoolConfig`
Expected: FAIL — `buildProcessingPoolConfig` is not exported.

- [ ] **Step 3: Implement in `src/db.ts`** — add after `buildPoolConfig` returns (after line 62), and a pool export after line 64 (`const pool = new Pool(buildPoolConfig());`):

```ts
// Isolated pool for background processing (the in-process sweep + relaxed
// inline retries). A separate pool with a longer statement_timeout so a slow
// long-track match runs to completion WITHOUT borrowing from the web pool —
// interactive queries (search/sync) keep their protective 30s ceiling. Kept
// small (max 2) and gated by the sweep's advisory lock so combined web +
// processing connections stay under the db-f1-micro ceiling.
export function buildProcessingPoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const timeout = parsePositiveInt(env.DB_PROCESSING_STATEMENT_TIMEOUT_MS, 120_000);
  return {
    ...dbClientConfig,
    max: parsePositiveInt(env.DB_PROCESSING_POOL_MAX, 2),
    connectionTimeoutMillis: parsePositiveInt(env.DB_POOL_CONNECTION_TIMEOUT_MS, 5_000),
    statement_timeout: timeout,
    idle_in_transaction_session_timeout: timeout,
  };
}

export const processingPool = new Pool(buildProcessingPoolConfig());
```

- [ ] **Step 4: Run tests + build**

Run: `cd cloud-sql/api && npm test 2>&1 | grep -E "pass|fail" && npm run build 2>&1 | tail -2`
Expected: all pass, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add cloud-sql/api/src/db.ts cloud-sql/api/src/__tests__/db-pool-config.test.ts
git commit -m "feat(api): add isolated processingPool (max 2, 120s timeout)"
```

---

### Task 2: Pool-parameterized processing + timeout→pending

**Files:**
- Modify: `cloud-sql/api/src/processing.ts` (imports line 3; `processSession` 431-572; `processPlan` 623-701)
- Test: `cloud-sql/api/src/__tests__/statement-timeout-classify.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `isStatementTimeout(err: unknown): boolean`; `processSession(sessionId, userId, opts?: { force?: boolean; pool?: Pool })`; `processPlan(planId, userId, opts?: { pool?: Pool })`. All internal queries use `opts.pool ?? db`.

- [ ] **Step 1: Write the failing test** — create `src/__tests__/statement-timeout-classify.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isStatementTimeout } from "../processing";

test("isStatementTimeout true only for pg code 57014", () => {
  assert.equal(isStatementTimeout({ code: "57014" }), true);
  assert.equal(isStatementTimeout(Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" })), true);
  assert.equal(isStatementTimeout({ code: "23505" }), false);
  assert.equal(isStatementTimeout(new Error("boom")), false);
  assert.equal(isStatementTimeout(null), false);
  assert.equal(isStatementTimeout("57014"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cloud-sql/api && npm test 2>&1 | grep -A2 isStatementTimeout`
Expected: FAIL — `isStatementTimeout` not exported.

- [ ] **Step 3: Update imports** — `src/processing.ts` line 1-3, change the pg import to also bring the `Pool` type:

```ts
import { Pool, PoolClient } from "pg";
import crypto from "crypto";
import db from "./db";
```

- [ ] **Step 4: Add `isStatementTimeout`** — in `src/processing.ts`, just below the `STALE_PROCESSING_MINUTES` export (~line 13):

```ts
/**
 * True iff `err` is a Postgres statement_timeout cancel (SQLSTATE 57014).
 * Used so an INLINE match that ran out of the web pool's 30s budget is left
 * 'pending' for the relaxed sweep to finish, rather than marked 'failed'.
 */
export function isStatementTimeout(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "57014"
  );
}
```

- [ ] **Step 5: Thread the pool through `processSession`** — change the signature (line 431-435) and resolve the pool at the top of the body:

```ts
export async function processSession(
  sessionId: string,
  userId: string,
  opts: { force?: boolean; pool?: Pool } = {}
): Promise<ProcessingResult> {
  const pool = opts.pool ?? db;
```

Then within `processSession` replace each `db.` with `pool.`:
- the completed-check query (`await db.query` ~line 444) → `await pool.query`
- the claim query (`await db.query` ~line 467) → `await pool.query`
- `const client = await db.connect();` (~line 482) → `const client = await pool.connect();`
- `linkReachedSummitsToAreas(db, sessionId)` (~line 538, inside the post-COMMIT try) → `linkReachedSummitsToAreas(pool, sessionId)`

- [ ] **Step 6: timeout→pending in the catch** — replace the `processSession` catch body (lines 558-568) with:

```ts
  } catch (err) {
    await client.query("ROLLBACK");
    // An INLINE run that exceeded the web pool's 30s budget (57014) is NOT a
    // real failure — leave it 'pending' so the relaxed sweep finishes it.
    // Genuine errors still surface as 'failed' + processing_error.
    if (isStatementTimeout(err)) {
      await pool.query(
        `UPDATE tracking_sessions
         SET processing_state = 'pending', processing_error = NULL
         WHERE id = $1`,
        [sessionId]
      );
    } else {
      const message = err instanceof Error ? err.message.slice(0, 500) : "Unknown processing error";
      await pool.query(
        `UPDATE tracking_sessions
         SET processing_state = 'failed', processing_error = $2
         WHERE id = $1`,
        [sessionId, message]
      );
    }
    throw err;
  } finally {
    client.release();
  }
```

- [ ] **Step 7: Thread the pool through `processPlan`** — change its signature (line 623) to `opts: { pool?: Pool } = {}`, add `const pool = opts.pool ?? db;` at the top, and replace the claim `db.query` (~625), `db.connect()` (~642), and the catch `db.query` (~695) with `pool.`. The catch keeps the plain `'failed'` behavior (plans match client-supplied geometry, not long tracks — no timeout→pending needed):

```ts
export async function processPlan(
  planId: string,
  userId: string,
  opts: { pool?: Pool } = {}
): Promise<{ destinations_matched: number }> {
  const pool = opts.pool ?? db;
```

- [ ] **Step 8: Run tests + build + lint**

Run: `cd cloud-sql/api && npm test 2>&1 | grep -E "pass|fail" && npm run build 2>&1 | tail -2 && npx eslint src/ 2>&1 | tail -2`
Expected: all pass (88+ tests), tsc clean, 0 eslint errors.

- [ ] **Step 9: Commit**

```bash
git add cloud-sql/api/src/processing.ts cloud-sql/api/src/__tests__/statement-timeout-classify.test.ts
git commit -m "feat(api): processSession/processPlan take a pool; inline timeout -> pending"
```

---

### Task 3: Stuck-session sweep

**Files:**
- Modify: `cloud-sql/api/src/processing.ts` (add near the bottom)
- Test: `cloud-sql/api/src/__tests__/sweep-stuck-sessions.test.ts` (create)

**Interfaces:**
- Consumes: `processSession` (Task 2), `STALE_PROCESSING_MINUTES`.
- Produces: `buildStuckSessionsSql(): string` (parameterless, all users); `sweepStuckSessions(pool: Pool, opts?: { limit?: number; processFn?: typeof processSession }): Promise<{ swept: number; locked: boolean }>`; `SWEEP_ADVISORY_LOCK_KEY: number`.

- [ ] **Step 1: Write the failing tests** — create `src/__tests__/sweep-stuck-sessions.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildStuckSessionsSql, sweepStuckSessions, SWEEP_ADVISORY_LOCK_KEY } from "../processing";

test("buildStuckSessionsSql: all users, ended+has-points, stuck states, oldest first", () => {
  const sql = buildStuckSessionsSql();
  assert.match(sql, /FROM tracking_sessions s/);
  assert.match(sql, /s\.ended = true/);
  assert.match(sql, /processing_state IN \('pending', 'failed'\)/);
  assert.match(sql, /processing_state = 'processing'/);
  assert.match(sql, /EXISTS \(SELECT 1 FROM tracking_points/);
  assert.match(sql, /ORDER BY s\.server_updated_at ASC/);
  assert.doesNotMatch(sql, /user_id = \$/); // all users, not scoped
});

// Fake pool: a connect() client whose pg_try_advisory_lock result is scripted,
// and a pool.query that returns candidate rows.
function fakePool(lockOk: boolean, rows: Array<{ id: string; user_id: string }>) {
  const calls: string[] = [];
  const client = {
    query: async (sql: string) => {
      calls.push(sql);
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ ok: lockOk }] };
      return { rows: [] }; // pg_advisory_unlock
    },
    release: () => calls.push("RELEASE"),
  };
  const pool = {
    connect: async () => client,
    query: async () => ({ rows }),
  } as unknown as import("pg").Pool;
  return { pool, calls };
}

test("sweepStuckSessions: no-op when advisory lock not acquired", async () => {
  const { pool, calls } = fakePool(false, [{ id: "a", user_id: "u" }]);
  let processed = 0;
  const res = await sweepStuckSessions(pool, {
    processFn: (async () => { processed++; return {} as never; }) as never,
  });
  assert.equal(res.locked, false);
  assert.equal(res.swept, 0);
  assert.equal(processed, 0, "must not process when lock not held");
  assert.ok(calls.includes("RELEASE"));
});

test("sweepStuckSessions: when locked, processes serially, honors limit, unlocks", async () => {
  const rows = [{ id: "a", user_id: "u" }, { id: "b", user_id: "u" }];
  const { pool, calls } = fakePool(true, rows);
  const order: string[] = [];
  const res = await sweepStuckSessions(pool, {
    limit: 5,
    processFn: (async (id: string) => { order.push(id); return { skipped: false } as never; }) as never,
  });
  assert.equal(res.locked, true);
  assert.equal(res.swept, 2);
  assert.deepEqual(order, ["a", "b"]);
  assert.ok(calls.some((c) => c.includes("pg_advisory_unlock")));
  assert.equal(SWEEP_ADVISORY_LOCK_KEY > 0, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloud-sql/api && npm test 2>&1 | grep -A2 sweep-stuck`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Implement** — append to `src/processing.ts`:

```ts
// Arbitrary fixed key for the session-sweep advisory lock. Ensures at most ONE
// sweep runs across the whole Cloud Run fleet at a time, so the sweep can never
// add more than ~1-2 connections on top of the web pool (db-f1-micro budget).
export const SWEEP_ADVISORY_LOCK_KEY = 4927301;

// All ended sessions with points stuck at pending/failed or a stale 'processing'
// claim, across EVERY user, oldest first. Parameterless so callers append LIMIT.
export function buildStuckSessionsSql(): string {
  return `SELECT s.id, s.user_id FROM tracking_sessions s
     WHERE s.ended = true
       AND (
         s.processing_state IN ('pending', 'failed')
         OR (s.processing_state = 'processing'
             AND (s.processing_started_at IS NULL
                  OR s.processing_started_at < now() - make_interval(mins => ${STALE_PROCESSING_MINUTES})))
       )
       AND EXISTS (SELECT 1 FROM tracking_points tp WHERE tp.session_id = s.id)
     ORDER BY s.server_updated_at ASC, s.id ASC`;
}

/**
 * Drain up to `limit` stuck sessions on `pool` (the relaxed processingPool),
 * serially. Fleet-wide-singleton via a Postgres advisory lock: an instance that
 * does not get the lock returns immediately. processSession is idempotent, so a
 * row a live inline run owns throws `already_processing` and is skipped.
 */
export async function sweepStuckSessions(
  pool: Pool,
  opts: { limit?: number; processFn?: typeof processSession } = {}
): Promise<{ swept: number; locked: boolean }> {
  const limit = opts.limit ?? 50;
  const process = opts.processFn ?? processSession;
  const lockClient = await pool.connect();
  let locked = false;
  try {
    const lock = await lockClient.query(
      "SELECT pg_try_advisory_lock($1) AS ok",
      [SWEEP_ADVISORY_LOCK_KEY]
    );
    locked = lock.rows[0]?.ok === true;
    if (!locked) return { swept: 0, locked: false };

    const { rows } = await pool.query(`${buildStuckSessionsSql()} LIMIT $1`, [limit]);
    let swept = 0;
    for (const row of rows as Array<{ id: string; user_id: string }>) {
      try {
        const r = await process(row.id, row.user_id, { pool });
        if (!r?.skipped) swept++;
      } catch (err) {
        if (!(err instanceof Error && err.message === "already_processing")) {
          console.error(`[sweep] failed for ${row.id}:`, err);
        }
      }
    }
    return { swept, locked: true };
  } finally {
    if (locked) {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [SWEEP_ADVISORY_LOCK_KEY]);
    }
    lockClient.release();
  }
}
```

- [ ] **Step 4: Run tests + build + lint**

Run: `cd cloud-sql/api && npm test 2>&1 | grep -E "pass|fail" && npm run build 2>&1 | tail -2 && npx eslint src/ 2>&1 | tail -2`
Expected: all pass, tsc clean, 0 eslint errors.

- [ ] **Step 5: Commit**

```bash
git add cloud-sql/api/src/processing.ts cloud-sql/api/src/__tests__/sweep-stuck-sessions.test.ts
git commit -m "feat(api): sweepStuckSessions (advisory-lock-guarded all-user drain)"
```

---

### Task 4: Boot-time sweep timer

**Files:**
- Modify: `cloud-sql/api/src/index.ts` (imports 1-9; the `NODE_ENV !== "test"` block 34-39)

**Interfaces:**
- Consumes: `processingPool` (Task 1), `sweepStuckSessions` (Task 3).
- Produces: nothing (side-effecting interval).

- [ ] **Step 1: Add imports** — `src/index.ts` after the existing route imports (after line 9):

```ts
import { processingPool } from "./db";
import { sweepStuckSessions } from "./processing";
```

- [ ] **Step 2: Start the interval inside the existing non-test block** — in the `if (process.env.NODE_ENV !== "test") {` block (line 34), after `app.listen(...)`:

```ts
  // Background safety-net: finish any session left 'pending'/'failed'/stale by an
  // inline run that hit the web pool's 30s budget. Advisory-lock-guarded inside
  // sweepStuckSessions so only one instance sweeps at a time. Needs Cloud Run
  // --no-cpu-throttling so the timer runs between requests (Task 5).
  const sweepIntervalMs = Number(process.env.SWEEP_INTERVAL_MS) || 120_000;
  let isSweeping = false;
  setInterval(async () => {
    if (isSweeping) return; // never overlap on the same instance
    isSweeping = true;
    try {
      await sweepStuckSessions(processingPool);
    } catch (err) {
      console.error("[sweep] tick failed:", err);
    } finally {
      isSweeping = false;
    }
  }, sweepIntervalMs);
```

- [ ] **Step 3: Build + lint**

Run: `cd cloud-sql/api && npm run build 2>&1 | tail -2 && npx eslint src/ 2>&1 | tail -2`
Expected: tsc clean, 0 eslint errors. (No unit test — exercised via manual post-deploy validation in Task 5; the interval is skipped under `NODE_ENV=test`.)

- [ ] **Step 4: Run full test suite (regression)**

Run: `cd cloud-sql/api && npm test 2>&1 | grep -E "tests |pass |fail "`
Expected: 0 fail.

- [ ] **Step 5: Commit**

```bash
git add cloud-sql/api/src/index.ts
git commit -m "feat(api): start advisory-locked stuck-session sweep timer on boot"
```

---

### Task 5: Deploy config + ship + validate

**Files:**
- Modify: `cloud-sql/api`-deploy flags in `.github/workflows/deploy.yml` (the `flags:` line ~90)

**Interfaces:** none.

- [ ] **Step 1: Add `--no-cpu-throttling` to the workflow** — in `.github/workflows/deploy.yml`, change the `flags:` line for the `deploy-cloudrun` step to include `--no-cpu-throttling`:

```yaml
          flags: '--memory=512Mi --cpu=1 --concurrency=20 --min-instances=1 --max-instances=6 --no-cpu-throttling'
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci(api): --no-cpu-throttling so the sweep timer runs between requests"
```

- [ ] **Step 3: Merge to main + push (triggers CI deploy)**

```bash
cd cloud-sql/api && git checkout main && git merge --ff-only feat/async-processing-safety-net
git push origin main
```

- [ ] **Step 4: Manual deploy with the new flag** (mirrors CI, ensures it's live now):

```bash
cd /Users/josiahm/projects/peaks/firebase && gcloud run deploy peaks-api \
  --source cloud-sql/api --region us-central1 \
  --memory=512Mi --cpu=1 --concurrency=20 --min-instances=1 --max-instances=6 --no-cpu-throttling \
  --set-env-vars INSTANCE_CONNECTION_NAME=donner-a8608:us-central1:peaks-db,DB_NAME=peaks,DB_USER=peaks-api,DB_POOL_MAX=4,DB_POOL_CONNECTION_TIMEOUT_MS=5000 \
  --set-secrets DB_PASS=peaks-db-password:latest,SLACK_WEBHOOK_URL=SLACK_WEBHOOK_URL:latest --quiet
```

- [ ] **Step 5: Validate** — health, and that the sweep ticks without errors:

```bash
curl -s -o /dev/null -w "health:%{http_code}\n" https://peaks-api-726404093396.us-central1.run.app/health
# wait ~3 min for a couple of sweep ticks, then confirm NO new statement-timeout / sweep errors:
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="peaks-api" AND (textPayload:"[sweep]" OR textPayload:"statement timeout")' --freshness=5m --limit=10 --format='value(timestamp,textPayload)'
```
Expected: health 200; no `[sweep] failed`/`tick failed` and no `statement timeout` lines (steady state has 0 stuck sessions, so sweeps are silent no-ops).

---

## Self-Review

**Spec coverage:** isolated pool (Task 1) ✓; pool-parameterized processSession/processPlan + timeout→pending (Task 2) ✓; buildStuckSessionsSql + advisory-locked sweep (Task 3) ✓; boot timer + isSweeping guard (Task 4) ✓; `--no-cpu-throttling` deploy (Task 5) ✓; tests for config/classifier/SQL/sweep (Tasks 1-3) ✓. Connection-budget guarantee = advisory lock (Task 3) ✓.

**Placeholder scan:** none — all steps carry real code/commands.

**Type consistency:** `processSession(id, uid, { force?, pool? })` and `processPlan(id, uid, { pool? })` defined in Task 2 and consumed by `sweepStuckSessions` (Task 3, via `processFn: typeof processSession`) and the timer (Task 4). `processingPool`/`buildProcessingPoolConfig` defined Task 1, consumed Tasks 3-4. `buildStuckSessionsSql`/`sweepStuckSessions`/`SWEEP_ADVISORY_LOCK_KEY` defined Task 3, consumed Task 4. Consistent.
