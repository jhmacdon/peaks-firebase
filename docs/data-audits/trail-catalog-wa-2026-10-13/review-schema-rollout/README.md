# Catalog review schema rollout

This directory prepares the production rollout of
`20261014_trail_catalog_review_activation.sql`. It is not a record of an
applied migration until production receipts are added here.

Run `node docs/data-audits/trail-catalog-wa-2026-10-13/review-schema-rollout/build.mjs`
after the final migration passes CI. This offline command pins its SHA-256,
combines it with the before/after assertions, and writes `rollback-preview.sql`
and `manifest.json`. The bundle targets a direct `postgres` connection to
`peaks` through the existing local proxy. Use the documented operator password
source in memory, without printing it or writing it to a file.

Record a mandatory `data_source_runs` start receipt under
`trail-catalog-review-schema` before running the bundle with `psql -X -w
-v ON_ERROR_STOP=1`. Save its output and finish the receipt as `dry_run` only
when every assertion passes and the final rollback succeeds. A failed preview
must stay visible in its receipt. Run no catalog write tests against production;
those belong in disposable PostGIS CI.

Apply only the same pinned bundle that passed preview. Change its final
`ROLLBACK` to `COMMIT`, keep all other bytes, and save a separate apply receipt
and output. Inspect database objects and grants after commit. If the commit
reply is lost, report the outcome as unknown and inspect the database before
retrying. Do not overwrite earlier evidence or retry this one-time migration
against an existing review table.

The assertions compare route, segment, route-link, and candidate-job tuple
identities before and after the schema change. They also compare the existing
provenance, publish-integrity, contact, source-coverage, credited-cover,
standard-route activation, and rematch functions. The review table must start
empty. Factory, reviewer, and API roles receive no raw review-table writes;
the factory cannot review and the reviewer cannot activate. The activation
function has a separate `NOLOGIN` owner with no retained members or schema
creation right, and its route trigger runs with the caller's rights.

This migration adds no route or review outcome, and activates nothing. The
reviewer login requires its [separate setup approval](../reviewer-login-setup/README.md).
Expected fixed backend cost change: **$0/month**, using the existing database
and sweep endpoint.
