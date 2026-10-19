-- A name a route only borrows from a segment's trail counts for 0.8 of its own
-- name, alias, or linked place. Mount Stuart via Cascadian Couloir walks 2 km of
-- Ingalls Way, so it matched "ingalls" as strongly as the hikes and places named
-- Ingalls and ranked first (Josiah approved the discount, 2026-10-18).
--
-- `weight` is the best weight over every source of a term; `public_weight` the
-- best over public sources only (NULL when none), so a private place's name
-- never lifts a signed-out score. `public` stays as public_weight IS NOT NULL.
--
-- Run as postgres after 20261019_route_search_terms_fixes.sql. Cost: ~$0/month.

BEGIN;

ALTER TABLE route_search_terms ADD COLUMN IF NOT EXISTS weight REAL NOT NULL DEFAULT 1;
ALTER TABLE route_search_terms ADD COLUMN IF NOT EXISTS public_weight REAL;

CREATE OR REPLACE FUNCTION refresh_route_search_terms(route_ids TEXT[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF route_ids IS NULL OR cardinality(route_ids) = 0 THEN RETURN; END IF;
  DELETE FROM public.route_search_terms WHERE route_id = ANY(route_ids);
  INSERT INTO public.route_search_terms (route_id, term, public, weight, public_weight, owner, popularity, anchor)
  SELECT r.id, terms.term, bool_or(terms.public), max(terms.weight),
         max(terms.weight) FILTER (WHERE terms.public),
         r.owner, r.popularity,
         public.ST_Force2D(public.ST_StartPoint(r.path::public.geometry))::public.geography
  FROM public.routes r
  CROSS JOIN LATERAL (
    SELECT r.search_name AS term, true AS public, 1.0::real AS weight
    UNION ALL
    SELECT public.peaks_search_name(alias), true, 1.0::real FROM unnest(r.aliases) alias
    UNION ALL
    SELECT d.search_name, d.owner = 'peaks', 1.0::real
    FROM public.destinations d WHERE d.id = r.objective_destination_id
    UNION ALL
    SELECT d.search_name, d.owner = 'peaks', 1.0::real
    FROM public.route_destinations rd JOIN public.destinations d ON d.id = rd.destination_id
    WHERE rd.route_id = r.id
    UNION ALL
    SELECT public.peaks_search_name(trail_name), true, 0.8::real
    FROM public.route_segments rs JOIN public.segments s ON s.id = rs.segment_id
    CROSS JOIN LATERAL unnest(s.trail_names) trail_name
    WHERE rs.route_id = r.id
  ) terms
  WHERE r.id = ANY(route_ids)
    AND r.status = 'active'
    AND terms.term IS NOT NULL AND terms.term <> ''
  GROUP BY r.id, terms.term
  -- Two writers refreshing one route at once: the second's DELETE cannot see
  -- rows the first just inserted, so a plain INSERT would fail its write.
  ON CONFLICT (route_id, term) DO UPDATE
    SET public = EXCLUDED.public, weight = EXCLUDED.weight, public_weight = EXCLUDED.public_weight,
        owner = EXCLUDED.owner, popularity = EXCLUDED.popularity, anchor = EXCLUDED.anchor;
END;
$$;
ALTER FUNCTION refresh_route_search_terms(TEXT[]) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION refresh_route_search_terms(TEXT[]) FROM PUBLIC;

SELECT refresh_route_search_terms(array_agg(id)) FROM routes WHERE status = 'active';

COMMIT;

ANALYZE route_search_terms;
