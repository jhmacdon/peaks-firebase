-- One edge/interval engine for routes, live session processing and repairs.
-- Exact parts select candidates. Remove true border travel and test original
-- polygon interiors, retaining subdivision seams. No shore buffer.
BEGIN;

CREATE OR REPLACE FUNCTION public.glacier_edges(vertices jsonb, recording boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  WITH points AS MATERIALIZED (
    SELECT ord::int AS i, COALESCE((v->>'s')::int,0) AS s,
      public.ST_SetSRID(public.ST_MakePoint((v->>'x')::float8,(v->>'y')::float8),4326) AS p,
      CASE WHEN v->>'z' NOT IN ('NaN','Infinity','-Infinity') THEN (v->>'z')::float8 END AS z,
      CASE WHEN v->>'t' NOT IN ('NaN','Infinity','-Infinity') AND (v->>'t')::float8 > 0 THEN (v->>'t')::float8 END AS t
    FROM jsonb_array_elements(vertices) WITH ORDINALITY a(v,ord)
  ), pairs AS MATERIALIZED (
    SELECT *,lead(p) OVER w AS b,lead(z) OVER w AS z1,lead(t) OVER w AS t1,lead(s) OVER w AS s1
    FROM points WINDOW w AS (ORDER BY i)
  ), measured AS MATERIALIZED (
    SELECT *, public.ST_Distance(p::public.geography,b::public.geography) AS len,
      b IS NOT NULL AND s=s1 AND (NOT recording OR
        (public.ST_Distance(p::public.geography,b::public.geography)<=1000
         AND (t IS NULL OR t1 IS NULL OR t1-t BETWEEN 0 AND 1200))) AS allowed
    FROM pairs
  ), blocks AS MATERIALIZED (
    SELECT *,COALESCE(sum(CASE WHEN allowed THEN 0 ELSE 1 END)
      OVER (ORDER BY i ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)::int AS line,
      COALESCE(sum(CASE WHEN allowed THEN len ELSE 0 END)
      OVER (ORDER BY i ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS along_m
    FROM measured
  ), samples AS MATERIALIZED (
    -- Stationary duplicate positions still carry real elevation/time samples.
    SELECT line,along_m,min(z) AS min_z,max(z) AS max_z,
      (array_agg(z ORDER BY i))[1] AS first_z,(array_agg(z ORDER BY i DESC))[1] AS last_z,
      (array_agg(t ORDER BY i))[1] AS first_t,(array_agg(t ORDER BY i DESC))[1] AS last_t
    FROM blocks WHERE p IS NOT NULL GROUP BY line,along_m
  ), edges AS MATERIALIZED (
    SELECT *,i=min(i) OVER (PARTITION BY line) AS first,
      i=max(i) OVER (PARTITION BY line) AS last
    FROM blocks WHERE allowed AND len>0
  ), edge_samples AS MATERIALIZED (
    SELECT e.*,a.min_z AS start_min_z,a.max_z AS start_max_z,b.min_z AS end_min_z,b.max_z AS end_max_z,
      a.first_z AS start_z,b.last_z AS end_z,a.first_t AS start_t,b.last_t AS end_t
    FROM edges e LEFT JOIN samples a ON a.line=e.line AND a.along_m=e.along_m
    LEFT JOIN samples b ON b.line=e.line AND b.along_m=e.along_m+e.len
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('line',line,'segment_number',s,'edge',i,
    'along_m',along_m,'length_m',len,'a',ARRAY[public.ST_X(p),public.ST_Y(p)],
    'b',ARRAY[public.ST_X(b),public.ST_Y(b)],'z0',z,'z1',z1,'t0',t,'t1',t1,'first',first,'last',last,
    'start_min_z',start_min_z,'start_max_z',start_max_z,'end_min_z',end_min_z,'end_max_z',end_max_z,
    'start_z',start_z,'end_z',end_z,'start_t',start_t,'end_t',end_t) ORDER BY i),'[]'::jsonb)
  FROM edge_samples e
  -- Candidate edges only enter the clipping engine. Distances still include
  -- all valid preceding edges. An indexed 1 m gate is a superset, not a buffer
  -- for crossing evidence. The actual intersection below has zero tolerance.
  WHERE EXISTS (SELECT 1 FROM public.glacier_outline_parts bp
    JOIN public.destination_glacier_facts gf ON gf.destination_id=bp.destination_id
    JOIN public.destinations d ON d.id=gf.destination_id
    WHERE 'glacier'::public.destination_feature=ANY(d.features)
      AND public.ST_DWithin(bp.outline_part,public.ST_MakeLine(e.p,e.b)::public.geography,1));
$$;

CREATE OR REPLACE FUNCTION public.glacier_crossing_intervals(edge_inputs jsonb)
RETURNS TABLE (
  destination_id text, pass_index integer, segment_number integer,
  entered_distance_m double precision, exited_distance_m double precision, crossed_distance_m double precision,
  entered_at timestamptz, exited_at timestamptz,
  entry_elevation_m double precision, exit_elevation_m double precision,
  min_elevation_m double precision, max_elevation_m double precision,
  starts_inside boolean, ends_inside boolean,
  entry_location public.geometry, exit_location public.geometry, outline_revision integer, matcher_version integer
) LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  WITH edges AS MATERIALIZED (
    SELECT e.*,public.ST_SetSRID(public.ST_MakeLine(public.ST_MakePoint(a[1],a[2]),
      public.ST_MakePoint(b[1],b[2])),4326) AS geom
    FROM jsonb_to_recordset(edge_inputs) AS e(line int,segment_number int,edge int,along_m float8,length_m float8,
      a float8[],b float8[],z0 float8,z1 float8,t0 float8,t1 float8,first boolean,last boolean,
      start_min_z float8,start_max_z float8,end_min_z float8,end_max_z float8,start_z float8,end_z float8,start_t float8,end_t float8)
    WHERE length_m>0
  ), clips AS MATERIALIZED (
    SELECT e.*,gf.destination_id,gf.outline_revision,part.geom AS clip
    FROM edges e JOIN public.glacier_outline_parts bp
      ON public.ST_DWithin(bp.outline_part,e.geom::public.geography,1)
    JOIN public.destination_glacier_facts gf ON gf.destination_id=bp.destination_id
    JOIN public.destinations d ON d.id=gf.destination_id AND 'glacier'::public.destination_feature=ANY(d.features)
    CROSS JOIN LATERAL public.ST_Dump(public.ST_CollectionExtract(
      public.ST_Difference(public.ST_Intersection(e.geom,bp.outline_part::public.geometry),
        public.ST_Boundary(gf.outline::public.geometry)),2)) part
    WHERE NOT public.ST_IsEmpty(part.geom) AND public.ST_Length(part.geom)>0
      AND public.ST_Contains(gf.outline::public.geometry,public.ST_LineInterpolatePoint(part.geom,0.5))
  ), fractions AS (
    SELECT *,LEAST(public.ST_LineLocatePoint(geom,public.ST_StartPoint(clip)),
                   public.ST_LineLocatePoint(geom,public.ST_EndPoint(clip))) AS lo,
      GREATEST(public.ST_LineLocatePoint(geom,public.ST_StartPoint(clip)),
               public.ST_LineLocatePoint(geom,public.ST_EndPoint(clip))) AS hi
    FROM clips
  ), prior AS (
    SELECT *,max(hi) OVER (PARTITION BY destination_id,edge ORDER BY lo,hi
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_hi FROM fractions WHERE hi>lo
  ), islands AS (
    SELECT *,sum(CASE WHEN prior_hi IS NULL OR lo>prior_hi+1e-10 THEN 1 ELSE 0 END)
      OVER (PARTITION BY destination_id,edge ORDER BY lo,hi) AS island FROM prior
  ), united AS MATERIALIZED (
    SELECT destination_id,edge,island,min(lo) AS lo,max(hi) AS hi,min(outline_revision) AS revision
    FROM islands GROUP BY destination_id,edge,island
  ), spans AS MATERIALIZED (
    SELECT u.destination_id,u.revision,e.line,e.segment_number,e.edge,e.first,e.last,u.lo,u.hi,e.start_min_z,e.start_max_z,e.end_min_z,e.end_max_z,
      public.ST_Contains(gf.outline::public.geometry,public.ST_StartPoint(e.geom)) AS a_inside,
      public.ST_Contains(gf.outline::public.geometry,public.ST_EndPoint(e.geom)) AS b_inside,
      e.along_m+e.length_m*u.lo AS entry_m,e.along_m+e.length_m*u.hi AS exit_m,
      CASE WHEN e.first AND u.lo<1e-10 AND public.ST_Contains(gf.outline::public.geometry,public.ST_StartPoint(e.geom)) THEN start_z
        WHEN z0 IS NOT NULL AND z1 IS NOT NULL THEN z0+(z1-z0)*u.lo END AS z_entry,
      CASE WHEN e.last AND u.hi>1-1e-10 AND public.ST_Contains(gf.outline::public.geometry,public.ST_EndPoint(e.geom)) THEN end_z
        WHEN z0 IS NOT NULL AND z1 IS NOT NULL THEN z0+(z1-z0)*u.hi END AS z_exit,
      CASE WHEN e.first AND u.lo<1e-10 AND public.ST_Contains(gf.outline::public.geometry,public.ST_StartPoint(e.geom))
          THEN CASE WHEN start_t>0 THEN to_timestamp(start_t) END
        WHEN t0>0 AND t1>=t0 THEN to_timestamp(t0+(t1-t0)*u.lo) END AS t_entry,
      CASE WHEN e.last AND u.hi>1-1e-10 AND public.ST_Contains(gf.outline::public.geometry,public.ST_EndPoint(e.geom))
          THEN CASE WHEN end_t>0 THEN to_timestamp(end_t) END
        WHEN t0>0 AND t1>=t0 THEN to_timestamp(t0+(t1-t0)*u.hi) END AS t_exit,
      public.ST_LineInterpolatePoint(e.geom,u.lo) AS p_entry,public.ST_LineInterpolatePoint(e.geom,u.hi) AS p_exit
    FROM united u JOIN edges e ON e.edge=u.edge
    JOIN public.destination_glacier_facts gf ON gf.destination_id=u.destination_id
  ), visits AS (
    SELECT *,CASE WHEN lag(line) OVER w=line AND entry_m<=lag(exit_m) OVER w+0.000001
      THEN 0 ELSE 1 END AS new_pass
    FROM spans WINDOW w AS (PARTITION BY destination_id ORDER BY edge,lo)
  ), numbered AS (
    SELECT *,sum(new_pass) OVER (PARTITION BY destination_id ORDER BY edge,lo)::int-1 AS pass FROM visits
  )
  SELECT destination_id,pass,min(segment_number),min(entry_m),max(exit_m),sum(exit_m-entry_m),
    (array_agg(t_entry ORDER BY edge,lo))[1],(array_agg(t_exit ORDER BY edge DESC,lo DESC))[1],
    (array_agg(z_entry ORDER BY edge,lo))[1],(array_agg(z_exit ORDER BY edge DESC,lo DESC))[1],
    min(LEAST(z_entry,z_exit,CASE WHEN lo<1e-10 AND a_inside THEN start_min_z END,CASE WHEN hi>1-1e-10 AND b_inside THEN end_min_z END)),
    max(GREATEST(z_entry,z_exit,CASE WHEN lo<1e-10 AND a_inside THEN start_max_z END,CASE WHEN hi>1-1e-10 AND b_inside THEN end_max_z END)),
    bool_or(first AND lo<1e-10 AND a_inside),bool_or(last AND hi>1-1e-10 AND b_inside),
    (array_agg(p_entry ORDER BY edge,lo))[1],(array_agg(p_exit ORDER BY edge DESC,lo DESC))[1],min(revision),1
  FROM numbered GROUP BY destination_id,pass ORDER BY min(entry_m),destination_id,pass;
$$;

-- Preserve the existing no-op timestamp guard. Match markers are internal;
-- changed interval sets explicitly touch server_updated_at once below.
CREATE OR REPLACE FUNCTION public.update_tracking_session_timestamps()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE ignored text[];
BEGIN
  SELECT ARRAY['updated_at','server_updated_at','glacier_match_input_hash','glacier_matched_at']
    || COALESCE(array_agg(attname::text),'{}') INTO ignored
    FROM pg_attribute WHERE attrelid=TG_RELID AND attgenerated<>'' AND NOT attisdropped;
  IF NEW.server_updated_at IS NOT DISTINCT FROM OLD.server_updated_at
    AND (to_jsonb(NEW)-ignored)=(to_jsonb(OLD)-ignored) THEN RETURN NEW; END IF;
  NEW.updated_at := now(); NEW.server_updated_at := now(); RETURN NEW;
END $$;
ALTER FUNCTION public.update_tracking_session_timestamps() OWNER TO postgres;

-- Hash only geometry inputs and catalog match revisions; description edits do
-- not force matching. A completed [] is distinct from an absent match marker.
CREATE OR REPLACE FUNCTION public.glacier_catalog_revision()
RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT md5(COALESCE(string_agg(gf.destination_id||':'||gf.outline_revision::text,',' ORDER BY gf.destination_id),''))
  FROM public.destination_glacier_facts gf JOIN public.destinations d ON d.id=gf.destination_id
  WHERE 'glacier'::public.destination_feature=ANY(d.features);
$$;

CREATE OR REPLACE FUNCTION public.refresh_route_glacier_crossings(target_id text, force_match boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE vertices jsonb; edges jsonb := '[]'::jsonb; input_hash text; saved_hash text; n integer;
  route_path public.geometry; total_vertices integer; first_vertex integer := 1;
  window_length float8; base_m float8 := 0;
BEGIN
  SELECT path::public.geometry,
    md5(COALESCE(public.ST_AsEWKB(path::public.geometry)::text,'')||public.glacier_catalog_revision()||':'||owner||':1'),
    glacier_match_input_hash INTO route_path,input_hash,saved_hash FROM public.routes WHERE id=target_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF NOT force_match AND saved_hash=input_hash THEN
    DELETE FROM public.route_glacier_rematch_queue WHERE route_id=target_id; RETURN 0;
  END IF;
  -- Far-away routes never expand their vertices. Near routes read windows of
  -- 512 original edges; only candidate edges survive into the interval engine.
  -- Window endpoints overlap, but edges never do. No continent-sized JSON.
  IF route_path IS NOT NULL AND EXISTS(SELECT 1 FROM public.glacier_outline_parts bp
    JOIN public.destination_glacier_facts gf ON gf.destination_id=bp.destination_id
    WHERE public.ST_DWithin(bp.outline_part,route_path::public.geography,1)) THEN
    total_vertices := public.ST_NPoints(route_path);
    WHILE first_vertex<total_vertices LOOP
      -- The window offset must sum the same 2D geodesic edge lengths that
      -- glacier_edges measures. ST_Length on a LineStringZ geography adds the
      -- vertical component and would shift every later window's distances.
      SELECT jsonb_agg(jsonb_build_object('x',public.ST_X(pt),'y',public.ST_Y(pt),'z',public.ST_Z(pt),'s',0) ORDER BY i),
        COALESCE(sum(public.ST_Distance(
          public.ST_SetSRID(public.ST_MakePoint(public.ST_X(pt),public.ST_Y(pt)),4326)::public.geography,
          public.ST_SetSRID(public.ST_MakePoint(public.ST_X(nxt),public.ST_Y(nxt)),4326)::public.geography))
          FILTER (WHERE nxt IS NOT NULL),0)
        INTO vertices,window_length
      FROM (SELECT i,pt,lead(pt) OVER (ORDER BY i) AS nxt
        FROM generate_series(first_vertex,LEAST(first_vertex+512,total_vertices)) i
        CROSS JOIN LATERAL (SELECT public.ST_PointN(route_path,i) AS pt) p) w;
      edges := edges || COALESCE((SELECT jsonb_agg(e || jsonb_build_object(
        'edge',(e->>'edge')::int+first_vertex-1,'along_m',(e->>'along_m')::float8+base_m,
        'first',first_vertex=1 AND (e->>'first')::boolean,
        'last',first_vertex+512>=total_vertices AND (e->>'last')::boolean))
        FROM jsonb_array_elements(public.glacier_edges(vertices,false)) AS incoming(e)),'[]'::jsonb);
      base_m := base_m+window_length;
      first_vertex := first_vertex+512;
    END LOOP;
  END IF;
  DELETE FROM public.route_glacier_crossings WHERE route_id=target_id;
  INSERT INTO public.route_glacier_crossings SELECT target_id,c.* FROM public.glacier_crossing_intervals(edges) c
    JOIN public.destinations d ON d.id=c.destination_id
    JOIN public.routes r ON r.id=target_id WHERE d.owner='peaks' OR d.owner=r.owner;
  GET DIAGNOSTICS n=ROW_COUNT;
  UPDATE public.routes SET glacier_match_input_hash=input_hash,glacier_matched_at=now() WHERE id=target_id;
  DELETE FROM public.route_glacier_rematch_queue WHERE route_id=target_id;
  PERFORM public.refresh_route_search_terms(ARRAY[target_id]);
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_session_glacier_crossings(target_id text, force_match boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE vertices jsonb; edges jsonb; input_hash text; saved_hash text; n integer; changed boolean;
  before_rows jsonb; after_rows jsonb;
BEGIN
  SELECT glacier_match_input_hash INTO saved_hash FROM public.tracking_sessions WHERE id=target_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('x',public.ST_X(location::public.geometry),
    'y',public.ST_Y(location::public.geometry),'z',elevation,'t',time,'s',segment_number) ORDER BY time),'[]'::jsonb)
    INTO vertices FROM public.tracking_points WHERE session_id=target_id;
  input_hash := md5(vertices::text||public.glacier_catalog_revision()||':1'||COALESCE((
    SELECT string_agg(destination_id,',' ORDER BY destination_id) FROM public.session_destination_rejections WHERE session_id=target_id),''));
  IF NOT force_match AND input_hash=saved_hash THEN
    INSERT INTO public.session_destinations(session_id,destination_id,relation,source)
      SELECT DISTINCT target_id,destination_id,'reached'::public.session_destination_relation,'auto'::text FROM public.session_glacier_crossings
      WHERE session_id=target_id ON CONFLICT(session_id,destination_id) DO NOTHING;
    RETURN 0;
  END IF;
  edges := public.glacier_edges(vertices,true);
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY destination_id,pass_index),'[]'::jsonb) INTO before_rows
    FROM public.session_glacier_crossings c WHERE session_id=target_id;
  DELETE FROM public.session_glacier_crossings WHERE session_id=target_id;
  INSERT INTO public.session_glacier_crossings
    SELECT c.*,target_id FROM public.glacier_crossing_intervals(edges) c
    JOIN public.destinations d ON d.id=c.destination_id
    JOIN public.tracking_sessions s ON s.id=target_id
    WHERE (d.owner='peaks' OR d.owner=s.user_id) AND NOT EXISTS (
      SELECT 1 FROM public.session_destination_rejections r WHERE r.session_id=target_id AND r.destination_id=c.destination_id);
  GET DIAGNOSTICS n=ROW_COUNT;
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY destination_id,pass_index),'[]'::jsonb) INTO after_rows
    FROM public.session_glacier_crossings c WHERE session_id=target_id;
  changed := before_rows IS DISTINCT FROM after_rows;
  -- Set the current marker before automatic reach writers check the evidence.
  -- Touch once for a changed set (or first completed-empty state).
  UPDATE public.tracking_sessions SET glacier_match_input_hash=input_hash,glacier_matched_at=now(),
    server_updated_at=CASE WHEN changed OR saved_hash IS NULL THEN now() ELSE server_updated_at END
    WHERE id=target_id;
  DELETE FROM public.session_destinations sd USING public.destinations d WHERE sd.session_id=target_id
    AND sd.destination_id=d.id AND sd.source='auto' AND 'glacier'::public.destination_feature=ANY(d.features)
    AND NOT EXISTS(SELECT 1 FROM public.session_glacier_crossings c WHERE c.session_id=sd.session_id AND c.destination_id=sd.destination_id);
  INSERT INTO public.session_destinations(session_id,destination_id,relation,source)
    SELECT DISTINCT target_id,destination_id,'reached'::public.session_destination_relation,'auto'::text FROM public.session_glacier_crossings
    WHERE session_id=target_id ON CONFLICT(session_id,destination_id) DO NOTHING;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.route_glaciers_on_path_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.owner IS NOT DISTINCT FROM NEW.owner
    AND public.ST_AsEWKB(OLD.path::public.geometry) IS NOT DISTINCT FROM public.ST_AsEWKB(NEW.path::public.geometry) THEN RETURN NULL; END IF;
  PERFORM public.refresh_route_glacier_crossings(NEW.id);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_routes_glacier_path ON public.routes;
