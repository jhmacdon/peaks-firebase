\set ON_ERROR_STOP on
SELECT jsonb_pretty(jsonb_build_object(
  'checkedAt',clock_timestamp(),
  'audits',(SELECT jsonb_agg(jsonb_build_object(
    'id',id,'source',source,'status',status,'rowsIn',rows_in,
    'rowsMatched',rows_matched,'rowsWritten',rows_written,'finishedAt',finished_at)
    ORDER BY id) FROM data_source_runs WHERE id>=119 AND source LIKE 'trail-catalog%'),
  'jobStates',(SELECT jsonb_object_agg(state,n) FROM (
    SELECT state,count(*) n FROM trail_catalog_candidate_jobs
    WHERE batch_key='wa-cascades-20261013' GROUP BY state) c),
  'routes',(SELECT jsonb_agg(jsonb_build_object(
    'sourceKey',j.source_key,'routeId',r.id,'name',r.name,'kind',r.kind,
    'status',r.status,'distanceM',r.distance,'gainM',r.gain,
    'difficulty',r.difficulty,'estMovingSeconds',r.est_moving_seconds,
    'trailheadId',r.trailhead_destination_id,'objectiveId',r.objective_destination_id,
    'pendingBindingValid',trail_catalog_pending_binding_valid(r.id),
    'publishIntegrity',peaks_route_passes_publish_integrity(r.id),
    'segmentIds',(SELECT jsonb_agg(rs.segment_id ORDER BY rs.ordinal)
      FROM route_segments rs WHERE rs.route_id=r.id)) ORDER BY j.source_key)
    FROM trail_catalog_candidate_jobs j JOIN routes r ON r.id=j.proposed_route_id
    WHERE j.batch_key='wa-cascades-20261013' AND j.state='pending')
));
