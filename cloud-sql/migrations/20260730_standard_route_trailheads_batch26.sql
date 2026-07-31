-- Add the Summit Trailhead for Wheeler Peak's standard route.
--
-- AllTrails, SummitPost, Peakbagger, and OSM agree on the maintained
-- Wheeler Peak Summit Trail from the scenic-drive parking lot.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'F2D5A981A175CDAF83EB',
      'Summit Trailhead',
      3103.0,
      39.0171926,
      -114.3034170,
      'US',
      'NV',
      jsonb_build_object('osm', '1363086973'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/1363086973',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/standard-route/155412',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/nevada/wheeler-peak-trail-via-stella-lake-trail',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2964700',
        'access_note', 'Wheeler Peak Scenic Drive and the Summit Trailhead close seasonally. Check current Great Basin National Park road, parking, trail, and pet rules; dogs are not allowed on this trail.',
        'hazard_note', 'The upper trail is steep, rocky, exposed, and prone to strong wind, fast weather changes, lightning, snow, and ice.',
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
