-- Web-mercator copies of protected-area boundaries for the area vector tiles,
-- GET /api/map/areas/:z/:x/:y.mvt.
--
-- Built on the fly from boundary_display, a Rainier z9 tile took 2.5 s on the
-- db-f1-micro (2026-10-29): every request transformed whole national-forest
-- polygons to 3857. These copies are transformed and simplified once at write
-- time, so a request only clips indexed shapes with ST_AsMVTGeom.
--
-- Two levels, both from the full `boundary` (boundary_display is simplified by
-- bbox/1500, about 100-190 m on a national forest, which is tens of pixels off
-- at zoom 14):
--   shape      3 m Web Mercator tolerance, zooms 11-14 (under one pixel at
--              zoom 14; the app overzooms above 14)
--   shape_low  100 m, zooms 8-10 (about 1.3 px at zoom 10). NULL when the
--              area collapses at that tolerance; it would be sub-pixel there.
-- Plain ST_Simplify, not SimplifyPreserveTopology: the largest boundaries hold
-- 1.2M points. ST_MakeValid repairs what the simplify breaks.
--
-- A side table rather than columns on areas, like route_map_paths: the
-- backfill inserts and never rewrites areas rows, takes no row locks there,
-- and does not bump areas.updated_at.
--
-- Each area is stored as pieces: its polygon parts grouped by the 100 km Web
-- Mercator cell holding each part's bbox center. No polygon is cut, so fills
-- and edges show no seams, and the tile query collects an area's pieces back
-- into one feature. Without pieces, a zoom-12 tile near Juneau clipped all
-- 667k points of Tongass National Forest's 19,379 islands (30 ms on a laptop
-- for a 200-byte tile); with them it reads one cell. A single part stays whole
-- (the largest kept part is 44k points).
--
-- Storage: the 3 m shape keeps about 45% of boundary points (3.9M to 1.75M
-- over 123 WA and Alaska areas), so about 12M points and roughly 250 MB with
-- indexes for all 3,869 areas, on a 10 GB disk with 3.1 GB used. No new
-- disk is needed: ~$0/month (the bytes would be ~$0.04/month of PD-SSD).
--
-- Run as postgres with psql -f (not inside a transaction: the backfill
-- commits in batches).
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.area_map_shapes (
  area_id TEXT NOT NULL REFERENCES public.areas(id) ON DELETE CASCADE,
  piece INTEGER NOT NULL,
  shape public.geometry(MultiPolygon,3857) NOT NULL,
  shape_low public.geometry(MultiPolygon,3857),
  PRIMARY KEY (area_id, piece)
);
CREATE INDEX IF NOT EXISTS area_map_shapes_shape_idx ON public.area_map_shapes USING GIST(shape);
CREATE INDEX IF NOT EXISTS area_map_shapes_shape_low_idx ON public.area_map_shapes USING GIST(shape_low);
ALTER TABLE public.area_map_shapes OWNER TO postgres;
REVOKE INSERT, UPDATE, DELETE ON public.area_map_shapes FROM "peaks-api";
GRANT SELECT ON public.area_map_shapes TO "peaks-api";

-- Simplify, then repair each part on its own. ST_MakeValid over Tongass as
-- one 19,392-part MultiPolygon took 7.4 s on a laptop; part by part, 0.5 s.
-- A valid boundary's parts do not overlap, and ST_AsMVTGeom makes its own
-- output valid in any case. Returns no rows when nothing survives.
CREATE OR REPLACE FUNCTION public.area_map_parts(shape public.geometry, tolerance double precision)
RETURNS SETOF public.geometry LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT p.geom
  FROM public.ST_Dump(public.ST_Simplify(shape, tolerance)) d,
       LATERAL public.ST_Dump(public.ST_CollectionExtract(public.ST_MakeValid(d.geom), 3)) p
$$;
ALTER FUNCTION public.area_map_parts(public.geometry, double precision) OWNER TO postgres;

