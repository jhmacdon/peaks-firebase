-- Privileges for the test role, mirroring what `peaks-api` holds in production.
--
-- schema.sql deliberately carries no GRANTs: production privileges were applied
-- by hand when the instance was built, so a database created from schema.sql
-- alone leaves the application role with no access at all. Mirroring the real
-- grant set here is what lets a test catch "the API has no INSERT on the table
-- you just added" — a class of bug that an owner-runs-everything test database
-- silently hides.
--
-- Production shape (read off the live `peaks` database):
--   all tables owned by `postgres`
--   `peaks-api`  SELECT, INSERT, UPDATE, DELETE  on every public table
--   PUBLIC       SELECT                          on the PostGIS metadata views
--                                                (geography_columns,
--                                                 geometry_columns,
--                                                 spatial_ref_sys) only
--
-- Invoked with:
--   psql -v db_name=peaks_test -v test_role=peaks_test -f grants.sql

\set ON_ERROR_STOP on

-- Two integration tests create isolated schemas, then drop them in cleanup.
-- provision.sh runs this only after its *_test database-name gate. The
-- production API role does not need or receive database-level CREATE.
GRANT CREATE ON DATABASE :"db_name" TO :"test_role";

GRANT USAGE ON SCHEMA public TO :"test_role";

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO :"test_role";

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"test_role";

-- Anything created later in this database (a migration added mid-run, a table
-- added by a future schema change) picks the same privileges up automatically,
-- so provisioning does not have to be re-run to keep the role usable.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"test_role";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"test_role";
