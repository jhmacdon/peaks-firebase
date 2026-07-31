-- Add trailheads for the Haleakalā and Mount Arvon standard summit walks.
--
-- The National Park Service identifies Puʻuʻulaʻula as Haleakalā's highest
-- point and describes paved and unpaved paths from its parking area. Michigan
-- tourism and Baraga County identify the signed public access to Mount Arvon;
-- OpenStreetMap supplies its summit parking point and footpath geometry.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '16A5041A156C538CEEB6',
      'Haleakalā Summit Parking',
      3047.0,
      20.71007,
      -156.25295,
      'US',
      'HI',
      jsonb_build_object('osm', '241071112'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/241071112',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_source_url', 'https://www.nps.gov/places/puuulaula.htm',
        'catalog_audit', 'standard-route-goal-2026-07-30'
      )
    ),
    (
      '35CC2D02AAC7D0193EA4',
      'Mount Arvon Summit Parking',
      600.0,
      46.7559732,
      -88.1545601,
      'US',
      'MI',
      jsonb_build_object('osm', '10091199184'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/10091199184',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_source_url', 'https://www.michigan.org/property/mount-arvon',
        'route_directions_url', 'https://www.baragacountytourism.org/mt_arvon',
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
