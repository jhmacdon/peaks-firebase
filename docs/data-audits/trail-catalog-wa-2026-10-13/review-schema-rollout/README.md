# Catalog review schema rollout

Production audit 127 [passed the rollback preview](production-preview-receipt.json).
Audit 128 then [applied](production-apply-receipt.json)
`20261014_trail_catalog_review_activation.sql` with a confirmed commit. The
[apply manifest](apply-manifest.json) pins the migration SHA-256
`be07e4dbfce648135cd1646e2692b85411b8278fba7faf593d7340aa2aed21ba`;
only the preview's final `ROLLBACK` changed to `COMMIT`.

The [read-only post-commit inspection](production-inspection.json), run with
[this query](production-inspection.sql), passed. The review table has zero rows.
Factory, reviewer, and API roles have no raw review-table writes or cross-lane
review/activation calls. The separate publisher owns only the activation
function, holds no memberships or elevated role flags, and cannot create in
the public schema. All seven guards are enabled; the route guard runs with the
caller's rights. The apply assertions found no catalog tuple or protected
function change. Counts remain 15,481 routes, 221 segments, 233 route-segment
links, and 22,975 route-destination links. All 21 candidate jobs remain bound:
four pending and 17 rejected. All four imported routes remain pending, with
their stored PostGIS geography XYZ distance intact.

Before preview and apply, commit `0173611` passed
[worker CI 38424172785](https://github.com/jhmacdon/peaks-firebase/actions/runs/38424172785)
with 1,250 tests, zero failures, and zero skips, including the full review and
activation database contract. [API CI 38424172825](https://github.com/jhmacdon/peaks-firebase/actions/runs/38424172825)
also passed. This schema receipt grants no route review or publication approval.
Do not rerun the one-time migration against the existing review table.

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
