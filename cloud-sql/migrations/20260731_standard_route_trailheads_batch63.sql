-- Add Aguiró for the standard south route to Cap de la Pala de Montferri.
--
-- The current public route report and OSM network agree on an Aguiró start,
-- followed by Collada de les Pales and the south ridge to the summit.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '648A2C09ABD6B624DAE6',
      'Aguiró Trailhead',
      1388.0,
      42.3990709,
      0.9440034,
      'ES',
      NULL,
      jsonb_build_object('osm_node', '4880384395'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/4880384395',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://es.wikiloc.com/rutas-senderismo/tossal-de-la-pala-gran-cap-de-la-pala-de-montferri-y-tossal-de-les-tres-muntanyes-desde-aguiro-166649597',
        'visitor_information_url', 'https://www.vallfosca.net/en/discover-la-vall-fosca/presentation/',
        'access_note', 'The route starts on village streets in Aguiró. Park without blocking homes, farm access, or narrow roads. Check current fire restrictions, livestock rules, hunting activity, road condition, and local access notices before planning.',
        'hazard_note', 'This is a steep, exposed mountain route with long unmarked sections across pasture and ridge terrain. Fog, wind, snow, ice, heat, thunderstorms, loose ground, livestock, stream crossings, and navigation error are serious risks. Carry an offline map, enough water, and gear for rapid weather changes.',
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
