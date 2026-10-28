# Reviewed trail label repairs

Use `cloud-sql/migrate/src/repair-trail-labels.ts` for reviewed changes to stored
segment display names. It leaves source aliases, terrain types, geometry,
statistics, and route links intact. A name audit supplies review candidates;
shared aliases alone do not justify merging different trail names.

Run from `cloud-sql/migrate`. The tool uses `../scripts/peaks-psql`, which obtains
the runtime password from Secret Manager. It does not store credentials.

1. Put the selected segment IDs in a JSON array. Capture current labels, stable
   row hashes, every shared route link, and protected-review state:

   ```sh
   node --import tsx src/repair-trail-labels.ts \
     --snapshot-ids /path/to/ids.json --out /path/to/before.json
   ```

2. Review the source names, terrain, and every shared link. Create a version-1
   plan with `reviewed_by` and 1–1000 `changes`. Each change has `id`, `before`,
   `after`, `stable_hash`, `links`, `reason`, and `evidence`. Use the snapshot's
   exact hash and links; see the [October repair plans](audits/2026-10-28-trail-label-repairs/README.md).
   Only Peaks-owned active, pending, or superseded route links are allowed.
   Existing database guards still protect approved catalog reviews.

3. Preview the plan. This locks and checks the rows but changes no data:

   ```sh
   node --import tsx src/repair-trail-labels.ts \
     --plan /path/to/plan.json --out /path/to/preview.json
   ```

4. Before production writes, obtain task authorization and create an on-demand
   Cloud SQL backup. Check that its status is `SUCCESSFUL`. The apply flag records
   that verified backup ID; it does not check backup status itself.

   ```sh
   node --import tsx src/repair-trail-labels.ts \
     --plan /path/to/plan.json --apply --backup-id BACKUP_ID \
     --out /path/to/receipt.json
   ```

5. Read all target rows again and compare labels, full stable hashes, and shared
   route links with the plan. Check the public route API for representative routes.
   Rerun the catalog name audit and keep unresolved terrain and geometry gaps visible.

The transaction aborts on missing rows, changed labels, changed non-label fields,
changed links, private links, or unexpected trigger effects. Reapplying a completed
plan is safe when its hashes and links still match. Each run requires a new output
path. A receipt left at `started` means the result needs inspection before retrying;
it does not prove either commit or rollback. A committed receipt contains the
normalized plan hash and the checked rows.

`review-trail-ice-sources.ts` compares every stored edge midpoint with supplied OSM
ice polygons and respects polygon holes. It reports names, source IDs, covered
distance, and uncovered distance. This checks the source extract, not current ice
extent. Mixed, missing, or unnamed coverage requires review before assigning a
geographic name. Keep OSM attribution with the source evidence.

`scripts/propose-trail-label-aliases.py` reads every raw segment in contiguous
trail stretches. It includes inner segments that an audit's boundary IDs omit,
and follows shared IDs across routes. Proposals require source and shared-link
review before they become plans. Regression tests require a second proposal pass
to return no changes after applying the first proposal to its fixture.

`scripts/review-trail-label-audit.py` joins the original JSONL audit, committed
receipts, documented exceptions, and a fresh JSON audit. Its output distinguishes
corrected labels, retained terrain transitions, distinct labels with shared aliases,
named winter routes, and records that still need work. It never writes to the DB.

The October St. Mary's correction uses a separate guarded SQL file because its
source-backed change includes a terrain type. It records the decision in
`segment_terrain_labels`, refreshes linked route terrain categories, and checks that
geometry, statistics, and existing route summaries did not change. Do not extend
the label-only tool to make guessed terrain changes.

Validation: run the label-repair tests with `TEST_DATABASE_URL` pointing to a database
ending in `_test`. They use temporary fixtures and check rollback, idempotency,
drift, shared links, private ownership, and trigger effects. Never aim tests at
production. These tools add no services or scheduled jobs; recurring compute cost
changes by $0/month. Production repairs use one backup under the existing Cloud SQL
backup-storage settings.
