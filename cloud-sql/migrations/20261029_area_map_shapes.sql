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
  area_id TEXT PRIMARY KEY REFERENCES public.areas(id) ON DELETE CASCADE,
  shape public.geometry(MultiPolygon,3857) NOT NULL,
  shape_low public.geometry(MultiPolygon,3857)
);
CREATE INDEX IF NOT EXISTS area_map_shapes_shape_idx ON public.area_map_shapes USING GIST(shape);
CREATE INDEX IF NOT EXISTS area_map_shapes_shape_low_idx ON public.area_map_shapes USING GIST(shape_low);
ALTER TABLE public.area_map_shapes OWNER TO postgres;
REVOKE INSERT, UPDATE, DELETE ON public.area_map_shapes FROM "peaks-api";
GRANT SELECT ON public.area_map_shapes TO "peaks-api";

-- MultiPolygon in 3857, or NULL when nothing survives the tolerance. Each
-- part is repaired on its own: ST_MakeValid over Tongass National Forest as one
-- 19,392-part MultiPolygon took 7.4 s on a laptop, part by part 0.5 s, and a
-- valid boundary's parts do not overlap (the result still passes ST_IsValid).
-- ST_AsMVTGeom makes its own output valid in any case.
CREATE OR REPLACE FUNCTION public.area_map_shape(boundary public.geometry, tolerance double precision)
RETURNS public.geometry LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.ST_Multi(public.ST_Collect(p.geom))
  FROM public.ST_Dump(public.ST_Simplify(public.ST_Transform(boundary, 3857), tolerance)) d,
       LATERAL public.ST_Dump(public.ST_CollectionExtract(public.ST_MakeValid(d.geom), 3)) p
$$;
ALTER FUNCTION public.area_map_shape(public.geometry, double precision) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.refresh_area_map_shape()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  detail public.geometry;
BEGIN
  IF TG_OP='UPDATE'
    AND public.ST_AsEWKB(OLD.boundary) IS NOT DISTINCT FROM public.ST_AsEWKB(NEW.boundary)
    AND EXISTS (SELECT 1 FROM public.area_map_shapes WHERE area_id=NEW.id) THEN RETURN NULL; END IF;
  detail := public.area_map_shape(NEW.boundary, 3);
  IF detail IS NULL THEN
    DELETE FROM public.area_map_shapes WHERE area_id=NEW.id;
  ELSE
    INSERT INTO public.area_map_shapes(area_id, shape, shape_low)
      VALUES (NEW.id, detail, public.area_map_shape(NEW.boundary, 100))
      ON CONFLICT (area_id) DO UPDATE SET shape=EXCLUDED.shape, shape_low=EXCLUDED.shape_low;
  END IF;
  RETURN NULL;
END $$;
ALTER FUNCTION public.refresh_area_map_shape() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.refresh_area_map_shape() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_areas_map_shape ON public.areas;
CREATE TRIGGER trg_areas_map_shape AFTER INSERT OR UPDATE OF boundary ON public.areas
  FOR EACH ROW EXECUTE FUNCTION public.refresh_area_map_shape();
COMMIT;

-- Backfill, 25 areas per commit so no single statement runs long on the
-- largest boundaries and a rerun resumes where it stopped. Rows the trigger
-- already wrote are kept.
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
    INSERT INTO public.area_map_shapes(area_id, shape, shape_low)
    SELECT a.id, d.shape, public.area_map_shape(a.boundary, 100)
    FROM public.areas a, LATERAL (SELECT public.area_map_shape(a.boundary, 3) AS shape) d
    WHERE a.id=area.id AND d.shape IS NOT NULL
    ON CONFLICT (area_id) DO NOTHING;
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
-- can make two neighbouring islands touch (3 of 123 WA/Alaska areas in a local
-- run). Tiles still render; ST_AsMVTGeom repairs its output.
--   SELECT count(*) FROM area_map_shapes WHERE NOT ST_IsValid(shape) OR NOT COALESCE(ST_IsValid(shape_low), true);
