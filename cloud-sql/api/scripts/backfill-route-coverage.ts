/**
 * Recompute session_routes coverage and covered_intervals across ALL history.
 *
 * Two things it fixes at once, and they are the same computation: recordings
 * that covered a real stretch of a route but never earned a row under the old
 * 0.70-only gate, and rows that have a coverage but no covered_intervals
 * because they predate the column.
 *
 * Running this against production is a separate, explicitly confirmed step.
 * It is not part of implementing or reviewing the feature. Do a --dry-run
 * first, read the counts, and only then run it with --apply.
 *
 * Safe to interrupt and re-run: every write is an upsert keyed by
 * (session_id, route_id), so a second run recomputes the same values. It never
 * deletes a row, never touches a 'manual' row (the user's own claim), and never
 * changes a session's processing state.
 *
 *   # proxy in another terminal:
 *   cloud-sql-proxy donner-a8608:us-central1:peaks-db --port 5433
 *
 *   cd cloud-sql/api
 *   DB_HOST=127.0.0.1 DB_PORT=5433 DB_NAME=peaks DB_USER=peaks-api \
 *   DB_PASS=... DB_POOL_MAX=2 \
 *     npm run backfill:route-coverage -- --dry-run
 *
 * Flags:
 *   --dry-run        measure and report; write nothing (the default)
 *   --apply          actually write
 *   --limit <n>      cap sessions processed this run
 *   --delay-ms <n>   pause between sessions (default 300)
 *   --user <uid>     restrict to one user
 */

import db from "../src/db";
import {
  measureSessionRouteCoverage,
  upsertSessionRouteCoverage,
} from "../src/processing";

function intFlag(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const n = Number.parseInt(process.argv[i + 1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
/**
 * Like intFlag, but 0 is a real value. `--delay-ms 0` means "no pause", and
 * intFlag's `> 0` test would silently hand back the 300 ms default, making the
 * run header claim a delay the run is not taking.
 */
function nonNegativeIntFlag(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const n = Number.parseInt(process.argv[i + 1] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function strFlag(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

const APPLY = process.argv.includes("--apply");
const DELAY_MS = nonNegativeIntFlag("--delay-ms", 300);
const LIMIT = intFlag("--limit", Number.MAX_SAFE_INTEGER);
const USER = strFlag("--user");

if (APPLY && process.argv.includes("--dry-run")) {
  console.error("Pass --dry-run or --apply, not both.");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log(`[backfill-route-coverage] apply=${APPLY} delay=${DELAY_MS}ms`);
  if (!APPLY) {
    console.log("[backfill-route-coverage] dry run: measuring only, no writes");
  }

  // Only sessions whose track is already materialized. A recording with points
  // but no path has never been processed at all; queueing those is
  // processSession's job, not this script's, so they are counted and left.
  const { rows } = await db.query<{ id: string }>(
    `SELECT s.id
     FROM tracking_sessions s
     WHERE s.path IS NOT NULL
       AND ($1::text IS NULL OR s.user_id = $1)
     ORDER BY s.start_time ASC, s.id ASC`,
    [USER]
  );

  const unpathed = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM tracking_sessions s
     WHERE s.ended = true AND s.path IS NULL
       AND ($1::text IS NULL OR s.user_id = $1)
       AND EXISTS (SELECT 1 FROM tracking_points tp WHERE tp.session_id = s.id)`,
    [USER]
  );

  const targets = rows.slice(0, LIMIT);
  console.log(
    `[backfill-route-coverage] ${targets.length} of ${rows.length} sessions with a path; ` +
      `${unpathed.rows[0].count} ended sessions have points but no path and are skipped`
  );

  let measured = 0;
  let written = 0;
  let failed = 0;

  for (const [index, session] of targets.entries()) {
    try {
      const matches = await measureSessionRouteCoverage(db, session.id);
      measured += matches.length;
      if (APPLY && matches.length > 0) {
        written += await upsertSessionRouteCoverage(db, session.id, matches);
      }
    } catch (err) {
      failed++;
      console.error(`[backfill-route-coverage] ${session.id} failed:`, err);
    }
    if ((index + 1) % 10 === 0 || index + 1 === targets.length) {
      console.log(`[backfill-route-coverage] ${index + 1}/${targets.length} sessions`);
    }
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  console.log(
    `[backfill-route-coverage] done: ${measured} route matches measured, ` +
      `${written} rows written, ${failed} sessions failed`
  );
  await db.end();
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Route coverage backfill failed:", err);
  process.exit(1);
});
