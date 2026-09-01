# Keeper List Import Core Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the reviewed keeper-list importer into a reusable core, explicit source adapters, a base-three bundle, and a thin command without changing the Corbett, Wainwright, or UIAA Pyrenees production plan.

**Architecture:** Keep fixture validation, identity resolution, collision checks, catalog repair guards, database reads and writes, transactions, and reports in one core module. Put source-specific row rules and roster tags in source adapters. Put the three current list definitions and their fixed manifests in a base-three bundle. Keep `import-keeper-lists.ts` as a compatibility entry point and command. Existing callers keep the same exports and command-line arguments. Source fixture ordinals remain 1 through N; resolved and stored membership ordinals remain 0 through N−1.

**Tech Stack:** TypeScript 5, Node 20, Node's built-in test runner, `tsx`, PostgreSQL 15 + PostGIS, `pg` 8.

## Scope and constraints

- Base exact commit: `e666f82afde47de8fbfefe14fdd9d64b5bf2c9a5`, the reviewed head of PR #162.
- This refactor may change file boundaries and reject a missing source adapter, but it must not change the current three production lists, roster rows, identity results, report JSON, SQL effects, or command flags.
- The saved read-only production report must keep SHA-256 `2d62959d49b8bc2e27767cd7c695918857dcc3b5379df34bd6ef4ba150449695`.
- Fixture ordinals are checked as contiguous `1...expectedCount`. `resolveKeeperList` must keep writing `sourceMember.ordinal - 1`, so database ordinals stay `0...(expectedCount - 1)`.
- Do not add the next DoBIH lists or KFS 100 here. Those are separate stacked pull requests with separate source fixtures and identity reviews.
- Do not add Unicode matching or change checksum scope here. KFS needs both, but either could change current matching or fixture validation and belongs in its own red-first change.
- Do not run `--apply`, merge a pull request, deploy, or write production data in this plan.
- No service, timer, scheduler, instance, or database tier changes. Run-rate change: **$0/month**.

## File structure

**New files**

| File | Responsibility |
| --- | --- |
| `cloud-sql/migrate/src/keeper-list-import/sources.ts` | Explicit DoBIH v18.5 and UIAA Bulletin 152 source adapters and manifest types. |
| `cloud-sql/migrate/src/keeper-list-import/bundles/base-three.ts` | Corbett, Wainwright, and UIAA Pyrenees definitions and fixed manifests. |
| `cloud-sql/migrate/src/keeper-list-import/core.ts` | Generic validation, planning, identity, SQL, transaction, and report code. |
| `cloud-sql/migrate/src/__tests__/keeper-list-import-modules.test.ts` | Pins module boundaries, compatibility exports, explicit sources, and ordinal semantics. |

**Modified files**

| File | Change |
| --- | --- |
| `cloud-sql/migrate/src/import-keeper-lists.ts` | Thin command plus compatibility re-exports. |
| `cloud-sql/migrate/src/__tests__/import-keeper-lists.test.ts` | Use an explicit test source adapter and inspect the moved core SQL. |

---

### Task 1: Pin the new boundaries before moving code

**Files:**
- Create: `cloud-sql/migrate/src/__tests__/keeper-list-import-modules.test.ts`
- Test: `cloud-sql/migrate/src/__tests__/keeper-list-import-modules.test.ts`

- [ ] **Step 1: Write the failing boundary test**

Create a test that imports the future modules directly and the old entry point:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import * as legacy from "../import-keeper-lists";
import * as core from "../keeper-list-import/core";
import { BASE_THREE_KEEPER_LISTS } from "../keeper-list-import/bundles/base-three";
import {
  DOBIH_V18_5_SOURCE,
  UIAA_BULLETIN_152_SOURCE,
} from "../keeper-list-import/sources";

test("the legacy entry exports the extracted core and base-three bundle", () => {
  assert.equal(legacy.buildKeeperImportReport, core.buildKeeperImportReport);
  assert.equal(legacy.resolveKeeperList, core.resolveKeeperList);
  assert.equal(legacy.runKeeperImport, core.runKeeperImport);
  assert.equal(legacy.KEEPER_LISTS, BASE_THREE_KEEPER_LISTS);
});

