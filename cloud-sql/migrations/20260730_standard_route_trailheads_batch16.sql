-- Add the exact Horcones start for Aconcagua's Normal Route.
--
-- AllTrails, SummitPost, and two independent Peakbagger tracks agree on the
-- Horcones approach through Confluencia and Plaza de Mulas. The point below
-- is the first OpenStreetMap node on that route at the park entrance.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'C5A6710FC6BA42003B7E',
      'Horcones Entrance Trailhead',
      2950.0,
      -32.8235930,
      -69.9423552,
      'AR',
      'M',
      jsonb_build_object('osm', '7300319056'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/7300319056',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_source_url', 'https://www.alltrails.com/trail/argentina/mendoza/cerro-aconcagua-sendero-largo',
        'route_reference_url', 'https://www.summitpost.org/aconcagua/150197',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=162523',
        'route_access_url', 'https://www.mendoza.gov.ar/aconcagua/',
        'route_permit_url', 'https://actividadesanp.mendoza.gov.ar/anp/dashboard',
        'permit_note', 'A park ascent permit is required. Check the current season, entry dates, and operating rules before travel.',
        'hazard_note', 'This is a high-altitude expedition. Snow, ice, severe wind, extreme cold, rockfall, and acute mountain sickness can make the Normal Route fatal.',
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
