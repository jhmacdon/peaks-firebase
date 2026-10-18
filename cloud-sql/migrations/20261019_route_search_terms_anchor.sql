-- Route search's proximity bonus measured each shortlisted route's whole path
-- with geodesic ST_Distance: about 13 ms per long route on the db-f1-micro,
-- most of a search's time. Store the path's start point with each term row and
-- measure to that instead. Proximity is worth at most 0.05 on a 500 km scale,
-- so a route's start and its nearest point score within a few thousandths of
-- each other. No client reads a route's distance_m.
--
-- Run as postgres after 20261019_route_search_terms.sql. Cost: ~$0/month.

BEGIN;

ALTER TABLE route_search_terms ADD COLUMN IF NOT EXISTS anchor geography(Point, 4326);

CREATE OR REPLACE FUNCTION refresh_route_search_terms(route_ids TEXT[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF route_ids IS NULL OR cardinality(route_ids) = 0 THEN RETURN; END IF;
  DELETE FROM public.route_search_terms WHERE route_id = ANY(route_ids);
  INSERT INTO public.route_search_terms (route_id, term, public, owner, popularity, anchor)
  SELECT DISTINCT r.id, terms.term, terms.public, r.owner, r.popularity,
         public.ST_Force2D(public.ST_StartPoint(r.path::public.geometry))::public.geography
  FROM public.routes r
  CROSS JOIN LATERAL (
    SELECT r.search_name AS term, true AS public
    UNION ALL
    SELECT public.peaks_search_name(alias), true FROM unnest(r.aliases) alias
    UNION ALL
    SELECT d.search_name, d.owner = 'peaks'
    FROM public.destinations d WHERE d.id = r.objective_destination_id
    UNION ALL
    SELECT d.search_name, d.owner = 'peaks'
    FROM public.route_destinations rd JOIN public.destinations d ON d.id = rd.destination_id
    WHERE rd.route_id = r.id
    UNION ALL
    SELECT public.peaks_search_name(trail_name), true
    FROM public.route_segments rs JOIN public.segments s ON s.id = rs.segment_id
    CROSS JOIN LATERAL unnest(s.trail_names) trail_name
    WHERE rs.route_id = r.id
  ) terms
  WHERE r.id = ANY(route_ids)
    AND r.status = 'active'
    AND terms.term IS NOT NULL AND terms.term <> ''
  -- Two writers refreshing one route at once: the second's DELETE cannot see
  -- rows the first just inserted, so a plain INSERT would fail its write.
  ON CONFLICT (route_id, term, public) DO UPDATE
    SET owner = EXCLUDED.owner, popularity = EXCLUDED.popularity, anchor = EXCLUDED.anchor;
END;
$$;
ALTER FUNCTION refresh_route_search_terms(TEXT[]) OWNER TO postgres;

-- A path whose start moves moves the anchor. The WHEN clause runs with the
-- writer's search_path, so PostGIS calls are schema-qualified.
DROP TRIGGER IF EXISTS trg_routes_search_terms_update ON routes;
CREATE TRIGGER trg_routes_search_terms_update
  AFTER UPDATE OF status, owner, popularity, search_name, aliases, objective_destination_id, path ON routes
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
     OR OLD.owner IS DISTINCT FROM NEW.owner
     OR OLD.popularity IS DISTINCT FROM NEW.popularity
     OR OLD.search_name IS DISTINCT FROM NEW.search_name
     OR OLD.aliases IS DISTINCT FROM NEW.aliases
     OR OLD.objective_destination_id IS DISTINCT FROM NEW.objective_destination_id
     OR public.ST_AsEWKB(public.ST_StartPoint(OLD.path::public.geometry))
        IS DISTINCT FROM public.ST_AsEWKB(public.ST_StartPoint(NEW.path::public.geometry)))
  EXECUTE FUNCTION route_search_terms_on_route_change();

SELECT refresh_route_search_terms(array_agg(id)) FROM routes WHERE status = 'active';

COMMIT;

ANALYZE route_search_terms;
