-- $1 is the exact reviewed package ID array. No production IDs are embedded.
-- Parts add vertices along WGS84 edges. Projected straight segments differ
-- by up to 0.025109 m / 13.779 m² in this packet. The contract permits a
-- metric comparison: require <=0.05 m Hausdorff AND <=5 ppm area difference.
-- The selected largest display polygon must still match exactly.
WITH expected AS (SELECT unnest($1::text[]) id), bad AS (
 SELECT e.id,'missing facts, parent, search row or parts' AS problem FROM expected e
 LEFT JOIN destinations d USING(id) LEFT JOIN destination_glacier_facts gf ON gf.destination_id=e.id
 LEFT JOIN destinations parent ON parent.id=gf.parent_mountain_id LEFT JOIN destination_search_rows ds ON ds.id=e.id
 WHERE d.id IS NULL OR gf.destination_id IS NULL OR parent.id IS NULL OR ds.id IS NULL
 OR NOT EXISTS(SELECT 1 FROM glacier_outline_parts p WHERE p.destination_id=e.id)
 OR NOT EXISTS(SELECT 1 FROM destination_boundary_parts p WHERE p.destination_id=e.id)
 UNION ALL
 SELECT d.id,'unexpected container' FROM destinations d JOIN expected USING(id)
 WHERE EXISTS(SELECT 1 FROM destination_areas a WHERE a.destination_id=d.id)
 UNION ALL
 SELECT gf.destination_id,'invalid outline, missing parts or wrong largest polygon' FROM destination_glacier_facts gf
 JOIN expected ON id=gf.destination_id JOIN destinations d ON d.id=gf.destination_id
 WHERE NOT ST_IsValid(gf.outline::geometry)
 OR EXISTS(SELECT 1 FROM (SELECT ST_Transform(gf.outline::geometry,32632) a,ST_Transform(ST_UnaryUnion(ST_Collect(p.outline_part::geometry)),32632) b FROM glacier_outline_parts p WHERE p.destination_id=d.id) q
   WHERE ST_HausdorffDistance(a,b)>0.05 OR ST_Area(ST_SymDifference(a,b))>ST_Area(a)*0.000005)
 OR EXISTS(SELECT 1 FROM (SELECT ST_Transform(d.boundary::geometry,32632) a,ST_Transform(ST_UnaryUnion(ST_Collect(p.boundary_part::geometry)),32632) b FROM destination_boundary_parts p WHERE p.destination_id=d.id) q
   WHERE ST_HausdorffDistance(a,b)>0.05 OR ST_Area(ST_SymDifference(a,b))>ST_Area(a)*0.000005)
 OR NOT ST_Equals(d.boundary::geometry,(SELECT geom FROM ST_Dump(gf.outline::geometry) ORDER BY ST_Area(geom::geography) DESC,path LIMIT 1))
 UNION ALL
 SELECT destination_id,'wrong geometry credit, license, source or date' FROM destination_glacier_facts gf JOIN expected ON id=destination_id
 WHERE gf.provenance->'outline'->>'credit' IS DISTINCT FROM gf.geometry_credit
 OR gf.provenance->'outline'->>'license' IS DISTINCT FROM gf.geometry_license
 OR gf.provenance->'outline'->>'source_url' IS DISTINCT FROM gf.outline_source_url
 OR gf.provenance->'outline'->>'source_sha256' IS DISTINCT FROM gf.outline_source_sha256
 OR COALESCE(gf.provenance->'outline'->>'observed_at',gf.provenance->'outline'->>'snapshot_at') IS DISTINCT FROM to_char(gf.outline_observed_at,'YYYY-MM-DD')
 UNION ALL
 SELECT c.destination_id,'missing route search term' FROM route_glacier_crossings c JOIN expected ON id=c.destination_id JOIN destinations d ON d.id=c.destination_id
 WHERE NOT EXISTS(SELECT 1 FROM route_search_terms t WHERE t.route_id=c.route_id AND t.term=d.search_name)
 UNION ALL
 SELECT c.destination_id,'rejected session span' FROM session_glacier_crossings c JOIN expected ON id=c.destination_id JOIN session_destination_rejections r USING(session_id,destination_id)
) SELECT * FROM bad ORDER BY id,problem;
