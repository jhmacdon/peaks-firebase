-- Read-only Snow Lake / Ingalls Lake shared-segment inventory.
-- Requires current Phase 1/2 trail migrations. No session or private path reads.
-- Fixed infrastructure cost: $0/month; one bounded operator query.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
SET LOCAL search_path = pg_catalog, public;

WITH
targets(id) AS (VALUES ('L4JeIhjFWrqIGzkkZ1fk'), ('vTRZQyeAZpTecyFjAGIr')),
target_rows AS MATERIALIZED (
  SELECT s.* FROM targets t JOIN segments s ON s.id=t.id
),
-- LIMIT+1 detects incomplete inventory; it never labels a truncated export complete.
references_bounded AS MATERIALIZED (
  SELECT rs.segment_id,rs.route_id,rs.ordinal,rs.direction,r.owner='peaks' AS catalog
  FROM route_segments rs JOIN routes r ON r.id=rs.route_id
  WHERE rs.segment_id IN (SELECT id FROM targets)
  ORDER BY rs.segment_id,rs.route_id,rs.ordinal LIMIT 1001
),
route_ids AS MATERIALIZED (
  SELECT DISTINCT route_id FROM references_bounded WHERE catalog
),
catalog_routes AS MATERIALIZED (
  SELECT r.* FROM route_ids ids JOIN routes r ON r.id=ids.route_id
  WHERE r.owner='peaks' ORDER BY r.id LIMIT 26
),
route_links_bounded AS MATERIALIZED (
  SELECT rs.* FROM route_segments rs
  WHERE rs.route_id IN (SELECT id FROM catalog_routes)
  ORDER BY rs.route_id,rs.ordinal,rs.segment_id LIMIT 501
),
segment_scope AS MATERIALIZED (
  SELECT s.* FROM target_rows s
  WHERE EXISTS(SELECT 1 FROM references_bounded ref WHERE ref.segment_id=s.id AND ref.catalog)
),
place_links_bounded AS MATERIALIZED (
  SELECT rd.route_id,rd.destination_id,rd.ordinal,d.owner='peaks' AS catalog
  FROM route_destinations rd JOIN destinations d ON d.id=rd.destination_id
  WHERE rd.route_id IN (SELECT id FROM catalog_routes)
  ORDER BY rd.route_id,rd.ordinal,rd.destination_id LIMIT 501
),
catalog_places AS MATERIALIZED (
  SELECT d.* FROM destinations d
  WHERE d.owner='peaks' AND d.id IN (SELECT destination_id FROM place_links_bounded WHERE catalog)
),
candidate_jobs_bounded AS MATERIALIZED (
  SELECT j.* FROM trail_catalog_candidate_jobs j
  WHERE j.source_key IN ('wa:osm-relation:4793517','wa:osm-relation:5626186')
    OR j.proposed_route_id IN (SELECT id FROM catalog_routes)
  ORDER BY j.source_key LIMIT 51
),
budget AS MATERIALIZED (
  SELECT
    (SELECT count(*) FROM target_rows)=2 AS targets_present,
    (SELECT count(*) FROM references_bounded)<=1000 AS references_complete,
    (SELECT count(*) FROM route_ids)<=25 AS route_count_ok,
    (SELECT count(*) FROM route_links_bounded)<=500 AS segment_links_complete,
    (SELECT count(*) FROM place_links_bounded)<=500 AS place_links_complete,
    (SELECT count(*) FROM candidate_jobs_bounded)<=50 AS candidate_jobs_complete,
    -- Only catalog-linked segments contribute to the public geometry budget.
    COALESCE((SELECT sum(ST_NPoints(path::geometry)) FROM segment_scope),0) AS segment_vertices,
    COALESCE((SELECT sum(ST_NPoints(path::geometry)) FROM catalog_routes),0) AS route_vertices,
    COALESCE((SELECT sum(ST_NPoints(boundary::geometry)) FROM catalog_places),0) AS boundary_vertices,
    COALESCE((SELECT sum(octet_length(COALESCE(provenance::text,''))
      +octet_length(COALESCE(name,''))+octet_length(trail_names::text)) FROM segment_scope),0)
      +COALESCE((SELECT sum(octet_length(COALESCE(provenance::text,''))+octet_length(COALESCE(name,''))
        +octet_length(COALESCE(elevation_string,''))) FROM catalog_routes),0)
      +COALESCE((SELECT sum(octet_length(COALESCE(name,''))) FROM catalog_places),0) AS evidence_bytes,
    (SELECT count(*) FROM references_bounded WHERE NOT catalog) AS observed_private_references,
    (SELECT count(*) FROM place_links_bounded WHERE NOT catalog) AS observed_private_place_references,
    (SELECT count(*) FROM target_rows s WHERE NOT EXISTS(
      SELECT 1 FROM references_bounded ref WHERE ref.segment_id=s.id AND ref.catalog)) AS targets_without_catalog_reference
),
control AS MATERIALIZED (
  SELECT *,targets_present AND references_complete AND route_count_ok
    AND segment_links_complete AND place_links_complete AND candidate_jobs_complete
    AND segment_vertices<=100000 AND route_vertices<=100000 AND boundary_vertices<=20000
    AND evidence_bytes<=10000000 AS complete
  FROM budget
),
eligible_routes AS MATERIALIZED (
  SELECT r.* FROM catalog_routes r CROSS JOIN control c WHERE c.complete
),
eligible_segments AS MATERIALIZED (
  SELECT s.* FROM segment_scope s CROSS JOIN control c WHERE c.complete
),
segment_export AS MATERIALIZED (
  SELECT s.id,jsonb_build_object(
    'id',s.id,'name',s.name,'target',s.id IN (SELECT id FROM targets),
    'xyz',ST_AsGeoJSON(s.path::geometry,17,0)::jsonb,
    'pathSha256',encode(sha256(ST_AsEWKB(s.path::geometry)),'hex'),
    'pointCount',ST_NPoints(s.path::geometry),'distanceM',s.distance,'gainM',s.gain,'lossM',s.gain_loss,
    'provenance',s.provenance,'provenanceValid',is_valid_route_provenance(s.provenance),
    'trailNames',s.trail_names,'createdAt',s.created_at,'updatedAt',s.updated_at,
    'encodedProfile',encode_route_elevation_profile(s.path),
    'profileHasRealRange',route_elevation_profile_has_real_range(s.path),
    'computedStats',jsonb_build_object('gainM',stats.gain,'lossM',stats.loss),
    'statsMatch',s.gain IS NOT DISTINCT FROM stats.gain AND s.gain_loss IS NOT DISTINCT FROM stats.loss
  ) AS value
  FROM eligible_segments s CROSS JOIN LATERAL route_elevation_stats(s.path) stats
),
route_export AS MATERIALIZED (
  SELECT r.id,jsonb_build_object(
    'id',r.id,'name',r.name,'owner','peaks','status',r.status,'kind',r.kind,'shape',r.shape,
    'trailheadId',r.trailhead_destination_id,'objectiveId',r.objective_destination_id,
    'xyz',ST_AsGeoJSON(r.path::geometry,17,0)::jsonb,
    'pathSha256',encode(sha256(ST_AsEWKB(r.path::geometry)),'hex'),
    'pointCount',ST_NPoints(r.path::geometry),'distanceM',r.distance,'gainM',r.gain,'lossM',r.gain_loss,
    'provenance',r.provenance,'provenanceValid',is_valid_route_provenance(r.provenance),
    'sourceCoverageValid',route_segments_cover_provenance(r.id),
    'publishIntegrityValid',peaks_route_passes_publish_integrity(r.id,NULL,r.status),
    'kindContactValid',peaks_route_kind_passes_contact(r.id,NULL),
    'pendingBindingValid',trail_catalog_pending_binding_valid(r.id),
    'elevation',jsonb_build_object('profile',r.elevation_string,'source',r.elevation_source,
      'sourceUrl',r.elevation_source_url,'attribution',r.elevation_attribution,
      'licenseUrl',r.elevation_license_url,'retrievedAt',r.elevation_retrieved_at,
      'profileMatchesXYZ',r.elevation_string=encode_route_elevation_profile(r.path),
      'hasRealRange',route_elevation_profile_has_real_range(r.path),
      'computedGainM',stats.gain,'computedLossM',stats.loss,
      'statsMatch',r.gain IS NOT DISTINCT FROM stats.gain AND r.gain_loss IS NOT DISTINCT FROM stats.loss),
    'segmentLinks',COALESCE((SELECT jsonb_agg(jsonb_build_object('segmentId',rs.segment_id,
      'ordinal',rs.ordinal,'direction',rs.direction) ORDER BY rs.ordinal,rs.segment_id)
      FROM route_links_bounded rs WHERE rs.route_id=r.id),'[]'::jsonb),
    'destinations',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',d.id,'name',d.name,'ordinal',link.ordinal,'features',d.features::text[],
      'lat',ST_Y(d.location::geometry),'lng',ST_X(d.location::geometry),'elevationM',ST_Z(d.location::geometry),
      'boundary',ST_AsGeoJSON(d.boundary::geometry,17,0)::jsonb,'updatedAt',d.updated_at,
      'pathGapM',ST_Distance(r.path,d.location),
      'startGapM',ST_Distance(ST_StartPoint(r.path::geometry)::geography,d.location),
      'endGapM',ST_Distance(ST_EndPoint(r.path::geometry)::geography,d.location),
      'endBoundaryGapM',CASE WHEN d.boundary IS NOT NULL THEN ST_Distance(ST_EndPoint(r.path::geometry)::geography,d.boundary) END,
      'summitContactValid',CASE WHEN 'summit'::destination_feature=ANY(d.features)
        THEN d.location IS NOT NULL AND ST_DWithin(r.path,d.location,5) END,
      'creditedCover',NULLIF(btrim(d.hero_image),'') IS NOT NULL
        AND NULLIF(btrim(d.hero_image_attribution),'') IS NOT NULL AND NULLIF(btrim(d.hero_image_attribution_url),'') IS NOT NULL
    ) ORDER BY link.ordinal,d.id) FROM place_links_bounded link JOIN catalog_places d ON d.id=link.destination_id
      WHERE link.route_id=r.id AND link.catalog),'[]'::jsonb),
    'createdAt',r.created_at,'updatedAt',r.updated_at
  ) AS value
  FROM eligible_routes r CROSS JOIN LATERAL route_elevation_stats(r.path) stats
)
SELECT jsonb_build_object(
  'schemaVersion',1,'generatedAt',transaction_timestamp(),'readOnly',current_setting('transaction_read_only'),
  'analysisOnly',true,'repairApproved',false,
  'scope',jsonb_build_object('segmentIds',(SELECT jsonb_agg(id ORDER BY id) FROM targets),
    'candidateSourceKeys',jsonb_build_array('wa:osm-relation:4793517','wa:osm-relation:5626186')),
  'limits',jsonb_build_object('references',1000,'catalogRoutes',25,'segmentLinks',500,'placeLinks',500,
    'candidateJobs',50,'segmentVertices',100000,'routeVertices',100000,'boundaryVertices',20000,
    'evidenceBytes',10000000,'statementTimeout','20s'),
  'inventory',to_jsonb(c),
  'repairBlocked',NOT c.complete OR c.observed_private_references>0 OR c.observed_private_place_references>0
    OR c.targets_without_catalog_reference>0,
  'blockers',to_jsonb(array_remove(ARRAY[
    CASE WHEN NOT c.complete THEN 'incomplete_inventory_or_budget_exceeded' END,
    CASE WHEN c.observed_private_references>0 THEN 'private_route_references_require_separate_operator_review' END,
    CASE WHEN c.observed_private_place_references>0 THEN 'private_destination_references_withheld' END,
    CASE WHEN c.targets_without_catalog_reference>0 THEN 'target_not_attached_to_catalog_geometry_withheld' END
  ],NULL)),
  'targetPresence',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'exists',s.id IS NOT NULL,
    'publicGeometryExported',EXISTS(SELECT 1 FROM segment_export e WHERE e.id=t.id)) ORDER BY t.id)
    FROM targets t LEFT JOIN target_rows s ON s.id=t.id),'[]'::jsonb),
  'targetCatalogReferences',CASE WHEN c.references_complete THEN COALESCE((SELECT jsonb_agg(
    jsonb_build_object('segmentId',segment_id,'routeId',route_id,'ordinal',ordinal,'direction',direction)
    ORDER BY segment_id,route_id,ordinal) FROM references_bounded WHERE catalog),'[]'::jsonb) END,
  'privateReferences',jsonb_build_object('countComplete',c.references_complete,
    'observedLinkCount',c.observed_private_references,
    'observedRouteCount',(SELECT count(DISTINCT route_id) FROM references_bounded WHERE NOT catalog),
    'routeIdHashes',COALESCE((SELECT jsonb_agg(route_hash ORDER BY route_hash) FROM(
      SELECT DISTINCT encode(sha256(convert_to('shared-conflicts/private-route/'||route_id,'UTF8')),'hex') AS route_hash
      FROM references_bounded WHERE NOT catalog) private_ids),'[]'::jsonb)),
  'privateDestinationReferences',jsonb_build_object('countComplete',c.place_links_complete,
    'observedLinkCount',c.observed_private_place_references,
    'destinationIdHashes',COALESCE((SELECT jsonb_agg(place_hash ORDER BY place_hash) FROM(
      SELECT DISTINCT encode(sha256(convert_to('shared-conflicts/private-place/'||destination_id,'UTF8')),'hex') AS place_hash
      FROM place_links_bounded WHERE NOT catalog) private_places),'[]'::jsonb)),
  'segments',COALESCE((SELECT jsonb_agg(value ORDER BY id) FROM segment_export),'[]'::jsonb),
  'catalogRoutes',COALESCE((SELECT jsonb_agg(value ORDER BY id) FROM route_export),'[]'::jsonb),
  'candidateJobs',CASE WHEN c.complete THEN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'sourceKey',j.source_key,'state',j.state,'inputHash',j.input_hash,'reviewHash',j.review_hash,
    'routeId',j.route_id,'proposedRouteId',j.proposed_route_id,'rejectionReason',j.rejection_reason,
    'geometryHash',COALESCE(j.artifact#>>'{candidate,geometryHash}',j.result->>'geometryHash'),
    'sourceSnapshotCount',CASE WHEN jsonb_typeof(COALESCE(j.artifact#>'{candidate,input,source,snapshots}',j.artifact#>'{input,source,snapshots}'))='array'
      THEN jsonb_array_length(COALESCE(j.artifact#>'{candidate,input,source,snapshots}',j.artifact#>'{input,source,snapshots}')) END,
    'createdAt',j.created_at,'updatedAt',j.updated_at
  ) ORDER BY j.source_key) FROM candidate_jobs_bounded j),'[]'::jsonb) END
) AS snapshot FROM control c;

ROLLBACK;
