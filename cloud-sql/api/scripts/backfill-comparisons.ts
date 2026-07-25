/**
 * Backfill session_comparisons across ALL historical sessions.
 *
 * Serial and gentle by construction (db-f1-micro) — mirrors
 * reprocess-stuck-sessions.ts. Iterates every user's ended sessions with a
 * path, oldest first, and runs matchComparisons with skipExisting so pairs
 * already stored at the current MATCHER_VERSION are not recomputed. Because a
 * run for session S pairs S against ALL its neighbors (earlier AND later),
 * re-running after an interruption only does the remaining work — the
 * version-stamped rows are the progress marker.
 *
 * After bumping MATCHER_VERSION in comparison-params.ts, re-running this
 * recomputes every pair (old-version rows don't short-circuit skipExisting).
 *
 *   # proxy in another terminal:
 *   cloud-sql-proxy donner-a8608:us-central1:peaks-db --port 5433
 *
 *   cd cloud-sql/api
 *   DB_HOST=127.0.0.1 DB_PORT=5433 DB_NAME=peaks DB_USER=peaks-api \
 *   DB_PASS=... DB_POOL_MAX=2 \
 *     npx tsx scripts/backfill-comparisons.ts --dry-run
 *
 * Flags:
 *   --dry-run        list candidate sessions and exit
 *   --delay-ms <n>   pause between sessions (default 300)
 *   --limit <n>      cap sessions processed this run
 *   --user <uid>     restrict to one user
 */

import db from "../src/db";
import { matchComparisons } from "../src/comparisons";
import { MATCHER_VERSION } from "../src/comparison-params";

function intFlag(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const n = Number.parseInt(process.argv[i + 1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function strFlag(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

const DRY_RUN = process.argv.includes("--dry-run");
const DELAY_MS = intFlag("--delay-ms", 300);
const LIMIT = intFlag("--limit", Number.MAX_SAFE_INTEGER);
const USER = strFlag("--user");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log(`[backfill-comparisons] matcher_version=${MATCHER_VERSION} dry=${DRY_RUN}`);
  const { rows } = await db.query(
    `SELECT s.id, s.user_id
     FROM tracking_sessions s
     WHERE s.ended = true AND s.path IS NOT NULL
       AND ($1::text IS NULL OR s.user_id = $1)
     ORDER BY s.user_id, s.start_time ASC, s.id ASC`,
    [USER]
  );
  const candidates = rows.slice(0, LIMIT) as Array<{ id: string; user_id: string }>;
  console.log(`${rows.length} sessions total; processing ${candidates.length}`);
  if (DRY_RUN) {
    for (const c of candidates.slice(0, 20)) console.log(`  ${c.user_id} ${c.id}`);
    if (candidates.length > 20) console.log(`  … and ${candidates.length - 20} more`);
    await db.end();
    return;
  }

  let done = 0;
  let pairs = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      pairs += await matchComparisons(db, c.id, c.user_id, { skipExisting: true });
    } catch (err) {
      failed++;
      console.error(`\n[backfill-comparisons] failed for ${c.id}:`, err);
    }
    done++;
    process.stdout.write(`\r  ${done}/${candidates.length} sessions, ${pairs} pairs written, ${failed} failed`);
    await sleep(DELAY_MS);
  }
  process.stdout.write("\n");

  const total = await db.query(`SELECT COUNT(*)::int AS n FROM session_comparisons`);
  console.log(`session_comparisons rows now: ${total.rows[0].n}`);
  await db.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
