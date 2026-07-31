-- Add the Hurricane Creek start for Sacajawea Peak's standard route.
--
-- AllTrails, SummitPost, Peakbagger, and OSM agree on the Hurricane Creek
-- Trail, Thorp Creek Trail, and east-ridge approach.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'C7D44D604E17425EAE3F',
      'Hurricane Creek Trailhead',
      1562.0,
      45.3111071,
      -117.3071457,
      'US',
      'OR',
      jsonb_build_object('osm', '13639948887'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/13639948887',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/sacajawea-peak/151103',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/oregon/sacajawea-peak-trail',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2267402',
        'access_note', 'Hurricane Creek Road is a gravel Forest Service road. Check current Wallowa-Whitman National Forest road, trail, fire, permit, and closure rules before travel.',
        'hazard_note', 'The route has a creek crossing, steep exposed ridge travel, loose rock, little shelter, and no reliable upper-route water. Snow, lightning, heat, wildfire smoke, and stream flow can make it hazardous.',
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
