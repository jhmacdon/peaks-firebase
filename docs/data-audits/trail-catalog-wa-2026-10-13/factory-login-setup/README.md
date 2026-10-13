# Factory login setup plan

Read-only production checks found the `peaks-route-factory` marker role and no
`peaks-route-factory-worker` LOGIN. The exact factory Keychain item is absent.
This plan creates that one login. It does not reset an account or touch the
reviewer login, credentials, jobs, routes, or geometry.

The [worker contract](../../../../.agents/skills/peaks-route-factory/references/worker-contract.md)
calls login creation **Human-only setup** and says: “The scheduled worker must
never perform these steps. An operator does them after the code reaches the
canonical `firebase` checkout.” This helper is an operator setup tool. A
scheduled factory or review worker must not run it. The user's explicit task
worktree rule overrides the contract's canonical-checkout instruction here.
Review this committed plan and run it as the operator from this task worktree;
keep the canonical checkout read-only. Obtain explicit operator approval before
apply.

The helper uses the documented operator Secret Manager item
`peaks-db-postgres-password` in project `donner-a8608`, through the existing
Cloud SQL proxy at `127.0.0.1:5432/peaks`. It never supplies that secret to a
worker. It generates the new factory password in memory and passes it to the
Keychain helper through stdin. No password enters argv, files, reports, or
logs. The helper suppresses raw driver, cloud CLI, and Keychain errors.

From the repository root:

```sh
node docs/data-audits/trail-catalog-wa-2026-10-13/factory-login-setup/setup.mjs --check
node docs/data-audits/trail-catalog-wa-2026-10-13/factory-login-setup/setup.mjs
```

The first command checks pinned local hashes only. The second creates the login
inside a transaction, checks its flags and grants, then rolls back. It makes no
Keychain write. It saves a preview audit in `data_source_runs`; that audit is the
only durable database change in preview mode. Check its printed audit ID and
the `checks: passed` result before approval.

After explicit operator review and approval:

```sh
node docs/data-audits/trail-catalog-wa-2026-10-13/factory-login-setup/setup.mjs --apply
```

The [SQL plan](setup.sql) requires a direct postgres connection to `peaks` with
`CREATEROLE` authority, an
absent fixed login, and a factory marker with no login, elevated flags, or role
memberships. It creates `LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
NOREPLICATION NOBYPASSRLS`, grants exactly the factory marker without role
administration, and selects SCRAM password storage. [Grant checks](verify.sql)
confirm candidate read/write access and deny receipt removal, destination DML,
route path/name updates, queue seeding, direct audit writes, and API/review role
membership. The helper reruns those checks through the actual new login after
commit, including a real candidate-table read.

Cloud SQL's postgres login is not a PostgreSQL superuser. The helper checks its
exact identity and `CREATEROLE` flag, which supplies the needed login-creation
authority. It does not require `rolsuper=true` or grant superuser rights. SQL
errors, including a missing marker-role grant authority, roll back the preview
or apply transaction; preview must prove these grants work on the target.

The exact Keychain service is `com.jhm.peaks.route-factory-db`; the account is
`peaks-route-factory-worker`. To avoid committing a login whose password cannot
be saved, apply adds this absent item **before** database commit, after SQL
checks. It uses Security.framework and refuses to overwrite an existing item.
Keychain and PostgreSQL cannot share one transaction. A Keychain error causes
SQL rollback. On any failure, a separate operator connection checks whether
the fixed login exists. The helper removes only its own new item, whose password
still matches, and only when that check proves the login absent. If COMMIT's
outcome is unknown or the login exists, it keeps the item and stops. A process
crash can leave an item and an unfinished audit; inspect this exact login and
audit before recovery. Never delete the item on a guess or reset an account.

A failure after commit keeps both the login and password for review. The helper
marks the audit partial when commit succeeded or its outcome remains unknown;
it records failure when rollback or independent readback proves no login.
The initial audit survives a failed transaction. A missing final audit update
appears in the redacted result and needs operator follow-up.

This step enables factory authentication only. It does not grant independent
review or route activation. Expected fixed backend cost change: **$0/month**.
The login and audit use the existing Cloud SQL instance; no service or timer is
added.
