-- Four small list-data debts, cleared together.
--
-- 1. Oregon Volcanoes carried Middle Sister and South Sister but not North
--    Sister. The destination has been in Peaks all along (zgZKKqtDJJ31aLqtaY2B,
--    3,074 m, 44.16655 -121.77234); only the membership row was missing. The
--    USGS Cascades Volcano Observatory, the list's own source, counts North
--    Sister among the Oregon volcanoes, and Peaks already lists it on the
--    Cascade Volcanoes and Oregon Top 100. The list orders by descending
--    elevation from ordinal 0, so this rewrites every ordinal from elevation
--    rather than guessing where the new row belongs.
--
-- 2. Elbrus had no country_code, so the Seven Summits page counted six
--    countries instead of seven. The summit stands in Kabardino-Balkaria,
--    Russia, at 43.35381 42.43610 -- the row's own coordinates fall inside
--    Russia, well north of the Georgian border. RU.
--
-- 3. South Twin (QkAXELOaEsMBnuArw2ZL) came through the Firestore migration
--    with no state_code, no country_code and no OSM ID. It is a New Hampshire
--    4000-footer; OpenStreetMap node 357730793, "South Twin Mountain", sits at
--    44.187565 -71.5548027, 22 m from the stored point. Read 2026-08-21.
--
-- 4. Thirty-nine destinations added by the 2026-08-21 list import have no
--    state_code and no country_code: 32 on the Oregon Top 100, 6 on the
--    Traditional Colorado Centennials, and South Twin above. All are in the
--    United States. Each state is assigned from the row's own coordinates, and
--    the update only fires when the point falls inside that state's bounding
--    box, so a wrong pairing writes nothing. Mount Washington in Oregon rides
--    along as a fortieth: it carries the same defect and is the last blank left
--    on the Oregon Volcanoes list that item 1 edits.
--
-- Written up in docs/data-audits/peakbagger-lists-2026-08-21.md.

BEGIN;

-- 2. Elbrus.
UPDATE destinations
SET country_code = 'RU'
WHERE id = 'JtHzkU6Z7baLiNgBc4Jj'
  AND name = 'Elbrus'
  AND country_code IS NULL;

-- 3. South Twin's OSM ID. state_code and country_code come with the batch below.
UPDATE destinations
SET external_ids = external_ids || jsonb_build_object('osm', '357730793')
WHERE id = 'QkAXELOaEsMBnuArw2ZL'
  AND name = 'South Twin'
  AND external_ids->>'osm' IS NULL
  AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(-71.5548027, 44.1875650), 4326)::geography, 100)
  AND NOT EXISTS (
    SELECT 1 FROM destinations other
    WHERE other.external_ids @> jsonb_build_object('osm', '357730793')
  );

