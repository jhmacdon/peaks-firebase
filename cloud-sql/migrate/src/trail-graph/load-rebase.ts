import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest, finalizeRows } from './compose';
import { planRoute, runPlans, planCounts, type LoadOptions, type RoutePlan } from './load-catalog';
import { IMPORT_MARKER } from './load-matching';
import { SCHEMA_PREFLIGHT } from './load-preflight';
import { routeLine } from './stretches';
import { legacyHash, leased, rebasePlanHash, type MergePlan, type RebasePlan } from './rebase';
import type { ComposedRoute } from './catalog-types';
import type { Segment } from './types';

const REVIEWED = "('approved','publish_leased','published','verify_leased','verified','rejected')";
const links = (r: ComposedRoute) => r.segments.map((s, ordinal) => ({ id: s.id, direction: s.direction, ordinal }));
const mergeHash = (m: MergePlan) => digest({ ...m, plan_hash: undefined });
const omitted = new Set(['route_insert','route_destination_insert','destination_insert','binding_guard','review_guard','activate','legacy_supersede','supersede_claim','session_rematch_queue','session_routes_move','session_routes_delete_legacy']);
const sourceUnion = `UPDATE routes SET provenance=(SELECT wa_catalog_union_provenance(jsonb_agg(s.provenance ORDER BY rs.ordinal))
  FROM route_segments rs JOIN segments s ON s.id=rs.segment_id WHERE rs.route_id=$1)||jsonb_build_object('wa_catalog',$2::jsonb) WHERE id=$1`;
export const SOURCE_SCHEMA_PREFLIGHT = `SELECT to_regprocedure('wa_catalog_union_provenance(jsonb)') IS NOT NULL
  AND to_regprocedure('wa_catalog_provenance_elevation(jsonb,jsonb)') IS NOT NULL AND to_regclass('wa_catalog_rebase_receipts') IS NOT NULL AS ready`;

