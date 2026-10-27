// HRRR-Smoke ingestion. Runs 4x/day via Cloud Scheduler → Cloud Run Job:
// samples near-surface smoke (MASSDEN, 8 m) at every upcoming plan's grid
// cell and every recently viewed trail's cell for forecast hours f00–f48 and
// upserts into smoke_forecasts.
// Steps: collect cells → newest complete cycle → byte-range MASSDEN records
// via .idx → repack each hour to IEEE floats once → read every cell's grid
// index → upsert → prune.
// Design: docs/superpowers/specs/2026-08-06-plan-air-quality-design.md

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pool from "./db";
import {
  Cell,
  HRRR_GRID_KEYS,
  HrrrCycle,
  KG_M3_TO_UG_M3,
  candidateCycles,
  cycleTimeSec,
  findMassdenRange,
  gribUrl,
  gridIndex,
  gridMatchesHrrr,
  idxUrl,
  rangeHeader,
  readIeeeGrib2Values,
  snapToCell,
} from "./hrrr";

const run = promisify(execFile);

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface SampleCell extends Cell {
  gridIndex: number;
}

// Trail cells come from GET /api/routes/:id/air-quality views. The cap
// bounds upsert volume, not extraction time, which no longer grows per cell.
export const TRAIL_CELL_LIMIT = 500;

// One sample point per plan dated in the ingestion window (first destination
// by ordinal, else a point on the plan path), plus the cells of trails viewed
// in the last 72 hours. Deduped to ~3 km grid cells on the HRRR grid.
export async function collectSampleCells(db: Queryable): Promise<SampleCell[]> {
  const result = await db.query(
    `SELECT COALESCE(fd.lat, ST_Y(ST_PointOnSurface(p.path::geometry))) AS lat,
            COALESCE(fd.lng, ST_X(ST_PointOnSurface(p.path::geometry))) AS lng
     FROM plans p
     LEFT JOIN LATERAL (
       SELECT ST_Y(d.location::geometry) AS lat, ST_X(d.location::geometry) AS lng
       FROM plan_destinations pd
       JOIN destinations d ON d.id = pd.destination_id
       WHERE pd.plan_id = p.id AND d.location IS NOT NULL
       ORDER BY pd.ordinal, pd.destination_id
       LIMIT 1
     ) fd ON true
     WHERE p.date BETWEEN now() - interval '24 hours' AND now() + interval '60 hours'
     UNION ALL
     SELECT lat, lng FROM (
       SELECT lat, lng FROM smoke_sample_cells
       WHERE requested_at > now() - interval '72 hours'
       ORDER BY requested_at DESC
       LIMIT ${TRAIL_CELL_LIMIT}
     ) trails`
  );
  const cells = new Map<string, SampleCell>();
  for (const row of result.rows) {
    if (row.lat == null || row.lng == null) continue;
    const cell = snapToCell(row.lat, row.lng);
    const index = gridIndex(cell.lat, cell.lng);
    if (index === null) continue;
    cells.set(cell.cellKey, { ...cell, gridIndex: index });
  }
  return [...cells.values()];
}

export interface SmokeRow {
  cellKey: string;
  validAtSec: number;
  runAtSec: number;
  smokeUgM3: number;
}

// Conflict-guarded upsert: a newer HRRR run always wins, an older or rerun
// cycle never clobbers fresher data.
export async function upsertSmokeRows(db: Queryable, rows: SmokeRow[]): Promise<void> {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      const base = j * 4;
      values.push(
        `($${base + 1}, to_timestamp($${base + 2}), to_timestamp($${base + 3}), $${base + 4})`
      );
      params.push(r.cellKey, r.validAtSec, r.runAtSec, r.smokeUgM3);
    });
    await db.query(
      `INSERT INTO smoke_forecasts (cell_key, valid_at, run_at, smoke_ug_m3)
       VALUES ${values.join(", ")}
       ON CONFLICT (cell_key, valid_at) DO UPDATE
         SET smoke_ug_m3 = EXCLUDED.smoke_ug_m3,
             run_at = EXCLUDED.run_at,
             fetched_at = now()
         WHERE EXCLUDED.run_at >= smoke_forecasts.run_at`,
      params
    );
  }
}

