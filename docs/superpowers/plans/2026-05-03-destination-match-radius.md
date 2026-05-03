# Per-Feature Destination Match Radius Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize the per-feature destination match radius into a single SQL function, raise the radius for `waterfall` and `viewpoint` to 200m, and backfill `session_destinations` for the 430 already-imported WA waterfalls so the new radius takes effect retroactively.

**Architecture:** A new `destination_match_radius(features destination_feature[]) RETURNS int LANGUAGE sql IMMUTABLE` function replaces the inline CASE expression at three call sites (the auto-link trigger, the API session-processing query, the web backfill helper). The migration also runs a one-shot INSERT against `session_destinations` to retroactively credit any session that passed within 50-200m of an already-imported waterfall. `IMMUTABLE` lets Postgres inline the function during planning so there's no per-row overhead vs the original inline CASE.

**Tech Stack:** PostgreSQL 15 + PostGIS, TypeScript, Cloud SQL Auth Proxy.

**Spec:** `docs/superpowers/specs/2026-05-03-destination-match-radius-design.md`

**Testing note:** The `cloud-sql/api/` package has tests (Jest, see `cloud-sql/api/src/__tests__/`). The `cloud-sql/migrate/` and `web/` packages do not. The verification pattern for SQL/processing changes is: build + lint + run the existing test suite + manual SQL spot checks. The function correctness is verifiable via direct `SELECT destination_match_radius(...)` calls.

---

## File Map

**Create:**
- `cloud-sql/migrations/20260503_destination_match_radius.sql` — defines the function, replaces the trigger function body, runs the waterfall backfill INSERT.

**Modify:**
- `cloud-sql/schema.sql` — add the `destination_match_radius` function definition above the existing `link_sessions_on_destination_insert` (around line 514), and update the trigger function body to call it instead of the inline CASE.
- `cloud-sql/api/src/processing.ts` — at lines 35-41, replace inline CASE with `destination_match_radius(d.features)`. Update the per-feature thresholds comment at lines 21-22.
- `web/src/lib/destination-backfill.ts` — at lines 33-39, replace inline CASE with `destination_match_radius(d.features)`. Update the JSDoc comment at lines 13-17.

---

## Task 1: Migration — function, trigger update, waterfall backfill

**Files:**
- Create: `cloud-sql/migrations/20260503_destination_match_radius.sql`
- Modify: `cloud-sql/schema.sql` (add function above line 516, update trigger body at lines 516-537)

- [ ] **Step 1: Capture BEFORE count of waterfall session-links**

Pre-condition: Cloud SQL Auth Proxy must be running (`cloud-sql-proxy donner-a8608:us-central1:peaks-db --port 5432 &` then `until nc -z 127.0.0.1 5432; do sleep 1; done`).

Run:

```bash
PGPASSWORD="$(gcloud secrets versions access latest --secret=peaks-db-postgres-password --project=donner-a8608)" \
  /opt/homebrew/opt/libpq/bin/psql -h 127.0.0.1 -p 5432 -U postgres -d peaks -c \
  "SELECT count(*) AS before_count FROM session_destinations sd JOIN destinations d ON d.id = sd.destination_id WHERE 'waterfall' = ANY(d.features) AND d.state_code = 'WA';"
```

Record the count. You'll compare against the post-migration count to confirm the backfill worked.

- [ ] **Step 2: Create the migration file**

Write `cloud-sql/migrations/20260503_destination_match_radius.sql`:

```sql
-- Centralize per-feature destination match radius into a SQL function so
-- the trigger, the API session-processing query, and the web backfill
-- helper all read from one source of truth. Bumps waterfall and viewpoint
-- to 200m so credit reflects "saw the destination" rather than "stood on
-- its OSM coordinate".

CREATE OR REPLACE FUNCTION destination_match_radius(features destination_feature[])
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN 'summit'    = ANY(features) THEN 30
    WHEN 'trailhead' = ANY(features) THEN 100
    WHEN 'waterfall' = ANY(features) THEN 200
    WHEN 'viewpoint' = ANY(features) THEN 200
    ELSE 50
  END;
$$;

-- Update the auto-link trigger to use the function. The boundary fallback
-- (10m of polygon) stays inline because it's structurally different.
CREATE OR REPLACE FUNCTION link_sessions_on_destination_insert()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO session_destinations (session_id, destination_id, relation, source)
    SELECT DISTINCT tp.session_id, NEW.id, 'reached'::session_destination_relation, 'auto'
    FROM tracking_points tp
    JOIN tracking_sessions ts ON ts.id = tp.session_id
    WHERE ts.ended = true
      AND CASE WHEN NEW.boundary IS NOT NULL
            THEN ST_DWithin(NEW.boundary, tp.location, 10)
            ELSE ST_DWithin(NEW.location, tp.location, destination_match_radius(NEW.features))
          END
    ON CONFLICT (session_id, destination_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill: retroactively credit sessions that passed within 50-200m of
-- already-imported waterfalls. Idempotent via ON CONFLICT.
INSERT INTO session_destinations (session_id, destination_id, relation, source)
SELECT s.id, d.id, 'reached', 'auto'
FROM tracking_sessions s
JOIN destinations d ON (d.owner = 'peaks' OR d.owner = s.user_id)
WHERE 'waterfall' = ANY(d.features)
  AND s.path IS NOT NULL
  AND ST_DWithin(s.path, d.location, 200)
ON CONFLICT (session_id, destination_id) DO NOTHING;
```

- [ ] **Step 3: Update `cloud-sql/schema.sql` — add the function above the trigger**

In `cloud-sql/schema.sql`, find the line immediately above `CREATE OR REPLACE FUNCTION link_sessions_on_destination_insert()` (around line 516). Add this block before the existing function:

```sql
-- Per-feature reach threshold (meters). IMMUTABLE so Postgres inlines the
-- function during planning — no per-row overhead vs an inline CASE.
-- Source of truth for: link_sessions_on_destination_insert (this file),
-- matchDestinations (cloud-sql/api/src/processing.ts), and
-- backfillDestinationToSessions (web/src/lib/destination-backfill.ts).
CREATE OR REPLACE FUNCTION destination_match_radius(features destination_feature[])
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN 'summit'    = ANY(features) THEN 30
    WHEN 'trailhead' = ANY(features) THEN 100
    WHEN 'waterfall' = ANY(features) THEN 200
    WHEN 'viewpoint' = ANY(features) THEN 200
    ELSE 50
  END;
$$;

```

- [ ] **Step 4: Update `cloud-sql/schema.sql` — replace the trigger function body**

In `cloud-sql/schema.sql`, find the existing `link_sessions_on_destination_insert` function (lines 516-537 in the pre-edit file; positions will shift after Step 3). Replace the entire function definition (from `CREATE OR REPLACE FUNCTION link_sessions_on_destination_insert()` through `$$ LANGUAGE plpgsql;`) with:

```sql
CREATE OR REPLACE FUNCTION link_sessions_on_destination_insert()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO session_destinations (session_id, destination_id, relation, source)
    SELECT DISTINCT tp.session_id, NEW.id, 'reached'::session_destination_relation, 'auto'
    FROM tracking_points tp
    JOIN tracking_sessions ts ON ts.id = tp.session_id
    WHERE ts.ended = true
      AND CASE WHEN NEW.boundary IS NOT NULL
            THEN ST_DWithin(NEW.boundary, tp.location, 10)
            ELSE ST_DWithin(NEW.location, tp.location, destination_match_radius(NEW.features))
          END
    ON CONFLICT (session_id, destination_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

The `CREATE TRIGGER trg_destination_link_sessions` statement immediately below it should NOT be touched.

- [ ] **Step 5: Apply the migration to prod**

Pre-condition: proxy still running from Step 1.

```bash
PGPASSWORD="$(gcloud secrets versions access latest --secret=peaks-db-postgres-password --project=donner-a8608)" \
  /opt/homebrew/opt/libpq/bin/psql -h 127.0.0.1 -p 5432 -U postgres -d peaks \
  -f cloud-sql/migrations/20260503_destination_match_radius.sql
