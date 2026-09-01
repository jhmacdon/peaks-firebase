# KFS 100 Famous Mountains — Implementation Plan

**Goal:** Add the Korea Forest Service 100 Famous Mountains as a fully reviewed keeper list, with an exact destination-to-KFS mountain ID crosswalk that later route work can join without name matching.

**Stack:** This work starts at `984b9e4eadadd6e3cc1143d66c54e133062bc9b1`, the exact green head of PR #164. Its pull request must target `codex/add-eight-dobih-lists-20260830`.

**Cost:** This adds checked data, tests, and on-demand commands. It adds no service, timer, scheduled job, or always-on resource. Run-rate change: **$0/month**.

## Guardrails

- Dry run is the default. Do not pass `--apply` during this task.
- Do not merge, deploy, migrate, or write production data without Josiah's approval.
- Keep the legacy base-three command and the DoBIH open-eight command unchanged.
- Never put a KFS roster member ID into `destinations.external_ids`. The checked coordinate crosswalk is the exact `destinationId -> mntnId` route join.
- Never use a name-only KFS join. Require the eight-digit `mntnId`, `sourceMemberId=kfs:<mntnId>`, exact ordinal, and the reviewed destination ID.
- Use KFS roster facts only. Do not copy KFS page or e-book photos. KFS unmarked media is not licensed for this use.
- Use OpenStreetMap coordinates under ODbL. Hallasan is the one reviewed `natural=volcano` exception; all other selected points are `natural=peak` nodes.
- Treat the 2016 KFS trail archive as geometry and source identity only. It does not prove current access, closures, or recommendations.
- Do not add routes or photos in this pull request. The checked crosswalk is the input to separate fail-closed route and photo work.

## Exact list definition

| Field | Value |
| --- | --- |
| Product source key | `kfs-100-famous-mountains` |
| Registry ID | `kfs-100-famous-mountains` |
| Deterministic list seed | `kfs:100-famous-mountains` |
| List ID | `39F59B1A26E9B0818EBE` |
| Name | `Korea Forest Service 100 Famous Mountains` |
| Count | `100` |
| Country | `KR` |
| Region | `South Korea` |
| Organization | `Korea Forest Service` |
| Established year | `2002` |
| Source descriptor | `KFS_100_FAMOUS_MOUNTAINS_SOURCE` |
| Fixture source | `kfs-100-famous-mountains-2022-01-01` |
| Keeper roster source | `kfs-100-famous-mountains-2022-01-01` |
| Selection | `KFS official 100 Famous Mountains roster, 2022-01-01` |
| Source URL | `https://www.forest.go.kr/kfsweb/kfi/kfs/foreston/main/contents/FmmntSrch/selectFmmntSrchList.do?mn=AR02_02_05_01&orgId=fon&mntIndex=1&mntUnit=100` |
| Rights URL | `https://www.data.go.kr/data/15058662/openapi.do` |

Use this description:

`The Korea Forest Service selected these 100 mountains for their scenery, history, culture, ecology, and public interest. This roster follows the official KFS list as of January 1, 2022.`

## Pinned evidence

The source roster joins the official XLSX and live KFS page by normalized base name plus exact height. It yields 100 unique live `mntnId` values and 100 unique source IDs in the form `kfs:<mntnId>`.

| Input | SHA-256 |
| --- | --- |
| Official KFS ZIP | `0785a8fd37ae0bb671c774dd833c9e0849ee453c531211efdc51f92173f5d38a` |
| Official KFS XLSX | `6edeed758c174580b8152cf0c74b1b5b8b29735314f1d3e8139f7bf160339c60` |
| Canonical live KFS page | `e4fddd46b6e3330dc01d0f621ddca8d5703e626bd4fcf19337a2b30d89a5a1f4` |
| Current data-rights page | `a47c620cd929e92f4ea747f1f9cb2573c93fa0049b51a36b9b1284ff691fadb8` |
| Checked data-rights record | `8cb839b56ad7804a4b49c47f5ade3b7f2c65428b4e4915cfda5089c549c7d79a` |
| Reviewed source crosswalk | `b113780ebec8206cae3ca24022af7a9d77c2b718a258b000666a940f6ebd4735` |
| OSM query | `3b0177b5cdb2b30f3b3ebe39ffc8610c4b00573587146e1ec7e5b589374df1b7` |
| OSM South Korea peak snapshot | `6275b316fa55d2f6a183ee92397564d51316fad78cf89239bad866d0ab95beba` |
| Hallasan OSM snapshot | `81555ca3d807090015823e94ab83b7341ee496bde36d5f859cda20ce1b453575` |
| Hallasan Wikidata evidence | `51b317cac3cf121b733750335a442571c9cb2bea9a6c7959391e3293d3fa9c89` |
| Read-only production catalog | `f0824ae26adfa1e0c6f35071a593fe4bbf6729bd465fb04ae728e801b0adbe9d` |
| KFS copyright page | `19d446eb3c37fc75eedc1395b19f9c16a6c1260cec5a66f715ba1f1e2bdd419e` |
| Reviewed coordinate builder | `0692a47e2adcc3f5b1069f74c09e6c6e0e706753444bda0eb340151678b9425b` |
| Reviewed coordinate crosswalk | `949672eeec5d5c44f212632fd500cc6d594fbf1316e7c317a1165f0ef78b1636` |
| Reviewed coordinate CSV | `708400e8e904743ba8c9395aaddcb0cacb44ae84be1bca4daa416c8140813769` |
| Reviewed coordinate audit | `46b60bf2cf5f5ae9f169e92c9443b6fd865043e2442beb88dad7d06f8f4df6af` |

