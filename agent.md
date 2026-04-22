# Agent Instructions

The authoritative source of truth for working on this project is **[CLAUDE.md](./CLAUDE.md)**.

Read it before taking any action. It covers project structure, build/lint requirements, deployment rules, database conventions, and data sourcing guidelines.

## High-leverage rules (quick reference)

1. **`node-postgres` BIGINT/NUMERIC default to JS strings.** The Cloud Run API registers a `types.setTypeParser(20, parseInt)` for `BIGINT` in `cloud-sql/api/src/db.ts` because iOS reads `d["time"] as? Int` which silently zeros any string-encoded BIGINT and breaks every session's timeline + flyover. Don't remove the parser. If you add a new BIGINT or NUMERIC column, either cast it `::text` in the SELECT, add a column-specific parser, or verify every client handles the wire format. See `cloud-sql/CLAUDE.md` "Postgres → wire type policy" + the regression test at `cloud-sql/api/src/__tests__/bigint-parser.test.ts` (wired into the deploy workflow's `npm test` step).
2. **`npm test` in `cloud-sql/api` runs on every deploy.** If you change `db.ts` or the schema, the test is your canary — if it goes red, the deploy is aborted before Cloud Run gets a broken revision.
3. **Deploy via CI on push to `main`.** Never `gcloud run deploy` directly — `deploy.yml` has pinned env vars + secrets that a direct deploy would silently drop. See the "Cloud Run secrets/env vars" rule in `CLAUDE.md`.
