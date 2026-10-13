-- Requires audit_id and observed storage_bucket; all statements read only.
\ir bindings.sql
SELECT notes::jsonb audit_notes,started_at audit_started_at FROM data_source_runs
WHERE id=:'audit_id'::bigint AND source='trail-catalog-photo-approval' AND finished_at IS NULL
  AND notes::jsonb->>'operator'=session_user AND notes::jsonb->'expectedBindings'=:'photo_expected'::jsonb
  AND notes::jsonb->'sourceHashes'=:'photo_source_hashes'::jsonb AND notes::jsonb->>'previewSha256'=:'photo_preview_sha256'
  AND notes::jsonb->'previewAuditId'='130'::jsonb \gset photo_
\ir state.sql
SELECT session_user='postgres' AND current_user=session_user AND current_database()='peaks'
  AND :'storage_bucket'='donner-a8608.appspot.com'
  AND (:'photo_state'::jsonb->>'count')::int=4 AND (:'photo_state'::jsonb->>'bindingsValid')::boolean
  AND (:'photo_state'::jsonb->>'routesPending')::boolean
  AND (:'photo_state'::jsonb->'fingerprints')=(:'photo_audit_notes'::jsonb#>'{before,fingerprints}')
  AND (SELECT count(*)=4 AND bool_and(CASE WHEN now_photo->>'status'='approved' THEN now_photo->'approvedBinding'='true'::jsonb
      AND now_photo->>'candidateTuple' IS DISTINCT FROM old_photo->>'candidateTuple'
      AND now_photo->>'placeTuple' IS DISTINCT FROM old_photo->>'placeTuple'
    ELSE now_photo->>'status'='pending' AND now_photo->>'candidateTuple'=old_photo->>'candidateTuple' AND now_photo->>'placeTuple'=old_photo->>'placeTuple' END)
    FROM jsonb_array_elements(:'photo_state'::jsonb->'photos') now_photo JOIN jsonb_array_elements(:'photo_audit_notes'::jsonb#>'{before,photos}') old_photo
      ON now_photo->>'candidateId'=old_photo->>'candidateId') checks_ok \gset photo_
\if :photo_checks_ok
SELECT (:'photo_state'::jsonb->>'approvedPhotos')::int approved_photos,
  (SELECT count(*) FROM jsonb_array_elements(:'photo_state'::jsonb->'photos') now_photo JOIN jsonb_array_elements(:'photo_audit_notes'::jsonb#>'{before,photos}') old_photo
    ON now_photo->>'candidateId'=old_photo->>'candidateId' WHERE now_photo->>'candidateTuple' IS DISTINCT FROM old_photo->>'candidateTuple') queue_rows_changed,
  (SELECT count(*) FROM jsonb_array_elements(:'photo_state'::jsonb->'photos') now_photo JOIN jsonb_array_elements(:'photo_audit_notes'::jsonb#>'{before,photos}') old_photo
    ON now_photo->>'candidateId'=old_photo->>'candidateId' WHERE now_photo->>'placeTuple' IS DISTINCT FROM old_photo->>'placeTuple') place_rows_changed \gset photo_
\else
\echo 'Photo readback failed: binding, bucket, route, or candidate-job drift. Leave unknown audit open; inspect.'
\quit 2
\endif
