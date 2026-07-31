-- Add the Rio Chiquito start for Cerro El Pital's standard south route.
--
-- A successful Peakbagger track and the current OSM route start here. The
-- route follows the signed road and footpath from Rio Chiquito to the summit.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '8806E9ABC713551D1D54',
      'Rio Chiquito Trailhead',
      2211.0,
      14.362915,
      -89.123967,
      'SV',
      NULL,
      jsonb_build_object('osm_way', '138891386'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/138891386',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=494013',
        'route_reference_url', 'https://www.alltrails.com/es/ruta/el-salvador/chalatenango/cerro-el-pital-y-piedra-rajada',
        'visitor_brochure_url', 'https://wwflac.awsassets.panda.org/downloads/cerro-el-pital.pdf',
        'access_note', 'The route starts in Rio Chiquito and reaches a border summit shared by El Salvador and Honduras. Check current road condition, parking, entry fee, opening hours, camping, private-land, guide, and border rules before planning. A four-wheel-drive vehicle may be needed on the Rio Chiquito approach.',
        'hazard_note', 'Cold, wind, fog, heavy rain, mud, poor visibility, steep wet trail, falling limbs, dehydration, and delayed rescue are serious risks. The summit area can be crowded and the route crosses working rural roads. Carry rain gear, warm layers, water, and an offline map.',
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
       AND ST_DWithin(d.location, p.location, 250)
     )
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
