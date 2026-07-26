// The one place that decides whether the DB-backed suites run.
//
// This used to be `process.env.DATABASE_URL ? null : "..."`, repeated in every
// integration file, and it was a skip-flag only: the connection still came from
// DB_HOST/DB_NAME/DB_USER/DB_PASS, so setting DATABASE_URL to any non-empty
// string un-skipped every suite and pointed it at whatever those vars held —
// production, on a developer machine. The suites INSERT, UPDATE and DELETE.
//
// `TEST_DATABASE_URL` closes that gap: `db.ts` connects to exactly the database
// it names and ignores DB_* entirely, and refuses any name that is not a test
// database. Gate and connection are now the same fact, so a suite cannot run
// against a database the gate never approved.
//
// Provision one with cloud-sql/test-db/provision.sh — see cloud-sql/test-db/README.md.

export const dbSkipReason: string | null = process.env.TEST_DATABASE_URL?.trim()
  ? null
  : "TEST_DATABASE_URL not set — skipping integration tests (cloud-sql/test-db/README.md)";
