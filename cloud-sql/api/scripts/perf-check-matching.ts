/** Read-only matching timings. Run only with separately authorized DB access:
 * DATABASE_URL=postgres://... npx tsx scripts/perf-check-matching.ts SESSION_ID [...]
 * The server enforces BEGIN READ ONLY and a 30-second per-statement timeout.
 * No session processing, queue writes, or segment INSERTs run here.
 */
import { Pool } from "pg";
import { perfCheckMatching } from "../src/matching-perf";

async function main(): Promise<void> {
  const sessionIds = process.argv.slice(2);
  if (!sessionIds.length || sessionIds.some((id) => id.startsWith("--"))) {
    throw new Error("Usage: DATABASE_URL=... tsx scripts/perf-check-matching.ts SESSION_ID [...]");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const client = await pool.connect();
    try { if (await perfCheckMatching(client, sessionIds)) process.exitCode = 1; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

if (require.main === module) main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
