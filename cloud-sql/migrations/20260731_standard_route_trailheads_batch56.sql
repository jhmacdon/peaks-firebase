-- Add Camp 2 for Bazardüzü's standard Azerbaijan south-ridge route.
--
-- SummitPost, local guide sources, and OSM agree on the Camp 2 summit line.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'B0A9F84A795CC32DC321',
      'Bazardüzü Camp 2',
      3250.0,
      41.195714,
      47.885309,
      'AZ',
      NULL,
      jsonb_build_object('osm_way', '180751599'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/180751599',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.summitpost.org/standard-route-to-mount-bazarduzu-from-khinalig-azerbaijan/1098971',
        'route_reference_url', 'https://www.summitpost.org/bazard-z/973069',
        'guide_reference_url', 'https://mountainguide.az/en/blog/576-bazarduzu-the-best-climbing-guide.html',
        'access_note', 'This track starts at Camp 2 after the Khinalig and Shahyaylag approach. Bazardüzü lies on an international border. A border permit, passport registration, park access, local logistics, and a 4x4 transfer may be required well in advance. Confirm the current rules and route before planning.',
        'hazard_note', 'The south-ridge route is remote and high altitude, with loose rock, steep alpine ground, sudden storms, cold, wind, snow or ice, falls, and limited rescue. It reaches an international border. Teams need sound navigation, acclimatization, mountain judgment, and seasonal snow or ice skills.',
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
