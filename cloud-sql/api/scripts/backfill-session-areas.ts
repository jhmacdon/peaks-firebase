/**
 * Fill session_areas for recordings that predate path-based area tagging.
 *
 * Run after 20260721_session_area_paths.sql. Work stays in small batches so a
 * large history cannot hold one long transaction or use much memory.
 *
 * Usage:
 *   DB_HOST=127.0.0.1 DB_PORT=5433 DB_NAME=peaks DB_USER=peaks-api \
 *   DB_PASS=... npm run backfill:session-areas
 */

import db from "../src/db";
import { linkSessionsToAreas } from "../src/processing";

const BATCH_SIZE = 10;

async function tagBatch(ids: string[]): Promise<{ links: number; failed: number }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const links = await linkSessionsToAreas(client, ids);
    await client.query("COMMIT");
    return { links, failed: 0 };
  } catch (err) {
    await client.query("ROLLBACK");
    if (ids.length === 1) {
      console.error("One session could not be tagged:", err);
      return { links: 0, failed: 1 };
    }
  } finally {
    client.release();
  }

  const midpoint = Math.ceil(ids.length / 2);
  const left = await tagBatch(ids.slice(0, midpoint));
  const right = await tagBatch(ids.slice(midpoint));
  return {
    links: left.links + right.links,
    failed: left.failed + right.failed,
  };
}

async function main(): Promise<void> {
  const candidates = await db.query<{ id: string }>(
    `SELECT id
     FROM tracking_sessions
     WHERE path IS NOT NULL
     ORDER BY id`
  );

  let taggedSessions = 0;
  let areaLinks = 0;
  let failedSessions = 0;
  for (let offset = 0; offset < candidates.rows.length; offset += BATCH_SIZE) {
    const ids = candidates.rows.slice(offset, offset + BATCH_SIZE).map((row) => row.id);
    const result = await tagBatch(ids);
    areaLinks += result.links;
    failedSessions += result.failed;
    taggedSessions += ids.length;
    console.log(`Tagged ${taggedSessions}/${candidates.rows.length} sessions`);
  }

  console.log(`Stored ${areaLinks} session-area links`);
  console.log(`${failedSessions} sessions failed`);
  await db.end();
  if (failedSessions > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Session-area backfill failed:", err);
  process.exit(1);
});
