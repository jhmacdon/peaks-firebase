/**
 * One-off maintenance: re-process every session wedged at 'pending', 'failed',
 * or a stale 'processing' claim — across ALL users — one at a time.
 *
 * Why this exists: matchDestinations was tripping the 30s statement_timeout
 * (per-row radius defeated the GIST index), so processSession threw and left
 * sessions 'failed' or wedged 'processing'. Nothing re-triggers them on its own
 * (the iOS poll only reads; uploadSession is short-circuited by the upload
 * ledger). This drains the backlog AFTER the matchDestinations fix in
 * processing.ts is in place — it imports the FIXED processSession, so each run
 * uses the fast, index-pruned query.
 *
 * Gentle by construction (the service runs on a db-f1-micro):
 *   - STRICTLY SERIAL — one processSession at a time, never a fan-out. This is
 *     the whole point: a parallel drain is what 503'd the service before.
 *   - A pause between each session (--delay-ms, default 300) so the live API
 *     keeps getting pool connections.
 *   - processSession is idempotent: already-completed sessions are skipped
 *     cheaply, and a session the live service is actively processing throws
 *     `already_processing` from the claim — logged and skipped, never double-run.
 *
 * Run it from a built checkout of the fix branch, with the same DB env the
 * service uses (e.g. via the Cloud SQL Auth Proxy):
 *
 *   # proxy in another terminal:
 *   cloud-sql-proxy donner-a8608:us-central1:peaks-db --port 5433
 *
 *   cd cloud-sql/api && npm run build
 *   DB_HOST=127.0.0.1 DB_PORT=5433 DB_NAME=peaks DB_USER=peaks-api \
 *   DB_PASS=... DB_POOL_MAX=2 \
 *     npx tsx scripts/reprocess-stuck-sessions.ts --dry-run     # list candidates
 *
 *   # then drop --dry-run to actually drain:
 *   DB_HOST=127.0.0.1 DB_PORT=5433 ... npx tsx scripts/reprocess-stuck-sessions.ts
 *
 * Flags:
 *   --dry-run        list the candidates and exit; make no changes
 *   --delay-ms <n>   pause between sessions (default 300)
 *   --limit <n>      cap how many to process this run (default: no cap)
 *   --states <list>  comma-separated states to drain (default: pending,failed,
 *                    processing). e.g. --states processing,failed to scope to
 *                    the timeout-wedged backlog and leave legacy 'pending'
 *                    (a migration population) untouched. 'processing' always
 *                    means the STALE subset; a live claim is never stolen.
 */

import db from "../src/db";
import { processSession, STALE_PROCESSING_MINUTES } from "../src/processing";

function intFlag(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const n = Number.parseInt(process.argv[i + 1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const DRY_RUN = process.argv.includes("--dry-run");
const DELAY_MS = intFlag("--delay-ms", 300);
const LIMIT = intFlag("--limit", Number.MAX_SAFE_INTEGER);

function statesFlag(): string[] {
  const i = process.argv.indexOf("--states");
  const raw = i === -1 ? "pending,failed,processing" : process.argv[i + 1] ?? "";
  const allowed = new Set(["pending", "failed", "processing"]);
  const states = raw.split(",").map((s) => s.trim()).filter((s) => allowed.has(s));
  if (states.length === 0) throw new Error(`--states must be a subset of ${[...allowed].join(",")}`);
  return states;
}
const STATES = statesFlag();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Ended sessions with points stuck in one of the requested states. A
// 'processing' row is only a candidate when its claim is older than
// STALE_PROCESSING_MINUTES (a dead run — never steal a live claim). Mirrors
// buildProcessAllCandidateSql but across every user, oldest first.
const CANDIDATE_SQL = `
  SELECT s.id, s.user_id, s.processing_state
  FROM tracking_sessions s
  WHERE s.ended = true
    AND (
      (s.processing_state = ANY($1) AND s.processing_state <> 'processing')
      OR ('processing' = ANY($1)
          AND s.processing_state = 'processing'
          AND (s.processing_started_at IS NULL
               OR s.processing_started_at < now() - make_interval(mins => ${STALE_PROCESSING_MINUTES})))
    )
    AND EXISTS (SELECT 1 FROM tracking_points tp WHERE tp.session_id = s.id)
  ORDER BY s.server_updated_at ASC, s.id ASC`;

async function main(): Promise<void> {
  console.log(`[reprocess] states=${STATES.join(",")} delay=${DELAY_MS}ms`);
  const { rows } = await db.query(CANDIDATE_SQL, [STATES]);
  const candidates = rows.slice(0, LIMIT);

  const byState = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.processing_state] = (acc[r.processing_state] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `[reprocess] ${rows.length} stuck session(s) across all users ` +
      `(${JSON.stringify(byState)}); processing ${candidates.length} this run` +
      (DRY_RUN ? "  [DRY RUN]" : "")
  );

  if (DRY_RUN) {
    for (const r of candidates) {
      console.log(`  would process ${r.id} (user=${r.user_id}, state=${r.processing_state})`);
    }
    return;
  }

  let completed = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const { id, user_id } = candidates[i];
    const tag = `[${i + 1}/${candidates.length}] ${id}`;
    try {
      const result = await processSession(id, user_id);
      if (result.skipped) {
        skipped++;
        console.log(`${tag} skipped (already completed)`);
      } else {
        completed++;
        console.log(
          `${tag} done — dests=${result.destinations_matched} routes=${result.routes_matched}`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "already_processing") {
        skipped++;
        console.log(`${tag} skipped (live run owns it)`);
      } else {
        failed++;
        console.error(`${tag} FAILED — ${msg}`);
      }
    }
    if (i < candidates.length - 1) await sleep(DELAY_MS);
  }

  console.log(
    `[reprocess] done: completed=${completed} skipped=${skipped} failed=${failed} ` +
      `of ${candidates.length}`
  );
}

main()
  .catch((err) => {
    console.error("[reprocess] fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => db.end());
