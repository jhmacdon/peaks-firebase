-- Add the lower Eldorado Canyon road start for Star Peak's standard route.
--
-- AllTrails, SummitPost, Peakbagger, and OSM agree on the west-side road
-- approach. This start stays near the 5,700-foot point that SummitPost says
-- most dry-condition passenger vehicles can reach.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'FDA8BF0A64D326FFE64C',
      'Eldorado Canyon Trailhead',
      1745.0,
      40.5172636,
      -118.2202479,
      'US',
      'NV',
      jsonb_build_object('osm', '8833038469'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/8833038469',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/star-peak/152140',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/nevada/star-peak-trail',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2850995',
        'access_note', 'The route follows an unpaved BLM road through an area with active mining and nearby private parcels. Stay on the public road, obey gates and signs, and check current Winnemucca District BLM access and fire rules.',
        'hazard_note', 'The road becomes steep, loose, rocky, and exposed above the lower start. Heat, scarce water, lightning, snow, wind, mine hazards, and route-finding errors can make it hazardous.',
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
       AND ST_DWithin(d.location, p.location, 150)
     )
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
