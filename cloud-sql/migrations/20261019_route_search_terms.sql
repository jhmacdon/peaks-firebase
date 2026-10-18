-- Route search reads one narrow row per (active route, searchable term) instead
-- of fuzzy-matching routes and segments at query time. Those rows carry paths,
-- polylines, and elevation strings, so every trigram recheck pulled fat pages
-- into a 128 MB cache: on 2026-10-18 the route query took 0.7 s warm and up to
-- 60 s cold for one user on the db-f1-micro. The same match against this table
-- took 15 ms.
--
-- Terms are the ones the old query gathered per route: its search name, its
-- aliases, its objective and linked destination names, and its segments' trail
-- names. `public` is false only for a destination name whose destination is not
-- Peaks-owned; signed-out search skips those rows. `owner` and `popularity`
-- copy the route so the search can shortlist before reading routes. The API
-- still rechecks status and access on the routes row itself.
--
-- Triggers keep the table current, so bulk writers need nothing extra. The
-- functions are SECURITY DEFINER with a fixed search_path, so any writer role
-- (and autovacuum, see 20261018_qualify_peaks_search_names.sql) works.
--
-- Run as postgres. Cost: ~$0/month; about 10 MB of table and indexes on the
-- existing instance, no new service.

BEGIN;

CREATE TABLE IF NOT EXISTS route_search_terms (
  route_id   TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  term       TEXT NOT NULL,
  public     BOOLEAN NOT NULL,
  owner      TEXT NOT NULL,
  popularity INTEGER NOT NULL,
  UNIQUE (route_id, term, public)
);
ALTER TABLE route_search_terms OWNER TO postgres;
GRANT SELECT ON route_search_terms TO "peaks-api";

CREATE INDEX IF NOT EXISTS idx_route_search_terms_trgm
  ON route_search_terms USING gin (term gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_route_search_terms_fts
  ON route_search_terms USING gin (to_tsvector('simple', term));

CREATE OR REPLACE FUNCTION refresh_route_search_terms(route_ids TEXT[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF route_ids IS NULL OR cardinality(route_ids) = 0 THEN RETURN; END IF;
  DELETE FROM public.route_search_terms WHERE route_id = ANY(route_ids);
  INSERT INTO public.route_search_terms (route_id, term, public, owner, popularity)
  SELECT DISTINCT r.id, terms.term, terms.public, r.owner, r.popularity
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
    AND terms.term IS NOT NULL AND terms.term <> '';
END;
$$;
ALTER FUNCTION refresh_route_search_terms(TEXT[]) OWNER TO postgres;

CREATE OR REPLACE FUNCTION route_search_terms_on_route_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM public.refresh_route_search_terms(ARRAY[NEW.id]);
  RETURN NULL;
END;
$$;
ALTER FUNCTION route_search_terms_on_route_change() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_routes_search_terms_insert ON routes;
CREATE TRIGGER trg_routes_search_terms_insert
  AFTER INSERT ON routes
  FOR EACH ROW EXECUTE FUNCTION route_search_terms_on_route_change();

DROP TRIGGER IF EXISTS trg_routes_search_terms_update ON routes;
CREATE TRIGGER trg_routes_search_terms_update
  AFTER UPDATE OF status, owner, popularity, search_name, aliases, objective_destination_id ON routes
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
     OR OLD.owner IS DISTINCT FROM NEW.owner
     OR OLD.popularity IS DISTINCT FROM NEW.popularity
     OR OLD.search_name IS DISTINCT FROM NEW.search_name
     OR OLD.aliases IS DISTINCT FROM NEW.aliases
     OR OLD.objective_destination_id IS DISTINCT FROM NEW.objective_destination_id)
  EXECUTE FUNCTION route_search_terms_on_route_change();

-- One refresh per statement for every route whose links changed. The catalog
-- loaders write thousands of links in one statement.
CREATE OR REPLACE FUNCTION route_search_terms_on_link_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE ids TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT route_id) INTO ids FROM new_links;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT route_id) INTO ids FROM old_links;
  ELSE
    SELECT array_agg(DISTINCT route_id) INTO ids FROM (
      SELECT route_id FROM old_links UNION SELECT route_id FROM new_links
    ) changed;
  END IF;
  PERFORM public.refresh_route_search_terms(ids);
  RETURN NULL;
END;
$$;
ALTER FUNCTION route_search_terms_on_link_change() OWNER TO postgres;

DO $$ DECLARE tbl TEXT; evt TEXT; old_ref TEXT; new_ref TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['route_segments','route_destinations'] LOOP
    FOREACH evt IN ARRAY ARRAY['insert','update','delete'] LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_'||tbl||'_search_terms_'||evt, tbl);
      old_ref := CASE WHEN evt IN ('update','delete') THEN 'OLD TABLE AS old_links ' ELSE '' END;
      new_ref := CASE WHEN evt IN ('update','insert') THEN 'NEW TABLE AS new_links ' ELSE '' END;
      EXECUTE format('CREATE TRIGGER %I AFTER %s ON %I REFERENCING %s%s FOR EACH STATEMENT EXECUTE FUNCTION route_search_terms_on_link_change()',
        'trg_'||tbl||'_search_terms_'||evt, upper(evt), tbl, old_ref, new_ref);
    END LOOP;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION route_search_terms_on_segment_names()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM public.refresh_route_search_terms(
    ARRAY(SELECT DISTINCT rs.route_id FROM public.route_segments rs WHERE rs.segment_id = NEW.id));
  RETURN NULL;
END;
$$;
ALTER FUNCTION route_search_terms_on_segment_names() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_segments_search_terms ON segments;
CREATE TRIGGER trg_segments_search_terms
  AFTER UPDATE OF trail_names ON segments
  FOR EACH ROW WHEN (OLD.trail_names IS DISTINCT FROM NEW.trail_names)
  EXECUTE FUNCTION route_search_terms_on_segment_names();

CREATE OR REPLACE FUNCTION route_search_terms_on_destination_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM public.refresh_route_search_terms(ARRAY(
    SELECT r.id FROM public.routes r WHERE r.objective_destination_id = NEW.id
    UNION
    SELECT rd.route_id FROM public.route_destinations rd WHERE rd.destination_id = NEW.id));
  RETURN NULL;
END;
$$;
ALTER FUNCTION route_search_terms_on_destination_change() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_destinations_search_terms ON destinations;
CREATE TRIGGER trg_destinations_search_terms
  AFTER UPDATE OF search_name, owner ON destinations
  FOR EACH ROW
  WHEN (OLD.search_name IS DISTINCT FROM NEW.search_name OR OLD.owner IS DISTINCT FROM NEW.owner)
  EXECUTE FUNCTION route_search_terms_on_destination_change();

SELECT refresh_route_search_terms(array_agg(id)) FROM routes WHERE status = 'active';

COMMIT;

ANALYZE route_search_terms;
