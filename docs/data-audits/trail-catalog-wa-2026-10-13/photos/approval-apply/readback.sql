\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL standard_conforming_strings=on;
\ir check.sql
SELECT jsonb_build_object('auditId',:'audit_id'::bigint,'readOnly',true,'checks','passed','routesUnchanged',true,'candidateJobsUnchanged',true,
  'approvedPhotos',:'photo_approved_photos'::int,'placeRowsChanged',:'photo_place_rows_changed'::int,'queueRowsChanged',:'photo_queue_rows_changed'::int,
  'storageBucket',:'storage_bucket','state',:'photo_state'::jsonb) receipt;
COMMIT;
