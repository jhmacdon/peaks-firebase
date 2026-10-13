-- Bounded pending imports; no new service or ongoing infrastructure cost (~$0/month).
-- Candidate leases never grant activation. The existing review and cover gates remain.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION trail_catalog_artifact_path(artifact JSONB, first_index INTEGER, last_index INTEGER)
RETURNS geometry LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT ST_SetSRID(ST_MakeLine(ST_MakePoint((point->>'lng')::float8,(point->>'lat')::float8,(point->>'ele')::float8) ORDER BY ordinal),4326)
  FROM jsonb_array_elements(artifact#>'{candidate,elevatedPoints}') WITH ORDINALITY AS points(point,ordinal)
  WHERE ordinal-1 BETWEEN first_index AND last_index
$$;

CREATE OR REPLACE FUNCTION trail_catalog_span_matches(segment_path geography, segment_provenance JSONB, artifact JSONB, first_index INTEGER, last_index INTEGER, reversed BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE expected geometry; actual geometry; expected_ids JSONB; actual_ids JSONB;
BEGIN
  IF first_index IS NULL OR last_index IS NULL OR first_index<0 OR last_index<=first_index
     OR last_index>=jsonb_array_length(artifact#>'{candidate,elevatedPoints}')
     OR NOT COALESCE(route_segment_provenance_compatible(segment_provenance,artifact#>'{candidate,provenance}'),false) THEN RETURN false; END IF;
  expected := trail_catalog_artifact_path(artifact,first_index,last_index);
  actual := CASE WHEN reversed THEN ST_Reverse(segment_path::geometry) ELSE segment_path::geometry END;
  IF expected IS NULL OR actual IS NULL OR ST_NDims(actual)<>3 OR ST_NDims(expected)<>3
    OR ST_NPoints(actual)<>ST_NPoints(expected) OR ST_Length(segment_path)<=0 THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM generate_series(1,ST_NPoints(expected)) i
    WHERE NOT (abs(ST_X(ST_PointN(expected,i))-ST_X(ST_PointN(actual,i)))<=1e-9
      AND abs(ST_Y(ST_PointN(expected,i))-ST_Y(ST_PointN(actual,i)))<=1e-9
      AND abs(ST_Z(ST_PointN(expected,i))-ST_Z(ST_PointN(actual,i)))<=0.01)) THEN RETURN false; END IF;
  -- Every cited way must contribute a positive horizontal edge in this exact span.
  SELECT jsonb_agg(id ORDER BY id) INTO expected_ids FROM (
    SELECT DISTINCT (edge->>'wayId')::bigint AS id
    FROM jsonb_array_elements(artifact#>'{candidate,edges}') WITH ORDINALITY e(edge,ordinal)
    WHERE ordinal-1>=first_index AND ordinal-1<last_index
      AND ST_Distance(ST_PointN(expected,ordinal::int-first_index)::geography,
                      ST_PointN(expected,ordinal::int-first_index+1)::geography)>0
  ) ids;
  SELECT jsonb_agg(id ORDER BY id) INTO actual_ids FROM (
    SELECT DISTINCT value::bigint AS id FROM jsonb_array_elements_text(segment_provenance->'osm_way_ids')
  ) ids;
  RETURN expected_ids IS NOT NULL AND actual_ids=expected_ids;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION trail_catalog_route_matches(route_record routes, artifact JSONB)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE(route_record.owner='peaks' AND route_record.status='pending'
    AND route_record.name=artifact#>>'{candidate,input,name}'
    AND route_record.kind=artifact#>>'{candidate,input,kind}'
    AND route_record.shape::text=artifact#>>'{candidate,shape}'
    AND route_record.trailhead_destination_id=artifact#>>'{candidate,trailhead,id}'
    AND route_record.objective_destination_id IS NOT DISTINCT FROM artifact#>>'{candidate,objective,id}'
    AND to_jsonb(route_record.aliases)=COALESCE(artifact#>'{candidate,input,aliases}','[]'::jsonb)
    AND route_record.state_code=COALESCE(artifact#>>'{candidate,trailhead,stateCode}',artifact#>>'{candidate,objective,stateCode}',artifact#>>'{candidate,endTrailhead,stateCode}')
    AND route_record.country_code=COALESCE(artifact#>>'{candidate,trailhead,countryCode}',artifact#>>'{candidate,objective,countryCode}',artifact#>>'{candidate,endTrailhead,countryCode}')
    AND route_record.provenance=artifact#>'{candidate,provenance}'
    AND ST_AsEWKB(route_record.path::geometry)=ST_AsEWKB(trail_catalog_artifact_path(artifact,0,jsonb_array_length(artifact#>'{candidate,elevatedPoints}')-1))
    AND route_record.elevation_source=artifact#>>'{candidate,elevationLineage,source}'
    AND route_record.elevation_source_url=artifact#>>'{candidate,elevationLineage,sourceUrl}'
    AND route_record.elevation_attribution=artifact#>>'{candidate,elevationLineage,attribution}'
    AND route_record.elevation_license_url=artifact#>>'{candidate,elevationLineage,licenseUrl}'
    AND route_record.elevation_retrieved_at=(artifact#>>'{candidate,elevationLineage,retrievedAt}')::timestamptz,false)
$$;

CREATE OR REPLACE FUNCTION trail_catalog_live_context()
RETURNS SETOF trail_catalog_candidate_jobs LANGUAGE sql VOLATILE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT job.* FROM trail_catalog_candidate_jobs job
  WHERE source_key=current_setting('peaks.trail_candidate_source_key',true)
    AND lease_token=current_setting('peaks.trail_candidate_lease_token',true)
    AND state='leased' AND lease_owner IS NOT NULL AND lease_expires_at>clock_timestamp()
  FOR SHARE
$$;

-- Row locks need UPDATE privileges. This helper locks only the three reviewed
-- place IDs from the live lease, without granting destination writes to workers.
CREATE OR REPLACE FUNCTION trail_catalog_locked_places()
RETURNS TABLE(id TEXT,name TEXT,features TEXT[],state_code TEXT,country_code TEXT,lat DOUBLE PRECISION,lng DOUBLE PRECISION,boundary JSON)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job trail_catalog_candidate_jobs%ROWTYPE; place_ids TEXT[];
BEGIN
  IF NOT pg_has_role(session_user,'peaks-route-factory','member') OR pg_has_role(session_user,'peaks-route-reviewer','member') THEN
    RAISE EXCEPTION 'catalog place locking requires one factory database role'; END IF;
  SELECT * INTO job FROM trail_catalog_live_context();
  IF NOT FOUND THEN RAISE EXCEPTION 'catalog place locking requires a live candidate lease'; END IF;
  place_ids := ARRAY[job.artifact#>>'{candidate,trailhead,id}',job.artifact#>>'{candidate,objective,id}',job.artifact#>>'{candidate,endTrailhead,id}'];
  RETURN QUERY SELECT d.id,d.name,d.features::text[],d.state_code::text,d.country_code::text,
    ST_Y(d.location::geometry),ST_X(d.location::geometry),ST_AsGeoJSON(d.boundary::geometry)::json
    FROM public.destinations d WHERE d.id=ANY(place_ids) ORDER BY d.id FOR SHARE OF d;
END $$;
REVOKE ALL ON FUNCTION trail_catalog_locked_places() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trail_catalog_locked_places() TO "peaks-route-factory";

CREATE OR REPLACE FUNCTION trail_catalog_pending_binding_valid(candidate_route_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job trail_catalog_candidate_jobs%ROWTYPE; route_record routes%ROWTYPE;
  expected_places TEXT[]; actual_places TEXT[]; reference JSONB; link RECORD;
  expected_start INTEGER:=0; reference_count INTEGER:=0;
BEGIN
  SELECT * INTO job FROM trail_catalog_candidate_jobs WHERE proposed_route_id=candidate_route_id;
  SELECT * INTO route_record FROM routes WHERE id=candidate_route_id;
  IF job.source_key IS NULL OR route_record.id IS NULL OR job.state<>'pending' OR job.route_id<>candidate_route_id
    OR job.lease_owner IS NOT NULL OR job.lease_token IS NOT NULL OR job.lease_expires_at IS NOT NULL
    OR job.result->>'routeId' IS DISTINCT FROM candidate_route_id
    OR job.result->>'sourceKey' IS DISTINCT FROM job.source_key
    OR job.result->>'name' IS DISTINCT FROM job.artifact#>>'{candidate,input,name}'
    OR job.result->>'geometryHash' IS DISTINCT FROM job.artifact#>>'{candidate,geometryHash}'
    OR job.result->>'outcome' IS DISTINCT FROM 'admitted'
    OR job.artifact#>>'{candidate,input,sourceKey}' IS DISTINCT FROM job.source_key
    OR NOT trail_catalog_route_matches(route_record,job.artifact) THEN RETURN false; END IF;
  SELECT array_agg(id ORDER BY first_ordinal) INTO expected_places FROM (
    SELECT id,min(ordinal) first_ordinal FROM unnest(ARRAY[job.artifact#>>'{candidate,trailhead,id}',job.artifact#>>'{candidate,objective,id}',job.artifact#>>'{candidate,endTrailhead,id}']) WITH ORDINALITY places(id,ordinal)
    WHERE id IS NOT NULL GROUP BY id) ids;
  SELECT array_agg(destination_id ORDER BY ordinal) INTO actual_places FROM route_destinations WHERE route_id=candidate_route_id;
  IF actual_places IS DISTINCT FROM expected_places OR jsonb_typeof(job.result->'segments') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR reference IN SELECT value FROM jsonb_array_elements(job.result->'segments') LOOP
    SELECT rs.ordinal,rs.direction,s.path,s.provenance INTO link FROM route_segments rs JOIN segments s ON s.id=rs.segment_id
      WHERE rs.route_id=candidate_route_id AND rs.ordinal=reference_count AND rs.segment_id=reference->>'segmentId';
    IF NOT FOUND OR link.direction::text IS DISTINCT FROM reference->>'direction'
      OR (reference->>'routeStartIndex')::int IS DISTINCT FROM expected_start
      OR NOT trail_catalog_span_matches(link.path,link.provenance,job.artifact,
        (reference->>'routeStartIndex')::int,(reference->>'routeEndIndex')::int,link.direction::text='reverse') THEN RETURN false; END IF;
    expected_start := (reference->>'routeEndIndex')::int;
    reference_count := reference_count+1;
  END LOOP;
  RETURN reference_count>0 AND reference_count=(SELECT count(*) FROM route_segments WHERE route_id=candidate_route_id)
    AND expected_start=jsonb_array_length(job.artifact#>'{candidate,elevatedPoints}')-1
    AND peaks_route_passes_publish_integrity(candidate_route_id,NULL,'pending');
END $$;

CREATE OR REPLACE FUNCTION guard_trail_catalog_candidate_job()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.source_key,NEW.batch_key,NEW.input_hash,NEW.review_hash,NEW.artifact,NEW.proposed_route_id)
    IS DISTINCT FROM (OLD.source_key,OLD.batch_key,OLD.input_hash,OLD.review_hash,OLD.artifact,OLD.proposed_route_id) THEN
    RAISE EXCEPTION 'reviewed trail candidate input and route ID are immutable'; END IF;
  IF COALESCE(NEW.artifact#>>'{candidate,input,sourceKey}',NEW.artifact#>>'{input,sourceKey}') IS DISTINCT FROM NEW.source_key THEN RAISE EXCEPTION 'candidate source key differs from reviewed artifact'; END IF;
  IF NEW.state='pending' AND NEW.route_id IS DISTINCT FROM NEW.proposed_route_id THEN RAISE EXCEPTION 'candidate route differs from its proposed route ID'; END IF;
  IF pg_has_role(session_user,'peaks-route-factory','member') THEN
    IF pg_has_role(session_user,'peaks-route-reviewer','member') THEN RAISE EXCEPTION 'route worker login belongs to conflicting database roles'; END IF;
    IF TG_OP='INSERT' THEN
      IF EXISTS (SELECT 1 FROM routes WHERE id=NEW.proposed_route_id) THEN RAISE EXCEPTION 'candidate cannot adopt an existing route'; END IF;
      IF NEW.attempt_count<>0 OR NOT COALESCE((
        (NEW.state='queued' AND NEW.result IS NULL AND NEW.artifact#>>'{candidate,input,sourceKey}'=NEW.source_key)
        OR (NEW.state='rejected' AND NEW.route_id IS NULL AND NULLIF(trim(NEW.rejection_reason),'') IS NOT NULL
          AND NEW.artifact#>>'{input,sourceKey}'=NEW.source_key AND NOT (NEW.artifact ? 'candidate')
          AND NEW.result->>'sourceKey'=NEW.source_key AND NEW.result->>'routeId' IS NULL)
      ),false) THEN RAISE EXCEPTION 'factory must enqueue a fresh candidate or a rejected research receipt'; END IF;
    END IF;
    IF TG_OP='UPDATE' AND NEW IS DISTINCT FROM OLD THEN
      IF OLD.state IN ('pending','rejected') THEN RAISE EXCEPTION 'finished candidate is immutable'; END IF;
      IF NOT ((NEW.state='leased' AND (OLD.state='queued' OR (OLD.state='leased' AND OLD.lease_expires_at<clock_timestamp())) AND NEW.attempt_count=OLD.attempt_count+1)
        OR (OLD.state='leased' AND OLD.lease_expires_at>clock_timestamp() AND NEW.state IN ('pending','rejected') AND NEW.attempt_count=OLD.attempt_count)) THEN
        RAISE EXCEPTION 'invalid trail candidate lease transition'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_trail_catalog_candidate_job ON trail_catalog_candidate_jobs;
CREATE TRIGGER trg_guard_trail_catalog_candidate_job BEFORE INSERT OR UPDATE ON trail_catalog_candidate_jobs
  FOR EACH ROW EXECUTE FUNCTION guard_trail_catalog_candidate_job();

CREATE OR REPLACE FUNCTION check_trail_catalog_candidate_job_final()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM trail_catalog_candidate_jobs WHERE source_key=NEW.source_key AND state='pending')
    AND NOT trail_catalog_pending_binding_valid(NEW.proposed_route_id) THEN RAISE EXCEPTION 'candidate receipt lacks exact pending route binding'; END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_check_trail_catalog_candidate_job_final ON trail_catalog_candidate_jobs;
CREATE CONSTRAINT TRIGGER trg_check_trail_catalog_candidate_job_final AFTER INSERT OR UPDATE ON trail_catalog_candidate_jobs
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_trail_catalog_candidate_job_final();

-- These two functions grant the factory only receipts for this importer, owned by
-- the login that started the attempt. An unfinished attempt stays visibly failed.
CREATE OR REPLACE FUNCTION begin_trail_catalog_source_run(run_notes TEXT)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE run_id BIGINT;
BEGIN
  INSERT INTO data_source_runs(source,run_kind,status,started_at,notes)
    VALUES('trail-catalog-pilot','import','failed',clock_timestamp(),jsonb_build_object('worker',session_user,'report',run_notes)::text)
    RETURNING id INTO run_id;
  RETURN run_id;
END $$;
CREATE OR REPLACE FUNCTION finish_trail_catalog_source_run(run_id BIGINT,run_status TEXT,input_count INTEGER,matched_count INTEGER,written_count INTEGER,run_notes TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF run_status NOT IN ('success','partial','failed','dry_run') OR input_count<0 OR matched_count<0 OR written_count<0
    OR input_count IS NULL OR matched_count IS NULL OR written_count IS NULL THEN RAISE EXCEPTION 'invalid trail candidate receipt'; END IF;
  UPDATE data_source_runs SET status=run_status,finished_at=clock_timestamp(),rows_in=input_count,rows_matched=matched_count,rows_written=written_count,
    notes=jsonb_build_object('worker',session_user,'report',run_notes)::text
    WHERE id=run_id AND source='trail-catalog-pilot' AND finished_at IS NULL AND notes::jsonb->>'worker'=session_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'trail candidate receipt does not belong to this unfinished attempt'; END IF;
END $$;
REVOKE ALL ON FUNCTION begin_trail_catalog_source_run(TEXT),finish_trail_catalog_source_run(BIGINT,TEXT,INTEGER,INTEGER,INTEGER,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION begin_trail_catalog_source_run(TEXT),finish_trail_catalog_source_run(BIGINT,TEXT,INTEGER,INTEGER,INTEGER,TEXT) TO "peaks-route-factory","peaks-api";

-- Extend only candidate insertion branches; legacy activation checks below are unchanged.

CREATE OR REPLACE FUNCTION guard_standard_route_factory_route()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
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

  IF (to_jsonb(NEW) - ARRAY['status', 'updated_at'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'updated_at']) THEN
    RAISE EXCEPTION 'factory database role may change only route status';
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
$$;

CREATE OR REPLACE FUNCTION check_standard_route_factory_route_final()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  current_route RECORD;
  binding_count INTEGER;
  reference_count INTEGER;
BEGIN
  IF NOT pg_has_role(session_user, 'peaks-route-factory', 'member') THEN
    RETURN NULL;
  END IF;
  IF pg_has_role(session_user, 'peaks-route-reviewer', 'member') THEN
    RAISE EXCEPTION 'route worker login belongs to conflicting database roles';
  END IF;

  IF EXISTS (SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=NEW.id) THEN
    IF NOT trail_catalog_pending_binding_valid(NEW.id) THEN RAISE EXCEPTION 'factory trail route escaped its pending candidate binding'; END IF;
    RETURN NULL;
  END IF;

  SELECT route.owner, route.status INTO current_route
  FROM routes route
  WHERE route.id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*)::int INTO binding_count
  FROM standard_route_backfill_jobs job
  WHERE job.published_route_id = NEW.id
    AND job.state = 'pending_review'
    AND job.lease_owner IS NULL
    AND job.lease_token IS NULL
    AND job.lease_expires_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM route_destinations linked
      WHERE linked.route_id = NEW.id
        AND linked.destination_id = job.destination_id
    );
  SELECT count(*)::int INTO reference_count
  FROM standard_route_backfill_jobs job
  WHERE job.published_route_id = NEW.id;
  IF current_route.owner <> 'peaks'
     OR current_route.status <> 'pending'
     OR binding_count <> 1
     OR reference_count <> 1 THEN
    RAISE EXCEPTION 'factory route insert must finish as one unleased pending_review binding';
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION guard_standard_route_factory_route_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
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
  linked_route_id TEXT := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.route_id
    ELSE NEW.route_id
  END;
  route_record RECORD;
  approved_lease_exists BOOLEAN;
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
    RAISE EXCEPTION 'reviewer database role cannot write route links';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'factory database role cannot update route links';
  END IF;

  IF EXISTS (SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=linked_route_id) THEN
    IF TG_OP<>'INSERT' OR NOT EXISTS (
      SELECT 1 FROM trail_catalog_live_context() job JOIN routes r ON r.id=job.proposed_route_id
      WHERE job.proposed_route_id=linked_route_id AND trail_catalog_route_matches(r,job.artifact)
    ) THEN RAISE EXCEPTION 'factory trail links require their live reviewed candidate'; END IF;
    RETURN NEW;
  END IF;

  SELECT route.owner, route.status INTO route_record
  FROM routes route
  WHERE route.id = linked_route_id
  FOR SHARE OF route;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'factory database role cannot link a missing route';
  END IF;
  IF route_record.owner <> 'peaks' OR route_record.status <> 'pending' THEN
    RAISE EXCEPTION 'factory database role may change links only on pending Peaks routes';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM standard_route_backfill_jobs job
    WHERE job.published_route_id = linked_route_id
      AND job.state = 'approved'
      AND job.lease_owner IS NOT NULL
      AND job.lease_token IS NOT NULL
      AND job.lease_expires_at >= clock_timestamp()
  ) INTO approved_lease_exists;

  IF TG_TABLE_NAME = 'route_destinations' THEN
    IF TG_OP <> 'INSERT' OR EXISTS (
      SELECT 1
      FROM standard_route_backfill_jobs job
      WHERE job.published_route_id = linked_route_id
    ) THEN
      RAISE EXCEPTION 'factory database role cannot change reviewed destinations';
    END IF;
  ELSIF NOT approved_lease_exists AND EXISTS (
    SELECT 1
    FROM standard_route_backfill_jobs job
    WHERE job.published_route_id = linked_route_id
  ) THEN
    RAISE EXCEPTION 'factory database role cannot change segment links under review';
  END IF;

  IF NOT approved_lease_exists AND NOT EXISTS (
    SELECT 1
    FROM standard_route_backfill_jobs job
    WHERE job.state = 'candidate_ready'
      AND job.lease_owner IS NOT NULL
      AND job.lease_token IS NOT NULL
      AND job.lease_expires_at >= clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'factory route link write requires a live route-job lease';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION check_standard_route_factory_link_final()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  linked_route_id TEXT := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.route_id
    ELSE NEW.route_id
  END;
  route_record RECORD;
  import_binding_exists BOOLEAN;
  activation_binding_exists BOOLEAN;
BEGIN
  IF NOT pg_has_role(session_user, 'peaks-route-factory', 'member') THEN
    RETURN NULL;
  END IF;
  IF pg_has_role(session_user, 'peaks-route-reviewer', 'member') THEN
    RAISE EXCEPTION 'route worker login belongs to conflicting database roles';
  END IF;

  IF EXISTS (SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=linked_route_id) THEN
    IF TG_OP<>'INSERT' OR NOT trail_catalog_pending_binding_valid(linked_route_id) THEN RAISE EXCEPTION 'factory trail link escaped its pending candidate binding'; END IF;
    RETURN NULL;
  END IF;

  SELECT route.owner, route.status INTO route_record
  FROM routes route
  WHERE route.id = linked_route_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM standard_route_backfill_jobs job
    WHERE job.published_route_id = linked_route_id
      AND job.state = 'pending_review'
      AND job.lease_owner IS NULL
      AND job.lease_token IS NULL
      AND job.lease_expires_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM route_destinations destination_link
        WHERE destination_link.route_id = linked_route_id
          AND destination_link.destination_id = job.destination_id
      )
  ) INTO import_binding_exists;

  SELECT EXISTS (
    SELECT 1
    FROM standard_route_backfill_jobs job
    WHERE job.published_route_id = linked_route_id
      AND job.state = 'approved'
      AND job.lease_owner IS NOT NULL
      AND job.lease_token IS NOT NULL
      AND job.lease_expires_at >= clock_timestamp()
      AND EXISTS (
        SELECT 1
        FROM route_destinations destination_link
        WHERE destination_link.route_id = linked_route_id
          AND destination_link.destination_id = job.destination_id
      )
  ) INTO activation_binding_exists;

  IF TG_TABLE_NAME = 'route_destinations' THEN
    IF TG_OP <> 'INSERT'
       OR route_record.owner <> 'peaks'
       OR route_record.status <> 'pending'
       OR NOT import_binding_exists THEN
      RAISE EXCEPTION 'factory destination link escaped its import binding';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF route_record.owner <> 'peaks'
       OR route_record.status <> 'active'
       OR NOT activation_binding_exists THEN
      RAISE EXCEPTION 'factory segment-link delete escaped its activation binding';
    END IF;
  ELSIF route_record.owner <> 'peaks' OR NOT (
    (route_record.status = 'pending' AND import_binding_exists)
    OR (route_record.status = 'active' AND activation_binding_exists)
  ) THEN
    RAISE EXCEPTION 'factory segment link escaped its route-job binding';
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION guard_standard_route_factory_segment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
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
    RAISE EXCEPTION 'reviewer database role cannot write segments';
  END IF;

  IF TG_OP='INSERT' AND NULLIF(current_setting('peaks.trail_candidate_source_key',true),'') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM trail_catalog_live_context() job WHERE
      trail_catalog_span_matches(NEW.path,NEW.provenance,job.artifact,
        NULLIF(current_setting('peaks.trail_candidate_span_start',true),'')::int,
        NULLIF(current_setting('peaks.trail_candidate_span_end',true),'')::int)) THEN
      RAISE EXCEPTION 'factory trail segment differs from its live reviewed source span'; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM standard_route_backfill_jobs job
      WHERE job.state IN ('candidate_ready', 'approved')
        AND job.lease_owner IS NOT NULL
        AND job.lease_token IS NOT NULL
        AND job.lease_expires_at >= clock_timestamp()
    ) THEN
      RAISE EXCEPTION 'factory segment insert requires a live route-job lease';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'factory database role cannot edit segment records';
  END IF;
  IF EXISTS (
    SELECT 1 FROM route_segments linked WHERE linked.segment_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'factory database role cannot delete a linked segment';
  END IF;
  RETURN OLD;
END
$$;

CREATE OR REPLACE FUNCTION check_standard_route_factory_segment_final()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT pg_has_role(session_user, 'peaks-route-factory', 'member') THEN
    RETURN NULL;
  END IF;
  IF pg_has_role(session_user, 'peaks-route-reviewer', 'member') THEN
    RAISE EXCEPTION 'route worker login belongs to conflicting database roles';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM segments segment WHERE segment.id = NEW.id) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM route_segments linked JOIN trail_catalog_candidate_jobs job ON job.proposed_route_id=linked.route_id
    WHERE linked.segment_id=NEW.id AND trail_catalog_pending_binding_valid(linked.route_id)) THEN RETURN NULL; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM route_segments linked
    JOIN routes route ON route.id = linked.route_id
    JOIN standard_route_backfill_jobs job
      ON job.published_route_id = route.id
    WHERE linked.segment_id = NEW.id
      AND EXISTS (
        SELECT 1
        FROM route_destinations destination_link
        WHERE destination_link.route_id = route.id
          AND destination_link.destination_id = job.destination_id
      )
      AND (
        (
          route.owner = 'peaks'
          AND route.status = 'pending'
          AND job.state = 'pending_review'
          AND job.lease_owner IS NULL
          AND job.lease_token IS NULL
          AND job.lease_expires_at IS NULL
        )
        OR (
          route.owner = 'peaks'
          AND route.status = 'active'
          AND job.state = 'approved'
          AND job.lease_owner IS NOT NULL
          AND job.lease_token IS NOT NULL
          AND job.lease_expires_at >= clock_timestamp()
        )
      )
  ) THEN
    RAISE EXCEPTION 'factory segment insert escaped its route-job binding';
  END IF;
  RETURN NULL;
END
$$;

COMMIT;
