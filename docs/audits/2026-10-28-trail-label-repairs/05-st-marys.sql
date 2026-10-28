-- Reviewed one-segment terrain correction; backup 1793170232146 completed successfully.
-- Review and source links: 05-st-marys.review.json. No geometry or route-summary changes.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='180s';
DO $repair$
DECLARE before_hash text; after_hash text; preserved_hash text; current_links jsonb; route_hashes jsonb; after_route_hashes jsonb;
BEGIN
  SELECT md5((to_jsonb(s)-ARRAY['display_name','updated_at'])::text),
    md5((to_jsonb(s)-ARRAY['display_name','kind','updated_at'])::text)
    INTO before_hash,preserved_hash FROM segments s WHERE id='co-osm-248cf2f44584ef1c340c' FOR UPDATE;
  IF before_hash IS DISTINCT FROM '93de0318fad5598c0c10066ad01cf7ba'
    OR (SELECT display_name FROM segments WHERE id='co-osm-248cf2f44584ef1c340c') IS DISTINCT FROM 'St. Mary''s Glacier Trail'
    THEN RAISE EXCEPTION 'St Marys segment changed since review'; END IF;
  PERFORM 1 FROM route_segments WHERE segment_id='co-osm-248cf2f44584ef1c340c' FOR UPDATE;
  SELECT jsonb_agg(jsonb_build_object('route_id',route_id,'ordinal',ordinal,'direction',direction) ORDER BY route_id COLLATE "C",ordinal)
    INTO current_links FROM route_segments WHERE segment_id='co-osm-248cf2f44584ef1c340c';
  IF current_links IS DISTINCT FROM '[{"ordinal": 39, "route_id": "co-catalog-2f3a0af3af92b0e6732c2d39", "direction": "forward"}, {"ordinal": 39, "route_id": "co-catalog-3d100b4c3375d95c074ef866", "direction": "forward"}, {"ordinal": 39, "route_id": "co-catalog-4c3631c036d2e1838450ef04", "direction": "forward"}, {"ordinal": 39, "route_id": "co-catalog-6fa6f44c8a78a037808079e4", "direction": "forward"}, {"ordinal": 39, "route_id": "co-catalog-785f56cbf0caf79239a54479", "direction": "forward"}, {"ordinal": 39, "route_id": "co-catalog-ab3389b8d230d134043d2e86", "direction": "forward"}, {"ordinal": 39, "route_id": "co-catalog-b20d1b8a2273d857b76ce3ff", "direction": "forward"}, {"ordinal": 39, "route_id": "co-catalog-c0d7c331a82926e09e59a3d9", "direction": "forward"}, {"ordinal": 39, "route_id": "co-catalog-c7de698fc12f4055cea33ab8", "direction": "forward"}, {"ordinal": 39, "route_id": "co-catalog-cbaa1138484032443464919c", "direction": "forward"}, {"ordinal": 39, "route_id": "co-catalog-db58aa9fe559c1214b536825", "direction": "forward"}, {"ordinal": 39, "route_id": "co-catalog-fd822056e6b9eb8b8e777e9c", "direction": "forward"}]'::jsonb THEN RAISE EXCEPTION 'St Marys route links changed'; END IF;
  PERFORM 1 FROM routes WHERE id IN (SELECT route_id FROM route_segments WHERE segment_id='co-osm-248cf2f44584ef1c340c') ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM routes WHERE id IN (SELECT route_id FROM route_segments WHERE segment_id='co-osm-248cf2f44584ef1c340c')
    AND (owner <> 'peaks' OR status NOT IN ('active','pending'))) THEN RAISE EXCEPTION 'Non-catalog route'; END IF;
  SELECT jsonb_object_agg(r.id,md5((to_jsonb(r)-ARRAY['terrain_category','difficulty','updated_at'])::text)) INTO route_hashes
    FROM routes r WHERE id IN (SELECT route_id FROM route_segments WHERE segment_id='co-osm-248cf2f44584ef1c340c');
  UPDATE segments SET kind='snowfield',display_name='Saint Mary''s Glacier',updated_at=now() WHERE id='co-osm-248cf2f44584ef1c340c';
  INSERT INTO segment_terrain_labels(segment_id,route_id,from_kind,kind,plan_sha256,reviewed_by,sources)
    VALUES ('co-osm-248cf2f44584ef1c340c','co-catalog-2f3a0af3af92b0e6732c2d39','glacier','snowfield','253b44318069683282065445f34a8dfb24ba3e4d9d17917565e09a1135787b9c','Codex terrain reconciliation, authorized by Josiah','["https://www.clearcreekcounty.org/st-marys-glacier/", "https://www.cmc.org/education-adventure/trips/routes-places/st-marys-glacier", "https://www.openstreetmap.org/way/175382199"]'::jsonb);
  PERFORM refresh_route_terrain(ARRAY(SELECT DISTINCT route_id FROM route_segments WHERE segment_id='co-osm-248cf2f44584ef1c340c'));
  SELECT md5((to_jsonb(s)-ARRAY['display_name','kind','updated_at'])::text) INTO after_hash FROM segments s WHERE id='co-osm-248cf2f44584ef1c340c';
  IF preserved_hash IS DISTINCT FROM after_hash THEN RAISE EXCEPTION 'Non-label/terrain segment data changed'; END IF;
  SELECT jsonb_object_agg(r.id,md5((to_jsonb(r)-ARRAY['terrain_category','difficulty','updated_at'])::text)) INTO after_route_hashes
    FROM routes r WHERE id IN (SELECT route_id FROM route_segments WHERE segment_id='co-osm-248cf2f44584ef1c340c');
  IF route_hashes IS DISTINCT FROM after_route_hashes THEN RAISE EXCEPTION 'Route geometry, stats or summaries changed'; END IF;
END $repair$;
SELECT jsonb_build_object('segment',s.id,'kind',s.kind,'display_name',s.display_name,
  'preserved_hash',md5((to_jsonb(s)-ARRAY['display_name','kind','updated_at'])::text),
  'plan_sha256','253b44318069683282065445f34a8dfb24ba3e4d9d17917565e09a1135787b9c','verified_at',now(),'backup_id','1793170232146',
  'routes',(SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'terrain_category',r.terrain_category,'difficulty',r.difficulty,'stats_hash',md5(jsonb_build_array(distance,gain,gain_loss,polyline6)::text)) ORDER BY r.id)
    FROM routes r WHERE id IN (SELECT route_id FROM route_segments WHERE segment_id=s.id))) FROM segments s WHERE s.id='co-osm-248cf2f44584ef1c340c';
COMMIT;
