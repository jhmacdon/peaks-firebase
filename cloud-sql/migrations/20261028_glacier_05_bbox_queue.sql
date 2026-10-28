-- Queue glacier rematches by bounding box, not exact distance.
-- An exact geography ST_DWithin against long route paths (up to 64k points)
-- hit the statement timeout during the first production import. Queueing a
-- superset is harmless: the crossing engine decides what actually crosses.
-- No new infrastructure; $0/month.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.queue_glacier_matches(did text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE affected text[];
BEGIN
  WITH queued AS (INSERT INTO public.route_glacier_rematch_queue(route_id)
    SELECT DISTINCT r.id FROM public.glacier_outline_parts bp JOIN public.routes r
      ON r.path IS NOT NULL AND r.path && bp.outline_part WHERE bp.destination_id=did
    UNION SELECT route_id FROM public.route_glacier_crossings WHERE destination_id=did
    ON CONFLICT(route_id) DO UPDATE SET queued_at=now() RETURNING route_id)
    SELECT array_agg(route_id) INTO affected FROM queued;
  UPDATE public.routes r SET glacier_match_input_hash=NULL WHERE r.glacier_match_input_hash IS NOT NULL AND r.id=ANY(affected);
  PERFORM public.refresh_route_search_terms(affected);
  INSERT INTO public.session_rematch_queue(session_id,reason)
    SELECT DISTINCT s.id,'glacier:'||did FROM public.glacier_outline_parts bp
    JOIN public.tracking_sessions s ON s.ended=true AND s.path IS NOT NULL
      AND s.path && public.ST_Buffer(bp.outline_part,50) WHERE bp.destination_id=did
    ON CONFLICT(session_id) DO UPDATE SET reason=EXCLUDED.reason,queued_at=now();
  INSERT INTO public.session_rematch_queue(session_id,reason)
    SELECT DISTINCT session_id,'glacier:'||did FROM public.session_glacier_crossings WHERE destination_id=did
    ON CONFLICT(session_id) DO UPDATE SET reason=EXCLUDED.reason,queued_at=now();
  UPDATE public.tracking_sessions s SET glacier_match_input_hash=NULL,server_updated_at=now()
    WHERE s.glacier_match_input_hash IS NOT NULL AND EXISTS(
      SELECT 1 FROM public.session_rematch_queue q WHERE q.session_id=s.id AND q.reason='glacier:'||did);
END $$;
GRANT EXECUTE ON FUNCTION public.queue_glacier_matches(text) TO "peaks-api";
COMMIT;
