---
name: peaks-firestore-sql-cutover
description: Audit and repair Peaks routes, recordings, points, and their links that remain only or partly in Firestore after the Cloud SQL cutover. Use for pre-release migration checks, source/target parity reports, and guarded reruns before Peaks 2.0. Do not use for standard-route research or catalog expansion.
---

# Peaks Firestore SQL Cutover

Find and repair only data that never reached Cloud SQL. Never make Firestore a
runtime fallback or overwrite a newer SQL row with an older Firestore copy.

## Data map

- Firestore `routes` → `routes`, `route_destinations`.
- Firestore `sessions` → `tracking_sessions`, `session_destinations`,
  `session_routes`, `session_markers`.
- Firestore `points` → `tracking_points`.
- A Firestore session marked `deleted: true` is not an active source row.

Use the guarded reconciler. Do not use the broad `migrate:routes`,
`migrate:sessions`, or `migrate:points` commands for a cutover audit: those
older jobs scan every row and can rewrite data that SQL now owns.

## Audit

Run from a current Peaks Firebase checkout:

```bash
.claude/skills/peaks-firestore-sql-cutover/scripts/cutover_audit.sh audit
```

The command is read-only. It compares exact IDs, joins, and point keys, not only
table totals. Keep these classes separate in the result:

- `missing`: safe, recoverable rows and links;
- `blockers`: invalid recoverable source data that makes apply unsafe;
- `unresolved`: source defects that cannot become valid SQL rows, such as an
  orphan point document or a link whose destination or route exists in neither
  store.

Repeated Firestore points in the same second cannot all fit the SQL primary key
`(session_id, time)`. The reconciler keeps the first source sample, matching the
old migration order, and reports the omitted count. Never invent timestamps.
Never fill missing point or marker elevation with zero.

## Apply

Applying changes production data. Confirm the user asked for the migration in
the current turn. Require a dry run with zero blockers, then run:

```bash
.claude/skills/peaks-firestore-sql-cutover/scripts/cutover_audit.sh apply
```

Apply mode inserts only missing rows, point keys, markers, and joins in one
transaction. It does not update an existing route or recording row. It rolls
back on error and runs the same audit after commit.

Success requires every `missing` count to be zero after apply. Report every
unresolved category and count; do not call those records migrated or quietly
skip them. If a missing dependency still exists elsewhere in Firestore,
migrate that dependency with an equally guarded repair before retrying.

## Finish

Inventory any remaining client or service writer for these Firestore classes.
Fix post-cutover writers to use SQL and surface failures; do not preserve a
dual-write or legacy read path. State the source counts, inserted counts,
post-check, unresolved defects, and infrastructure cost. This on-demand workflow
adds no hosted service and should cost $0/month beyond existing database use.
