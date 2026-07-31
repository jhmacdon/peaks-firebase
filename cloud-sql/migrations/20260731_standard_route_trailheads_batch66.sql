-- Add the upper Pancasila trailhead for Gunung Tambora's standard route.
--
-- Gunung Bagging identifies Pancasila as Tambora's most popular route. A
-- current successful Peakbagger track matches the connected OSM line from
-- this road end to the summit.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'C6A2F96D1A04D339E9F1',
      'Pancasila Tambora Trailhead',
      822.0,
      -8.190161,
      117.860874,
      'ID',
      NULL,
      jsonb_build_object('osm_way', '1422509005'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/1422509005',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3029620',
        'route_reference_url', 'https://www.gunungbagging.com/tambora/',
        'secondary_route_reference_url', 'https://www.alltrails.com/trail/indonesia/sumbawa/mount-tambora--2',
        'access_note', 'Tambora National Park requires registration and a permit. Register at the Pancasila office and confirm current fees, route status, guide rules, and transport before starting. The rough approach road may need a suitable vehicle or motorcycle.',
        'hazard_note', 'This is a very long tropical volcano climb, often split over two or three days. Expect heat and roots in the forest, limited water, loose volcanic sand, wind, fog, unstable crater-rim ground, deep rock trenches, and a long descent. Carry enough water, camp gear when needed, and reliable offline navigation.',
        'catalog_audit', 'standard-route-goal-2026-07-31'
      )
    )
),
prepared AS (
  SELECT
    id,
    name,
    lower(name) AS search_name,
    elevation,
    ST_SetSRID(ST_MakePoint(lng, lat, elevation), 4326)::geography AS location,
    country_code,
    state_code,
    external_ids,
    metadata
  FROM incoming
)
INSERT INTO destinations (
  id,
  name,
  search_name,
  elevation,
  prominence,
  location,
  geohash,
  type,
  activities,
  features,
  owner,
  country_code,
  state_code,
  external_ids,
  metadata,
  created_at,
  updated_at
)
SELECT
  p.id,
  p.name,
  p.search_name,
  p.elevation,
  NULL,
  p.location,
  NULL,
  'point',
  ARRAY['outdoor-trek']::activity_type[],
  ARRAY['trailhead']::destination_feature[],
  'peaks',
  p.country_code,
  p.state_code,
  p.external_ids,
  p.metadata,
  now(),
  now()
FROM prepared p
WHERE NOT EXISTS (
  SELECT 1
  FROM destinations d
  WHERE d.external_ids @> p.external_ids
     OR (
       d.search_name = p.search_name
       AND d.location IS NOT NULL
       AND ST_DWithin(d.location, p.location, 250)
     )
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
