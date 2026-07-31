-- Add the Colorado trailheads needed to replace five incomplete standard-route
-- fragments with full trailhead-to-summit routes.
--
-- OpenStreetMap nodes are the coordinate source. The linked 14ers.com pages
-- confirm the trailhead name, elevation, and use for the accepted standard
-- route. Each OSM point lies within 26 m of the 14ers.com trailhead coordinate.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, osm_id, osm_way_id,
  route_source_url, coordinate_offset_m
) AS (
  VALUES
    (
      'ABC87105223BE0290DE0',
      'Fourmile Creek Trailhead',
      3657.6,
      39.2057968,
      -106.1623453,
      '1454337088',
      '132153942',
      'https://www.14ers.com/php14ers/trailheadsview.php?thparm=mr05',
      13.6
    ),
    (
      '7320611F1D58B7CF23C8',
      'Stewart Creek Trailhead',
      3200.4,
      38.0247920,
      -106.8413900,
      '178056138',
      '17142087',
      'https://www.14ers.com/php14ers/trailheadsview.php?thparm=sj15',
      25.1
    ),
    (
      '6FA871F2C3930D12AF08',
      'Matterhorn Creek Trailhead',
      3291.8,
      38.0306545,
      -107.4912806,
      '3871139260',
      '383797267',
      'https://www.14ers.com/php14ers/trailheadsview.php?thparm=sj02',
      4.0
    )
),
prepared AS (
  SELECT
    id,
    name,
    lower(name) AS search_name,
    elevation,
    ST_SetSRID(ST_MakePoint(lng, lat, elevation), 4326)::geography AS location,
    jsonb_build_object(
      'osm', osm_id,
      '14ers_trailhead', substring(route_source_url from 'thparm=([^&]+)')
    ) AS external_ids,
    jsonb_build_object(
      'source', 'openstreetmap',
      'source_url', 'https://www.openstreetmap.org/node/' || osm_id,
      'source_way_url', 'https://www.openstreetmap.org/way/' || osm_way_id,
      'source_license', 'ODbL 1.0',
      'source_attribution', '© OpenStreetMap contributors',
      'route_source_url', route_source_url,
      'route_source_coordinate_offset_m', coordinate_offset_m,
      'catalog_audit', 'standard-route-goal-2026-07-30'
    ) AS metadata,
    osm_id
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
  'US',
  'CO',
  p.external_ids,
  p.metadata,
  now(),
  now()
FROM prepared p
WHERE NOT EXISTS (
  SELECT 1
  FROM destinations d
  WHERE d.external_ids @> jsonb_build_object('osm', p.osm_id)
     OR (
       d.search_name = p.search_name
       AND d.location IS NOT NULL
       AND ST_DWithin(d.location, p.location, 150)
     )
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
