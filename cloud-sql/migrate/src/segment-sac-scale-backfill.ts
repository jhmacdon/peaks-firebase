import { open, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { lines } from './trail-graph/io';
import { parseOpl } from './trail-graph/opl';

export const SAC_SCALES = ['hiking', 'mountain_hiking', 'demanding_mountain_hiking',
  'alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking'] as const;
export type SacScale = typeof SAC_SCALES[number];

interface BackfillArgs { extract: string; report: string; apply: boolean }
interface Segment { id: string; wayIds: number[] }
interface SegmentGrade extends Segment { grade: SacScale; grades: SacScale[]; mixed: boolean }
interface RouteChange { routeId: string; name: string | null; oldDifficulty: string | null; newDifficulty: string | null }

export function parseSegmentSacScaleArgs(argv: readonly string[]): BackfillArgs {
  const values = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      if (apply) throw new Error('--apply may be passed only once');
      apply = true;
      continue;
    }
    const match = /^(--extract|--report)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    if (values.has(match[1])) throw new Error(`${match[1]} may be passed only once`);
    const value = match[2] ?? argv[++i];
    if (!value?.trim() || value.startsWith('--')) throw new Error(`${match[1]} needs a path`);
    values.set(match[1], resolve(value));
  }
  if (!values.has('--extract') || !values.has('--report')) {
    throw new Error('Required: --extract <trails.opl> --report <new.json>; defaults to dry run');
  }
  return { extract: values.get('--extract')!, report: values.get('--report')!, apply };
}

function isSacScale(value: string): value is SacScale {
  return (SAC_SCALES as readonly string[]).includes(value);
}

/** Untagged ways do not vote. Distinct valid grades make a segment mixed. */
export function resolveSegmentSacScale(wayIds: readonly number[], gradesByWay: ReadonlyMap<number, SacScale>): {
  grade: SacScale | null; grades: SacScale[]; mixed: boolean;
} {
  const found = new Set([...new Set(wayIds)].flatMap(id => {
    const grade = gradesByWay.get(id);
    return grade ? [grade] : [];
  }));
  const grades = SAC_SCALES.filter(grade => found.has(grade));
  return { grade: grades[grades.length - 1] ?? null, grades, mixed: grades.length > 1 };
}

/** Scan once and parse only requested ways; never retain the extract's lines. */
export async function lookupSacScaleWays(extract: string, requestedIds: ReadonlySet<number>): Promise<{
  grades: Map<number, SacScale>; foundWays: number; invalidGrades: Record<string, number>;
}> {
  const grades = new Map<number, SacScale>();
  const found = new Set<number>();
  const invalidGrades: Record<string, number> = Object.create(null);
  for await (const line of lines(extract)) {
    if (line[0] !== 'w') continue;
    const space = line.indexOf(' ');
    const id = Number(line.slice(1, space < 0 ? undefined : space));
    if (!requestedIds.has(id)) continue;
    found.add(id);
    const grade = parseOpl(line).tags.sac_scale;
    if (grade && isSacScale(grade)) grades.set(id, grade);
    else if (grade) invalidGrades[grade] = (invalidGrades[grade] ?? 0) + 1;
  }
  return { grades, foundWays: found.size, invalidGrades };
}

interface BackfillReport {
  version: 1;
  mode: 'apply' | 'dry-run';
  status: 'running' | 'planned' | 'complete' | 'failed';
  startedAt: string;
  finishedAt?: string;
  extract: string;
  dataSourceRunId?: string;
  segmentsConsidered: number;
  requestedWays: number;
  foundWays: number;
  gradedWays: number;
  invalidGrades: Record<string, number>;
  countsByGrade: Record<SacScale, number>;
  segmentsWithoutGrade: number;
  mixedSegments: { segmentId: string; wayIds: number[]; grades: SacScale[]; selectedGrade: SacScale }[];
  affectedRouteIds: string[];
  routeChanges: RouteChange[];
  updatedSegmentIds: string[];
  refreshedRouteIds: string[];
  pendingRouteIds: string[];
  error?: string;
}

