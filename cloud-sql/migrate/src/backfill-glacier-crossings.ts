import { resolve } from "node:path";
import { Pool } from "pg";

export interface GlacierBackfillOptions { apply: boolean; seed: boolean; limit: number; kind: "routes" | "sessions" | "both" }
export function parseGlacierBackfillOptions(args: string[]): GlacierBackfillOptions {
  const limit=Number(args.find(a=>a.startsWith("--limit="))?.slice(8) ?? 10);
  const kind=args.find(a=>a.startsWith("--kind="))?.slice(7) ?? "both";
  if (!Number.isInteger(limit) || limit<1 || limit>100) throw new Error("--limit must be 1..100");
  if (!["routes","sessions","both"].includes(kind)) throw new Error("--kind must be routes, sessions or both");
  return {apply:args.includes("--apply"),seed:args.includes("--seed"),limit,kind:kind as GlacierBackfillOptions["kind"]};
}

/** Queues are the durable resume cursor. One connection and work item at a
 * time. A failed transaction leaves its item pending for the next invocation.
 */
export async function backfillGlacierCrossings(args: string[]): Promise<void> {
  const options=parseGlacierBackfillOptions(args);
  const url=process.env.GLACIER_DATABASE_URL;
  if (!url) throw new Error("Supply GLACIER_DATABASE_URL explicitly; this command never chooses a database");
  const pool=new Pool({connectionString:url,max:1,statement_timeout:120_000,connectionTimeoutMillis:5000});
  try {
    if (!options.apply) {
      const counts=await pool.query(`SELECT
        (SELECT count(*)::int FROM route_glacier_rematch_queue) AS routes_queued,
        (SELECT count(*)::int FROM session_rematch_queue WHERE reason LIKE 'glacier:%' OR reason LIKE 'glacier-rejection:%') AS sessions_queued`);
      console.log(JSON.stringify({apply:false,...counts.rows[0],limit:options.limit})); return;
    }
    if (options.seed) {
      const ids=await pool.query("SELECT destination_id FROM destination_glacier_facts ORDER BY destination_id");
      for (const {destination_id} of ids.rows) await pool.query("SELECT queue_glacier_matches($1)",[destination_id]);
    }
    let processed=0;
    if (options.kind!=="sessions") {
      for (;processed<options.limit;processed++) {
        const c=await pool.connect();
        try {
          await c.query("BEGIN");
          const next=await c.query("SELECT route_id FROM route_glacier_rematch_queue ORDER BY queued_at,route_id LIMIT 1 FOR UPDATE SKIP LOCKED");
          if (!next.rows.length) { await c.query("COMMIT"); break; }
          await c.query("SELECT refresh_route_glacier_crossings($1,true)",[next.rows[0].route_id]);
          await c.query("COMMIT"); console.log(`route ${next.rows[0].route_id}`);
        } catch(error) {await c.query("ROLLBACK");throw error;} finally {c.release();}
      }
    }
    if (options.kind!=="routes" && processed<options.limit) {
      // Reuse the whole canonical processor: route facts, rejections, areas
      // and popularity remain consistent. Build api first. Requiring built JS
      // keeps migrate's TypeScript rootDir within its own source tree.
      const api = require(resolve(__dirname,"../../api/dist/processing.js")) as {
        processSession(id: string,uid: string,opts: {force: boolean;pool: Pool}): Promise<{skipped?: boolean}>;
      };
      for (;processed<options.limit;processed++) {
        const next=await pool.query(`SELECT q.session_id,q.queued_at,s.user_id FROM session_rematch_queue q
          JOIN tracking_sessions s ON s.id=q.session_id
          WHERE q.reason LIKE 'glacier:%' OR q.reason LIKE 'glacier-rejection:%'
          ORDER BY q.queued_at,q.session_id LIMIT 1`);
        const row=next.rows[0]; if (!row) break;
        const result=await api.processSession(row.session_id,row.user_id,{force:true,pool});
        if (result.skipped) break;
        // Do not remove work queued by a concurrent catalog edit.
        await pool.query("DELETE FROM session_rematch_queue WHERE session_id=$1 AND queued_at=$2",[row.session_id,row.queued_at]);
        console.log(`session ${row.session_id}`);
      }
    }
    console.log(JSON.stringify({processed,limit:options.limit,resume:"Repeat without --seed until processed=0"}));
  } finally {await pool.end();}
}
if (require.main===module) backfillGlacierCrossings(process.argv.slice(2)).catch(error=>{console.error(error);process.exitCode=1;});
