-- The 21 Desert Peaks Section summits that OpenStreetMap has never mapped.
--
-- Sixteen of the 21 carry no name of their own on the ground: they are the high
-- points of named desert ranges ("Turtle Mountains High Point") or named points
-- on a rim. OSM has no node for any of the 21, so they enter the catalog with
-- Peakbagger provenance instead, on the scheme the Oregon and Colorado pass
-- established:
--
--   id           sha256('peakbagger:peak:<peakbaggerPeakId>') hex[0..20], upper
--                -- a separate scheme from the osm:node ids, so the two cannot
--                collide
--   external_ids {"peakbagger": "<peakbaggerPeakId>"}
--   source       'peakbagger'
--
-- GNIS is not used here, for coordinates or for anything else.
--
-- COORDINATES need no 3DEP summit search this time. The Oregon and Colorado
-- pass had to run one because the 2026-08-18 export's coordinates were tile
-- quantised at zoom 7, about 860 m on the ground. These come from Peakbagger's
-- list map feed (LLL.aspx) at five decimals, and they land on the summit:
-- sampling USGS 3DEP at each of the 19 rows inside 3DEP's coverage reads within
-- 3.3 m of the published elevation on 18 of them, and within 1 m on 15.
--
-- Two exceptions are recorded rather than papered over:
--   Big Maria Mountains High Point reads 13 m below its published 1031.7 m, and
--   a 9x9 grid at 50 m spacing around the point finds nothing higher. The
--   published figure is stored and the disagreement is written up.
--   Cerro del Pinacate and Pico Risco stand in Mexico, outside 3DEP; the
--   elevation service answers there from a coarse global grid, so neither row
--   is checked against it.
--
-- Every row is a candidate for a future OpenStreetMap contribution.
--
-- Written up in docs/data-audits/peakbagger-lists-2026-08-21.md.

BEGIN;

-- The rows. One VALUES list, so the whole batch reads in one place.
CREATE TEMP TABLE western_peakbagger_incoming (
  id text, name text, elevation double precision, prominence double precision,
  lat double precision, lng double precision,
  peakbagger_id text, elevation_source text, coordinate_source text,
  country_code text, state_code text
) ON COMMIT DROP;

