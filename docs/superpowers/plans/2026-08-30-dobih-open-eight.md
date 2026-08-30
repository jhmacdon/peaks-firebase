# DoBIH Open Eight Keeper Lists — Implementation Plan

**Goal:** Add eight respected DoBIH-backed peak lists through a separate, fail-closed importer while keeping the reviewed base-three command unchanged.

**Stack:** This work starts at `a21a6f4b7bd8cf749bb0884417565f02596ffab2`, the exact green head of PR #163. Its pull request must target `codex/refactor-keeper-import-core-20260830`.

**Cost:** This adds checked data, tests, and an on-demand command. It adds no service, timer, scheduled job, or always-on resource. Run-rate change: **$0/month**.

## Guardrails

- Dry run is the default. Do not pass `--apply` during this task.
- Do not merge, deploy, migrate, or write production data without Josiah's approval.
- Do not change `import-keeper-lists.ts`, `BASE_THREE_KEEPER_LISTS`, or the legacy `KEEPER_LISTS` export.
- Do not add Irish County Highpoints. Its roster includes non-summit highpoints that the product cannot yet model honestly.
- DoBIH `Country=I` covers both the Republic of Ireland and Northern Ireland. Irish lists allow `GB` and `IE`.
- DoBIH `Country=ES` is the England/Scotland border, not Spain.
- Do not set state bounds on these lists.
- Import the current `G=1` Grahams roster of 231, not the older 219-peak form.
- Import all 116 Outlying Fells to match the keeper roster. Peaks cannot yet waive an optional membership, so its progress count is not keeper-equivalent: the LDWA permits High Knott/Williamson's Monument to be omitted because access is prohibited. Put that warning in the user-visible list description. Before any apply, prove that this member exposes no active route. Do not publish an unsafe route to it.
- Keep the existing registry identity `dobih-irish-2000-foot-register` and list ID `5E3E4171391831A39DF1`. A late slug change would create a second identity for the same list.

## Exact list order and manifests

Every definition uses `DOBIH_V18_5_SOURCE`, source name `The Database of British and Irish Hills (CC BY 4.0)`, source URL `https://www.hill-bagging.co.uk/dobih/downloads/`, generated date `2026-08-30`, and whole-`sources` hash `54ed97ccc6c4e5e831910ab3b4552360f980ca34249630755ad853e8d68c2402`.

| Order | List | Source key | ID | Selector | Count | Roster SHA-256 |
| ---: | --- | --- | --- | --- | ---: | --- |
| 1 | Munro Tops | `dobih-munro-tops` | `2D6085E1F8A83611B254` | `MT=1` | 226 | `160fd59e3b4409919a7b5e70bfed265fa70a9bc62feb9743ae754ce198a5c65f` |
| 2 | Furths | `dobih-furths` | `3F89BA4000AC2F219F24` | `F=1` | 34 | `020e054ab78d24151f4c16169acd847e63d6a6867d792b98148906ac2b3fae1d` |
| 3 | Donalds | `dobih-donalds` | `B167A387630B745AE6A5` | `D=1 OR DT=1` | 141 | `a64c6bba2e79621fa08004bb28d1721259b0cd1f6dc0f7685935cb9b6290bfae` |
| 4 | Wainwright's Outlying Fells | `dobih-wainwright-outlying-fells` | `5B2ECF1DEB1708867AED` | `WO=1` | 116 | `5ffd1ed3e76a350203a27d57ded8f7b7ac354c0443547f63cb8a788cd30f4999` |
| 5 | Fellrangers | `dobih-fellrangers` | `8A6978ADBBAC1DB066C6` | `Fel=1` | 230 | `f72a4325df13c1e3e4b5f3046b297e558e900441cad6a44637b017e9988d11c8` |
| 6 | Vandeleur-Lynams | `dobih-vandeleur-lynams` | `65DF2B16A9B4E20A20CB` | `VL=1` | 275 | `c02ccde9dc1094bdc54262c0d336cff34805abbb2d6552d213cf45f8ebf4eee7` |
| 7 | Irish 2000-Foot Mountains | `dobih-irish-2000-foot-register` | `5E3E4171391831A39DF1` | `Hew=1 AND Country=I` | 207 | `cca6ca4c0a1a901b5038cc9cb1a7d80f759d42a0136b863a5e94542cf78bcbf4` |
| 8 | Grahams | `dobih-grahams` | `4944331F036CEB9BE3A1` | `G=1` | 231 | `57e27078f2ec8a323cc34521210d707eba817e3baf8297fa6dbb6971b0c298be` |

