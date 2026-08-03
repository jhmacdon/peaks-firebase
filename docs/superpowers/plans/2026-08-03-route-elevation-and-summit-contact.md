# Route Elevation and Summit Contact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Peaks-owned route a stored elevation profile and prevent any route that misses a linked summit from passing audit, activation, or verification.

**Architecture:** PostGIS paths remain the source of truth. A small profile library and SQL materializer encode Z values for clients; a leased local worker fills flat paths from AWS Terrarium. A route-integrity ledger records each bad route/summit link and feeds the existing route factory without retiring a shared bad route until every linked summit has replacement coverage.

**Tech Stack:** TypeScript, Node.js, PostgreSQL/PostGIS, Bash, Sharp, Node test runner, Cloud SQL Auth Proxy, Codex Luna Max heartbeats.

---

### Task 1: Elevation Profile Invariants

**Files:**
- Create: `cloud-sql/migrate/src/route-elevation-profile.ts`
- Create: `cloud-sql/migrate/src/__tests__/route-elevation-profile.test.ts`
- Create: `cloud-sql/migrations/20260803_route_elevation_backfill.sql`
- Modify: `cloud-sql/schema.sql`

- [ ] **Step 1: Write failing pure profile tests**

Cover integer rounding, long base64 output without line breaks, decode count,
flat profiles, non-finite samples, and gain/loss dead-band behavior:

```ts
assert.deepEqual(decodeElevationProfile(encodeElevationProfile([1000.4, 1001.6])!), [1000, 1002]);
assert.equal(encodeElevationProfile(new Array(200).fill(1200))?.includes("\n"), false);
assert.equal(profileIsUsable([0, 0, 0]), false);
assert.deepEqual(computeRouteElevationStats([1000, 1010, 1008]), { gain: 10, loss: 0 });
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm --prefix cloud-sql/migrate test -- --test-name-pattern='route elevation profile'`

Expected: FAIL because `route-elevation-profile.ts` does not exist.

- [ ] **Step 3: Implement the pure profile library**

Export these fixed interfaces:

```ts
export function encodeElevationProfile(elevations: number[]): string | null;
export function decodeElevationProfile(encoded: string | null): number[];
export function profileIsUsable(elevations: number[]): boolean;
export function computeRouteElevationStats(elevations: number[]): { gain: number; loss: number };
```

Match `Route.encodeElevationProfile` on iOS: round metres, join with `|`, and
base64 encode ASCII. Reject empty, non-finite, or all-zero profiles. Use the
existing four-metre reversal dead band for gain and loss.

- [ ] **Step 4: Add SQL materialization and queue schema**

Create `encode_route_elevation_profile(path geography)` and a Peaks-only route
trigger. The trigger derives `elevation_string` from non-flat Z values and sets
it to null for invalid or all-zero Z. Strip CR and LF from PostgreSQL base64.

Create `route_elevation_backfill_jobs` with route ID primary key, state check,
path fingerprint, priority, attempts, source kind, final evidence, retry time,
and a complete lease triple. Grant only the existing API role used by local
workers. Mirror the final definitions in `cloud-sql/schema.sql`.

- [ ] **Step 5: Run focused and full migration tests**

Run:

```bash
npm --prefix cloud-sql/migrate test -- --test-name-pattern='route elevation profile'
npm --prefix cloud-sql/migrate test
```

Expected: PASS.

- [ ] **Step 6: Commit the invariant layer**

```bash
git add cloud-sql/migrate/src/route-elevation-profile.ts \
  cloud-sql/migrate/src/__tests__/route-elevation-profile.test.ts \
  cloud-sql/migrations/20260803_route_elevation_backfill.sql \
  cloud-sql/schema.sql
git commit -m "Add route elevation profile invariants"
```

### Task 2: Durable Elevation Worker

**Files:**
- Create: `cloud-sql/migrate/src/route-elevation-jobs.ts`
- Create: `cloud-sql/migrate/src/lib/terrarium-route-profile.ts`
- Create: `cloud-sql/migrate/src/__tests__/route-elevation-jobs.integration.test.ts`
- Create: `cloud-sql/migrate/src/__tests__/terrarium-route-profile.test.ts`
- Modify: `cloud-sql/migrate/package.json`