CREATE TRIGGER trg_routes_glacier_path AFTER INSERT OR UPDATE OF path,owner ON public.routes
  FOR EACH ROW EXECUTE FUNCTION public.route_glaciers_on_path_write();

-- A database guard covers ALL automatic writers, including the old web
-- backfill and destination-insert trigger. Approximate hits only queue work;
-- positive crossing evidence alone can create an automatic glacier reach.
CREATE OR REPLACE FUNCTION public.glacier_auto_reach_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.source='auto' AND EXISTS(SELECT 1 FROM public.destinations d WHERE d.id=NEW.destination_id
      AND 'glacier'::public.destination_feature=ANY(d.features))
    AND NOT EXISTS(SELECT 1 FROM public.session_glacier_crossings c
      JOIN public.tracking_sessions s ON s.id=c.session_id AND s.glacier_match_input_hash IS NOT NULL
      WHERE c.session_id=NEW.session_id AND c.destination_id=NEW.destination_id) THEN
    INSERT INTO public.session_rematch_queue(session_id,reason) VALUES(NEW.session_id,'glacier:'||NEW.destination_id)
      ON CONFLICT(session_id) DO UPDATE SET reason=EXCLUDED.reason,queued_at=now();
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_session_destinations_glacier_evidence ON public.session_destinations;
CREATE TRIGGER trg_session_destinations_glacier_evidence BEFORE INSERT OR UPDATE ON public.session_destinations
  FOR EACH ROW EXECUTE FUNCTION public.glacier_auto_reach_guard();