```

Expected output (in order):
- `CREATE FUNCTION` (the new `destination_match_radius`)
- `CREATE FUNCTION` (the replaced `link_sessions_on_destination_insert`)
- `INSERT 0 N` where N is the number of newly-credited session→waterfall links (could be 0 if no sessions are within 200m of any waterfall yet, which is fine)

If you see `ERROR:` anywhere, STOP and report — do not proceed.

- [ ] **Step 6: Capture AFTER count and verify the function**

Run the same count query from Step 1:

```bash
PGPASSWORD="$(gcloud secrets versions access latest --secret=peaks-db-postgres-password --project=donner-a8608)" \
  /opt/homebrew/opt/libpq/bin/psql -h 127.0.0.1 -p 5432 -U postgres -d peaks -c \
  "SELECT count(*) AS after_count FROM session_destinations sd JOIN destinations d ON d.id = sd.destination_id WHERE 'waterfall' = ANY(d.features) AND d.state_code = 'WA';"
```

The after_count should be ≥ before_count. The delta = sessions newly credited by the 200m radius.

Then verify the function's outputs:

```bash
PGPASSWORD="$(gcloud secrets versions access latest --secret=peaks-db-postgres-password --project=donner-a8608)" \
  /opt/homebrew/opt/libpq/bin/psql -h 127.0.0.1 -p 5432 -U postgres -d peaks <<'SQL'
SELECT destination_match_radius(ARRAY['summit']::destination_feature[])    AS summit;     -- expect 30
SELECT destination_match_radius(ARRAY['trailhead']::destination_feature[]) AS trailhead;  -- expect 100
SELECT destination_match_radius(ARRAY['waterfall']::destination_feature[]) AS waterfall;  -- expect 200
SELECT destination_match_radius(ARRAY['viewpoint']::destination_feature[]) AS viewpoint;  -- expect 200
SELECT destination_match_radius(ARRAY['lake']::destination_feature[])      AS lake;       -- expect 50
SELECT destination_match_radius('{}'::destination_feature[])               AS empty;      -- expect 50
SQL
```

All six values must match the comments. If any don't, the migration didn't apply cleanly — investigate before continuing.

- [ ] **Step 7: Stop the proxy**

```bash
pkill -f cloud-sql-proxy
```

- [ ] **Step 8: Commit**

```bash
git add cloud-sql/migrations/20260503_destination_match_radius.sql cloud-sql/schema.sql
git commit -m "DB: centralize per-feature match radius, bump waterfall/viewpoint to 200m"
```

Report the before_count and after_count values in your task report so the next task can confirm the migration's effect.

---

## Task 2: Update TypeScript call sites to use the function

**Files:**
- Modify: `cloud-sql/api/src/processing.ts:21-22, 35-41`
- Modify: `web/src/lib/destination-backfill.ts:13-17, 33-39`

**Pre-condition:** Task 1 must have applied the migration (the function must exist in prod). Otherwise these TS changes will cause runtime errors when called against prod.

- [ ] **Step 1: Update `cloud-sql/api/src/processing.ts`**

Open `cloud-sql/api/src/processing.ts`. Locate the `matchDestinations` function (starts at line 27). Replace lines 21-22 (the comment block referring to per-feature thresholds):

```ts
 * Per-feature thresholds: summit 30m, trailhead 100m, else 50m, or 10m to
 * a destination's polygon boundary if one is defined.
```

with:

```ts
 * Per-feature thresholds live in the SQL function destination_match_radius()
 * (see cloud-sql/schema.sql). Boundary destinations use a 10m polygon match
 * regardless of feature.
```

Then in the SQL string starting at line 35, find:

```ts
       AND CASE WHEN d.boundary IS NOT NULL
             THEN ST_DWithin(s.path, d.boundary, 10)
             ELSE ST_DWithin(s.path, d.location,
                 CASE WHEN 'summit' = ANY(d.features) THEN 30
                      WHEN 'trailhead' = ANY(d.features) THEN 100
                      ELSE 50 END)
           END
```

Replace with:

```ts
       AND CASE WHEN d.boundary IS NOT NULL
             THEN ST_DWithin(s.path, d.boundary, 10)
             ELSE ST_DWithin(s.path, d.location, destination_match_radius(d.features))
           END
```

- [ ] **Step 2: Update `web/src/lib/destination-backfill.ts`**

Open `web/src/lib/destination-backfill.ts`. Replace lines 13-17 (the JSDoc block):

```ts
 * Per-feature radius matches matchDestinations() in cloud-sql/api/src/processing.ts:
 *   summit    → 30m
 *   trailhead → 100m
 *   else      → 50m
 *   boundary  → 10m of the polygon