test("the base-three lists carry explicit roster sources", () => {
  assert.deepEqual(
    BASE_THREE_KEEPER_LISTS.map((list) => [
      list.sourceKey,
      list.sourceDescriptor.keeperRosterSource,
    ]),
    [
      ["dobih-corbetts", "dobih-v18.5"],
      ["dobih-wainwrights", "dobih-v18.5"],
      ["uiaa-pyrenees-main", "uiaa-bulletin-152"],
    ]
  );
  assert.equal(BASE_THREE_KEEPER_LISTS[0].sourceDescriptor, DOBIH_V18_5_SOURCE);
  assert.equal(BASE_THREE_KEEPER_LISTS[2].sourceDescriptor, UIAA_BULLETIN_152_SOURCE);
});

test("source and stored ordinals keep their current bases", () => {
  const list = {
    ...BASE_THREE_KEEPER_LISTS[0],
    expectedCount: 1,
    destinationOverrides: { "dobih:1": "destination-1" },
  };
  const result = core.resolveKeeperList(list, {
    source: "dobih-v18.5",
    selection: "test",
    rows: [{
      sourceMemberId: "dobih:1",
      ordinal: 1,
      name: "Test Peak",
      elevationM: 1_000,
      lat: 56,
      lng: -4,
      dobihNumber: 1,
    }],
  }, [{
    id: "destination-1",
    name: "Test Peak",
    elevationM: 1_000,
    lat: 56,
    lng: -4,
    countryCode: "GB",
    stateCode: null,
    osmId: null,
    externalIds: {},
    owner: "peaks",
    destinationType: "point",
    features: ["summit"],
  }]);
  assert.equal(result.members[0].ordinal, 0);
});
```

- [ ] **Step 2: Run the boundary test and watch it fail**

```bash
cd cloud-sql/migrate
NODE_ENV=test node --test --import tsx \
  src/__tests__/keeper-list-import-modules.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `keeper-list-import/core`.

- [ ] **Step 3: Commit only after the implementation in Tasks 2–4 makes this test green**

Do not weaken the direct imports or change the expected roster tags to make the test pass.

---

### Task 2: Extract explicit source adapters

**Files:**
- Create: `cloud-sql/migrate/src/keeper-list-import/sources.ts`
- Modify later in this task: `cloud-sql/migrate/src/keeper-list-import/core.ts`

- [ ] **Step 1: Define source contracts in `sources.ts`**

Use type-only imports from `core.ts` so the runtime graph stays acyclic:

```ts
import type { KeeperSourceMember } from "./core";

export interface KeeperProductionManifest {
  generatedAt: string;
  sourcesSha256: string;
  selection: string;
  rosterSha256: string;
}

export interface KeeperSourceDescriptor {
  fixtureSource: string;
  keeperRosterSource: string;
  assertMemberIdentity(sourceKey: string, member: KeeperSourceMember): void;
}
```

Export `DOBIH_V18_5_SOURCE` and `UIAA_BULLETIN_152_SOURCE`. Set their `fixtureSource` values to `dobih-v18.5` and `uiaa-pyrenees-main`, and their roster tags to `dobih-v18.5` and `uiaa-bulletin-152`. Move the current DoBIH Number and UIAA Buyse main-number checks into `assertMemberIdentity` without changing their error text. The DoBIH adapter must require `sourceMemberId === "dobih:" + dobihNumber`. The UIAA adapter must require `buyseMainNumber === ordinal` and the zero-padded `uiaa-pyrenees-main:NNN` ID.

- [ ] **Step 2: Make every definition require an explicit source**

Add these fields to `KeeperListDefinition`:

```ts
sourceDescriptor: KeeperSourceDescriptor;
productionManifest?: KeeperProductionManifest;
```

`validateKeeperFixture` must:

1. reject a missing or malformed source descriptor;
2. collect manifests from `definition.productionManifest` instead of a global map;
3. require `source.source === definition.sourceDescriptor.fixtureSource`;
4. call `definition.sourceDescriptor.assertMemberIdentity(definition.sourceKey, member)` after generic row checks;
5. keep contiguous source ordinals at `1...expectedCount`;
6. keep the same generated-date, source-metadata, selector, selection, and ordered-roster checksum checks.

- [ ] **Step 3: Run the existing focused suite**

```bash
cd cloud-sql/migrate
NODE_ENV=test node --test --import tsx \
  src/__tests__/import-keeper-lists.test.ts
```

Expected at this intermediate point: compile failures identify each definition that still needs an explicit adapter. Fix only those call sites; do not add a fallback.

---

### Task 3: Extract the base-three bundle and generic core

**Files:**
- Create: `cloud-sql/migrate/src/keeper-list-import/bundles/base-three.ts`
- Move and modify: `cloud-sql/migrate/src/import-keeper-lists.ts` to `cloud-sql/migrate/src/keeper-list-import/core.ts`
- Modify: `cloud-sql/migrate/src/__tests__/import-keeper-lists.test.ts`

