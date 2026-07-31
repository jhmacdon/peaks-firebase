-- Add the Vivian Creek start for San Gorgonio Mountain's standard route.
--
-- AllTrails, SummitPost, Peakbagger, and OSM agree on the Vivian Creek
-- Trail from the Falls Picnic Area road to the summit.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'E997A49D032E44DD92D1',
      'Vivian Creek Trailhead',
      1829.0,
      34.081801,
      -116.893032,
      'US',
      'CA',
      jsonb_build_object('osm', '1067410251'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/1067410251',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/san-gorgonio/150533',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/california/vivian-creek-trail-to-san-gorgonio-peak',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=342671',
        'access_note', 'A San Gorgonio Wilderness permit and an Adventure Pass or other valid parking pass may be required. Check current Forest Service permit, parking, fire, and closure rules before travel.',
        'hazard_note', 'This is a long, steep route with more than a vertical mile of gain. Heat, scarce water, snow, ice, lightning, strong wind, and high altitude can make the upper mountain hazardous.',
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