```

with:

```ts
 * Per-feature radius is delegated to the SQL function destination_match_radius()
 * (see cloud-sql/schema.sql). Boundary destinations use a 10m polygon match
 * regardless of feature.
```

Then in the SQL string at lines 33-39, find:

```ts
       AND CASE WHEN d.boundary IS NOT NULL
             THEN ST_DWithin(s.path, d.boundary, 10)
             ELSE ST_DWithin(s.path, d.location,
                 CASE WHEN 'summit' = ANY(d.features) THEN 30
                      WHEN 'trailhead' = ANY(d.features) THEN 100
                      ELSE 50 END)
           END
```

Replace with:

```ts
       AND CASE WHEN d.boundary IS NOT NULL
             THEN ST_DWithin(s.path, d.boundary, 10)
             ELSE ST_DWithin(s.path, d.location, destination_match_radius(d.features))
           END
```

- [ ] **Step 3: Verify the API package builds, lints, and tests**

```bash
cd cloud-sql/api && npm run build
```

Expected: `tsc` exits with no errors.

```bash
cd cloud-sql/api && npx eslint src/
```

Expected: zero errors.

```bash
cd cloud-sql/api && npm test
```

Expected: all tests pass (in particular the BIGINT-parser regression test should still pass — `cloud-sql/api/src/__tests__/bigint-parser.test.ts`).

- [ ] **Step 4: Verify the web package builds and lints**

```bash
cd web && npm run build
```

Expected: Next.js build succeeds with no errors.

```bash
cd web && npm run lint
```

Expected: zero errors. Pre-existing `<img>` warnings are acceptable per `web/CLAUDE.md`.

- [ ] **Step 5: Commit**

```bash
git add cloud-sql/api/src/processing.ts web/src/lib/destination-backfill.ts
git commit -m "API+web: use destination_match_radius() function instead of inline CASE"
```

---

## Task 3: Push, watch CI, and final spot checks

**Files:** none (verification only)

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

- [ ] **Step 2: Find and watch the triggered CI run**

```bash
gh run list --limit 1
```

Note the run ID, then:

```bash
gh run watch <id> --exit-status
```

Expected: both `deploy-functions` and `deploy-api` jobs complete with status `completed` / conclusion `success`. Pre-existing annotations (Node 20 deprecation, unused `e` in `firebase.ts`, unused `AuthRequest` and `err`) are acceptable.

If a job fails, run `gh run view <id> --log-failed` and investigate before considering the task done.

- [ ] **Step 3: Verify the deployed API is healthy**

```bash
curl -s -o /dev/null -w "API /health: %{http_code} (%{time_total}s)\n" "https://peaks-api-qownl77soa-uc.a.run.app/health"
```

Expected: `API /health: 200`. If the deploy left the API broken (e.g., the new SQL function reference is misnamed), this check catches it.

- [ ] **Step 4: Functional spot check — exercise the function via the deployed API**

The API's `matchDestinations` function fires whenever a session is processed. Without recording a real session, we can still confirm the function is callable via a direct DB query through the proxy:

```bash
cloud-sql-proxy donner-a8608:us-central1:peaks-db --port 5432 &
until nc -z 127.0.0.1 5432; do sleep 1; done
PGPASSWORD="$(gcloud secrets versions access latest --secret=peaks-db-postgres-password --project=donner-a8608)" \
  /opt/homebrew/opt/libpq/bin/psql -h 127.0.0.1 -p 5432 -U postgres -d peaks <<'SQL'
-- Confirm function is callable
SELECT destination_match_radius(ARRAY['waterfall']::destination_feature[]) AS waterfall_radius;

-- Confirm trigger function references it correctly (will succeed even if there
-- are no rows to insert)
SELECT pg_get_functiondef('link_sessions_on_destination_insert'::regproc);
SQL
pkill -f cloud-sql-proxy
```

Expected:
- First query returns `200`.
- Second query's output (a SQL function body dump) contains the substring `destination_match_radius(NEW.features)`.

If either fails, the migration didn't apply cleanly — investigate before considering the work done.

- [ ] **Step 5: Final report**

Summarize: before_count and after_count from Task 1, CI run conclusion, API health check result, function spot-check result. Note the delta in waterfall session-links (after_count - before_count) — this is the immediate user-facing impact of the radius bump.
