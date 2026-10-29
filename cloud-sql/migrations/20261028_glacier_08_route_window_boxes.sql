-- Bound route crossing refresh by bounding boxes.
-- The exact ST_DWithin precheck against a whole long path (the PCT has 64k
-- points) hit the 30 s statement timeout, and every 512-edge window then ran
-- the edge engine. Now an indexed box test gates the route and each window.
-- A window box is padded about 10 m, beyond the engine's 1 m contact rule.
-- No new infrastructure; $0/month.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.refresh_route_glacier_crossings(target_id text, force_match boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE vertices jsonb; edges jsonb := '[]'::jsonb; input_hash text; saved_hash text; n integer;
  route_path public.geometry; total_vertices integer; first_vertex integer := 1;
  window_length float8; base_m float8 := 0;
  min_x float8; min_y float8; max_x float8; max_y float8;
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
    WHERE bp.outline_part OPERATOR(public.&&) route_path::public.geography) THEN
    total_vertices := public.ST_NPoints(route_path);
    WHILE first_vertex<total_vertices LOOP
      -- The window offset must sum the same 2D geodesic edge lengths that
      -- glacier_edges measures. ST_Length on a LineStringZ geography adds the
      -- vertical component and would shift every later window's distances.
      SELECT jsonb_agg(jsonb_build_object('x',public.ST_X(pt),'y',public.ST_Y(pt),'z',public.ST_Z(pt),'s',0) ORDER BY i),
        COALESCE(sum(public.ST_Distance(
          public.ST_SetSRID(public.ST_MakePoint(public.ST_X(pt),public.ST_Y(pt)),4326)::public.geography,
          public.ST_SetSRID(public.ST_MakePoint(public.ST_X(nxt),public.ST_Y(nxt)),4326)::public.geography))
          FILTER (WHERE nxt IS NOT NULL),0),
        min(public.ST_X(pt)),min(public.ST_Y(pt)),max(public.ST_X(pt)),max(public.ST_Y(pt))
        INTO vertices,window_length,min_x,min_y,max_x,max_y
      FROM (SELECT i,pt,lead(pt) OVER (ORDER BY i) AS nxt
        FROM generate_series(first_vertex,LEAST(first_vertex+512,total_vertices)) i
        CROSS JOIN LATERAL (SELECT public.ST_PointN(route_path,i) AS pt) p) w;
      -- Skip windows whose box touches no outline piece (indexed). A long
      -- trail such as the PCT only expands the few windows near ice.
      IF EXISTS(SELECT 1 FROM public.glacier_outline_parts bp
        WHERE bp.outline_part OPERATOR(public.&&) public.ST_Expand(public.ST_MakeEnvelope(min_x,min_y,max_x,max_y,4326),0.0001)::public.geography) THEN
      edges := edges || COALESCE((SELECT jsonb_agg(e || jsonb_build_object(
        'edge',(e->>'edge')::int+first_vertex-1,'along_m',(e->>'along_m')::float8+base_m,
        'first',first_vertex=1 AND (e->>'first')::boolean,
        'last',first_vertex+512>=total_vertices AND (e->>'last')::boolean))
        FROM jsonb_array_elements(public.glacier_edges(vertices,false)) AS incoming(e)),'[]'::jsonb);
      END IF;
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

COMMIT;
