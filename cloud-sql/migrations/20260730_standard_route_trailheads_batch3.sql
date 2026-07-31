-- Add trailheads for the Galdhøpiggen and Arc Dome standard routes.
--
-- Spiterstulen publishes its elevation and identifies the marked, glacier-free
-- summit trail as the easy Galdhøpiggen route. OpenStreetMap supplies the
-- trailhead point used by the route geometry. SummitPost identifies Columbine
-- Campground as Arc Dome's most popular trailhead and the south-fork trail as
-- its shortest and easiest route.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'EF52874C9D0B345F2AD4',
      'Spiterstulen',
      1111.0,
      61.6258469,
      8.4046306,
      'NO',
      NULL,
      jsonb_build_object('osm', '3804942010'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/3804942010',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_source_url', 'https://spiterstulen.no/en/mountain-hikes/galdhopiggen/',
        'catalog_audit', 'standard-route-goal-2026-07-30'
      )
    ),
    (
      '1E736DA6B08EF71E92C9',
      'Columbine Campground',
      2626.0,
      38.9000864,
      -117.3760942,
      'US',
      'NV',
      jsonb_build_object('osm', '4214036789'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/4214036789',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_source_url', 'https://www.summitpost.org/columbine-campground-th/158820',
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