export function replacementPlan(row: ComposedRoute, source: Map<string, Segment>, rebase: RebasePlan, options: LoadOptions = {}, merge?: MergePlan): RoutePlan {
  const fail = (reason: string): RoutePlan => ({ route_id: rebase.legacy.id, seed_index: row.seed_index, statements: [], segment_ids: [], destination_ids: [], activate: false, notes: [], reused_segment_ids: [], segment_data: source, operation: merge ? 'merge' : 'rebase', skipped: reason });
  if (rebase.frozen || rebase.legacy.catalog_reviewed) return fail('catalog_reviewed: frozen');
  if (rebase.status !== 'ok') return fail(`rebase ${rebase.status}: ${rebase.reasons.join('; ')}`);
  if (leased(rebase.legacy)) return fail('live factory lease');
  if (legacyHash(rebase.legacy) !== rebase.source_hash || rebase.plan_hash !== rebasePlanHash(rebase)) throw new Error('Rebase plan hash mismatch');
  if (merge && (merge.plan_hash !== mergeHash(merge) || merge.legacy_id !== rebase.legacy.id || merge.seed_index !== row.seed_index)) throw new Error('Merge plan hash mismatch');
  if (merge?.status === 'review') return fail(`merge review: ${merge.reasons.join('; ')}`);
  const draft = structuredClone(row);
  // Both modes use their contacted composition manifest, never unchecked live
  // legacy links. The row records dropped links for provenance audit.
  if (!merge) finalizeRows([draft], [...source.values()]);
  const base = planRoute(draft, source, { ...options, activate: false, supersede: undefined, replacementId: rebase.legacy.id,
    supersededIds: new Set([...(options.supersededIds ?? []), rebase.legacy.id]) });
  if (base.skipped) return { ...base, route_id: rebase.legacy.id, operation: merge ? 'merge' : 'rebase' };
  const id = rebase.legacy.id, oldId = base.route_id, p: RoutePlan = { ...base, route_id: id, operation: merge ? 'merge' : 'rebase', legacy_expected: { name: rebase.legacy.name, status: rebase.legacy.status }, activate: false, statements: [], notes: [...base.notes, ...(merge?.reasons ?? []), 'Preserve legacy route identity, status and session links; live source/lease/integrity checks required'] };
  const add = (kind: string, sql: string, values: unknown[] = []) => p.statements.push({ kind, sql, values });
  add('begin', 'BEGIN'); add('lock', "SELECT pg_advisory_xact_lock(hashtextextended('wa_trail_catalog_loader',0))");
  add('factory_lock', `SELECT state,lease_expires_at,lease_owner FROM standard_route_backfill_jobs WHERE published_route_id=$1
    OR destination_id IN(SELECT destination_id FROM route_destinations WHERE route_id=$1) ORDER BY destination_id FOR UPDATE`, [id]);
  if (merge) add('completed_rebase_guard', `SELECT EXISTS(SELECT 1 FROM wa_catalog_rebase_receipts WHERE route_id=$1 AND source_hash=$2 AND binding_hash=$3) AS valid`,[id,rebase.source_hash,digest(rebase.row.segments)]);
  add('replacement_resume_guard', `SELECT r.owner='peaks' AND r.status=$5 AND r.name=ANY($6::text[])
    AND NOT EXISTS(SELECT 1 FROM trail_catalog_review_jobs j WHERE j.route_id=r.id AND j.state IN ${REVIEWED})
    AND r.provenance#>>'{wa_catalog,loaded_binding_hash}'=$3 AND r.provenance#>'{wa_catalog,notes}' @> $4::jsonb
    AND (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',segment_id,'direction',direction,'ordinal',ordinal) ORDER BY ordinal),'[]') FROM route_segments WHERE route_id=r.id)=$2::jsonb
    AND EXISTS(SELECT 1 FROM wa_catalog_rebase_receipts WHERE route_id=r.id AND source_hash=$7 AND binding_hash=$8)
    AND route_segments_cover_provenance(r.id) AND (r.status<>'active' OR (peaks_route_passes_publish_integrity(r.id,NULL,'active')
      AND NOT EXISTS(SELECT 1 FROM ST_DumpPoints(r.path::geometry) point WHERE ST_Z((point).geom) IS NULL OR ST_Z((point).geom)=0))) AS already_applied
    FROM routes r WHERE id=$1 FOR UPDATE`, [id, JSON.stringify(base.statements.filter(s => s.kind === 'route_segment_insert').map(s => ({ id: s.values[1], direction: s.values[3], ordinal: s.values[2] }))),
      digest(base.statements.filter(s => s.kind === 'route_segment_insert').map(s => ({ id: s.values[1], direction: s.values[3] }))), JSON.stringify([`Legacy graph rebase ${rebase.source_hash}`]), rebase.legacy.status, [rebase.legacy.name, displayLegacyName(rebase.legacy.name)],rebase.source_hash,digest(rebase.row.segments)]);
  const originalLinks = (rebase.legacy.segments ?? []).map(s => ({ id: s.id, direction: s.direction, ordinal: s.ordinal }));
  const expected = merge ? links(rebase.row) : originalLinks;
  add('replacement_guard', `SELECT r.id,r.name,r.status,r.owner,r.provenance,
    EXISTS(SELECT 1 FROM trail_catalog_review_jobs j WHERE j.route_id=r.id AND j.state IN ${REVIEWED}) AS protected,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',segment_id,'direction',direction,'ordinal',ordinal) ORDER BY ordinal),'[]') FROM route_segments WHERE route_id=r.id)=$2::jsonb AS links_match,
    ST_HausdorffDistance(ST_Transform(ST_Force2D(r.path::geometry),32610),ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($3),4326),32610))<=0.05 AS source_match
    FROM routes r WHERE id=$1 FOR UPDATE`, [id, JSON.stringify(expected), JSON.stringify({ type: 'LineString', coordinates: merge?routeLine(rebase.row,source):rebase.legacy.coords })]);
  const provenance = JSON.parse((base.statements.find(s => s.kind === 'route_insert')!.values[5] as string));
  const metadata = { ...(provenance.wa_catalog ?? {}), loader: IMPORT_MARKER, notes: [...(provenance.wa_catalog?.notes ?? []), `Legacy graph rebase ${rebase.source_hash}`] };
  for (const statement of base.statements.filter(s => !omitted.has(s.kind) && !['begin','lock','commit'].includes(s.kind))) {
    if (statement.kind === 'route_segment_insert' && !p.statements.some(s => s.kind === 'replace_links')) add('replace_links', 'DELETE FROM route_segments WHERE route_id=$1', [id]);
    let next = { ...statement, values: statement.values.map(v => v === oldId ? id : v) };
    if (statement.kind === 'segment_insert') {
      const segment = source.get(statement.values[0] as string)!;
      if (segment.legacy_tail) {
        // Josiah confirmed the pre-catalog Peaks-owned lines were drawn or
        // recorded by Peaks. Preserve valid source rights; otherwise bind Peaks
        // credit to this locked route's actual created_at, never the load date.
        add('legacy_source_guard', "SELECT owner='peaks' AND created_at IS NOT NULL AS valid FROM routes WHERE id=$1", [id]);
        next = { kind: 'legacy_tail_insert', sql: statement.sql.replace('$7::jsonb', `CASE WHEN $7::jsonb IS NOT NULL THEN (SELECT
          CASE WHEN is_valid_route_provenance(provenance) THEN wa_catalog_provenance_elevation(provenance,'{}'::jsonb) ELSE jsonb_build_object(
            'source_kind','peaks-legacy','source_url','https://peaks.app','license_name','Peaks','license_url','https://peaks.app','attribution','Peaks',
            'retrieved_at',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'osm_way_ids','[]'::jsonb,'osm_way_urls','[]'::jsonb,'contains_osm_geometry',false) END
          ||'{"wa_catalog":{"loader":"wa-trail-graph-v2"}}'::jsonb FROM routes WHERE id=$11 AND owner='peaks' AND created_at IS NOT NULL) END`), values: [...statement.values, id] };
      }
    }
    if (statement.kind === 'rebuild_route_path') {
      add('replacement_links_guard', `SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('id',segment_id,'direction',direction,'ordinal',ordinal) ORDER BY ordinal)
        FROM route_segments WHERE route_id=$1),'[]')=$2::jsonb AS valid`, [id, JSON.stringify(base.statements.filter(s => s.kind === 'route_segment_insert').map(s => ({ id: s.values[1], direction: s.values[3], ordinal: s.values[2] })))]);
      add('segment_xy_guard', `SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements($1::jsonb) item LEFT JOIN segments s ON s.id=item->>'id'
        WHERE s.id IS NULL OR NOT COALESCE(ST_OrderingEquals(ST_Force2D(s.path::geometry),ST_SetSRID(ST_GeomFromGeoJSON(item->>'geometry'),4326)),false)) AS valid`,
        [JSON.stringify(p.segment_ids.map(id => ({ id, geometry: { type: 'LineString', coordinates: p.segment_data.get(id)!.coords } })))]);
      for (const place of base.statements.filter(s => s.kind === 'destination_insert')) p.statements.push(place);
      if (merge) {
        const values = base.statements.find(s => s.kind === 'route_insert')!.values;
        add('merge_metadata', `UPDATE routes SET name=$2,search_name=peaks_search_name($2),kind=$3,shape=$4::route_shape,trailhead_destination_id=$5,objective_destination_id=$6,
          slug=COALESCE(NULLIF(slug,''),peaks_route_catalog_slug($7,id)),
          external_links=COALESCE(external_links,'[]'::jsonb)||COALESCE((SELECT jsonb_agg(link) FROM jsonb_array_elements($8::jsonb) link
            WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(external_links,'[]'::jsonb)) old WHERE old=link)),'[]'::jsonb)
          WHERE id=$1`, [id, displayLegacyName(rebase.legacy.name), values[2], values[6], values[7], values[8], row.name, values[4]]);
      }
      else add('rebase_metadata',`UPDATE routes SET kind=$2,shape=$3::route_shape,
        trailhead_destination_id=$4,objective_destination_id=$5 WHERE id=$1`,[id,row.kind,row.shape,base.statements.find(s=>s.kind==='route_insert')!.values[7],base.statements.find(s=>s.kind==='route_insert')!.values[8]]);
      add('replace_destinations', 'DELETE FROM route_destinations WHERE route_id=$1', [id]);
      for (const place of base.statements.filter(s => s.kind === 'route_destination_insert')) p.statements.push({ ...place, values: place.values.map(v => v === oldId ? id : v) });
      add('replacement_provenance', sourceUnion, [id, JSON.stringify(metadata)]);
    }
    p.statements.push(next);
  }
  // Both use the composed destination order and retain status/session_routes.
  add('source_integrity', `SELECT is_valid_route_provenance(provenance) AND route_segments_cover_provenance(id) AS valid FROM routes WHERE id=$1`, [id]);
  add('active_integrity', `SELECT status<> 'active' OR (peaks_route_passes_publish_integrity(id,NULL,'active') AND gain IS NOT NULL AND gain_loss IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM ST_DumpPoints(path::geometry) point WHERE ST_Z((point).geom) IS NULL OR ST_Z((point).geom)=0)) AS valid,
    jsonb_build_object('contact',peaks_route_kind_passes_contact(id,NULL),'sources',route_segments_cover_provenance(id),'gain_present',gain IS NOT NULL AND gain_loss IS NOT NULL,
      'summit_gaps',(SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'gap_m',ST_Distance(r.path,d.location))) FROM route_destinations rd JOIN destinations d ON d.id=rd.destination_id WHERE rd.route_id=r.id AND 'summit'::destination_feature=ANY(d.features))) AS diagnostics FROM routes r WHERE id=$1`, [id]);
  if (!merge) add('rebase_receipt', `INSERT INTO wa_catalog_rebase_receipts(route_id,source_hash,binding_hash) VALUES($1,$2,$3)
    ON CONFLICT(route_id) DO UPDATE SET source_hash=EXCLUDED.source_hash,binding_hash=EXCLUDED.binding_hash,completed_at=clock_timestamp()`,[id,rebase.source_hash,digest(rebase.row.segments)]);
  add('delete_unused_legacy_segments', `DELETE FROM segments s WHERE id=ANY($1::text[]) AND NOT(id=ANY($2::text[]))
    AND NOT EXISTS(SELECT 1 FROM route_segments rs WHERE rs.segment_id=s.id)
    AND NOT EXISTS(SELECT 1 FROM wa_catalog_activation_receipts receipt WHERE s.id=ANY(receipt.segment_ids))
    AND NOT wa_catalog_has_references('public.segments'::regclass,s.id) RETURNING id`, [[...new Set([...(rebase.legacy.segments ?? []).map(s => s.id), ...(merge ? rebase.row.segments.map(s => s.id) : [])])], p.segment_ids]);
  add('commit', 'COMMIT'); return p;
}
import { displayName } from './display-names';
export const displayLegacyName = (name: string) => displayName(name) ?? name;
export async function rebaseLoad(dir: string, plans: RebasePlan[], segments: Map<string, Segment>, apply: boolean, elevation: boolean): Promise<void> {
  const result = plans.map(p => { try { return replacementPlan(p.row, segments, p, { elevation }); } catch (e) { return { route_id: p.legacy.id, seed_index: p.row.seed_index, operation: 'rebase', statements: [], segment_ids: [], destination_ids: [], activate: false, notes: [], reused_segment_ids: [], segment_data: segments, skipped: (e as Error).message } as RoutePlan; } });
  const report = { mode: apply ? 'apply' : 'dry-run', counts: planCounts(result), unverified: 'Live factory leases, source provenance, elevation and active integrity are checked per transaction; no DB in dry-run', plans: result.map(({ segment_data, ...p }) => p) };
  await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'rebase-load-plan.json'), JSON.stringify(report, null, 2)+'\n'); console.log(JSON.stringify({ ...report, plans: undefined }, null, 2));
  if (!apply) return;
  if (!process.env.DATABASE_URL) throw new Error('--apply requires DATABASE_URL');
  if (!elevation && plans.some(p => p.status === 'ok' && p.legacy.status === 'active')) throw new Error('Active route rebase requires --elevation');
  const { Client } = await import('pg'), client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try {
    const schema = (await client.query(SCHEMA_PREFLIGHT)).rows[0]; if (!schema?.rebuild_ready || !schema.activation_ready || schema.lease_bound_worker) throw new Error('Rebase needs the segment and WA provenance migrations and an operator connection');
    if (!(await client.query(SOURCE_SCHEMA_PREFLIGHT)).rows[0]?.ready) throw new Error('Install 20261017_wa_catalog_source_bundles.sql before rebase');
    await client.query("SELECT pg_advisory_lock(hashtextextended('wa_trail_catalog_loader',0))");
    const sample = elevation ? async (points: { lng: number; lat: number }[]) => { const { sampleTerrariumProfile } = await import('../lib/terrarium-route-profile'); return sampleTerrariumProfile(points, { cacheDir: join(dir, 'terrarium') }); } : undefined;
    await runPlans(client, result, segments, dir, { sample, resultsFile: 'rebase-load-results.json' });
  } finally { await client.end(); }
}