-- 4. state_code and country_code for the thirty-nine.
WITH incoming (id, state_code, min_lat, max_lat, min_lng, max_lng) AS (
  VALUES
    -- Oregon Top 100 Peaks
    ('IoWtOYlLhxZ7uE8rb3iU', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('p99bHvzb7oM7tInYvnab', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('OV1xgyViakiTByQajqBu', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('A8aM0rQz69CqGc29IST8', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('HcJOC5hdfShM72xqLJAZ', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('uHnmxZTacKFSZzHIWhZ3', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('gwTN8Iw5fBVPXk5mE1aq', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('j2Q5R4XVEJmx1YiPbeiS', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('sQS8gcSnCMzhPs1kVGq1', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('kAHH494WZoXXFahXa6sQ', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('IbE65IWF236s9bGBGasE', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('BTXrpsJ1Sg27UpTPM5rh', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('R3Y7IjSe1hbzT0kQaXrN', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('56865sgj6Ld4BH3t4oGt', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('DJZvhpLGmhXlYT9PBXvg', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('uA2XhHHKflIPgGYLUP2L', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('6sHHcTZFJNO2ylXAqYL7', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('MzIludk9dAB4jmLlaF6d', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('eLGVdNNaXrKQl0xdlivF', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('7mzvk8cPg6TxeCsZOSHb', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('SJNhV1R2GQNigtKhvdJr', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('eOa8soGXeUCs2X1ohmEz', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('J981BnTsTnIsJYU7y2de', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('nvZctOdUKLw0bltSLnHE', 'OR', 41.9, 46.3, -124.6, -116.4),
    -- Oregon Top 100 Peaks, also on the volcano lists
    ('zgZKKqtDJJ31aLqtaY2B', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('mzm09L7B6XbcCjB6oaVb', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('U0r2Ys42V3pk8j8Hqtje', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('tL2MUUOnkKO12jQmvuOF', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('AP0BwkdqkPkSU8z987jc', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('Jceo8iBanENzN9vzzNkE', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('M9sAlulUy6SXT8dONMDd', 'OR', 41.9, 46.3, -124.6, -116.4),
    ('hE6VofcenDylHFMiq5H9', 'OR', 41.9, 46.3, -124.6, -116.4),
    -- Traditional Colorado Centennials
    ('IwojGl4bLNFJ9b9wGziK', 'CO', 36.9, 41.1, -109.1, -102.0),
    ('yijQeHfMkfGmyMHLFLn0', 'CO', 36.9, 41.1, -109.1, -102.0),
    ('4JvCoyxaAL4zJj65qCpf', 'CO', 36.9, 41.1, -109.1, -102.0),
    ('Qjb76uUlQY6536OO6ROm', 'CO', 36.9, 41.1, -109.1, -102.0),
    ('nFRcicwEFDSjJjoXrWyq', 'CO', 36.9, 41.1, -109.1, -102.0),
    ('SdN9wqmyEj7Xq4R5NQeb', 'CO', 36.9, 41.1, -109.1, -102.0),
    -- New England 4000-Footers
    ('QkAXELOaEsMBnuArw2ZL', 'NH', 42.6, 45.4, -72.6, -70.6),
    -- Oregon Volcanoes. Not one of the thirty-nine, and repaired here because
    -- it is the last blank left on the list this migration edits.
    ('NAAS8YxpeGd9hbnfKk6z', 'OR', 41.9, 46.3, -124.6, -116.4)
)
UPDATE destinations d
SET state_code = i.state_code,
    country_code = 'US'
FROM incoming i
WHERE d.id = i.id
  AND d.state_code IS NULL
  AND d.location IS NOT NULL
  AND ST_Y(d.location::geometry) BETWEEN i.min_lat AND i.max_lat
  AND ST_X(d.location::geometry) BETWEEN i.min_lng AND i.max_lng;

-- 1. North Sister joins Oregon Volcanoes, then the list re-derives its ordinals.
INSERT INTO list_destinations (list_id, destination_id, ordinal)
SELECT '4HxxAe4pgIKHU9gbOxtV', 'zgZKKqtDJJ31aLqtaY2B', 0
WHERE EXISTS (SELECT 1 FROM lists WHERE id = '4HxxAe4pgIKHU9gbOxtV')
  AND EXISTS (
    SELECT 1 FROM destinations
    WHERE id = 'zgZKKqtDJJ31aLqtaY2B' AND name = 'North Sister'
  )
ON CONFLICT (list_id, destination_id) DO NOTHING;

WITH ranked AS (
  SELECT ld.destination_id,
         row_number() OVER (ORDER BY d.elevation DESC, d.name) - 1 AS ordinal
  FROM list_destinations ld
  JOIN destinations d ON d.id = ld.destination_id
  WHERE ld.list_id = '4HxxAe4pgIKHU9gbOxtV'
)
UPDATE list_destinations ld
SET ordinal = ranked.ordinal
FROM ranked
WHERE ld.list_id = '4HxxAe4pgIKHU9gbOxtV'
  AND ld.destination_id = ranked.destination_id
  AND ld.ordinal IS DISTINCT FROM ranked.ordinal;

DO $$
DECLARE
  volcano_count int;
  north_sister_ordinal int;
  missing_state int;
BEGIN
  SELECT count(*) INTO volcano_count
  FROM list_destinations WHERE list_id = '4HxxAe4pgIKHU9gbOxtV';
  IF volcano_count <> 11 THEN
    RAISE EXCEPTION 'Oregon Volcanoes holds % rows, expected 11', volcano_count;
  END IF;

  SELECT ordinal INTO north_sister_ordinal
  FROM list_destinations
  WHERE list_id = '4HxxAe4pgIKHU9gbOxtV' AND destination_id = 'zgZKKqtDJJ31aLqtaY2B';
  IF north_sister_ordinal <> 3 THEN
    RAISE EXCEPTION 'North Sister sits at ordinal %, expected 3', north_sister_ordinal;
  END IF;

  SELECT count(*) INTO missing_state
  FROM destinations
  WHERE state_code IS NULL
    AND id IN (
      'IoWtOYlLhxZ7uE8rb3iU','p99bHvzb7oM7tInYvnab','OV1xgyViakiTByQajqBu','A8aM0rQz69CqGc29IST8',
      'HcJOC5hdfShM72xqLJAZ','uHnmxZTacKFSZzHIWhZ3','gwTN8Iw5fBVPXk5mE1aq','j2Q5R4XVEJmx1YiPbeiS',
      'sQS8gcSnCMzhPs1kVGq1','kAHH494WZoXXFahXa6sQ','IbE65IWF236s9bGBGasE','BTXrpsJ1Sg27UpTPM5rh',
      'R3Y7IjSe1hbzT0kQaXrN','56865sgj6Ld4BH3t4oGt','DJZvhpLGmhXlYT9PBXvg','uA2XhHHKflIPgGYLUP2L',
      '6sHHcTZFJNO2ylXAqYL7','MzIludk9dAB4jmLlaF6d','eLGVdNNaXrKQl0xdlivF','7mzvk8cPg6TxeCsZOSHb',
      'SJNhV1R2GQNigtKhvdJr','eOa8soGXeUCs2X1ohmEz','J981BnTsTnIsJYU7y2de','nvZctOdUKLw0bltSLnHE',
      'zgZKKqtDJJ31aLqtaY2B','mzm09L7B6XbcCjB6oaVb','U0r2Ys42V3pk8j8Hqtje','tL2MUUOnkKO12jQmvuOF',
      'AP0BwkdqkPkSU8z987jc','Jceo8iBanENzN9vzzNkE','M9sAlulUy6SXT8dONMDd','hE6VofcenDylHFMiq5H9',
      'IwojGl4bLNFJ9b9wGziK','yijQeHfMkfGmyMHLFLn0','4JvCoyxaAL4zJj65qCpf','Qjb76uUlQY6536OO6ROm',
      'nFRcicwEFDSjJjoXrWyq','SdN9wqmyEj7Xq4R5NQeb','QkAXELOaEsMBnuArw2ZL','NAAS8YxpeGd9hbnfKk6z'
    );
  IF missing_state <> 0 THEN
    RAISE EXCEPTION '% rows still have no state_code', missing_state;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM destinations WHERE id = 'JtHzkU6Z7baLiNgBc4Jj' AND country_code = 'RU'
  ) THEN
    RAISE EXCEPTION 'Elbrus still has no country_code';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM destinations
    WHERE id = 'QkAXELOaEsMBnuArw2ZL' AND external_ids->>'osm' = '357730793'
  ) THEN
    RAISE EXCEPTION 'South Twin still has no OSM ID';
  END IF;
END $$;

COMMIT;
