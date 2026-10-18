-- Shared SELECT only. Export public photo/place fields; never export reviewer UIDs.
WITH expected AS (SELECT value b FROM jsonb_array_elements(:'photo_expected'::jsonb)),
bound AS (
  SELECT e.b,c.id,c.destination_id,c.status,c.image_url,c.source_page_url,c.source_kind,c.photographer,c.license_name,c.license_url,
    c.image_width,c.image_height,c.focal_x,c.focal_y,c.final_image_url,c.reviewed_at,
    c.ctid::text||':'||c.xmin::text candidate_tuple,d.ctid::text||':'||d.xmin::text place_tuple,
    d.name,d.hero_image,d.hero_image_attribution,d.hero_image_attribution_url,d.hero_image_focal_x,d.hero_image_focal_y,
    (SELECT jsonb_agg(jsonb_build_object('sourceKey',j.source_key,'state',j.state,'routeId',j.route_id) ORDER BY j.source_key) FROM jsonb_array_elements_text(e.b->'routeSourceKeys') keys(key) JOIN trail_catalog_candidate_jobs j ON j.source_key=keys.key) route_jobs,
    (SELECT count(*)=jsonb_array_length(e.b->'routeSourceKeys') AND bool_and(j.state='rejected') FROM jsonb_array_elements_text(e.b->'routeSourceKeys') keys(key) JOIN trail_catalog_candidate_jobs j ON j.source_key=keys.key) jobs_binding,
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
    (NULLIF(btrim(d.hero_image),'') IS NOT NULL AND NULLIF(btrim(d.hero_image_attribution),'') IS NOT NULL AND NULLIF(btrim(d.hero_image_attribution_url),'') IS NOT NULL) credited_cover
  FROM expected e JOIN destination_photo_candidates c ON c.id=e.b->>'candidateId'
    JOIN destinations d ON d.id=c.destination_id AND d.id=e.b#>>'{place,id}'
), checked AS (
  SELECT *,COALESCE(status='approved' AND source_binding AND place_binding AND jobs_binding AND reviewer_recorded AND storage_binding AND hero_binding,false) approved_ok FROM bound
), protected AS (
  SELECT jsonb_build_object(
    'routes',(SELECT md5(COALESCE(string_agg(ctid::text||':'||xmin::text,',' ORDER BY id),'')) FROM routes),
    'segments',(SELECT md5(COALESCE(string_agg(ctid::text||':'||xmin::text,',' ORDER BY id),'')) FROM segments),
    'routeSegments',(SELECT md5(COALESCE(string_agg(ctid::text||':'||xmin::text,',' ORDER BY route_id,ordinal),'')) FROM route_segments),
    'routeDestinations',(SELECT md5(COALESCE(string_agg(ctid::text||':'||xmin::text,',' ORDER BY route_id,ordinal),'')) FROM route_destinations),
    'candidateJobs',(SELECT md5(COALESCE(string_agg(ctid::text||':'||xmin::text,',' ORDER BY source_key),'')) FROM trail_catalog_candidate_jobs),
    'pilotGeometry',(SELECT md5(string_agg(encode(ST_AsEWKB(path::geometry),'hex'),',' ORDER BY id)) FROM routes WHERE id IN(SELECT jsonb_array_elements_text(:'photo_imported_routes'::jsonb))),
    'priorHeroes',(SELECT md5(string_agg(d.ctid::text||':'||d.xmin::text,',' ORDER BY d.id)) FROM jsonb_array_elements(:'photo_prior_approved'::jsonb) old JOIN destinations d ON d.id=old->>'destinationId'),
    'priorPhotos',(SELECT md5(string_agg(c.ctid::text||':'||c.xmin::text,',' ORDER BY c.id)) FROM jsonb_array_elements(:'photo_prior_approved'::jsonb) old JOIN destination_photo_candidates c ON c.id=old->>'candidateId')
  ) fingerprints
)
SELECT jsonb_build_object('checkedAt',clock_timestamp(),'count',(SELECT count(*) FROM checked),
  'bindingsValid',COALESCE((SELECT bool_and(source_binding AND place_binding AND jobs_binding) FROM checked),false),
  'routesPending',(SELECT count(*)=4 AND bool_and(owner='peaks' AND status='pending') FROM routes WHERE id IN(SELECT jsonb_array_elements_text(:'photo_imported_routes'::jsonb))),
  'pilotJobsUnchangedPartition',(SELECT count(*)=21 AND count(*) FILTER(WHERE state='pending')=4 AND count(*) FILTER(WHERE state='rejected')=17 FROM trail_catalog_candidate_jobs WHERE source_key IN(SELECT jsonb_array_elements_text(:'photo_pilot_keys'::jsonb))),
  'priorApprovedValid',(SELECT count(*)=4 AND bool_and(c.status='approved' AND c.final_image_url=old->>'storageUrl' AND d.hero_image=c.final_image_url
    AND d.hero_image_attribution=old->>'heroAttribution' AND d.hero_image_attribution_url=old->>'heroSourceUrl'
    AND d.hero_image_focal_x=(old->>'heroFocalX')::int AND d.hero_image_focal_y=(old->>'heroFocalY')::int)
    FROM jsonb_array_elements(:'photo_prior_approved'::jsonb) old JOIN destination_photo_candidates c ON c.id=old->>'candidateId' JOIN destinations d ON d.id=c.destination_id AND d.id=old->>'destinationId'),
  'pendingReady',(SELECT count(*)=11 AND bool_and(queue_pending AND source_binding AND place_binding AND jobs_binding
    AND NOT(NULLIF(btrim(hero_image),'') IS NOT NULL AND NULLIF(btrim(hero_image_attribution),'') IS NOT NULL AND NULLIF(btrim(hero_image_attribution_url),'') IS NOT NULL)) FROM checked),
  'approvedPhotos',(SELECT count(*) FILTER(WHERE approved_ok) FROM checked),
  'fingerprints',(SELECT fingerprints FROM protected),
  'photos',(SELECT jsonb_agg(jsonb_build_object('candidateId',id,'destinationId',destination_id,'name',name,'status',status,
    'sourceImageUrl',image_url,'sourcePageUrl',source_page_url,'sourceKind',source_kind,'photographer',photographer,'licenseName',license_name,'licenseUrl',license_url,
    'imageWidth',image_width,'imageHeight',image_height,'focalX',focal_x,'focalY',focal_y,'storageUrl',final_image_url,
    'reviewedAt',reviewed_at,'authenticatedReviewerRecorded',COALESCE(reviewer_recorded,false),'storageBinding',COALESCE(storage_binding,false),'heroBinding',COALESCE(hero_binding,false),
    'approvedBinding',approved_ok,'heroImage',hero_image,'heroAttribution',hero_image_attribution,'heroSourceUrl',hero_image_attribution_url,
    'heroFocalX',hero_image_focal_x,'heroFocalY',hero_image_focal_y,'candidateTuple',candidate_tuple,'placeTuple',place_tuple,
    'sourceCandidateJobs',route_jobs,'creditedCover',credited_cover) ORDER BY id) FROM checked)
) state \gset photo_
