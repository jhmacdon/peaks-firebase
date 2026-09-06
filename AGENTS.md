# Peaks backend

`functions/` contains Firebase functions; `cloud-sql/api/` contains the Cloud Run
API; `cloud-sql/migrate/` contains data migrations; `web/` contains the Next.js app.
`functions/functions/` is legacy and must not receive new work.

## Task workflow

Scope the requested change with focused reads. Fetch the remote default branch and
create a fresh task branch and worktree before editing. Keep the saved checkout
read-only. Continue through implementation, relevant checks, fixes, a pushed commit,
and a ready-for-review PR without asking again for those steps. Then remove only the
clean task worktree and its build output; delete the local branch after confirming
it is fully pushed and the PR exists. Preserve dirty or unrelated work.

Read linked guidance when its subject applies. For prose-only changes, check the
diff, links, and instruction consistency; app builds and screenshots add no evidence.
For code, run affected checks and fix failures caused by the change. Repeat or broaden
checks only when new edits, failures, or unresolved risks warrant it. Use existing
authorization; ask only for missing decisions or actions outside the request. If a
required step cannot be completed safely, report the blocker and ask for direction.
A development PR does not authorize an app release or production data changes.

## Data and infrastructure

- Keep the backend near $10–15/month. Price recurring infrastructure changes in
  the PR and prefer the cheaper option when user value is equal. Cloud Run stays
  scale-to-zero and CPU-throttled; periodic work uses authenticated requests,
  not in-process timers. See [operations](docs/agent-operations.md#infrastructure-cost-discipline).
- Never add a legacy datastore fallback after migration. Repair missing rows,
  relationships, and current writers; verify counts and missing-ID/join queries.
- DB-backed tests must use `TEST_DATABASE_URL` with a database ending in `_test`.
  Read [test isolation](cloud-sql/CLAUDE.md#testing-do-not-regress) before running them.
  Once configured, local fixture tests and fixes within the task need no new approval.
- Keep the BIGINT parser before pool creation in `cloud-sql/api/src/db.ts`.
  Verify numeric wire formats across clients when changing numeric columns.
- Keep Cloud Run secrets and environment in `deploy.yml`. Do not use replacing
  `--set-secrets` / `--set-env-vars` updates or bypass the pinned deployment config.
- Never commit secrets. Production writes and deployments require task authorization.

## Task references

- Functions build/lint, deployment, cost, destination sourcing, GPX checks, owner
  lookup, or React effects: [operations](docs/agent-operations.md).
- Database roles, schema, API, migrations, and catalog imports: [cloud-sql/CLAUDE.md](cloud-sql/CLAUDE.md).
- Web code, auth, and server actions: [web/CLAUDE.md](web/CLAUDE.md).

## List External References

- Peaks catalog lists are common lists, not Peakbagger lists. Never label
  Peakbagger as a list's source or credit it for the list. A relevant
  Peakbagger page may remain as an external reference with wording such as
  "View on Peakbagger." Put that reference near the bottom of the list detail
  page, after the roster.