The normalized 100-row roster hash is `b26e7aca4881529e65b41ad29626eba4d0b370426b6db9dc6edce0bbbfd903a2`. It hashes the ordered `ordinal`, `mntnId`, normalized official name, and elevation projection as compact JSON.

The final coordinate review is deterministic and byte-stable. It has:

- 38 `existing_destination` rows;
- zero catalog repairs;
- 62 `curated_destination` rows;
- 95 confirmed identities;
- five confirmed identities with a documented source conflict;
- zero unresolved identities;
- 38 production neighbor links within 150 metres;
- zero KFS-to-KFS point pairs within 150 metres; and
- four rejected remote same-name production candidates.

The five documented source conflicts are 변산(의상봉), 신불산, 지리산(통영), 치악산(비로봉), and 화악산. The six manual point choices are 남산(금오산), 마이산(암마이산), 변산(의상봉), 속리산, 한라산, and 화악산. Tests must pin these decisions and every rejected point ID.

## Task 1: Write failing KFS boundary tests

**Files:**

- Add `cloud-sql/migrate/src/__tests__/import-kfs-100-famous-mountains.test.ts`.
- Modify `cloud-sql/migrate/src/__tests__/keeper-list-import-modules.test.ts`.
- Modify `cloud-sql/migrate/src/__tests__/import-keeper-lists.test.ts` only for Unicode normalization coverage.

1. Import the not-yet-created KFS bundle, source descriptor, builders, checked fixtures, and thin command.
2. Assert the exact definition, list ID, source URL, rights statement, country, count, copy, and `$0/month` boundary.
3. Prove Korean names normalize to non-empty distinct keys while Latin accent and dash folding still work.
4. Prove the KFS descriptor accepts only an eight-digit `mntnId` paired with `sourceMemberId=kfs:<mntnId>`.
5. Prove the old commands and bundles do not gain the KFS list.
6. Run the focused tests and record the expected missing-module failures before implementation.

## Task 2: Add Unicode-safe shared source validation

**Files:**

- Modify `cloud-sql/migrate/src/keeper-list-import/core.ts`.
- Modify `cloud-sql/migrate/src/keeper-list-import/sources.ts`.

1. Add optional `kfsMntnId` to `KeeperSourceMember`.
2. Change name normalization to NFKD, remove Unicode marks, return to NFC, lowercase, fold dash characters, keep Unicode letters and numbers, collapse other characters to spaces, and trim.
3. Add `KFS_100_FAMOUS_MOUNTAINS_SOURCE`. It requires exactly eight ASCII digits and an exact `kfs:<id>` source member ID.
4. Keep the rule that source member IDs never enter destination external IDs.

## Task 3: Add the KFS definition and thin command

**Files:**

- Add `cloud-sql/migrate/src/keeper-list-import/bundles/kfs-100-famous-mountains.ts`.
- Add `cloud-sql/migrate/src/import-kfs-100-famous-mountains.ts`.
- Modify `cloud-sql/migrate/package.json`.

1. Export one exact list definition.
2. Mirror the DoBIH command's flags, pretty JSON, cleanup, and exit codes. Pass only the KFS definition to the shared importer.
3. Add `import:keeper-lists:kfs-100-famous-mountains`.
4. Prove the command is dry-run by default and injectable in tests.

## Task 4: Build and pin the source fixture

**Files:**

- Add `cloud-sql/migrate/src/build-kfs-100-famous-mountains-fixture.ts`.
- Add `docs/data-audits/fixtures/keeper-list-kfs-100-famous-mountains-source-crosswalk-2026-08-30.json`.
- Add `docs/data-audits/fixtures/keeper-list-kfs-100-famous-mountains-candidates-2026-08-30.json`.
- Modify `cloud-sql/migrate/package.json`.

1. Read the checked source crosswalk, require its exact SHA, schema, keeper, registry ID, effective date, join rule, and 100 sequential rows.
2. Emit one source list with exact official names, useful official/live/Hanja aliases, KFS heights, `kfsMntnId`, and no coordinates. Coordinates belong to the separate OSM review, not the KFS roster.
3. Require 100 unique `mntnId` and source IDs, exact ordinals 1 through 100, and the normalized roster hash above.
4. Emit complete pinned source metadata, including the official archive, workbook, page, data-rights URL, and their hashes.
5. Call `validateKeeperFixture` with the KFS definition.
6. Add `build:keeper-list-fixture:kfs-100-famous-mountains`.

