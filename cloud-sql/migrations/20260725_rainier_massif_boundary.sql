-- Curated massif ring for Mount Rainier — the first massif_boundary row.
--
-- Derivation: the mountain's ground is bounded by the rivers that drain it, so
-- the ring's vertices sit at named points in the Carbon, Mowich, Puyallup,
-- Nisqually, Cowlitz, and White river valleys, then sorted by bearing about the
-- summit (46.8523 N, 121.7603 W). Sorting a set of points by angle around an
-- interior point yields a star-shaped ring, which is provably non-self-
-- intersecting — that is why the ordering below looks arbitrary. Radii run
-- 8.4-13.7 km from the summit.
--
-- Vertices, counter-clockwise from east:
--   Fryingpan Creek / Summerland .... -121.6180 46.8560
--   White River Campground .......... -121.6420 46.9010
--   Huckleberry Creek headwall ...... -121.6350 46.9280
--   Berkeley Park / Lodi Creek ...... -121.7000 46.9310
--   Mystic Lake / W Fork White ...... -121.7570 46.9280
--   Moraine Park / Carbon terminus .. -121.8080 46.9370
--   Mowich Lake ..................... -121.8640 46.9330
--   Ipsut Creek / Carbon River ...... -121.8970 46.9330
--   Golden Lakes / N Puyallup ....... -121.9000 46.8830
--   Klapatche Park / upper Puyallup . -121.8850 46.8420
--   Emerald Ridge / Tahoma Creek .... -121.8580 46.8000
--   Nisqually below Longmire ........ -121.8400 46.7420
--   Reflection Lakes ................ -121.7290 46.7690
--   Box Canyon / Muddy Fork Cowlitz . -121.6480 46.7690
--   Ohanapecosh Park / upper Cowlitz  -121.6250 46.8100
--
-- Two vertices were moved down-valley from the first draft of this ring, which
-- used Sunrise / Yakima Park (-121.6430 46.9145) and Longmire (-121.8130
-- 46.7500) as vertices. Both places are meant to be INSIDE the massif, and a
-- point sitting exactly on the ring is neither in nor out: ray casting calls it
-- outside, ST_Covers calls it inside, and floating point picks the winner. The
-- boundary now runs past them — up Huckleberry Creek below Sourdough Ridge, and
-- down the Nisqually below Longmire — so both landmarks are strictly interior.
-- Landmarks belong inside the ring, never on it.
--
-- This is a coarse but correct seed. It contains Camp Muir, Paradise, Sunrise,
-- and Longmire; it excludes Crystal Peak. Refining it (DEM valley-line tracing)
-- replaces the WKT below in place — no code depends on the vertex count. To add
-- another peak, copy this file, swap the WKT and the name/location predicate.
-- Guard: cloud-sql/migrate/src/__tests__/rainier-massif-polygon.test.ts parses
-- the POLYGON literal out of this file, so keep it on one statement.

BEGIN;

UPDATE destinations
   SET massif_boundary = ST_GeogFromText('SRID=4326;POLYGON((-121.6180 46.8560, -121.6420 46.9010, -121.6350 46.9280, -121.7000 46.9310, -121.7570 46.9280, -121.8080 46.9370, -121.8640 46.9330, -121.8970 46.9330, -121.9000 46.8830, -121.8850 46.8420, -121.8580 46.8000, -121.8400 46.7420, -121.7290 46.7690, -121.6480 46.7690, -121.6250 46.8100, -121.6180 46.8560))')
 WHERE id = (
   SELECT d.id
     FROM destinations d
    WHERE d.name = 'Mount Rainier'
      AND 'summit' = ANY(d.features)
      AND d.location IS NOT NULL
    ORDER BY ST_Distance(d.location, ST_GeogFromText('SRID=4326;POINT(-121.7603 46.8523)'))
    LIMIT 1
 );

-- Fail loudly rather than silently shipping an invalid or unmatched ring.
DO $$
DECLARE
  matched INTEGER;
  valid   BOOLEAN;
BEGIN
  SELECT count(*) INTO matched FROM destinations WHERE massif_boundary IS NOT NULL;
  IF matched < 1 THEN
    RAISE EXCEPTION 'Rainier massif ring matched no destination row';
  END IF;

  SELECT bool_and(ST_IsValid(massif_boundary::geometry)) INTO valid
    FROM destinations WHERE massif_boundary IS NOT NULL;
  IF NOT valid THEN
    RAISE EXCEPTION 'massif_boundary contains an invalid polygon';
  END IF;
END $$;

COMMIT;
