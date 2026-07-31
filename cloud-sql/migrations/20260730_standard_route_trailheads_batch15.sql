-- Add the exact Charlotte Pass start for the Mount Kosciuszko Summit Walk.
--
-- NSW National Parks names this as the 18.6 km return Summit Walk. The point
-- below is the first OpenStreetMap node on the matching hiking relation, just
-- beyond the Charlotte Pass parking area.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'E1A6D492E12025800989',
      'Charlotte Pass Summit Walk Trailhead',
      1850.0,
      -36.4318081,
      148.3283279,
      'AU',
      'NSW',
      jsonb_build_object('osm', '179288585'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/179288585',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_source_url', 'https://www.alltrails.com/trail/australia/new-south-wales/mount-kosciuszko-summit-via-charlotte-pass',
        'route_reference_url', 'https://www.summitpost.org/mount-kosciuszko-tar-gan-gil/150910',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=489408',
        'route_access_url', 'https://www.nationalparks.nsw.gov.au/things-to-do/walking-tracks/mount-kosciuszko-summit-walk',
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