- [ ] **Step 1: Move the current importer to `core.ts` with `apply_patch`**

Use an `apply_patch` file move so history follows the code. Remove only command-owned imports and code from the moved file:

- `node:fs/promises`;
- `./db`;
- `main()`;
- the `require.main === module` block.

Keep `pg`, crypto, validation, identity work, SQL, and transaction code in the core.

- [ ] **Step 2: Put the three definitions in `bundles/base-three.ts`**

Move `KEEPER_LISTS` without changing user-facing names, copy, counts, keepers, links, regions, or stable identity seeds. Export the same array as `BASE_THREE_KEEPER_LISTS` and as the compatibility alias `KEEPER_LISTS`. Each definition must carry its exact adapter and old manifest:

```ts
export const BASE_THREE_KEEPER_LISTS: KeeperListDefinition[] = [
  {
    listId: deterministicKeeperListId("dobih:corbetts"),
    sourceKey: "dobih-corbetts",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: "2026-08-30",
      sourcesSha256: "8c38763ea4436f83dfb95ca96b51e74b1437419b2dee7d7e34c463489e885ce3",
      selection: "C=1",
      rosterSha256: "801bc61653fe7719dc1287c3ac6c9e1cfbe735efb1915afff53a8b464ca4b88a",
    },
    // Copy every remaining field exactly from #162.
  },
  // Wainwrights and UIAA Pyrenees follow with their exact #162 fields.
];

export { BASE_THREE_KEEPER_LISTS as KEEPER_LISTS };
```

The Wainwright roster SHA remains `7140cce0a84d66f149293294b1897e382cf1d82aa75c1823b48d55eb7611f562`. The UIAA roster SHA remains `ac47afa4687859971fa5e459738740c6336f8562df37186ee47de7650fc122f5`.

- [ ] **Step 3: Keep the runtime import graph cycle-free**

The graph must be:

```text
core.ts
  ^
  | type-only
sources.ts
  ^
  |
bundles/base-three.ts --runtime import--> core.ts
  ^
  |
import-keeper-lists.ts
```

`core.ts` must never import the base bundle. `sources.ts` may import core types only with `import type`. `base-three.ts` may import the deterministic list-ID helper from `core.ts` at runtime because the core has no reverse import.

- [ ] **Step 4: Carry the roster tag on the reviewed destination**

Add `keeperRosterSource: string` to `ReviewedKeeperDestination`. When a curated destination is built, find its list definition by `resolution.sourceKey` and copy `definition.sourceDescriptor.keeperRosterSource` onto it. Fail if the resolution names no definition.

Replace both source-key fallbacks:

- remove `sourceKey.startsWith("dobih-") ? ... : ...`;
- remove SQL `CASE WHEN incoming.source_key LIKE 'dobih-%' ... ELSE ... END`.

The insert record must carry the exact value:

```sql
keeper_roster_source text
```

and write:

```sql
'keeper_roster_source', incoming.keeper_roster_source
```

`catalogMatchesExactReviewedDestination` must compare the catalog tag with `destination.keeperRosterSource`.

- [ ] **Step 5: Keep the generic runner public**

Rename and export the private runner:

```ts
export async function runKeeperImport(
  client: PoolClient,
  fixture: KeeperImportFixture,
  resolutions: KeeperResolutionFixture,
  apply: boolean,
  definitions: KeeperListDefinition[]
): Promise<KeeperImportReport>
```

Use `definitions` for list IDs and for `buildKeeperImportReport`; the core must have no hidden base-three defaults. Remove the current `= KEEPER_LISTS` defaults from `validateKeeperFixture`, `validateKeeperResolutionFixture`, `catalogWithReviewedKeeperDestinations`, and `buildKeeperImportReport`, then pass an explicit definition array at every call. Keep the advisory lock, serializable apply, repeatable-read read-only dry run, incomplete-plan refusal, commit, rollback, and error rollback unchanged.

- [ ] **Step 6: Update the existing tests without weakening them**

In `import-keeper-lists.test.ts`:

- define one explicit inline test source adapter for `onePeakList`;
- set its `keeperRosterSource` to `test-source`;
- pass `KEEPER_LISTS` to every production-fixture core call that used an old hidden default;
- compare persisted rows with `destination.keeperRosterSource` rather than the old accidental UIAA fallback;
- read `keeper-list-import/core.ts` in the SQL source guard;
- assert the core contains direct incoming `keeper_roster_source` handling and no DoBIH/UIAA `CASE` fallback;
- keep every existing identity, collision, transaction, repair, exact-fingerprint, and manual-area-link assertion.

