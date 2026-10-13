# Photo queue import

Run from the Firebase task checkout with the operator database profile already
loaded. This command adds licensed photo proposals to the existing admin queue.
Human review still decides whether to approve each photo. It never writes
destination hero fields or activates a route.

First run dry, using new report filenames:

```sh
cloud-sql/migrate/scripts/run-tsx.sh \
  docs/data-audits/trail-catalog-wa-2026-10-13/photos/operations/import-photo-queue.mts \
  --manifest cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/photos/candidates.json \
  --review cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/photos/review.json \
  --catalog cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/catalog-places-6bb7916bb071.json \
  --report docs/data-audits/trail-catalog-wa-2026-10-13/photos/operations/dry-1.jsonl
```

Review every candidate outcome and the summary. Apply uses the same command
with a new report filename and these flags from the dry summary:

```text
--apply --manifest-sha256 <manifestSha256> --review-hash <reviewHash>
```

The default run calls the existing importer inside a transaction and rolls back
its queue changes. Both modes save a mandatory start and finish receipt in
`data_source_runs` under `trail-catalog-photo-queue`. Added backend cost is about
$0/month; this uses the existing database and runs only when called.

Each proposal in `review.json` needs its destination ID, exact `sourcePageUrl`,
`metadataFile` relative to that file, `metadataSha256`, and `candidateSha256`.
The last digest uses SHA-256 over `stableJson` of the candidate returned by
`parseDestinationPhotoManifest`. The wrapper binds every image, credit, license,
size, and crop to that proposal, then checks destination ID, name, and XY against
the saved catalog and live row.

The wrapper locks existing queue rows before destination rows, then checks for
new queue rows. It skips destinations with an existing credited hero and never
changes an approved or denied queue row. An exact retry keeps the existing queue
ID and reports `already_queued`; a pending crop change uses the existing importer's
focal-point update. Every candidate gets a JSONL outcome and reason. Empty input
fails. Every `hero_image*` field must match before and after the upsert.

Connection, statement, and lock limits are 10 seconds, 60 seconds, and 5 seconds.
An approval race can make a run fail or change its review hash; run dry again
and review that report before retrying. If a COMMIT reply is lost, the report says
`apply_outcome_unconfirmed`, and the audit records a null write count. Inspect
the queue and run dry again before any retry. A finish-receipt failure after a
confirmed COMMIT keeps the committed counts in the local report and fails the
command so the audit fault stays visible.
