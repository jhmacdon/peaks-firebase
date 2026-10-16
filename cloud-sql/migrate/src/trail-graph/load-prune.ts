import { IMPORT_MARKER } from './load-matching';
import type { RoutePlan, Statement } from './load-catalog';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SCHEMA_PREFLIGHT } from './load-preflight';
import type { Client } from 'pg';
export function prunePlan(plans: RoutePlan[], keepRouteIds: string[]): Statement[] {
  const marker = JSON.stringify({ wa_catalog: { loader: IMPORT_MARKER } });
  const segments = [...new Set(plans.flatMap(p => p.segment_ids))], places = [...new Set(plans.flatMap(p => p.destination_ids ?? []))];
  return [
    { kind: 'begin', sql: 'BEGIN', values: [] },
    { kind: 'lock', sql: "SELECT pg_advisory_xact_lock(hashtextextended('wa_trail_catalog_loader',0))", values: [] },
    { kind: 'prune_routes', sql: `DELETE FROM routes r WHERE id LIKE 'wa-%' AND status='pending'
      AND provenance @> $1::jsonb AND NOT(id=ANY($2::text[]))
      AND NOT EXISTS(SELECT 1 FROM wa_catalog_activation_receipts a WHERE a.route_id=r.id)
      AND NOT EXISTS(SELECT 1 FROM session_routes sr WHERE sr.route_id=r.id)
      AND NOT EXISTS(SELECT 1 FROM trail_catalog_review_jobs j WHERE j.route_id=r.id)
      AND NOT wa_catalog_has_references('public.routes'::regclass,r.id,ARRAY['public.route_segments'::regclass,'public.route_destinations'::regclass]) RETURNING id`, values: [marker, keepRouteIds] },
    { kind: 'prune_segments', sql: `DELETE FROM segments s WHERE id LIKE 'wa-%' AND provenance @> $1::jsonb AND NOT(id=ANY($2::text[]))
      AND NOT EXISTS(SELECT 1 FROM wa_catalog_activation_receipts a WHERE s.id=ANY(a.segment_ids))
      AND NOT wa_catalog_has_references('public.segments'::regclass,s.id) RETURNING id`, values: [marker, segments] },
    { kind: 'prune_places', sql: `DELETE FROM destinations d WHERE id LIKE 'wa-%' AND metadata->'provenance' @> $1::jsonb AND NOT(id=ANY($2::text[]))
      AND NOT EXISTS(SELECT 1 FROM wa_catalog_activation_receipts a WHERE d.id=ANY(a.destination_ids))
      AND NOT wa_catalog_has_references('public.destinations'::regclass,d.id) RETURNING id`, values: [marker, places] },
    { kind: 'commit', sql: 'COMMIT', values: [] },
  ];
}
export async function executePrune(client: Pick<Client,'query'>, statements: Statement[]) {
  const results: { kind: string; ids: string[] }[] = [];
  try { for (const s of statements) { if (!['begin','lock','prune_routes','prune_segments','prune_places','commit'].includes(s.kind)) throw new Error('Non-prune SQL in prune mode'); const r = await client.query(s.sql,s.values); if (s.kind.startsWith('prune_')) results.push({kind:s.kind,ids:r.rows.map(row=>row.id)}); } }
  catch (e) { await client.query('ROLLBACK'); throw e; } return results;
}
export async function pruneOnly(dir: string, plans: RoutePlan[], keepRouteIds: string[], apply: boolean): Promise<void> {
  const statements = prunePlan(plans,keepRouteIds), report = {mode:apply?'apply':'dry-run',operation:'prune',statements};
  await writeFile(join(dir,'prune-plan.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({mode:report.mode,operation:'prune',statements:statements.map(s=>s.kind),catalog_routes_loaded:0,merges:0,rebases:0},null,2));
  if (!apply) return; if (!process.env.DATABASE_URL) throw new Error('--apply requires DATABASE_URL');
  const {Client} = await import('pg'),client = new Client({connectionString:process.env.DATABASE_URL});await client.connect();
  try {const schema=(await client.query(SCHEMA_PREFLIGHT)).rows[0];if(!schema?.activation_ready||schema.lease_bound_worker)throw new Error('Prune requires the WA migration and an operator connection');const results=await executePrune(client,statements);await writeFile(join(dir,'prune-results.json'),JSON.stringify(results,null,2)+'\n');}finally{await client.end();}
}
