-- Operator-only setup for the absent fixed reviewer LOGIN. No existing role reset.
-- The helper owns BEGIN/ROLLBACK/COMMIT and supplies PASSWORD in memory.
-- Fixed cost change: $0/month; one login on the existing database.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
SET LOCAL password_encryption='scram-sha-256';
SELECT pg_advisory_xact_lock(hashtextextended('peaks-reviewer-login-setup',0));
DO $$
DECLARE marker RECORD;
BEGIN
  IF session_user<>'postgres' OR current_user<>session_user OR current_database()<>'peaks'
     OR NOT (SELECT rolcreaterole FROM pg_roles WHERE rolname=session_user) THEN
    RAISE EXCEPTION 'Direct peaks postgres operator connection with CREATEROLE required'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='peaks-route-reviewer-worker') THEN
    RAISE EXCEPTION 'Fixed reviewer LOGIN already exists; this helper never resets it'; END IF;
  SELECT * INTO STRICT marker FROM pg_roles WHERE rolname='peaks-route-reviewer';
  IF marker.rolcanlogin OR marker.rolsuper OR marker.rolcreatedb OR marker.rolcreaterole
     OR marker.rolreplication OR marker.rolbypassrls
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=marker.oid) THEN
    RAISE EXCEPTION 'Reviewer marker has unexpected authority'; END IF;
END $$;
CREATE ROLE "peaks-route-reviewer-worker" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS INHERIT PASSWORD '__MEMORY_PASSWORD__';
GRANT "peaks-route-reviewer" TO "peaks-route-reviewer-worker";
