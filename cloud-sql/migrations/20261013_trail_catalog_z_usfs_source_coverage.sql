-- Exact USFS feature coverage on the existing pending candidate path.
-- Cost: existing Cloud SQL functions only; expected fixed increase ~$0/month.
-- No route writes, role grants, activation, review, or canonical validator change.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- URLSearchParams uses form encoding, including '+' for space and UTF-8 bytes.
CREATE OR REPLACE FUNCTION trail_catalog_form_encode(value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT COALESCE(string_agg(CASE
    WHEN octet BETWEEN 65 AND 90 OR octet BETWEEN 97 AND 122 OR octet BETWEEN 48 AND 57
      OR octet IN (42,45,46,95) THEN chr(octet)
    WHEN octet=32 THEN '+' ELSE '%' || upper(lpad(to_hex(octet),2,'0')) END,'' ORDER BY ordinal),'')
  FROM (SELECT i AS ordinal,get_byte(convert_to(value,'UTF8'),i) AS octet
    FROM generate_series(0,octet_length(convert_to(value,'UTF8'))-1) i) bytes;
$$;

CREATE OR REPLACE FUNCTION trail_catalog_form_decode(value TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE bytes BYTEA := ''::bytea; position INTEGER := 1; character TEXT;
BEGIN
  IF length(value)>4000000 THEN RETURN NULL; END IF;
  WHILE position<=length(value) LOOP
    character := substr(value,position,1);
    IF character='%' THEN
      IF substr(value,position+1,2) !~ '^[0-9A-Fa-f]{2}$' THEN RETURN NULL; END IF;
      bytes := bytes || decode(substr(value,position+1,2),'hex'); position:=position+3;
    ELSE
      bytes := bytes || convert_to(CASE WHEN character='+' THEN ' ' ELSE character END,'UTF8');
      position:=position+1;
    END IF;
  END LOOP;
  RETURN convert_from(bytes,'UTF8');
EXCEPTION WHEN character_not_in_repertoire OR untranslatable_character THEN RETURN NULL;
END $$;

-- Pin the reviewed registry, field list, parameter order, escaping, and feature
-- set. IDs are data only: no decoded expression is ever executed as SQL.
CREATE OR REPLACE FUNCTION trail_catalog_usfs_source_url(feature_ids TEXT[])
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE ids TEXT[]; clause TEXT;
BEGIN
  IF array_ndims(feature_ids) IS DISTINCT FROM 1 OR cardinality(feature_ids) NOT BETWEEN 1 AND 5000
    OR EXISTS (SELECT 1 FROM unnest(feature_ids) id WHERE id IS NULL OR length(id) NOT BETWEEN 1 AND 256
      OR id<>btrim(id) OR id ~ '[[:cntrl:]]')
    OR cardinality(feature_ids)<>(SELECT count(DISTINCT id COLLATE "C") FROM unnest(feature_ids) id)
    THEN RETURN NULL; END IF;
  SELECT array_agg(id ORDER BY id COLLATE "C") INTO ids FROM unnest(feature_ids) id;
  SELECT 'globalid IN (' || string_agg('''' || replace(id,'''','''''') || '''',',' ORDER BY ordinal) || ')'
    INTO clause FROM unnest(ids) WITH ORDINALITY entries(id,ordinal);
  RETURN 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublishWithDataStatus_01/MapServer/0/query?where='
    || trail_catalog_form_encode(clause)
    || '&outFields=globalid%2Ctrail_name%2Ctrail_no%2Cattributesubset%2Caccessibility_status%2Callowed_terra_use%2Chiker_pedestrian_managed%2Chiker_pedestrian_accpt%2Chiker_pedestrian_disc%2Chiker_pedestrian_accpt_disc%2Chiker_pedestrian_restricted&returnGeometry=true&returnZ=false&returnM=false&outSR=4326&f=geojson';
END $$;

CREATE OR REPLACE FUNCTION trail_catalog_usfs_feature_ids(source_url TEXT)
RETURNS TEXT[] LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE prefix CONSTANT TEXT := 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublishWithDataStatus_01/MapServer/0/query?where=';
  tail TEXT; clause TEXT; body TEXT; feature_id TEXT; ids TEXT[] := ARRAY[]::text[];
  position INTEGER:=1; closed BOOLEAN; canonical TEXT;
BEGIN
  IF length(source_url)>4000000 OR left(source_url,length(prefix))<>prefix THEN RETURN NULL; END IF;
  tail:=substr(source_url,length(prefix)+1);
  IF strpos(tail,'&')=0 THEN RETURN NULL; END IF;
  clause:=trail_catalog_form_decode(left(tail,strpos(tail,'&')-1));
  IF clause IS NULL OR left(clause,13)<>'globalid IN (' OR right(clause,1)<>')' THEN RETURN NULL; END IF;
  body:=substr(clause,14,length(clause)-14);
  WHILE position<=length(body) LOOP
    IF substr(body,position,1)<>'''' THEN RETURN NULL; END IF;
    position:=position+1; feature_id:=''; closed:=false;
    WHILE position<=length(body) LOOP
      IF substr(body,position,1)='''' THEN
        IF substr(body,position+1,1)='''' THEN feature_id:=feature_id || ''''; position:=position+2;
        ELSE position:=position+1; closed:=true; EXIT; END IF;
      ELSE feature_id:=feature_id || substr(body,position,1); position:=position+1; END IF;
      IF length(feature_id)>256 THEN RETURN NULL; END IF;
    END LOOP;
    IF NOT closed THEN RETURN NULL; END IF;
    ids:=array_append(ids,feature_id);
    IF cardinality(ids)>5000 THEN RETURN NULL; END IF;
    IF position>length(body) THEN EXIT; END IF;
    IF substr(body,position,1)<>',' OR position=length(body) THEN RETURN NULL; END IF;
    position:=position+1;
  END LOOP;
  canonical:=trail_catalog_usfs_source_url(ids);
  IF canonical IS NULL OR canonical<>source_url THEN RETURN NULL; END IF;
  RETURN ids;
END $$;

CREATE OR REPLACE FUNCTION route_segment_provenance_compatible(
  segment_provenance JSONB, route_provenance JSONB
)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(CASE WHEN COALESCE(is_valid_route_provenance(segment_provenance),false)
                   AND COALESCE(is_valid_route_provenance(route_provenance),false)
    THEN segment_provenance->>'source_kind' = route_provenance->>'source_kind'
      AND segment_provenance->'contains_osm_geometry' = route_provenance->'contains_osm_geometry'
      AND segment_provenance->>'license_name' = route_provenance->>'license_name'
      AND segment_provenance->>'license_url' = route_provenance->>'license_url'
      AND segment_provenance->>'attribution' = route_provenance->>'attribution'
      AND segment_provenance->>'elevation_source' IS NOT DISTINCT FROM route_provenance->>'elevation_source'
      AND segment_provenance->>'elevation_profile' IS NOT DISTINCT FROM route_provenance->>'elevation_profile'
      AND CASE WHEN (route_provenance->>'contains_osm_geometry')::boolean
        THEN jsonb_array_length(segment_provenance->'osm_way_ids')>0
          AND (segment_provenance->'osm_way_ids') <@ (route_provenance->'osm_way_ids')
        WHEN route_provenance->>'source_kind'='usfs-nfs-trails' THEN
          route_provenance->>'license_name'='U.S. Government work under 17 U.S.C. § 105'
          AND route_provenance->>'license_url'='https://www.govinfo.gov/content/pkg/USCODE-2023-title17/html/USCODE-2023-title17-chap1-sec105.htm'
          AND route_provenance->>'attribution'='USDA Forest Service'
          AND trail_catalog_usfs_feature_ids(segment_provenance->>'source_url')
            <@ trail_catalog_usfs_feature_ids(route_provenance->>'source_url')
        ELSE segment_provenance->>'source_url'=route_provenance->>'source_url' END
    ELSE false END,false);
$$;

CREATE OR REPLACE FUNCTION route_segments_cover_provenance(candidate_route_id TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE((SELECT CASE WHEN is_valid_route_provenance(r.provenance) THEN
    EXISTS (SELECT 1 FROM route_segments rs WHERE rs.route_id=r.id)
    AND NOT EXISTS (
      SELECT 1 FROM route_segments rs LEFT JOIN segments s ON s.id=rs.segment_id
      WHERE rs.route_id=r.id AND NOT route_segment_provenance_compatible(s.provenance,r.provenance)
    )
    AND CASE WHEN r.provenance->>'source_kind'='usfs-nfs-trails' THEN
      trail_catalog_usfs_feature_ids(r.provenance->>'source_url') <@ ARRAY(
        SELECT DISTINCT feature_id FROM route_segments rs JOIN segments s ON s.id=rs.segment_id
        CROSS JOIN LATERAL unnest(trail_catalog_usfs_feature_ids(s.provenance->>'source_url')) feature_id
        WHERE rs.route_id=r.id)
    ELSE (r.provenance->'osm_way_ids') <@ COALESCE((
      SELECT jsonb_agg(DISTINCT way.value)
      FROM route_segments rs JOIN segments s ON s.id=rs.segment_id
      CROSS JOIN LATERAL jsonb_array_elements(CASE
        WHEN jsonb_typeof(s.provenance->'osm_way_ids')='array' THEN s.provenance->'osm_way_ids'
        ELSE '[]'::jsonb END) way(value)
      WHERE rs.route_id=r.id),'[]'::jsonb) END
    ELSE false END FROM routes r WHERE r.id=candidate_route_id),false);
$$;

CREATE OR REPLACE FUNCTION trail_catalog_span_matches(segment_path geography, segment_provenance JSONB, artifact JSONB, first_index INTEGER, last_index INTEGER, reversed BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE expected geometry; actual geometry; expected_ids JSONB; actual_ids JSONB;
BEGIN
  IF first_index IS NULL OR last_index IS NULL OR first_index<0 OR last_index<=first_index
     OR last_index>=jsonb_array_length(artifact#>'{candidate,elevatedPoints}')
     OR NOT COALESCE(route_segment_provenance_compatible(segment_provenance,artifact#>'{candidate,provenance}'),false) THEN RETURN false; END IF;
  expected:=trail_catalog_artifact_path(artifact,first_index,last_index);
  actual:=CASE WHEN reversed THEN ST_Reverse(segment_path::geometry) ELSE segment_path::geometry END;
  IF expected IS NULL OR actual IS NULL OR ST_NDims(actual)<>3 OR ST_NDims(expected)<>3
    OR ST_NPoints(actual)<>ST_NPoints(expected) OR ST_Length(segment_path)<=0 THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM generate_series(1,ST_NPoints(expected)) i
    WHERE NOT (abs(ST_X(ST_PointN(expected,i))-ST_X(ST_PointN(actual,i)))<=1e-9
      AND abs(ST_Y(ST_PointN(expected,i))-ST_Y(ST_PointN(actual,i)))<=1e-9
      AND abs(ST_Z(ST_PointN(expected,i))-ST_Z(ST_PointN(actual,i)))<=0.01)) THEN RETURN false; END IF;
  -- Each source ID must contribute a positive horizontal edge in this exact span.
  IF artifact#>>'{candidate,input,source,type}'='usfs-nfs-trails'
     AND segment_provenance->>'source_kind'='usfs-nfs-trails' THEN
    IF jsonb_array_length(artifact#>'{candidate,edges}')<>jsonb_array_length(artifact#>'{candidate,elevatedPoints}')-1
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(artifact#>'{candidate,edges}') WITH ORDINALITY e(edge,ordinal)
        WHERE ordinal-1>=first_index AND ordinal-1<last_index
          AND (jsonb_typeof(edge->'featureId') IS DISTINCT FROM 'string' OR edge ? 'wayId')) THEN RETURN false; END IF;
    SELECT jsonb_agg(id ORDER BY id COLLATE "C") INTO expected_ids FROM (
      SELECT DISTINCT edge->>'featureId' AS id
      FROM jsonb_array_elements(artifact#>'{candidate,edges}') WITH ORDINALITY e(edge,ordinal)
      WHERE ordinal-1>=first_index AND ordinal-1<last_index
        AND ST_Distance(ST_PointN(expected,ordinal::int-first_index)::geography,
                        ST_PointN(expected,ordinal::int-first_index+1)::geography)>0
    ) ids;
    actual_ids:=to_jsonb(trail_catalog_usfs_feature_ids(segment_provenance->>'source_url'));
  ELSIF artifact#>>'{candidate,input,source,type}'='osm'
     AND segment_provenance->>'source_kind'='openstreetmap' THEN
    SELECT jsonb_agg(id ORDER BY id) INTO expected_ids FROM (
      SELECT DISTINCT (edge->>'wayId')::bigint AS id
      FROM jsonb_array_elements(artifact#>'{candidate,edges}') WITH ORDINALITY e(edge,ordinal)
      WHERE ordinal-1>=first_index AND ordinal-1<last_index
        AND ST_Distance(ST_PointN(expected,ordinal::int-first_index)::geography,
                        ST_PointN(expected,ordinal::int-first_index+1)::geography)>0
    ) ids;
    SELECT jsonb_agg(id ORDER BY id) INTO actual_ids FROM (
      SELECT DISTINCT value::bigint AS id FROM jsonb_array_elements_text(segment_provenance->'osm_way_ids')
    ) ids;
  ELSE RETURN false; END IF;
  RETURN COALESCE(expected_ids IS NOT NULL AND actual_ids=expected_ids,false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;

COMMENT ON FUNCTION trail_catalog_usfs_feature_ids(TEXT) IS
  'Feature IDs only from the exact reviewed USFS registry URL; malformed or noncanonical URLs return NULL.';
COMMIT;
