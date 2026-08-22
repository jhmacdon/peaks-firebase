-- 17 summits needed by the Sierra Peaks and Hundred Peaks Sections lists.
--
-- OpenStreetMap has no distinct natural=peak node for these subsidiary ridges, lookouts and named points. They use the same reviewed Peakbagger-only identity scheme as the existing Oregon, Colorado and Desert Peaks residue migrations.
-- Coordinates, elevations and prominence come from the saved Peakbagger list-map fixture; GNIS is not used.
-- Monthly cost impact: $0. This is catalog data only.

BEGIN;

CREATE TEMP TABLE sierra_club_peakbagger_incoming (
  id text, name text, elevation double precision, prominence double precision,
  lat double precision, lng double precision,
  peakbagger_id text, source_list_id int
) ON COMMIT DROP;

INSERT INTO sierra_club_peakbagger_incoming (
  id, name, elevation, prominence, lat, lng,
  peakbagger_id, source_list_id
) VALUES
    ('8A6720844694DD63C6D6', 'Ten Thousand Foot Ridge', 3075.7368, 94.7318, 34.11361, -116.7925, '1415', 5052),  -- 5052: Ten Thousand Foot Ridge
    ('FE68AD8CE3A1DEA571E7', 'Wilshire Mountain', 2698.7602, 36.576, 34.06393, -116.90637, '1424', 5052),  -- 5052: Wilshire Mountain
    ('60EF8DA4563FA419B4AF', 'Piute Lookout', 2538.3744, 160.5077, 35.47994, -118.35944, '2894', 5052),  -- 5052: Piute Lookout
    ('3EAAE736C12CDCBB8F13', 'Arctic Point', 2537.7038, 289.4686, 34.31874, -116.8916, '1375', 5052),  -- 5052: Arctic Point
    ('06FB5BEF3CF13F0F8B04', 'Toro Peak - West Peak', 2536.6066, 47.8231, 33.52712, -116.43577, '44743', 5052),  -- 5052: Toro Peak - West Peak
    ('05F1C4051410188FBCBE', 'Copter Ridge', 2285.6952, 30.1752, 34.318968, -117.787415, '1329', 5052),  -- 5052: Copter Ridge
    ('D50FA95C9F2C1118DA02', 'Pine Mountain Ridge', 2277.2218, 63.2155, 34.32721, -117.69572, '30953', 5052),  -- 5052: Pine Mountain Ridge
    ('56485E6E44042701A31D', 'Sam Fink Peak', 2243.0537, 109.0574, 33.77589, -116.62152, '13434', 5052),  -- 5052: Sam Fink Peak
    ('A763E9C85270CA617D4F', 'Scodie Mountain', 2222.7845, 623.7122, 35.6295, -118.02815, '2886', 5052),  -- 5052: Scodie Mountain
    ('7A52AF569C862228E050', 'Winston Ridge', 2136.0689, 99.4867, 34.37125, -117.93596, '1308', 5052),  -- 5052: Winston Ridge
    ('28A8653ABD5C0CBC7249', 'Circle Mountain', 2101.596, 261.7622, 34.34304, -117.5858, '1321', 5052),  -- 5052: Circle Mountain
    ('CDFA92F4891750BD9630', 'Pinyon Ridge', 1995.9523, 51.5722, 34.39491, -117.75351, '1300', 5052),  -- 5052: Pinyon Ridge
    ('9BB84E16F553A3EA21D8', 'Big Pine Mountain - West Peak', 1978.7006, 55.4736, 34.69563, -119.67748, '1253', 5052),  -- 5052: Big Pine Mountain - West Peak
    ('77E193743E12370444CF', 'Ken Point', 1971.8731, 148.651, 33.61111, -116.55271, '1501', 5052),  -- 5052: Ken Point
    ('9E42942A4FB4137351F1', 'Meeks Mountain', 1914.1745, 208.8794, 34.25786, -116.61737, '1393', 5052),  -- 5052: Meeks Mountain
    ('67BD37F347E1AE56427F', 'Beartrap Bluff', 1888.4798, 41.5747, 34.65847, -119.26587, '37954', 5052),  -- 5052: Beartrap Bluff
    ('2F9972A94C3840AE5151', 'Barley Flats', 1714.3781, 47.6402, 34.2776, -118.07968, '1344', 5052)  -- 5052: Barley Flats
;

