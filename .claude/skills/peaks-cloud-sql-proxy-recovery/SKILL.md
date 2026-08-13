---
name: peaks-cloud-sql-proxy-recovery
description: Restore the local Peaks Cloud SQL Auth Proxy and make it survive Mac restarts. Use when a Peaks database wrapper says the proxy at 127.0.0.1:5432 is unreachable, returns ECONNRESET after a reboot, reports the Cloud SQL Admin API disabled in an unrelated quota project such as KOTH, or when paused Peaks route workers need database access restored.
---

# Peaks Cloud SQL Proxy Recovery

Restore the shared local proxy without changing Cloud SQL, queue rows, leases,
or database data.

## Recover

Run the bundled installer from a Peaks Firebase checkout:

```bash
.claude/skills/peaks-cloud-sql-proxy-recovery/scripts/ensure_proxy.sh
```

The script installs and starts the per-user launch service
`com.jhm.peaks-cloud-sql-proxy`. It uses:

- instance `donner-a8608:us-central1:peaks-db`
- listener `127.0.0.1:5432`
- quota project `donner-a8608`
- a readiness endpoint on `127.0.0.1:9090`

Keep `--quota-project donner-a8608`. Application Default Credentials may point
at another quota project after a restart. A 403 that names `koth-537a2` does
not mean the Peaks Cloud SQL Admin API is disabled. Do not enable that API in
KOTH; correct the proxy quota project instead.

The script writes only the user's LaunchAgent and local log directory. It does
not add hosted infrastructure or a monthly charge.

## Verify

Run the approved queue wrappers from their exact worker checkouts:

```bash
.claude/skills/peaks-route-catalog-audit/scripts/route_audit_jobs.sh stats
.claude/skills/peaks-route-elevation-backfill/scripts/route_elevation_jobs.sh stats
```

Use each wrapper's required checkout as `workdir`. A listening TCP port is not
enough; both stats calls must return queue JSON. Do not use raw SQL or raw npm.

Then inspect leases and the worker tasks. Do not release a lease held by an
active task. Resume paused, staggered schedules only after both wrappers work
and every clean worker checkout matches exact `origin/main`.

## Inspect

Check the installed service without changing it:

```bash
.claude/skills/peaks-cloud-sql-proxy-recovery/scripts/ensure_proxy.sh status
```

The service log is at
`~/Library/Logs/Peaks/cloud-sql-proxy.log`. If recovery still fails, report the
exact readiness or authentication error. Do not alter queue state to hide a
proxy failure.
