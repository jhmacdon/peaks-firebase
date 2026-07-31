-- Add the trailhead for Borah Peak's standard Southwest Ridge route.
--
-- AllTrails, SummitPost, Peakbagger, and OSM agree on the Borah Peak
-- Trailhead and the Chicken Out Ridge route.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'F3394CA0F3F5C87EEB47',
      'Borah Peak Trailhead',
      2259.0,
      44.1324886,
      -113.8346164,
      'US',
      'ID',
      jsonb_build_object('osm', '128539460'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/128539460',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/southwest-chicken-out-ridge/155410',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/idaho/mount-borah-trail--2',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=854459',
        'access_note', 'Check current road, campground, parking, and land-management rules before travel.',
        'hazard_note', 'The route is very steep and includes exposed Class 3 scrambling on Chicken Out Ridge. Snow and ice can make the ridge and snow-bridge area much more serious.',
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
