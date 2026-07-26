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
--   White River road below the CG ... -121.6210 46.9090
--   Huckleberry Creek headwall ...... -121.6350 46.9280
--   Berkeley Park / Lodi Creek ...... -121.7000 46.9310
--   Mystic Lake / W Fork White ...... -121.7570 46.9280
--   Moraine Park / Carbon terminus .. -121.8080 46.9370
--   Crater Creek below Mowich outlet  -121.8760 46.9420
--   Ipsut Creek / Carbon River ...... -121.8970 46.9330
--   Golden Lakes / N Puyallup ....... -121.9000 46.8830
--   Klapatche Park / upper Puyallup . -121.8850 46.8420
--   Emerald Ridge / Tahoma Creek .... -121.8580 46.8000
--   Nisqually below Longmire ........ -121.8400 46.7420
--   Reflection Lakes ................ -121.7290 46.7690
--   Box Canyon / Muddy Fork Cowlitz . -121.6480 46.7690
--   Ohanapecosh Park / upper Cowlitz  -121.6250 46.8100
--
-- Four vertices have been moved down-valley from earlier drafts, all for the
-- same reason: a named place sitting exactly on the ring is neither in nor out.
-- Ray casting calls it outside, ST_Covers calls it inside, and floating point
-- picks the winner. Landmarks belong inside the ring, never on it.
--
--   Sunrise / Yakima Park (-121.6430 46.9145) -> up Huckleberry Creek below
--     Sourdough Ridge.
--   Longmire (-121.8130 46.7500) -> down the Nisqually below Longmire.
--   Mowich Lake (-121.8640 46.9330) -> down the NW drainage, Crater Creek below
--     the Mowich outlet on its way to Ipsut Creek.
--   White River Campground (-121.6420 46.9010) -> down the White River valley,
--     the road below the campground. This one is the Emmons trailhead, so it is
--     very likely a destinations row of its own.
--
-- Each move keeps the ring star-shaped about the summit: vertex bearings still
-- increase strictly, so the ring stays simple. Every landmark now clears the
-- boundary by more than 100 m, which the test below asserts.
--
-- This is a coarse but correct seed. It contains Camp Muir, Paradise, Sunrise,
-- Longmire, Mowich Lake, and White River Campground; it excludes Crystal Peak.
-- Refining it (DEM valley-line tracing) replaces the WKT below in place — no
-- code depends on the vertex count. To add another peak: copy this file, swap
-- the WKT and the name/location predicate, scope the DO guard below to that
-- same row (it must never count massif_boundary rows table-wide, or the new
-- file passes on UPDATE 0 and blames this ring for another row's geometry),
-- and point the test at the new path with its own fixtures.
-- Guard: cloud-sql/migrate/src/__tests__/rainier-massif-polygon.test.ts parses
-- the POLYGON literal out of this file, so keep it on one statement — and keep
-- it the only POLYGON literal in the file.

BEGIN;

UPDATE destinations
   SET massif_boundary = ST_GeogFromText('SRID=4326;POLYGON((-121.6180 46.8560, -121.6210 46.9090, -121.6350 46.9280, -121.7000 46.9310, -121.7570 46.9280, -121.8080 46.9370, -121.8760 46.9420, -121.8970 46.9330, -121.9000 46.8830, -121.8850 46.8420, -121.8580 46.8000, -121.8400 46.7420, -121.7290 46.7690, -121.6480 46.7690, -121.6250 46.8100, -121.6180 46.8560))')
 WHERE id = (
   SELECT d.id
     FROM destinations d
    WHERE d.name = 'Mount Rainier'
      AND 'summit' = ANY(d.features)
      AND d.location IS NOT NULL
    ORDER BY ST_Distance(d.location, ST_GeogFromText('SRID=4326;POINT(-121.7603 46.8523)'))
    LIMIT 1
 );

-- Fail loudly rather than silently shipping an invalid or unmatched ring. Both
-- checks read the one row the UPDATE above targets — resolved by the same
-- predicate — so a second massif shipped later cannot make this file pass on
-- UPDATE 0, and a bad ring on some other row cannot be reported as this one.
DO $$
DECLARE
  target_id TEXT;
  ring      geography;
BEGIN
  SELECT d.id, d.massif_boundary INTO target_id, ring
    FROM destinations d
   WHERE d.name = 'Mount Rainier'
     AND 'summit' = ANY(d.features)
     AND d.location IS NOT NULL
   ORDER BY ST_Distance(d.location, ST_GeogFromText('SRID=4326;POINT(-121.7603 46.8523)'))
   LIMIT 1;

  IF target_id IS NULL THEN
    RAISE EXCEPTION 'Rainier massif ring matched no destination row';
  END IF;

  IF ring IS NULL THEN
    RAISE EXCEPTION 'Rainier massif ring was not applied to destination %', target_id;
  END IF;

  IF NOT ST_IsValid(ring::geometry) THEN
    RAISE EXCEPTION 'Rainier massif_boundary on destination % is an invalid polygon', target_id;
  END IF;
END $$;

COMMIT;