- [ ] **Step 1: Write failing queue integration tests**

Use isolated route and segment fixtures to prove:

```ts
assert.equal(firstClaim.route_id, fixtureRouteId);
assert.notEqual(firstClaim.lease_token, secondClaim.lease_token);
assert.equal(secondClaim.route_id, otherRouteId);
assert.equal(staleCompletion.outcome, "path_changed_requeued");
assert.equal(expiredLease.state, "queued");
assert.equal(userOwnedJobCount, 0);
```

Also prove a shared segment update refreshes every affected Peaks route in the
same transaction and leaves user-owned routes unchanged.

- [ ] **Step 2: Write failing Terrarium sampler tests**

Inject a fake tile fetcher and a small generated PNG. Verify zoom 14 tile/pixel
selection, Terrarium RGB decoding, cache reuse, partial-fetch rejection, and
that no route coordinates appear in the compact result.

- [ ] **Step 3: Run the focused tests and verify failure**

Run:

```bash
npm --prefix cloud-sql/migrate test -- --test-name-pattern='route elevation jobs|Terrarium route profile'
```

Expected: FAIL because the queue and sampler modules do not exist.

- [ ] **Step 4: Implement the batch Terrarium sampler**

Export:

```ts
export async function sampleTerrariumProfile(
  points: Array<{ lat: number; lng: number }>,
  options?: { cacheDir?: string; fetcher?: typeof fetch }
): Promise<number[]>;
```

Fetch `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/X/Y.png`
with the Peaks user agent, cache under a supplied system-temp directory, batch
requests, and fail the whole route before writes when any required tile or
sample is missing.

- [ ] **Step 5: Implement the queue CLI**

Support only these commands:

```text
seed [--apply]
claim --worker-id luna-route-elevation-01 --apply
heartbeat --lease-token TOKEN
process --route-id ID --lease-token TOKEN --apply
release --lease-token TOKEN --message TEXT
show [--route-id ID] [--state STATE]
stats
```

`process` must lock the job and route, reject a changed fingerprint, reuse
valid stored Z without AWS, otherwise sample all vertices, update source
segments first, rebuild affected route path/profile/stats, and complete only
after a fresh read proves profile count, Z range, stats, and ownership. For an
active route, fetch the public verifier payload and require a matching encoded
profile count. For a pending route, record `public_not_applicable: pending`.

- [ ] **Step 6: Add the npm entry point and make tests pass**

Add:

```json
"routes:elevation-jobs": "tsx src/route-elevation-jobs.ts"
```

Run the focused tests, then `npm --prefix cloud-sql/migrate test`.

Expected: PASS.

- [ ] **Step 7: Commit the worker core**

```bash
git add cloud-sql/migrate/package.json cloud-sql/migrate/package-lock.json \
  cloud-sql/migrate/src/route-elevation-jobs.ts \
  cloud-sql/migrate/src/lib/terrarium-route-profile.ts \
  cloud-sql/migrate/src/__tests__/route-elevation-jobs.integration.test.ts \
  cloud-sql/migrate/src/__tests__/terrarium-route-profile.test.ts
git commit -m "Add durable route elevation worker"
```

### Task 3: Low-Freedom Luna Elevation Skill

**Files:**
- Create: `.claude/skills/peaks-route-elevation-backfill/SKILL.md`
- Create: `.claude/skills/peaks-route-elevation-backfill/agents/openai.yaml`
- Create: `.claude/skills/peaks-route-elevation-backfill/references/worker-contract.md`
- Create: `.claude/skills/peaks-route-elevation-backfill/references/luna-goal-prompt.md`
- Create: `.claude/skills/peaks-route-elevation-backfill/scripts/route_elevation_jobs.sh`
- Modify: `.agents/skills/peaks-route-factory/scripts/resolve_worker_checkout.sh`
- Modify: `.agents/skills/peaks-route-factory/scripts/worker_preflight.sh`
- Test: `.claude/skills/peaks-route-catalog-audit/scripts/route_audit_tools.test.mjs`

