-- Fill the named-summit catalog gap around Silver Peak and Snoqualmie Pass.
--
-- Coordinates and canonical names come from OpenStreetMap natural=peak nodes
-- collected on 2026-07-20. Elevations use the OSM ele tag except for:
--   * Silver Peak: 1709.3 m, cross-checked against the July 12 user track and
--     Peakbagger rather than OSM's clearly-low 1675 m tag.
--   * Bearscout Peak and Scout Patrol Peak: USGS 1 m EPQS samples because the
--     OSM nodes do not have ele tags.
--
-- Point 5870 (OSM node 5772292578) is intentionally excluded: it is only 16 m
-- from the existing Rampart Ridge destination and represents the same summit.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, osm_id, wikidata_id, elevation_source
) AS (
  VALUES
    ('94F527AFAA684D569E0E', 'Abiel Peak',               1635.3, 47.3520516, -121.4692104, '285624652',   'Q49008431', 'osm'),
    ('C2EC22D4A46348CA9CC9', 'Bearscout Peak',           1586.7, 47.3490011, -121.4993438, '4337927697',  NULL,        'usgs_epqs'),
    ('AA8CC3D96D364042BE17', 'Duchess of Kent',          1434.0, 47.3884241, -121.5963665, '3220579164',  NULL,        'osm'),
    ('5DB61B566EC24CFCA5D6', 'Duke of Kent',             1476.0, 47.3850740, -121.6011148, '3220579163',  NULL,        'osm'),
    ('3D9B79D3D0244C78986C', 'Goat Mountain',            1416.0, 47.2836346, -121.5282017, '356545031',   NULL,        'osm'),
    ('49DB5EB2BBB143D48059', 'Guye Peak Middle',         1576.5, 47.4426362, -121.4088470, '9994153172',  NULL,        'osm'),
    ('4A39DAE109164E0EA970', 'Guye Peak North',          1576.6, 47.4429863, -121.4091710, '7695387227',  NULL,        'osm'),
    ('D42951D0CE144C098F2A', 'Humpback Mountain',        1578.0, 47.3732903, -121.4954790, '356545279',   'Q5941232',  'osm'),
    ('E4C8A74DFE3D43EB8B28', 'Little Bandera Mountain', 1573.0, 47.4180103, -121.5478138, '4966195742',  NULL,        'osm'),
    ('0D2D143879224F279E1E', 'Meadow Mountain',          1658.0, 47.2998339, -121.4484280, '349018458',   'Q49049048', 'osm'),
    ('6276C85FE7FA4573A2B0', 'Mount Catherine',          1512.0, 47.3722732, -121.4266522, '348772249',   'Q6920080',  'osm'),
    ('5483B9CBF86644EFA014', 'Mount Gardner',            1345.0, 47.3679393, -121.5690401, '356545002',   NULL,        'osm'),
    ('F5DF9D0DCC0E4A158607', 'Mount Hyak',               1139.0, 47.3831679, -121.4048160, '356545291',   'Q49053150', 'osm'),
    ('4046DE3BF79B48DB893F', 'Scout Patrol Peak',        1406.7, 47.3573511, -121.5214112, '4337927696',  NULL,        'usgs_epqs'),
    ('B28CDEFBF10C45708446', 'Silver Peak',              1709.3, 47.3615424, -121.4612698, '285737343',   'Q49073997', 'user_track_peakbagger'),
    ('A9BAD318B660402FB2D1', 'Snoqualmie Mountain East',1914.6, 47.4587765, -121.4142989, '13011986631', NULL,        'osm'),
    ('1B208FD8E64F40D085D6', 'Snow Dome',                1886.7, 47.4601772, -121.4100365, '13011986630', NULL,        'osm'),
    ('EB7034684A984021994D', 'The Fang',                 1635.0, 47.4470935, -121.4560387, '11986953380', NULL,        'osm'),
    ('DD94D271078A4BBEAF3F', 'Tinkham Peak',             1644.2, 47.3478998, -121.4498235, '285729516',   'Q49083957', 'osm'),
    ('15EC4AB0348C4623BAB6', 'Tinkham West Peak',        1645.3, 47.3492408, -121.4547600, '13011986661', NULL,        'osm')
),
prepared AS (
  SELECT
    id,
    name,
    lower(name) AS search_name,
    elevation,
    ST_SetSRID(ST_MakePoint(lng, lat, elevation), 4326)::geography AS location,
    jsonb_strip_nulls(jsonb_build_object('osm', osm_id, 'wikidata', wikidata_id)) AS external_ids,
    jsonb_build_object(
      'source', 'osm',
      'catalog_audit', 'snoqualmie-pass-2026-07-20',
      'elevation_source', elevation_source
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
