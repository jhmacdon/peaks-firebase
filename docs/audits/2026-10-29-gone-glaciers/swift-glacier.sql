-- Swift Glacier on Mount St. Helens is no longer a glacier: it lost most of its ice in
-- the 1980 eruption, and only debris-covered remnant ice is left. OSM still maps it (relation 9690999), so the
-- trail import typed two Worm Flows edges as glacier, and the 2026-10-28 mapped-ice batch
-- named them after it. The route grazes the polygon's edge, so the timeline read
-- Worm Flows / Swift Glacier / Worm Flows / Swift Glacier.
-- Restore the path's own name and kind and record a reconciliation label so later terrain
-- plans keep it. Review: swift-glacier.review.json. No geometry, statistics or route-link changes. Backup: 1793300997886 (SUCCESSFUL).
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='180s';
SET LOCAL peaks.defer_rematch='on';
DO $repair$
DECLARE
  ids text[] := ARRAY['wa-osm-0a34bd11189f1ed4c08e','wa-osm-2e4be864676f0e54b83e'];
  expected jsonb := '{"wa-osm-0a34bd11189f1ed4c08e": "65c18c4e7e70399ed0ae382d52b7870a", "wa-osm-2e4be864676f0e54b83e": "70d5d38e07f7072e39ee8cd53aad3496"}';
  expected_links jsonb := '[{"ordinal": 24, "route_id": "qojql4CaD3IF6GZfW0TE", "direction": "forward"}, {"ordinal": 26, "route_id": "qojql4CaD3IF6GZfW0TE", "direction": "forward"}]';
  before_hashes jsonb; preserved jsonb; after_preserved jsonb; links jsonb; route_hash text; after_route_hash text;
BEGIN
  PERFORM 1 FROM segments WHERE id = ANY(ids) ORDER BY id FOR UPDATE;
  SELECT jsonb_object_agg(s.id, md5((to_jsonb(s)-ARRAY['display_name','updated_at'])::text)),
         jsonb_object_agg(s.id, md5((to_jsonb(s)-ARRAY['display_name','kind','updated_at'])::text))
    INTO before_hashes, preserved FROM segments s WHERE s.id = ANY(ids);
  IF before_hashes IS DISTINCT FROM expected
    OR EXISTS (SELECT 1 FROM segments WHERE id = ANY(ids) AND (display_name IS DISTINCT FROM 'Swift Glacier' OR kind <> 'glacier'))
    THEN RAISE EXCEPTION 'Swift segments changed since review: %', before_hashes; END IF;
  PERFORM 1 FROM route_segments WHERE segment_id = ANY(ids) FOR UPDATE;
  SELECT jsonb_agg(jsonb_build_object('route_id',route_id,'ordinal',ordinal,'direction',direction) ORDER BY route_id COLLATE "C", ordinal)
    INTO links FROM route_segments WHERE segment_id = ANY(ids);
  IF links IS DISTINCT FROM expected_links THEN RAISE EXCEPTION 'Swift route links changed: %', links; END IF;
  PERFORM 1 FROM routes WHERE id = 'qojql4CaD3IF6GZfW0TE' AND owner = 'peaks' AND status IN ('active','pending') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Worm Flows route is not an active catalog route'; END IF;
  SELECT md5((to_jsonb(r)-ARRAY['terrain_category','difficulty','updated_at'])::text) INTO route_hash FROM routes r WHERE id = 'qojql4CaD3IF6GZfW0TE';

  UPDATE segments SET kind = 'climbers_route', display_name = 'Worm Flows Climbing Route', updated_at = now() WHERE id = ANY(ids);
  INSERT INTO segment_terrain_labels (segment_id, route_id, from_kind, kind, plan_sha256, reviewed_by, sources)
  SELECT id, 'qojql4CaD3IF6GZfW0TE', 'glacier', 'climbers_route', '79e71b7a12ccf5df27e7af04e39d209fa4c0138f069238e61930fa1e42973748',
    'Claude terrain reconciliation, authorized by Josiah',
    '["https://www.usgs.gov/volcanoes/mount-st.-helens/glaciation-mount-st-helens", "https://www.schweizerbart.de/papers/zfg/detail/43/93659/Shoestring_Glacier_Seventeen_years_later_Mount_St_Helens_USA", "https://www.openstreetmap.org/relation/9690999"]'::jsonb
  FROM unnest(ids) AS id;
  PERFORM refresh_route_terrain(ARRAY['qojql4CaD3IF6GZfW0TE']);

  SELECT jsonb_object_agg(s.id, md5((to_jsonb(s)-ARRAY['display_name','kind','updated_at'])::text)) INTO after_preserved FROM segments s WHERE s.id = ANY(ids);
  IF after_preserved IS DISTINCT FROM preserved THEN RAISE EXCEPTION 'Non-label/terrain segment data changed'; END IF;
  SELECT md5((to_jsonb(r)-ARRAY['terrain_category','difficulty','updated_at'])::text) INTO after_route_hash FROM routes r WHERE id = 'qojql4CaD3IF6GZfW0TE';
  IF after_route_hash IS DISTINCT FROM route_hash THEN RAISE EXCEPTION 'Route geometry, stats or summaries changed'; END IF;
END $repair$;
SELECT jsonb_build_object('segments', (SELECT jsonb_agg(jsonb_build_object('id',id,'kind',kind,'display_name',display_name) ORDER BY id)
    FROM segments WHERE id IN ('wa-osm-0a34bd11189f1ed4c08e','wa-osm-2e4be864676f0e54b83e')),
  'route', (SELECT jsonb_build_object('id',id,'terrain_category',terrain_category,'difficulty',difficulty) FROM routes WHERE id='qojql4CaD3IF6GZfW0TE'),
  'verified_at', now());
COMMIT;