-- One invalidation per changed recording, not one UPDATE per GPS sample.
CREATE OR REPLACE FUNCTION public.glacier_points_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE ids text[];
BEGIN
  IF TG_OP='INSERT' THEN SELECT array_agg(DISTINCT session_id) INTO ids FROM new_points;
  ELSIF TG_OP='DELETE' THEN SELECT array_agg(DISTINCT session_id) INTO ids FROM old_points;
  ELSE
    SELECT array_agg(DISTINCT COALESCE(n.session_id,o.session_id)) INTO ids FROM new_points n
    FULL JOIN old_points o ON n.session_id=o.session_id AND n.time=o.time
    WHERE n.session_id IS NULL OR o.session_id IS NULL
      OR n.segment_number IS DISTINCT FROM o.segment_number OR n.elevation IS DISTINCT FROM o.elevation
      OR public.ST_AsEWKB(n.location::public.geometry) IS DISTINCT FROM public.ST_AsEWKB(o.location::public.geometry);
  END IF;
  UPDATE public.tracking_sessions SET glacier_match_input_hash=NULL,server_updated_at=now()
    WHERE id=ANY(ids) AND glacier_match_input_hash IS NOT NULL;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_glacier_points_insert ON public.tracking_points;
CREATE TRIGGER trg_glacier_points_insert AFTER INSERT ON public.tracking_points
  REFERENCING NEW TABLE AS new_points FOR EACH STATEMENT EXECUTE FUNCTION public.glacier_points_changed();