- [ ] **Step 1: Add failing wrapper contract tests**

Assert that only `/Users/josiahm/projects/peaks/.workers/firebase-route-elevation`
maps to `luna-route-elevation-01`, a supplied worker ID cannot differ, and a
dirty or stale checkout fails before any lease is claimed.

- [ ] **Step 2: Run the wrapper test and verify failure**

Run: `node --test .claude/skills/peaks-route-catalog-audit/scripts/route_audit_tools.test.mjs`

Expected: FAIL for the missing elevation checkout mapping and wrapper.

- [ ] **Step 3: Initialize and write the skill**

Run the skill initializer from `/Users/josiahm/.codex/skills/.system/skill-creator/scripts/init_skill.py`
with the project `.claude/skills` directory, then replace the generated text.
The finished skill must say:

1. preflight the one approved checkout;
2. run stats and claim exactly one route;
3. run only `process` for that lease;
4. release on failure;
5. report compact route ID/name, source kind, point count, queue totals, and
   lease health; and
6. stop after one route or three repeated shared faults.

It must ban source research, route-shape edits, migrations, git changes, raw
coordinates in chat, and any user-owned route write.

- [ ] **Step 4: Generate metadata and validate the skill**

Generate `agents/openai.yaml` with display name `Peaks Route Elevation
Backfill`, a short description under 64 characters, and a default prompt that
invokes `$peaks-route-elevation-backfill` for one bounded job. Run
`quick_validate.py` against the skill directory.

Expected: validation succeeds.

- [ ] **Step 5: Run tests and commit the skill**

Run the wrapper test and worker preflight smoke test. Expected: PASS.

```bash
git add .claude/skills/peaks-route-elevation-backfill \
  .agents/skills/peaks-route-factory/scripts/resolve_worker_checkout.sh \
  .agents/skills/peaks-route-factory/scripts/worker_preflight.sh \
  .claude/skills/peaks-route-catalog-audit/scripts/route_audit_tools.test.mjs
git commit -m "Add Luna route elevation skill"
```

### Task 4: Summit-Contact Audit and Rule Versioning

**Files:**
- Modify: `.claude/skills/peaks-route-catalog-audit/SKILL.md`
- Modify: `.claude/skills/peaks-route-catalog-audit/references/audit-rules.md`
- Modify: `.claude/skills/peaks-route-catalog-audit/references/worker-contract.md`
- Modify: `.claude/skills/peaks-route-catalog-audit/scripts/audit_catalog_routes.sh`
- Modify: `cloud-sql/migrate/src/route-catalog-audit-jobs.ts`
- Modify: `cloud-sql/migrations/20260801_route_catalog_audit_jobs.sql`
- Modify: `cloud-sql/migrate/src/__tests__/route-catalog-audit-jobs.integration.test.ts`
- Modify: `.claude/skills/peaks-route-catalog-audit/scripts/route_audit_tools.test.mjs`

- [ ] **Step 1: Add failing audit tests**

Add fixtures for an out-and-back ending 30.6 m short, a loop contacting its
summit internally, a multi-summit route missing one linked summit, a missing
encoded profile, and a prior completed audit with an older rule version.

Expected assertions:

```ts
assert.match(issues, /route_misses_linked_summit_gt_5m/);
assert.doesNotMatch(loopIssues, /end_over_5m_from_summit/);
assert.match(profileIssues, /missing_or_invalid_elevation_profile/);
assert.equal(reseeded.state, "queued");
```

- [ ] **Step 2: Run focused tests and verify failure**

Run the audit tool test and the route catalog integration test.

Expected: FAIL under the current 250 m rule and unversioned fingerprint.

- [ ] **Step 3: Implement path-to-every-summit checks**

Compute `ST_Distance(route.path, summit.location)` for every linked summit and
aggregate the worst gap and fault list per route. Error above 5 m. Keep the
endpoint check only for out-and-back and point-to-point shapes. Validate that
`elevation_string` decodes to the path vertex count and that non-trivial gain
does not have a flat Z path.

