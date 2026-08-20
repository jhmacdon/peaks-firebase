# Test-DB Debt Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five debt items the 2026-08-19 test-db provision run surfaced: two never-run migrate suites that fail on a correct database, two suites gated on the forbidden bare `DATABASE_URL` pattern, a missing `test:db` entry point and README for the migrate package, stale schema counts in two docs, and a checked-in trigger missing from production.

**Architecture:** All code changes live in `cloud-sql/migrate` (tests, one runner script, package.json), `.github/workflows/test-route-worker.yml`, and three docs. One production change: apply the already-merged `20260728_session_area_sync.sql` trigger migration to the live `peaks` database. No API or schema changes.

**Tech Stack:** Node 20 `node:test` + tsx, PostgreSQL 15 + PostGIS via Cloud SQL Auth Proxy, bash, GitHub Actions.

**Spec:** `docs/superpowers/plans/2026-08-19-testdb-debt-report.md` (the provision-run report; committed alongside this plan in Task 0).

## Global Constraints

- Base branch: `origin/main` at `c1ed4e7` of `github.com/jhmacdon/peaks-firebase`. Work in the worktree created in Task 0; never touch the dirty main checkout at `/Users/josiahm/projects/peaks/firebase`.
- Every database URL a test can act on must name a database ending in `_test` (rule in `cloud-sql/CLAUDE.md`; enforced by `api/src/db.ts` and `test-db/provision.sh`).
- Never relax `cloud-sql/test-db/grants.sql`. It mirrors production's `peaks-api` grant set; the test role must not gain DDL on schema `public`.
- Verification database: `peaks_test` on the shared Cloud SQL instance, reached through the Auth Proxy already listening on `127.0.0.1:5432`. It was provisioned 2026-08-19 from a tree whose `cloud-sql/migrations/` and `schema.sql` are byte-identical to `origin/main` (verified with `git diff --stat 9652dd0 origin/main -- cloud-sql/migrations/ cloud-sql/schema.sql` → empty). Do NOT re-provision; it takes ~12 minutes and is already correct.
- Build the test URL in every DB-backed step exactly like this:

```bash
export CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.14
export TEST_URL="postgres://peaks_test:$(gcloud secrets versions access latest --secret=peaks-test-db-password)@127.0.0.1:5432/peaks_test"
```

- Production access (Task 6 only): same proxy, database `peaks`, user `postgres`, password from `gcloud secrets versions access latest --secret=peaks-db-postgres-password`. Production is read-only for every task except Task 6's single migration apply.
- If `git push` fails with `failed to get: -25293` / "could not read Username", unlock the build keychain first:

```bash
security unlock-keychain -p <build-keychain password — see ~/.claude/CLAUDE.md "Git auth"> /Users/josiahm/Library/Keychains/build/signing/koth-build.keychain-db
```

- Prose in docs follows Orwell's rules (short words, active voice, cut every needless word).

## Decisions already made (do not re-litigate)