async function saveReport(file: FileHandle, report: BackfillReport): Promise<void> {
  const contents = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  for (let written = 0; written < contents.length;) {
    const result = await file.write(contents, written, contents.length - written, written);
    written += result.bytesWritten;
  }
  await file.truncate(contents.length);
  await file.sync();
}

function connectionPool(): Pool {
  // Tests must never fall through to the operator's DB_* connection.
  if (process.env.TEST_DATABASE_URL) {
    const url = new URL(process.env.TEST_DATABASE_URL);
    if (!decodeURIComponent(url.pathname.slice(1)).endsWith('_test')) {
      throw new Error('TEST_DATABASE_URL must name a database ending in _test');
    }
    return new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  }
  if (process.env.NODE_ENV === 'test') throw new Error('DB tests require TEST_DATABASE_URL ending in _test');
  return new Pool({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'peaks', user: process.env.DB_USER || 'peaks-api',
    password: process.env.DB_PASS, max: 1 });
}

async function readSegments(client: PoolClient): Promise<Segment[]> {
  const result = await client.query<{ id: string; way_ids: unknown }>(`SELECT id,
      provenance->'osm_way_ids' AS way_ids FROM segments
    WHERE osm_sac_scale IS NULL AND CASE
      WHEN jsonb_typeof(provenance->'osm_way_ids') = 'array'
      THEN jsonb_array_length(provenance->'osm_way_ids') > 0 ELSE false END
    ORDER BY id`);
  return result.rows.map(row => {
    if (!Array.isArray(row.way_ids) || row.way_ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      throw new Error(`Invalid OSM way IDs on segment ${row.id}`);
    }
    return { id: row.id, wayIds: row.way_ids as number[] };
  });
}

async function affectedRoutes(client: PoolClient, segmentIds: string[]): Promise<string[]> {
  if (!segmentIds.length) return [];
  return (await client.query<{ route_id: string }>(`SELECT DISTINCT route_id FROM route_segments
    WHERE segment_id = ANY($1::text[]) ORDER BY route_id`, [segmentIds])).rows.map(row => row.route_id);
}

/** Read-only preview: the floor matches peaks_route_terrain_floor, including
 * geodesic length, one count per segment, and the shared T4–T6 bucket. */
async function previewRouteChanges(client: PoolClient, grades: SegmentGrade[], routeIds: string[]): Promise<RouteChange[]> {
  if (!routeIds.length) return [];
  const result = await client.query<RouteChange>(`WITH proposed AS (
      SELECT * FROM unnest($1::text[], $2::text[]) AS p(segment_id, sac_scale)
    ), linked AS (
      SELECT DISTINCT rs.route_id, s.id, ST_Length(s.path) AS length_m,
        COALESCE(p.sac_scale, s.osm_sac_scale) AS sac_scale
      FROM route_segments rs JOIN segments s ON s.id = rs.segment_id
      LEFT JOIN proposed p ON p.segment_id = s.id
      WHERE rs.route_id = ANY($3::text[])
    ), floors AS (
      SELECT route_id, CASE
        WHEN SUM(length_m) FILTER (WHERE sac_scale IN
          ('alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking')) >= 50 THEN 'hard'
        WHEN SUM(length_m) FILTER (WHERE sac_scale = 'demanding_mountain_hiking') >= 50 THEN 'moderate'
        ELSE NULL END AS floor
      FROM linked GROUP BY route_id
    ), predicted AS (
      SELECT r.id AS "routeId", r.name, r.difficulty AS "oldDifficulty",
        peaks_harder_difficulty(peaks_route_difficulty(r.distance, r.gain, r.gain_loss,
          peaks_route_max_grade(r.path), r.shape), f.floor) AS "newDifficulty"
      FROM routes r LEFT JOIN floors f ON f.route_id = r.id WHERE r.id = ANY($3::text[])
    ) SELECT * FROM predicted WHERE "oldDifficulty" IS DISTINCT FROM "newDifficulty" ORDER BY "routeId"`,
  [grades.map(segment => segment.id), grades.map(segment => segment.grade), routeIds]);
  return result.rows;
}

