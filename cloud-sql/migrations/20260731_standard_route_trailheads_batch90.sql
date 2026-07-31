-- Add the Kg Jelai trailhead for the current Ulu Cheka route to Gunung Benom.
--
-- The shorter Lata Berembun route has been closed since a 2020 landslide.
-- OSM, Gunung Bagging, and the federal forestry permit list support this
-- east-side approach.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '0D0643A58F72A3F4E5EF',
      'Gunung Benom (Kg Jelai Trailhead)',
      216.0,
      3.8618916,
      102.1893699,
      'MY',
      NULL,
      jsonb_build_object('osm_node', '12839129969'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/12839129969',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'official_access_url', 'https://www.forestry.gov.my/en/2016-06-07-02-31-39/2016-06-07-02-35-17/amenity-forests-state-park-forests',
        'official_permit_url', 'https://forestry.pahang.gov.my/e-ecopark/',
        'route_reference_url', 'https://www.gunungbagging.com/benum/',
        'access_note', 'Use the current east-side Ulu Cheka / Kg Jelai route. The shorter Lata Berembun route has had no official hikes since a landslide closed its access road in 2020. Arrange the required local guide, four-wheel-drive transfers, and Pahang forest entry permit before travel. The federal forestry list places the Gunung Benom approach under PHD Jerantut, and local route guidance requires hikers to report to the forestry office south of Ulu Cheka before starting. Confirm the route, trip length, bag check, guide rules, permit, pickup points, and river conditions with the forestry office and guide. Do not use the closed western route or enter without approval.',
        'hazard_note', 'This is a remote three- to five-day jungle crossing, not the former short route. The climb has leeches, deep mud, steep roots, ropes, boulders, holes, long ridge stages, and several difficult river crossings on the descent. Heavy rain can make the final rivers impassable and force an extra night. Natural water is limited high on the route; tanks at Gunung Lilin and Permatang Angin must be treated. Carry full camping and emergency gear, start each stage early, and allow spare food and time for flood delays and a late four-wheel-drive pickup.',
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
