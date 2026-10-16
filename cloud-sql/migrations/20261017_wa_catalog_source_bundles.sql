-- Explicit source bundles for graph + Peaks-owned legacy tails/connectors.
-- peaks-derived is a non-OSM Peaks rights leaf, just as peaks-legacy is. No row rewrite,
-- activation, contact-tolerance or geometry-check change. Fixed cost: $0/month.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Repeat the positional-parameter fix for clones where 20261016 already ran.
-- Keep the original rights rules and explicit way_id/way_url column aliases.
CREATE OR REPLACE FUNCTION wa_catalog_valid_source_provenance(value JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof($1) <> 'object'
      OR NOT $1 ?& ARRAY[
        'source_kind', 'source_url', 'license_name', 'license_url', 'attribution',
        'retrieved_at', 'osm_way_ids', 'osm_way_urls', 'contains_osm_geometry'
      ]
      OR jsonb_typeof($1->'source_kind') <> 'string'
      OR btrim($1->>'source_kind') !~ '^[a-z0-9][a-z0-9_-]*$'
      OR jsonb_typeof($1->'source_url') <> 'string'
      OR $1->>'source_url' !~ '^https?://[^[:space:]]+$'
      OR jsonb_typeof($1->'license_name') <> 'string'
      OR btrim($1->>'license_name') = ''
      OR jsonb_typeof($1->'license_url') <> 'string'
      OR $1->>'license_url' !~ '^https?://[^[:space:]]+$'
      OR jsonb_typeof($1->'attribution') <> 'string'
      OR btrim($1->>'attribution') = ''
      OR jsonb_typeof($1->'retrieved_at') <> 'string'
      OR $1->>'retrieved_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      OR jsonb_typeof($1->'contains_osm_geometry') <> 'boolean'
      OR jsonb_typeof($1->'osm_way_ids') <> 'array'
      OR jsonb_typeof($1->'osm_way_urls') <> 'array'
      OR ($1 ? 'elevation_source') <> ($1 ? 'elevation_profile')
      OR (
        $1 ? 'elevation_source'
        AND (
          jsonb_typeof($1->'elevation_source') <> 'string'
          OR btrim($1->>'elevation_source') = ''
          OR jsonb_typeof($1->'elevation_profile') <> 'string'
          OR $1->>'elevation_profile' NOT IN ('terrain', 'monotonic_ascent')
        )
      )
    THEN false
    ELSE
      (SELECT count(*) FROM jsonb_object_keys($1)) IN (9, 11)
      AND jsonb_array_length($1->'osm_way_ids')
          = jsonb_array_length($1->'osm_way_urls')
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements($1->'osm_way_ids')
          WITH ORDINALITY AS way_id(value, ordinal)
        JOIN jsonb_array_elements($1->'osm_way_urls')
          WITH ORDINALITY AS way_url(value, ordinal)
          USING (ordinal)
        WHERE jsonb_typeof(way_id.value) <> 'number'
           OR (way_id.value #>> '{}') !~ '^[1-9][0-9]*$'
           OR jsonb_typeof(way_url.value) <> 'string'
           OR (way_url.value #>> '{}') <>
              ('https://www.openstreetmap.org/way/' || (way_id.value #>> '{}'))
      )
      AND (
        ($1->>'contains_osm_geometry')::boolean
          = (jsonb_array_length($1->'osm_way_ids') > 0)
      )
      AND (
        NOT ($1->>'contains_osm_geometry')::boolean
        OR (
          $1->>'source_kind' = 'openstreetmap'
          AND $1->>'license_name' =
              'Open Data Commons Open Database License (ODbL) 1.0'
          AND $1->>'license_url' =
              'https://opendatacommons.org/licenses/odbl/1-0/'
          AND $1->>'attribution' = '© OpenStreetMap contributors'
        )
      )
  END;
$$;

CREATE FUNCTION wa_catalog_valid_single_provenance(value JSONB) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof($1) IS DISTINCT FROM 'object' THEN false ELSE COALESCE(wa_catalog_valid_source_provenance($1-'wa_catalog') AND (
    CASE WHEN NOT($1?'wa_catalog') THEN true WHEN jsonb_typeof($1->'wa_catalog') IS DISTINCT FROM 'object' THEN false ELSE (
      $1#>>'{wa_catalog,loader}'='wa-trail-graph-v2'
      AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys($1->'wa_catalog') k WHERE k NOT IN ('loader','compose_status','composition_hash','approximate','notes','waypoint_names','loaded_binding_hash','dropped_links'))
      AND (NOT($1->'wa_catalog'?'compose_status') OR $1#>>'{wa_catalog,compose_status}' IN ('ok','review'))
      AND (NOT($1->'wa_catalog'?'composition_hash') OR $1#>>'{wa_catalog,composition_hash}' ~ '^[a-f0-9]{64}$')
      AND (NOT($1->'wa_catalog'?'loaded_binding_hash') OR $1#>>'{wa_catalog,loaded_binding_hash}' ~ '^[a-f0-9]{64}$')
      AND (NOT($1->'wa_catalog'?'approximate') OR jsonb_typeof($1#>'{wa_catalog,approximate}')='boolean')
      AND (NOT($1->'wa_catalog'?'notes') OR CASE WHEN jsonb_typeof($1#>'{wa_catalog,notes}')='array' THEN
        NOT EXISTS(SELECT 1 FROM jsonb_array_elements($1#>'{wa_catalog,notes}') n WHERE jsonb_typeof(n)<>'string') ELSE false END)
      AND (NOT($1->'wa_catalog'?'waypoint_names') OR jsonb_typeof($1#>'{wa_catalog,waypoint_names}')='array')
      AND (NOT($1->'wa_catalog'?'dropped_links') OR CASE WHEN jsonb_typeof($1#>'{wa_catalog,dropped_links}')='array' THEN
        NOT EXISTS(SELECT 1 FROM jsonb_array_elements($1#>'{wa_catalog,dropped_links}') AS dropped(link) WHERE
          CASE WHEN jsonb_typeof(link)='object' THEN NOT(link ?& ARRAY['id','name','gap_m','reason'])
          OR (SELECT count(*) FROM jsonb_object_keys(link))<>4
          OR jsonb_typeof(link->'id') IS DISTINCT FROM 'string'
          OR jsonb_typeof(link->'name') IS DISTINCT FROM 'string' OR btrim(link->>'name')=''
          OR jsonb_typeof(link->'reason') IS DISTINCT FROM 'string' OR btrim(link->>'reason')=''
          OR CASE WHEN jsonb_typeof(link->'gap_m')='number' THEN (link->>'gap_m')::numeric<0 ELSE true END ELSE true END)
        ELSE false END)

    ) END),false) END
$$;

CREATE OR REPLACE FUNCTION is_valid_route_provenance(value JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE leaf JSONB; ids JSONB;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF NOT(value?'sources') THEN RETURN wa_catalog_valid_single_provenance(value); END IF;
  IF NOT wa_catalog_valid_single_provenance(value-'sources') OR jsonb_typeof(value->'sources') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(value->'sources') NOT BETWEEN 2 AND 128 THEN RETURN false; END IF;
  FOR leaf IN SELECT item FROM jsonb_array_elements(value->'sources') item LOOP
    -- Nine/eleven-field leaves only: no nested bundles, arbitrary metadata or
    -- weaker license checks. The original exact ODbL credit rule still applies.
    IF NOT COALESCE(wa_catalog_valid_source_provenance(leaf),false) THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT count(*)<>count(DISTINCT item) FROM jsonb_array_elements(value->'sources') item) THEN RETURN false; END IF;
  IF (value-ARRAY['sources','wa_catalog','osm_way_ids','osm_way_urls']) IS DISTINCT FROM
    ((value->'sources'->0)-ARRAY['osm_way_ids','osm_way_urls']) THEN RETURN false; END IF;
  IF (value->>'contains_osm_geometry')::boolean IS DISTINCT FROM
    (SELECT bool_or((item->>'contains_osm_geometry')::boolean) FROM jsonb_array_elements(value->'sources') item) THEN RETURN false; END IF;
  SELECT COALESCE(jsonb_agg(DISTINCT way ORDER BY way),'[]') INTO ids
    FROM jsonb_array_elements(value->'sources') src CROSS JOIN LATERAL jsonb_array_elements(src->'osm_way_ids') way;
  RETURN (value->'osm_way_ids') @> ids AND ids @> (value->'osm_way_ids');
END $$;

CREATE FUNCTION wa_catalog_provenance_sources(value JSONB) RETURNS JSONB
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof($1->'sources')='array' THEN $1->'sources' ELSE jsonb_build_array($1-'wa_catalog') END
$$;

CREATE FUNCTION wa_catalog_leaf_compatible(segment_source JSONB,route_source JSONB) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN COALESCE(wa_catalog_valid_source_provenance($1),false) AND COALESCE(wa_catalog_valid_source_provenance($2),false) THEN
    $1->>'source_kind'=$2->>'source_kind'
    AND $1->'contains_osm_geometry'=$2->'contains_osm_geometry'
    AND $1->>'license_name'=$2->>'license_name'
    AND $1->>'license_url'=$2->>'license_url'
    AND $1->>'attribution'=$2->>'attribution'
    AND $1->>'elevation_source' IS NOT DISTINCT FROM $2->>'elevation_source'
    AND $1->>'elevation_profile' IS NOT DISTINCT FROM $2->>'elevation_profile'
    AND CASE WHEN ($2->>'contains_osm_geometry')::boolean THEN
      jsonb_array_length($1->'osm_way_ids')>0 AND ($1->'osm_way_ids') <@ ($2->'osm_way_ids')
      WHEN $2->>'source_kind'='usfs-nfs-trails' THEN
        $2->>'license_name'='U.S. Government work under 17 U.S.C. § 105'
        AND $2->>'license_url'='https://www.govinfo.gov/content/pkg/USCODE-2023-title17/html/USCODE-2023-title17-chap1-sec105.htm'
        AND $2->>'attribution'='USDA Forest Service'
        AND trail_catalog_usfs_feature_ids($1->>'source_url') <@ trail_catalog_usfs_feature_ids($2->>'source_url')
      ELSE $1->>'source_url'=$2->>'source_url' END
    ELSE false END
$$;

CREATE OR REPLACE FUNCTION route_segment_provenance_compatible(segment_provenance JSONB,route_provenance JSONB) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN COALESCE(is_valid_route_provenance($1),false) AND COALESCE(is_valid_route_provenance($2),false) THEN
    NOT EXISTS(SELECT 1 FROM jsonb_array_elements(wa_catalog_provenance_sources($1)) seg
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(wa_catalog_provenance_sources($2)) route
        WHERE wa_catalog_leaf_compatible(seg,route))) ELSE false END
$$;

CREATE OR REPLACE FUNCTION route_segments_cover_provenance(candidate_route_id TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE((SELECT CASE WHEN is_valid_route_provenance(r.provenance) THEN
    EXISTS(SELECT 1 FROM route_segments WHERE route_id=r.id)
    AND NOT EXISTS(SELECT 1 FROM route_segments rs LEFT JOIN segments s ON s.id=rs.segment_id
      WHERE rs.route_id=r.id AND NOT route_segment_provenance_compatible(s.provenance,r.provenance))
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(wa_catalog_provenance_sources(r.provenance)) claim
      WHERE NOT EXISTS(SELECT 1 FROM route_segments rs JOIN segments s ON s.id=rs.segment_id
        CROSS JOIN LATERAL jsonb_array_elements(wa_catalog_provenance_sources(s.provenance)) actual
        WHERE rs.route_id=r.id AND wa_catalog_leaf_compatible(actual,claim))
      OR NOT(CASE WHEN claim->>'source_kind'='usfs-nfs-trails' THEN
        trail_catalog_usfs_feature_ids(claim->>'source_url') <@ ARRAY(
          SELECT DISTINCT feature_id FROM route_segments rs JOIN segments s ON s.id=rs.segment_id
          CROSS JOIN LATERAL jsonb_array_elements(wa_catalog_provenance_sources(s.provenance)) actual
          CROSS JOIN LATERAL unnest(trail_catalog_usfs_feature_ids(actual->>'source_url')) feature_id
          WHERE rs.route_id=r.id AND wa_catalog_leaf_compatible(actual,claim))
      ELSE (claim->'osm_way_ids') <@ COALESCE((SELECT jsonb_agg(DISTINCT way)
        FROM route_segments rs JOIN segments s ON s.id=rs.segment_id
        CROSS JOIN LATERAL jsonb_array_elements(wa_catalog_provenance_sources(s.provenance)) actual
        CROSS JOIN LATERAL jsonb_array_elements(actual->'osm_way_ids') way
        WHERE rs.route_id=r.id AND wa_catalog_leaf_compatible(actual,claim)),'[]'::jsonb) END))
    ELSE false END FROM routes r WHERE r.id=$1),false)
$$;

CREATE FUNCTION wa_catalog_union_provenance(input_sources JSONB) RETURNS JSONB
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
WITH leaves AS (
  SELECT leaf FROM jsonb_array_elements($1) item CROSS JOIN LATERAL jsonb_array_elements(wa_catalog_provenance_sources(item)) leaf
), keyed AS (
  SELECT leaf,jsonb_build_array(leaf->'source_kind',leaf->'license_name',leaf->'license_url',leaf->'attribution',leaf->'contains_osm_geometry',
    CASE WHEN (leaf->>'contains_osm_geometry')::boolean THEN NULL ELSE leaf->'source_url' END,leaf->'elevation_source',leaf->'elevation_profile') AS key FROM leaves
), grouped AS (
  SELECT key,(array_agg(leaf ORDER BY leaf->>'retrieved_at' DESC,leaf->>'source_url'))[1] AS sample FROM keyed GROUP BY key
), combined AS (
  SELECT grouped.key,jsonb_set(jsonb_set(sample,'{osm_way_ids}',ids.ways),'{osm_way_urls}',COALESCE((SELECT jsonb_agg('https://www.openstreetmap.org/way/'||(way#>>'{}') ORDER BY way) FROM jsonb_array_elements(ids.ways) way),'[]')) AS src
  FROM grouped CROSS JOIN LATERAL (SELECT COALESCE(jsonb_agg(DISTINCT way ORDER BY way),'[]') AS ways FROM keyed k
    CROSS JOIN LATERAL jsonb_array_elements(k.leaf->'osm_way_ids') way WHERE k.key=grouped.key) ids
), sources AS (
  SELECT jsonb_agg(src ORDER BY (src->>'contains_osm_geometry')::boolean DESC,key) AS items FROM combined
), ids AS (
  SELECT COALESCE(jsonb_agg(DISTINCT way ORDER BY way),'[]') AS ways FROM leaves CROSS JOIN LATERAL jsonb_array_elements(leaf->'osm_way_ids') way
), header AS (
  SELECT jsonb_set(jsonb_set(items->0,'{osm_way_ids}',ways),'{osm_way_urls}',COALESCE((SELECT jsonb_agg('https://www.openstreetmap.org/way/'||(way#>>'{}') ORDER BY way) FROM jsonb_array_elements(ids.ways) way),'[]')) AS src,items FROM sources CROSS JOIN ids
)
SELECT src||CASE WHEN jsonb_array_length(items)>1 THEN jsonb_build_object('sources',items) ELSE '{}'::jsonb END FROM header
$$;

CREATE FUNCTION wa_catalog_provenance_elevation(value JSONB,elevation JSONB) RETURNS JSONB
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT wa_catalog_union_provenance(jsonb_agg((leaf-ARRAY['elevation_source','elevation_profile'])||$2))
    ||CASE WHEN $1?'wa_catalog' THEN jsonb_build_object('wa_catalog',$1->'wa_catalog') ELSE '{}'::jsonb END
  FROM jsonb_array_elements(wa_catalog_provenance_sources($1)) leaf
$$;

CREATE TABLE wa_catalog_rebase_receipts (
  route_id TEXT PRIMARY KEY REFERENCES routes(id),
  source_hash TEXT NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  binding_hash TEXT NOT NULL CHECK(binding_hash ~ '^[a-f0-9]{64}$'),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON wa_catalog_rebase_receipts FROM PUBLIC,"peaks-api","peaks-route-factory","peaks-route-reviewer";
-- The migration operator owns receipts. Insertion happens only after the route
-- transaction's source, ordered-XY, elevation and active-integrity checks pass.
-- peaks_route_passes_publish_integrity itself is deliberately unchanged.
COMMIT;