-- One row per 100 km cell: the 3 m shape, and the 100 m shape made from it
-- (NULL when the cell's parts are sub-pixel at zoom 10).
CREATE OR REPLACE FUNCTION public.area_map_pieces(boundary public.geometry)
RETURNS TABLE(piece integer, shape public.geometry, shape_low public.geometry)
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
  WITH parts AS (
    SELECT g,
      floor((public.ST_XMin(g) + public.ST_XMax(g)) / 200000.0) AS cell_x,
      floor((public.ST_YMin(g) + public.ST_YMax(g)) / 200000.0) AS cell_y
    FROM public.area_map_parts(public.ST_Transform(boundary, 3857), 3) g
  ), pieces AS (
    SELECT (row_number() OVER (ORDER BY cell_x, cell_y))::integer AS piece,
      public.ST_Multi(public.ST_Collect(g)) AS shape
    FROM parts GROUP BY cell_x, cell_y
  )
  SELECT piece, shape,
    (SELECT public.ST_Multi(public.ST_Collect(l)) FROM public.area_map_parts(shape, 100) l)
  FROM pieces
$$;
ALTER FUNCTION public.area_map_pieces(public.geometry) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.refresh_area_map_shape()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE'
    AND public.ST_AsEWKB(OLD.boundary) IS NOT DISTINCT FROM public.ST_AsEWKB(NEW.boundary)
    AND EXISTS (SELECT 1 FROM public.area_map_shapes WHERE area_id=NEW.id) THEN RETURN NULL; END IF;
  DELETE FROM public.area_map_shapes WHERE area_id=NEW.id;
  INSERT INTO public.area_map_shapes(area_id, piece, shape, shape_low)
    SELECT NEW.id, p.piece, p.shape, p.shape_low FROM public.area_map_pieces(NEW.boundary) p;
  RETURN NULL;
END $$;
ALTER FUNCTION public.refresh_area_map_shape() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.refresh_area_map_shape() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_areas_map_shape ON public.areas;
CREATE TRIGGER trg_areas_map_shape AFTER INSERT OR UPDATE OF boundary ON public.areas
  FOR EACH ROW EXECUTE FUNCTION public.refresh_area_map_shape();
COMMIT;

-- Backfill, 25 areas per commit so no transaction runs long on the largest
-- boundaries and a rerun resumes where it stopped. Each area's pieces land in
-- one statement; areas the trigger already wrote are skipped.
SET statement_timeout = 0;
DO $$
DECLARE
  area record;
  done integer := 0;
BEGIN
  FOR area IN
    SELECT a.id FROM public.areas a
    WHERE NOT EXISTS (SELECT 1 FROM public.area_map_shapes s WHERE s.area_id=a.id)
    ORDER BY a.id
  LOOP
    INSERT INTO public.area_map_shapes(area_id, piece, shape, shape_low)
    SELECT a.id, p.piece, p.shape, p.shape_low
    FROM public.areas a, LATERAL public.area_map_pieces(a.boundary) p
    WHERE a.id=area.id
      AND NOT EXISTS (SELECT 1 FROM public.area_map_shapes s WHERE s.area_id=a.id);
    done := done + 1;
    IF done % 25 = 0 THEN COMMIT; END IF;
  END LOOP;
  COMMIT;
END $$;
RESET statement_timeout;

ANALYZE public.area_map_shapes;

-- Verify (must return 0; an area missing here is missing from the map):
--   SELECT count(*) FROM areas a WHERE NOT EXISTS (SELECT 1 FROM area_map_shapes s WHERE s.area_id=a.id);
-- Invalid shapes should be a handful at most: simplifying parts one at a time
-- can make two neighbouring islands touch (36 of 523 pieces for 123 WA and
-- Alaska areas in a local run). Tiles still render; ST_AsMVTGeom repairs its
-- output.
--   SELECT count(*) FROM area_map_shapes WHERE NOT ST_IsValid(shape) OR NOT COALESCE(ST_IsValid(shape_low), true);
