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
  AND (:'photo_state'::jsonb->>'priorApprovedValid')::boolean
  AND NOT EXISTS(SELECT 1 FROM data_source_runs WHERE source='trail-catalog-photo-remaining-preview' AND finished_at IS NULL)
  preflight_ok \gset photo_
\if :photo_preflight_ok
INSERT INTO data_source_runs(source,run_kind,status,started_at,rows_in,rows_matched,rows_written,notes)
VALUES('trail-catalog-photo-remaining-preview','import','failed',:'photo_audit_started_at'::timestamptz,11,11,NULL,
  jsonb_build_object('mode','rollback-only','previewSha256',:'photo_preview_sha256','sourceHashes',:'photo_source_hashes'::jsonb,
    'expectedBindings',:'photo_expected'::jsonb,'candidateIds',(SELECT jsonb_agg(b->>'candidateId') FROM jsonb_array_elements(:'photo_expected'::jsonb) b),
    'before',:'photo_state'::jsonb,'operator',session_user,'outcomeUnconfirmed',true,'fixedMonthlyCostDeltaUsd',0)::text)
RETURNING id AS preview_audit_id \gset photo_
COMMIT;
SELECT :'photo_preview_audit_id'::bigint preview_audit_id;
\else
ROLLBACK;
\echo 'Remaining-photo preview preflight failed; no audit or preview updates inserted.'
\quit 2
\endif
