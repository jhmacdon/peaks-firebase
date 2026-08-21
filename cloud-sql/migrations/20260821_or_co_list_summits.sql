-- Named summits the Oregon Top 100 and the Traditional Colorado Centennials
-- need, where OpenStreetMap has a node for the peak.
--
-- Names, coordinates and OSM node IDs come from OpenStreetMap natural=peak
-- nodes read on 2026-08-21. No coordinate here comes from GNIS.
--
-- Each of these five rows is a peak the source list labels differently -- three
-- of them as "Peak <elevation>" or as a drainage divide -- so the list import
-- reaches them by reviewed destination override rather than by name. Identity
-- was settled by terrain, not by name: a USGS 3DEP summit search around each
-- source point landed within 2 to 17 m of the OSM node in every case, and the
-- elevation it read there matches the source list to better than half a metre.
--
-- Elevations keep the OSM ele tag only where it lands within 3 m of the 3DEP
-- reading at the summit. Three of these tags are 3 to 18 m low, so those rows
-- take the 3DEP value. Each row names its own source in elevation_source.
--
-- The eight summits on these two lists that OpenStreetMap has no node for are
-- in 20260821_peakbagger_only_summits.sql.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, osm_id, elevation_source, state_code
) AS (
  VALUES
    -- Oregon Top 100
    ('8FD5348C68B1BB2A4E8C', 'Kiger-Mann Peak',          2850.2, 42.7336575, -118.5432941, '6601323053',   'usgs_3dep',  'OR'),
    ('C4DF226B7B4BA1CF5315', 'West Aneroid Peak',        2801.6, 45.2162123, -117.2122151, '9104370897',   'usgs_3dep',  'OR'),
    ('F1089B73B1AD23752890', 'Snowfield Peak',           2732.0, 45.1065669, -117.4252446, '10074433560',  'usgs_3dep',  'OR'),
    ('CDB36D592A99DE762C47', 'Moccasin Lake Mountain',   2573.0, 45.1904279, -117.3132381, '9104420504',   'osm',        'OR'),
    -- Traditional Colorado Centennials. Mark Mountain is UN 13,838, the peak
    -- the source list calls Redcloud Peak - Northeast Peak.
    ('E1DEC037ADBE7648F7B2', 'Mark Mountain',            4217.8, 37.9470685, -107.3983289, '13926474089',  'osm',        'CO')
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
      'catalog_audit', 'peakbagger-lists-2026-08-21',
      'elevation_source', elevation_source
    ) AS metadata,
    osm_id,
    state_code
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
  p.state_code,
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
