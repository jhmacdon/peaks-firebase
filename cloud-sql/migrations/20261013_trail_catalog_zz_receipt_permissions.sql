-- Keep pending-only review receipts outside application write privileges.
-- Cost: existing table grants/triggers only; fixed increase ~$0/month.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Production defaults grant API DML on new tables. Override that grant here;
-- ordinary dry runs need to read receipts but cannot erase or rewrite them.
REVOKE ALL ON trail_catalog_candidate_jobs FROM PUBLIC;
REVOKE ALL ON trail_catalog_candidate_jobs FROM "peaks-api";
GRANT SELECT ON trail_catalog_candidate_jobs TO "peaks-api";
REVOKE DELETE,TRUNCATE ON trail_catalog_candidate_jobs FROM "peaks-route-factory","peaks-route-reviewer";

CREATE OR REPLACE FUNCTION guard_trail_catalog_receipt_removal()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE table_owner NAME;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO table_owner FROM pg_class WHERE oid=TG_RELID;
  IF session_user IS DISTINCT FROM table_owner THEN
    RAISE EXCEPTION 'trail catalog receipts may be removed only by the table owner during explicit repair';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_guard_trail_catalog_receipt_delete ON trail_catalog_candidate_jobs;
CREATE TRIGGER trg_guard_trail_catalog_receipt_delete BEFORE DELETE ON trail_catalog_candidate_jobs
  FOR EACH ROW EXECUTE FUNCTION guard_trail_catalog_receipt_removal();
DROP TRIGGER IF EXISTS trg_guard_trail_catalog_receipt_truncate ON trail_catalog_candidate_jobs;
CREATE TRIGGER trg_guard_trail_catalog_receipt_truncate BEFORE TRUNCATE ON trail_catalog_candidate_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION guard_trail_catalog_receipt_removal();

CREATE OR REPLACE FUNCTION guard_trail_catalog_pending_only()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND EXISTS (
    SELECT 1 FROM public.trail_catalog_candidate_jobs WHERE proposed_route_id=OLD.id
  ) THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'trail catalog candidate route identity is immutable'; END IF;
    IF NEW.status='active' THEN
      RAISE EXCEPTION 'trail catalog candidate requires independent review; direct activation is disabled'; END IF;
  END IF;
  IF NEW.status='active' AND EXISTS (
    SELECT 1 FROM public.trail_catalog_candidate_jobs WHERE proposed_route_id=NEW.id
  ) THEN
    RAISE EXCEPTION 'trail catalog candidate requires independent review; direct activation is disabled';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_trail_catalog_pending_only ON routes;
CREATE TRIGGER trg_guard_trail_catalog_pending_only
  BEFORE INSERT OR UPDATE OF id,status ON routes
  FOR EACH ROW EXECUTE FUNCTION guard_trail_catalog_pending_only();
COMMIT;
