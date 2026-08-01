# Trip Reports

Trip Reports are public condition updates tied to one completed activity. The
activity proves where the report belongs; readers never receive its private GPS
track.

## Why the old feature stopped working

The 2021 iOS flow wrote reports straight to the public `tripReports` Firestore
collection. A report held free-form text and photo blocks plus destination IDs.
Its route and timeline fields were booleans, not stable route links. Photos used
a flat `reports/<uuid>.jpg` Storage path.

Later iOS work removed the UIKit create and edit screens. The current SwiftUI
session screen kept a row, but its create action did nothing. Destination rows
did not open, routes had no report section, and the web app remained the only
writer. This left two further risks:

- old clients could write flat photo paths that did not show ownership;
- deleting a report did not give the server a safe list of files to remove.

The new path uses Cloud SQL and the Peaks API for every read and write. There is
no Firestore runtime fallback.

## Data model

`trip_reports` stores the public text and an activity snapshot. A new report has
one unique `source_session_id`, so retries cannot make duplicates. The source
session ID stays nullable and has no foreign key: deleting an activity does not
erase a useful public report.

Child tables store:

- fixed condition codes, severity, and optional place context;
- at most eight owner-scoped photos;
- destination links derived from reached destinations;
- route links derived from the activity's active route rows;
- abuse flags;
- queued Storage deletions.

The API never infers links from names. It uses stable session joins. Legacy
reports retain their saved destination IDs, but the import does not guess a route
from the old boolean.

## Lifecycle and privacy

Creation requires an owned activity that has ended, synced, finished server
processing, and has a `processed_at` value. The API copies its public display
facts, derives entity links, and saves the report in one transaction.

Reads return public report content, author display name, conditions, photos, and
linked entity IDs. They do not return points, track geometry, health data, or
other private activity fields. If the source activity is later deleted, the
report remains and the API marks the source as unavailable.

Only the owner can edit or delete a report. Other signed-in users can flag it.
New photos must use:

`trip-reports/<owner uid>/<session id>/<stable asset token>.jpg`

Storage rules enforce that owner namespace. The API checks the same namespace.
Photo uploads use a stable token, so a retry replaces the same file. Update and
delete transactions queue removed paths. The existing API sweep drains that
queue through Firebase Admin Storage; no timer or new service is needed.

Imported legacy photos have no trusted owner-scoped Storage path. Text and
condition edits preserve them. Deleting a legacy report removes its database
rows but does not guess at a file path.

## Rollout

1. Apply `cloud-sql/migrations/20260731_trip_reports.sql`.
2. Run `npm run migrate:trip-reports` from `cloud-sql/migrate` and inspect its
   audit totals. It is safe to run again.
3. Deploy the API, web app, Firestore rules, and Storage rules.
4. Release the iOS client.
5. Audit malformed or skipped legacy rows before retiring old-client Firestore
   write access.

No migration or deployment runs from this change branch.

## Cost

This adds tables and small indexed reads to the existing Cloud SQL instance,
uses the existing API service and sweep, and stores only user-selected photos.
It adds no service, scheduler, or minimum instance. Expected fixed monthly cost:
`$0`.

## Follow-ups

- Add an admin review queue for `trip_report_flags`.
- After old-client use reaches zero, remove the temporary create-only rule for
  flat legacy photo paths and the old Firestore report write rule.