- [ ] **Step 7: Run both focused test files**

```bash
cd cloud-sql/migrate
NODE_ENV=test node --test --import tsx \
  src/__tests__/keeper-list-import-modules.test.ts \
  src/__tests__/import-keeper-lists.test.ts
```

Expected: 37 tests pass, 0 fail.

- [ ] **Step 8: Commit the extracted core**

```bash
git add cloud-sql/migrate/src/import-keeper-lists.ts \
  cloud-sql/migrate/src/keeper-list-import \
  cloud-sql/migrate/src/__tests__/import-keeper-lists.test.ts \
  cloud-sql/migrate/src/__tests__/keeper-list-import-modules.test.ts \
  docs/superpowers/plans/2026-08-30-keeper-list-import-core.md
git commit -m "Refactor keeper list importer core"
```

Expected: one scoped commit; `git status --short` is empty.

---

### Task 4: Restore the thin command and compatibility surface

**Files:**
- Modify: `cloud-sql/migrate/src/import-keeper-lists.ts`
- Test: both keeper-list test files

- [ ] **Step 1: Make the old path a thin command**

The file must:

1. re-export `core.ts`, `sources.ts`, and the base-three bundle;
2. keep `--input`, `--resolutions`, and optional `--apply` unchanged;
3. read the two JSON fixtures;
4. connect through the existing migration `db` pool;
5. call `runKeeperImport(..., BASE_THREE_KEEPER_LISTS)`;
6. print the same pretty JSON;
7. set exit code 2 for an incomplete dry run and 1 for an error;
8. always release the client and end the pool.

Use this shape:

```ts
import fs from "node:fs/promises";
import db from "./db";
import {
  KeeperImportFixture,
  KeeperResolutionFixture,
  parseKeeperImportArgs,
  runKeeperImport,
} from "./keeper-list-import/core";
import {
  BASE_THREE_KEEPER_LISTS,
} from "./keeper-list-import/bundles/base-three";

export * from "./keeper-list-import/core";
export * from "./keeper-list-import/sources";
export {
  BASE_THREE_KEEPER_LISTS,
  BASE_THREE_KEEPER_LISTS as KEEPER_LISTS,
} from "./keeper-list-import/bundles/base-three";
```

Keep `main()` local; do not export database setup as part of the core.

- [ ] **Step 2: Run focused tests and build**

```bash
cd cloud-sql/migrate
NODE_ENV=test node --test --import tsx \
  src/__tests__/keeper-list-import-modules.test.ts \
  src/__tests__/import-keeper-lists.test.ts
npm run build
```

Expected: all focused tests pass and `tsc` exits 0.

- [ ] **Step 3: Check that the entry point is thin**

```bash
wc -l src/import-keeper-lists.ts
```

Expected: command and re-exports only; no identity, catalog, fixture, or SQL logic remains.

- [ ] **Step 4: Commit any command-only follow-up**

If Task 4 required changes after the Task 3 commit:

```bash
git add cloud-sql/migrate/src/import-keeper-lists.ts \
  cloud-sql/migrate/src/__tests__/keeper-list-import-modules.test.ts
git commit -m "Keep keeper import command compatible"
```

Skip this commit if Task 3 already included the final thin command.

---

### Task 5: Prove production behavior did not change

**Files:**
- No new project files unless a test exposes a real defect.
- Read-only report: `/private/tmp/keeper-lists-core-refactor-dry-run-2026-08-30.json`

- [ ] **Step 1: Run the full migration suite**

```bash
cd cloud-sql/migrate
npm test
```

Expected baseline from exact #162: 787 total, 779 pass, 8 expected database skips, 0 fail. If the total changes only because the new boundary test file adds tests, record the new exact total and still require 0 failures.

- [ ] **Step 2: Build again after the full suite**

```bash
cd cloud-sql/migrate
npm run build
```

Expected: `tsc` exits 0.

- [ ] **Step 3: Confirm the local proxy before the production dry run**

```bash
lsof -nP -iTCP:5434 -sTCP:LISTEN
```

Expected: one Cloud SQL Auth Proxy process listening on `127.0.0.1:5434`. If none is listening, recover the existing read-only proxy workflow; do not substitute a production write path.

- [ ] **Step 4: Run the importer against production without `--apply`**