INSERT INTO western_peakbagger_incoming (
  id, name, elevation, prominence, lat, lng,
  peakbagger_id, elevation_source, coordinate_source, country_code, state_code
) VALUES
    ('94E0BAD6923B0C3AA47E', 'Pleasant Point', 2953.9, 353.9, 36.5706900, -117.8128800, '13399', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Pleasant Point
    ('C6BF1CF4C44FCA90DDF6', 'Nelson Range High Point', 2346.2, 521.8, 36.5565500, -117.6559500, '13400', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Nelson Range High Point
    ('AEA5F9AA748EE0F64B3B', 'Sandy Point', 2153.8, 498.5, 37.1512000, -117.6186200, '13401', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Sandy Point
    ('A3645CD6216475F1653E', 'Mitchell Point', 2149.1, 270.3, 34.9783700, -115.5376700, '13406', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Mitchell Point
    ('4CF65AB5F18675883E9F', 'East Ord Mountain', 1877.7, 457.0, 34.6392100, -116.7626000, '13407', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: East Ord Mountain
    ('62022B918FEC7E63461C', 'Canyon Point', 1797.8, 333.0, 36.5487140, -117.3806080, '13404', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Canyon Point
    ('A29E74EE7576B3FE9B43', 'Pahrump Point', 1750.4, 335.9, 36.0991500, -116.1399100, '13403', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Pahrump Point
    ('41636FEA0C781E95D607', 'Stewart Point', 1605.2, 730.7, 36.1662200, -116.2080300, '16789', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Stewart Point
    ('C3C6AE6C0DA5EAC4617F', 'Rosa Point', 1536.9, 90.9, 33.3617700, -116.1689650, '1510', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Rosa Point
    ('BB1C476782FB16AD1F1C', 'Pico Risco', 1520.0, 100.0, 32.1339510, -115.8108650, '13420', 'peakbagger', 'peakbagger', 'MX', NULL),  -- 5053 Desert Peaks Section: Pico Risco
    ('E92527992D1368E5B601', 'Sheep Hole Mountains High Point', 1419.9, 697.7, 34.2266800, -115.6920200, '16794', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Sheep Hole Mountains High Point
    ('C6E435CA065E484F8C56', 'Jacumba Mountain', 1376.4, 391.7, 32.6977860, -116.1644400, '13414', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Jacumba Mountain
    ('130AB5C84F78F45FC628', 'Spectre Peak', 1365.5, 775.4, 34.0261650, -115.4045700, '13411', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Spectre Peak
    ('CDBEFD441DDC9B7EFFBB', 'Turtle Mountains High Point', 1312.0, 819.1, 34.2611400, -114.8275700, '16800', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Turtle Mountains High Point
    ('02A0063CC0E6F27A8CD7', 'Whipple Mountains High Point', 1259.5, 855.5, 34.3145800, -114.4110700, '16803', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Whipple Mountains High Point
    ('BDEBCB127E80A5B20673', 'Cerro del Pinacate', 1200.0, 960.1, 31.7724530, -113.4989730, '4103', 'peakbagger', 'peakbagger', 'MX', NULL),  -- 5053 Desert Peaks Section: Cerro del Pinacate
    ('B351B2E865FE4A030174', 'Palen Mountains High Point', 1173.9, 714.1, 33.8344000, -115.0388000, '16805', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Palen Mountains High Point
    ('7E2071E114A550DFB5CB', 'Mopah Point', 1076.3, 292.3, 34.3104900, -114.7651400, '13409', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Mopah Point
    ('3FB7C01367CF1CDD26CF', 'Chuckwalla Mountain', 1051.5, 440.8, 33.4548900, -115.1682100, '13410', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Chuckwalla Mountain
    ('8514F8FAA19602CDF401', 'Big Maria Mountains High Point', 1031.7, 714.1, 33.8678190, -114.6690870, '16811', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Big Maria Mountains High Point
    ('9C1E27E58FC3DCF80042', 'Stepladder Mountains', 894.9, 216.9, 34.5875000, -114.8727800, '13408', 'peakbagger', 'peakbagger', 'US', 'CA')  -- 5053 Desert Peaks Section: Stepladder Mountains
;

-- The insert runs once per two-degree tile, for the reason written up in
-- 20260821_western_list_summits.sql: link_areas_on_destination_insert is a
-- statement trigger whose candidate set is the envelope of the whole statement,
-- so a batch spread across the map compares every row against every protected
-- area. These 21 rows are all in the Southwest and would have cost less than
-- that migration's 91, but the same shape keeps both files honest.
DO $$
DECLARE
  tile record;
BEGIN
  FOR tile IN
    SELECT DISTINCT floor(lat / 2)::int AS blat, floor(lng / 2)::int AS blng
    FROM western_peakbagger_incoming
    ORDER BY 1, 2
  LOOP
    WITH prepared AS (
      SELECT
        id,
        name,
        lower(name) AS search_name,
        elevation,
        prominence,
        ST_SetSRID(ST_MakePoint(lng, lat, elevation), 4326)::geography AS location,
        jsonb_build_object('peakbagger', peakbagger_id) AS external_ids,
        jsonb_build_object(
          'source', 'peakbagger',
          'catalog_audit', 'peakbagger-lists-2026-08-21b',
          'elevation_source', elevation_source,
          'coordinate_source', coordinate_source,
          'prominence_source', 'peakbagger',
          'names', jsonb_build_object('display', name)
        ) AS metadata,
        peakbagger_id,
        country_code,
        state_code
      FROM western_peakbagger_incoming
      WHERE floor(lat / 2)::int = tile.blat
        AND floor(lng / 2)::int = tile.blng
    ),
    existing_peakbagger AS (
      SELECT external_ids->>'peakbagger' AS ident FROM destinations
      WHERE external_ids->>'peakbagger' IS NOT NULL
    )
    INSERT INTO destinations (
      id, name, search_name, elevation, prominence, location, geohash,
      type, activities, features, owner, country_code, state_code,
      external_ids, metadata, created_at, updated_at
    )
    SELECT
      p.id, p.name, p.search_name, p.elevation, p.prominence, p.location, NULL,
      'point',
      ARRAY['outdoor-trek']::activity_type[],
      ARRAY['summit']::destination_feature[],
      'peaks',
      p.country_code, p.state_code,
      p.external_ids, p.metadata, now(), now()
    FROM prepared p
    -- Three guards, each the negation of one way an existing row could already
    -- be this peak: its own identifier, its Wikidata identity, or a same-named
    -- summit within 500 m. Separate NOT EXISTS clauses rather than one OR, so
    -- each can use its own index; the test is the same either way.
    WHERE
      NOT EXISTS (SELECT 1 FROM existing_peakbagger e WHERE e.ident = p.peakbagger_id)
      AND NOT EXISTS (
        SELECT 1
        FROM destinations d
        WHERE d.location IS NOT NULL
          AND ST_DWithin(d.location, p.location, 500)
          AND d.search_name = p.search_name
      )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

DO $$
DECLARE
  expected text[] := ARRAY[
      '94E0BAD6923B0C3AA47E', 'C6BF1CF4C44FCA90DDF6', 'AEA5F9AA748EE0F64B3B', 'A3645CD6216475F1653E',
      '4CF65AB5F18675883E9F', '62022B918FEC7E63461C', 'A29E74EE7576B3FE9B43', '41636FEA0C781E95D607',
      'C3C6AE6C0DA5EAC4617F', 'BB1C476782FB16AD1F1C', 'E92527992D1368E5B601', 'C6E435CA065E484F8C56',
      '130AB5C84F78F45FC628', 'CDBEFD441DDC9B7EFFBB', '02A0063CC0E6F27A8CD7', 'BDEBCB127E80A5B20673',
      'B351B2E865FE4A030174', '7E2071E114A550DFB5CB', '3FB7C01367CF1CDD26CF', '8514F8FAA19602CDF401',
      '9C1E27E58FC3DCF80042'
  ];
  present int;
  z_off int;
  bad_meta int;
  shared_osm int;
  shared_wikidata int;
BEGIN
  SELECT count(*) INTO present FROM destinations WHERE id = ANY(expected);
  IF present <> 21 THEN
    RAISE EXCEPTION 'western Peakbagger-only summits: % of 21 rows present', present;
  END IF;

  -- Every catalog row keeps its elevation in the PointZ as well as the column.
  SELECT count(*) INTO z_off FROM destinations
  WHERE id = ANY(expected)
    AND (location IS NULL OR elevation IS NULL
         OR abs(ST_Z(location::geometry) - elevation) > 0.001);
  IF z_off <> 0 THEN
    RAISE EXCEPTION 'western Peakbagger-only summits: % row(s) whose PointZ disagrees with elevation', z_off;
  END IF;

  SELECT count(*) INTO bad_meta FROM destinations
  WHERE id = ANY(expected)
    AND (metadata->>'catalog_audit' IS DISTINCT FROM 'peakbagger-lists-2026-08-21b'
         OR owner IS DISTINCT FROM 'peaks'
         OR NOT ('summit'::destination_feature = ANY(features))
         OR country_code IS NULL);
  IF bad_meta <> 0 THEN
    RAISE EXCEPTION 'western Peakbagger-only summits: % row(s) missing provenance, owner, feature or country', bad_meta;
  END IF;

  -- No OSM node id may reach two destinations. That one IS true catalog-wide
  -- today, so it is checked outright rather than scoped to these rows.
  SELECT count(*) INTO shared_osm FROM (
    SELECT external_ids->>'osm' AS osm FROM destinations
    WHERE external_ids->>'osm' IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1
  ) t;
  IF shared_osm <> 0 THEN
    RAISE EXCEPTION 'western Peakbagger-only summits: % OSM node id(s) shared by two destinations', shared_osm;
  END IF;

  -- The Peakbagger scheme is this migration's own, so its ids must be unique
  -- across the catalog outright.
  SELECT count(*) INTO shared_wikidata FROM (
    SELECT external_ids->>'peakbagger' AS ident FROM destinations
    WHERE external_ids->>'peakbagger' IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1
  ) t;
  IF shared_wikidata <> 0 THEN
    RAISE EXCEPTION 'western Peakbagger-only summits: % Peakbagger id(s) shared by two destinations', shared_wikidata;
  END IF;
END $$;

COMMIT;
