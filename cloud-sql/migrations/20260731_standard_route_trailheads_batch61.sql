-- Add Villa Verde for the standard Cerro Las Minas / Pico Celaque route.
--
-- AllTrails, Peakbagger, the park trail plan, and the current OSM network
-- agree on the route through the Celaque visitor area to Honduras's summit.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'D84E4BDE2C2221FC54F6',
      'Villa Verde Trailhead',
      1213.0,
      14.564614,
      -88.628758,
      'HN',
      'LE',
      jsonb_build_object('osm_way', '396332432'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/396332432',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=494014',
        'route_reference_url', 'https://www.alltrails.com/trail/honduras/lempira/cerro-las-minas',
        'park_plan_url', 'https://fondohondurasespana.bcie.org/fileadmin/fhe/espanol/archivos/publicaciones/Turismo/2_Plan_de_Senderos_PNMC.pdf',
        'access_note', 'The route enters Celaque National Park and passes its visitor area. Check current park hours, entry fee, registration, guide, camping, road, parking, and trail rules before planning. The summit is often done as a long day or an overnight trip.',
        'hazard_note', 'This is a long, steep tropical mountain route. Heat, humidity, heavy rain, slippery mud, river crossings, falling limbs, poor visibility, exposure, getting lost, dehydration, contaminated water, insects, wildlife, and delayed rescue are serious risks. Start early and carry a filter and enough food, water, and rain gear.',
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
