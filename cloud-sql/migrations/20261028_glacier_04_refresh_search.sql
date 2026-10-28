BEGIN;
-- Keep glacier context in the existing narrow route candidate table. Glacier
-- terms carry 0.8, like trail names. No geometry joins enter search reads.
CREATE OR REPLACE FUNCTION public.refresh_route_search_terms(route_ids TEXT[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF route_ids IS NULL OR cardinality(route_ids)=0 THEN RETURN; END IF;
  DELETE FROM public.route_search_terms WHERE route_id=ANY(route_ids);
  INSERT INTO public.route_search_terms(route_id,term,public,weight,public_weight,owner,popularity,anchor)
  SELECT r.id,terms.term,bool_or(terms.public),max(terms.weight),max(terms.weight) FILTER(WHERE terms.public),
    r.owner,r.popularity,public.ST_Force2D(public.ST_StartPoint(r.path::public.geometry))::public.geography
  FROM public.routes r CROSS JOIN LATERAL (
    SELECT r.search_name AS term,true AS public,1.0::real AS weight
    UNION ALL SELECT public.peaks_search_name(alias),true,1.0::real FROM unnest(r.aliases) alias
    UNION ALL SELECT d.search_name,d.owner='peaks',1.0::real FROM public.destinations d WHERE d.id=r.objective_destination_id
    UNION ALL SELECT d.search_name,d.owner='peaks',1.0::real FROM public.route_destinations rd
      JOIN public.destinations d ON d.id=rd.destination_id WHERE rd.route_id=r.id
    UNION ALL SELECT public.peaks_search_name(trail_name),true,0.8::real FROM public.route_segments rs
      JOIN public.segments s ON s.id=rs.segment_id CROSS JOIN LATERAL unnest(s.trail_names) trail_name WHERE rs.route_id=r.id
    UNION ALL SELECT term,d.owner='peaks',0.8::real FROM (
      SELECT DISTINCT destination_id FROM public.route_glacier_crossings WHERE route_id=r.id AND r.glacier_match_input_hash IS NOT NULL
    ) c JOIN public.destinations d ON d.id=c.destination_id
      CROSS JOIN LATERAL unnest(ARRAY[d.search_name] ||
        ARRAY(SELECT public.peaks_search_name(alias) FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(d.metadata->'glacier_catalog'->'aliases')='array'
            THEN d.metadata->'glacier_catalog'->'aliases' ELSE '[]'::jsonb END) alias)) term
      WHERE 'glacier'::public.destination_feature=ANY(d.features) AND (d.owner='peaks' OR d.owner=r.owner)
  ) terms
  WHERE r.id=ANY(route_ids) AND r.status='active' AND terms.term IS NOT NULL AND terms.term<>''
  GROUP BY r.id,terms.term
  ON CONFLICT(route_id,term) DO UPDATE SET public=EXCLUDED.public,weight=EXCLUDED.weight,
    public_weight=EXCLUDED.public_weight,owner=EXCLUDED.owner,popularity=EXCLUDED.popularity,anchor=EXCLUDED.anchor;
END $$;
ALTER FUNCTION public.refresh_route_search_terms(text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.refresh_route_search_terms(text[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.queue_glacier_matches(did text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE affected text[];
BEGIN
  WITH queued AS (INSERT INTO public.route_glacier_rematch_queue(route_id)
    SELECT DISTINCT r.id FROM public.glacier_outline_parts bp JOIN public.routes r
      ON r.path IS NOT NULL AND public.ST_DWithin(r.path,bp.outline_part,1) WHERE bp.destination_id=did
    UNION SELECT route_id FROM public.route_glacier_crossings WHERE destination_id=did
    ON CONFLICT(route_id) DO UPDATE SET queued_at=now() RETURNING route_id)
    SELECT array_agg(route_id) INTO affected FROM queued;
  UPDATE public.routes r SET glacier_match_input_hash=NULL WHERE r.glacier_match_input_hash IS NOT NULL AND r.id=ANY(affected);
  PERFORM public.refresh_route_search_terms(affected);
  INSERT INTO public.session_rematch_queue(session_id,reason)
    SELECT DISTINCT s.id,'glacier:'||did FROM public.glacier_outline_parts bp
    JOIN public.tracking_sessions s ON s.ended=true AND s.path IS NOT NULL
      AND public.ST_DWithin(s.path,bp.outline_part,50) WHERE bp.destination_id=did
    ON CONFLICT(session_id) DO UPDATE SET reason=EXCLUDED.reason,queued_at=now();
  INSERT INTO public.session_rematch_queue(session_id,reason)
    SELECT DISTINCT session_id,'glacier:'||did FROM public.session_glacier_crossings WHERE destination_id=did
    ON CONFLICT(session_id) DO UPDATE SET reason=EXCLUDED.reason,queued_at=now();
  UPDATE public.tracking_sessions s SET glacier_match_input_hash=NULL,server_updated_at=now()
    WHERE s.glacier_match_input_hash IS NOT NULL AND EXISTS(
      SELECT 1 FROM public.session_rematch_queue q WHERE q.session_id=s.id AND q.reason='glacier:'||did);
END $$;

CREATE OR REPLACE FUNCTION public.glacier_boundary_before_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF (OLD.features::text[] @> ARRAY['glacier'] OR NEW.features::text[] @> ARRAY['glacier']) AND
    (public.ST_AsEWKB(OLD.boundary::public.geometry) IS DISTINCT FROM public.ST_AsEWKB(NEW.boundary::public.geometry)
     OR OLD.features IS DISTINCT FROM NEW.features OR OLD.owner IS DISTINCT FROM NEW.owner) THEN
    PERFORM public.queue_glacier_matches(OLD.id); -- old stored pieces still exist
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_glacier_boundary_before ON public.destinations;
CREATE TRIGGER trg_glacier_boundary_before BEFORE UPDATE OF boundary,features,owner ON public.destinations
  FOR EACH ROW EXECUTE FUNCTION public.glacier_boundary_before_change();

CREATE OR REPLACE FUNCTION public.glacier_boundary_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF (OLD.features::text[] @> ARRAY['glacier'] OR NEW.features::text[] @> ARRAY['glacier']) AND
    (public.ST_AsEWKB(OLD.boundary::public.geometry) IS DISTINCT FROM public.ST_AsEWKB(NEW.boundary::public.geometry)
     OR OLD.features IS DISTINCT FROM NEW.features OR OLD.owner IS DISTINCT FROM NEW.owner) THEN
    UPDATE public.destination_glacier_facts SET outline_revision=outline_revision+1,updated_at=now() WHERE destination_id=NEW.id;
    PERFORM public.queue_glacier_matches(NEW.id); -- runs after the parts trigger
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_zz_glacier_boundary_after ON public.destinations;
CREATE TRIGGER trg_zz_glacier_boundary_after AFTER UPDATE OF boundary,features,owner ON public.destinations
  FOR EACH ROW EXECUTE FUNCTION public.glacier_boundary_after_change();

-- Queue the old pieces before replacing them, including cached empty matches.
-- An outline-only edit also advances the geometry revision.
CREATE OR REPLACE FUNCTION public.glacier_outline_before_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF public.ST_AsEWKB(OLD.outline::public.geometry) IS DISTINCT FROM public.ST_AsEWKB(NEW.outline::public.geometry) THEN
    PERFORM public.queue_glacier_matches(OLD.destination_id);
    NEW.outline_revision := OLD.outline_revision+1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_glacier_outline_before ON public.destination_glacier_facts;
CREATE TRIGGER trg_glacier_outline_before BEFORE UPDATE OF outline ON public.destination_glacier_facts
  FOR EACH ROW EXECUTE FUNCTION public.glacier_outline_before_change();

CREATE OR REPLACE FUNCTION public.glacier_outline_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND public.ST_AsEWKB(OLD.outline::public.geometry)
    IS NOT DISTINCT FROM public.ST_AsEWKB(NEW.outline::public.geometry) THEN RETURN NULL; END IF;
  PERFORM public.queue_glacier_matches(NEW.destination_id);
  RETURN NULL;
END $$;
-- PostgreSQL runs same-event triggers by name: the new pieces must exist first.
DROP TRIGGER IF EXISTS trg_zz_glacier_outline_after ON public.destination_glacier_facts;
CREATE TRIGGER trg_zz_glacier_outline_after AFTER INSERT OR UPDATE OF outline ON public.destination_glacier_facts
  FOR EACH ROW EXECUTE FUNCTION public.glacier_outline_after_change();

-- Deletion must invalidate saved match markers before cascades remove spans.
CREATE OR REPLACE FUNCTION public.glacier_facts_before_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN PERFORM public.queue_glacier_matches(OLD.destination_id); RETURN OLD; END $$;
DROP TRIGGER IF EXISTS trg_glacier_facts_delete ON public.destination_glacier_facts;
CREATE TRIGGER trg_glacier_facts_delete BEFORE DELETE ON public.destination_glacier_facts
  FOR EACH ROW EXECUTE FUNCTION public.glacier_facts_before_delete();

-- Names and ownership must refresh routes that borrow a glacier name even
-- though geometric crossings never enter route_destinations / saved goals.
CREATE OR REPLACE FUNCTION public.route_search_terms_on_destination_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refresh_route_search_terms(ARRAY(
    SELECT r.id FROM public.routes r WHERE r.objective_destination_id=NEW.id
    UNION SELECT rd.route_id FROM public.route_destinations rd WHERE rd.destination_id=NEW.id
    UNION SELECT c.route_id FROM public.route_glacier_crossings c WHERE c.destination_id=NEW.id));
  RETURN NULL;
END $$;
ALTER FUNCTION public.route_search_terms_on_destination_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.route_search_terms_on_destination_change() FROM PUBLIC;

DO $$ DECLARE f regprocedure; BEGIN
  FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (
    'queue_glacier_matches','glacier_boundary_before_change','glacier_boundary_after_change',
    'glacier_outline_before_change','glacier_outline_after_change','glacier_facts_before_delete') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.queue_glacier_matches(text) TO "peaks-api";
COMMIT;
