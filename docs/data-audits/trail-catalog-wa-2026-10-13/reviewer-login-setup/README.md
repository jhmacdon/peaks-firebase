# Reviewer login setup plan

Production has the `peaks-route-reviewer` marker but no
`peaks-route-reviewer-worker` login. This operator helper creates that one
login and stores its random password in the exact Keychain item
`com.jhm.peaks.route-reviewer-db`, account `peaks-route-reviewer-worker`.
It never reads or changes the factory credential or resets an existing login.

The [worker contract](../../../../.agents/skills/peaks-route-factory/references/worker-contract.md)
labels login creation **Human-only setup**: “The scheduled worker must never
perform these steps. An operator does them after the code reaches the
canonical `firebase` checkout.” Run this as an operator from this task's
worktree, as the user requires. The factory-account approval does not approve
this separate account. Apply requires explicit approval of this plan.

First apply the reviewed Phase 3 migration, which supplies the review APIs.
Then run these commands from the repository root:

```sh
node docs/data-audits/trail-catalog-wa-2026-10-13/reviewer-login-setup/setup.mjs --check
node --test docs/data-audits/trail-catalog-wa-2026-10-13/reviewer-login-setup/setup.test.mjs
node docs/data-audits/trail-catalog-wa-2026-10-13/reviewer-login-setup/setup.mjs
```

The last command previews the role and grant checks inside a transaction and
rolls back. It writes only the required `data_source_runs` audit. It checks
that the Keychain item is absent without reading a password. After the preview
passes and the user approves this plan, run the helper with `--apply`.

The login inherits only the reviewer marker. It has no superuser, role creation,
database creation, replication, or row-security bypass powers. Grant checks
deny factory and API membership, raw candidate or route writes, queue seeding,
raw audit writes, and the activation function. Existing lock-only column
grants remain subject to the existing write guards. Only the reviewer APIs may
save a review, under a fresh lease and the authenticated reviewer identity.

The helper uses the documented operator secret in memory through the existing
local Cloud SQL proxy. It generates a random password in memory and sends it
to the Keychain helper through stdin. It never puts a password in a file,
command argument, report, or log. Apply adds the absent Keychain item before
commit, then tests the actual login and grants. The first access through the
normal worker loader may require macOS Keychain approval.

On failure, independent readback must prove the login absent before cleanup
can remove the helper's own matching new Keychain item. A lost commit reply
keeps the item until readback establishes the outcome. Never delete or reset
it on a guess. A post-commit check failure keeps the login and records a
partial audit for review.

Expected fixed backend cost change: **$0/month**. This adds a login to the
existing database, with no service or timer. It does not approve a photo,
review a route, or activate anything.
