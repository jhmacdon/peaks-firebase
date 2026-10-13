#!/usr/bin/env node
// Offline only: generate a rollback preview from the saved public evidence.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const root = new URL('../../../../../', here);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => JSON.stringify(sort(value));
function sort(value) {
  return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
}
const paths = {
  candidates: 'cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/photos/candidates.json',
  review: 'cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/photos/review.json',
  catalog: 'cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/catalog-places-6bb7916bb071.json',
  uiFraming: 'docs/data-audits/trail-catalog-wa-2026-10-13/photos/approval-remaining-11/ui-framing-review.json',
  approvedReadback: 'docs/data-audits/trail-catalog-wa-2026-10-13/photos/approval-apply/production-readback-5.json',
  pilotManifest: 'cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/manifest.json',
  queueReceipt: 'docs/data-audits/trail-catalog-wa-2026-10-13/photos/operations/production-apply-1.jsonl',
};
const bytes = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, readFileSync(new URL(path, root))]));
const candidates = JSON.parse(bytes.candidates).candidates, review = JSON.parse(bytes.review), catalog = JSON.parse(bytes.catalog);
const receipt = bytes.queueReceipt.toString().trim().split('\n').map(line => JSON.parse(line));
const summary = receipt.find(row => row.type === 'summary');
if (summary?.runId !== '116' || summary.complete !== true || summary.applyOutcome !== 'confirmed'
  || summary.manifestSha256 !== sha(bytes.candidates) || summary.reviewSha256 !== sha(bytes.review)
  || summary.catalogSha256 !== sha(bytes.catalog) || summary.queueRowsChanged !== 15) throw new Error('Confirmed queue receipt or pinned inputs differ');
