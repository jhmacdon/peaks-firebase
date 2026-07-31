-- Add Pic Boby Base Camp for Imarivolanitra's summit trail.
--
-- AllTrails, Madagascar National Parks, current trekking guidance, and OSM
-- agree on the base-camp start and the single eastern summit path.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'DA84BCB70D20490C1FB6',
      'Pic Boby Base Camp',
      2100.0,
      -22.1800608,
      46.9002570,
      'MG',
      NULL,
      jsonb_build_object('osm_node', '8252165928'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/8252165928',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.alltrails.com/trail/madagascar/haute-matsiatra/camp-de-base-pic-bobby-imarivolanitra',
        'official_access_url', 'https://parcs-madagascar.com/en/parc/andringitra/',
        'current_guide_url', 'https://voyagiste-madagascar.com/andringitra-trekking-pic-boby-2026/',
        'access_note', 'The summit trail starts at Pic Boby Base Camp inside Andringitra National Park. The official park page directs visitors from RN7 to a 47 km track to Namoly and recommends an off-road vehicle, especially in the rainy season. Arrange park entry, camping, porters, and the required Madagascar National Parks guide before the trek; do not enter or climb without current park permission. Confirm fees, road state, fire restrictions, campsite use, guide arrangements, and any closure with the park office.',
        'hazard_note', 'This is a remote high-altitude granite trek with steep rock slabs, scrambling, loose or wet rock, large steps, route-finding risk, little shelter, strong sun, cold wind, rain, fog, and fast weather changes. Carry enough water treatment, food, warm and waterproof layers, sun protection, a headlamp, navigation, first aid, and a turnaround margin. Rock becomes very slick when wet. Follow the park guide, protect fragile vegetation, use only approved camps, and turn around for storms, fire, poor visibility, unsafe rock, illness, or closure.',
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
  ARRAY['trailhead', 'campsite']::destination_feature[],
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
