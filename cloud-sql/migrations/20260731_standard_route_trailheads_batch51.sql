-- Add Rifugio Sapienza for Etna's standard south-side route.
--
-- AllTrails, SummitPost, Etna Park sources, and OSM agree on the south route
-- from Rifugio Sapienza through Torre del Filosofo to the central craters.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'FD8FCA3DB226F6D0F66F',
      'Rifugio Sapienza',
      1910.0,
      37.699758,
      14.999108,
      'IT',
      'CT',
      jsonb_build_object('osm_way', '244952130'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/244952130',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_alltrails_url', 'https://www.alltrails.com/trail/italy/sicily/rifugio-sapienza-etna-cratere-centrale',
        'route_loop_url', 'https://www.alltrails.com/trail/italy/sicily/rifugio-sapienza-montagnola-crateri-centrali',
        'route_reference_url', 'https://www.summitpost.org/etna-mongibello/151209',
        'park_reference_url', 'https://parcoetna.it/',
        'volcano_reference_url', 'https://www.ct.ingv.it/',
        'access_note', 'Summit access is controlled by changing safety ordinances and may require a licensed guide or stop below the craters. Check Etna Park, local authority, guide, and INGV notices before planning.',
        'hazard_note', 'Etna is a very active volcano. The route crosses exposed, loose volcanic ground and can face eruptions, falling rock, toxic gas, poor visibility, snow, wind, heat, and sudden closures. Follow every closure and guide or authority instruction.',
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
