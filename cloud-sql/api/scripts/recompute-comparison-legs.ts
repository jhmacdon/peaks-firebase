/**
 * Recompute ONLY the leg-split columns of session_comparisons for pairs below
 * the current LEGS_VERSION — the cheap tier of the two-version recompute
 * design. Use after tuning SUMMIT_DWELL_RADIUS_M or APEX_INTERIOR_FRAC in
 * comparison-params.ts (bump LEGS_VERSION there first). Does NOT touch the
 * matcher geometry (m-ranges/windows) — bump MATCHER_VERSION and run
 * backfill-comparisons.ts for that.
 *
 * Serial + version-stamped ⇒ resumable: kill it anytime; re-running picks up
 * where it left off.
 *
 *   DB_HOST=127.0.0.1 DB_PORT=5433 DB_NAME=peaks DB_USER=peaks-api \
 *   DB_PASS=... DB_POOL_MAX=2 \
 *     npx tsx scripts/recompute-comparison-legs.ts --dry-run
 *
 * Flags: --dry-run, --delay-ms <n> (default 200), --limit <n>
 */

import db from "../src/db";
import { buildCommonSummitSql, loadSampledTrack } from "../src/comparisons";
import { computeLegSplits, SideWindow } from "../src/comparison-geometry";
import * as P from "../src/comparison-params";

function intFlag(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const n = Number.parseInt(process.argv[i + 1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const DRY_RUN = process.argv.includes("--dry-run");
const DELAY_MS = intFlag("--delay-ms", 200);
const LIMIT = intFlag("--limit", Number.MAX_SAFE_INTEGER);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function windowOf(row: any, prefix: "a" | "b"): SideWindow {
  return {
    enterMs: row[`${prefix}_enter_ms`],
    exitMs: row[`${prefix}_exit_ms`],
    startM: row[`${prefix}_start_m`],
    endM: row[`${prefix}_end_m`],
    outAndBack: row[`${prefix}_out_and_back`],
  };
}

async function main(): Promise<void> {
  console.log(`[recompute-legs] target legs_version=${P.LEGS_VERSION} dry=${DRY_RUN}`);
  const { rows } = await db.query(
    `SELECT * FROM session_comparisons WHERE legs_version < $1
     ORDER BY session_a, session_b`,
    [P.LEGS_VERSION]
  );
  const pairs = rows.slice(0, LIMIT);
  console.log(`${rows.length} stale pairs; processing ${pairs.length}`);
  if (DRY_RUN) {
    await db.end();
    return;
  }

  let done = 0;
  let failed = 0;
  for (const row of pairs) {
    try {
      const summitSql = buildCommonSummitSql(row.session_a, row.session_b);
      const summitRes = await db.query(summitSql.text, summitSql.values);
      const summit = summitRes.rows[0] as { id: string; lat: number; lng: number } | undefined;

      let legs: Record<string, number | string | null> = {
        summit_destination_id: null,
        a_arrival_ms: null, a_departure_ms: null, b_arrival_ms: null, b_departure_ms: null,
        a_ascent_s: null, a_dwell_s: null, a_descent_s: null,
        b_ascent_s: null, b_dwell_s: null, b_descent_s: null,
      };
      if (summit) {
        const aSamples = await loadSampledTrack(db, row.session_a);
        const bSamples = await loadSampledTrack(db, row.session_b);
        const aLegs = computeLegSplits(aSamples, windowOf(row, "a"), summit, P);
        const bLegs = computeLegSplits(bSamples, windowOf(row, "b"), summit, P);
        if (aLegs && bLegs) {
          legs = {
            summit_destination_id: summit.id,
            a_arrival_ms: aLegs.arrivalMs, a_departure_ms: aLegs.departureMs,
            b_arrival_ms: bLegs.arrivalMs, b_departure_ms: bLegs.departureMs,
            a_ascent_s: aLegs.ascentS, a_dwell_s: aLegs.dwellS, a_descent_s: aLegs.descentS,
            b_ascent_s: bLegs.ascentS, b_dwell_s: bLegs.dwellS, b_descent_s: bLegs.descentS,
          };
        }
      }

      await db.query(
        `UPDATE session_comparisons SET
           summit_destination_id = $3,
           a_arrival_ms = $4, a_departure_ms = $5, b_arrival_ms = $6, b_departure_ms = $7,
           a_ascent_s = $8, a_dwell_s = $9, a_descent_s = $10,
           b_ascent_s = $11, b_dwell_s = $12, b_descent_s = $13,
           legs_version = $14, computed_at = now()
         WHERE session_a = $1 AND session_b = $2`,
        [
          row.session_a, row.session_b,
          legs.summit_destination_id,
          legs.a_arrival_ms, legs.a_departure_ms, legs.b_arrival_ms, legs.b_departure_ms,
          legs.a_ascent_s, legs.a_dwell_s, legs.a_descent_s,
          legs.b_ascent_s, legs.b_dwell_s, legs.b_descent_s,
          P.LEGS_VERSION,
        ]
      );
    } catch (err) {
      failed++;
      console.error(`\n[recompute-legs] failed for (${row.session_a}, ${row.session_b}):`, err);
    }
    done++;
    process.stdout.write(`\r  ${done}/${pairs.length} pairs (${failed} failed)`);
    await sleep(DELAY_MS);
  }
  process.stdout.write("\n");
  await db.end();
}

main().catch((err) => {
  console.error("Recompute failed:", err);
  process.exit(1);
});
