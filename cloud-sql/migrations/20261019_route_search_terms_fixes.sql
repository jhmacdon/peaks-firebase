-- Review fixes for route_search_terms (20261019_route_search_terms.sql and
-- 20261019_route_search_terms_anchor.sql).
--
-- 1. A name-only rename left the old name. trg_routes_catalog_derived_metadata
--    sets search_name in a BEFORE trigger, but AFTER UPDATE OF fires on the
--    statement's SET list, which held only name. `name` joins the list.
-- 2. The foreign key to routes made a segment or destination rename take
--    FOR KEY SHARE on linked routes, which deadlocks with catalog jobs that
--    lock routes first. A statement trigger on routes deletes rows instead.
-- 3. Rows keyed on (route_id, term, public) let a race keep a stale public
--    row next to a newer private one. Key on (route_id, term); a term is
--    public if any of its sources is, and the upsert overwrites the flag.
-- 4. The WHEN clause read whole OLD and NEW paths on every popularity or
--    metadata update. A separate trigger fires only when path is SET.
-- 5. Only the triggers call refresh_route_search_terms.
--
-- Run as postgres after the two migrations above. Cost: ~$0/month.

BEGIN;

ALTER TABLE route_search_terms DROP CONSTRAINT IF EXISTS route_search_terms_route_id_fkey;

DELETE FROM route_search_terms private_row
USING route_search_terms public_row
WHERE NOT private_row.public AND public_row.public
  AND private_row.route_id = public_row.route_id AND private_row.term = public_row.term;
ALTER TABLE route_search_terms DROP CONSTRAINT IF EXISTS route_search_terms_route_id_term_public_key;
ALTER TABLE route_search_terms ADD CONSTRAINT route_search_terms_route_id_term_key UNIQUE (route_id, term);

CREATE OR REPLACE FUNCTION refresh_route_search_terms(route_ids TEXT[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF route_ids IS NULL OR cardinality(route_ids) = 0 THEN RETURN; END IF;
  DELETE FROM public.route_search_terms WHERE route_id = ANY(route_ids);
  INSERT INTO public.route_search_terms (route_id, term, public, owner, popularity, anchor)
  SELECT r.id, terms.term, bool_or(terms.public), r.owner, r.popularity,
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
  GROUP BY r.id, terms.term
  -- Two writers refreshing one route at once: the second's DELETE cannot see
  -- rows the first just inserted, so a plain INSERT would fail its write.
  ON CONFLICT (route_id, term) DO UPDATE
    SET public = EXCLUDED.public, owner = EXCLUDED.owner,
        popularity = EXCLUDED.popularity, anchor = EXCLUDED.anchor;
END;
$$;
ALTER FUNCTION refresh_route_search_terms(TEXT[]) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION refresh_route_search_terms(TEXT[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION route_search_terms_on_route_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  DELETE FROM public.route_search_terms t USING old_routes o WHERE t.route_id = o.id;
  RETURN NULL;
END;
$$;
ALTER FUNCTION route_search_terms_on_route_delete() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_routes_search_terms_delete ON routes;
CREATE TRIGGER trg_routes_search_terms_delete
  AFTER DELETE ON routes REFERENCING OLD TABLE AS old_routes
  FOR EACH STATEMENT EXECUTE FUNCTION route_search_terms_on_route_delete();

DROP TRIGGER IF EXISTS trg_routes_search_terms_update ON routes;
CREATE TRIGGER trg_routes_search_terms_update
  AFTER UPDATE OF status, owner, popularity, name, search_name, aliases, objective_destination_id ON routes
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
     OR OLD.owner IS DISTINCT FROM NEW.owner
     OR OLD.popularity IS DISTINCT FROM NEW.popularity
     OR OLD.search_name IS DISTINCT FROM NEW.search_name
     OR OLD.aliases IS DISTINCT FROM NEW.aliases
     OR OLD.objective_destination_id IS DISTINCT FROM NEW.objective_destination_id)
  EXECUTE FUNCTION route_search_terms_on_route_change();

-- Fires only when a statement sets path; reads both paths only then.
DROP TRIGGER IF EXISTS trg_routes_search_terms_path ON routes;
CREATE TRIGGER trg_routes_search_terms_path
  AFTER UPDATE OF path ON routes
  FOR EACH ROW
  WHEN (ST_AsEWKB(ST_StartPoint(OLD.path::geometry))
        IS DISTINCT FROM ST_AsEWKB(ST_StartPoint(NEW.path::geometry)))
  EXECUTE FUNCTION route_search_terms_on_route_change();

-- Renames made before this migration kept their old names.
SELECT refresh_route_search_terms(array_agg(r.id))
FROM routes r
WHERE r.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM route_search_terms t WHERE t.route_id = r.id AND t.term = r.search_name);

COMMIT;
