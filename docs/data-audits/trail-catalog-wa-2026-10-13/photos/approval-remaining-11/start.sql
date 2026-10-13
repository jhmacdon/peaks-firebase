\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SET LOCAL standard_conforming_strings=on;
\ir bindings.sql
\set storage_bucket ''
SELECT clock_timestamp() audit_started_at \gset photo_
\ir state.sql
SELECT session_user='postgres' AND current_user=session_user AND current_database()='peaks'
  AND (:'photo_state'::jsonb->>'count')::int=11 AND (:'photo_state'::jsonb->>'pendingReady')::boolean
  AND (:'photo_state'::jsonb->>'routesPending')::boolean AND (:'photo_state'::jsonb->>'pilotJobsUnchangedPartition')::boolean
  AND (:'photo_state'::jsonb->>'priorApprovedValid')::boolean AND :'media_report_sha256' ~ '^[a-f0-9]{64}$' AND :'media_passed'='true'
  AND EXISTS(SELECT 1 FROM data_source_runs WHERE id=:'preview_audit_id'::bigint AND source='trail-catalog-photo-remaining-preview' AND status='dry_run'
    AND finished_at IS NOT NULL AND rows_in=11 AND rows_matched=11 AND rows_written=0
    AND notes::jsonb->>'operator'=session_user AND notes::jsonb->>'mode'='rollback-only' AND notes::jsonb->>'state'='rollback_confirmed'
    AND notes::jsonb->'expectedBindings'=:'photo_expected'::jsonb AND notes::jsonb->'sourceHashes'=:'photo_source_hashes'::jsonb
    AND notes::jsonb->>'previewSha256'=:'photo_preview_sha256' AND notes::jsonb->'rollbackConfirmed'='true'::jsonb
    AND notes::jsonb->'boundedReadbackPassed'='true'::jsonb AND notes::jsonb->'insideAssertionsPassed'='true'::jsonb
    AND notes::jsonb->>'outputSha256' ~ '^[a-f0-9]{64}$')
  AND NOT EXISTS(SELECT 1 FROM data_source_runs WHERE source='trail-catalog-photo-remaining-approval' AND finished_at IS NULL)
  preflight_ok \gset photo_
\if :photo_preflight_ok
INSERT INTO data_source_runs(source,run_kind,status,started_at,rows_in,rows_matched,rows_written,notes)
VALUES('trail-catalog-photo-remaining-approval','import','failed',:'photo_audit_started_at'::timestamptz,11,11,NULL,
  jsonb_build_object('mode','verified-admin-ui','previewAuditId',:'preview_audit_id'::bigint,'previewSha256',:'photo_preview_sha256',
    'sourceHashes',:'photo_source_hashes'::jsonb,'expectedBindings',:'photo_expected'::jsonb,'before',:'photo_state'::jsonb,
    'mediaReportSha256',:'media_report_sha256','mediaPassed',true,'operator',session_user,'outcomeUnconfirmed',true,
    'rowsWrittenMeaning','verified approved photos, each updating one place and one queue row','fixedMonthlyCostDeltaUsd',0)::text)
RETURNING id AS audit_id \gset photo_
COMMIT;
SELECT :'photo_audit_id'::bigint audit_id;
\else
ROLLBACK;
\echo 'Remaining-photo approval preflight failed; no approval audit inserted. Do not approve.'
\quit 2
\endif