- [ ] **Step 4: Version audit fingerprints and priority**

Add `audit_rule_version INTEGER NOT NULL DEFAULT 2`. Include version 2 in the
candidate fingerprint and add high priority for summit-contact and profile
faults. Seeding must return completed version-1 jobs to `queued` without
touching an active lease.

- [ ] **Step 5: Tighten the Luna instructions**

Tell the four workers that a route cannot pass until every linked summit has a
5 m contact proof and the encoded profile gate passes. Keep the audit read-only
for route and destination tables.

- [ ] **Step 6: Run tests and commit**

Run the audit tool test and full migrate tests. Expected: PASS.

```bash
git add .claude/skills/peaks-route-catalog-audit \
  cloud-sql/migrate/src/route-catalog-audit-jobs.ts \
  cloud-sql/migrations/20260801_route_catalog_audit_jobs.sql \
  cloud-sql/migrate/src/__tests__/route-catalog-audit-jobs.integration.test.ts
git commit -m "Require summit contact in route audits"
```

### Task 5: Repair Ledger and Publish Gates

**Files:**
- Create: `cloud-sql/migrations/20260803_route_integrity_repairs.sql`
- Create: `cloud-sql/migrate/src/route-integrity-repairs.ts`
- Create: `cloud-sql/migrate/src/__tests__/route-integrity-repairs.integration.test.ts`
- Modify: `cloud-sql/migrate/package.json`
- Modify: `cloud-sql/schema.sql`
- Modify: `cloud-sql/migrate/src/standard-route-verification.ts`
- Modify: `cloud-sql/migrate/src/__tests__/standard-route-verification.test.ts`
- Modify: `cloud-sql/migrate/src/standard-route-jobs.ts`
- Modify: `cloud-sql/migrate/src/standard-route-job-state.ts`
- Modify: `web/src/lib/actions/routes.ts`
- Modify: `web/src/app/api/public/routes/[id]/route.ts`
- Modify: `.claude/skills/peaks-standard-route-backfill/scripts/accept_pending_route_with_segments.mts`
- Modify: `.agents/skills/peaks-route-factory/references/result-schemas.md`
- Modify: `.agents/skills/peaks-route-factory/references/worker-contract.md`
- Modify: `.agents/skills/peaks-route-factory/references/stage-commands.md`

- [ ] **Step 1: Add failing verification and repair-ledger tests**

Require new `summit_contact` and `elevation_profile` gates in database and
public payloads. Add integration fixtures proving:

```ts
assert.equal(bierstadtLike.gates.summit_contact, false);
assert.equal(flatRoute.gates.elevation_profile, false);
assert.equal(sharedLegacy.statusAfterFirstReplacement, "active");
assert.equal(sharedLegacy.statusAfterLastReplacement, "superseded");
assert.equal(alreadyCoveredRepair.state, "covered");
```

- [ ] **Step 2: Run focused tests and verify failure**

Run standard verification and route-integrity integration tests.

Expected: FAIL because neither gate nor ledger exists.

- [ ] **Step 3: Implement the repair ledger**

Create `route_integrity_repairs` keyed by `(route_id, destination_id)` with
queued, covered, retired, and needs-human states. Seed every summit link of an
active route when any linked summit is over 5 m away; this ensures a shared bad
route is not retired until all its summit links have replacement coverage.
Mark a row covered automatically when another active Peaks route already
passes contact, profile, provenance, and segment gates for that destination.

Expose `seed [--apply]`, `show`, and `stats` in
`route-integrity-repairs.ts`, add
`"routes:integrity-repairs": "tsx src/route-integrity-repairs.ts"` to the
migrate package, and mirror the table in `cloud-sql/schema.sql`.

- [ ] **Step 4: Feed repairs into the route factory**

Merge uncovered repair destinations into `targetSql` with higher priority than
normal coverage work. Bind the selected old route to
`replacement_route_id` and record the repair reason in `target_reasons`.
After a verified replacement, allow reseeding to select the next unresolved
bad route for the same destination.

- [ ] **Step 5: Enforce gates during activation**

Before either activation path in `acceptRouteWithSegments`, query and require:

