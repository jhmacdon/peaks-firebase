-- Add reviewed primary summits from the Mount Baker/North Cascades and
-- South Cascades/Goat Rocks catalog coverage audits.
--
-- Coordinates, canonical names, elevations, OSM IDs, and Wikidata IDs come
-- from current OSM natural=peak nodes collected on 2026-07-21. The production
-- catalog was checked for external-ID matches, same-name nearby matches, and
-- destinations within 1 km before this migration was authored.
--
-- Likely aliases and subpeaks identified by the audit are intentionally
-- excluded. These include McGregor Mountain-West Peak, West Unicorn Peak,
-- Sluiskin Mountain, Tokaloo Spire, Central Cowlitz Chimney, East Fay Peak,
-- and Mount Teragram.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, osm_id, wikidata_id, audit_region
) AS (
  VALUES
    -- Mount Baker / North Cascades
    ('1900F257097B2D0C50DC', 'Mount Sefrit',          2192.0, 48.8919985, -121.5940976, '349028412', 'Q49054523', 'mount-baker-north-cascades'),
    ('A9593AA72F1138F9E538', 'Icy Peak',              2141.0, 48.8364055, -121.5281140, '356545294', 'Q49038248', 'mount-baker-north-cascades'),
    ('B304E3BDB251F6FA0A46', 'Sourdough Mountain',    1863.0, 48.7520734, -121.1281780, '349028454', 'Q17349508', 'mount-baker-north-cascades'),
    ('AA84A8FB4EFDB503A66B', 'Table Mountain',        1750.2, 48.8479350, -121.7139005, '356546681', 'Q49080911', 'mount-baker-north-cascades'),
    ('3620CAE1DE3213629A01', 'Mount Larrabee',        2396.0, 48.9792206, -121.6482486, '349028425', 'Q30622670', 'mount-baker-north-cascades'),
    ('CE5795758891A0A9B2C5', 'Whatcom Peak',          2310.079,48.8576357, -121.3735490, '356546936', 'Q14713941', 'mount-baker-north-cascades'),
    ('39E6F344E377A5B101F1', 'Colonial Peak',         2348.0, 48.6615166, -121.1212310, '349028379', 'Q5148356',  'mount-baker-north-cascades'),
    ('17023AA3E0B411D6639F', 'Hinkhouse Peak',        2303.0, 48.5374412, -120.6563139, '356550199', 'Q49036567', 'mount-baker-north-cascades'),
    ('637633E59ECAB836100F', 'Magic Mountain',        2298.0, 48.4456373, -121.0411325, '348974864', 'Q49047417', 'mount-baker-north-cascades'),
    ('FC7148FAFE6960E06C04', 'Trapper Mountain',      2296.0, 48.4317935, -121.0181650, '348973959', 'Q49084642', 'mount-baker-north-cascades'),
    ('C50B3609E8A58BB4F8F0', 'Mount Misch',           2266.0, 48.3436974, -121.2004622, '349003233', 'Q49053639', 'mount-baker-north-cascades'),
    ('306B05A78A03FE23E11D', 'Mount Higgins',         1535.0, 48.3145529, -121.7623560, '349003322', 'Q49053018', 'mount-baker-north-cascades'),

    -- South Cascades / Goat Rocks
    ('90B5C0F8EE53C7983E97', 'Tieton Peak',            2367.7, 46.5121898, -121.3951527, '356546773', 'Q49083683', 'south-cascades-goat-rocks'),
    ('A5175DAC6CFC2F7E475F', 'Johnson Peak',           2282.0, 46.5389106, -121.5015275, '348190271', 'Q49040102', 'south-cascades-goat-rocks'),
    ('8C37AB7C9E7607E25493', 'Bear Creek Mountain',    2236.3, 46.5277815, -121.3449391, '356544251', 'Q49011291', 'south-cascades-goat-rocks'),
    ('A874F9C18612142E190C', 'Nelson Butte',           2160.0, 46.8237264, -121.2045280, '356545943', 'Q49056705', 'south-cascades-goat-rocks'),
    ('BC28AD85F912A921CA26', 'Devils Horn',            2125.0, 46.5179587, -121.3654975, '356544742', 'Q49024504', 'south-cascades-goat-rocks'),
    ('B67DC579F5DDBF31AD4E', 'Darland Mountain',       2122.0, 46.5134039, -121.2095552, '356544714', 'Q49023620', 'south-cascades-goat-rocks'),
    ('7C2624B9B96F187533A9', 'Rattlesnake Peaks',      2087.9, 46.7522584, -121.2486316, '356546212', 'Q49066896', 'south-cascades-goat-rocks'),
    ('3BB52B238882AC74E14C', 'Shellrock Peak',         2083.3, 46.7090055, -121.2326847, '356546404', 'Q49073181', 'south-cascades-goat-rocks'),
    ('C1787AF807245041FFA7', 'Chimney Rock',           2045.0, 46.5695592, -121.4792510, '356544562', 'Q49020323', 'south-cascades-goat-rocks'),
    ('430BEEBA48D5504F8690', 'McNeil Peak',            2029.4, 46.6977932, -121.2746575, '356545816', 'Q49048979', 'south-cascades-goat-rocks'),
    ('624B0D39DF066202F74C', 'Nannie Peak',            1866.0, 46.4352931, -121.4488766, '6734594141','Q49056366', 'south-cascades-goat-rocks'),
    ('B068DEE08B0F3AB226F0', 'Angry Mountain',         1843.0, 46.5235745, -121.5541125, '356544099', 'Q49008816', 'south-cascades-goat-rocks')
),
prepared AS (
  SELECT
    id,
    name,
    lower(name) AS search_name,
    elevation,
    ST_SetSRID(ST_MakePoint(lng, lat, elevation), 4326)::geography AS location,
    jsonb_build_object('osm', osm_id, 'wikidata', wikidata_id) AS external_ids,
    jsonb_build_object(
      'source', 'osm',
      'catalog_audit', 'regional-cascades-2026-07-21',
      'audit_region', audit_region,
      'elevation_source', 'osm'
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
