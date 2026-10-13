-- Independent catalog review and bounded activation on the existing database.
-- Fixed backend cost: ~$0/month. No service, timer, or always-on worker added.
-- Recovery: expired same-input leases may be reclaimed by their own lane.
-- Rejected reviews and candidate source/input bindings stay immutable. Source,
-- route, or place drift requires explicit operator inspection; this phase adds
-- no repair/requeue command and never invents a new source key to bypass review.
-- Every stage mutation takes the same per-source advisory lock before job/route
-- locks. Publisher operations take their global barrier before that source lock.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Only this NOLOGIN role owns the catalog activation function. An invoker
-- trigger can therefore distinguish that function from a caller-set GUC and
-- from other SECURITY DEFINER functions owned by the migration operator.
DO $$ DECLARE created BOOLEAN:=false; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='peaks-trail-publisher') THEN
    CREATE ROLE "peaks-trail-publisher" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    created:=true;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='peaks-trail-publisher'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls))
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member='peaks-trail-publisher'::regrole
      OR(roleid='peaks-trail-publisher'::regrole AND(NOT created OR member<>current_user::regrole))) THEN
    RAISE EXCEPTION 'catalog publisher must be an isolated NOLOGIN function owner';
  END IF;
END $$;

CREATE TABLE trail_catalog_review_jobs (
  source_key TEXT PRIMARY KEY REFERENCES trail_catalog_candidate_jobs(source_key),
  route_id TEXT NOT NULL UNIQUE REFERENCES routes(id),
  input_hash TEXT NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
  pending_hash TEXT NOT NULL CHECK(pending_hash ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL CHECK(state IN ('pending_review','reviewing','approved','publish_leased','published','verify_leased','verified','rejected')),
  lease_owner NAME, lease_token TEXT, lease_expires_at TIMESTAMPTZ,
  reviewer NAME, packet JSONB, source_check JSONB, review_result JSONB,
  receipt_hash TEXT CHECK(receipt_hash ~ '^[a-f0-9]{64}$'),
  verification_result JSONB,
  reviewed_at TIMESTAMPTZ, published_at TIMESTAMPTZ, verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((state IN ('reviewing','publish_leased','verify_leased') AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state NOT IN ('reviewing','publish_leased','verify_leased') AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK (state NOT IN ('approved','publish_leased','published','verify_leased','verified')
    OR (reviewer IS NOT NULL AND packet IS NOT NULL AND source_check IS NOT NULL AND review_result IS NOT NULL AND receipt_hash IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX trail_catalog_review_jobs_stage ON trail_catalog_review_jobs(state,lease_expires_at,created_at);
REVOKE ALL ON trail_catalog_review_jobs FROM PUBLIC,"peaks-api","peaks-route-factory","peaks-route-reviewer";
GRANT SELECT ON trail_catalog_review_jobs TO "peaks-api","peaks-route-factory","peaks-route-reviewer","peaks-trail-publisher";
GRANT USAGE ON SCHEMA public TO "peaks-trail-publisher";
GRANT SELECT ON trail_catalog_candidate_jobs,routes,route_segments,segments,route_destinations,destinations,destination_boundary_parts TO "peaks-trail-publisher";
GRANT UPDATE(status,updated_at) ON routes TO "peaks-trail-publisher";
GRANT UPDATE ON trail_catalog_review_jobs TO "peaks-trail-publisher";

CREATE FUNCTION trail_catalog_json_hash(value JSONB) RETURNS TEXT
LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT encode(sha256(convert_to(value::text,'UTF8')),'hex')
$$;

CREATE FUNCTION trail_catalog_assert_lane(lane TEXT) RETURNS VOID
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF lane NOT IN ('factory','reviewer')
    OR NOT pg_has_role(session_user,'peaks-route-'||lane,'member')
    OR pg_has_role(session_user,CASE lane WHEN 'factory' THEN 'peaks-route-reviewer' ELSE 'peaks-route-factory' END,'member') THEN
    RAISE EXCEPTION 'catalog operation requires one authenticated % database role',lane;
  END IF;
END $$;

CREATE FUNCTION trail_catalog_route_snapshot_matches(route_record routes,artifact JSONB,required_status TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(required_status IN ('pending','active') AND route_record.status=required_status
    AND route_record.distance IS NOT DISTINCT FROM ST_Length(route_record.path)
    AND trail_catalog_route_matches(jsonb_populate_record(route_record,jsonb_build_object('status','pending')),artifact),false)
$$;

CREATE FUNCTION trail_catalog_snapshot_binding_valid(candidate_route_id TEXT,required_status TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job trail_catalog_candidate_jobs%ROWTYPE; r routes%ROWTYPE; expected_places TEXT[]; actual_places TEXT[];
  reference JSONB; link RECORD; bound JSONB; current_place JSONB; first_index INTEGER:=0; reference_count INTEGER:=0;
BEGIN
  SELECT * INTO job FROM trail_catalog_candidate_jobs WHERE proposed_route_id=candidate_route_id;
  SELECT * INTO r FROM routes WHERE id=candidate_route_id;
  IF job.source_key IS NULL OR r.id IS NULL OR job.state<>'pending' OR job.route_id<>candidate_route_id
    OR job.lease_owner IS NOT NULL OR job.lease_token IS NOT NULL OR job.lease_expires_at IS NOT NULL
    OR job.result->>'routeId' IS DISTINCT FROM candidate_route_id
    OR job.result->>'sourceKey' IS DISTINCT FROM job.source_key
    OR job.result->>'name' IS DISTINCT FROM job.artifact#>>'{candidate,input,name}'
    OR job.result->>'geometryHash' IS DISTINCT FROM job.artifact#>>'{candidate,geometryHash}'
    OR job.result->>'outcome' IS DISTINCT FROM 'admitted'
    OR job.artifact#>>'{candidate,input,sourceKey}' IS DISTINCT FROM job.source_key
    OR NOT trail_catalog_route_snapshot_matches(r,job.artifact,required_status) THEN RETURN false; END IF;
  SELECT array_agg(id ORDER BY first_ordinal) INTO expected_places FROM (
    SELECT id,min(ordinal) first_ordinal FROM unnest(ARRAY[job.artifact#>>'{candidate,trailhead,id}',job.artifact#>>'{candidate,objective,id}',job.artifact#>>'{candidate,endTrailhead,id}']) WITH ORDINALITY places(id,ordinal)
    WHERE id IS NOT NULL GROUP BY id) ids;
  SELECT array_agg(destination_id ORDER BY ordinal) INTO actual_places FROM route_destinations WHERE route_id=candidate_route_id;
  IF actual_places IS DISTINCT FROM expected_places OR jsonb_typeof(job.result->'segments') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR bound IN SELECT value FROM jsonb_array_elements(jsonb_build_array(job.artifact#>'{candidate,trailhead}',job.artifact#>'{candidate,objective}',job.artifact#>'{candidate,endTrailhead}')) WHERE value<>'null'::jsonb LOOP
    SELECT jsonb_build_object('id',d.id,'name',d.name,'features',d.features::text[],'stateCode',d.state_code,'countryCode',d.country_code,
      'lat',ST_Y(d.location::geometry),'lng',ST_X(d.location::geometry),'boundary',ST_AsGeoJSON(d.boundary::geometry)::jsonb)
      INTO current_place FROM destinations d WHERE d.id=bound->>'id';
    IF current_place IS DISTINCT FROM bound THEN RETURN false; END IF;
  END LOOP;
  FOR reference IN SELECT value FROM jsonb_array_elements(job.result->'segments') LOOP
    SELECT rs.ordinal,rs.direction,s.path,s.provenance INTO link FROM route_segments rs JOIN segments s ON s.id=rs.segment_id
      WHERE rs.route_id=candidate_route_id AND rs.ordinal=reference_count AND rs.segment_id=reference->>'segmentId';
    IF NOT FOUND OR link.direction::text IS DISTINCT FROM reference->>'direction'
      OR (reference->>'routeStartIndex')::int IS DISTINCT FROM first_index
      OR NOT trail_catalog_span_matches(link.path,link.provenance,job.artifact,
        (reference->>'routeStartIndex')::int,(reference->>'routeEndIndex')::int,link.direction::text='reverse') THEN RETURN false; END IF;
    first_index:=(reference->>'routeEndIndex')::int; reference_count:=reference_count+1;
  END LOOP;
  RETURN reference_count>0 AND reference_count=(SELECT count(*) FROM route_segments WHERE route_id=candidate_route_id)
    AND first_index=jsonb_array_length(job.artifact#>'{candidate,elevatedPoints}')-1
    AND peaks_route_passes_publish_integrity(candidate_route_id,NULL,required_status);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;

CREATE FUNCTION trail_catalog_lock_binding(candidate_source_key TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job trail_catalog_candidate_jobs%ROWTYPE;
BEGIN
  SELECT * INTO STRICT job FROM trail_catalog_candidate_jobs WHERE source_key=candidate_source_key FOR SHARE;
  PERFORM 1 FROM routes WHERE id=job.proposed_route_id FOR UPDATE;
  PERFORM 1 FROM route_segments WHERE route_id=job.proposed_route_id ORDER BY ordinal FOR SHARE;
  PERFORM 1 FROM route_destinations WHERE route_id=job.proposed_route_id ORDER BY ordinal FOR SHARE;
  PERFORM 1 FROM segments s JOIN route_segments rs ON rs.segment_id=s.id WHERE rs.route_id=job.proposed_route_id ORDER BY s.id FOR SHARE OF s;
  PERFORM 1 FROM destinations d JOIN route_destinations rd ON rd.destination_id=d.id WHERE rd.route_id=job.proposed_route_id ORDER BY d.id FOR SHARE OF d;
END $$;
REVOKE ALL ON FUNCTION trail_catalog_lock_binding(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trail_catalog_lock_binding(TEXT) TO "peaks-trail-publisher";

CREATE FUNCTION trail_catalog_review_machine_checks(candidate_source_key TEXT,required_status TEXT DEFAULT 'pending') RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job trail_catalog_candidate_jobs%ROWTYPE; r routes%ROWTYPE; reused DOUBLE PRECISION; summit_count INTEGER; summit_gap DOUBLE PRECISION;
  cover BOOLEAN; contact BOOLEAN; integrity BOOLEAN; exact_binding BOOLEAN; gates JSONB; measurements JSONB;
BEGIN
  SELECT * INTO job FROM trail_catalog_candidate_jobs WHERE source_key=candidate_source_key;
  SELECT * INTO r FROM routes WHERE id=job.proposed_route_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'catalog candidate route is missing'; END IF;
  exact_binding:=trail_catalog_snapshot_binding_valid(r.id,required_status);
  integrity:=peaks_route_passes_publish_integrity(r.id,NULL,required_status);
  contact:=peaks_route_kind_passes_contact(r.id,NULL);
  SELECT count(*)::int,max(ST_Distance(r.path,d.location)) INTO summit_count,summit_gap
    FROM route_destinations rd JOIN destinations d ON d.id=rd.destination_id
    WHERE rd.route_id=r.id AND 'summit'::destination_feature=ANY(d.features);
  SELECT EXISTS(SELECT 1 FROM route_destinations rd JOIN destinations d ON d.id=rd.destination_id
    WHERE rd.route_id=r.id
      AND NULLIF(btrim(d.hero_image),'') IS NOT NULL AND NULLIF(btrim(d.hero_image_attribution),'') IS NOT NULL AND NULLIF(btrim(d.hero_image_attribution_url),'') IS NOT NULL) INTO cover;
  SELECT COALESCE(sum(ST_Length(s.path)) FILTER(WHERE EXISTS(SELECT 1 FROM route_segments other WHERE other.segment_id=s.id AND other.route_id<>r.id)),0)
    INTO reused FROM route_segments rs JOIN segments s ON s.id=rs.segment_id WHERE rs.route_id=r.id;
  gates:=jsonb_build_object('pending_binding',exact_binding,'provenance',COALESCE(is_valid_route_provenance(r.provenance),false),
    'publish_integrity',integrity,'xyz_assembly',integrity AND exact_binding AND ST_NPoints(r.path::geometry)>=5,
    'stats',COALESCE(r.gain>=0 AND r.gain<=2000 AND r.distance>0 AND r.distance=ST_Length(r.path),false),'contacts',contact,
    'linked_summits',contact AND (summit_count=0 OR (summit_gap IS NOT NULL AND summit_gap<=5)),
    'self_intersection',COALESCE(ST_IsSimple(r.path::geometry),false),'segment_reuse',exact_binding AND NOT EXISTS(
      SELECT 1 FROM route_segments rs JOIN segments s ON s.id=rs.segment_id JOIN segments duplicate ON duplicate.id<>s.id
      WHERE rs.route_id=r.id AND route_segment_provenance_compatible(duplicate.provenance,s.provenance)
        AND ST_Equals(ST_Force2D(duplicate.path::geometry),ST_Force2D(s.path::geometry))),
    'credited_cover',cover,'elevation',COALESCE(r.elevation_string=encode_route_elevation_profile(r.path) AND route_elevation_profile_has_real_range(r.path),false));
  measurements:=jsonb_build_object('distance_m',r.distance,'gain_m',r.gain,'loss_m',r.gain_loss,'reused_length_m',reused,'reuse_fraction',CASE WHEN r.distance>0 THEN reused/r.distance ELSE NULL END,
    'start_gap_m',(SELECT ST_Distance(ST_StartPoint(r.path::geometry)::geography,d.location) FROM destinations d WHERE d.id=r.trailhead_destination_id),
    'objective_gap_m',(SELECT CASE WHEN d.boundary IS NOT NULL AND NOT ('summit'::destination_feature=ANY(d.features)) THEN ST_Distance(ST_EndPoint(r.path::geometry)::geography,d.boundary) ELSE ST_Distance(ST_EndPoint(r.path::geometry)::geography,d.location) END FROM destinations d WHERE d.id=r.objective_destination_id),
    'end_trailhead_gap_m',(SELECT ST_Distance(ST_EndPoint(r.path::geometry)::geography,d.location) FROM destinations d WHERE d.id=job.artifact#>>'{candidate,endTrailhead,id}'),
    'summit_max_gap_m',summit_gap,'summit_count',summit_count);
  RETURN jsonb_build_object('gates',gates,'measurements',measurements,'errors',COALESCE((SELECT jsonb_agg(key ORDER BY key) FROM jsonb_each(gates) WHERE value<>'true'::jsonb),'[]'::jsonb));
END $$;

CREATE FUNCTION snapshot_trail_catalog_candidate(candidate_source_key TEXT) RETURNS JSONB
LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('sourceKey',job.source_key,'inputHash',job.input_hash,'routeId',job.proposed_route_id,'artifact',job.artifact,'pendingResult',job.result,
    'reviewReceipt',to_jsonb(review),'route',to_jsonb(r)||jsonb_build_object('geometry',ST_AsGeoJSON(r.path::geometry,17,0)::jsonb),
    'places',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'features',d.features::text[],'lat',ST_Y(d.location::geometry),'lng',ST_X(d.location::geometry),'boundary',ST_AsGeoJSON(d.boundary::geometry)::jsonb,'heroImage',d.hero_image,'heroAttribution',d.hero_image_attribution,'heroAttributionUrl',d.hero_image_attribution_url) ORDER BY rd.ordinal) FROM route_destinations rd JOIN destinations d ON d.id=rd.destination_id WHERE rd.route_id=r.id),'[]'::jsonb),
    'segments',COALESCE((SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('ordinal',rs.ordinal,'direction',rs.direction) ORDER BY rs.ordinal) FROM route_segments rs JOIN segments s ON s.id=rs.segment_id WHERE rs.route_id=r.id),'[]'::jsonb))
  FROM trail_catalog_candidate_jobs job LEFT JOIN trail_catalog_review_jobs review ON review.source_key=job.source_key LEFT JOIN routes r ON r.id=job.proposed_route_id WHERE job.source_key=candidate_source_key
$$;

CREATE FUNCTION trail_catalog_source_review_passes(check_result JSONB,candidate_route_id TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE gate TEXT; checked TIMESTAMPTZ;
BEGIN
  IF check_result->'passed' IS DISTINCT FROM 'true'::jsonb OR check_result->>'routeId' IS DISTINCT FROM candidate_route_id
    OR check_result->'errors' IS DISTINCT FROM '[]'::jsonb
    OR check_result#>'{machineChecks,errors}' IS DISTINCT FROM '[]'::jsonb THEN RETURN false; END IF;
  checked:=(check_result->>'checkedAt')::timestamptz;
  IF checked IS NULL OR checked<clock_timestamp()-interval '24 hours' OR checked>clock_timestamp()+interval '5 minutes' THEN RETURN false; END IF;
  FOREACH gate IN ARRAY ARRAY['pending_binding','provenance','publish_integrity','source_geometry','xyz_assembly','stats','contacts','linked_summits','self_intersection','segment_reuse','credited_cover','elevation'] LOOP
    IF check_result#>ARRAY['machineChecks','gates',gate] IS DISTINCT FROM 'true'::jsonb THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;

CREATE FUNCTION trail_catalog_human_review_passes(result JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE gate TEXT; reviewed TIMESTAMPTZ;
BEGIN
  IF result->>'verdict' IS DISTINCT FROM 'PASS' OR result->'errors' IS DISTINCT FROM '[]'::jsonb
    OR jsonb_typeof(result->'gates') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(result->'gates'))<>8 THEN RETURN false; END IF;
  FOREACH gate IN ARRAY ARRAY['route_identity','geometry_rights','access','map_review','source_geometry','endpoints','statistics','self_intersection'] LOOP
    IF result#>ARRAY['gates',gate] IS DISTINCT FROM 'true'::jsonb THEN RETURN false; END IF;
  END LOOP;
  reviewed:=(result->>'reviewed_at')::timestamptz;
  RETURN reviewed IS NOT NULL AND reviewed>=clock_timestamp()-interval '24 hours' AND reviewed<=clock_timestamp()+interval '5 minutes';
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;

CREATE FUNCTION trail_catalog_receipt_hash(receipt trail_catalog_review_jobs) RETURNS TEXT
LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT trail_catalog_json_hash(jsonb_build_object('sourceKey',receipt.source_key,'routeId',receipt.route_id,'inputHash',receipt.input_hash,'pendingHash',receipt.pending_hash,
    'reviewer',receipt.reviewer,'packet',receipt.packet,'sourceCheck',receipt.source_check,'result',receipt.review_result))
$$;

CREATE FUNCTION trail_catalog_packet_hash(packet JSONB) RETURNS TEXT
LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT trail_catalog_json_hash((packet-'attestation') #- '{reviewResultTemplate,attestation}')
$$;

CREATE FUNCTION trail_catalog_review_binding_valid(candidate_route_id TEXT,required_status TEXT DEFAULT 'pending') RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt trail_catalog_review_jobs%ROWTYPE; candidate trail_catalog_candidate_jobs%ROWTYPE; checks JSONB;
BEGIN
  SELECT * INTO receipt FROM trail_catalog_review_jobs WHERE route_id=candidate_route_id;
  SELECT * INTO candidate FROM trail_catalog_candidate_jobs WHERE source_key=receipt.source_key;
  IF receipt.source_key IS NULL OR receipt.state NOT IN ('approved','publish_leased','published','verify_leased','verified')
    OR receipt.route_id IS DISTINCT FROM candidate.proposed_route_id OR receipt.input_hash IS DISTINCT FROM candidate.input_hash
    OR receipt.pending_hash IS DISTINCT FROM trail_catalog_json_hash(candidate.result)
    OR receipt.receipt_hash IS DISTINCT FROM trail_catalog_receipt_hash(receipt)
    OR receipt.review_result->'attestation' IS DISTINCT FROM receipt.packet->'attestation'
    OR receipt.packet#>>'{attestation,reviewer}' IS DISTINCT FROM receipt.reviewer::text
    OR receipt.packet#>>'{attestation,sourceCheckHash}' IS DISTINCT FROM trail_catalog_json_hash(receipt.source_check)
    OR receipt.packet#>>'{attestation,reviewPacketHash}' IS DISTINCT FROM trail_catalog_packet_hash(receipt.packet)
    OR receipt.packet->'sourceCheck' IS DISTINCT FROM receipt.source_check
    OR receipt.review_result->>'verdict' IS DISTINCT FROM 'PASS'
    OR NOT trail_catalog_snapshot_binding_valid(candidate_route_id,required_status) THEN RETURN false; END IF;
  -- Age is checked at publication, not on an already published receipt. Keeping
  -- an active route valid must not depend on a daily repeat of model review.
  IF required_status='pending' AND (NOT trail_catalog_source_review_passes(receipt.source_check,candidate_route_id)
    OR NOT trail_catalog_human_review_passes(receipt.review_result)) THEN RETURN false; END IF;
  checks:=trail_catalog_review_machine_checks(receipt.source_key,required_status);
  RETURN checks->'errors'='[]'::jsonb
    AND receipt.source_check#>'{machineChecks,measurements,distance_m}' IS NOT DISTINCT FROM checks#>'{measurements,distance_m}'
    AND receipt.source_check#>'{machineChecks,measurements,gain_m}' IS NOT DISTINCT FROM checks#>'{measurements,gain_m}'
    AND receipt.source_check#>'{machineChecks,measurements,loss_m}' IS NOT DISTINCT FROM checks#>'{measurements,loss_m}';
END $$;

CREATE FUNCTION trail_catalog_review_lease_json(job trail_catalog_review_jobs) RETURNS JSONB
LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('sourceKey',job.source_key,'routeId',job.route_id,'inputHash',job.input_hash,'pendingHash',job.pending_hash,'state',job.state,
    'leaseToken',job.lease_token,'leaseOwner',job.lease_owner,'leaseExpiresAt',job.lease_expires_at,'receiptHash',job.receipt_hash,
    'artifact',candidate.artifact,'pendingResult',candidate.result,'reviewReceipt',to_jsonb(job))
  FROM trail_catalog_candidate_jobs candidate WHERE candidate.source_key=job.source_key
$$;

CREATE FUNCTION claim_trail_catalog_review(candidate_source_key TEXT,expected_input_hash TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE candidate trail_catalog_candidate_jobs%ROWTYPE; job trail_catalog_review_jobs%ROWTYPE;
BEGIN
  PERFORM trail_catalog_assert_lane('reviewer');
  PERFORM pg_advisory_xact_lock(hashtextextended('trail_catalog_review:'||candidate_source_key,0));
  SELECT * INTO candidate FROM trail_catalog_candidate_jobs WHERE source_key=candidate_source_key FOR SHARE;
  IF candidate.source_key IS NULL OR candidate.input_hash IS DISTINCT FROM expected_input_hash OR candidate.state<>'pending' THEN RAISE EXCEPTION 'catalog review candidate/input binding is missing'; END IF;
  PERFORM trail_catalog_lock_binding(candidate_source_key);
  IF NOT trail_catalog_snapshot_binding_valid(candidate.proposed_route_id,'pending') THEN RAISE EXCEPTION 'catalog pending snapshot drift'; END IF;
  INSERT INTO trail_catalog_review_jobs(source_key,route_id,input_hash,pending_hash,state)
    VALUES(candidate_source_key,candidate.proposed_route_id,candidate.input_hash,trail_catalog_json_hash(candidate.result),'pending_review') ON CONFLICT(source_key) DO NOTHING;
  SELECT * INTO job FROM trail_catalog_review_jobs WHERE source_key=candidate_source_key FOR UPDATE;
  IF job.input_hash IS DISTINCT FROM candidate.input_hash OR job.route_id IS DISTINCT FROM candidate.proposed_route_id OR job.pending_hash IS DISTINCT FROM trail_catalog_json_hash(candidate.result) THEN RAISE EXCEPTION 'catalog immutable receipt drift'; END IF;
  IF NOT(job.state='pending_review' OR(job.state='reviewing' AND job.lease_expires_at<clock_timestamp())) THEN RETURN NULL; END IF;
  UPDATE trail_catalog_review_jobs SET state='reviewing',lease_owner=session_user,lease_token=gen_random_uuid()::text,lease_expires_at=clock_timestamp()+interval '15 minutes',
    reviewer=NULL,packet=NULL,source_check=NULL,review_result=NULL,receipt_hash=NULL,reviewed_at=NULL,updated_at=clock_timestamp()
    WHERE source_key=candidate_source_key RETURNING * INTO job;
  RETURN trail_catalog_review_lease_json(job);
END $$;

CREATE FUNCTION heartbeat_trail_catalog_review(candidate_source_key TEXT,token TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job trail_catalog_review_jobs%ROWTYPE;
BEGIN
  PERFORM trail_catalog_assert_lane('reviewer');
  PERFORM pg_advisory_xact_lock(hashtextextended('trail_catalog_review:'||candidate_source_key,0));
  UPDATE trail_catalog_review_jobs SET lease_expires_at=clock_timestamp()+interval '15 minutes',updated_at=clock_timestamp()
    WHERE source_key=candidate_source_key AND state='reviewing' AND lease_owner=session_user AND lease_token=token AND lease_expires_at>clock_timestamp() RETURNING * INTO job;
  IF NOT FOUND THEN RAISE EXCEPTION 'catalog reviewer lease lost'; END IF;
  RETURN trail_catalog_review_lease_json(job);
END $$;

CREATE FUNCTION release_trail_catalog_review(candidate_source_key TEXT,token TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM trail_catalog_assert_lane('reviewer');
  PERFORM pg_advisory_xact_lock(hashtextextended('trail_catalog_review:'||candidate_source_key,0));
  UPDATE trail_catalog_review_jobs SET state='pending_review',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,packet=NULL,source_check=NULL,updated_at=clock_timestamp()
    WHERE source_key=candidate_source_key AND state='reviewing' AND lease_owner=session_user AND lease_token=token AND lease_expires_at>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'catalog reviewer lease lost'; END IF;
END $$;

CREATE FUNCTION bind_trail_catalog_review_packet(candidate_source_key TEXT,token TEXT,review_packet JSONB,source_check_result JSONB) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job trail_catalog_review_jobs%ROWTYPE; candidate trail_catalog_candidate_jobs%ROWTYPE; binding JSONB; bound_packet JSONB;
BEGIN
  PERFORM trail_catalog_assert_lane('reviewer');
  PERFORM pg_advisory_xact_lock(hashtextextended('trail_catalog_review:'||candidate_source_key,0));
  SELECT * INTO job FROM trail_catalog_review_jobs WHERE source_key=candidate_source_key AND state='reviewing' AND lease_owner=session_user AND lease_token=token AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catalog reviewer lease lost'; END IF;
  SELECT * INTO STRICT candidate FROM trail_catalog_candidate_jobs WHERE source_key=candidate_source_key;
  PERFORM trail_catalog_lock_binding(candidate_source_key);
  IF NOT trail_catalog_snapshot_binding_valid(job.route_id,'pending') THEN RAISE EXCEPTION 'catalog pending snapshot drift'; END IF;
  IF review_packet->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR review_packet->>'sourceKey' IS DISTINCT FROM job.source_key
    OR review_packet->>'routeId' IS DISTINCT FROM job.route_id OR review_packet->>'inputHash' IS DISTINCT FROM job.input_hash
    OR review_packet->>'kind' IS DISTINCT FROM candidate.artifact#>>'{candidate,input,kind}'
    OR review_packet->>'trailheadId' IS DISTINCT FROM candidate.artifact#>>'{candidate,trailhead,id}'
    OR review_packet->>'objectiveId' IS DISTINCT FROM candidate.artifact#>>'{candidate,objective,id}'
    OR review_packet->>'endTrailheadId' IS DISTINCT FROM candidate.artifact#>>'{candidate,endTrailhead,id}'
    OR review_packet->'sourceCheck' IS DISTINCT FROM source_check_result
    OR source_check_result->>'routeId' IS DISTINCT FROM job.route_id OR review_packet ? 'attestation' THEN RAISE EXCEPTION 'catalog review packet binding differs'; END IF;
  binding:=jsonb_build_object('sourceKey',job.source_key,'routeId',job.route_id,'inputHash',job.input_hash,'pendingHash',job.pending_hash,
    'kind',candidate.artifact#>>'{candidate,input,kind}','trailheadId',candidate.artifact#>>'{candidate,trailhead,id}',
    'objectiveId',candidate.artifact#>>'{candidate,objective,id}','endTrailheadId',candidate.artifact#>>'{candidate,endTrailhead,id}',
    'reviewer',session_user,'leaseToken',token,'reviewPacketHash',trail_catalog_packet_hash(review_packet),'sourceCheckHash',trail_catalog_json_hash(source_check_result));
  bound_packet:=review_packet||jsonb_build_object('attestation',binding);
  IF jsonb_typeof(bound_packet->'reviewResultTemplate')='object' THEN bound_packet:=jsonb_set(bound_packet,'{reviewResultTemplate,attestation}',binding,true); END IF;
  IF job.packet IS NOT NULL AND(job.packet IS DISTINCT FROM bound_packet OR job.source_check IS DISTINCT FROM source_check_result) THEN RAISE EXCEPTION 'catalog review packet is immutable for this lease'; END IF;
  UPDATE trail_catalog_review_jobs SET packet=bound_packet,source_check=source_check_result,updated_at=clock_timestamp() WHERE source_key=candidate_source_key;
  RETURN bound_packet;
END $$;

CREATE FUNCTION finish_trail_catalog_review(candidate_source_key TEXT,token TEXT,review_packet JSONB,result JSONB,source_check_result JSONB) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job trail_catalog_review_jobs%ROWTYPE; checks JSONB; pass BOOLEAN;
BEGIN
  PERFORM trail_catalog_assert_lane('reviewer');
  PERFORM pg_advisory_xact_lock(hashtextextended('trail_catalog_review:'||candidate_source_key,0));
  SELECT * INTO job FROM trail_catalog_review_jobs WHERE source_key=candidate_source_key AND state='reviewing' AND lease_owner=session_user AND lease_token=token AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catalog reviewer lease lost'; END IF;
  IF job.packet IS NULL OR review_packet IS DISTINCT FROM job.packet OR source_check_result IS DISTINCT FROM job.source_check
    OR result->'attestation' IS DISTINCT FROM job.packet->'attestation'
    OR(result->>'verdict' IS DISTINCT FROM 'PASS' AND result->>'verdict' IS DISTINCT FROM 'FAIL') THEN RAISE EXCEPTION 'catalog reviewer result/packet/source binding differs'; END IF;
  PERFORM trail_catalog_lock_binding(candidate_source_key);
  IF NOT trail_catalog_snapshot_binding_valid(job.route_id,'pending') THEN RAISE EXCEPTION 'catalog pending snapshot drift'; END IF;
  checks:=trail_catalog_review_machine_checks(candidate_source_key);
  pass:=result->>'verdict'='PASS';
  IF pass AND(NOT trail_catalog_human_review_passes(result) OR NOT trail_catalog_source_review_passes(source_check_result,job.route_id) OR checks->'errors'<>'[]'::jsonb) THEN RAISE EXCEPTION 'catalog approval fails current human/source/integrity/cover gates'; END IF;
  job.reviewer:=session_user; job.review_result:=result; job.receipt_hash:=trail_catalog_receipt_hash(job);
  UPDATE trail_catalog_review_jobs SET state=CASE WHEN pass THEN 'approved' ELSE 'rejected' END,reviewer=job.reviewer,review_result=result,reviewed_at=clock_timestamp(),receipt_hash=job.receipt_hash,
    lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE source_key=candidate_source_key RETURNING * INTO job;
  RETURN jsonb_build_object('sourceKey',job.source_key,'routeId',job.route_id,'state',job.state,'receiptHash',job.receipt_hash,'reviewReceipt',to_jsonb(job));
END $$;

CREATE FUNCTION trail_catalog_rematch_drain_status() RETURNS JSONB
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('drained',count(*)=0,'pending',count(*),'oldestQueuedAt',min(queued_at)) FROM session_rematch_queue
$$;
REVOKE ALL ON FUNCTION trail_catalog_rematch_drain_status() FROM PUBLIC,"peaks-api";
GRANT EXECUTE ON FUNCTION trail_catalog_rematch_drain_status() TO "peaks-route-factory","peaks-route-reviewer","peaks-trail-publisher";

CREATE FUNCTION claim_trail_catalog_publish(candidate_source_key TEXT,expected_receipt_hash TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job trail_catalog_review_jobs%ROWTYPE;
BEGIN
  PERFORM trail_catalog_assert_lane('factory');
  PERFORM pg_advisory_xact_lock(hashtextextended('trail_catalog_publish_barrier',0));
  PERFORM pg_advisory_xact_lock(hashtextextended('trail_catalog_review:'||candidate_source_key,0));
  IF EXISTS(SELECT 1 FROM trail_catalog_review_jobs WHERE source_key<>candidate_source_key AND state IN ('publish_leased','published','verify_leased'))
    OR (trail_catalog_rematch_drain_status()->'drained') IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'catalog previous publication/rematch verification is incomplete'; END IF;
  SELECT * INTO job FROM trail_catalog_review_jobs WHERE source_key=candidate_source_key FOR UPDATE;
  IF NOT FOUND OR job.receipt_hash IS DISTINCT FROM expected_receipt_hash THEN RAISE EXCEPTION 'catalog approved receipt hash differs'; END IF;
  IF NOT(job.state='approved' OR(job.state='publish_leased' AND job.lease_expires_at<clock_timestamp())) THEN RETURN NULL; END IF;
  PERFORM trail_catalog_lock_binding(candidate_source_key);
  IF NOT trail_catalog_review_binding_valid(job.route_id,'pending') THEN RAISE EXCEPTION 'catalog approved snapshot/source/cover drift'; END IF;
  UPDATE trail_catalog_review_jobs SET state='publish_leased',lease_owner=session_user,lease_token=gen_random_uuid()::text,lease_expires_at=clock_timestamp()+interval '15 minutes',updated_at=clock_timestamp()
    WHERE source_key=candidate_source_key RETURNING * INTO job;
  RETURN trail_catalog_review_lease_json(job);
END $$;

CREATE FUNCTION activate_trail_catalog_candidate(candidate_source_key TEXT,token TEXT,expected_receipt_hash TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job trail_catalog_review_jobs%ROWTYPE;
BEGIN
  PERFORM trail_catalog_assert_lane('factory');
  PERFORM pg_advisory_xact_lock(hashtextextended('trail_catalog_publish_barrier',0));
  PERFORM pg_advisory_xact_lock(hashtextextended('trail_catalog_review:'||candidate_source_key,0));
  SELECT * INTO job FROM trail_catalog_review_jobs WHERE source_key=candidate_source_key AND state='publish_leased' AND lease_owner=session_user AND lease_token=token AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND OR job.receipt_hash IS DISTINCT FROM expected_receipt_hash THEN RAISE EXCEPTION 'catalog publisher lease/receipt lost'; END IF;
  IF EXISTS(SELECT 1 FROM trail_catalog_review_jobs WHERE source_key<>candidate_source_key AND state IN ('publish_leased','published','verify_leased'))
    OR (trail_catalog_rematch_drain_status()->'drained') IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'catalog previous publication/rematch verification is incomplete'; END IF;
  PERFORM trail_catalog_lock_binding(candidate_source_key);
  IF NOT trail_catalog_review_binding_valid(job.route_id,'pending') THEN RAISE EXCEPTION 'catalog approved snapshot/source/cover drift'; END IF;
  UPDATE routes SET status='active',updated_at=clock_timestamp() WHERE id=job.route_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'catalog pending route is missing'; END IF;
  UPDATE trail_catalog_review_jobs SET state='published',published_at=clock_timestamp(),lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
    WHERE source_key=candidate_source_key RETURNING * INTO job;
  IF NOT trail_catalog_review_binding_valid(job.route_id,'active') THEN RAISE EXCEPTION 'catalog active receipt binding failed'; END IF;
  RETURN jsonb_build_object('sourceKey',job.source_key,'routeId',job.route_id,'state',job.state,'receiptHash',job.receipt_hash,'rematch',trail_catalog_rematch_drain_status());
END $$;
GRANT CREATE ON SCHEMA public TO "peaks-trail-publisher";
DO $$ BEGIN EXECUTE format('GRANT "peaks-trail-publisher" TO %I',current_user); END $$;
ALTER FUNCTION activate_trail_catalog_candidate(TEXT,TEXT,TEXT) OWNER TO "peaks-trail-publisher";
REVOKE CREATE ON SCHEMA public FROM "peaks-trail-publisher";

CREATE FUNCTION release_trail_catalog_publish(candidate_source_key TEXT,token TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM trail_catalog_assert_lane('factory');
  PERFORM pg_advisory_xact_lock(hashtextextended('trail_catalog_review:'||candidate_source_key,0));
  UPDATE trail_catalog_review_jobs job SET state='approved',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
    WHERE source_key=candidate_source_key AND state='publish_leased' AND lease_owner=session_user AND lease_token=token AND lease_expires_at>clock_timestamp()
      AND EXISTS(SELECT 1 FROM routes WHERE id=job.route_id AND status='pending');
  IF NOT FOUND THEN RAISE EXCEPTION 'catalog publisher lease lost or activation outcome is not pending'; END IF;
END $$;

CREATE FUNCTION trail_catalog_verification_snapshot_hash(candidate_source_key TEXT) RETURNS TEXT
LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT trail_catalog_json_hash(snapshot-'reviewReceipt'-'artifact') FROM(SELECT snapshot_trail_catalog_candidate(candidate_source_key) snapshot) data
$$;

CREATE FUNCTION claim_trail_catalog_verification(candidate_source_key TEXT,expected_receipt_hash TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job trail_catalog_review_jobs%ROWTYPE;
BEGIN
  PERFORM trail_catalog_assert_lane('factory');
  PERFORM pg_advisory_xact_lock(hashtextextended('trail_catalog_review:'||candidate_source_key,0));
  SELECT * INTO job FROM trail_catalog_review_jobs WHERE source_key=candidate_source_key FOR UPDATE;
  IF NOT FOUND OR job.receipt_hash IS DISTINCT FROM expected_receipt_hash THEN RAISE EXCEPTION 'catalog published receipt hash differs'; END IF;
  IF NOT(job.state='published' OR(job.state='verify_leased' AND job.lease_expires_at<clock_timestamp())) THEN RETURN NULL; END IF;
  UPDATE trail_catalog_review_jobs SET state='verify_leased',lease_owner=session_user,lease_token=gen_random_uuid()::text,lease_expires_at=clock_timestamp()+interval '15 minutes',updated_at=clock_timestamp()
    WHERE source_key=candidate_source_key RETURNING * INTO job;
  RETURN trail_catalog_review_lease_json(job);
END $$;

CREATE FUNCTION finish_trail_catalog_verification(candidate_source_key TEXT,token TEXT,expected_receipt_hash TEXT,result JSONB) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job trail_catalog_review_jobs%ROWTYPE; pass BOOLEAN; checked TIMESTAMPTZ; public_base CONSTANT TEXT:='https://peaks-firebase--donner-a8608.us-central1.hosted.app';
BEGIN
  PERFORM trail_catalog_assert_lane('factory');
  PERFORM pg_advisory_xact_lock(hashtextextended('trail_catalog_review:'||candidate_source_key,0));
  SELECT * INTO job FROM trail_catalog_review_jobs WHERE source_key=candidate_source_key AND state='verify_leased' AND lease_owner=session_user AND lease_token=token AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND OR job.receipt_hash IS DISTINCT FROM expected_receipt_hash THEN RAISE EXCEPTION 'catalog verification lease/receipt lost'; END IF;
  IF result->>'routeId' IS DISTINCT FROM job.route_id OR jsonb_typeof(result->'passed') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'catalog verification result is not bound to this route'; END IF;
  PERFORM trail_catalog_lock_binding(candidate_source_key);
  pass:=result->'passed'='true'::jsonb;
  checked:=(result->>'checkedAt')::timestamptz;
  IF pass AND (result#>'{gates,public_http}' IS DISTINCT FROM 'true'::jsonb OR result#>'{gates,search}' IS DISTINCT FROM 'true'::jsonb
    OR result#>'{gates,rematch_drained}' IS DISTINCT FROM 'true'::jsonb OR (trail_catalog_rematch_drain_status()->'drained') IS DISTINCT FROM 'true'::jsonb
    OR checked IS NULL OR checked<clock_timestamp()-interval '15 minutes' OR checked>clock_timestamp()+interval '5 minutes'
    OR result->>'receiptHash' IS DISTINCT FROM job.receipt_hash OR result->>'snapshotHash' IS DISTINCT FROM trail_catalog_verification_snapshot_hash(candidate_source_key)
    OR result#>>'{routeVerification,route_id}' IS DISTINCT FROM job.route_id OR result#>>'{routeVerification,verdict}' IS DISTINCT FROM 'PASS'
    OR EXISTS(SELECT 1 FROM jsonb_each(COALESCE(result#>'{routeVerification,gates}','{}'::jsonb)) WHERE value IS DISTINCT FROM 'true'::jsonb)
    OR result#>>'{routeVerification,public_url}' IS DISTINCT FROM public_base||'/api/public/routes/'||job.route_id||'?elevation_fingerprint='||
      (SELECT md5(concat_ws('|',COALESCE(r.elevation_string,''),COALESCE(r.gain::text,''),COALESCE(r.gain_loss::text,''),r.status,r.updated_at::text)) FROM routes r WHERE r.id=job.route_id)
    OR result#>'{routeVerification,public_status}' IS DISTINCT FROM '200'::jsonb
    OR NOT COALESCE(result#>'{routeVerification,gates}' @> '{"owner":true,"active":true,"destination_order":true,"segments":true,"provenance":true,"summit_contact":true,"objective_contact":true,"elevation_profile":true,"public_http":true}'::jsonb,false)
    OR left(result#>>'{search,url}',length(public_base||'/api/search/all?')) IS DISTINCT FROM public_base||'/api/search/all?'
    OR result#>'{search,status}' IS DISTINCT FROM '200'::jsonb OR result#>>'{search,routeId}' IS DISTINCT FROM job.route_id
    OR jsonb_typeof(result#>'{search,rank}') IS DISTINCT FROM 'number' OR NOT COALESCE((result#>>'{search,rank}')::numeric BETWEEN 1 AND 50,false)
    OR COALESCE((result#>>'{search,rank}')::numeric<>trunc((result#>>'{search,rank}')::numeric),true)
    OR NOT trail_catalog_review_binding_valid(job.route_id,'active')) THEN RAISE EXCEPTION 'catalog verification fails live active/search/rematch gates'; END IF;
  UPDATE trail_catalog_review_jobs SET state=CASE WHEN pass THEN 'verified' ELSE 'published' END,verification_result=result,
    verified_at=CASE WHEN pass THEN clock_timestamp() ELSE NULL END,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
    WHERE source_key=candidate_source_key RETURNING * INTO job;
  RETURN jsonb_build_object('sourceKey',job.source_key,'routeId',job.route_id,'state',job.state,'receiptHash',job.receipt_hash);
END $$;

CREATE FUNCTION guard_trail_catalog_review_job() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE table_owner NAME;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO table_owner FROM pg_class WHERE oid=TG_RELID;
  IF current_user<>table_owner AND current_user<>'peaks-trail-publisher' THEN RAISE EXCEPTION 'catalog review receipts require owned lane functions'; END IF;
  IF TG_OP='UPDATE' THEN
    IF(NEW.source_key,NEW.route_id,NEW.input_hash,NEW.pending_hash) IS DISTINCT FROM(OLD.source_key,OLD.route_id,OLD.input_hash,OLD.pending_hash) THEN RAISE EXCEPTION 'catalog candidate receipt binding is immutable'; END IF;
    IF OLD.state IN ('approved','publish_leased','published','verify_leased','verified','rejected')
      AND(NEW.reviewer,NEW.packet,NEW.source_check,NEW.review_result,NEW.receipt_hash,NEW.reviewed_at)
        IS DISTINCT FROM(OLD.reviewer,OLD.packet,OLD.source_check,OLD.review_result,OLD.receipt_hash,OLD.reviewed_at) THEN RAISE EXCEPTION 'catalog independent review result is immutable'; END IF;
    IF current_user='peaks-trail-publisher' AND NOT(OLD.state='publish_leased' AND NEW.state='published'
      AND NEW.lease_owner IS NULL AND NEW.lease_token IS NULL AND NEW.lease_expires_at IS NULL
      AND(to_jsonb(NEW)-ARRAY['state','lease_owner','lease_token','lease_expires_at','published_at','updated_at'])
        =(to_jsonb(OLD)-ARRAY['state','lease_owner','lease_token','lease_expires_at','published_at','updated_at'])) THEN RAISE EXCEPTION 'catalog activation owner may only finish its publication'; END IF;
  ELSIF current_user='peaks-trail-publisher' THEN RAISE EXCEPTION 'catalog activation owner cannot create a review receipt'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_trail_catalog_review_job BEFORE INSERT OR UPDATE ON trail_catalog_review_jobs FOR EACH ROW EXECUTE FUNCTION guard_trail_catalog_review_job();
CREATE TRIGGER trg_guard_trail_catalog_review_delete BEFORE DELETE ON trail_catalog_review_jobs FOR EACH ROW EXECUTE FUNCTION guard_trail_catalog_receipt_removal();
CREATE TRIGGER trg_guard_trail_catalog_review_truncate BEFORE TRUNCATE ON trail_catalog_review_jobs FOR EACH STATEMENT EXECUTE FUNCTION guard_trail_catalog_receipt_removal();

CREATE FUNCTION trail_catalog_publish_authorized(candidate_route_id TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT current_user='peaks-trail-publisher' AND pg_has_role(session_user,'peaks-route-factory','member')
    AND NOT pg_has_role(session_user,'peaks-route-reviewer','member') AND EXISTS(
      SELECT 1 FROM trail_catalog_review_jobs WHERE route_id=candidate_route_id AND state='publish_leased'
        AND lease_owner=session_user AND lease_token IS NOT NULL AND lease_expires_at>clock_timestamp())
$$;

CREATE FUNCTION trail_catalog_route_final_binding_valid(candidate_route_id TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE((SELECT CASE status WHEN 'pending' THEN trail_catalog_pending_binding_valid(id)
    WHEN 'active' THEN trail_catalog_review_binding_valid(id,'active') ELSE false END FROM routes WHERE id=candidate_route_id),false)
$$;

-- The old pilot guard was SECURITY DEFINER. Make this guard an invoker: only
-- the isolated publisher function owner can now authorize the status change.
CREATE OR REPLACE FUNCTION guard_trail_catalog_pending_only() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE candidate_route_id TEXT:=CASE WHEN TG_OP='INSERT' THEN NEW.id ELSE OLD.id END; receipt_state TEXT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=candidate_route_id) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'catalog candidate route cannot be deleted outside explicit receipt repair'; END IF;
  IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'trail catalog candidate route identity is immutable'; END IF;
  SELECT state INTO receipt_state FROM trail_catalog_review_jobs WHERE route_id=candidate_route_id;
  IF TG_OP='UPDATE' AND receipt_state IN ('approved','publish_leased','published','verify_leased','verified','rejected')
    AND(to_jsonb(NEW)-ARRAY['status','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','updated_at']) THEN RAISE EXCEPTION 'catalog reviewed route is immutable'; END IF;
  IF NEW.status='active' AND(TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    IF NOT trail_catalog_publish_authorized(candidate_route_id) THEN RAISE EXCEPTION 'trail catalog candidate requires independent review; direct activation is disabled except its owned activation function'; END IF;
  ELSIF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'catalog route transition requires explicit reviewed activation'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER trg_guard_trail_catalog_pending_only ON routes;
CREATE TRIGGER trg_guard_trail_catalog_pending_only BEFORE INSERT OR UPDATE OR DELETE ON routes FOR EACH ROW EXECUTE FUNCTION guard_trail_catalog_pending_only();

CREATE FUNCTION guard_trail_catalog_reviewed_links() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE bound_route_id TEXT;
BEGIN
  IF TG_TABLE_NAME='segments' THEN
    IF EXISTS(SELECT 1 FROM route_segments rs JOIN trail_catalog_review_jobs review ON review.route_id=rs.route_id
      WHERE rs.segment_id=OLD.id AND review.state IN ('approved','publish_leased','published','verify_leased','verified','rejected')) THEN RAISE EXCEPTION 'catalog reviewed source segment is immutable'; END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM trail_catalog_review_jobs review WHERE(review.route_id=CASE WHEN TG_OP='INSERT' THEN NEW.route_id ELSE OLD.route_id END
      OR(TG_OP='UPDATE' AND review.route_id=NEW.route_id)) AND review.state IN ('approved','publish_leased','published','verify_leased','verified','rejected')) THEN RAISE EXCEPTION 'catalog reviewed route links are immutable'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_trail_catalog_reviewed_segment BEFORE UPDATE OR DELETE ON segments FOR EACH ROW EXECUTE FUNCTION guard_trail_catalog_reviewed_links();
CREATE TRIGGER trg_guard_trail_catalog_reviewed_destinations BEFORE INSERT OR UPDATE OR DELETE ON route_destinations FOR EACH ROW EXECUTE FUNCTION guard_trail_catalog_reviewed_links();
CREATE TRIGGER trg_guard_trail_catalog_reviewed_segments BEFORE INSERT OR UPDATE OR DELETE ON route_segments FOR EACH ROW EXECUTE FUNCTION guard_trail_catalog_reviewed_links();

-- Change only the existing pilot branches. Assert the source fragments so a
-- future guard change fails this migration instead of quietly losing checks.
DO $patch$
DECLARE definition TEXT; before TEXT; after TEXT;
BEGIN
  definition:=pg_get_functiondef('guard_standard_route_factory_route()'::regprocedure);
  before:=$old$  IF OLD.status = 'pending' AND NEW.status = 'active' THEN
    SELECT pg_get_userbyid(procedure.proowner) INTO activation_owner$old$;
  after:=$new$  IF OLD.status = 'pending' AND NEW.status = 'active' AND EXISTS(SELECT 1 FROM trail_catalog_candidate_jobs WHERE proposed_route_id=OLD.id) THEN
    IF NOT trail_catalog_publish_authorized(OLD.id) THEN RAISE EXCEPTION 'factory catalog activation requires its owned reviewed function'; END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'active' THEN
    SELECT pg_get_userbyid(procedure.proowner) INTO activation_owner$new$;
  IF strpos(definition,before)=0 THEN RAISE EXCEPTION 'standard route activation guard changed before catalog extension'; END IF;
  EXECUTE replace(definition,before,after);
  definition:=pg_get_functiondef('check_standard_route_factory_route_final()'::regprocedure);
  before:='IF NOT trail_catalog_pending_binding_valid(NEW.id) THEN';
  IF strpos(definition,before)=0 THEN RAISE EXCEPTION 'standard route final guard changed before catalog extension'; END IF;
  EXECUTE replace(definition,before,'IF NOT trail_catalog_route_final_binding_valid(NEW.id) THEN');
END $patch$;

-- Defaults in production grant API DML on new tables/functions. Remove those
-- defaults explicitly. Reads carry no authority: every mutation checks login,
-- lane, live lease, exact immutable inputs, and the current source/cover gates.
REVOKE ALL ON FUNCTION claim_trail_catalog_review(TEXT,TEXT),heartbeat_trail_catalog_review(TEXT,TEXT),release_trail_catalog_review(TEXT,TEXT),
  bind_trail_catalog_review_packet(TEXT,TEXT,JSONB,JSONB),finish_trail_catalog_review(TEXT,TEXT,JSONB,JSONB,JSONB),
  claim_trail_catalog_publish(TEXT,TEXT),release_trail_catalog_publish(TEXT,TEXT),activate_trail_catalog_candidate(TEXT,TEXT,TEXT),claim_trail_catalog_verification(TEXT,TEXT),finish_trail_catalog_verification(TEXT,TEXT,TEXT,JSONB)
  FROM PUBLIC,"peaks-api","peaks-route-factory","peaks-route-reviewer";
GRANT EXECUTE ON FUNCTION claim_trail_catalog_review(TEXT,TEXT),heartbeat_trail_catalog_review(TEXT,TEXT),release_trail_catalog_review(TEXT,TEXT),
  bind_trail_catalog_review_packet(TEXT,TEXT,JSONB,JSONB),finish_trail_catalog_review(TEXT,TEXT,JSONB,JSONB,JSONB) TO "peaks-route-reviewer";
GRANT EXECUTE ON FUNCTION claim_trail_catalog_publish(TEXT,TEXT),release_trail_catalog_publish(TEXT,TEXT),activate_trail_catalog_candidate(TEXT,TEXT,TEXT),claim_trail_catalog_verification(TEXT,TEXT),finish_trail_catalog_verification(TEXT,TEXT,TEXT,JSONB) TO "peaks-route-factory";
GRANT EXECUTE ON FUNCTION begin_trail_catalog_source_run(TEXT),finish_trail_catalog_source_run(BIGINT,TEXT,INTEGER,INTEGER,INTEGER,TEXT) TO "peaks-route-reviewer";

CREATE OR REPLACE FUNCTION begin_trail_catalog_source_run(run_notes TEXT) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE run_id BIGINT; reviewer BOOLEAN:=pg_has_role(session_user,'peaks-route-reviewer','member'); operator BOOLEAN;
BEGIN
  SELECT session_user=pg_get_userbyid(proowner) INTO operator FROM pg_proc WHERE oid='begin_trail_catalog_source_run(text)'::regprocedure;
  IF NOT operator AND reviewer THEN PERFORM trail_catalog_assert_lane('reviewer');
    IF pg_has_role(session_user,'peaks-api','member') THEN RAISE EXCEPTION 'reviewer audit login holds API privileges'; END IF;
  ELSIF NOT operator AND NOT(pg_has_role(session_user,'peaks-route-factory','member') OR pg_has_role(session_user,'peaks-api','member')) THEN RAISE EXCEPTION 'catalog audit requires an operator, factory, API, or distinct reviewer role'; END IF;
  INSERT INTO data_source_runs(source,run_kind,status,started_at,notes)
    VALUES(CASE WHEN reviewer AND NOT operator THEN 'trail-catalog-review' ELSE 'trail-catalog-pilot' END,'import','failed',clock_timestamp(),jsonb_build_object('worker',session_user,'report',run_notes)::text) RETURNING id INTO run_id;
  RETURN run_id;
END $$;
CREATE OR REPLACE FUNCTION finish_trail_catalog_source_run(run_id BIGINT,run_status TEXT,input_count INTEGER,matched_count INTEGER,written_count INTEGER,run_notes TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF run_status NOT IN ('success','partial','failed','dry_run') OR input_count<0 OR matched_count<0 OR written_count<0
    OR input_count IS NULL OR matched_count IS NULL OR written_count IS NULL THEN RAISE EXCEPTION 'invalid trail candidate receipt'; END IF;
  UPDATE data_source_runs SET status=run_status,finished_at=clock_timestamp(),rows_in=input_count,rows_matched=matched_count,rows_written=written_count,
    notes=jsonb_build_object('worker',session_user,'report',run_notes)::text
    WHERE id=run_id AND source IN ('trail-catalog-pilot','trail-catalog-review') AND finished_at IS NULL AND notes::jsonb->>'worker'=session_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'trail candidate receipt does not belong to this unfinished attempt'; END IF;
END $$;

CREATE FUNCTION finish_trail_catalog_review_run(run_id BIGINT,run_status TEXT,input_count INTEGER,matched_count INTEGER,written_count INTEGER,run_notes TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE notes_json JSONB:=run_notes::jsonb;
BEGIN
  IF pg_has_role(session_user,'peaks-route-reviewer','member') THEN PERFORM trail_catalog_assert_lane('reviewer'); ELSE PERFORM trail_catalog_assert_lane('factory'); END IF;
  IF run_status NOT IN ('success','partial','failed','dry_run') OR input_count IS NULL OR matched_count IS NULL OR input_count<0 OR matched_count<0 OR written_count<0
    OR(written_count IS NULL AND(run_status<>'failed' OR notes_json->'outcomeUnconfirmed' IS DISTINCT FROM 'true'::jsonb)) THEN RAISE EXCEPTION 'invalid catalog review run receipt'; END IF;
  UPDATE data_source_runs SET status=run_status,finished_at=clock_timestamp(),rows_in=input_count,rows_matched=matched_count,rows_written=written_count,
    notes=jsonb_build_object('worker',session_user,'report',run_notes)::text
    WHERE id=run_id AND source IN ('trail-catalog-pilot','trail-catalog-review') AND finished_at IS NULL AND notes::jsonb->>'worker'=session_user
      AND((notes::jsonb->>'report')::jsonb->>'phase')='independent-review';
  IF NOT FOUND THEN RAISE EXCEPTION 'catalog review receipt does not belong to this unfinished attempt'; END IF;
END $$;
REVOKE ALL ON FUNCTION finish_trail_catalog_review_run(BIGINT,TEXT,INTEGER,INTEGER,INTEGER,TEXT) FROM PUBLIC,"peaks-api";
GRANT EXECUTE ON FUNCTION finish_trail_catalog_review_run(BIGINT,TEXT,INTEGER,INTEGER,INTEGER,TEXT) TO "peaks-route-factory","peaks-route-reviewer";

DO $$ BEGIN
  EXECUTE format('REVOKE "peaks-trail-publisher" FROM %I',current_user);
  IF EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='peaks-trail-publisher'::regrole OR member='peaks-trail-publisher'::regrole) THEN RAISE EXCEPTION 'catalog publisher owner retained a membership'; END IF;
END $$;

COMMIT;