The definition metadata is exact:

| List | Deterministic ID seed | Countries | Region | Organization | Year |
| --- | --- | --- | --- | --- | ---: |
| Munro Tops | `dobih:munro-tops` | `GB` | Scotland | Scottish Mountaineering Club | `null` |
| Furths | `dobih:furths` | `GB`, `IE` | England, Wales, and Ireland | Scottish Mountaineering Club | `null` |
| Donalds | `dobih:donalds` | `GB` | Scottish Lowlands | Scottish Mountaineering Club | `null` |
| Wainwright's Outlying Fells | `dobih:wainwright-outlying-fells` | `GB` | Lake District | LDWA Hillwalkers Register | `null` |
| Fellrangers | `dobih:fellrangers` | `GB` | Lake District | LDWA Hillwalkers Register | `null` |
| Vandeleur-Lynams | `dobih:vandeleur-lynams` | `GB`, `IE` | Ireland | MountainViews / Mountaineering Ireland | `null` |
| Irish 2000-Foot Mountains | `dobih:irish-2000-foot-register` | `GB`, `IE` | Ireland | LDWA Hillwalkers Register / MountainViews | `null` |
| Grahams | `dobih:grahams` | `GB` | Scotland | Alan Dawson / Relative Hills Society; Scottish Mountaineering Club legacy register | `1992` |

The descriptions are exact:

