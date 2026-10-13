\set ON_ERROR_STOP on
\pset pager off
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL idle_in_transaction_session_timeout='60s';
SET LOCAL application_name='peaks-trail-catalog-review-schema';
DO $$ BEGIN
  IF session_user<>'postgres' OR current_user<>session_user OR current_database()<>'peaks' THEN
    RAISE EXCEPTION 'Connect directly as the peaks postgres operator'; END IF;
  IF to_regclass('public.trail_catalog_candidate_jobs') IS NULL THEN
    RAISE EXCEPTION 'Phase 2 schema is missing'; END IF;
  IF to_regclass('public.trail_catalog_review_jobs') IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 3 already exists; inspect its prior receipt instead of reapplying'; END IF;
END $$;
CREATE TEMP TABLE trail_review_rows_before(table_name TEXT,tuple_id TEXT,tuple_version TEXT) ON COMMIT DROP;
INSERT INTO trail_review_rows_before SELECT 'routes',ctid::text,xmin::text FROM routes;
INSERT INTO trail_review_rows_before SELECT 'segments',ctid::text,xmin::text FROM segments;
INSERT INTO trail_review_rows_before SELECT 'route_segments',ctid::text,xmin::text FROM route_segments;
INSERT INTO trail_review_rows_before SELECT 'route_destinations',ctid::text,xmin::text FROM route_destinations;
INSERT INTO trail_review_rows_before SELECT 'candidate_jobs',ctid::text,xmin::text FROM trail_catalog_candidate_jobs;
CREATE TEMP TABLE trail_review_protected_functions ON COMMIT DROP AS
  SELECT p.oid,p.proname,md5(pg_get_functiondef(p.oid)) AS definition_hash FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  AND p.proname IN ('is_valid_route_provenance','peaks_route_passes_publish_integrity',
    'activate_standard_route_factory','enforce_peaks_route_cover_activation','peaks_route_kind_passes_contact',
    'route_segments_cover_provenance','trail_catalog_span_matches','queue_sessions_near');
DO $$ BEGIN
  IF (SELECT count(DISTINCT proname) FROM trail_review_protected_functions)<>8 THEN
    RAISE EXCEPTION 'A required source, geometry, contact, cover, or rematch function is missing'; END IF;
END $$;