const requested = [
  [
    "nSf6z4vL0zjdG2sXibBM",
    "xxoCzbZ6wudjscAe788b"
  ],
  [
    "xHaYBgzoxgfAZNLTfWid",
    "sLF3JFQL61nB2nK78F2f"
  ],
  [
    "4EDA7A56C36153040635",
    "vNACg3f2NioMeR2qdBjX"
  ],
  [
    "4F56621F3FF823F6A480",
    "goxoEUevbtTLEgWOBQ2T"
  ],
  [
    "RedSHjLLfieFAySd8gFZ",
    "jXUNh6O7X9w3ubnS2FuC"
  ],
  [
    "3F941B9F4262007D704D",
    "tPvVhGEVwnGL3z5R-DEm"
  ],
  [
    "5hVnUW4tmqj3A6YbU0oB",
    "RuNcafBQAXNpAfNZMuCb"
  ],
  [
    "9B40DE76DC0878A92331",
    "3QHwUgURE8ts4_kWO639"
  ],
  [
    "Yfu5QdaOWeuxpSXiN5rK",
    "Dhv7RDXMojUW0T_jZYI4"
  ],
  [
    "htqW9lCp974x1tEWD8t7",
    "WBxrYhLbTZWuLM7DqyAa"
  ],
  [
    "Vm0gOD6OdjW4lQmHn0Fj",
    "ITkoNEc-0dHINLIDz6gG"
  ]
];
const prior = JSON.parse(bytes.approvedReadback);
if (prior.auditId!==131 || prior.approvedPhotos!==4 || prior.checks!=='passed') throw new Error('Four-cover approval receipt differs');
const excluded = new Set(prior.state.photos.map(p=>p.candidateId));
if (requested.some(([,id])=>excluded.has(id)) || candidates.length!==15 || excluded.size!==4) throw new Error('Remaining partition differs');
const pilot = JSON.parse(bytes.pilotManifest);
const pilotSourceKeys = pilot.candidates.map(c=>c.sourceKey);
if (new Set(pilotSourceKeys).size!==21) throw new Error('Pilot scope differs');
const importedRoutes = prior.state.fingerprints.routes.map(r=>r.id);
const selected = requested.map(([destinationId, candidateId]) => {
  const matches = candidates.filter(c => c.destinationId === destinationId);
  const queued = receipt.filter(r => r.type === 'candidate' && r.destinationId === destinationId);
  const places = catalog.filter(p => p.id === destinationId);
  const proposals = review.proposals.filter(p => p.destinationId === destinationId);
  if (matches.length !== 1 || queued.length !== 1 || places.length !== 1 || proposals.length !== 1) throw new Error('Missing or ambiguous fixed cover');
  const c = matches[0], q = queued[0], p = places[0], proposal = proposals[0];
  if (q.candidateId !== candidateId || q.sourcePageUrl !== c.sourcePageUrl || q.outcome !== 'eligible'
    || p.name !== c.destinationName || p.credited_cover !== false || proposal.sourcePageUrl !== c.sourcePageUrl
    || proposal.candidateSha256 !== sha(stable(c)) || !proposal.routeSourceKeys?.length || proposal.routeSourceKeys.some(k=>!pilotSourceKeys.includes(k))) throw new Error('Exact photo identity differs');
  const metadata = readFileSync(new URL(proposal.metadataFile, new URL(paths.review, root)));
  if (sha(metadata) !== proposal.metadataSha256 || !/^[a-f0-9]{40}$/.test(proposal.imageSha1)) throw new Error('Saved Commons metadata differs');
  return { candidateId, routeSourceKeys: proposal.routeSourceKeys, place: { id: p.id, name: p.name, lat: p.lat, lng: p.lng, features: p.features,
    stateCode: p.stateCode, countryCode: p.countryCode, boundary: p.boundary, externalIds: p.external_ids, elevation: p.elevation },
    candidate: { id: candidateId, destination_id: destinationId, image_url: c.imageUrl, source_page_url: c.sourcePageUrl,
      source_kind: c.sourceKind, photographer: c.photographer, license_name: c.licenseName, license_url: c.licenseUrl,
      image_width: c.imageWidth, image_height: c.imageHeight, focal_x: c.focalX, focal_y: c.focalY, notes: c.notes ?? null,
      candidate_origin: 'manifest_import', media_sha1: null, status: 'pending', final_image_url: null, reviewed_by: null, reviewed_at: null },
    imageSha1: proposal.imageSha1, metadataSha256: proposal.metadataSha256 };
});
const destinationIds = selected.map(row => row.place.id), candidateIds = selected.map(row => row.candidateId);
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const sqlArray = values => 'ARRAY[' + values.map(literal).join(',') + ']::text[]';
const destinations = sqlArray(destinationIds), queue = sqlArray(candidateIds);
const rows = (table, ids) => `(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM ${table} t WHERE t.id=ANY(${ids}))`;
const tupleQuery = `SELECT jsonb_build_object(
  'routes',(SELECT md5(COALESCE(string_agg(ctid::text||':'||xmin::text,',' ORDER BY id),'')) FROM routes),
  'segments',(SELECT md5(COALESCE(string_agg(ctid::text||':'||xmin::text,',' ORDER BY id),'')) FROM segments),
  'route_segments',(SELECT md5(COALESCE(string_agg(ctid::text||':'||xmin::text,',' ORDER BY route_id,ordinal),'')) FROM route_segments),
  'route_destinations',(SELECT md5(COALESCE(string_agg(ctid::text||':'||xmin::text,',' ORDER BY route_id,ordinal),'')) FROM route_destinations),
  'candidate_jobs',(SELECT md5(COALESCE(string_agg(ctid::text||':'||xmin::text,',' ORDER BY source_key),'')) FROM trail_catalog_candidate_jobs),
  'prior_heroes',(SELECT md5(string_agg(ctid::text||':'||xmin::text,',' ORDER BY id)) FROM destinations WHERE id=ANY(${sqlArray(prior.state.photos.map(p=>p.destinationId))})),
  'prior_photos',(SELECT md5(string_agg(ctid::text||':'||xmin::text,',' ORDER BY id)) FROM destination_photo_candidates WHERE id=ANY(${sqlArray([...excluded])})),
  'pilot_geometry',(SELECT md5(string_agg(encode(ST_AsEWKB(path::geometry),'hex'),',' ORDER BY id)) FROM routes WHERE id=ANY(${sqlArray(importedRoutes)}))
) tuple_hashes`;
const sql = `-- PREVIEW ONLY: original image_url stands in for a future Firebase Storage URL.
-- No image is rendered, uploaded, approved durably, or activated by this file.
\\set ON_ERROR_STOP on
\\pset pager off
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL idle_in_transaction_session_timeout='60s';
SET LOCAL standard_conforming_strings=on;
SET LOCAL application_name='peaks-photo-approval-rollback-preview';
DO $$ BEGIN
  IF session_user<>'postgres' OR current_user<>session_user OR current_database()<>'peaks' THEN
    RAISE EXCEPTION 'Preview requires direct peaks postgres operator connection'; END IF;
END $$;
DO $$ BEGIN
  IF (SELECT count(*) FROM trail_catalog_candidate_jobs WHERE source_key=ANY(${sqlArray(pilotSourceKeys)}))<>21
    OR (SELECT count(*) FROM trail_catalog_candidate_jobs WHERE source_key=ANY(${sqlArray(pilotSourceKeys)}) AND state='pending')<>4
    OR (SELECT count(*) FROM trail_catalog_candidate_jobs WHERE source_key=ANY(${sqlArray(pilotSourceKeys)}) AND state='rejected')<>17
    OR (SELECT count(*) FROM routes WHERE id=ANY(${sqlArray(importedRoutes)}) AND owner='peaks' AND status='pending')<>4 THEN
    RAISE EXCEPTION 'Pilot route/job partition changed'; END IF;
END $$;
\\ir bindings.sql
SELECT EXISTS(SELECT 1 FROM data_source_runs WHERE id=:'preview_audit_id'::bigint AND source='trail-catalog-photo-remaining-preview'
  AND finished_at IS NULL AND notes::jsonb->>'operator'=session_user
  AND notes::jsonb->>'previewSha256'=:'photo_preview_sha256' AND notes::jsonb->'expectedBindings'=:'photo_expected'::jsonb) audit_ok \\gset preview_
\\if :preview_audit_ok
\\else
ROLLBACK;
\\echo 'Mandatory preview audit missing or changed; no preview updates allowed'
\\quit 2
\\endif
CREATE TEMP TABLE preview_expected ON COMMIT DROP AS
  SELECT value AS binding FROM jsonb_array_elements(${literal(JSON.stringify(selected))}::jsonb);
-- Keep the existing admin action's candidate-before-destination lock order.
SELECT id FROM destination_photo_candidates WHERE id=ANY(${queue}) ORDER BY id FOR UPDATE;
SELECT id FROM destinations WHERE id=ANY(${destinations}) ORDER BY id FOR UPDATE;
DO $$ DECLARE expected JSONB; c destination_photo_candidates%ROWTYPE; d destinations%ROWTYPE; actual JSONB; BEGIN
  IF (SELECT count(*) FROM destination_photo_candidates WHERE id=ANY(${queue}))<>11
    OR (SELECT count(*) FROM destinations WHERE id=ANY(${destinations}))<>11 THEN RAISE EXCEPTION 'Exact eleven rows are missing'; END IF;
  FOR expected IN SELECT binding FROM preview_expected LOOP
    SELECT * INTO STRICT c FROM destination_photo_candidates WHERE id=(expected->>'candidateId');
    IF NOT(to_jsonb(c) @> (expected->'candidate')) THEN RAISE EXCEPTION 'Pinned candidate/source/license/framing changed: %',c.id; END IF;
    SELECT * INTO STRICT d FROM destinations WHERE id=(expected#>>'{place,id}');
    actual:=jsonb_build_object('id',d.id,'name',d.name,'lat',ST_Y(d.location::geometry),'lng',ST_X(d.location::geometry),
      'features',d.features::text[],'stateCode',d.state_code,'countryCode',d.country_code,'boundary',ST_AsGeoJSON(d.boundary::geometry)::jsonb,
      'externalIds',d.external_ids,'elevation',d.elevation);
    IF d.owner<>'peaks' OR actual IS DISTINCT FROM (expected->'place') THEN RAISE EXCEPTION 'Public place identity changed: %',d.id; END IF;
    IF NULLIF(btrim(d.hero_image),'') IS NOT NULL AND NULLIF(btrim(d.hero_image_attribution),'') IS NOT NULL
      AND NULLIF(btrim(d.hero_image_attribution_url),'') IS NOT NULL THEN RAISE EXCEPTION 'A credited hero now exists: %',d.id; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(expected->'routeSourceKeys') AS keys(key)
      WHERE NOT EXISTS(SELECT 1 FROM trail_catalog_candidate_jobs job WHERE job.source_key=keys.key AND job.state='rejected')) THEN
      RAISE EXCEPTION 'Expected blocked source candidate job changed: %',d.id; END IF;
  END LOOP;
END $$;
SELECT ${rows('destinations', destinations)} before_places,${rows('destination_photo_candidates', queue)} before_candidates \\gset preview_
${tupleQuery} \\gset preview_
CREATE TEMP TABLE preview_places_before ON COMMIT DROP AS SELECT id,to_jsonb(d) row_data FROM destinations d WHERE id=ANY(${destinations});
CREATE TEMP TABLE preview_candidates_before ON COMMIT DROP AS SELECT id,to_jsonb(c) row_data FROM destination_photo_candidates c WHERE id=ANY(${queue});
CREATE TEMP TABLE preview_counts_before ON COMMIT DROP AS SELECT (SELECT count(*) FROM destinations WHERE id=ANY(${destinations})) destinations,(SELECT count(*) FROM destination_photo_candidates WHERE id=ANY(${queue})) candidates;
CREATE TEMP TABLE preview_protected_before ON COMMIT DROP AS ${tupleQuery};
DO $$ DECLARE changed INTEGER; BEGIN
  -- Same five hero fields and updated_at as the verified-admin approval action.
  UPDATE destinations d SET hero_image=c.image_url,hero_image_attribution=c.photographer||' / '||c.license_name,
    hero_image_attribution_url=c.source_page_url,hero_image_focal_x=c.focal_x,hero_image_focal_y=c.focal_y,updated_at=now()
    FROM destination_photo_candidates c WHERE c.id=ANY(${queue}) AND d.id=c.destination_id;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>11 THEN RAISE EXCEPTION 'Expected eleven preview hero updates'; END IF;
  -- Synthetic preview marker only. This is never an actual admin UID.
  UPDATE destination_photo_candidates SET status='approved',final_image_url=image_url,
    focal_x=focal_x,focal_y=focal_y,reviewed_by='preview-only:rollback',reviewed_at=now(),
    review_note='ROLLBACK PREVIEW ONLY; original image URL stands in for Storage; no real admin approval',updated_at=now()
    WHERE id=ANY(${queue});
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>11 THEN RAISE EXCEPTION 'Expected eleven preview queue updates'; END IF;
END $$;
-- Force deferred database checks before asserting the preview outcome.
SET CONSTRAINTS ALL IMMEDIATE;
CREATE TEMP TABLE preview_protected_after ON COMMIT DROP AS ${tupleQuery};
DO $$ BEGIN
  IF (SELECT count(*) FROM destinations WHERE id=ANY(${destinations}))<>(SELECT destinations FROM preview_counts_before)
    OR (SELECT count(*) FROM destination_photo_candidates WHERE id=ANY(${queue}))<>(SELECT candidates FROM preview_counts_before)
    OR (SELECT count(*) FROM destination_photo_candidates WHERE id=ANY(${queue}) AND status='approved')<>11 THEN RAISE EXCEPTION 'Preview counts differ'; END IF;
  IF EXISTS(SELECT 1 FROM destinations d JOIN preview_places_before old USING(id) WHERE
        (to_jsonb(d)-ARRAY['hero_image','hero_image_attribution','hero_image_attribution_url','hero_image_focal_x','hero_image_focal_y','updated_at'])
          IS DISTINCT FROM(old.row_data-ARRAY['hero_image','hero_image_attribution','hero_image_attribution_url','hero_image_focal_x','hero_image_focal_y','updated_at']))
    OR EXISTS(SELECT 1 FROM destination_photo_candidates c JOIN preview_candidates_before old USING(id) WHERE
        (to_jsonb(c)-ARRAY['status','final_image_url','focal_x','focal_y','reviewed_by','reviewed_at','review_note','updated_at'])
          IS DISTINCT FROM(old.row_data-ARRAY['status','final_image_url','focal_x','focal_y','reviewed_by','reviewed_at','review_note','updated_at'])) THEN RAISE EXCEPTION 'Preview changed an unplanned field'; END IF;
  IF (SELECT tuple_hashes FROM preview_protected_before)
    IS DISTINCT FROM(SELECT tuple_hashes FROM preview_protected_after) THEN RAISE EXCEPTION 'Preview changed an unrelated destination/photo row, route, segment, link, or candidate job'; END IF;
  IF EXISTS(SELECT 1 FROM preview_expected expected
    JOIN destination_photo_candidates c ON c.id=(expected.binding->>'candidateId')
    JOIN destinations d ON d.id=c.destination_id
    WHERE (d.hero_image,d.hero_image_attribution,d.hero_image_attribution_url,d.hero_image_focal_x,d.hero_image_focal_y)
      IS DISTINCT FROM(c.image_url,c.photographer||' / '||c.license_name,c.source_page_url,c.focal_x,c.focal_y)
      OR c.final_image_url IS DISTINCT FROM c.image_url OR c.reviewed_by<>'preview-only:rollback') THEN RAISE EXCEPTION 'Preview hero/queue values differ'; END IF;
END $$;
SELECT jsonb_build_object('inside_preview','passed','preview_hero_updates',11,'preview_queue_updates',11,'storage_tested',false,'routes_activated',0) validation_result;
ROLLBACK;
-- Bounded readback: match the exact eleven target rows after rollback.
-- Whole-catalog tuple checks have already passed inside the transaction.
SELECT ${rows('destinations', destinations)} IS NOT DISTINCT FROM :'preview_before_places'::jsonb
  AND ${rows('destination_photo_candidates', queue)} IS NOT DISTINCT FROM :'preview_before_candidates'::jsonb rollback_ok \\gset preview_
\\if :preview_rollback_ok
SELECT jsonb_build_object('rollback','passed','photos_approved',0,'heroes_changed',0,'routes_activated',0,'fixed_monthly_cost_delta_usd',0) validation_result;
\\else
\\echo 'ROLLBACK READBACK FAILED: inspect live state and audit; do not retry or approve from this SQL'
\\quit 2
\\endif
`;
if (/\bCOMMIT\s*;/i.test(sql) || (sql.match(/^ROLLBACK;$/gm) ?? []).length !== 2) throw new Error('Rollback-only boundary failed');
writeFileSync(new URL('rollback-preview.sql', here), sql);
writeFileSync(new URL('manifest.json', here), JSON.stringify({ mode: 'rollback-only', queueAuditId: 116, fixedMonthlyCostDeltaUsd: 0,
  inputs: Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, { path, sha256: sha(bytes[key]) }])),
  previewSha256: sha(sql), covers: selected.map(({candidateId, place, candidate, imageSha1, metadataSha256}) => ({candidateId, destinationId: place.id, name: place.name, sourcePageUrl: candidate.source_page_url, imageSha1, metadataSha256})),
  pilotSourceKeys, importedRoutes, excludedCandidateIds: [...excluded],
  limits: ['No Storage render or upload', 'No durable approval', 'Apply only through existing verified-admin photo action'] }, null, 2)+'\n');
