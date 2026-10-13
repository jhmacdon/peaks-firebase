\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout='30s';
SET LOCAL standard_conforming_strings=on;
SET LOCAL lock_timeout='5s';
\ir bindings.sql
\set storage_bucket ''
SELECT clock_timestamp() audit_started_at \gset photo_
\ir state.sql
SELECT session_user='postgres' AND current_user=session_user AND current_database()='peaks'
  AND (:'photo_state'::jsonb->>'count')::int=4 AND (:'photo_state'::jsonb->>'pendingReady')::boolean
  AND (:'photo_state'::jsonb->>'routesPending')::boolean
  AND EXISTS(SELECT 1 FROM data_source_runs WHERE id=130 AND source='trail-catalog-photo-approval-preview' AND status='dry_run'
    AND finished_at IS NOT NULL AND rows_in=4 AND rows_matched=4 AND rows_written=0
    AND notes::jsonb->>'mode'='rollback-only' AND notes::jsonb->>'state'='rollback_confirmed' AND notes::jsonb->>'checks'='passed'
    AND notes::jsonb->>'report'='photos/approval-preview/production-preview-3.txt'
    AND notes::jsonb->'candidateIds'=(SELECT jsonb_agg(b->>'candidateId') FROM jsonb_array_elements(:'photo_expected'::jsonb) b)
    AND notes::jsonb->>'previewSha256'=:'photo_preview_sha256' AND notes::jsonb->'rollbackConfirmed'='true'::jsonb
    AND notes::jsonb->'boundedReadbackPassed'='true'::jsonb AND notes::jsonb->'insideAssertionsPassed'='true'::jsonb)
  AND NOT EXISTS(SELECT 1 FROM data_source_runs WHERE source='trail-catalog-photo-approval' AND finished_at IS NULL)
  preflight_ok \gset photo_
\if :photo_preflight_ok
INSERT INTO data_source_runs(source,run_kind,status,started_at,rows_in,rows_matched,rows_written,notes)
VALUES('trail-catalog-photo-approval','import','failed',:'photo_audit_started_at'::timestamptz,4,4,NULL,
  jsonb_build_object('mode','verified-admin-ui','previewAuditId',130,'previewSha256',:'photo_preview_sha256','sourceHashes',:'photo_source_hashes'::jsonb,
    'expectedBindings',:'photo_expected'::jsonb,'before',:'photo_state'::jsonb,'operator',session_user,'outcomeUnconfirmed',true,
    'rowsWrittenMeaning','approved photos, each updating one place and one queue row','fixedMonthlyCostDeltaUsd',0)::text)
RETURNING id AS audit_id \gset photo_
COMMIT;
SELECT :'photo_audit_id'::bigint audit_id;
\else
ROLLBACK;
\echo 'Photo approval preflight failed; inspect exact bindings and audit130. Do not approve.'
\quit 2
\endif
