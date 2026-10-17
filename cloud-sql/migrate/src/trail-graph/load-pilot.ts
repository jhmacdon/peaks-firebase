import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Client } from 'pg';
import type { Statement } from './load-catalog';
import { ndjson } from './io';
import { PILOT_BATCH, PILOT_REJECTION, WA_PILOTS } from './pilot-routes';

export const PILOT_SCHEMA = `SELECT to_regprocedure('retire_wa_catalog_pilot(text)') IS NOT NULL AS ready,
  session_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='trail_catalog_candidate_jobs'::regclass))
    AND NOT pg_has_role(session_user,'peaks-route-factory','member') AND NOT pg_has_role(session_user,'peaks-route-reviewer','member') AS operator`;
export const PILOT_STATE = `SELECT p.id,
  (j.source_key IS NULL AND r.id IS NULL) OR (j.batch_key=$2 AND j.state='rejected' AND j.route_id IS NULL AND j.rejection_reason=$3
    AND j.result#>>'{wa_graph_retirement,route_id}'=p.id AND r.owner='peaks' AND r.status='superseded'
    AND NOT EXISTS(SELECT 1 FROM trail_catalog_review_jobs review WHERE review.route_id=p.id OR review.source_key=j.source_key)
    AND NOT EXISTS(SELECT 1 FROM wa_catalog_activation_receipts a WHERE a.route_id=p.id)
    AND NOT EXISTS(SELECT 1 FROM route_segments WHERE route_id=p.id)
    AND NOT EXISTS(SELECT 1 FROM route_destinations WHERE route_id=p.id)
    AND NOT EXISTS(SELECT 1 FROM session_routes WHERE route_id=p.id)
    AND NOT EXISTS(SELECT 1 FROM list_routes WHERE route_id=p.id)
    AND NOT EXISTS(SELECT 1 FROM plan_routes WHERE route_id=p.id)
    AND NOT EXISTS(SELECT 1 FROM trip_report_routes WHERE route_id=p.id)) AS retired
  FROM unnest($1::text[]) p(id) LEFT JOIN trail_catalog_candidate_jobs j ON j.proposed_route_id=p.id LEFT JOIN routes r ON r.id=p.id`;
export async function assertPilotsRetired(client: Pick<Client, 'query'>): Promise<void> {
  const schema = (await client.query(PILOT_SCHEMA)).rows[0];
  if (!schema?.ready || !schema.operator) throw new Error('Pilot retirement requires the corrected 20261017 migration and candidate table owner operator login');
  const rows = (await client.query(PILOT_STATE, [WA_PILOTS.map(p => p.id), PILOT_BATCH, PILOT_REJECTION])).rows;
  const pending = WA_PILOTS.filter(p => rows.find(r => r.id === p.id)?.retired !== true);
  if (pending.length) throw new Error(`Run --retire-pilot first; unretired or unsafe pilot routes: ${pending.map(p => p.name).join('; ')}`);
}
export function pilotPlan(routeId: string): Statement[] {
  if (!WA_PILOTS.some(p => p.id === routeId)) throw new Error(`Not an approved pilot: ${routeId}`);
  return [
    { kind: 'begin', sql: 'BEGIN', values: [] },
    { kind: 'lock', sql: "SELECT pg_advisory_xact_lock(hashtextextended('wa_trail_catalog_loader',0))", values: [] },
    { kind: 'retire_pilot', sql: 'SELECT retire_wa_catalog_pilot($1) AS result', values: [routeId] },
    { kind: 'commit', sql: 'COMMIT', values: [] },
  ];
}
export async function executePilot(client: Pick<Client, 'query'>, statements: Statement[]): Promise<unknown> {
  let result: unknown;
  try {
    for (const s of statements) {
      if (!['begin','lock','retire_pilot','commit'].includes(s.kind)) throw new Error('Non-retirement SQL in retire-pilot mode');
      const r = await client.query(s.sql, s.values);
      if (s.kind === 'retire_pilot') {
        const receipt = r.rows[0]?.result;
        if (!receipt || receipt.route_id !== s.values[0] || !['retired','already_retired','not_present'].includes(receipt.outcome)) throw new Error('Invalid pilot retirement receipt');
        result = receipt;
      }
    }
    return result;
  } catch (e) { await client.query('ROLLBACK'); throw e; }
}
export async function retirePilots(dir: string, input: string, apply: boolean): Promise<void> {
  await mkdir(dir, { recursive: true });
  const snapshots = new Map<string, { segments: { id: string }[] | null }>();
  try { for await (const r of ndjson<{ id: string; segments: { id: string }[] | null }>(join(input, 'peaks-snapshot/wa-legacy-routes-with-paths.ndjson'))) snapshots.set(r.id, r); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const plans = WA_PILOTS.map(p => ({ ...p, statements: pilotPlan(p.id), snapshot_segment_ids: (snapshots.get(p.id)?.segments ?? []).map(s => s.id) }));
  const counts = { candidates: plans.length, transactions: plans.length, job_rejections: plans.length, route_retirements: plans.length,
    statements: plans.reduce((n, p) => n + p.statements.length, 0), snapshot_segment_links: plans.reduce((n, p) => n + p.snapshot_segment_ids.length, 0),
    snapshot_unique_segments: new Set(plans.flatMap(p => p.snapshot_segment_ids)).size };
  const report = { mode: apply ? 'apply' : 'dry-run', operation: 'retire-pilot', batch: PILOT_BATCH, rejection_reason: PILOT_REJECTION, counts,
    note: 'Four guarded function calls; live receipt/review/status/user-reference checks and unreferenced segment deletion occur inside each transaction. Snapshot counts are not affected-row counts.', plans };
  await writeFile(join(dir, 'retire-pilot-plan.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ ...report, plans: undefined }, null, 2));
  if (!apply) return;
  if (!process.env.DATABASE_URL) throw new Error('--apply requires DATABASE_URL');
  const { Client } = await import('pg'), client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try {
    const schema = (await client.query(PILOT_SCHEMA)).rows[0]; if (!schema?.ready || !schema.operator) throw new Error('Retire-pilot requires the corrected 20261017 migration and candidate table owner operator login');
    const results: { id: string; result?: unknown; error?: string }[] = [];
    for (const p of plans) {
      try { results.push({ id: p.id, result: await executePilot(client, p.statements) }); }
      catch (e) { results.push({ id: p.id, error: (e as Error).message }); }
      await writeFile(join(dir, 'retire-pilot-results.json'), JSON.stringify(results, null, 2) + '\n');
    }
  } finally { await client.end(); }
}