DROP TRIGGER IF EXISTS trg_glacier_points_update ON public.tracking_points;
CREATE TRIGGER trg_glacier_points_update AFTER UPDATE ON public.tracking_points
  REFERENCING OLD TABLE AS old_points NEW TABLE AS new_points FOR EACH STATEMENT EXECUTE FUNCTION public.glacier_points_changed();
DROP TRIGGER IF EXISTS trg_glacier_points_delete ON public.tracking_points;
CREATE TRIGGER trg_glacier_points_delete AFTER DELETE ON public.tracking_points
  REFERENCING OLD TABLE AS old_points FOR EACH STATEMENT EXECUTE FUNCTION public.glacier_points_changed();

CREATE OR REPLACE FUNCTION public.glacier_rejection_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE sid text; did text;
BEGIN
  sid := CASE WHEN TG_OP='DELETE' THEN OLD.session_id ELSE NEW.session_id END;
  did := CASE WHEN TG_OP='DELETE' THEN OLD.destination_id ELSE NEW.destination_id END;
  IF EXISTS(SELECT 1 FROM public.destination_glacier_facts WHERE destination_id=did) THEN
    IF TG_OP<>'DELETE' THEN DELETE FROM public.session_glacier_crossings WHERE session_id=sid AND destination_id=did; END IF;
    UPDATE public.tracking_sessions SET glacier_match_input_hash=NULL,server_updated_at=now() WHERE id=sid;
    INSERT INTO public.session_rematch_queue(session_id,reason)
      SELECT id,'glacier-rejection:'||did FROM public.tracking_sessions WHERE id=sid
      ON CONFLICT(session_id) DO UPDATE SET queued_at=now(),reason=EXCLUDED.reason;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_glacier_rejection ON public.session_destination_rejections;
CREATE TRIGGER trg_glacier_rejection AFTER INSERT OR UPDATE OR DELETE ON public.session_destination_rejections
  FOR EACH ROW EXECUTE FUNCTION public.glacier_rejection_changed();

DO $$ DECLARE f regprocedure; BEGIN
  FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (
    'glacier_edges','glacier_crossing_intervals','glacier_catalog_revision','refresh_route_glacier_crossings',
    'refresh_session_glacier_crossings','route_glaciers_on_path_write','glacier_auto_reach_guard','glacier_rejection_changed','glacier_points_changed') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO "peaks-api"',f);
  END LOOP;
END $$;
COMMIT;