async function transaction<T>(client: PoolClient, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL peaks.defer_rematch = 'on'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

const SEGMENT_BATCH = 100;
const ROUTE_BATCH = 1;

async function applyGrades(client: PoolClient, grades: SegmentGrade[], report: BackfillReport, file: FileHandle): Promise<void> {
  const refreshed = new Set<string>();
  // Refresh after each segment batch so a later failure leaves a bounded set
  // of routes to repair. The report keeps that set through each commit.
  // 100 rows keeps each update inside the 30 s statement limit on the
  // db-f1-micro: the segment guard triggers cost ~12 ms a row, and a 500-row
  // batch timed out on the first production run.
  for (let offset = 0; offset < grades.length; offset += SEGMENT_BATCH) {
    const batch = grades.slice(offset, offset + SEGMENT_BATCH);
    const routeIds = await transaction(client, async () => {
      const changed = await client.query<{ id: string }>(`UPDATE segments s SET osm_sac_scale = p.sac_scale
        FROM unnest($1::text[], $2::text[], $3::jsonb[]) AS p(segment_id, sac_scale, way_ids)
        WHERE s.id = p.segment_id AND s.osm_sac_scale IS NULL
          AND s.provenance->'osm_way_ids' = p.way_ids RETURNING s.id`,
      [batch.map(segment => segment.id), batch.map(segment => segment.grade),
        batch.map(segment => JSON.stringify(segment.wayIds))]);
      if (changed.rowCount !== batch.length) throw new Error('Segment grade or OSM way IDs changed during the run; this batch was rolled back');
      return affectedRoutes(client, changed.rows.map(row => row.id));
    });
    report.updatedSegmentIds.push(...batch.map(segment => segment.id));
    report.pendingRouteIds = routeIds;
    await saveReport(file, report);
    // refresh_route_derivations also relinks areas and rebuilds profiles:
    // 48 routes in one call passed 30 s on production, so refresh a few at a time.
    for (let routeOffset = 0; routeOffset < routeIds.length; routeOffset += ROUTE_BATCH) {
      const routeBatch = routeIds.slice(routeOffset, routeOffset + ROUTE_BATCH);
      // Some California routes took over 30 s to refresh (areas, profile); one at a time, longer limit.
      await transaction(client, async () => {
        await client.query("SET LOCAL statement_timeout = '180s'");
        return client.query('SELECT refresh_route_derivations($1::text[])', [routeBatch]);
      });
      routeBatch.forEach(id => refreshed.add(id));
      report.refreshedRouteIds = [...refreshed].sort();
      report.pendingRouteIds = routeIds.slice(routeOffset + ROUTE_BATCH);
      await saveReport(file, report);
    }
  }
}

export async function segmentSacScaleBackfillMain(argv = process.argv.slice(2)): Promise<void> {
  const args = parseSegmentSacScaleArgs(argv);
  // Reserve the audit path before connecting, scanning or making any writes.
  const file = await open(args.report, 'wx');
  const report: BackfillReport = { version: 1, mode: args.apply ? 'apply' : 'dry-run', status: 'running',
    startedAt: new Date().toISOString(), extract: args.extract, segmentsConsidered: 0, requestedWays: 0,
    foundWays: 0, gradedWays: 0, invalidGrades: {},
    countsByGrade: Object.fromEntries(SAC_SCALES.map(grade => [grade, 0])) as Record<SacScale, number>,
    segmentsWithoutGrade: 0, mixedSegments: [], affectedRouteIds: [], routeChanges: [],
    updatedSegmentIds: [], refreshedRouteIds: [], pendingRouteIds: [] };
  let pool: Pool | undefined;
  let client: PoolClient | undefined;
  try {
    await saveReport(file, report);
    pool = connectionPool();
    client = await pool.connect();
    // The catalog metadata backfill also logs dry runs. An unfinished run
    // stays failed, so it cannot make a source appear freshly imported.
    report.dataSourceRunId = (await client.query<{ id: string }>(`INSERT INTO data_source_runs
      (source, run_kind, status, started_at, notes) VALUES ('osm-segment-sac-scale', 'import', 'failed', $1,
        'Segment sac_scale backfill started; unfinished attempts remain failed') RETURNING id::text AS id`,
    [report.startedAt])).rows[0].id;
    const segments = await readSegments(client);
    report.segmentsConsidered = segments.length;
    const requested = new Set(segments.flatMap(segment => segment.wayIds));
    report.requestedWays = requested.size;
    const lookup = await lookupSacScaleWays(args.extract, requested);
    report.foundWays = lookup.foundWays;
    report.gradedWays = lookup.grades.size;
    report.invalidGrades = lookup.invalidGrades;
    const grades: SegmentGrade[] = [];
    for (const segment of segments) {
      const resolved = resolveSegmentSacScale(segment.wayIds, lookup.grades);
      if (!resolved.grade) { report.segmentsWithoutGrade++; continue; }
      grades.push({ ...segment, ...resolved, grade: resolved.grade });
      report.countsByGrade[resolved.grade]++;
      if (resolved.mixed) report.mixedSegments.push({ segmentId: segment.id, wayIds: segment.wayIds,
        grades: resolved.grades, selectedGrade: resolved.grade });
    }
    report.affectedRouteIds = await affectedRoutes(client, grades.map(segment => segment.id));
    report.routeChanges = await previewRouteChanges(client, grades, report.affectedRouteIds);
    report.status = 'planned';
    await saveReport(file, report);
    if (args.apply) await applyGrades(client, grades, report, file);
    report.status = 'complete';
    report.finishedAt = new Date().toISOString();
    await finishRun(client, report, args.report);
    await saveReport(file, report);
    console.log(JSON.stringify({ mode: report.mode, countsByGrade: report.countsByGrade,
      mixedSegments: report.mixedSegments.length, routeChanges: report.routeChanges.length,
      updatedSegments: report.updatedSegmentIds.length, report: args.report }));
  } catch (error) {
    report.status = 'failed';
    report.finishedAt = new Date().toISOString();
    report.error = error instanceof Error ? error.message : String(error);
    if (client && report.dataSourceRunId) {
      try { await finishRun(client, report, args.report); }
      catch (loggingError) { report.error += `; run logging failed: ${String(loggingError)}`; }
    }
    await saveReport(file, report);
    throw error;
  } finally {
    client?.release();
    await pool?.end();
    await file.close();
  }
}

async function finishRun(client: PoolClient, report: BackfillReport, reportPath: string): Promise<void> {
  const status = report.error ? (report.updatedSegmentIds.length ? 'partial' : 'failed')
    : report.mode === 'apply' ? 'success' : 'dry_run';
  await client.query(`UPDATE data_source_runs SET status = $2, finished_at = $3,
    rows_in = $4, rows_matched = $5, rows_written = $6, notes = $7 WHERE id = $1`,
  [report.dataSourceRunId, status, report.finishedAt, report.segmentsConsidered,
    Object.values(report.countsByGrade).reduce((sum, count) => sum + count, 0), report.updatedSegmentIds.length,
    JSON.stringify({ report: reportPath, routeChanges: report.routeChanges.length,
      pendingRouteIds: report.pendingRouteIds, error: report.error })]);
}

if (require.main === module) segmentSacScaleBackfillMain().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
