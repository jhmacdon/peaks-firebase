-- Add the Timpooneke start for Mount Timpanogos's standard route.
--
-- AllTrails, SummitPost, Peakbagger, and OSM agree on the Timpooneke
-- Trail from the campground-area parking lot to the summit.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '79A77B72222615113F64',
      'Timpooneke Trailhead',
      2243.0,
      40.4315007,
      -111.6387683,
      'US',
      'UT',
      jsonb_build_object('osm', '18461861'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/relation/18461861',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/timpooneke-trail/162184',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/utah/mt-timpanogos-timpooneke-trail',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=1226490',
        'access_note', 'A recreation fee applies and the lot often fills before dawn on summer weekends. Check current Alpine Loop, parking, campground, and trail rules before travel.',
        'hazard_note', 'The route is long and exposed above the basin. Lingering snow, ice, strong wind, lightning, rockfall, and steep terrain can make the summit section hazardous.',
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
