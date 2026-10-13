-- Run first as the operator inside the setup transaction, then as the real LOGIN.
SELECT r.rolname,r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolcreatedb,r.rolcreaterole,
       r.rolreplication,r.rolbypassrls,
       (SELECT array_agg(parent.rolname::text ORDER BY parent.rolname)
        FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid
        WHERE m.member=r.oid) AS direct_roles,
       NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid AND m.admin_option) AS no_role_admin,
       pg_has_role(r.oid,'peaks-route-reviewer','member') AS reviewer,
       NOT pg_has_role(r.oid,'peaks-route-factory','member') AS no_factory,
       NOT pg_has_role(r.oid,'peaks-api','member') AS no_api,
       has_table_privilege(r.oid,'public.trail_catalog_candidate_jobs','SELECT') AS read_candidates,
       NOT has_table_privilege(r.oid,'public.trail_catalog_candidate_jobs','INSERT,UPDATE,DELETE,TRUNCATE') AS no_candidate_writes,
       NOT has_table_privilege(r.oid,'public.routes','INSERT,UPDATE,DELETE,TRUNCATE') AS no_route_writes,
       NOT has_table_privilege(r.oid,'public.trail_catalog_candidate_jobs','DELETE,TRUNCATE') AS keep_receipts,
       NOT has_table_privilege(r.oid,'public.destinations','INSERT,UPDATE,DELETE,TRUNCATE') AS no_place_writes,
       NOT has_column_privilege(r.oid,'public.routes','path','UPDATE') AS no_path_update,
       NOT has_column_privilege(r.oid,'public.routes','name','UPDATE') AS no_name_update,
       NOT has_table_privilege(r.oid,'public.standard_route_backfill_jobs','INSERT,DELETE,TRUNCATE') AS no_queue_seed,
       NOT has_table_privilege(r.oid,'public.data_source_runs','INSERT,UPDATE,DELETE,TRUNCATE') AS no_audit_dml,
       has_function_privilege(r.oid,'public.begin_trail_catalog_source_run(text)','EXECUTE') AS begin_source_run,
       has_function_privilege(r.oid,'public.finish_trail_catalog_source_run(bigint,text,integer,integer,integer,text)','EXECUTE') AS finish_source_run,
       has_function_privilege(r.oid,'public.claim_trail_catalog_review(text,text)','EXECUTE') AS claim_review,
       NOT has_function_privilege(r.oid,'public.activate_trail_catalog_candidate(text,text,text)','EXECUTE') AS no_activate
FROM pg_roles r WHERE r.rolname='peaks-route-reviewer-worker';
