\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout='30s';
SET LOCAL standard_conforming_strings=on;
SET LOCAL lock_timeout='5s';
\ir check.sql
UPDATE data_source_runs SET finished_at=clock_timestamp(),rows_in=4,rows_matched=4,rows_written=:'photo_approved_photos'::int,
  status=CASE WHEN :'photo_approved_photos'::int=4 AND :'photo_place_rows_changed'::int=4 AND :'photo_queue_rows_changed'::int=4 THEN 'success' ELSE 'partial' END,
  notes=(notes::jsonb||jsonb_build_object('outcomeUnconfirmed',false,'approvedPhotos',:'photo_approved_photos'::int,
    'placeRowsChanged',:'photo_place_rows_changed'::int,'queueRowsChanged',:'photo_queue_rows_changed'::int,'after',:'photo_state'::jsonb,
    'storageBucket',:'storage_bucket','routesUnchanged',true,'candidateJobsUnchanged',true))::text
WHERE id=:'audit_id'::bigint AND source='trail-catalog-photo-approval' AND finished_at IS NULL AND notes::jsonb->>'operator'=session_user
RETURNING id,status,rows_in,rows_matched,rows_written,finished_at;
COMMIT;
