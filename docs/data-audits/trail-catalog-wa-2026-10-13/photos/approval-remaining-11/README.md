# Remaining eleven place covers

Prepared only; no production SQL or approvals have run from this batch. The
four-photo scripts, manifests, and receipts remain separate and unchanged.
Audit 116 supplies these exact pending queue IDs; audit 131's four approved
candidates are excluded.

| Place | Candidate ID | Saved focal X/Y |
| --- | --- | --- |
| Mount Si | `xxoCzbZ6wudjscAe788b` | 50/40 |
| Little Si | `sLF3JFQL61nB2nK78F2f` | 50/50 |
| Snow Lake | `vNACg3f2NioMeR2qdBjX` | 50/50 |
| Lake Ingalls | `goxoEUevbtTLEgWOBQ2T` | 50/65 |
| Colchuck Lake | `jXUNh6O7X9w3ubnS2FuC` | 50/50 |
| Lake Stuart | `tPvVhGEVwnGL3z5R-DEm` | 50/60 |
| Mailbox Peak | `RuNcafBQAXNpAfNZMuCb` | 50/60 |
| Blanca Lake | `3QHwUgURE8ts4_kWO639` | 50/50 |
| Poo Poo Point | `Dhv7RDXMojUW0T_jZYI4` | 50/50 |
| Tolmie Peak | `WBxrYhLbTZWuLM7DqyAa` | 50/60 |
| Esmeralda Trailhead | `ITkoNEc-0dHINLIDz6gG` | 50/100 |

[Saved source review](../../../../../cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/photos/review.json)
binds each place, author, license, dimensions, original image SHA-1, and Commons
metadata SHA-256. [UI framing review](ui-framing-review.json) records the root
agent's actual admin crop checks at 2026-10-13T16:51:03Z; it claims no saved
screenshots or approvals. Framing remains exactly as queued. Original media
and pure Sharp rendering still require a separate passing report.

These eleven photos cover twelve blocked route candidates, including both
Mailbox routes. Their jobs remain rejected; no route needs to exist for a
place photo to enter admin review. The four imported pilot routes must stay
pending, and all 21 pilot jobs must retain the four-pending/seventeen-rejected
partition. Global route, segment, route-link, and candidate-job tuple hashes,
the four imported XYZ path hashes, and the prior four photo/hero tuples must
remain unchanged. Only the eleven target place and queue rows enter the photo
before-image/readback comparisons. No credited hero may be replaced. Mount Si
has an existing image; a non-null URL alone does not establish credited cover.
Preflight checks its actual image, attribution, and source URL together.

From the owned task checkout, prepare and inspect the pinned files:

```sh
photo_batch=docs/data-audits/trail-catalog-wa-2026-10-13/photos/approval-remaining-11
node "$photo_batch/build.mjs"
node "$photo_batch/media-preflight.mjs" --report media-preflight-1.json
```

The media helper fetches only the exact public Commons originals, checks each
saved SHA-1 and dimension, and uses the existing pure Sharp render checks. It
loads no Firebase module, credential, or database. Require all eleven results
to pass. Recompute the saved report's SHA-256 and check its input hashes against
this manifest before passing that hash and `media_passed=true` to `start.sql`.
Those are trusted operator assertions, not checks SQL can perform on a local
file. A changed source, undersized render, failed download, or decoded-image
error blocks approval.

Run the SQL only through the existing direct `postgres` connection to `peaks`,
with its password in memory. Use new report filenames; never overwrite an
earlier output or receipt. First create the separate mandatory preview audit:

```sh
psql -X -w -v ON_ERROR_STOP=1 -f "$photo_batch/preview-start.sql"
psql -X -w -v ON_ERROR_STOP=1 -v preview_audit_id=ACTUAL_PREVIEW_ID -f "$photo_batch/rollback-preview.sql" > "$photo_batch/production-preview-1.txt"
```

Save the output and recompute its SHA-256. Only pass `rollback_confirmed` after
the command succeeds, all inside assertions pass, the final rollback succeeds,
and the bounded eleven-row before-image readback passes. If the reply is lost,
inspect through a new connection before choosing a finish state. SQL trusts
the operator's saved-output proof. The preview never becomes an apply script:
its original image URL and synthetic reviewer marker exist only inside the
rolled-back transaction.

```sh
psql -X -w -v ON_ERROR_STOP=1 -v preview_audit_id=ACTUAL_PREVIEW_ID -v preview_state=rollback_confirmed -v output_sha256=ACTUAL_OUTPUT_SHA256 -v report_name=production-preview-1.txt -f "$photo_batch/preview-finish.sql"
```

For failure, use `failed` or `outcome_unconfirmed` and the saved failure-output
hash. Failed/unknown previews retain a null write count and cannot unlock UI
approval. Preview and real approval use separate audit rows.

After the passing media report and confirmed preview, start the real audit:

```sh
psql -X -w -v ON_ERROR_STOP=1 -v preview_audit_id=ACTUAL_PREVIEW_ID -v media_passed=true -v media_report_sha256=ACTUAL_MEDIA_REPORT_SHA256 -f "$photo_batch/start.sql"
```

It rechecks exact live pending queue/place/source/framing bindings, no credited
hero overwrite, prior approved covers, and the pilot state, then inserts only
an audit row with `rows_written=NULL`. Use the returned approval audit ID.
Approve each exact candidate through the existing verified-admin `/admin/photos`
action at the saved framing. Neither worker credentials nor raw SQL may approve
a photo. After each approval, or after an interrupted batch, run readback:

```sh
psql -X -w -v ON_ERROR_STOP=1 -v audit_id=ACTUAL_APPROVAL_ID -v preview_audit_id=ACTUAL_PREVIEW_ID -v storage_bucket=donner-a8608.appspot.com -f "$photo_batch/readback.sql"
```

Save a new `production-readback-N.json` each time. Exact approved bindings or
untouched pending rows pass; denied rows, metadata/hero/bucket drift, or any
protected tuple change stop the check and leave the audit unknown. Readback
exports public fields and a fresh non-preview reviewer marker boolean, never
the actual UID or private notes. Firebase authentication comes from the admin
action. Check actual public Storage serving with `public-serving.mjs` after the
final saved readback; all eleven must match the source-bound render hashes.

Only after successful readback and public serving, run `finish.sql` with the
same SQL arguments. It repeats the checks and updates only the audit row.
Eleven exact approvals finish as `success`; a checked interrupted batch finishes
as `partial` with its actual count. `rows_written` means verified approved
photos: eleven photos update eleven places and eleven queue rows, reported
separately as 22 physical rows. A lost finish reply requires audit inspection,
not blind retry. Photos do not clear source, access, summit, geometry, or route
review blockers. Tipsoo, Rainy Pass, and Stuart Lake trailhead photo gaps remain
outside this batch. Fixed backend cost change: **$0/month**.
