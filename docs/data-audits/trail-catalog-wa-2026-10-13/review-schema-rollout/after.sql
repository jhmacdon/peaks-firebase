SET LOCAL statement_timeout='30s';
CREATE TEMP TABLE trail_review_rows_after(table_name TEXT,tuple_id TEXT,tuple_version TEXT) ON COMMIT DROP;
INSERT INTO trail_review_rows_after SELECT 'routes',ctid::text,xmin::text FROM routes;
INSERT INTO trail_review_rows_after SELECT 'segments',ctid::text,xmin::text FROM segments;
INSERT INTO trail_review_rows_after SELECT 'route_segments',ctid::text,xmin::text FROM route_segments;
INSERT INTO trail_review_rows_after SELECT 'route_destinations',ctid::text,xmin::text FROM route_destinations;
INSERT INTO trail_review_rows_after SELECT 'candidate_jobs',ctid::text,xmin::text FROM trail_catalog_candidate_jobs;
DO $$
DECLARE lane TEXT;
BEGIN
  IF EXISTS ((SELECT * FROM trail_review_rows_before EXCEPT SELECT * FROM trail_review_rows_after)
    UNION ALL (SELECT * FROM trail_review_rows_after EXCEPT SELECT * FROM trail_review_rows_before)) THEN
    RAISE EXCEPTION 'Schema bundle changed catalog geometry, route links, or candidate jobs'; END IF;
  IF EXISTS (SELECT 1 FROM trail_review_protected_functions old
      WHERE md5(pg_get_functiondef(old.oid)) IS DISTINCT FROM old.definition_hash) THEN
    RAISE EXCEPTION 'A protected source, geometry, contact, cover, or rematch function changed'; END IF;
  IF EXISTS (SELECT 1 FROM trail_catalog_review_jobs) THEN RAISE EXCEPTION 'Schema bundle created a review receipt'; END IF;
  IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='trail_catalog_review_jobs'::regclass)<>'postgres' THEN
    RAISE EXCEPTION 'Review table owner differs'; END IF;
  FOREACH lane IN ARRAY ARRAY['peaks-api','peaks-route-factory','peaks-route-reviewer'] LOOP
    IF NOT has_table_privilege(lane,'trail_catalog_review_jobs','SELECT')
      OR has_table_privilege(lane,'trail_catalog_review_jobs','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'Review receipt table privileges differ for %',lane; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl
    WHERE c.oid='trail_catalog_review_jobs'::regclass AND acl.grantee=0) THEN
    RAISE EXCEPTION 'PUBLIC has review table privileges'; END IF;
  IF NOT has_function_privilege('peaks-route-reviewer','claim_trail_catalog_review(text,text)','EXECUTE')
    OR has_function_privilege('peaks-route-factory','claim_trail_catalog_review(text,text)','EXECUTE')
    OR has_function_privilege('peaks-api','claim_trail_catalog_review(text,text)','EXECUTE')
    OR NOT has_function_privilege('peaks-route-factory','activate_trail_catalog_candidate(text,text,text)','EXECUTE')
    OR has_function_privilege('peaks-route-reviewer','activate_trail_catalog_candidate(text,text,text)','EXECUTE')
    OR has_function_privilege('peaks-api','activate_trail_catalog_candidate(text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Review/publication function privileges cross worker lanes'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='activate_trail_catalog_candidate(text,text,text)'::regprocedure
      AND proowner='peaks-trail-publisher'::regrole AND prosecdef)
    OR EXISTS (SELECT 1 FROM pg_proc WHERE oid='guard_trail_catalog_pending_only()'::regprocedure AND prosecdef)
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='peaks-trail-publisher'
      AND NOT(rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls))
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid='peaks-trail-publisher'::regrole OR member='peaks-trail-publisher'::regrole)
    OR has_schema_privilege('peaks-trail-publisher','public','CREATE') THEN
    RAISE EXCEPTION 'Publisher owner or invoker-guard isolation failed'; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O'
      AND tgname IN ('trg_guard_trail_catalog_review_job','trg_guard_trail_catalog_review_delete','trg_guard_trail_catalog_review_truncate',
        'trg_guard_trail_catalog_pending_only','trg_guard_trail_catalog_reviewed_segment','trg_guard_trail_catalog_reviewed_destinations','trg_guard_trail_catalog_reviewed_segments'))<>7 THEN
    RAISE EXCEPTION 'A review or activation guard is not enabled'; END IF;
END $$;
SELECT jsonb_build_object('checks','passed','catalog_rows_unchanged',true,'protected_gates_unchanged',true,
  'routes',(SELECT count(*) FROM trail_review_rows_before WHERE table_name='routes'),
  'segments',(SELECT count(*) FROM trail_review_rows_before WHERE table_name='segments'),
  'candidate_jobs',(SELECT count(*) FROM trail_catalog_candidate_jobs),
  'review_jobs',(SELECT count(*) FROM trail_catalog_review_jobs),
  'fixed_monthly_cost_delta_usd',0) AS validation_result;
