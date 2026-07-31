-- Add the La Sal Pass start for Mount Peale's standard route.
--
-- AllTrails, SummitPost, Peakbagger, and OSM agree on the Burlfriends Trail
-- and south-couloir route from La Sal Pass.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'AE4921E6E7C34F4589D7',
      'La Sal Pass Trailhead',
      3086.0,
      38.4189579,
      -109.2516548,
      'US',
      'UT',
      jsonb_build_object('osm', '1395594965'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/1395594965',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/mt-peale/150468',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/utah/mount-peale-trail',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=570056',
        'access_note', 'La Sal Pass Road is unpaved and OSM marks its east approach as four-wheel-drive only. Check current Manti-La Sal National Forest road, trail, fire, and closure rules and use a suitable vehicle.',
        'hazard_note', 'The upper route is steep, partly unmaintained, and crosses loose talus and a south-facing couloir. Snow, rockfall, lightning, heat, wildfire smoke, and route-finding errors can make it hazardous.',
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