writeFileSync(new URL('bindings.sql',here),`SELECT ${literal(JSON.stringify(selected))}::jsonb expected, ${literal(JSON.stringify(pilotSourceKeys))}::jsonb pilot_keys, ${literal(JSON.stringify(importedRoutes))}::jsonb imported_routes, ${literal(JSON.stringify(prior.state.photos.map(p=>({candidateId:p.candidateId,destinationId:p.destinationId,storageUrl:p.storageUrl,heroAttribution:p.heroAttribution,heroSourceUrl:p.heroSourceUrl,heroFocalX:p.heroFocalX,heroFocalY:p.heroFocalY}))))}::jsonb prior_approved, ${literal(JSON.stringify(Object.fromEntries(Object.entries(paths).map(([key,path])=>[key,{path,sha256:sha(bytes[key])}]))))}::jsonb source_hashes, ${literal(sha(sql))}::text preview_sha256 \\gset photo_\n`);
const finalManifest=JSON.parse(readFileSync(new URL('manifest.json',here)));
finalManifest.files=Object.fromEntries(['build.mjs','bindings.sql','state.sql','check.sql','start.sql','readback.sql','finish.sql','preview-start.sql','preview-finish.sql','rollback-preview.sql'].map(name=>[name,sha(readFileSync(new URL(name,here)))]));
writeFileSync(new URL('manifest.json',here),JSON.stringify(finalManifest,null,2)+'\n');
console.log(JSON.stringify({ mode: 'offline-generated-rollback-only', candidates: selected.length, previewSha256: sha(sql), fixedMonthlyCostDeltaUsd: 0 }));
