-- Glacier region import checks (runbook step 7, generic). Run once per parent:
--   psql -v parent=<checked-parent-id> -v container='<area name or empty>' \
--        -v uncontained='<name|name|... places with no container, or empty>' \
--        -v expected=<places under this parent> -f docs/data-audits/glacier-region-verify.sql
-- Every "missing" query must return no rows.
SELECT kind,count(*) AS places, :'expected'::int AS expected FROM destination_glacier_facts
WHERE parent_mountain_id=:'parent' GROUP BY kind;

SELECT d.id,d.name FROM destinations d
LEFT JOIN destination_glacier_facts gf ON gf.destination_id=d.id
WHERE 'glacier'=ANY(d.features) AND gf.destination_id IS NULL;

-- Missing parent, search row, container link (for contained places) or parts.
SELECT gf.destination_id,d.name FROM destination_glacier_facts gf
JOIN destinations d ON d.id=gf.destination_id
LEFT JOIN destinations pm ON pm.id=gf.parent_mountain_id
LEFT JOIN destination_search_rows ds ON ds.id=d.id
WHERE gf.parent_mountain_id=:'parent' AND (pm.id IS NULL OR ds.id IS NULL
   OR (:'container'<>'' AND NOT d.name=ANY(string_to_array(:'uncontained','|')) AND NOT EXISTS(
     SELECT 1 FROM destination_areas da JOIN areas a ON a.id=da.area_id WHERE da.destination_id=d.id AND a.name=:'container'))
   OR NOT EXISTS(SELECT 1 FROM destination_boundary_parts bp WHERE bp.destination_id=d.id)
   OR NOT EXISTS(SELECT 1 FROM glacier_outline_parts gp WHERE gp.destination_id=d.id));

SELECT d.name,GeometryType(d.boundary::geometry) AS legacy_type,GeometryType(gf.outline::geometry) AS outline_type,
       ST_IsValid(gf.outline::geometry) AS outline_valid,ST_NumGeometries(gf.outline::geometry) AS components,
       ST_NPoints(gf.outline::geometry) AS outline_vertices,gf.area_km2 AS facts_area_km2,
       round((ST_Area(gf.outline)/1e6)::numeric,3) AS outline_area_km2,pg_column_size(gf.outline) AS outline_bytes
FROM destinations d JOIN destination_glacier_facts gf ON gf.destination_id=d.id
WHERE gf.parent_mountain_id=:'parent' ORDER BY d.name;

-- Piece checks with a 0.05 m Hausdorff tolerance (split roundoff is ~1 cm).
SELECT d.id,d.name FROM destinations d JOIN destination_glacier_facts gf ON gf.destination_id=d.id
WHERE gf.parent_mountain_id=:'parent' AND (
  ST_HausdorffDistance(ST_Transform(d.boundary::geometry,32610),ST_Transform((SELECT ST_UnaryUnion(ST_Collect(bp.boundary_part::geometry))
    FROM destination_boundary_parts bp WHERE bp.destination_id=d.id),32610))>0.05
  OR ST_HausdorffDistance(ST_Transform(gf.outline::geometry,32610),ST_Transform((SELECT ST_UnaryUnion(ST_Collect(gp.outline_part::geometry))
    FROM glacier_outline_parts gp WHERE gp.destination_id=d.id),32610))>0.05
  OR NOT ST_Equals(d.boundary::geometry,(SELECT geom FROM ST_Dump(gf.outline::geometry) ORDER BY ST_Area(geom::geography) DESC,path LIMIT 1)));

SELECT gf.geometry_credit,gf.geometry_license,gf.outline_observed_at,gf.facts_credit,count(*)
FROM destination_glacier_facts gf WHERE gf.parent_mountain_id=:'parent' GROUP BY 1,2,3,4 ORDER BY 1,3;

SELECT d.id,d.name FROM destination_glacier_facts gf JOIN destinations d ON d.id=gf.destination_id
WHERE gf.parent_mountain_id=:'parent' AND (
  gf.provenance->'outline'->>'credit' IS DISTINCT FROM gf.geometry_credit
  OR gf.provenance->'outline'->>'license' IS DISTINCT FROM gf.geometry_license
  OR gf.provenance->'outline'->>'source_url' IS DISTINCT FROM gf.outline_source_url
  OR gf.provenance->'outline'->>'source_sha256' IS DISTINCT FROM gf.outline_source_sha256
  OR COALESCE(gf.provenance->'outline'->>'observed_at',gf.provenance->'outline'->>'snapshot_at')
    IS DISTINCT FROM to_char(gf.outline_observed_at,'YYYY-MM-DD'));

-- Nulls, not zeros; no served older-extent facts; rank inside "of N".
SELECT d.name FROM destination_glacier_facts gf JOIN destinations d ON d.id=gf.destination_id
WHERE gf.parent_mountain_id=:'parent' AND (gf.area_km2<=0 OR gf.head_elevation_m<=0 OR gf.terminus_elevation_m IS NOT NULL
  OR gf.length_km IS NOT NULL OR gf.percent_change_since_earliest IS NOT NULL
  OR gf.rank_on_mountain > (gf.provenance->'mountain_context'->>'named_glacier_count')::int
  OR (gf.area_km2 IS NULL) <> (gf.observed_year IS NULL));

SELECT c.* FROM session_glacier_crossings c JOIN session_destination_rejections r USING(session_id,destination_id);
SELECT count(*) AS route_queue FROM route_glacier_rematch_queue;
SELECT count(*) AS session_queue FROM session_rematch_queue WHERE reason LIKE 'glacier:%' OR reason LIKE 'glacier-rejection:%';
SELECT c.route_id FROM route_glacier_crossings c JOIN destinations d ON d.id=c.destination_id
WHERE NOT EXISTS(SELECT 1 FROM route_search_terms rst WHERE rst.route_id=c.route_id AND rst.term=d.search_name);

SELECT d.name, round(gf.area_km2::numeric,3) AS facts_km2, round((ST_Area(gf.outline)/1e6)::numeric,3) AS outline_km2,
       round((ST_Area(gf.outline)/1e6/NULLIF(gf.area_km2,0))::numeric,2) AS ratio,
       CASE WHEN gf.area_km2 IS NULL THEN 'no facts'
            WHEN ST_Area(gf.outline)/1e6/gf.area_km2 NOT BETWEEN 0.67 AND 1.5 THEN 'REVIEW' ELSE 'ok' END AS flag
FROM destination_glacier_facts gf JOIN destinations d ON d.id=gf.destination_id
WHERE gf.parent_mountain_id=:'parent' ORDER BY flag DESC, d.name;
