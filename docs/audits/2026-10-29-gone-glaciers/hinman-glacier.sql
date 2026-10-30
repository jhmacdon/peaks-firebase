-- Hinman Glacier on Mount Hinman is gone: in August 2022 Pelto's team found only stranded
-- snow and ice patches, too thin to flow. OSM still maps it (relation 13209365), so the
-- trail import typed one West Ridge edge as glacier and the 2026-10-28 mapped-ice batch
-- named it after it, splitting the scramble into three rows.
-- Restore the neighbouring name and kind and record a reconciliation label so later terrain
-- plans keep it. Review: hinman-glacier.review.json. No geometry, statistics or route-link
-- changes. Backup: 1793301598718 (SUCCESSFUL).
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='180s';
SET LOCAL peaks.defer_rematch='on';
DO $repair$
DECLARE
  ids text[] := ARRAY['wa-osm-40af7038f1da8571c66b'];
  expected jsonb := '{"wa-osm-40af7038f1da8571c66b": "665c8c43693fd6454863b183e42a8279"}';
  expected_links jsonb := '[{"ordinal": 16, "route_id": "kG03P8ClfUZ1AVbCOtot", "direction": "forward"}]';
  before_hashes jsonb; preserved jsonb; after_preserved jsonb; links jsonb; route_hash text; after_route_hash text;
BEGIN
  PERFORM 1 FROM segments WHERE id = ANY(ids) ORDER BY id FOR UPDATE;
  SELECT jsonb_object_agg(s.id, md5((to_jsonb(s)-ARRAY['display_name','updated_at'])::text)),
         jsonb_object_agg(s.id, md5((to_jsonb(s)-ARRAY['display_name','kind','updated_at'])::text))
    INTO before_hashes, preserved FROM segments s WHERE s.id = ANY(ids);
  IF before_hashes IS DISTINCT FROM expected
    OR EXISTS (SELECT 1 FROM segments WHERE id = ANY(ids) AND (display_name IS DISTINCT FROM 'Hinman Glacier' OR kind <> 'glacier'))
    THEN RAISE EXCEPTION 'Hinman segment changed since review: %', before_hashes; END IF;
  PERFORM 1 FROM route_segments WHERE segment_id = ANY(ids) FOR UPDATE;
  SELECT jsonb_agg(jsonb_build_object('route_id',route_id,'ordinal',ordinal,'direction',direction) ORDER BY route_id COLLATE "C", ordinal)
    INTO links FROM route_segments WHERE segment_id = ANY(ids);
  IF links IS DISTINCT FROM expected_links THEN RAISE EXCEPTION 'Hinman route links changed: %', links; END IF;
  PERFORM 1 FROM routes WHERE id = 'kG03P8ClfUZ1AVbCOtot' AND owner = 'peaks' AND status IN ('active','pending') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mount Hinman route is not an active catalog route'; END IF;
  SELECT md5((to_jsonb(r)-ARRAY['terrain_category','difficulty','updated_at'])::text) INTO route_hash FROM routes r WHERE id = 'kG03P8ClfUZ1AVbCOtot';

  UPDATE segments SET kind = 'scramble', display_name = 'Mount Hinman West Ridge Trail', updated_at = now() WHERE id = ANY(ids);
  INSERT INTO segment_terrain_labels (segment_id, route_id, from_kind, kind, plan_sha256, reviewed_by, sources)
  SELECT id, 'kG03P8ClfUZ1AVbCOtot', 'glacier', 'scramble', 'a97acdf7eea9f637da6519299250429925fe439acab6e67d7acc7b160c3bf384',
    'Claude terrain reconciliation, authorized by Josiah',
    '["https://www.kuow.org/stories/rip-washington-s-hinman-glacier-gone-after-thousands-of-years", "https://www.openstreetmap.org/relation/13209365"]'::jsonb
  FROM unnest(ids) AS id;
  PERFORM refresh_route_terrain(ARRAY['kG03P8ClfUZ1AVbCOtot']);

  SELECT jsonb_object_agg(s.id, md5((to_jsonb(s)-ARRAY['display_name','kind','updated_at'])::text)) INTO after_preserved FROM segments s WHERE s.id = ANY(ids);
  IF after_preserved IS DISTINCT FROM preserved THEN RAISE EXCEPTION 'Non-label/terrain segment data changed'; END IF;
  SELECT md5((to_jsonb(r)-ARRAY['terrain_category','difficulty','updated_at'])::text) INTO after_route_hash FROM routes r WHERE id = 'kG03P8ClfUZ1AVbCOtot';
  IF after_route_hash IS DISTINCT FROM route_hash THEN RAISE EXCEPTION 'Route geometry, stats or summaries changed'; END IF;
END $repair$;
SELECT jsonb_build_object('segments', (SELECT jsonb_agg(jsonb_build_object('id',id,'kind',kind,'display_name',display_name) ORDER BY id)
    FROM segments WHERE id IN ('wa-osm-40af7038f1da8571c66b')),
  'route', (SELECT jsonb_build_object('id',id,'terrain_category',terrain_category,'difficulty',difficulty) FROM routes WHERE id='kG03P8ClfUZ1AVbCOtot'),
  'verified_at', now());
COMMIT;
