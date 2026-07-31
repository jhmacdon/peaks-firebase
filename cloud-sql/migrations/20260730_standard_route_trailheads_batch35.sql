-- Add the North Nebo Peak start for Mount Nebo's standard route.
--
-- AllTrails, SummitPost, Peakbagger, and OSM agree on the North Ridge route
-- from the North Nebo Peak Trailhead.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'E6C902B0AC4C4E4F9D36',
      'North Nebo Peak Trailhead',
      2828.0,
      39.848467,
      -111.722264,
      'US',
      'UT',
      jsonb_build_object('osm', '1834832776'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/1834832776',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/mount-nebo/151301',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/utah/mount-nebo',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=440049',
        'access_note', 'The trailhead is reached from the seasonal Nebo Loop and Forest Road 160 area. Check current Uinta-Wasatch-Cache National Forest road, parking, fire, and closure rules before travel.',
        'hazard_note', 'The upper North Ridge is steep, loose, exposed Class 2 terrain. Lightning, snow, ice, strong wind, altitude, and long dry sections can make the route hazardous.',
        'catalog_audit', 'standard-route-goal-2026-07-30'
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
       AND ST_DWithin(d.location, p.location, 150)
     )
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
