-- Add Washington summits proven missing by recorded-session coverage analysis.
--
-- Coordinates and names come from OSM natural=peak nodes. Aggregate production
-- track evidence collected on 2026-07-20 independently confirms the placement:
--   * Pinnacle Peak: 17 ended sessions pass within 30 m (closest point 1.1 m).
--   * Dirtyface Mountain-East: 2 ended sessions pass within 30 m (1.8 m).
-- No existing destination of any feature type was present within 1 km of either
-- reference point. Pinnacle's elevation uses the USGS 1 m EPQS sample because
-- it is more consistent with the recorded track than OSM's 536 m tag.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, osm_id, elevation_source, sessions_within_30m
) AS (
  VALUES
    (
      '6D2B1FAFF3D54E3C9063', 'Pinnacle Peak', 549.7,
      47.1737055, -121.9734123, '349018541', 'usgs_epqs', 17
    ),
    (
      '7126665C05AF42898883', 'Dirtyface Mountain-East', 1825.5,
      47.8557129, -120.7993650, '9196640751', 'osm', 2
    )
),
prepared AS (
  SELECT
    id,
    name,
    lower(name) AS search_name,
    elevation,
    ST_SetSRID(ST_MakePoint(lng, lat, elevation), 4326)::geography AS location,
    jsonb_build_object('osm', osm_id) AS external_ids,
    jsonb_build_object(
      'source', 'osm',
      'catalog_audit', 'track-proven-wa-2026-07-20',
      'elevation_source', elevation_source,
      'sessions_within_30m_at_audit', sessions_within_30m
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
  ARRAY['summit']::destination_feature[],
  'peaks',
  'US',
  'WA',
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
       AND ST_DWithin(d.location, p.location, 500)
     )
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