async function findLatestCycle(nowSec: number): Promise<HrrrCycle | null> {
  for (const c of candidateCycles(nowSec)) {
    const res = await fetch(idxUrl(c, 48));
    if (res.ok) {
      await res.text(); // drain
      return c;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const cells = await collectSampleCells(pool);
  if (cells.length === 0) {
    console.log("[smoke-job] no plans or recent trail views to sample; nothing to do");
    return;
  }
  const cycle = await findLatestCycle(nowSec);
  if (!cycle) throw new Error("no complete 48 h HRRR cycle found in the last 30 h");
  const runAtSec = cycleTimeSec(cycle);
  console.log(
    `[smoke-job] cycle ${cycle.ymd} t${String(cycle.hour).padStart(2, "0")}z, ${cells.length} cell(s)`
  );

  const rows: SmokeRow[] = [];
  const dir = await mkdtemp(join(tmpdir(), "hrrr-"));
  try {
    for (let fh = 0; fh <= 48; fh++) {
      const idxRes = await fetch(idxUrl(cycle, fh));
      if (!idxRes.ok) {
        console.warn(`[smoke-job] f${fh}: idx HTTP ${idxRes.status}, skipping hour`);
        continue;
      }
      const range = findMassdenRange(await idxRes.text());
      if (!range) {
        console.warn(`[smoke-job] f${fh}: no MASSDEN record, skipping hour`);
        continue;
      }
      const gribRes = await fetch(gribUrl(cycle, fh), {
        headers: { Range: rangeHeader(range) },
      });
      if (!gribRes.ok) {
        console.warn(`[smoke-job] f${fh}: grib HTTP ${gribRes.status}, skipping hour`);
        continue;
      }
      // Reused filenames: /tmp is in-memory tmpfs on Cloud Run and counts
      // against the container's memory limit — don't accumulate all 49
      // hourly GRIB files (the IEEE copy is ~8 MB) for the run.
      const file = join(dir, "massden.grib2");
      const ieeeFile = join(dir, "massden-ieee.grib2");
      await writeFile(file, Buffer.from(await gribRes.arrayBuffer()));
      const { stdout: grid } = await run("grib_get", ["-p", HRRR_GRID_KEYS.join(","), file]);
      if (!gridMatchesHrrr(grid)) {
        throw new Error(`HRRR grid metadata changed; update HRRR_GRID: ${grid.trim()}`);
      }
      let valueAt: (index: number) => number;
      try {
        await run("grib_set", ["-r", "-s", "packingType=grid_ieee", file, ieeeFile]);
        valueAt = readIeeeGrib2Values(await readFile(ieeeFile));
      } catch (err) {
        console.warn(`[smoke-job] f${fh}: IEEE repack failed, skipping hour: ${err}`);
        continue;
      }
      for (const cell of cells) {
        const raw = valueAt(cell.gridIndex);
        // ecCodes emits 9999 as a missing-value marker; real MASSDEN values
        // sit around 1e-9 kg/m³, so anything outside [0, 1] kg/m³ is a
        // missing-data sentinel, not a real reading — skip it rather than
        // let it poison smoke_ug_m3 (9999 kg/m³ × 1e9 = nonsense).
        if (raw < 0 || raw > 1) {
          console.warn(
            `[smoke-job] f${fh}: cell ${cell.cellKey} missing value (${raw}), skipping`
          );
          continue;
        }
        rows.push({
          cellKey: cell.cellKey,
          validAtSec: runAtSec + fh * 3600,
          runAtSec,
          smokeUgM3: raw * KG_M3_TO_UG_M3,
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  if (rows.length === 0) throw new Error("no smoke values extracted");
  await upsertSmokeRows(pool, rows);
  await pool.query(`DELETE FROM smoke_forecasts WHERE valid_at < now() - interval '24 hours'`);
  await pool.query(`DELETE FROM smoke_sample_cells WHERE requested_at < now() - interval '72 hours'`);
  console.log(`[smoke-job] upserted ${rows.length} rows for ${cells.length} cell(s)`);
}

if (process.env.NODE_ENV !== "test") {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[smoke-job] failed:", err);
      process.exit(1);
    });
}