1. **route-integrity-repairs** applies its migration itself, as the test role, which needs DDL the grant mirror is designed to withhold. `test-db/provision.sh` already applies `20260803_route_integrity_repairs.sql` as the admin role — locally AND in CI (`test-route-worker.yml` runs `provision.sh` against its service container). So the self-apply line is redundant everywhere it could ever run: **delete it, keep the test**. Do not create a per-test schema; do not relax grants.
2. **protected-areas-linking** asserts an exact link list inside a one-degree fixture box that now contains 12 real catalog summits from `20260721_cascades_coverage_summits.sql`. The linking function is correct. **Scope the assertion to fixture-owned ids** (filter by the test's `runPrefix`); do not shrink the box (any future data migration could re-break it).
3. The two legacy suites gate AND connect on bare `DATABASE_URL` with no `_test` check — the pattern `cloud-sql/CLAUDE.md` forbids. **Rename the gate to `AREAS_LINKING_TEST_DATABASE_URL` (one var for both suites) and assert the database name ends in `_test` before the first query.** Verified: nothing outside these two test files references their `DATABASE_URL` usage.
4. **Production is missing `trg_session_areas_touch_session`.** Verified 2026-08-19 against live `peaks`: function `touch_related_tracking_session()` exists; `session_destinations`, `session_routes`, and `session_markers` all carry touch triggers wired to it; `session_areas` has NO trigger (650 rows). So area relinks never bump session timestamps and `/sessions/changes` pollers miss them — exactly what the merged migration `20260728_session_area_sync.sql` fixes. The migration is transactional and idempotent (`DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` inside `BEGIN/COMMIT`). **Apply it to prod as `postgres`** (Task 6). Rollback if ever needed: `DROP TRIGGER trg_session_areas_touch_session ON session_areas;`.
5. CI switches from three hand-listed env vars to `npm run test:db` with one `TEST_DATABASE_URL`, so the runner script is the single source of the var fan-out and every DB suite runs in CI from now on.

---

### Task 0: Worktree + baseline

**Files:**
- Create: worktree `/Users/josiahm/projects/peaks/.worktrees/testdb-debt`, branch `testdb-debt` off `origin/main`
- Copy in + commit: `docs/superpowers/plans/2026-08-19-testdb-debt.md`, `docs/superpowers/plans/2026-08-19-testdb-debt-report.md`

**Interfaces:**
- Produces: `WT=/Users/josiahm/projects/peaks/.worktrees/testdb-debt`, used by every later task. Node deps installed in `$WT/cloud-sql/migrate`.

- [ ] **Step 1: Create the worktree**

```bash
cd /Users/josiahm/projects/peaks/firebase
git worktree add /Users/josiahm/projects/peaks/.worktrees/testdb-debt -b testdb-debt origin/main
```

- [ ] **Step 2: Install migrate dependencies**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/testdb-debt/cloud-sql/migrate && npm ci
```

- [ ] **Step 3: Commit the plan + spec into the branch**

```bash
cd /Users/josiahm/projects/peaks/.worktrees/testdb-debt
mkdir -p docs/superpowers/plans
cp /Users/josiahm/projects/peaks/firebase/docs/superpowers/plans/2026-08-19-testdb-debt.md docs/superpowers/plans/
cp /Users/josiahm/projects/peaks/firebase/docs/superpowers/plans/2026-08-19-testdb-debt-report.md docs/superpowers/plans/
git add docs/superpowers/plans && git commit -m "docs: add test-db debt plan and provision report"
```

---

### Task 1: Areas-linking suites — dedicated gate, `_test` guard, fixture-scoped assertion

**Files:**
- Modify: `cloud-sql/migrate/src/__tests__/protected-areas-linking.test.ts`
- Modify: `cloud-sql/migrate/src/__tests__/route-areas-linking.test.ts`

**Interfaces:**
- Consumes: `$WT`, `$TEST_URL` (Global Constraints).
- Produces: both suites gate on `AREAS_LINKING_TEST_DATABASE_URL` (Tasks 3 and 4 fan that var out). No file exports change.

- [ ] **Step 1: Reproduce both defects (red)**

```bash
cd $WT/cloud-sql/migrate
DATABASE_URL="$TEST_URL" npx tsx --test src/__tests__/protected-areas-linking.test.ts
```

Expected: FAIL — `deepStrictEqual` lists ~12 extra `destination_id`s (real cascades summits) beyond the three fixture ids. (If you prefer the project's exact runner: `DATABASE_URL="$TEST_URL" node --test --import tsx src/__tests__/protected-areas-linking.test.ts` — same result.)

- [ ] **Step 2: Rewrite the gate in `protected-areas-linking.test.ts`**

Replace lines 5–7:

```ts
const skipReason = process.env.DATABASE_URL
  ? null
  : "DATABASE_URL not set - skipping PostGIS integration tests";
```

with:

```ts
const TEST_DATABASE_URL = process.env.AREAS_LINKING_TEST_DATABASE_URL;
const skipReason = TEST_DATABASE_URL
  ? null
  : "AREAS_LINKING_TEST_DATABASE_URL not set - skipping PostGIS integration tests";
```

Replace the pool construction (lines 19–21):

```ts
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
```

with:

```ts
const pool = TEST_DATABASE_URL
  ? new Pool({ connectionString: TEST_DATABASE_URL })
  : null;
```

- [ ] **Step 3: Add the `_test` guard as the first act of `before()`**

In the same file, the `before` hook currently starts:

```ts
  before(async () => {
    if (!pool) return;
    client = await pool.connect();
```

Insert the guard between `if (!pool) return;` and `client = await pool.connect();`:

```ts
    assert.match(
      new URL(TEST_DATABASE_URL!).pathname,
      /_test$/,
      "areas linking tests require a disposable *_test database"
    );
```

(The file already imports `assert` via `import { strict as assert } from "node:assert";` — `assert.match` is available. The guard must run BEFORE `pool.connect()` so a mispointed URL fails on the name, never on a connection.)

- [ ] **Step 4: Scope the assertion to fixture ids**

In the test body, replace:

```ts
    const linkedIds = rows.rows.map((row) => row.destination_id);

    // inside + on-boundary + ~31 m outside (tolerance) link; trailhead + ~100 m
    // outside summit do not.
    assert.deepEqual(linkedIds, [boundaryId, insideId, nearId].sort());
```

with:

```ts
    const linkedIds = rows.rows.map((row) => row.destination_id);
    // Catalog summits from data migrations (e.g. 20260721_cascades_coverage_
    // summits.sql) also sit inside this one-degree box and link correctly, so
    // only fixture-owned ids are asserted exactly.
    const fixtureLinkedIds = linkedIds.filter((id) => id.startsWith(runPrefix));

    // inside + on-boundary + ~31 m outside (tolerance) link; trailhead + ~100 m
    // outside summit do not.
    assert.deepEqual(fixtureLinkedIds, [boundaryId, insideId, nearId].sort());
```

Leave the following `assert.ok(!linkedIds.includes(trailheadId))` and `assert.ok(!linkedIds.includes(farId))` lines untouched — they still check the full list.

- [ ] **Step 5: Make the same gate + guard change in `route-areas-linking.test.ts`**

Same three edits as Steps 2–3, same wording (its lines 5–7 and 14–16 are identical apart from the pool lines being one line higher; its `before` also starts `if (!pool) return;` then `client = await pool.connect();`). Use the identical guard message. This file's assertions are already scoped to its own `routeId` — do not touch them.

- [ ] **Step 6: Run both suites (green)**

```bash
cd $WT/cloud-sql/migrate
AREAS_LINKING_TEST_DATABASE_URL="$TEST_URL" node --test --import tsx \
  src/__tests__/protected-areas-linking.test.ts src/__tests__/route-areas-linking.test.ts
```

Expected: PASS, 0 fail, 0 skip.

- [ ] **Step 7: Prove the guard fires before any connection**

```bash
AREAS_LINKING_TEST_DATABASE_URL="postgres://nobody:nothing@127.0.0.1:9/peaks" \
  node --test --import tsx src/__tests__/protected-areas-linking.test.ts
```

Expected: FAIL with "areas linking tests require a disposable *_test database" — NOT a connection error (port 9 is unreachable; reaching a connection error would mean the guard ran too late).

- [ ] **Step 8: Confirm bare DATABASE_URL no longer wakes the suites**

```bash
DATABASE_URL="$TEST_URL" node --test --import tsx src/__tests__/protected-areas-linking.test.ts
```

Expected: PASS with the suite SKIPPED (skip message names `AREAS_LINKING_TEST_DATABASE_URL`).

- [ ] **Step 9: Commit**

```bash
cd $WT
git add cloud-sql/migrate/src/__tests__/protected-areas-linking.test.ts cloud-sql/migrate/src/__tests__/route-areas-linking.test.ts
git commit -m "test(migrate): retire bare DATABASE_URL gate in areas-linking suites

Gate and connect on AREAS_LINKING_TEST_DATABASE_URL, assert the database
name ends in _test before the first query, and scope the protected-areas
assertion to fixture ids so real catalog summits inside the one-degree
fixture box no longer fail it."
```

---

### Task 2: route-integrity-repairs — rely on provisioning for the migration

**Files:**
- Modify: `cloud-sql/migrate/src/__tests__/route-integrity-repairs.integration.test.ts`

**Interfaces:**
- Consumes: `$WT`, `$TEST_URL`. Provisioned schema already contains every object `20260803_route_integrity_repairs.sql` creates (`route_integrity_repairs` table, `peaks_route_passes_publish_integrity`, `settle_route_integrity_replacement`, its trigger and indexes).
- Produces: the suite passes under the documented grant set. Task 4 turns it on in CI.

- [ ] **Step 1: Reproduce the failure (red)**

```bash
cd $WT/cloud-sql/migrate
ROUTE_INTEGRITY_REPAIR_TEST_DATABASE_URL="$TEST_URL" node --test --import tsx \
  src/__tests__/route-integrity-repairs.integration.test.ts
```

Expected: FAIL with `permission denied for schema public` (code 42501) from the self-apply line.

- [ ] **Step 2: Delete the self-apply and its now-dead scaffolding**

Three edits:

1. In the `try` block, delete the line:

```ts
      await pool.query(await readFile(REPAIR_MIGRATION, "utf8"));
```

2. Delete the constant (near the top):

```ts
const REPAIR_MIGRATION = join(MIGRATE_ROOT, "../migrations/20260803_route_integrity_repairs.sql");
```

3. Remove `readFile` from the imports — delete the whole line `import { readFile } from "node:fs/promises";` (verify with `grep -n readFile` that no other use remains; `join` stays, it builds `MIGRATE_ROOT` and the `command()` paths).

Add one comment where the self-apply used to be, at the top of the `try` block:

```ts
      // 20260803_route_integrity_repairs.sql is applied by test-db/provision.sh
      // as the admin role (locally and in CI). The test role deliberately holds
      // no DDL on schema public — see test-db/grants.sql.
```

- [ ] **Step 3: Run the suite (green)**

```bash
ROUTE_INTEGRITY_REPAIR_TEST_DATABASE_URL="$TEST_URL" node --test --import tsx \
  src/__tests__/route-integrity-repairs.integration.test.ts
```

Expected: PASS, 1 test, ~6s.

- [ ] **Step 4: Commit**

```bash
cd $WT
git add cloud-sql/migrate/src/__tests__/route-integrity-repairs.integration.test.ts
git commit -m "test(migrate): stop applying the integrity migration as the test role

provision.sh already applies 20260803_route_integrity_repairs.sql as the
admin role, locally and in the CI container. Self-applying it needed CREATE
on schema public, which grants.sql withholds on purpose, so the suite could
never pass anywhere."
```

---

### Task 3: `test:db` runner for the migrate package

**Files:**
- Create: `cloud-sql/migrate/scripts/test-db.sh` (executable)
- Modify: `cloud-sql/migrate/package.json` (one script line)

**Interfaces:**
- Consumes: the six per-suite env vars (five existing + Task 1's `AREAS_LINKING_TEST_DATABASE_URL`).
- Produces: `npm run test:db` — takes `TEST_DATABASE_URL`, fans it out, runs the whole suite; extra args select individual files (`npm run test:db -- src/__tests__/foo.test.ts`). Task 4 (CI) and Task 5 (docs) depend on this exact contract.

- [ ] **Step 1: Write the runner**

Create `cloud-sql/migrate/scripts/test-db.sh`:

```bash
#!/usr/bin/env bash
#
# Run the migrate suite with every DB-backed test switched on.
#
# TEST_DATABASE_URL supplies one connection string; this script fans it out to
# the per-suite variables below. Any of those can still be set individually to
# aim one suite somewhere else. Provision the database first — see
# cloud-sql/test-db/README.md.
#
# Usage:
#   TEST_DATABASE_URL=postgres://peaks_test:PASS@127.0.0.1:5432/peaks_test \
#     npm run test:db                                          # whole suite
#   ... npm run test:db -- src/__tests__/protected-areas-linking.test.ts

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${TEST_DATABASE_URL:?TEST_DATABASE_URL must be set — see cloud-sql/test-db/README.md}"

# Each suite and provision.sh enforce this too; failing here is just earlier.
db_path="${TEST_DATABASE_URL%%\?*}"
if [[ "$db_path" != *_test ]]; then
  echo "refusing: TEST_DATABASE_URL must name a database ending in _test" >&2
  exit 1
fi

export ROUTE_JOB_TEST_DATABASE_URL="${ROUTE_JOB_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"
export ROUTE_AUDIT_JOB_TEST_DATABASE_URL="${ROUTE_AUDIT_JOB_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"
export ROUTE_ELEVATION_JOB_TEST_DATABASE_URL="${ROUTE_ELEVATION_JOB_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"
export ROUTE_INTEGRITY_REPAIR_TEST_DATABASE_URL="${ROUTE_INTEGRITY_REPAIR_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"
export DESTINATION_SESSION_LINK_TEST_DATABASE_URL="${DESTINATION_SESSION_LINK_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"
export AREAS_LINKING_TEST_DATABASE_URL="${AREAS_LINKING_TEST_DATABASE_URL:-$TEST_DATABASE_URL}"

if [[ $# -gt 0 ]]; then
  exec env NODE_ENV=test node --test --import tsx "$@"
fi
exec env NODE_ENV=test node --test --import tsx src/__tests__/*.test.ts
```

```bash
chmod +x $WT/cloud-sql/migrate/scripts/test-db.sh
```

- [ ] **Step 2: Wire it into package.json**

In `cloud-sql/migrate/package.json`, directly under the existing `"test"` line, add:

```json
    "test:db": "./scripts/test-db.sh",
```

- [ ] **Step 3: Verify the refusal path (no database touched)**

```bash
cd $WT/cloud-sql/migrate
TEST_DATABASE_URL="postgres://u:p@127.0.0.1:5432/peaks" npm run test:db; echo "exit=$?"
```

Expected: exit=1, output contains `refusing: TEST_DATABASE_URL must name a database ending in _test`, zero tests run.

- [ ] **Step 4: Verify the targeted-file path against the real test DB**

```bash
TEST_DATABASE_URL="$TEST_URL" npm run test:db -- src/__tests__/protected-areas-linking.test.ts
```

Expected: PASS, suite runs (not skipped) — proving the fan-out reached `AREAS_LINKING_TEST_DATABASE_URL`.

- [ ] **Step 5: Commit**

```bash
cd $WT
git add cloud-sql/migrate/scripts/test-db.sh cloud-sql/migrate/package.json
git commit -m "feat(migrate): add test:db runner that fans one URL out to every DB suite"
```

---

### Task 4: CI runs every DB-backed migrate suite

**Files:**
- Modify: `.github/workflows/test-route-worker.yml` (the "Build and test" step only)

**Interfaces:**
- Consumes: Task 3's `npm run test:db` contract.
- Produces: CI coverage for the two never-run suites (route-integrity-repairs, areas-linking) plus an explicit gate for destination-session-link (today it only runs via its fallback to `ROUTE_ELEVATION_JOB_TEST_DATABASE_URL`).

- [ ] **Step 1: Replace the hand-listed env fan-out**

Current step:

```yaml
      - name: Build and test
        run: |
          npm run build
          npm test
        working-directory: cloud-sql/migrate
        env:
          ROUTE_JOB_TEST_DATABASE_URL: postgres://peaks_test:peaks_test@localhost:5432/peaks_test
          ROUTE_AUDIT_JOB_TEST_DATABASE_URL: postgres://peaks_test:peaks_test@localhost:5432/peaks_test
          ROUTE_ELEVATION_JOB_TEST_DATABASE_URL: postgres://peaks_test:peaks_test@localhost:5432/peaks_test
```

New step:

```yaml
      - name: Build and test
        run: |
          npm run build
          npm run test:db
        working-directory: cloud-sql/migrate
        env:
          TEST_DATABASE_URL: postgres://peaks_test:peaks_test@localhost:5432/peaks_test
```

- [ ] **Step 2: Validate the YAML parses**

```bash
cd $WT && python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/test-route-worker.yml')); print('yaml ok')"
```

Expected: `yaml ok`. (If PyYAML is missing, `npx yaml-lint .github/workflows/test-route-worker.yml` or `node -e "require('$WT/cloud-sql/migrate/node_modules/js-yaml')"`-style checks are NOT set up — fall back to `ruby -ryaml -e "YAML.load_file('.github/workflows/test-route-worker.yml'); puts 'yaml ok'"`, which macOS ships.)

- [ ] **Step 3: Run the exact commands CI will run, locally**

```bash
cd $WT/cloud-sql/migrate
npm run build
TEST_DATABASE_URL="$TEST_URL" npm run test:db 2>&1 | tail -20
```

Expected: build clean; full suite PASS — roughly 379 tests, `fail 0`, `skipped 0`, ~5–6 minutes. This is also the plan's whole-suite verification gate: every previously-failing or never-run suite is green in one run.

- [ ] **Step 4: Commit**

```bash
cd $WT
git add .github/workflows/test-route-worker.yml
git commit -m "ci: run every DB-backed migrate suite via test:db

route-integrity-repairs and the two areas-linking suites had no gate
variable in any workflow, so CI had never run them."
```

---

### Task 5: Docs — migrate README, test-db README, CLAUDE.md counts

**Files:**
- Create: `cloud-sql/migrate/README.md`
- Modify: `cloud-sql/test-db/README.md` (two spots)
- Modify: `cloud-sql/CLAUDE.md` (one sentence)

**Interfaces:**
- Consumes: Task 3's runner contract and var table; measured counts from the spec report (41 tables, 1 application view, 392 columns, 22 triggers, measured 2026-08-19).

- [ ] **Step 1: Write `cloud-sql/migrate/README.md`**

```markdown
# peaks-migrate

Firestore → PostGIS backfill scripts, data importers, and the route-factory
job workers. See `package.json` scripts for the full command list.

## Tests

```bash
npm test          # no database needed; DB-backed suites skip
npm run test:db   # everything, against a provisioned *_test database
```

`test:db` wants one variable and fans it out to every DB-backed suite:

```bash
export TEST_DATABASE_URL="postgres://peaks_test:$(gcloud secrets versions access latest --secret=peaks-test-db-password)@127.0.0.1:5432/peaks_test"
npm run test:db
npm run test:db -- src/__tests__/protected-areas-linking.test.ts   # one file
```

Provision the database first — see `../test-db/README.md`. The URL must name a
database ending in `_test`; the runner and each suite refuse anything else.

## Per-suite variables

`test:db` sets these from `TEST_DATABASE_URL` unless already set. Setting one
by hand (with plain `npm test`) switches only its suites on.

| Variable | Suites |
|---|---|
| `ROUTE_JOB_TEST_DATABASE_URL` | standard-route-claim, standard-route-requeue |
| `ROUTE_AUDIT_JOB_TEST_DATABASE_URL` | route-catalog-audit-jobs |
| `ROUTE_ELEVATION_JOB_TEST_DATABASE_URL` | route-elevation-jobs |
| `ROUTE_INTEGRITY_REPAIR_TEST_DATABASE_URL` | route-integrity-repairs |
| `DESTINATION_SESSION_LINK_TEST_DATABASE_URL` | destination-session-link-update (falls back to `ROUTE_ELEVATION_JOB_TEST_DATABASE_URL`) |
| `AREAS_LINKING_TEST_DATABASE_URL` | protected-areas-linking, route-areas-linking |

There is no bare `DATABASE_URL` gate. There used to be; `cloud-sql/CLAUDE.md`
explains why it must not come back.

CI runs the whole set: `.github/workflows/test-route-worker.yml` provisions a
throwaway PostGIS container with `test-db/provision.sh`, then runs
`npm run test:db`.
```

- [ ] **Step 2: Fix `cloud-sql/test-db/README.md`**

Edit 1 — under "Then run the suite:" (the api block ending in `npm run test:db`), append a migrate block so the README stops documenting the api path alone:

```markdown
The migrate package has DB-backed suites too, behind its own `test:db`:

```bash
cd cloud-sql/migrate
export TEST_DATABASE_URL="postgres://peaks_test:$(gcloud secrets versions access latest --secret=peaks-test-db-password)@127.0.0.1:5432/peaks_test"
npm run test:db
```

Its per-suite variables are listed in `cloud-sql/migrate/README.md`.
```

Edit 2 — replace the stale counts sentence:

```markdown
`schema.sql` **and** `migrations/` reproduces live `peaks` exactly: 29 tables,
1 view, 292 columns, 17 triggers, all matching. (`data_source_runs` and the
`data_source_freshness` view arrived with `20260819_data_source_runs.sql`.)
```

(match the exact current wording in the file — it is one flowing paragraph) with:

```markdown
`schema.sql` **and** `migrations/` reproduces the live `peaks` schema: 41
tables, 1 application view (`data_source_freshness`), 392 columns and 22
triggers, measured 2026-08-19. Live `peaks` also carries nine backup and
worklist tables left over from the June 2026 area dedupe; they are not schema
and the provisioner rightly omits them. `provision.sh` prints table and
trigger counts every run, so drift shows up without a second tool.
```

- [ ] **Step 3: Fix the counts in `cloud-sql/CLAUDE.md`**

Replace, in the Testing section:

```markdown
  `peaks` exactly (29 tables, 1 view, 292 columns, 17 triggers).
```

with:

```markdown
  `peaks` exactly (41 tables, 1 view, 392 columns, 22 triggers as of
  2026-08-19; live `peaks` also holds nine junk tables from the June 2026
  dedupe that are not schema).
```

- [ ] **Step 4: Verify docs claims against reality**

```bash
export CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.14
PGPASSWORD="$(gcloud secrets versions access latest --secret=peaks-db-postgres-password)" \
psql -h 127.0.0.1 -p 5432 -U postgres -d peaks_test -tA <<'SQL'
SELECT 'tables ' || count(*) FROM pg_tables WHERE schemaname='public';
SELECT 'triggers ' || count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public';
SELECT 'columns ' || count(*) FROM information_schema.columns
  WHERE table_schema='public' AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname='public');
SQL
```

Expected: `tables 41`, `triggers 22`, `columns 392`. If any number differs, the docs get the measured number, not the plan's.

- [ ] **Step 5: Commit**

```bash
cd $WT
git add cloud-sql/migrate/README.md cloud-sql/test-db/README.md cloud-sql/CLAUDE.md
git commit -m "docs(cloud-sql): migrate test README, refresh stale schema counts"
```

---

### Task 6: Apply the session-areas touch trigger to production

**Files:** none in the repo — one idempotent DDL apply against live `peaks`, using the already-merged `cloud-sql/migrations/20260728_session_area_sync.sql`.

**Interfaces:**
- Consumes: proxy on `127.0.0.1:5432`, `postgres` password from Secret Manager (Global Constraints). Evidence in "Decisions already made" #4.

- [ ] **Step 1: Re-verify the pre-conditions (read-only)**

```bash
export CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.14
export PGPASSWORD="$(gcloud secrets versions access latest --secret=peaks-db-postgres-password)"
psql -h 127.0.0.1 -p 5432 -U postgres -d peaks -tA <<'SQL'
SELECT 'db: ' || current_database();
SELECT 'fn exists: ' || count(*) FROM pg_proc WHERE proname='touch_related_tracking_session';
SELECT 'trigger already there: ' || count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  WHERE c.relname='session_areas' AND t.tgname='trg_session_areas_touch_session';
SQL
```

Expected: `db: peaks`, `fn exists: 1`, `trigger already there: 0`. If the trigger count is already 1, someone applied it since 2026-08-19 — skip Step 2, still do Step 3, and note it in the PR body.

- [ ] **Step 2: Apply the migration**

```bash
cd $WT
psql -h 127.0.0.1 -p 5432 -U postgres -d peaks -v ON_ERROR_STOP=1 \
  -f cloud-sql/migrations/20260728_session_area_sync.sql
```

Expected: `DROP TRIGGER` / `CREATE TRIGGER` inside `BEGIN`/`COMMIT`, exit 0.

- [ ] **Step 3: Verify**

```bash
psql -h 127.0.0.1 -p 5432 -U postgres -d peaks -tA <<'SQL'
SELECT 'trigger: ' || tgname || ' enabled=' || tgenabled FROM pg_trigger t
  JOIN pg_class c ON c.oid=t.tgrelid
  WHERE c.relname='session_areas' AND t.tgname='trg_session_areas_touch_session';
SELECT 'prod triggers now: ' || count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public';
SQL
unset PGPASSWORD
```

Expected: `trigger: trg_session_areas_touch_session enabled=O` and `prod triggers now: 22` — production now matches `schema.sql` and the docs Task 5 just wrote. (Rollback, only if something misbehaves: `DROP TRIGGER trg_session_areas_touch_session ON session_areas;`.)

---

### Task 7: Push and open the PR

- [ ] **Step 1: Final whole-suite check** — only if any test file changed since Task 4's Step 3 full run; otherwise cite that run.

- [ ] **Step 2: Push (unlock keychain first if push fails — see Global Constraints)**

```bash
cd $WT && git push -u origin testdb-debt
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --repo jhmacdon/peaks-firebase --base main --head testdb-debt \
  --title "Fix never-run test-db suites, retire bare DATABASE_URL gates, add migrate test:db" \
  --body "$(cat <<'EOF'
The 2026-08-19 test-db provision run (report committed in this PR) surfaced pre-existing debt in suites CI had never run. This PR:

- **route-integrity-repairs.integration**: stop self-applying `20260803_route_integrity_repairs.sql` as the test role — `test-db/provision.sh` already applies it as admin, locally and in CI. The self-apply needed `CREATE` on schema `public`, which `grants.sql` withholds on purpose, so the suite could never pass anywhere.
- **protected-areas-linking**: scope the exact-list assertion to fixture-owned ids. The fixture park is a one-degree box over Rainier/Goat Rocks country and `20260721_cascades_coverage_summits.sql` put 12 real summits inside it; the linking function was right, the assertion wasn't.
- **Both areas-linking suites**: retire the bare legacy `DATABASE_URL` gate (the pattern `cloud-sql/CLAUDE.md` forbids). They now gate and connect on `AREAS_LINKING_TEST_DATABASE_URL` and assert the database name ends in `_test` before the first query.
- **migrate `test:db`**: new runner fans one `TEST_DATABASE_URL` out to all six per-suite variables; new `cloud-sql/migrate/README.md` documents them. CI (`test-route-worker.yml`) now uses it, so route-integrity-repairs and the areas-linking suites finally run in CI.
- **Docs**: refresh stale schema counts (29→41 tables, 292→392 columns, 17→22 triggers) in `test-db/README.md` and `cloud-sql/CLAUDE.md`.

Ops change made alongside (no repo diff): applied the already-merged `20260728_session_area_sync.sql` to live `peaks` as `postgres` — production was missing `trg_session_areas_touch_session`, so session-area relinks never bumped session timestamps for `/sessions/changes` pollers. Verified: trigger present and enabled, prod trigger count now 22, matching `schema.sql`.

Verification: full `npm run test:db` against the provisioned `peaks_test` — 0 fail, 0 skip.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review (done at plan time)

- **Spec coverage:** item 1 → Task 2 (+ CI in Task 4); item 2 → Task 1; item 3 → Task 1; item 4 → Task 6 (investigation already done, evidence in Decisions #4); item 5 → Tasks 3 + 5. Report concern 1 (stale counts) → Task 5. Report concerns 7–9 (provision duration, disk, shared-DB note) are environmental, no repo change — intentionally unplanned.
- **Placeholder scan:** clean — every step carries exact code, commands, and expected output.
- **Type consistency:** `AREAS_LINKING_TEST_DATABASE_URL` is spelled identically in Tasks 1, 3, 5; `test:db` contract identical in Tasks 3, 4, 5; guard message identical in both suites.
