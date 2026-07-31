-- Add the Deadfall Meadow start for Mount Eddy's standard route.
--
-- AllTrails, SummitPost, Peakbagger, and OSM agree on the route that follows
-- Deadfall Lakes Trail and Mount Eddy Trail from Parks Creek Road.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'B5AE9BD3E7F446C4A9B9',
      'Deadfall Meadow Trailhead',
      1970.0,
      41.334862,
      -122.520707,
      'US',
      'CA',
      jsonb_build_object('osm', '11105651007'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/11105651007',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/mount-eddy/151690',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/california/mount-eddy-trail',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2903344',
        'access_note', 'The trailhead is on Parks Creek Road. Check current Klamath National Forest road, parking, fire, permit, and seasonal closure rules before travel.',
        'hazard_note', 'The upper trail is exposed and can hold snow. Lightning, heat, snow, ice, wildfire smoke, and limited water above the lakes can make the route hazardous.',
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
