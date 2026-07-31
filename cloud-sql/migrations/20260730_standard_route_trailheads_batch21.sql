-- Add the Tronqueira start for Pico da Bandeira's Alto Caparaó route.
--
-- AllTrails, SummitPost, and a June 2026 Peakbagger track agree on the
-- standard west-side route through Terreirão.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '49927E3C6A1608479E4D',
      'Tronqueira',
      1937.0,
      -20.4096835,
      -41.8375093,
      'BR',
      'MG',
      jsonb_build_object('osm', '13626151256'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/13626151256',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/pico-da-bandeira/153580',
        'route_alltrails_url', 'https://www.alltrails.com/trail/brazil/minas-gerais/pico-da-bandeira',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3219199',
        'access_note', 'Check current Caparaó National Park gate hours, entry rules, camping bookings, and summit departure cutoff. A June 2026 report required a light and departure from Tronqueira by 09:00.',
        'hazard_note', 'The route is rocky and uneven above Terreirão. Cold, rain, fog, darkness, and poor route visibility can make the upper trail hazardous.',
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
