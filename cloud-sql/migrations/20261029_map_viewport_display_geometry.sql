-- Stored display geometry for GET /api/map/viewport. No new service; a few MB
-- of table and index storage on the existing instance (~$0/month).
--
-- The endpoint simplified full outlines and clipped full route paths on every
-- request. On the db-f1-micro a 10 km Rainier view took 6.5 s for 26 glaciers
-- and 12 s for 15 candidate trails, almost all of it geography ST_Intersects
-- against ~8,000-point paths and ST_SimplifyPreserveTopology on outlines
-- (2026-10-29). These copies are simplified once at write time and tested in
-- geometry space.
--
-- Run as postgres with psql -f. The backfill runs after the triggers commit,
-- so it holds no write lock on routes while it reads every active path.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Two levels: map_outline_low (about 10 m) below zoom 14, map_outline (about
-- 2 m) from 14. Generated columns follow every outline write with no trigger.
-- 109 rows today, so the table rewrite is instant.
ALTER TABLE public.destination_glacier_facts
  ADD COLUMN IF NOT EXISTS map_outline public.geometry(MultiPolygon,4326)
    GENERATED ALWAYS AS (public.ST_Multi(public.ST_SimplifyPreserveTopology(outline::public.geometry, 0.00002))) STORED,
  ADD COLUMN IF NOT EXISTS map_outline_low public.geometry(MultiPolygon,4326)
    GENERATED ALWAYS AS (public.ST_Multi(public.ST_SimplifyPreserveTopology(outline::public.geometry, 0.0001))) STORED;
CREATE INDEX IF NOT EXISTS destination_glacier_facts_map_outline_idx
  ON public.destination_glacier_facts USING GIST(map_outline);

-- One 2D, simplified path per active Peaks route. Only the map reads it; the
-- route row stays the source of truth and its own triggers keep this current.
CREATE TABLE IF NOT EXISTS public.route_map_paths (
  route_id TEXT PRIMARY KEY REFERENCES public.routes(id) ON DELETE CASCADE,
  path public.geometry(MultiLineString,4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS route_map_paths_path_idx ON public.route_map_paths USING GIST(path);
ALTER TABLE public.route_map_paths OWNER TO postgres;
GRANT SELECT ON public.route_map_paths TO "peaks-api";

-- 0.00001 degrees matches the tolerance the endpoint applied per request.
CREATE OR REPLACE FUNCTION public.route_map_path_geometry(path public.geography)
RETURNS public.geometry LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.ST_Multi(public.ST_SimplifyPreserveTopology(public.ST_Force2D(path::public.geometry), 0.00001))
$$;
ALTER FUNCTION public.route_map_path_geometry(public.geography) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.refresh_route_map_path()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.owner='peaks' AND NEW.status='active' AND NEW.path IS NOT NULL THEN
    IF TG_OP='UPDATE' AND OLD.owner='peaks' AND OLD.status='active'
      AND public.ST_AsEWKB(OLD.path::public.geometry) IS NOT DISTINCT FROM public.ST_AsEWKB(NEW.path::public.geometry)
      AND EXISTS (SELECT 1 FROM public.route_map_paths WHERE route_id=NEW.id) THEN RETURN NULL; END IF;
    INSERT INTO public.route_map_paths(route_id,path) VALUES(NEW.id,public.route_map_path_geometry(NEW.path))
      ON CONFLICT(route_id) DO UPDATE SET path=EXCLUDED.path;
  ELSE
    DELETE FROM public.route_map_paths WHERE route_id=NEW.id;
  END IF;
  RETURN NULL;
END $$;
ALTER FUNCTION public.refresh_route_map_path() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.refresh_route_map_path() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_routes_map_path ON public.routes;
CREATE TRIGGER trg_routes_map_path AFTER INSERT OR UPDATE OF path, owner, status ON public.routes
  FOR EACH ROW EXECUTE FUNCTION public.refresh_route_map_path();
COMMIT;

-- Backfill. A route the trigger already wrote keeps that row.
INSERT INTO public.route_map_paths(route_id,path)
SELECT r.id, public.route_map_path_geometry(r.path)
FROM public.routes r
WHERE r.owner='peaks' AND r.status='active' AND r.path IS NOT NULL
ON CONFLICT(route_id) DO NOTHING;

-- A route retired while the backfill read it must not stay on the map.
DELETE FROM public.route_map_paths m
WHERE NOT EXISTS (SELECT 1 FROM public.routes r
  WHERE r.id=m.route_id AND r.owner='peaks' AND r.status='active' AND r.path IS NOT NULL);

ANALYZE public.route_map_paths;
ANALYZE public.destination_glacier_facts;

-- Verify (both must return 0):
--   SELECT count(*) FROM routes r WHERE r.owner='peaks' AND r.status='active' AND r.path IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM route_map_paths m WHERE m.route_id=r.id);
--   SELECT count(*) FROM destination_glacier_facts WHERE map_outline IS NULL OR map_outline_low IS NULL;
