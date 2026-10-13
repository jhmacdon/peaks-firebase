# Four cover approval rollback preview

Production attempt 3 passed under audit **130** with SQL hash
`2dfe29e425d6acb5700e793c11f931840a3f97ad12594d47b5e204a68bad3c03`.
All inside-transaction checks passed, rollback completed, and bounded readback
matched the four full place and candidate preimages. The receipt records
four matched rows and zero writes. No photo was approved and no hero field
or route changed durably. See [output](production-preview-3.txt) and
[receipt](production-receipt-3.json). Actual approval remains a separate
verified-admin action.

Production audit **125** failed before any UPDATE. Source commit `93bad14`
generated SQL hash
`45bbc15c3e6ef244ec7b880977297bce6a9977baffaa482b57f9a538195c9541`.
PostgreSQL parsed an unparenthesized JSONB containment operand as a boolean
followed by `->`. The corrected builder groups every extracted JSONB operand
in its containment and equality checks. Keep the original
`production-preview.txt`, `production-receipt.json`, and
`production-audit-id.txt` intact. They record the failed attempt, with zero
writes. No photo has been approved through this preview.

Production audit **126**, from corrected source commit `dd19fdf` and SQL hash
`41b871f2d7c738951b91ae0e0919bae504b55733ca02e5af50c1e199a1b623d0`,
passed every inside-transaction assertion and confirmed rollback. The later
whole-catalog tuple scan exceeded the 60-second limit, so that audit remains
failed. Keep its `-2` files intact. Post-rollback readback now compares only the
four exact full place and candidate rows. Unrelated-row and route/segment/link
tuple checks still run inside the transaction.

This file tests the database update shape for the imported Lake Serene,
Rattlesnake Ledge, Skyline, and Lake Twentytwo covers. It pins their existing
queue IDs from production audit 116, exact source, author, license, dimensions,
notes, and framing from the saved manifest, and public place identity from the
catalog snapshot. The generator checks the saved Commons metadata hashes and
the confirmed queue receipt before it writes SQL. It does not connect to a
database or read a credential.

Run the offline builder from the repository root:

```sh
node docs/data-audits/trail-catalog-wa-2026-10-13/photos/approval-preview/build.mjs
```

Inspect `manifest.json` and the generated `rollback-preview.sql` before running
the preview. Use the existing operator connection to `127.0.0.1:5432/peaks`,
with the password in memory. Check the SQL hash against `previewSha256`.
Record a separate mandatory `data_source_runs` start receipt under
`trail-catalog-photo-approval-preview` **before** starting the preview
transaction. Include the SQL hash, four candidate IDs, mode `rollback-only`,
and fixed monthly cost delta 0 in its notes. Use a new output filename:

```sh
psql -X -w -v ON_ERROR_STOP=1 \
  -f docs/data-audits/trail-catalog-wa-2026-10-13/photos/approval-preview/rollback-preview.sql
```

Save the output. Finish the separate audit as `dry_run`, with `rows_in=4`,
`rows_matched=4`, and `rows_written=0`, only after both inside-transaction
assertions and post-rollback readback pass. Any SQL or readback error must
finish as `failed`; keep the error and inspected counts in the audit. If the
rollback response is lost, inspect the database through a new connection
before reporting the outcome. Do not retry blindly or replace earlier reports.

Attempt 3 used `production-preview-3.txt`, `production-receipt-3.json`, and
`production-audit-id-3.txt`. Any later preview must use a new audit and unused
numbered filenames. Check the manifest hash; earlier audit hashes describe
only their earlier versions.

The preview locks all four candidate rows before all four destination rows,
as the existing admin action does. It requires the exact pending candidates,
public place identity, and no credited hero. It captures every current hero
field under those locks, exercises the same destination and queue update
fields as the admin action, then checks exact target values, untouched fields,
counts, and unaffected tuple identities. It forces deferred checks, rolls back,
and compares full target rows with the preimage. A concurrent change to one
of those eight rows makes readback fail; an unrelated catalog write after
rollback does not affect this bounded proof.

The original candidate `image_url` is a **preview-only stand-in** for the future
Firebase Storage URL. `preview-only:rollback` is a synthetic marker, never an
admin identity. Neither value can become a real approval through this file:
it has one unconditional rollback and no apply mode. Never turn it into an
apply script or change its transaction boundary.

This preview does **not** test image download, media SHA-1, EXIF rotation,
rendering, Storage upload, admin authentication, or public serving. Actual
approval must use the existing verified-admin `/admin/photos` action, with
the exact candidate ID and saved framing. Do not substitute raw SQL, a route
worker credential, or a fabricated admin identity. The licensed cover work
already has task authorization; this preview adds no permission gate.

## Separate public media preflight

`media-preflight-2.json` passed all four exact original-image SHA-1 values,
saved source dimensions, and cover rendering limits. The first report records
a sandbox DNS failure; the successful run used the same public-only script
outside that network restriction. Both reports remain intact.

The script imports Sharp 0.33.5 only. Importing the existing
`destination-photo-storage.ts` module would initialize Firebase Admin and
select certificate or Application Default Credentials, so this check uses a
pure Sharp equivalent of `renderDestinationPhoto()`: an 80-million-pixel input
cap, EXIF rotation, the existing 1600×900 minimum, a 2400-pixel maximum edge
without enlargement, and JPEG quality 86 with progressive and mozjpeg enabled.
The report pins the renderer body and dimension-helper hashes. It does not
test Firebase authentication, Storage, the admin action, or public serving.

Downloads allow only the exact `upload.wikimedia.org` URLs, with a 40 MiB cap,
30-second timeout, and at most five redirects on that host. Source and rendered
bytes stay in one new `/private/tmp` directory and are removed after the run.
The compact report contains dimensions, hashes, and byte counts. A later run
must use a new `--report media-preflight-N.json`; reports never overwrite.

Routes stay pending. This file never updates routes, segments, route links,
or candidate jobs. No new service or timer is added. Fixed backend cost change:
**$0/month**.
