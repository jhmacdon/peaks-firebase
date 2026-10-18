/** Queue every ended session with a path for matching v2. Dry-run unless --apply;
 * never runs processing. The /internal/sweep drain (25 sessions per 2 min)
 * re-measures them.
 *
 * Usage: DATABASE_URL=postgres://... tsx src/rematch-all-sessions.ts [--apply]
 *        [--batch-size 100] [--after session-id] [--max-queue 200]
 * Production use is a separate, authorized data operation.
 *
 * There is no route proximity test: matching v2 re-measures every session, and
 * checking each one against every active route cost 23 minutes per batch of
 * 200 on a prod clone. Before each batch, --apply waits until the queue holds
 * fewer than --max-queue rows, so the sweep drains it steadily.
 */
import { Pool } from "pg";

export interface RematchOptions {
  apply: boolean;
  batchSize: number;
  after: string;
  maxQueue: number;
}

function boundedInteger(flag: string, raw: string, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${flag} must be an integer from 1 to ${max}`);
  }
  return value;
}

export function parseRematchArgs(args: string[]): RematchOptions {
  let apply = false;
  let batchSize = 100;
  let after = "";
  let maxQueue = 200;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") apply = true;
    else if (args[i] === "--dry-run") apply = false;
    else if (args[i] === "--after" && args[i + 1]) after = args[++i];
    else if (args[i] === "--batch-size" && args[i + 1]) batchSize = boundedInteger("--batch-size", args[++i], 1000);
    else if (args[i] === "--max-queue" && args[i + 1]) maxQueue = boundedInteger("--max-queue", args[++i], 100000);
    else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  return { apply, batchSize, after, maxQueue };
}

export const REMATCH_REASON = "matching-v2-backfill";

/** Keyset order through the primary key; no spatial work. */
export const REMATCH_BATCH_SQL = `SELECT s.id FROM tracking_sessions s
  WHERE s.id > $1 AND s.ended AND s.path IS NOT NULL
  ORDER BY s.id LIMIT $2`;

export const REMATCH_COUNT_SQL = `SELECT count(*)::int AS n FROM tracking_sessions s
  WHERE s.id > $1 AND s.ended AND s.path IS NOT NULL`;

export const QUEUE_DEPTH_SQL = `SELECT count(*)::int AS n FROM session_rematch_queue`;

export const REMATCH_INSERT_SQL = `INSERT INTO session_rematch_queue (session_id, reason)
  SELECT id, '${REMATCH_REASON}' FROM unnest($1::text[]) AS session(id)
  ON CONFLICT (session_id) DO UPDATE SET reason = EXCLUDED.reason, queued_at = now()`;

export const QUEUE_POLL_MS = 30_000;
export const QUEUE_WAIT_TIMEOUT_MS = 30 * 60_000;

type Queryable = Pick<Pool, "query">;
export interface Clock { sleep: (ms: number) => Promise<void>; now: () => number }
const realClock: Clock = { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now: () => Date.now() };

/** Wait until the queue holds fewer than maxQueue rows; fail after 30 minutes. */
export async function waitForQueueRoom(q: Queryable, maxQueue: number, clock: Clock = realClock): Promise<void> {
  const deadline = clock.now() + QUEUE_WAIT_TIMEOUT_MS;
  for (;;) {
    const depth = Number((await q.query(QUEUE_DEPTH_SQL)).rows[0].n);
    if (depth < maxQueue) return;
    if (clock.now() >= deadline) {
      throw new Error(`session_rematch_queue still holds ${depth} rows (limit ${maxQueue}) after 30 minutes; is /internal/sweep running?`);
    }
    console.log(`Queue holds ${depth} rows (limit ${maxQueue}); waiting`);
    await clock.sleep(QUEUE_POLL_MS);
  }
}

export async function enqueueAllSessions(q: Queryable, options: RematchOptions, clock: Clock = realClock): Promise<number> {
  if (!options.apply) {
    const count = Number((await q.query(REMATCH_COUNT_SQL, [options.after])).rows[0].n);
    console.log(`Would queue ${count} sessions in batches of ${options.batchSize}${options.after ? ` after ${options.after}` : ""}`);
    return count;
  }
  let after = options.after;
  let total = 0;
  for (;;) {
    const batch = await q.query(REMATCH_BATCH_SQL, [after, options.batchSize]);
    const ids = batch.rows.map((row: { id: string }) => row.id);
    if (ids.length === 0) return total;
    await waitForQueueRoom(q, options.maxQueue, clock);
    await q.query(REMATCH_INSERT_SQL, [ids]);
    total += ids.length;
    after = ids[ids.length - 1];
    console.log(`Queued ${total}; resume with --after ${after}`);
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
