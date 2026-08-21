-- The Bulge, New Hampshire: correct the elevation 20260821_northeast_list_summits.sql
-- stored for it.
--
-- That migration kept the OSM ele tag on any node whose 3DEP sample at the node
-- itself agreed within 3 m, and only ran a 3DEP summit search where the two
-- disagreed. The Bulge passed that test -- tag 1197 m, 3DEP at the node
-- 1197.272 m -- so no search ran, and 1197.0 went in.
--
-- The test was the wrong one. A node sitting off the high point reads low in
-- 3DEP and agrees with its own low tag, and nothing catches it. Two independent
-- published figures said so: Peakbagger has The Bulge at 3,945.2 ft (1202.50 m)
-- and the AMC Hundred Highest at 3,950 ft (1203.96 m), both about 5.5 m above
-- the stored value.
--
-- A 3DEP summit search around the node -- a 150 m grid at 25 m spacing, refined
-- to 2.5 m -- puts the high point at 44.5146179 -71.4084678, 18 m from the node,
-- reading 1202.391 m. That is 0.11 m from Peakbagger's figure and 5.4 m above
-- the OSM tag, so the tag is an old contour value, the same defect the audit
-- catalogues for Nye Mountain, Baldpate and others.
--
-- The row keeps the OSM node's coordinates, which are its identity, and takes
-- the 3DEP elevation. That is what East Sleeper, Vose Spur and East Kennebago
-- Mountain already do in the same migration. elevation_source becomes usgs_3dep.
--
-- location is geography(PointZ,4326) under a CHECK that reads elevation =
-- ST_Z(location), so both come from the same literal here.
--
-- The other sixteen rows were re-checked against the source list's published
-- figure, the test that catches this: The Bulge was the only one over 3 m out.
-- The next largest is South Horn at 2.87 m.
--
-- Written up in docs/data-audits/peakbagger-lists-2026-08-21.md.

BEGIN;

UPDATE destinations
SET elevation = 1202.4,
    location = ST_SetSRID(
      ST_MakePoint(
        ST_X(location::geometry),
        ST_Y(location::geometry),
        1202.4
      ),
      4326
    )::geography,
    metadata = jsonb_set(
      metadata,
      '{elevation_source}',
      to_jsonb('usgs_3dep'::text)
    )
WHERE id = 'F53AFB8FCDE606A00F19'
  AND name = 'The Bulge'
  AND external_ids->>'osm' = '357728179'
  AND elevation = 1197.0;

DO $$
DECLARE
  stored double precision;
  z double precision;
  source text;
BEGIN
  SELECT elevation, ST_Z(location::geometry), metadata->>'elevation_source'
    INTO stored, z, source
  FROM destinations WHERE id = 'F53AFB8FCDE606A00F19';

  IF stored IS DISTINCT FROM 1202.4 THEN
    RAISE EXCEPTION 'The Bulge stores %, expected 1202.4', stored;
  END IF;
  IF z IS DISTINCT FROM stored THEN
    RAISE EXCEPTION 'The Bulge Z is % against elevation %', z, stored;
  END IF;
  IF source IS DISTINCT FROM 'usgs_3dep' THEN
    RAISE EXCEPTION 'The Bulge elevation_source is %, expected usgs_3dep', source;
  END IF;
END $$;

COMMIT;
