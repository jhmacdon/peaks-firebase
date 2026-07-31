-- Add the mapped west-slope base-camp route start for Marmolejo.
--
-- Peakbagger, SummitPost, and OSM agree on the northwest ridge and glacier
-- route from base camp as the standard Chilean ascent.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '42D2AE5216434133E5BF',
      'Marmolejo West Slope Route Start',
      3395.0,
      -33.7395612,
      -69.9639815,
      'CL',
      'RM',
      jsonb_build_object('osm_way', '48706064'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/48706064',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=1872773',
        'route_reference_url', 'https://www.summitpost.org/cerro-marmolejo/982312',
        'border_reference_url', 'https://www.difrol.cl/',
        'access_note', 'This point starts the mapped summit route at remote base camp; the long El Morro approach is not part of this track. The Chilean border area may require advance DIFROL or border permits. Verify current access, river crossings, transport, and permit rules before planning.',
        'hazard_note', 'Marmolejo is a remote, multi-day 6,000-metre expedition. The route crosses steep loose ground and a crevassed glacier with penitentes, and faces severe altitude, cold, wind, storms, falls, and limited rescue. The El Morro approach also has serious river crossings. Teams need glacier, rope, rescue, navigation, and expedition skills.',
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
