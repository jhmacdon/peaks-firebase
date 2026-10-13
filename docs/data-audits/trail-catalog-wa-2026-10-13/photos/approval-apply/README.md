# Four photos through the existing admin action

These prepared files have not run. They cover only the four exact candidate
IDs in `manifest.json`: Lake Serene, Rattlesnake Ledge, Skyline Trailhead, and
Lake Twentytwo. They never update photo candidates, heroes, routes, segments,
links, or candidate jobs. Actual approval uses the existing verified-admin
`/admin/photos` action, one photo at a time, with the saved framing.

Check each file's SHA-256 against the manifest. `bindings.sql` pins the public
source, author, license, dimensions, framing, place identity, queue ID, route
ID, source hashes, and Commons metadata hashes from the successful rollback
preview. Do not replace its bindings or invent an admin identity.

Before any approval, run `start.sql` through the existing direct `postgres`
operator connection to `peaks`, with its password in memory:

```sh
psql -X -w -v ON_ERROR_STOP=1 -f docs/data-audits/trail-catalog-wa-2026-10-13/photos/approval-apply/start.sql
```

It requires audit 130's confirmed rollback, exact preview hash and four IDs,
all four exact pending photo/place bindings, no existing credited hero, and
four pending routes and candidate jobs. It inserts only one mandatory
`data_source_runs` row and returns its ID. Its initial status is `failed`, its
write count is `NULL`, and its notes say the outcome is unknown until readback.
Do not rerun start while this approval audit remains open.

After the first real approval, confirm its saved Storage URL uses the observed
project bucket `donner-a8608.appspot.com`. The prior public Mount Si cover
established that bucket; these files do not guess a bucket or read an env file.
An unexpected bucket requires inspection before proceeding. After each
approval, or after an interrupted batch, run readback with the returned audit
ID and confirmed bucket:

```sh
psql -X -w -v ON_ERROR_STOP=1 -v audit_id=ACTUAL_ID -v storage_bucket=donner-a8608.appspot.com -f docs/data-audits/trail-catalog-wa-2026-10-13/photos/approval-apply/readback.sql
```

Readback uses a read-only transaction. Save its receipt. It exports only public
photo/place fields, route and candidate-job state, tuple and geometry hashes,
the derived credited-cover gate, and a reviewer-recorded boolean. It never
exports a Firebase UID or private reviewer notes. That boolean proves a fresh,
nonempty, non-preview reviewer marker; the existing admin action supplies the
Firebase authentication check. SQL alone cannot revalidate an admin token.
The Storage check pins the HTTPS origin, bucket, exact destination/candidate
object path, and download-token URL shape. Public HTTP/image serving still
needs a separate fetch of each saved URL.

Every approved photo must retain its exact source, credit, license, framing,
and place identity, with matching hero and Storage fields. Each pending target
must retain its before-image tuple. Denied rows, changed pending targets, or
wrong approved bindings stop readback and finish. Scoped route tuple versions,
XYZ geometry hashes, and candidate-job tuple versions must match the start
receipt; all four routes and jobs must remain pending. This does not clear
access, route review, shared-source repairs, or any other publication gate.

After saving a successful readback, run `finish.sql` with the same arguments.
It repeats the checks and updates only the audit row. `rows_in` and
`rows_matched` are four; `rows_written` counts verified approved photos, not
physical SQL rows. Four approvals mean four place rows and four queue rows
changed, reported separately as eight physical rows. Only four exact approvals
and both four-row change counts finish as `success`; a checked incomplete
batch finishes as `partial` with its actual counts.

A failed check leaves the initial unknown write count intact. If a UI reply or
audit-finish reply is lost, inspect live state and the audit through a new
connection; never report zero writes or retry approval blindly. If finish
already committed, its saved receipt is the result. These files add no service
or timer. Fixed backend cost change: **$0/month**.
