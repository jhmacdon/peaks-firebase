import type { Pool, PoolClient } from "pg";
import { hasGlacierSupport } from "./schema-features";

/** Crossing times are interpolated to microseconds. Serialize them as the
 * contract's UTC millisecond ISO form, independent of the server time zone. */
export function isoUtcSql(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

/** The SQL engine serves route triggers, processSession and repairs. Reads
 * only serialize stored intervals; they never clip geometry.
 */
export function glacierCrossingsSql(kind: "route" | "session", alias: string): string {
  const session = kind === "session";
  return `COALESCE((SELECT json_agg(json_build_object(
    'destination_id',c.destination_id,'name',gd.name,'kind',gf.kind,
    'pass_index',c.pass_index,'segment_number',c.segment_number,
    'entered_distance_m',c.entered_distance_m,'exited_distance_m',c.exited_distance_m,
    'crossed_distance_m',c.crossed_distance_m,
    'entered_at',${isoUtcSql("c.entered_at")},'exited_at',${isoUtcSql("c.exited_at")},
    'entry_elevation_m',c.entry_elevation_m,'exit_elevation_m',c.exit_elevation_m,
    'min_elevation_m',c.min_elevation_m,'max_elevation_m',c.max_elevation_m,
    'starts_inside',c.starts_inside,'ends_inside',c.ends_inside,
    'entry_location',ST_AsGeoJSON(c.entry_location,7)::json,'exit_location',ST_AsGeoJSON(c.exit_location,7)::json,
    'outline_observed_at',gf.outline_observed_at,'outline_revision',c.outline_revision,
    'matcher_version',c.matcher_version,'geometry_credit',gf.geometry_credit
  ) ORDER BY c.entered_distance_m,c.destination_id,c.pass_index)
  FROM ${kind}_glacier_crossings c
  JOIN destination_glacier_facts gf ON gf.destination_id=c.destination_id
  JOIN destinations gd ON gd.id=c.destination_id
  WHERE c.${kind}_id=${alias}.id AND ${alias}.glacier_match_input_hash IS NOT NULL
    AND 'glacier'=ANY(gd.features::text[])
    AND (gd.owner='peaks' OR gd.owner=${alias}.${session ? "user_id" : "owner"})
    ${session ? `AND NOT EXISTS(SELECT 1 FROM session_destination_rejections veto
      WHERE veto.session_id=c.session_id AND veto.destination_id=c.destination_id)` : ""}), '[]'::json)`;
}
export function glacierMatchStatusSql(alias: string): string {
  return `CASE WHEN ${alias}.glacier_match_input_hash IS NULL THEN 'pending' ELSE 'complete' END`;
}
export async function refreshSessionGlacierCrossings(client: Pick<PoolClient,"query">, id: string): Promise<number> {
  const support=await client.query("SELECT to_regprocedure('public.refresh_session_glacier_crossings(text,boolean)') IS NOT NULL AS ready");
  if (support.rows[0]?.ready !== true) return 0;
  await client.query("SELECT refresh_session_glacier_crossings($1)",[id]);
  // Processing counts destinations, not repeat passes.
  const result = await client.query(`SELECT count(*)::int AS count FROM session_destinations sd
    JOIN destination_glacier_facts gf ON gf.destination_id=sd.destination_id
    WHERE sd.session_id=$1 AND sd.relation='reached' AND sd.source='auto'`,[id]);
  return result.rows[0]?.count ?? 0;
}

/** At most two serial route repairs per existing sweep request. Failed work
 * stays queued. No timers, services, full catalog scans or pool fan-out.
 */
export async function drainRouteGlacierQueue(pool: Pool, limit=2): Promise<number> {
  if (!await hasGlacierSupport()) return 0;
  const client = await pool.connect();
  let count=0;
  try {
    for (let i=0;i<Math.min(Math.max(limit,0),10);i++) {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL statement_timeout='20s'");
        const next = await client.query(`SELECT route_id FROM route_glacier_rematch_queue
          ORDER BY queued_at,route_id LIMIT 1 FOR UPDATE SKIP LOCKED`);
        if (!next.rows.length) { await client.query("COMMIT"); break; }
        await client.query("SELECT refresh_route_glacier_crossings($1)",[next.rows[0].route_id]);
        await client.query("COMMIT");
        count++;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
  } finally { client.release(); }
  return count;
}