- every linked summit within 5 m;
- final summit endpoint within 5 m for out-and-back or point-to-point;
- a usable profile whose decoded count equals `ST_NPoints(path)`; and
- route/segment provenance and elevation agreement.

When replacing a shared bad route, mark only the current repair link covered.
Keep the old route active while any ledger row remains queued. Supersede it in
the transaction that covers the final link.

- [ ] **Step 6: Extend final and public verification**

Return profile count, encoded profile, linked-summit maximum gap, and final
endpoint gap from the public verifier route. Compare them to the database in
`verifyStandardRoute`. Add `summit_contact` and `elevation_profile` to the
required verification gates and rebuild action.

- [ ] **Step 7: Run full tests and builds**

Run:

```bash
npm --prefix cloud-sql/migrate test
npm --prefix cloud-sql/migrate run build
npm --prefix web run lint
npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 8: Commit the repair and publish gates**

```bash
git add cloud-sql/migrations/20260803_route_integrity_repairs.sql \
  cloud-sql/migrate/src/route-integrity-repairs.ts \
  cloud-sql/migrate/src/__tests__/route-integrity-repairs.integration.test.ts \
  cloud-sql/migrate/package.json cloud-sql/schema.sql \
  cloud-sql/migrate/src/standard-route-verification.ts \
  cloud-sql/migrate/src/__tests__/standard-route-verification.test.ts \
  cloud-sql/migrate/src/standard-route-jobs.ts \
  cloud-sql/migrate/src/standard-route-job-state.ts \
  web/src/lib/actions/routes.ts 'web/src/app/api/public/routes/[id]/route.ts' \
  .claude/skills/peaks-standard-route-backfill/scripts/accept_pending_route_with_segments.mts \
  .agents/skills/peaks-route-factory/references
git commit -m "Gate route publishing on summit contact and elevation"
```

### Task 6: Review, Production Proof, and Worker Launch

**Files:**
- Modify only when review or proof exposes a tested defect.

- [ ] **Step 1: Run repository verification**

Run `git diff --check`, the full migrate tests/build, the web tests/build, the
audit script tests, the skill validator, and worker preflight smoke tests.

- [ ] **Step 2: Request independent review**

Give the reviewer the spec, plan, diff, and test output. Require explicit
approval of data safety, shared-route retirement, lease safety, source rights,
and the near-$0/month cost claim. Fix findings with a failing regression test.

- [ ] **Step 3: Push and open the PR**

State in the PR that no hosted service or scheduler was added and the expected
backend run-rate change is near $0/month. Watch every CI check to green.

- [ ] **Step 4: Merge and update dedicated checkouts**

After approval and green CI, merge the PR. Update all four audit checkouts, the
route-factory checkout, and a new
`/Users/josiahm/projects/peaks/.workers/firebase-route-elevation` checkout to
the exact merged `origin/main`. Install migrate dependencies and require clean
preflight in each.

- [ ] **Step 5: Apply migrations and seed queues**

Apply the elevation, audit-version, and integrity-repair migrations in order.
Run dry-run then apply for elevation jobs, integrity repairs, route factory
jobs, and catalog audit jobs. Confirm:

- every current profile gap is queued or complete;
- every current summit-contact fault has a ledger row;
- no user-owned route is queued; and
- expired leases are zero.

- [ ] **Step 6: Prove three live cases**

Process one existing-Z route, one flat route through AWS, and Mount Bierstadt
through the route factory. Require Bierstadt's replacement to end within 5 m,
show a non-flat public elevation profile, retain valid provenance/segments,
and return HTTP 200 before the job is verified.

- [ ] **Step 7: Start and supervise workers**

Create one fixed Luna Max task for the elevation checkout and an active
ten-minute, 144-run failed-runs-only heartbeat. Refresh the four audit tasks so
they use the merged rule version. Resume the existing route-factory task only
after its preflight and one supervised repair pass.

- [ ] **Step 8: Report durable state**

Report PR and merge commit, proof route IDs, queue totals, worker/task IDs,
heartbeat names, lease health, and the exact remaining repair and elevation
counts.
