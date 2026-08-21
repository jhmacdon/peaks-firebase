-- Named summits the Catskill 3500 and the AMC New England Hundred Highest need.
--
-- Nine Catskill peaks and eight New England peaks below 4,000 feet. The New
-- Hampshire 4000-footers and the Northeast 111 need no new rows at all: every
-- peak on them already reached Peaks through the New England 4000-footers, the
-- Adirondack 46ers, or the two Catskill 4,000-footers the catalog already held.
--
-- Names, coordinates and OSM node IDs come from OpenStreetMap natural=peak
-- nodes read on 2026-08-21. No coordinate here comes from GNIS.
--
-- Elevations keep the OSM ele tag only where it lands within 3 m of the USGS
-- 3DEP reading at the summit. Twelve of these tags agree with 3DEP to better
-- than 2.2 m and are kept. The other five nodes sit 25 to 66 m off the high
-- point, so a sample at the node itself reads low; a 3DEP summit search around
-- each -- an 80 m grid at 20 m, refined to 2.5 m -- found the top, and three of
-- the five take that reading because their tag is 4.9 to 9.4 m from it. Each row
-- names its own source in elevation_source.
--
-- CORRECTION: that test was not sufficient, and The Bulge below is wrong here.
-- A node sitting off the high point reads low in 3DEP and so agrees with its
-- own low tag; nothing in the rule catches that. The Bulge passed on a 0.27 m
-- agreement at the node and went in at 1197.0, about 5.5 m under both
-- Peakbagger and the AMC. 20260821_the_bulge_elevation.sql runs the summit
-- search that was skipped and corrects the row to 1202.4 m, usgs_3dep. The
-- other sixteen were re-checked against the published figure -- the test that
-- catches this -- and none is more than 2.87 m out.
--
-- Two names differ from the source list on purpose.
--
-- South Weeks Mountain carries the OSM name; the AMC list calls it South Weeks
-- and Peakbagger calls it "Mount Weeks - South Peak". The list import reaches it
-- by reviewed destination override.
--
-- South Horn is the name the AMC Hundred Highest uses ("Bigelow, South Horn")
-- for the higher of the two Horns on the Bigelow Range. Its OSM node (358225015)
-- carries the bare label "South Peak", which says nothing outside its own ridge;
-- Peakbagger files the same summit under "The Horns" and names South Peak as
-- that peak's highest summit. The neighboring nodes 4962752666 ("The Horns",
-- no ele, 198 m away) and 4962752665 ("North Peak", 318 m) are deliberately
-- left out: the first is the pair, the second is the lower Horn, and no reviewed
-- list counts either.
--
-- Written up in docs/data-audits/peakbagger-lists-2026-08-21.md.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, osm_id, wikidata_id, elevation_source, state_code
) AS (
  VALUES
    -- Catskill 3500 Club list, New York
    ('4123E39EFF3190DA07C3', 'West Kill Mountain',      1188.1, 42.1678663, -74.2895904, '357598566',  'Q7985627',  'osm',       'NY'),
    ('36A7C2A1CCC68126FE96', 'Table Mountain',          1165.9, 41.9586420, -74.4048687, '357598560',  'Q7673141',  'osm',       'NY'),
    ('2BFAF1A75BBF71610BB9', 'Sugarloaf Mountain',      1153.1, 42.1312006, -74.1501414, '357591726',  'Q7635011',  'osm',       'NY'),
    ('553A3546DB177574CFEF', 'Wittenberg Mountain',     1152.8, 42.0081538, -74.3473743, '357597623',  'Q8028568',  'osm',       'NY'),
    ('B41C26772B1321CB4747', 'Rusk Mountain',           1123.5, 42.2010686, -74.2774576, '357583239',  'Q7380934',  'osm',       'NY'),
    ('E2AF33A832B6DC6989DE', 'Twin Mountain',           1112.5, 42.1256453, -74.1290294, '357593720',  'Q7858235',  'osm',       'NY'),
    ('F8F7B2DA5D3DBC90F604', 'North Dome',              1098.8, 42.1737313, -74.3490128, '357574030',  'Q8526324',  'osm',       'NY'),
    ('7A1DBCB279C600544EDA', 'Bearpen Mountain',        1093.3, 42.2652179, -74.4737802, '2948777248', NULL,        'osm',       'NY'),
    ('42FD6457E5DCF9A3F2C9', 'Rocky Mountain',          1062.8, 41.9726556, -74.3728273, '357582635',  'Q7355865',  'osm',       'NY'),
    -- AMC New England Hundred Highest, below 4,000 feet
    ('3E103CDD05D9C96F75FD', 'South Brother',           1208.0, 45.9442120, -69.0017136, '358224250',  'Q7566435',  'osm',       'ME'),
    ('F53AFB8FCDE606A00F19', 'The Bulge',               1197.0, 44.5145056, -71.4083103, '357728179',  'Q7720540',  'osm',       'NH'),
    ('AE765CE84B3DEB31202D', 'South Weeks Mountain',    1183.0, 44.4423379, -71.3882565, '3300692064', 'Q7568819',  'osm',       'NH'),
    ('7E1BD8E177EB9847714E', 'East Sleeper',            1177.8, 43.9464284, -71.4254055, '5512465463', NULL,        'usgs_3dep', 'NH'),
    ('4F40209BA391769E66F6', 'Vose Spur',               1172.1, 44.1029102, -71.4344996, '5257503351', NULL,        'usgs_3dep', 'NH'),
    ('659BDAFD297FB04683EA', 'East Kennebago Mountain', 1162.4, 45.1214425, -70.6003456, '358219329',  'Q5328694',  'usgs_3dep', 'ME'),
    ('14FB5A19E9EED147F063', 'South Horn',              1159.0, 45.1449019, -70.3231224, '358225015',  NULL,        'osm',       'ME'),
    ('2F1D9BDF54CF9AFCD2A6', 'Mount Wilson',            1147.0, 44.0047846, -72.9259462, '356555348',  'Q6924626',  'osm',       'VT')
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
