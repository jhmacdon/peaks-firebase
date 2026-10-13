\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
SET LOCAL idle_in_transaction_session_timeout='60s';
SET LOCAL application_name='peaks-trail-catalog-review-schema-inspection';
DO $$ BEGIN
  IF session_user<>'postgres' OR current_user<>session_user OR current_database()<>'peaks' THEN
    RAISE EXCEPTION 'Connect directly as the peaks postgres operator'; END IF;
END $$;
WITH lanes AS (
  SELECT unnest(ARRAY['peaks-api','peaks-route-factory','peaks-route-reviewer']) lane
), operations AS (
  SELECT unnest(ARRAY[
    'claim_trail_catalog_review(text,text)',
    'heartbeat_trail_catalog_review(text,text)',
    'release_trail_catalog_review(text,text)',
    'bind_trail_catalog_review_packet(text,text,jsonb,jsonb)',
    'finish_trail_catalog_review(text,text,jsonb,jsonb,jsonb)',
    'claim_trail_catalog_publish(text,text)',
    'release_trail_catalog_publish(text,text)',
    'activate_trail_catalog_candidate(text,text,text)',
    'claim_trail_catalog_verification(text,text)',
    'finish_trail_catalog_verification(text,text,text,jsonb)',
    'finish_trail_catalog_review_run(bigint,text,integer,integer,integer,text)',
    'trail_catalog_rematch_drain_status()'
  ]) signature
), protected AS (
  SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN (
    'is_valid_route_provenance','peaks_route_passes_publish_integrity',
    'activate_standard_route_factory','enforce_peaks_route_cover_activation',
    'peaks_route_kind_passes_contact','route_segments_cover_provenance',
    'trail_catalog_span_matches','queue_sessions_near')
)
SELECT jsonb_build_object(
  'checkedAt',clock_timestamp(),'readOnly',current_setting('transaction_read_only')='on',
  'database',current_database(),'sessionUser',session_user,'currentUser',current_user,
  'reviewTable',jsonb_build_object(
    'owner',(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='trail_catalog_review_jobs'::regclass),
    'rows',(SELECT count(*) FROM trail_catalog_review_jobs),
    'publicPrivileges',(SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE c.oid='trail_catalog_review_jobs'::regclass AND acl.grantee=0),
    'lanes',(SELECT jsonb_agg(jsonb_build_object('role',lane,'select',has_table_privilege(lane,'trail_catalog_review_jobs','SELECT'),
      'rawWrites',has_table_privilege(lane,'trail_catalog_review_jobs','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) ORDER BY lane) FROM lanes),
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid='trail_catalog_review_jobs'::regclass AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT jsonb_agg(pg_get_constraintdef(c.oid) ORDER BY c.conname) FROM pg_constraint c WHERE c.conrelid='trail_catalog_review_jobs'::regclass)),
  'publisher',(SELECT jsonb_build_object('name',rolname,'login',rolcanlogin,'superuser',rolsuper,'createdb',rolcreatedb,'createrole',rolcreaterole,
    'inherit',rolinherit,'replication',rolreplication,'bypassRls',rolbypassrls,
    'memberships',(SELECT count(*) FROM pg_auth_members WHERE roleid=r.oid OR member=r.oid),
    'ownedFunctions',(SELECT jsonb_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.proowner=r.oid),
    'ownedTables',(SELECT count(*) FROM pg_class c WHERE c.relowner=r.oid),
    'ownedSchemas',(SELECT count(*) FROM pg_namespace n WHERE n.nspowner=r.oid),
    'schemaCreate',has_schema_privilege(r.oid,'public','CREATE')) FROM pg_roles r WHERE rolname='peaks-trail-publisher'),
  'functions',(SELECT jsonb_agg(jsonb_build_object('signature',signature,'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,
    'configuration',p.proconfig,'definitionMd5',md5(pg_get_functiondef(p.oid)),
    'execute',(SELECT jsonb_object_agg(lane,has_function_privilege(lane,p.oid,'EXECUTE')) FROM lanes),
    'publicExecute',EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')) ORDER BY signature)
    FROM operations JOIN pg_proc p ON p.oid=signature::regprocedure),
  'guards',(SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'table',t.tgrelid::regclass::text,'enabled',t.tgenabled,'securityDefiner',p.prosecdef,
    'owner',pg_get_userbyid(p.proowner),'definition',pg_get_triggerdef(t.oid)) ORDER BY t.tgname)
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal AND t.tgname IN (
      'trg_guard_trail_catalog_review_job','trg_guard_trail_catalog_review_delete','trg_guard_trail_catalog_review_truncate',
      'trg_guard_trail_catalog_pending_only','trg_guard_trail_catalog_reviewed_segment','trg_guard_trail_catalog_reviewed_destinations','trg_guard_trail_catalog_reviewed_segments')),
  'protectedFunctions',(SELECT jsonb_agg(jsonb_build_object('name',proname,'definitionMd5',md5(pg_get_functiondef(oid))) ORDER BY proname) FROM protected),
  'candidateStates',(SELECT jsonb_object_agg(state,n) FROM (SELECT state,count(*) n FROM trail_catalog_candidate_jobs GROUP BY state) counts),
  'pilotRoutes',(SELECT jsonb_agg(jsonb_build_object('sourceKey',j.source_key,'routeId',r.id,'status',r.status,'kind',r.kind,'name',r.name,
    'storedDistanceM',r.distance,'distanceGatePass',r.distance=ST_Length(r.path)) ORDER BY j.source_key)
    FROM trail_catalog_candidate_jobs j JOIN routes r ON r.id=j.route_id WHERE j.state='pending'),
  'catalogCounts',jsonb_build_object('routes',(SELECT count(*) FROM routes),'segments',(SELECT count(*) FROM segments),
    'routeSegments',(SELECT count(*) FROM route_segments),'routeDestinations',(SELECT count(*) FROM route_destinations),
    'candidateJobs',(SELECT count(*) FROM trail_catalog_candidate_jobs),'reviewJobs',(SELECT count(*) FROM trail_catalog_review_jobs)),
  'schemaAudits',(SELECT jsonb_agg(jsonb_build_object('id',id,'source',source,'status',status,'startedAt',started_at,'finishedAt',finished_at,
    'rowsIn',rows_in,'rowsMatched',rows_matched,'rowsWritten',rows_written) ORDER BY id) FROM data_source_runs WHERE id IN (127,128))
) AS receipt;
COMMIT;
