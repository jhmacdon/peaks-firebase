-- Eight members of the new Western lists carry no state_code and no
-- country_code.
--
-- The 2026-08-21b list import did not create these rows. They are Firestore-era
-- destinations with empty external_ids that were already in Peaks; putting them
-- on a list is what made the gap visible, exactly as the Oregon and Colorado
-- pass's forty were made visible. Seven are on the Desert Peaks Section list and
-- one on South Beyond 6000. All eight are in the United States.
--
-- Each state is assigned from the row's own coordinates and cross-checked
-- against a second source, and the update only fires when the point falls
-- inside that state's bounding box, so a wrong pairing writes nothing.
--
--   destination            reverse geocode        Peakbagger's own section
--   Avawatz Peak           CA, San Bernardino     3. San Bernardino County
--   Bridge Mountain        NV, Clark              6. Nevada
--   Granite Mountain       CA, Riverside          4. Riverside County
--   Humphreys Peak         AZ, Coconino           8. Arizona
--   Mount Jefferson        NV, Nye                6. Nevada
--   Nopah Range High Point CA, Inyo               2. Death Valley - Inyo County
--   Old Woman Mountain     CA, San Bernardino     3. San Bernardino County
--   Mount Sequoyah         TN, Sevier             -- (South Beyond 6000 prints no section)
--
-- The two agree on every row. Reverse geocoding was OpenStreetMap's Nominatim,
-- read 2026-08-21, one request a second.
--
-- Written up in docs/data-audits/peakbagger-lists-2026-08-21.md.

BEGIN;

WITH incoming (id, name, state_code, min_lat, max_lat, min_lng, max_lng) AS (
  VALUES
    -- Desert Peaks Section
    ('JRwqUtfsaLO280n3Z4NV', 'Avawatz Peak',           'CA', 32.5, 42.1, -124.5, -114.1),
    ('TTjoqTCtBiL1J23L1bnP', 'Granite Mountain',       'CA', 32.5, 42.1, -124.5, -114.1),
    ('8D6Cnt0CIXsj2N7Fmw1T', 'Nopah Range High Point', 'CA', 32.5, 42.1, -124.5, -114.1),
    ('exLsc7NgdIgOpAs0Vi3y', 'Old Woman Mountain',     'CA', 32.5, 42.1, -124.5, -114.1),
    ('tt0lBHYDwQJrl23UzY7I', 'Bridge Mountain',        'NV', 35.0, 42.1, -120.1, -114.0),
    ('umxJyj9jDS7eoyOCf9o3', 'Mount Jefferson',        'NV', 35.0, 42.1, -120.1, -114.0),
    ('cwsCKDGqQxw9n7zFKNn4', 'Humphreys Peak',         'AZ', 31.3, 37.1, -114.9, -109.0),
    -- South Beyond 6000
    ('6EO576elY8r21xwORhiK', 'Mount Sequoyah',         'TN', 34.9, 36.7,  -90.4,  -81.6)
)
UPDATE destinations d
SET state_code = i.state_code,
    country_code = 'US'
FROM incoming i
WHERE d.id = i.id
  AND d.name = i.name
  AND d.state_code IS NULL
  AND d.country_code IS NULL
  AND d.location IS NOT NULL
  AND ST_Y(d.location::geometry) BETWEEN i.min_lat AND i.max_lat
  AND ST_X(d.location::geometry) BETWEEN i.min_lng AND i.max_lng;

DO $$
DECLARE
  expected text[] := ARRAY[
    'JRwqUtfsaLO280n3Z4NV', 'TTjoqTCtBiL1J23L1bnP', '8D6Cnt0CIXsj2N7Fmw1T',
    'exLsc7NgdIgOpAs0Vi3y', 'tt0lBHYDwQJrl23UzY7I', 'umxJyj9jDS7eoyOCf9o3',
    'cwsCKDGqQxw9n7zFKNn4', '6EO576elY8r21xwORhiK'
  ];
  still_blank int;
  wrong_state int;
  list_gap int;
BEGIN
  SELECT count(*) INTO still_blank FROM destinations
  WHERE id = ANY(expected) AND (state_code IS NULL OR country_code IS NULL);
  IF still_blank <> 0 THEN
    RAISE EXCEPTION 'western list state codes: % of 8 rows still blank', still_blank;
  END IF;

  -- Naming the state each row must now hold pins the pairing, not just the
  -- fact that something was written. A swapped pair would pass a count.
  SELECT count(*) INTO wrong_state FROM (
    VALUES ('JRwqUtfsaLO280n3Z4NV','CA'), ('TTjoqTCtBiL1J23L1bnP','CA'),
           ('8D6Cnt0CIXsj2N7Fmw1T','CA'), ('exLsc7NgdIgOpAs0Vi3y','CA'),
           ('tt0lBHYDwQJrl23UzY7I','NV'), ('umxJyj9jDS7eoyOCf9o3','NV'),
           ('cwsCKDGqQxw9n7zFKNn4','AZ'), ('6EO576elY8r21xwORhiK','TN')
  ) AS want(id, state_code)
  JOIN destinations d ON d.id = want.id
  WHERE d.state_code IS DISTINCT FROM want.state_code OR d.country_code IS DISTINCT FROM 'US';
  IF wrong_state <> 0 THEN
    RAISE EXCEPTION 'western list state codes: % row(s) hold the wrong state', wrong_state;
  END IF;

  -- The gap this clears was the whole point: no member of the four lists this
  -- pass added may be left without a country.
  SELECT count(*) INTO list_gap
  FROM list_destinations ld
  JOIN destinations d ON d.id = ld.destination_id
  WHERE ld.list_id IN (
      'B9FF8D354285BB97D057', '3B96675933CC7E424A7E',
      '17A38951FA2EFAC16F77', '5C16243B2F33DC56D7E2'
    )
    AND d.country_code IS NULL;
  IF list_gap <> 0 THEN
    RAISE EXCEPTION 'western list state codes: % list member(s) still have no country', list_gap;
  END IF;
END $$;

COMMIT;
