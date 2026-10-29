# Glacier manifest hashes

Since PR "make glacier manifest hashes platform-stable", every computed
outline metric (areas in km², overlap areas and shares, IoU, area ratios) is
rounded to `METRIC_DECIMALS` = 9 decimal places
(`cloud-sql/migrate/src/glaciers/outline-geometry.ts`) before it is compared,
hashed or written. Before that, the projection's libm calls made the last
digits, and so the hash, differ between Linux and macOS: the Baker package
hashed to `3586a87d…` on Linux and `1c0289af…` on macOS with identical
decisions. Source coordinates and source attribute values are not rounded.

The rebuild changed no decision, flag, match, geometry or fact for either
applied mountain; only review numbers beyond the 9th decimal and therefore
the hashes changed.

| Package | Applied with | Platform-stable hash (replay with this) |
| --- | --- | --- |
| Rainier (`import-rainier-glaciers.ts`) | `1561f541bae318aaf313477c12967e8d9eb7919cf13f1200fc094a2c5c708794` on main before this change (the runbook's earlier `1ca5fb08…` predates later builder edits) | `3b7f23b88afd37b1c4d2e67fac6e67bb1591aa28a79b1ed67209637e3606fbcd` |
| Mount Baker (`import-baker-glaciers.ts`) | `3586a87dba5b42f0571af85bcc2cfc194e8381e3125d879590bfa7d8ec9baf78` | `c082ef875e6d6bf8e3173183bf62c3c791a873bb87de0f3771ee596393694c13` |

A replay of an applied mountain passes the new hash to
`--expected-manifest-sha256`. The writer skips unchanged rows, but each row's
stored `provenance.outline.review` numbers move to the rounded values, so a
replay rewrites those facts rows once. Checked on a disposable database
(Baker applied with `3586a87d…`, then replayed with `c082ef87…`): all 14 facts
rows got a new `updated_at`; outline revisions, destination rows, route and
session queues and crossings were unchanged, since the queue triggers compare
the outline bytes. Nothing needs replaying now: the stored rows are correct.

Apply rule: rebuild the manifest on the apply machine and compare its printed
`manifest_sha256` with the PR's before `--apply`.
