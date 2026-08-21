-- Fill the named-summit catalog gap that held the Adirondack 46ers and the
-- AMC New England 4000-footers out of the 2026-08-18 Peakbagger list import.
--
-- Names, coordinates and OSM node IDs come from OpenStreetMap natural=peak
-- nodes read on 2026-08-21. No coordinate here comes from GNIS.
--
-- Elevations keep the OSM ele tag only where it lands within 3 m of the USGS
-- 3DEP sample (EPQS) at the same point. Most of these nodes carry an old GNIS
-- contour value instead of a summit reading -- Table Top Mountain's tag is 36 m
-- low, North Brother's 27 m, Middle Carter's 23 m -- so those rows take the
-- 3DEP sample, which agrees with the source list to about a metre. Each row
-- names its own source in elevation_source.
--
-- Armstrong Mountain is here for a second reason. Peaks held only the Armstrong
-- Mountain in Okanogan County, Washington, and its elevation sits 45 m from the
-- Adirondack summit's -- inside the importer's window -- so the list row matched
-- a peak 3,460 km away. At the time the importer only reached for its 5 km
-- distance rule when a name matched more than one summit, so a single wrong
-- candidate passed unchallenged. The importer now applies that rule to a lone
-- candidate too; adding the real peak is what makes this row resolve to it.
--
-- East Osceola carries the name the AMC list and every White Mountain guide
-- use. Its OSM node (357729942) is tagged with the bare GNIS label "East Peak",
-- which three other Peaks destinations already answer to; Wikidata Q5329122
-- calls it "East Peak Mount Osceola". The list import maps the source row to it
-- by reviewed destination override.
--
-- The summits the Oregon Top 100 and the Traditional Colorado Centennials need
-- are in two sibling migrations: 20260821_or_co_list_summits.sql for the ones
-- OpenStreetMap has a node for, and 20260821_peakbagger_only_summits.sql for
-- the eight it has never mapped. All three are written up in
-- docs/data-audits/peakbagger-lists-2026-08-21.md.
--
-- Sawteeth's neighboring OSM node "Sawteeth-Southeast Peak" (4299228063) is
-- intentionally excluded: it is a shoulder 400 m away and no reviewed list
-- names it.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, osm_id, wikidata_id, elevation_source, state_code
) AS (
  VALUES
    -- Adirondack High Peaks, New York
    ('47DB7D18FBCF67A80455', 'Armstrong Mountain',     1355.3, 44.1345216, -73.8497765, '357545178',  'Q4793955',  'usgs_epqs', 'NY'),
    ('EA82C6E5AA0BEAE6A10C', 'Table Top Mountain',     1348.1, 44.1403110, -73.9160520, '357592172',  'Q7673183',  'usgs_epqs', 'NY'),
    ('6CA9A6A88A4604B18B48', 'Macomb Mountain',        1342.1, 44.0516916, -73.7802392, '357598246',  'Q6724801',  'usgs_epqs', 'NY'),
    ('67E0ABC002CA4F7F401C', 'Phelps Mountain',        1268.0, 44.1568609, -73.9214754, '357576773',  'Q7181274',  'osm',       'NY'),
    ('5F7C2E77213C244B0E77', 'Seymour Mountain',       1255.6, 44.1577382, -74.1726001, '357589061',  'Q8525969',  'usgs_epqs', 'NY'),
    ('DDD9EBF3033CE9313C8E', 'Sawteeth',               1254.0, 44.1145097, -73.8502961, '4299228062', 'Q7428687',  'usgs_epqs', 'NY'),
    ('F0A5EB8B0D31DB704FBC', 'South Dix',              1247.8, 44.0599388, -73.7743571, '357590152',  'Q7567063',  'usgs_epqs', 'NY'),
    -- White Mountains, New Hampshire
    ('E217CB2023A0DD96EC79', 'North Twin Mountain',    1452.0, 44.2025463, -71.5579926, '357730481',  'Q7057046',  'osm',       'NH'),
    ('C62038E3D096AEFB339A', 'Middle Carter Mountain', 1407.1, 44.3030843, -71.1677083, '357730372',  'Q6841258',  'usgs_epqs', 'NH'),
    ('469F94DE0FD6F448A8B8', 'West Bond',              1376.8, 44.1547633, -71.5436295, '1348521471', 'Q34819378', 'usgs_epqs', 'NH'),
    ('232161650C0362EE0320', 'South Carter Mountain',  1350.9, 44.2898743, -71.1764248, '357730765',  'Q7566729',  'usgs_epqs', 'NH'),
    ('368689EB272E602EC570', 'Bondcliff',              1300.0, 44.1405773, -71.5409195, '357730899',  'Q34823632', 'osm',       'NH'),
    ('B2B88E2AC6A9AAD6E1C6', 'East Osceola',           1268.1, 44.0061049, -71.5205850, '357729942',  'Q5329122',  'usgs_epqs', 'NH'),
    ('93EE00C6340E74D46878', 'North Tripyramid',       1267.5, 43.9731614, -71.4427785, '1331580889', 'Q34927986', 'usgs_epqs', 'NH'),
    ('1D324DD26E5E0963B262', 'Middle Tripyramid',      1253.1, 43.9645703, -71.4400737, '1331579182', 'Q34927972', 'usgs_epqs', 'NH'),
    ('AD0E5B58E4B45CAB6983', 'Wildcat D',              1238.0, 44.2494119, -71.2235895, '5550578026', 'Q34821002', 'osm',       'NH'),
    -- Maine
    ('5F257FA3B1CD777E0962', 'North Brother',          1262.0, 45.9571925, -68.9853976, '358222401',  'Q7054307',  'usgs_epqs', 'ME'),
    ('B5ADD28562C58FAD2C29', 'Avery Peak',             1243.4, 45.1467679, -70.2760958, '358222318',  NULL,        'usgs_epqs', 'ME'),
    ('B3276E06C7065A5B6DAA', 'South Crocker Mountain', 1228.0, 45.0361665, -70.3764565, '358227076',  'Q7566924',  'osm',       'ME')
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
