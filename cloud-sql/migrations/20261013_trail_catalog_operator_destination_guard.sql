-- Keep real superusers distinct from route workers in disposable PostGIS.
-- PostgreSQL reports superusers as members of every role. Cloud SQL postgres
-- is not a superuser; its existing worker-role checks stay unchanged.
-- A real superuser already has permission to alter or remove this trigger.
-- Cost: one trigger-function replacement; ~$0/month added fixed cost.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION guard_standard_route_worker_destination_write()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper)
     AND (pg_has_role(session_user,'peaks-route-factory','member')
       OR pg_has_role(session_user,'peaks-route-reviewer','member')) THEN
    RAISE EXCEPTION 'route worker database roles may lock but not change destinations';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
COMMIT;
