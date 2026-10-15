/** Queue matching v2 repairs. Dry-run unless --apply; never runs processing.
 *
 * Usage: DATABASE_URL=postgres://... tsx src/rematch-all-sessions.ts [--apply]
 *        [--batch-size 100] [--after session-id]
 * Production use is a separate, authorized data operation.
 */
import { Pool } from "pg";

export function parseRematchArgs(args: string[]): { apply: boolean; batchSize: number; after: string } {
  let apply = false;
  let batchSize = 100;
  let after = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") apply = true;
    else if (args[i] === "--dry-run") apply = false;
    else if (args[i] === "--after" && args[i + 1]) after = args[++i];
    else if (args[i] === "--batch-size" && args[i + 1]) {
      batchSize = Number(args[++i]);
      if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
        throw new Error("--batch-size must be an integer from 1 to 1000");
      }
    } else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  return { apply, batchSize, after };
}

export const REMATCH_BATCH_SQL = `SELECT s.id FROM tracking_sessions s
  WHERE s.id > $1 AND (
    EXISTS (SELECT 1 FROM session_routes sr WHERE sr.session_id = s.id)
    OR (s.path IS NOT NULL AND EXISTS (
      SELECT 1 FROM routes r WHERE r.status='active' AND (r.owner='peaks' OR r.owner=s.user_id)
      AND CASE WHEN r.id=ANY(ARRAY['triple-crown-pct','triple-crown-at','triple-crown-cdt']) THEN EXISTS (
        SELECT 1 FROM triple_crown_route_points p WHERE p.route_id=r.id
          AND p.pt && session_match_bbox(s.path)
          AND ST_DWithin(p.pt::geography,s.path,600)
      ) ELSE EXISTS (
        SELECT 1 FROM ST_Subdivide(r.path::geometry,512) piece(geom)
        WHERE piece.geom && session_match_bbox(s.path)
          AND ST_DWithin(s.path,piece.geom::geography,600)
      ) OR EXISTS (
        SELECT 1 FROM route_segments rs JOIN segments seg ON seg.id=rs.segment_id
        CROSS JOIN LATERAL ST_Subdivide(seg.path::geometry,512) piece(geom)
        WHERE rs.route_id=r.id AND seg.path && session_match_bbox(s.path)::geography
          AND piece.geom && session_match_bbox(s.path)
          AND ST_DWithin(s.path,piece.geom::geography,600)
      ) END
    ))
  ) ORDER BY s.id LIMIT $2`;

type Queryable = Pick<Pool, "query">;
export async function enqueueAllSessions(q: Queryable, options: ReturnType<typeof parseRematchArgs>): Promise<number> {
  let after = options.after;
  let total = 0;
  for (;;) {
    const batch = await q.query(REMATCH_BATCH_SQL, [after, options.batchSize]);
    const ids = batch.rows.map((row: { id: string }) => row.id);
    if (ids.length === 0) return total;
    if (options.apply) {
      await q.query(`INSERT INTO session_rematch_queue (session_id, reason)
        SELECT id, 'repair:segment-model-v2' FROM unnest($1::text[]) AS session(id)
        ON CONFLICT (session_id) DO UPDATE SET reason = EXCLUDED.reason, queued_at = now()`, [ids]);
    }
    total += ids.length;
    after = ids[ids.length - 1];
    console.log(`${options.apply ? "Queued" : "Would queue"} ${total}; --after ${after}`);
  }
}

async function main(): Promise<void> {
  const options = parseRematchArgs(process.argv.slice(2));
  // An explicit URL avoids accidentally inheriting migration DB_* defaults.
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL (or TEST_DATABASE_URL for a local test database)");
  if (process.env.TEST_DATABASE_URL && !new URL(url).pathname.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL must name a database ending in _test");
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    if (!options.apply) await pool.query("SET default_transaction_read_only = on");
    const count = await enqueueAllSessions(pool, options);
    console.log(`${options.apply ? "Queued" : "Dry run:"} ${count} sessions`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