- Munro Tops: `The Scottish Mountaineering Club recognizes these 226 Scottish summits above 3,000 feet as Munro Tops rather than separate Munros. The roster comes from DoBIH v18.5.`
- Furths: `The Scottish Mountaineering Club lists these 34 peaks above 3,000 feet in England, Wales, and Ireland as Furths. The roster comes from DoBIH v18.5.`
- Donalds: `The Scottish Mountaineering Club keeps the Donalds and Donald Tops of the Scottish Lowlands. This combined 141-peak roster comes from DoBIH v18.5.`
- Wainwright's Outlying Fells: `Alfred Wainwright described these 116 Lake District outlying fells. The LDWA Hillwalkers Register records completions, and the roster comes from DoBIH v18.5. Peaks progress counts all 116 entries. The LDWA permits High Knott (Williamson's Monument) to be omitted because access is prohibited.`
- Fellrangers: `The Fellrangers are the 230 Lake District summits in the Fellranger guides. The LDWA Hillwalkers Register records completions, and the roster comes from DoBIH v18.5.`
- Vandeleur-Lynams: `MountainViews and Mountaineering Ireland recognize these 275 Irish mountains at least 600 metres high with at least 15 metres of drop. The roster comes from DoBIH v18.5.`
- Irish 2000-Foot Mountains: `The LDWA Hillwalkers Register and MountainViews recognize these 207 Irish mountains above 2,000 feet with at least 30 metres of drop. The roster comes from DoBIH v18.5.`
- Grahams: `Alan Dawson and the Relative Hills Society keep the current 231 Grahams: Scottish mountains at least 600 metres high with at least 100 metres of drop. The Scottish Mountaineering Club kept the earlier register, and this roster comes from DoBIH v18.5.`

The product source key `dobih-irish-2000-foot-register` comes from registry identity `irish-2000-foot-register`. Its colon-form ID seed remains `dobih:irish-2000-foot-register`; hashing the product key would create the wrong ID and split one list into two identities.

The Vandeleur-Lynam and Irish 2000-Foot roster hashes intentionally differ from the first audit. DoBIH row 20085 contains one extra closing bracket. The fixture builder must first assert the exact raw value `Meenteog [Moing an tSamhaidh]]`, then emit name `Meenteog` and alias `Moing an tSamhaidh`. All other names use balanced bracket parsing and reject leftover brackets. Pure parser tests must prove that a changed raw value for row 20085 fails and that a second malformed bracket anywhere else also fails.

## Task 1: Write failing boundary and roster tests

**Files:**

- Add: `cloud-sql/migrate/src/__tests__/import-dobih-open-eight-lists.test.ts`
- Modify: `cloud-sql/migrate/src/__tests__/keeper-list-import-modules.test.ts`

1. Import the not-yet-created bundle, fixture, resolution fixture, and thin command boundary.
2. Assert the exact list order, source keys, deterministic IDs, selectors, counts, source hash, roster hashes, country bounds, regions, organizations, and conservative established years (`null` except Grahams `1992`).
3. Assert the base-three command still exports and runs only `BASE_THREE_KEEPER_LISTS`.
4. Assert no Irish County Highpoints key, ID, or definition appears.
5. Run the two focused files and confirm the new tests fail because the bundle is absent.

## Task 2: Add the definitions and thin command

**Files:**

- Add: `cloud-sql/migrate/src/keeper-list-import/bundles/dobih-open-eight.ts`
- Add: `cloud-sql/migrate/src/import-dobih-open-eight-lists.ts`
- Modify: `cloud-sql/migrate/package.json`

1. Export `DOBIH_OPEN_EIGHT_KEEPER_LISTS` in the exact order above.
2. Use plain source credit and keeper names in list copy. Keep all member destinations as the existing `point` + `summit` model; no schema or enum change is needed.
3. Mirror the existing command's flags, pretty JSON, newline, lifecycle, and exit codes. Pass the eight definitions explicitly to `runKeeperImport`. Expose an injectable command runner, or add a process-level test, so tests execute this boundary and prove the eight definitions, output, cleanup, and success and failure exit codes.
4. Add package script `import:keeper-lists:dobih-open-eight`.
5. Keep the legacy command and compatibility exports untouched.

## Task 3: Build and pin the source fixture

**Files:**

- Add: `cloud-sql/migrate/src/build-dobih-open-eight-fixture.ts`
- Add: `docs/data-audits/fixtures/keeper-list-dobih-open-eight-candidates-2026-08-30.json`
- Test: `cloud-sql/migrate/src/__tests__/import-dobih-open-eight-lists.test.ts`

1. Build from `/private/tmp/dobih-v18.5/DoBIH_v18_5.csv`, whose SHA-256 is `d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea`.
2. Copy only the pinned `dobih-v18.5` source metadata from the reviewed base fixture. Its archive SHA is `0c39e13ac59dd3fa172ac21dd56dd0f6fef19a14af47c7a5a444cce691e9f021`.
3. Select rows by the eight exact rules, sort by numeric DoBIH `Number`, and assign source ordinals `1..N` within each list.
4. Emit `sourceMemberId=dobih:<Number>`, matching `dobihNumber`, parsed name and aliases, numeric height, and source point.
5. Apply only the guarded row-20085 correction above. Reject any other unbalanced bracket. Test the parser directly with the exact allowed typo, a changed row-20085 raw value, and a second malformed name.
6. Prove the fixture has 1,460 memberships and 1,201 distinct source members. Prove 212 keys overlap Corbetts or Wainwrights and 989 are new after the base two.
7. Prove sequential reuse/new counts in bundle order are `0/226`, `4/30`, `7/134`, `0/116`, `217/13`, `13/262`, `207/0`, and `23/208`.
8. For every repeated source member, require identical name, aliases, height, coordinates, and DoBIH number; only list ordinal may differ.
9. Call `validateKeeperFixture` with the eight definitions so every exact production manifest is checked.

## Task 4: Reuse reviewed identities and pin a fresh catalog snapshot

**Files:**

- Add: `cloud-sql/migrate/src/build-dobih-open-eight-resolutions.ts`
- Add: `docs/data-audits/fixtures/keeper-list-dobih-open-eight-identity-resolutions-2026-08-30.json`
- Modify: `cloud-sql/migrate/package.json`
- Modify: `cloud-sql/migrate/src/keeper-list-import/core.ts`
- Add or modify: test helpers in `import-dobih-open-eight-lists.test.ts`
- Read-only artifacts under `/private/tmp`

1. Start a schema-v1 resolution fixture with every list key and an empty row array.
2. Before opening `beginKeeperImportTransaction`, run `validateKeeperFixture`, `validateKeeperResolutionFixture`, and a cross-list consistency validator. A fake-client test must prove that any fixture or cross-list identity conflict issues zero queries.
3. For one repeated `sourceMemberId`, require candidate rows to be byte-equivalent apart from `sourceKey` and `ordinal`.
4. For one repeated `sourceMemberId`, require every resolution row to use the same destination ID and resulting destination fingerprint. Permit at most one `catalog_repair`; other owner lists may project it as `existing_destination` only when their destination fingerprint equals that repair's complete after fingerprint.
5. Add a deterministic resolution builder and package script. It must read only pinned inputs, reject an input SHA mismatch, sort its output, and mechanically rewrite the checked fixture.
6. Reuse the 45 #162 DoBIH identities whose `sourceMemberId` appears in the open eight: 33 `existing_destination`, ten `curated_destination`, and two `catalog_repair` source decisions. Of these, 44 appear in the first unresolved report; `dobih:2540` auto-matches but must still be explicit. Do not review them again.
7. Reuse the seven guarded DoBIH auxiliary repairs from #162. If one reviewed catalog repair serves more than one open list, keep one repair action and project the exact repaired destination fingerprint into the other owner lists.
8. Query production in a repeatable-read, read-only transaction for Peaks-owned point summits in `GB` and `IE`, including exact IDs, names, heights, points, country/state codes, OSM IDs, external IDs, and keeper metadata. Pin `/private/tmp/dobih-open-eight-catalog-2026-08-30.csv` at SHA-256 `ba9eafe8f7a97f1b96a95c4b0c4a2fc6818f575da9425c1b57dd19467c319726` with 2,505 rows.
9. Pin the first unresolved analysis at `/private/tmp/dobih-open-eight-unresolved-catalog-analysis.json`, SHA-256 `77aeff4d1c11c0202568c351bc578a6437e85219808540aedbf60e01a9b2c502`, with 681 distinct unresolved source members. Pin the OSM evidence inputs too: `/private/tmp/dobih-open-eight-nearby-osm-nodes.json` has SHA-256 `1c1f8f128949bf0f400498567df2d8320dced0f6f83d2d8d8f882ee2dbbf6c8e`, and `/private/tmp/dobih-open-eight-nearest-osm-nodes.json` has SHA-256 `49a13a228df0e9658f9d9e76e98ab849ccfdfea170ab0cfaf170ef7b03dac3d4`.
10. Run the new command without `--apply`. Save the first report and extract every unresolved source member and nearby candidate.

## Task 5: Resolve every new identity

**Files:**

- Modify: `docs/data-audits/fixtures/keeper-list-dobih-open-eight-identity-resolutions-2026-08-30.json`
- Modify: `cloud-sql/migrate/src/__tests__/import-dobih-open-eight-lists.test.ts`
- Add: `docs/data-audits/keeper-list-dobih-open-eight-2026-08-30.md`

For each unresolved source member:

1. Reuse an eligible catalog summit only when the saved snapshot and DoBIH number, name/alias, height, and point support the same identity. Pin 27 new unique existing identities across their 43 owner rows: the 26 mappings from the first review plus the Graystones after-repair projection below.
2. Use a guarded catalog repair only for the same mountain identity. Pin the complete before fingerprint and source credit. A direct repair may move a point by at most 750 metres and change elevation by at most 10 metres; anything outside either bound must fail validation.
3. Add only four new direct repairs: `dobih:99` to `CE9EAA9D73E23237966E`, `dobih:681` to `2FF8B47F8C691BD20358`, `dobih:786` to `E430C7936F66347EBAFE`, and `dobih:996` to `8426AC54741E8DE5F686`. Retain each destination's OSM and other external IDs, then apply the reviewed DoBIH name, height, and point.
4. Do not repair `dobih:1693`, `dobih:722`, `dobih:725`, or `dobih:756` onto the close catalog rows: those rows are the valid Meikle Millyea Trig Point, Beinn a' Chapuill West Top, Beinn Clachach West Top, and Meall nan Eun West Top. Create the four main summits and add name-only auxiliary repairs to the close catalog tops while preserving their points. Remove the stale `wikidata=Q86753760` only from the Meikle Millyea Trig Point repair; preserve the other external IDs.
5. Otherwise create a deterministic curated summit from reviewed DoBIH and, when present, OSM evidence. Never put a DoBIH number into `destinations.external_ids`.
6. Pin the 14 known close-but-distinct curated sources and their reviewed destination/guard IDs: `1006 -> 29F9030A49A6C176BF59` guarded from `1F047C2D57CC6FA5E79B` and `BC54A152A8837753065D`; `1244 -> FD24FF478F5D933B0F36` from `39C5485837FAEBC3ECC4`; `1249 -> 137B3E56ED9A061E7BEB` from `683A0C010AA1787FA943`; `1251 -> C8C843E6D910D44465FF` from `2CF63B8AE97D8FA7D24A`; `1252 -> A4F4491FAC31021A29DE` from `6E9345C4B750E86BDEEA`; `1253 -> 36237E5CA329C34E9D16` from `0D4C672ED814C98CB0BF` and `70AC2A20B5B90DE21374`; `1256 -> 1318F569A3F7A5DFFA13` from `2CF63B8AE97D8FA7D24A`; `1260 -> 0D4C672ED814C98CB0BF` from `36237E5CA329C34E9D16` and `70AC2A20B5B90DE21374`; `2381 -> FA6062F443261C625523` from `9DA18880F7EF078569F3`; `2505 -> 83F043057782D0753D7F` from `74A9051905E311D6B934`; `1693 -> 69757A4223722D3E3EFC` from `11FFD6FDDC71B35D0B3D`; `722 -> 5CBB44DFB22BA22207D2` from `41E90A8FB96CF8FA49BC`; `725 -> 989ACDD7FA981A6D40E1` from `49C9C1351ECC38DCBC6C`; and `756 -> 0FB3989B2C629D1F01CF` from `BD4107A7C69C1B737239`. Add the reverse close-source guard from curated `dobih:1005` to `29F9030A49A6C176BF59`. Use `High Stile (Fellranger summit)` for `dobih:2381` and `Dent (Wainwright summit)` for `dobih:2505` so the existing names remain with their distinct peaks. Review every destination within 150 metres. A close distinct summit must name every allowed neighbor in `distinctFromDestinationIds`; a duplicate must reuse or repair the existing destination.
7. Map a raw `Country=I` row to `GB` when its County field contains `Causeway Coast and Glens`, `Derry City and Strabane`, `Fermanagh and Omagh`, or `Newry, Mourne and Down`; this includes the combined County values on `dobih:20137` and `dobih:20200`. Pin Cuilcagh (`dobih:20137`) to its reviewed GB catalog auto-match `E1B5FA84B5B6986A16FF`. Map every other `Country=I` row to `IE`, and map all non-I rows to `GB`. Do not infer Spain from `ES`.
8. Require one identity decision for a repeated source member across all owner lists. Require exactly 827 resolution rows: 76 `existing_destination`, six `catalog_repair`, and 745 `curated_destination`, plus eleven auxiliary repairs. The extra existing row must pin `dobih:3713` to auxiliary repair `dobih:2489-graystones-main`'s exact after identity `E9144D2AE04F27E48524`; without it, renaming the catalog point breaks Fellrangers' former auto-match. Keep each list's destination IDs unique and require all exact counts with zero issues.
9. Record the source and snapshot hashes, exact reuse/repair/add counts, overlap math, access caveat, and no-apply report SHA in the audit note. Require the Outlying Fells description warning above and prove before any apply that High Knott/Williamson's Monument (`dobih:2630`, deterministic destination `7F036923996DFDBB0C0C`) has no active route. If keeper-equivalent progress becomes a requirement, add optional-membership support first; otherwise keep the warning that Peaks counts all 116. Do not call the lists imported before an approved apply run.

## Task 6: Prove the bundle locally and against production read-only

1. Run focused tests for the new bundle plus the existing keeper core tests.
2. Run the full migration test suite and require zero failures.
3. Run `npm run build` and `git diff --check`.
4. Run an in-memory plan against the pre-#162 catalog state and the simulated post-#162 state. Require the same source-to-destination decisions and no duplicate destination additions.
5. Run the production command without `--apply` and save the exact JSON report. Require:
   - `apply=false`;
   - `complete=true`;
   - exact counts `226, 34, 141, 116, 230, 275, 207, 231`;
   - zero unresolved rows;
   - report order equal to definition order;
   - no duplicate planned destination or repair.
6. Run a second dry plan against the first plan's simulated additions, repairs, and all 1,460 resulting `list_destinations`. Require zero destination additions, zero repairs, no membership changes, and zero issues.

## Task 7: Review, ready pull request, CI, and cleanup

1. Request independent spec and code-quality reviews on the exact head. Reviewers must check source parsing, row 20085, all hashes/counts, cross-list identity consistency, Irish country handling, old-command isolation, transaction safety, no DoBIH external IDs, and `$0/month` cost.
2. Fix every valid finding and rerun focused tests, full tests, build, diff check, and production no-apply proof.
3. Commit only the bundle, command, fixtures, audit note, tests, package script, and this plan.
4. Push `codex/add-eight-dobih-lists-20260830` and open a ready, non-draft pull request against `codex/refactor-keeper-import-core-20260830`.
5. Wait for every required check to pass.
6. Confirm the remote head, ready pull request, green checks, and clean worktree.
7. Remove only `/Users/josiahm/projects/peaks/.codex-worktrees/add-eight-dobih-lists-20260830`, prune stale metadata, and delete only the local task branch. Keep the remote branch and pull request. Do not touch the dirty `next-mountain-lists` worktree.

## Handoff after this pull request

The eight lists remain queued until Josiah approves merges and production apply. After this branch is ready and green, start the separate KFS 100 plan. Route and cover-photo generation remain a later approved production phase; the final audit must check every imported member, every route cover, and every destination cover.
