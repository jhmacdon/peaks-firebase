\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SET LOCAL standard_conforming_strings=on;
\ir bindings.sql
SELECT session_user='postgres' AND current_user=session_user AND current_database()='peaks'
  AND :'preview_state' IN ('rollback_confirmed','failed','outcome_unconfirmed')
  AND :'output_sha256' ~ '^[a-f0-9]{64}$' AND :'report_name' ~ '^production-preview-[1-9][0-9]*[.]txt$'
  args_ok \gset photo_
\if :photo_args_ok
SELECT notes::jsonb audit_notes FROM data_source_runs WHERE id=:'preview_audit_id'::bigint AND source='trail-catalog-photo-remaining-preview'
  AND finished_at IS NULL AND notes::jsonb->>'operator'=session_user AND notes::jsonb->>'previewSha256'=:'photo_preview_sha256'
  AND notes::jsonb->'sourceHashes'=:'photo_source_hashes'::jsonb AND notes::jsonb->'expectedBindings'=:'photo_expected'::jsonb \gset photo_
UPDATE data_source_runs SET finished_at=clock_timestamp(),status=CASE WHEN :'preview_state'='rollback_confirmed' THEN 'dry_run' ELSE 'failed' END,
  rows_in=11,rows_matched=CASE WHEN :'preview_state'='rollback_confirmed' THEN 11 ELSE NULL END,
  rows_written=CASE WHEN :'preview_state'='rollback_confirmed' THEN 0 ELSE NULL END,
  notes=(notes::jsonb||jsonb_build_object('state',:'preview_state','checks',CASE WHEN :'preview_state'='rollback_confirmed' THEN 'passed' ELSE 'failed' END,
    'rollbackConfirmed',:'preview_state'='rollback_confirmed','insideAssertionsPassed',:'preview_state'='rollback_confirmed',
    'boundedReadbackPassed',:'preview_state'='rollback_confirmed','outcomeUnconfirmed',:'preview_state'<>'rollback_confirmed',
    'report',:'report_name','outputSha256',:'output_sha256'))::text
WHERE id=:'preview_audit_id'::bigint AND source='trail-catalog-photo-remaining-preview' AND finished_at IS NULL AND notes::jsonb->>'operator'=session_user
RETURNING id,status,rows_in,rows_matched,rows_written,finished_at;
COMMIT;
\else
ROLLBACK;
\echo 'Preview finish arguments invalid; keep the audit unknown and inspect.'
\quit 2
\endif
