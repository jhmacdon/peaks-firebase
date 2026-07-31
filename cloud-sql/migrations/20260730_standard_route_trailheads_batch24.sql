-- Add the Mill Fork start for Deseret Peak's standard route.
--
-- AllTrails, SummitPost, Peakbagger, and OSM agree on the route from
-- Loop Campground up Mill Fork Canyon.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '4E0B25216C65FCDD5727',
      'Mill Fork Trailhead',
      2255.0,
      40.4832322,
      -112.6067787,
      'US',
      'UT',
      jsonb_build_object('osm', '376313192'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/376313192',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/deseret-peak/151580',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/utah/deseret-peak-via-mill-fork-canyon-trail',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2121106',
        'access_note', 'The road to Loop Campground closes seasonally. Check current Forest Service road, parking, camping, fire, and wilderness rules before travel.',
        'hazard_note', 'The route is long and steep, with loose ground below the crest and exposed drops near the summit. Carry enough water after leaving the lower canyon.',
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
