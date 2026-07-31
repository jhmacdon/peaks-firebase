-- Add the current roadside start for Aucanquilcha's north-face mine route.
--
-- The 2026 Peakbagger track starts here after the old road is blocked. The
-- normal route follows the former sulfur-mine road and cableway toward the top.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'C7CAD64B8DA6FEE13EA1',
      'Aucanquilcha North Road Trailhead',
      5121.0,
      -21.19356,
      -68.45543,
      'CL',
      'AN',
      jsonb_build_object('osm_way', '307137739'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/307137739',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3101617',
        'route_reference_url', 'https://www.andeshandbook.org/montanismo/ruta/1191/normal_por_azufrera',
        'access_report_url', 'https://www.14ers.com/php14ers/tripreport.php?trip=23370',
        'access_note', 'The former mine road has landslides, rough rock crawls, and changing drive limits. A January 2026 party parked here after a road blockage. Check the current approach from Ollagüe, vehicle limits, Alto Loa reserve rules, local registration, border-area rules, and guide needs before planning.',
        'hazard_note', 'This is a remote 6,000-meter volcanic climb. Extreme altitude, wind, cold, snow or ice, loose sulfur and rock, unstable abandoned mine works, road collapse, navigation error, toxic fumes, lack of water, and long rescue times can be fatal. Acclimatize and use a qualified local guide and suitable high-altitude gear.',
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
