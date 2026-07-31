-- Add the upper Los Linderos road start for Cerro Champaquí.
--
-- AllTrails, Peakbagger, Córdoba Turismo, and OSM describe the short summit
-- walk from the end of the Los Linderos road.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '2C4E1587D9F0A3B6C821',
      'Los Linderos Trailhead',
      2767.0,
      -31.993893,
      -64.938790,
      'AR',
      'X',
      jsonb_build_object('osm_way', '311485352'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/311485352',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_alltrails_url', 'https://www.alltrails.com/trail/argentina/cordoba--2/cerro-champaqui-via-cerro-los-linderos',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2739836',
        'official_access_url', 'https://cordobaturismo.gov.ar/experiencias/senderos-al-cerro-champaqui/',
        'access_note', 'The long gravel road from Villa Yacanto can be rough or closed. Check current provincial road, weather, fire, registration, and authorized-guide rules before travel; use a capable vehicle and park only in the signed Los Linderos area.',
        'hazard_note', 'The short walk still crosses exposed high ground and rough rock. Fog, strong wind, lightning, sudden cold, snow or ice, loose footing, road trouble, and delayed rescue can make it hazardous.',
        'catalog_audit', 'standard-route-goal-2026-07-31'
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
