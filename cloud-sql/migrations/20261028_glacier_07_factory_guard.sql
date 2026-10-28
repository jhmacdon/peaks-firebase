-- Let the route factory role's path writes carry glacier match bookkeeping.
-- The glacier crossing trigger stamps routes.glacier_match_input_hash and
-- glacier_matched_at inside the same write; the factory guard treated that as
-- a non-status change and rejected it. Body copied from production's current
-- definition with those two columns added to the exempt list, and a
-- status-unchanged bookkeeping update allowed through.
-- No new infrastructure; $0/month.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guard_standard_route_factory_route()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  is_factory BOOLEAN := pg_has_role(
    session_user,
    'peaks-route-factory',
    'member'
  );
  is_reviewer BOOLEAN := pg_has_role(
    session_user,
    'peaks-route-reviewer',
    'member'
  );
  activation_owner NAME;
  settlement_owner NAME;
  deletion_job_destination TEXT;
BEGIN
  IF NOT is_factory AND NOT is_reviewer THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF is_factory AND is_reviewer THEN
    RAISE EXCEPTION 'route worker login belongs to conflicting database roles';
  END IF;
  IF is_reviewer THEN
    RAISE EXCEPTION 'reviewer database role cannot write route records';
  END IF;

  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=NEW.id) THEN
    IF NOT EXISTS (SELECT 1 FROM trail_catalog_live_context() job WHERE job.proposed_route_id=NEW.id
      AND trail_catalog_route_matches(NEW,job.artifact)) THEN
      RAISE EXCEPTION 'factory trail route differs from its live reviewed candidate'; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.owner <> 'peaks' OR NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'factory database role may insert only pending Peaks routes';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM standard_route_backfill_jobs job
      WHERE job.state = 'candidate_ready'
        AND job.lease_owner IS NOT NULL
        AND job.lease_token IS NOT NULL
        AND job.lease_expires_at >= clock_timestamp()
    ) THEN
      RAISE EXCEPTION 'factory route insert requires a live candidate lease';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.owner <> 'peaks' OR OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'factory database role cannot delete a live route';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM standard_route_backfill_jobs job
      WHERE job.published_route_id = OLD.id
        AND job.state IN ('pending_review', 'approved', 'published', 'verified')
    ) THEN
      RAISE EXCEPTION 'factory database role cannot delete a reviewed route';
    END IF;

    SELECT job.destination_id INTO deletion_job_destination
    FROM standard_route_backfill_jobs job
    JOIN route_destinations linked
      ON linked.route_id = OLD.id
     AND linked.destination_id = job.destination_id
    WHERE job.published_route_id = OLD.id
      AND job.state = 'candidate_ready'
      AND job.lease_owner IS NOT NULL
      AND job.lease_token IS NOT NULL
      AND job.lease_expires_at >= clock_timestamp()
    ORDER BY job.destination_id
    LIMIT 1
    FOR SHARE OF job;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'factory route delete is not bound to its candidate lease';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM standard_route_backfill_jobs other
      WHERE other.published_route_id = OLD.id
        AND other.state <> 'verified'
        AND other.destination_id <> deletion_job_destination
    ) THEN
      RAISE EXCEPTION 'factory route delete has another live queue binding';
    END IF;
    RETURN OLD;
  END IF;

  IF (to_jsonb(NEW) - ARRAY['status', 'updated_at', 'glacier_match_input_hash', 'glacier_matched_at'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'updated_at', 'glacier_match_input_hash', 'glacier_matched_at']) THEN
    RAISE EXCEPTION 'factory database role may change only route status';
  END IF;

  -- Only updated_at or glacier match bookkeeping changed (see header).
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'active' AND EXISTS(SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=OLD.id) THEN
    IF NOT trail_catalog_publish_authorized(OLD.id) THEN RAISE EXCEPTION 'factory catalog activation requires its owned reviewed function'; END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'active' THEN
    SELECT pg_get_userbyid(procedure.proowner) INTO activation_owner
    FROM pg_proc procedure
    WHERE procedure.oid =
      'public.activate_standard_route_factory(text,text,text)'::regprocedure;
    IF current_user <> activation_owner THEN
      RAISE EXCEPTION 'factory route activation requires the bound activation function';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'active' AND NEW.status = 'superseded' THEN
    SELECT pg_get_userbyid(procedure.proowner) INTO settlement_owner
    FROM pg_proc procedure
    WHERE procedure.oid =
      'public.settle_standard_route_factory_replacement(text,text,text)'::regprocedure;
    IF current_user <> settlement_owner THEN
      RAISE EXCEPTION 'factory route retirement requires the bound settlement function';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'factory database role cannot make this route transition';
END
$function$
;
COMMIT;
