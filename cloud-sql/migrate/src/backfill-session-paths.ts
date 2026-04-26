/**
 * One-shot backfill of tracking_sessions.path for sessions that already have
 * tracking_points but predate the path-column migration (20260426_session_path).
 *
 * Required reading: cloud-sql/migrations/20260426_session_path.sql.
 *
 * Builds the linestring with ST_MakeLine over tracking_points ORDERed by time
 * — same construction used by processSession Step 0. Skips sessions that
 * already have a non-null path (idempotent re-runs are cheap) and skips
 * sessions with <2 points (a single-point line isn't a line).
 *
 * Usage:
 *   DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=peaks DB_USER=peaks-api \
 *   DB_PASS=$(gcloud secrets versions access latest --secret=peaks-db-password \
 *     --project=donner-a8608) \
 *   npx tsx src/backfill-session-paths.ts
 *
 * Requires cloud-sql-proxy to the donner-a8608:us-central1:peaks-db instance.
 */

import db from "./db";

const BATCH = 50;

async function main() {
  console.log("Backfilling tracking_sessions.path …");

  // Find sessions missing a path that have at least 2 tracking points.
  const candidates = await db.query<{ id: string; pts: string }>(
    `SELECT s.id, COUNT(tp.*)::text AS pts
       FROM tracking_sessions s
       JOIN tracking_points tp ON tp.session_id = s.id
       WHERE s.path IS NULL
       GROUP BY s.id
       HAVING COUNT(tp.*) >= 2
       ORDER BY s.id`
  );

  console.log(`${candidates.rows.length} sessions need a path`);

  let done = 0;
  let failed = 0;
  for (let i = 0; i < candidates.rows.length; i += BATCH) {
    const slice = candidates.rows.slice(i, i + BATCH);
    const ids = slice.map((r) => r.id);
    try {
      const result = await db.query(
        `UPDATE tracking_sessions s
         SET path = (
           SELECT ST_MakeLine(tp.location::geometry ORDER BY tp.time)::geography
           FROM tracking_points tp
           WHERE tp.session_id = s.id
         )
         WHERE s.id = ANY($1::text[])`,
        [ids]
      );
      done += result.rowCount ?? 0;
    } catch (err) {
      failed += ids.length;
      console.error(`Batch failed (ids: ${ids.slice(0, 3).join(", ")}…):`, err);
    }
    process.stdout.write(`\r  ${done}/${candidates.rows.length} done (${failed} failed)`);
  }
  process.stdout.write("\n");

  // Sanity check: how many sessions still lack a path?
  const remaining = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM tracking_sessions WHERE path IS NULL`
  );
  console.log(`Sessions still without path: ${remaining.rows[0].count}`);

  await db.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
