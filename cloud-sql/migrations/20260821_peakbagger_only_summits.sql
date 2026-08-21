-- The eight summits on the Oregon Top 100 and the Traditional Colorado
-- Centennials that OpenStreetMap has never mapped.
--
-- Seven of the eight carry no name of their own: three are bare elevation
-- labels, two name the drainages either side of a divide, and two name a
-- subsidiary summit of a named peak. OSM has no node for any of them, so they
-- enter the catalog with Peakbagger provenance instead:
--
--   id           sha256('peakbagger:peak:<peakbaggerPeakId>') hex[0..20], upper
--                -- a separate scheme from the osm:node ids, so the two cannot
--                collide
--   external_ids {"peakbagger": "<peakbaggerPeakId>"}
--   source       'peakbagger'
--
-- GNIS is not used here, for coordinates or for anything else.
--
-- COORDINATES -- a deliberate departure, and the reason for it. The Peakbagger
-- export's own coordinates are map-tile quantised at zoom 7: every longitude in
-- it is an exact multiple of 0.010986328125 degrees, about 860 m on the ground
-- at this latitude. Sampling USGS 3DEP at those coordinates reads 48 to 165 m
-- BELOW the published summit elevation, because each one lands on a slope
-- rather than on the summit. Storing them would put every row here up to 830 m
-- from its peak, at an elevation that is plainly wrong.
--
-- So each coordinate below is the summit itself, found in USGS 3DEP terrain:
-- sample a 25x25 grid over the ~1 km quantisation box, take every local
-- maximum, refine each to about 1.5 m, and keep the one whose elevation matches
-- the published figure. That match is the evidence the right summit was found —
-- it lands within 0.6 m on all eight rows, and within 0.1 m on five of them —
-- and both readings are recorded per row below. 3DEP is public-domain USGS
-- elevation data, and the source of the elevations in the sibling migration.
--
-- Every row is a candidate for a future OpenStreetMap contribution.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, peakbagger_id, state_code
) AS (
  VALUES
    -- Oregon Top 100. Peakbagger's published elevation follows each row; the
    -- stored value is the 3DEP reading at the coordinate on that row.
    -- absent from OSM as of 2026-08-21; candidate for future OSM contribution
    ('D991BD28B0984496C778', 'Peak 8710',                          2654.9, 45.1051506, -117.3339462, '59650',  'OR'),  -- Peakbagger 2654.8 m
    -- absent from OSM as of 2026-08-21; candidate for future OSM contribution
    ('F667DB0DA84440E25AD9', 'Jackson Peak - South',               2590.3, 45.1188826, -117.2794728, '34058',  'OR'),  -- Peakbagger 2590.3 m
    -- absent from OSM as of 2026-08-21; candidate for future OSM contribution
    ('0EF3D99D4FFBAB2A99BA', 'Graham Mountain - West Peak',        2586.1, 44.2960174, -118.6485237, '3230',   'OR'),  -- Peakbagger 2586.1 m
    -- absent from OSM as of 2026-08-21; candidate for future OSM contribution.
    -- An untagged OSM node sits 40 m away (7711935638) with no name and no ele.
    ('BC40E8BF1702AA33E084', 'Peak 8441',                          2572.6, 44.9173329, -118.2066090, '28144',  'OR'),  -- Peakbagger 2572.8 m
    -- absent from OSM as of 2026-08-21; candidate for future OSM contribution
    ('B80EBAE0043CC5763179', 'North Minam Creek-Bear Creek',       2548.4, 45.2925771, -117.4842738, '3154',   'OR'),  -- Peakbagger 2548.4 m
    -- absent from OSM as of 2026-08-21; candidate for future OSM contribution
    ('EC81E29D4AC1C301A4A9', 'Peak 8098',                          2467.6, 45.3132212, -117.4312731, '59646',  'OR'),  -- Peakbagger 2468.1 m
    -- absent from OSM as of 2026-08-21; candidate for future OSM contribution
    ('14D24689E01D266EB668', 'Berry-Norton Peak',                  2447.4, 44.3265232, -118.8723340, '21492',  'OR'),  -- Peakbagger 2447.5 m
    -- Traditional Colorado Centennials. This is UN 13,820, the last summit
    -- holding that list back.
    -- absent from OSM as of 2026-08-21; candidate for future OSM contribution
    ('3E76D238021E3F9C0E31', 'Redcloud Peak - Far Northeast Peak', 4212.3, 37.9545950, -107.3782599, '5845',   'CO')   -- Peakbagger 4212.2 m
),
prepared AS (
  SELECT
    id,
    name,
    lower(name) AS search_name,
    elevation,
    ST_SetSRID(ST_MakePoint(lng, lat, elevation), 4326)::geography AS location,
    jsonb_build_object('peakbagger', peakbagger_id) AS external_ids,
    jsonb_build_object(
      'source', 'peakbagger',
      'catalog_audit', 'peakbagger-lists-2026-08-21',
      'elevation_source', 'usgs_3dep',
      'coordinate_source', 'usgs_3dep_summit_search',
      'osm_status', 'absent from OSM as of 2026-08-21; candidate for future OSM contribution'
    ) AS metadata,
    peakbagger_id,
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
  WHERE d.external_ids @> jsonb_build_object('peakbagger', p.peakbagger_id)
     OR (
       d.search_name = p.search_name
       AND d.location IS NOT NULL
       AND ST_DWithin(d.location, p.location, 500)
     )
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