DO $$
DECLARE
  tile record;
BEGIN
  FOR tile IN
    SELECT DISTINCT floor(lat * 2)::int AS blat, floor(lng * 2)::int AS blng
    FROM sierra_club_peakbagger_incoming
    ORDER BY 1, 2
  LOOP
    WITH prepared AS (
      SELECT
        id, name, lower(name) AS search_name, elevation, prominence,
        ST_SetSRID(ST_MakePoint(lng, lat, elevation), 4326)::geography AS location,
        jsonb_build_object('peakbagger', peakbagger_id) AS external_ids,
        jsonb_build_object(
          'source', 'peakbagger',
          'catalog_audit', 'peakbagger-lists-2026-08-22',
          'elevation_source', 'peakbagger',
          'coordinate_source', 'peakbagger',
          'prominence_source', 'peakbagger',
          'osm_status', 'no distinct OSM natural=peak node as of 2026-08-22',
          'names', jsonb_build_object('display', name)
        ) AS metadata,
        peakbagger_id,
        source_list_id
      FROM sierra_club_peakbagger_incoming
      WHERE floor(lat * 2)::int = tile.blat
        AND floor(lng * 2)::int = tile.blng
    )
    INSERT INTO destinations (
      id, name, search_name, elevation, prominence, location, geohash,
      type, activities, features, owner, country_code, state_code,
      external_ids, metadata, created_at, updated_at
    )
    SELECT
      p.id, p.name, p.search_name, p.elevation, p.prominence, p.location, NULL,
      'point', ARRAY['outdoor-trek']::activity_type[], ARRAY['summit']::destination_feature[],
      'peaks', 'US', 'CA', p.external_ids, p.metadata, now(), now()
    FROM prepared p
    WHERE
      NOT EXISTS (SELECT 1 FROM destinations d WHERE d.external_ids->>'peakbagger' = p.peakbagger_id)
      AND NOT EXISTS (
        SELECT 1 FROM destinations d
        WHERE d.location IS NOT NULL
          AND d.search_name = p.search_name
          AND ST_DWithin(d.location, p.location, 500)
      )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

DO $$
DECLARE
  expected text[] := ARRAY['8A6720844694DD63C6D6', 'FE68AD8CE3A1DEA571E7', '60EF8DA4563FA419B4AF', '3EAAE736C12CDCBB8F13', '06FB5BEF3CF13F0F8B04', '05F1C4051410188FBCBE', 'D50FA95C9F2C1118DA02', '56485E6E44042701A31D', 'A763E9C85270CA617D4F', '7A52AF569C862228E050', '28A8653ABD5C0CBC7249', 'CDFA92F4891750BD9630', '9BB84E16F553A3EA21D8', '77E193743E12370444CF', '9E42942A4FB4137351F1', '67BD37F347E1AE56427F', '2F9972A94C3840AE5151'];
  present int;
  bad_rows int;
  duplicate_ids int;
BEGIN
  SELECT count(*) INTO present FROM destinations WHERE id = ANY(expected);
  IF present <> 17 THEN
    RAISE EXCEPTION 'sierra_club_peakbagger_incoming: % of 17 rows present', present;
  END IF;

  SELECT count(*) INTO bad_rows FROM destinations
  WHERE id = ANY(expected)
    AND (location IS NULL OR elevation IS NULL
         OR abs(ST_Z(location::geometry) - elevation) > 0.001
         OR metadata->>'catalog_audit' IS DISTINCT FROM 'peakbagger-lists-2026-08-22'
         OR owner IS DISTINCT FROM 'peaks'
         OR country_code IS DISTINCT FROM 'US'
         OR state_code IS DISTINCT FROM 'CA'
         OR NOT ('summit'::destination_feature = ANY(features)));
  IF bad_rows <> 0 THEN
    RAISE EXCEPTION 'sierra_club_peakbagger_incoming: % invalid row(s)', bad_rows;
  END IF;

  SELECT count(*) INTO duplicate_ids FROM (
    SELECT external_ids->>'peakbagger' AS ident
    FROM destinations
    WHERE external_ids->>'peakbagger' IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1
  ) duplicates;
  IF duplicate_ids <> 0 THEN
    RAISE EXCEPTION 'sierra_club_peakbagger_incoming: % shared Peakbagger id(s)', duplicate_ids;
  END IF;
END $$;

COMMIT;
