-- Shared SELECT only. Export public photo/place fields; never export reviewer UIDs.
WITH expected AS (SELECT value b FROM jsonb_array_elements(:'photo_expected'::jsonb)),
bound AS (
  SELECT e.b,c.id,c.destination_id,c.status,c.image_url,c.source_page_url,c.source_kind,c.photographer,c.license_name,c.license_url,
    c.image_width,c.image_height,c.focal_x,c.focal_y,c.final_image_url,c.reviewed_at,
    c.ctid::text||':'||c.xmin::text candidate_tuple,d.ctid::text||':'||d.xmin::text place_tuple,
    d.name,d.hero_image,d.hero_image_attribution,d.hero_image_attribution_url,d.hero_image_focal_x,d.hero_image_focal_y,
    r.id route_id,r.status route_status,j.state candidate_job_state,
    (to_jsonb(c) @> ((e.b->'candidate')-ARRAY['status','final_image_url','reviewed_by','reviewed_at'])) source_binding,
    (d.owner='peaks' AND jsonb_build_object('id',d.id,'name',d.name,'lat',ST_Y(d.location::geometry),'lng',ST_X(d.location::geometry),
      'features',d.features::text[],'stateCode',d.state_code,'countryCode',d.country_code,'boundary',ST_AsGeoJSON(d.boundary::geometry)::jsonb,
      'externalIds',d.external_ids,'elevation',d.elevation)=(e.b->'place')) place_binding,
    (c.status='pending' AND c.final_image_url IS NULL AND c.reviewed_by IS NULL AND c.reviewed_at IS NULL) queue_pending,
    (NULLIF(btrim(c.reviewed_by),'') IS NOT NULL AND c.reviewed_by NOT LIKE 'preview-only:%'
      AND c.reviewed_at>=:'photo_audit_started_at'::timestamptz AND c.reviewed_at<=clock_timestamp()+interval '5 minutes') reviewer_recorded,
    (left(c.final_image_url,length('https://firebasestorage.googleapis.com/v0/b/'||:'storage_bucket'||'/o/destination-covers%2F'||d.id||'%2F'||c.id||'-'))=
      'https://firebasestorage.googleapis.com/v0/b/'||:'storage_bucket'||'/o/destination-covers%2F'||d.id||'%2F'||c.id||'-'
      AND substring(c.final_image_url FROM length('https://firebasestorage.googleapis.com/v0/b/'||:'storage_bucket'||'/o/destination-covers%2F'||d.id||'%2F'||c.id||'-')+1)
        ~ '^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})[.]jpg[?]alt=media&token=\1$') storage_binding,
    (d.hero_image=c.final_image_url AND d.hero_image_attribution=c.photographer||' / '||c.license_name
      AND d.hero_image_attribution_url=c.source_page_url AND d.hero_image_focal_x=c.focal_x AND d.hero_image_focal_y=c.focal_y) hero_binding,
    EXISTS(SELECT 1 FROM route_destinations rd JOIN destinations cover ON cover.id=rd.destination_id WHERE rd.route_id=r.id
      AND NULLIF(btrim(cover.hero_image),'') IS NOT NULL AND NULLIF(btrim(cover.hero_image_attribution),'') IS NOT NULL
      AND NULLIF(btrim(cover.hero_image_attribution_url),'') IS NOT NULL) credited_cover
  FROM expected e JOIN destination_photo_candidates c ON c.id=e.b->>'candidateId'
    JOIN destinations d ON d.id=c.destination_id AND d.id=e.b#>>'{place,id}'
    JOIN trail_catalog_candidate_jobs j ON j.source_key=e.b->>'routeSourceKey' AND j.route_id=e.b->>'routeId' AND j.proposed_route_id=j.route_id
    JOIN routes r ON r.id=j.route_id AND r.owner='peaks'
  WHERE EXISTS(SELECT 1 FROM route_destinations rd WHERE rd.route_id=r.id AND rd.destination_id=d.id)
), checked AS (
  SELECT *,COALESCE(status='approved' AND source_binding AND place_binding AND reviewer_recorded AND storage_binding AND hero_binding,false) approved_ok FROM bound
), protected AS (
  SELECT jsonb_build_object(
    'routes',(SELECT jsonb_agg(jsonb_build_object('id',r.id,'tuple',r.ctid::text||':'||r.xmin::text,
      'geometrySha256',encode(sha256(ST_AsEWKB(r.path::geometry)),'hex')) ORDER BY r.id) FROM expected e JOIN routes r ON r.id=e.b->>'routeId'),
    'candidateJobs',(SELECT jsonb_agg(jsonb_build_object('sourceKey',j.source_key,'inputHash',j.input_hash,'routeId',j.route_id,
      'tuple',j.ctid::text||':'||j.xmin::text) ORDER BY j.source_key) FROM expected e JOIN trail_catalog_candidate_jobs j ON j.source_key=e.b->>'routeSourceKey')
  ) fingerprints
)
SELECT jsonb_build_object('checkedAt',clock_timestamp(),'count',(SELECT count(*) FROM checked),
  'bindingsValid',COALESCE((SELECT bool_and(source_binding AND place_binding) FROM checked),false),
  'routesPending',COALESCE((SELECT count(*)=4 AND bool_and(route_status='pending' AND candidate_job_state='pending') FROM checked),false),
  'pendingReady',(SELECT count(*)=4 AND bool_and(queue_pending AND source_binding AND place_binding
    AND NOT(NULLIF(btrim(hero_image),'') IS NOT NULL AND NULLIF(btrim(hero_image_attribution),'') IS NOT NULL AND NULLIF(btrim(hero_image_attribution_url),'') IS NOT NULL)) FROM checked),
  'approvedPhotos',(SELECT count(*) FILTER(WHERE approved_ok) FROM checked),
  'fingerprints',(SELECT fingerprints FROM protected),
  'photos',(SELECT jsonb_agg(jsonb_build_object('candidateId',id,'destinationId',destination_id,'name',name,'status',status,
    'sourceImageUrl',image_url,'sourcePageUrl',source_page_url,'sourceKind',source_kind,'photographer',photographer,'licenseName',license_name,'licenseUrl',license_url,
    'imageWidth',image_width,'imageHeight',image_height,'focalX',focal_x,'focalY',focal_y,'storageUrl',final_image_url,
    'reviewedAt',reviewed_at,'authenticatedReviewerRecorded',COALESCE(reviewer_recorded,false),'storageBinding',COALESCE(storage_binding,false),'heroBinding',COALESCE(hero_binding,false),
    'approvedBinding',approved_ok,'heroImage',hero_image,'heroAttribution',hero_image_attribution,'heroSourceUrl',hero_image_attribution_url,
    'heroFocalX',hero_image_focal_x,'heroFocalY',hero_image_focal_y,'candidateTuple',candidate_tuple,'placeTuple',place_tuple,
    'routeId',route_id,'routeStatus',route_status,'candidateJobState',candidate_job_state,'creditedCover',credited_cover) ORDER BY id) FROM checked)
) state \gset photo_