Run from the task worktree through the existing database wrapper. Pass:

```text
--input=docs/data-audits/fixtures/keeper-list-candidates-2026-08-30.json
--resolutions=docs/data-audits/fixtures/keeper-list-identity-resolutions-2026-08-30.json
```

Do not pass `--apply`. Save stdout exactly as:

```text
/private/tmp/keeper-lists-core-refactor-dry-run-2026-08-30.json
```

Expected report facts:

- `complete=true`;
- Corbetts 222/222;
- Wainwrights 214/214;
- UIAA Pyrenees 129/129;
- 62 new destinations;
- 13 guarded repairs;
- zero unresolved rows.

- [ ] **Step 5: Pin byte-for-byte report identity**

```bash
shasum -a 256 /private/tmp/keeper-lists-core-refactor-dry-run-2026-08-30.json
```

Expected:

```text
2d62959d49b8bc2e27767cd7c695918857dcc3b5379df34bd6ef4ba150449695
```

If the SHA differs, compare the JSON with `/private/tmp/keeper-lists-repair-state-dry-run-2026-08-30.json`. Treat any report difference as a refactor failure unless it is only an external wrapper banner that should not have entered stdout.

- [ ] **Step 6: Check the worktree diff**

```bash
git status --short
git diff --check
git diff --stat origin/codex/add-three-keeper-lists-20260830...HEAD
```

Expected: only the planned importer, tests, and plan file; no fixture, generated JS, lockfile, unrelated docs, or production state changes.

---

### Task 6: Independent review, ready pull request, CI, and cleanup

**Files:**
- No planned edits; fix only review findings tied to this refactor.

- [ ] **Step 1: Request independent spec and code-quality reviews**

Give each reviewer the exact head SHA and this plan. Require both to check:

- old command and exports stay compatible;
- no implicit DoBIH/UIAA fallback remains;
- source fixture ordinals stay 1-based and stored ordinals stay 0-based;
- all current manifest hashes and list copy stay exact;
- dry-run and apply transaction rules stay exact;
- SQL writes the explicit roster tag;
- production report SHA stays exact;
- no next-tranche data or infrastructure entered the change.

Resolve every finding, rerun focused tests, full tests, build, and the read-only production SHA proof, then ask each reviewer to approve the new exact head.

- [ ] **Step 2: Push the task branch**

```bash
git push -u origin codex/refactor-keeper-import-core-20260830
```

- [ ] **Step 3: Open a ready, non-draft pull request**

Base it on `codex/add-three-keeper-lists-20260830`, not `main`, because this refactor uses the reviewed #162 importer. State:

- behavior-preserving module split;
- explicit source roster tags;
- exact focused/full/build proof;
- exact read-only report SHA;
- no production write or deploy;
- run-rate change `$0/month`;
- next DoBIH and KFS bundles remain separate.

- [ ] **Step 4: Wait for the pull-request checks**

Use `gh pr checks --watch`. If a check fails, inspect the failure, fix it in the task worktree, rerun local proof, push, and wait again. Do not report the pull request ready while a required check is pending or failed.

- [ ] **Step 5: Confirm the branch and pull request before cleanup**

Require:

- remote branch head equals local head;
- the ready pull request exists and names the right stacked base;
- all checks pass;
- the task worktree is clean.

- [ ] **Step 6: Remove only this clean task worktree and local branch**

From the canonical Firebase checkout, remove:

```text
/Users/josiahm/projects/peaks/.codex-worktrees/refactor-keeper-import-core-20260830
```

Prune stale metadata, then delete local branch `codex/refactor-keeper-import-core-20260830`. Keep the pushed remote branch and pull request. Do not touch the dirty superseded `next-mountain-lists` worktree or any other task worktree.

## Handoff to the next plans

After this pull request is ready and green:

1. write and execute a separate stacked plan for the eight DoBIH units: Munro Tops, Furths, Donalds, Wainwright Outlying Fells, Fellrangers, Vandeleur-Lynams, Irish 2000-Foot Mountains, and current Grahams;
2. pin 1,460 memberships, 989 new DoBIH source keys, exact per-list hashes, and reviewed identities;
3. write and execute a separate KFS plan only after all 100 `kfs:<mntnId>` rows have reviewed catalog identities, Unicode-safe normalization, and source-specific hash rules;
4. keep Irish County Highpoints in the uncovered denominator until the product has an honest non-summit highpoint feature;
5. keep route and cover-photo generation as a separate approved production phase after list imports.