## Task 5: Build and pin the reviewed resolutions

**Files:**

- Add `cloud-sql/migrate/src/build-kfs-100-famous-mountains-resolutions.ts`.
- Add `docs/data-audits/fixtures/keeper-list-kfs-100-famous-mountains-coordinate-crosswalk-2026-08-30.json`.
- Add `docs/data-audits/fixtures/keeper-list-kfs-100-famous-mountains-identity-resolutions-2026-08-30.json`.
- Modify `cloud-sql/migrate/package.json`.

1. Read the checked coordinate crosswalk and require its exact SHA, all ten input hashes, schema, summary counts, manual choices, conflict rows, and every passing invariant.
2. Require each coordinate row to match the source fixture on ordinal, source ID, `mntnId`, official name, and KFS height.
3. Require 100 unique OSM nodes, destination IDs, and reviewed points.
4. For the 38 existing rows, pin the complete current catalog fingerprint and require exactly one production neighbor within 150 metres.
5. For the 62 curated rows, use the deterministic OSM destination ID, reviewed KFS name and height, reviewed OSM point, `KR`, no state, OSM external ID, and all close-neighbor guards. Credit the KFS roster and OpenStreetMap coordinates in the checked evidence and metadata.
6. Reject all catalog repairs in this bundle.
7. Keep checked Wikidata tags, including Hallasan's exact linkage, as evidence only. Do not add them to curated destination external IDs.
8. Validate the source fixture, resolution fixture, and cross-list consistency before writing output.
9. Add `build:keeper-list-resolutions:kfs-100-famous-mountains`.

## Task 6: Record the audit and route handoff

**Files:**

- Add `docs/data-audits/keeper-list-kfs-100-famous-mountains-2026-08-30.md`.

1. Record every input and output hash, roster join, identity count, conflict, manual choice, and same-name rejection.
2. State that KFS photos were not used and why.
3. Record the official trail archive URL, size `265601808`, SHA `e017b599947b4a14493771ed810d0c0221d5e9ab7e9dd5c5b1fc24a69ede0c72`, and its 2,932 nested mountain bundles. Note that the data portal says 2,919 rows and the archive says 2,932; route work must reconcile that mismatch before publishing.
4. State that the archive's data dates to 2007–2016 and cannot prove current access.
5. State that the checked coordinate crosswalk is the only allowed destination-to-`mntnId` join for the route adapter.
6. State that the list is ready for review but not imported until an approved apply.

## Task 7: Prove the bundle locally and against production read-only

1. Run the focused KFS tests and existing keeper importer tests.
2. Regenerate both fixtures and require a clean diff.
3. Run the full migration test suite, `npm run build`, and `git diff --check`.
4. Run the KFS command against production in a repeatable-read, read-only transaction without `--apply`.
5. Require `apply=false`, `complete=true`, exactly 100 unique members, 62 planned additions, zero repairs, zero unresolved rows, and no duplicate destination addition.
6. Simulate the first plan's additions and all 100 memberships. Require a second dry plan with zero additions, repairs, membership changes, or issues.
7. Save and hash the no-apply report in the audit note.

## Task 8: Review, ready pull request, CI, and cleanup

1. Review the exact head for roster rights, Unicode handling, source identity, all hashes and counts, mixed KFS/OSM credit, duplicate guards, no source IDs in external IDs, command isolation, transaction safety, and `$0/month` cost.
2. Fix every valid finding and rerun all focused and full checks plus the production no-apply proof.
3. Commit only the KFS bundle, command, builders, fixtures, audit, tests, package scripts, shared Unicode/source changes, and this plan.
4. Push `codex/add-kfs-100-20260830` and open a ready, non-draft pull request against `codex/add-eight-dobih-lists-20260830`.
5. Wait for every required check to pass.
6. Confirm the remote head, ready pull request, green checks, and clean worktree.
7. Remove only `/Users/josiahm/projects/peaks/.codex-worktrees/add-kfs-100-20260830`, prune stale metadata, and delete only the local task branch. Keep the remote branch and pull request.

## Route and photo follow-up

The list does not meet the full user goal until approved production imports, route work, and photo review finish. The next pull request must add a static KFS trail-source adapter, reconcile all 100 destination IDs to exact archive `MNTN_ID` values, transform the pinned projected geometry to WGS84, and treat archive start/end points as trailhead candidates only. A current source must prove access before a route can become publishable. Destination photo candidates must use approved Wikimedia or other licensed media, pass human review, and populate destination hero fields. The route-cover view then derives every route cover from the approved destination hero. Final production checks must show zero listed destinations without a cover, zero listed destinations without a safe route except an explicit product-supported waiver, and zero active routes without a cover.
