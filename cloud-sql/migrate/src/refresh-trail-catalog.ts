/** Checked, leased names/metadata refresh. It never activates, renames, or repairs routes. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Packages build separately; the CLI runs with tsx. Load the canonical helper
// without pulling API sources outside this package's TypeScript rootDir.
const { routeDoneCoverageSql } = require("../../api/src/route-coverage") as {
  routeDoneCoverageSql(alias: string): string;
};

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}
export type RefreshKind = "metadata" | "names";
export interface RefreshOptions {
  mode: RefreshKind;
  apply: boolean; report: string; rejections: string; batchSize: number;
  routeIds: string[]; reviewReport?: string; expectedSha256?: string;
}
export interface RefreshRow {
  route_id: string; decision: "ready" | "rejected" | "applied" | "already_applied";
  reasons: string[]; fingerprint?: string; plan?: Record<string, unknown>;
  popularity?: number;
}
export interface RefreshReport {
  version: 1; source: "trail_catalog_metadata" | "trail_catalog_names"; mode: "dry_run" | "apply";
  target: Record<string, unknown>; generated_at: string; batch_size: number;
  rows: RefreshRow[]; error?: string;
  review_scope?: { sha256: string; total_candidates: number; selected_candidates: number;
    unselected: Array<{ route_id: string; decision: string; reasons: string[] }> };
  counts: { candidates: number; ready: number; rejected: number; applied: number; already_applied: number };
}

const sourceFor = (mode: RefreshKind): RefreshReport["source"] => mode === "names" ? "trail_catalog_names" : "trail_catalog_metadata";

export const TARGET_SQL = `/* refresh:target */ SELECT current_database() AS database,
  inet_server_addr()::text AS server_address, inet_server_port() AS server_port`;
export const CANDIDATE_SQL = `/* refresh:candidate */
SELECT p.*, r.name, r.status,
  md5(jsonb_build_object('updated_at',r.updated_at,'owner',r.owner,'status',r.status,
    'name',r.name,'shape',r.shape,'distance',r.distance,'gain',r.gain,'gain_loss',r.gain_loss,
    'path',CASE WHEN cardinality(p.errors)=0 THEN md5(ST_AsEWKB(r.path::geometry)) END,
    'metadata',jsonb_build_array(r.kind,r.objective_destination_id,r.trailhead_destination_id,
      r.state_code,r.country_code,r.difficulty,r.est_moving_seconds,r.popularity),
    'destinations',(SELECT jsonb_agg(jsonb_build_array(rd.destination_id,rd.ordinal,d.updated_at)
      ORDER BY rd.ordinal,rd.destination_id) FROM route_destinations rd
      LEFT JOIN destinations d ON d.id=rd.destination_id WHERE rd.route_id=r.id),
    'segments',(SELECT jsonb_agg(jsonb_build_array(rs.segment_id,rs.ordinal,rs.direction,s.updated_at)
      ORDER BY rs.ordinal,rs.segment_id) FROM route_segments rs
      LEFT JOIN segments s ON s.id=rs.segment_id WHERE rs.route_id=r.id))::text) AS source_fingerprint,
  LEAST(2147483647::bigint,
    (SELECT count(*) FROM session_routes sr WHERE sr.route_id=r.id AND ${routeDoneCoverageSql("sr")})
    + GREATEST(0,COALESCE((SELECT d.session_count_offset FROM destinations d
        WHERE d.id=p.objective_destination_id),0))
    + (SELECT count(*) FROM trip_report_routes trr JOIN trip_reports tr ON tr.id=trr.report_id
       WHERE trr.route_id=r.id AND tr.moderation_state='published'))::int AS popularity
FROM routes r CROSS JOIN LATERAL peaks_route_catalog_metadata_plan(r.id) p WHERE r.id=$1`;

// This mode is safe for active personal routes and unclassified catalog rows.
// Keep the query scalar-only: names must not require loading a toasted path.
export const NAMES_CANDIDATE_SQL = `/* refresh:candidate-names */
SELECT p.*, r.name, r.status,
  md5(jsonb_build_array(r.updated_at,r.owner,r.status,r.name,r.search_name,r.slug)::text) AS source_fingerprint
FROM routes r CROSS JOIN LATERAL peaks_route_catalog_names_plan(r.id) p WHERE r.id=$1`;

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export function parseRefreshOptions(argv: string[]): RefreshOptions {
  const result: RefreshOptions = { mode: "metadata", apply: false, report: "", rejections: "", batchSize: 50, routeIds: [] };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    if (flag === "--apply") {
      if (inline !== undefined) throw new Error("--apply takes no value");
      result.apply = true; continue;
    }
    if (!["--mode", "--report", "--rejections", "--batch-size", "--route-id", "--review-report", "--expected-report-sha256"].includes(flag)) {
      throw new Error(`Unknown option: ${flag}`);
    }
    const value = inline ?? argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (flag === "--mode") {
      if (value !== "metadata" && value !== "names") throw new Error("--mode must be metadata or names");
      result.mode = value;
    }
    if (flag === "--report") result.report = path.resolve(value);
    if (flag === "--rejections") result.rejections = path.resolve(value);
    if (flag === "--review-report") result.reviewReport = path.resolve(value);
    if (flag === "--expected-report-sha256") result.expectedSha256 = value;
    if (flag === "--route-id") result.routeIds.push(value);
    if (flag === "--batch-size") {
      if (!/^\d+$/.test(value)) throw new Error("--batch-size must be an integer");
      result.batchSize = Number(value);
    }
  }
  if (!result.report) throw new Error("--report is required");
  if (result.batchSize < 1 || result.batchSize > 500) throw new Error("--batch-size must be 1–500");
  if (new Set(result.routeIds).size !== result.routeIds.length) throw new Error("Duplicate --route-id");
  result.rejections ||= `${result.report}.rejections.jsonl`;
  if (result.report === result.rejections) throw new Error("Report and rejection paths must differ");
  if (result.apply && (!result.reviewReport || !/^[0-9a-f]{64}$/.test(result.expectedSha256 ?? ""))) {
    throw new Error("Apply requires --review-report and --expected-report-sha256");
  }
  if (!result.apply && (result.reviewReport || result.expectedSha256)) throw new Error("Review flags require --apply");
  if ([result.report, result.rejections].includes(result.reviewReport ?? "")) throw new Error("Keep the reviewed report unchanged");
  return result;
}

export function readReviewedReport(contents: string, expectedSha256: string, routeIds: string[], mode: RefreshKind = "metadata"): RefreshReport {
  if (sha256(contents) !== expectedSha256) throw new Error("Reviewed report SHA-256 does not match");
  const report = JSON.parse(contents) as RefreshReport;
  if (report.version !== 1 || report.source !== sourceFor(mode) || report.mode !== "dry_run"
      || !report.target || !Array.isArray(report.rows) || report.rows.length === 0 || report.error) {
    throw new Error("Expected a nonempty, complete dry-run report");
  }
  const ids = new Set<string>();
  for (const row of report.rows) {
    if (typeof row.route_id !== "string" || !row.route_id || ids.has(row.route_id)
        || !Array.isArray(row.reasons) || !["ready", "rejected"].includes(row.decision)) {
      throw new Error("Invalid or duplicate route in reviewed report");
    }
    if (row.decision === "ready" && (!/^[0-9a-f]{64}$/.test(row.fingerprint ?? "")
      || !row.plan || row.reasons.length > 0
      || (mode === "metadata" && (!Number.isInteger(row.popularity) || row.popularity! < 0)))) {
      throw new Error("Ready review row lacks checked metadata");
    }
    ids.add(row.route_id);
  }
  for (const id of routeIds) if (!ids.has(id)) throw new Error(`Route ${id} is absent from the reviewed report`);
  if (routeIds.length) report.rows = report.rows.filter(row => routeIds.includes(row.route_id));
  if (report.rows.some(row => row.decision !== "ready")) {
    throw new Error("Review includes rejected routes; use explicit --route-id selections for a reviewed ready subset");
  }
  return report;
}

export async function readCandidate(db: Queryable, routeId: string, mode: RefreshKind = "metadata"): Promise<RefreshRow> {
  const raw = (await db.query(mode === "names" ? NAMES_CANDIDATE_SQL : CANDIDATE_SQL, [routeId])).rows[0];
  if (!raw) return { route_id: routeId, decision: "rejected", reasons: ["route_missing"] };
  const { source_fingerprint, popularity, name, status, errors, ...plan } = raw;
  const reasons = Array.isArray(errors) ? errors : ["metadata_plan_invalid"];
  if (mode === "metadata" && (!Number.isInteger(popularity) || popularity < 0)) reasons.push("popularity_invalid");
  return { route_id: routeId, decision: reasons.length ? "rejected" : "ready", reasons,
    plan, popularity, fingerprint: sha256(canonical({ source_fingerprint, plan, popularity, name, status })) };
}

async function enumerate(db: Queryable, options: RefreshOptions): Promise<string[]> {
  if (options.routeIds.length) return options.routeIds;
  const ids: string[] = [];
  let after = "";
  for (;;) {
    const rows = (await db.query(`/* refresh:list */ SELECT id FROM routes
      WHERE ${options.mode === "names" ? "(status='active' OR (owner='peaks' AND status='pending'))"
    : "owner='peaks' AND status IN ('active','pending')"} AND id>$1 ORDER BY id LIMIT $2`,
    [after, options.batchSize])).rows;
    if (!rows.length) return ids;
    ids.push(...rows.map(row => String(row.id)));
    after = ids[ids.length - 1];
  }
}

async function applyOne(db: Queryable, expected: RefreshRow, reviewSha: string, worker: string, mode: RefreshKind): Promise<RefreshRow> {
  const token = randomUUID();
  const claimed = await db.query(`/* refresh:claim */ INSERT INTO trail_catalog_refresh_jobs AS job
    (route_id,state,review_sha256,review_fingerprint,lease_owner,lease_token,lease_expires_at,refresh_kind)
    VALUES ($1,'working',$2,$3,$4,$5,now()+interval '10 minutes',$6)
    ON CONFLICT(refresh_kind,route_id) DO UPDATE SET state='working',review_sha256=EXCLUDED.review_sha256,
      review_fingerprint=EXCLUDED.review_fingerprint,lease_owner=EXCLUDED.lease_owner,
      lease_token=EXCLUDED.lease_token,lease_expires_at=EXCLUDED.lease_expires_at,
      attempt_count=job.attempt_count+1,last_error=NULL,updated_at=now()
    WHERE job.lease_expires_at IS NULL OR job.lease_expires_at<=now() RETURNING route_id`,
  [expected.route_id, reviewSha, expected.fingerprint, worker, token, mode]);
  if (!claimed.rows.length) return { ...expected, decision: "rejected", reasons: ["lease_busy"] };
  try {
    await db.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const lease = await db.query(`/* refresh:lease */ SELECT route_id FROM trail_catalog_refresh_jobs
      WHERE route_id=$1 AND lease_token=$2 AND refresh_kind=$3 AND lease_expires_at>now() FOR UPDATE`, [expected.route_id, token, mode]);
    if (!lease.rows.length) throw new Error("lease_lost");
    await db.query("SELECT id FROM routes WHERE id=$1 FOR UPDATE", [expected.route_id]);
    if (mode === "metadata") {
      await db.query("SELECT route_id FROM route_destinations WHERE route_id=$1 FOR SHARE", [expected.route_id]);
      await db.query("SELECT route_id FROM route_segments WHERE route_id=$1 FOR SHARE", [expected.route_id]);
      await db.query(`SELECT id FROM destinations WHERE id IN
        (SELECT destination_id FROM route_destinations WHERE route_id=$1) ORDER BY id FOR SHARE`, [expected.route_id]);
      await db.query(`SELECT id FROM segments WHERE id IN
        (SELECT segment_id FROM route_segments WHERE route_id=$1) ORDER BY id FOR SHARE`, [expected.route_id]);
    }
    const current = await readCandidate(db, expected.route_id, mode);
    if (current.decision !== "ready" || current.fingerprint !== expected.fingerprint) throw new Error("reviewed_route_changed");
    if (mode === "names") await db.query("SELECT refresh_route_catalog_names($1)", [expected.route_id]);
    else await db.query("SELECT refresh_peaks_route_catalog_metadata($1,$2)", [expected.route_id, expected.popularity]);
    const actual = (await db.query(`/* refresh:verify */ SELECT ${mode === "names" ? "search_name,slug"
      : "kind,objective_destination_id,trailhead_destination_id,state_code,country_code,difficulty,est_moving_seconds,popularity"}
      FROM routes WHERE id=$1`, [expected.route_id])).rows[0];
    if (!actual || Object.entries(expected.plan ?? {}).some(([key, value]) => key !== "route_id"
      && canonical(actual[key]) !== canonical(value)) || (mode === "metadata" && actual.popularity !== expected.popularity)) {
      throw new Error("stored_metadata_verification_failed");
    }
    const applied = await readCandidate(db, expected.route_id, mode);
    if (applied.decision !== "ready" || canonical(applied.plan) !== canonical(expected.plan)
        || applied.popularity !== expected.popularity) throw new Error("applied_metadata_verification_failed");
    const completed = await db.query(`/* refresh:complete */ UPDATE trail_catalog_refresh_jobs SET state='complete',
      applied_fingerprint=$3,evidence=$4::jsonb,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
      updated_at=now() WHERE route_id=$1 AND lease_token=$2 AND refresh_kind=$5 RETURNING route_id`,
    [expected.route_id, token, applied.fingerprint, JSON.stringify(applied), mode]);
    if (completed.rows.length !== 1) throw new Error("completion_receipt_missing");
    await db.query("COMMIT");
    return { ...applied, decision: "applied" };
  } catch (error) {
    await db.query("ROLLBACK");
    const reason = error instanceof Error ? error.message : String(error);
    await db.query(`/* refresh:blocked */ UPDATE trail_catalog_refresh_jobs SET state='blocked',last_error=$3,
      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now()
      WHERE route_id=$1 AND lease_token=$2 AND refresh_kind=$4`, [expected.route_id, token, reason, mode]);
    return { ...expected, decision: "rejected", reasons: [reason] };
  }
}

function emptyRefreshReport(options: RefreshOptions): RefreshReport {
  return { version: 1, source: sourceFor(options.mode), mode: options.apply ? "apply" : "dry_run",
    target: {}, generated_at: new Date().toISOString(), batch_size: options.batchSize, rows: [],
    counts: { candidates: 0, ready: 0, rejected: 0, applied: 0, already_applied: 0 } };
}

export async function runRefresh(db: Queryable, options: RefreshOptions, reviewContents?: string | Error): Promise<RefreshReport> {
  const report = emptyRefreshReport(options);
  let applyingId: string | undefined;
  // Bound connect/receipt lock waits as well as route work.
  await db.query("SET statement_timeout = '30000ms'");
  await db.query("SET lock_timeout = '5000ms'");
  // Logging is mandatory. Failure to create this receipt stops before catalog writes.
  const run = await db.query(`/* refresh:run-start */ INSERT INTO data_source_runs
    (source,run_kind,status,started_at,notes) VALUES ($1,'import','failed',now(),
     'Refresh started; unfinished attempts remain failed') RETURNING id::text AS id`, [sourceFor(options.mode)]);
  const runId = run.rows[0]?.id;
  if (!runId) throw new Error("Failed to create data_source_runs receipt");
  try {
    report.target = (await db.query(TARGET_SQL)).rows[0];
    if (!report.target) throw new Error("Database target is unavailable");
    if (reviewContents instanceof Error) throw reviewContents;
    const reviewed = options.apply ? readReviewedReport(reviewContents ?? "", options.expectedSha256!, options.routeIds, options.mode) : null;
    if (reviewed && canonical(reviewed.target) !== canonical(report.target)) throw new Error("Reviewed database target differs");
    if (reviewed) {
      const full = JSON.parse(reviewContents as string) as RefreshReport;
      const selected = new Set(reviewed.rows.map(row => row.route_id));
      report.review_scope = { sha256: options.expectedSha256!, total_candidates: full.rows.length,
        selected_candidates: selected.size, unselected: full.rows.filter(row => !selected.has(row.route_id))
          .map(({ route_id, decision, reasons }) => ({ route_id, decision, reasons })) };
    }
    const ids = reviewed ? reviewed.rows.map(row => row.route_id) : await enumerate(db, options);
    if (!ids.length) throw new Error("Empty catalog refresh input");
    const ready: RefreshRow[] = [];
    for (let offset = 0; offset < ids.length; offset += options.batchSize) {
      for (const id of ids.slice(offset, offset + options.batchSize)) {
        let row: RefreshRow;
        try { row = await readCandidate(db, id, options.mode); }
        catch (error) { row = { route_id: id, decision: "rejected", reasons: [error instanceof Error ? error.message : String(error)] }; }
        if (reviewed) {
          const expected = reviewed.rows.find(candidate => candidate.route_id === id)!;
          const job = (await db.query(`/* refresh:receipt */ SELECT state,review_sha256,review_fingerprint,applied_fingerprint
            FROM trail_catalog_refresh_jobs WHERE route_id=$1 AND refresh_kind=$2`, [id, options.mode])).rows[0];
          if (row.decision === "ready" && job?.state === "complete" && job.review_sha256 === options.expectedSha256
              && job.review_fingerprint === expected.fingerprint && job.applied_fingerprint === row.fingerprint
              && canonical(row.plan) === canonical(expected.plan) && row.popularity === expected.popularity) {
            row = { ...row, decision: "already_applied" };
          } else if (row.decision === "ready" && row.fingerprint !== expected.fingerprint) {
            row = { ...row, decision: "rejected", reasons: ["reviewed_route_changed"] };
          }
          if (row.decision === "ready") ready.push(expected);
        }
        report.rows.push(row);
      }
    }
    // Check the whole selected scope before the first catalog write.
    if (reviewed && !report.rows.some(row => row.decision === "rejected")) {
      const worker = `trail-catalog-${process.pid}-${randomUUID()}`;
      for (const row of ready) {
        applyingId = row.route_id;
        const applied = await applyOne(db, row, options.expectedSha256!, worker, options.mode);
        report.rows[report.rows.findIndex(item => item.route_id === row.route_id)] = applied;
        applyingId = undefined;
      }
    } else if (reviewed) {
      report.rows = report.rows.map(row => row.decision === "ready"
        ? { ...row, decision: "rejected", reasons: ["apply_not_attempted_due_to_selected_rejections"] }
        : row);
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    if (options.apply) report.rows = report.rows.map(row => row.decision === "ready"
      ? { ...row, decision: "rejected", reasons: [row.route_id === applyingId
        ? "apply_outcome_unconfirmed" : "apply_not_attempted_due_to_run_error"] }
      : row);
  }
  report.counts.candidates = report.rows.length;
  for (const row of report.rows) report.counts[row.decision]++;
  try {
    await db.query(`/* refresh:run-finish */ UPDATE data_source_runs SET status=$2,finished_at=now(),
      rows_in=$3,rows_matched=$4,rows_written=$5,notes=$6 WHERE id=$1`,
    [runId, report.error ? "failed" : report.counts.rejected ? "partial" : options.apply ? "success" : "dry_run",
      report.counts.candidates, report.counts.ready + report.counts.applied + report.counts.already_applied,
      report.counts.applied, JSON.stringify({ counts: report.counts, error: report.error, report: options.report,
        review_sha256: options.expectedSha256 ?? null })]);
  } catch (error) {
    const reason = `data_source_runs finalization failed: ${error instanceof Error ? error.message : String(error)}`;
    report.error = report.error ? `${report.error}; ${reason}` : reason;
  }
  return report;
}

export function rejectionLines(report: RefreshReport): string {
  return report.rows.filter(row => row.decision === "rejected").map(row => JSON.stringify(row) + "\n").join("")
    + (report.error ? JSON.stringify({ route_id: null, reasons: [report.error] }) + "\n" : "");
}

// Save failures from connection setup and the mandatory first receipt too.
// The caller must not begin database work until these evidence paths exist.
export async function saveRefreshEvidence(options: RefreshOptions,
  execute: () => Promise<RefreshReport>): Promise<RefreshReport> {
  for (const output of [options.report, options.rejections]) {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, "", { flag: "wx" });
  }
  let report: RefreshReport;
  try { report = await execute(); }
  catch (error) {
    report = emptyRefreshReport(options);
    report.error = error instanceof Error ? error.message : String(error);
  }
  await writeFile(options.report, JSON.stringify(report, null, 2) + "\n");
  await writeFile(options.rejections, rejectionLines(report));
  return report;
}

async function main(): Promise<void> {
  const { Pool } = require("pg") as typeof import("pg");
  const options = parseRefreshOptions(process.argv.slice(2));
  const report = await saveRefreshEvidence(options, async () => {
    const pool = new Pool({ host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || "peaks", user: process.env.DB_USER || "peaks-api", password: process.env.DB_PASS,
      max: 1, connectionTimeoutMillis: 5000 });
    let client: import("pg").PoolClient | undefined;
    try {
      client = await pool.connect();
      let reviewContents: string | Error | undefined;
      try { reviewContents = options.reviewReport ? await readFile(options.reviewReport, "utf8") : undefined; }
      catch (error) { reviewContents = error instanceof Error ? error : new Error(String(error)); }
      return await runRefresh(client, options, reviewContents);
    } finally {
      client?.release();
      // A pool cleanup error must not discard already committed route receipts.
      await pool.end().catch(error => console.error(`Pool cleanup failed: ${String(error)}`));
    }
  });
  console.log(JSON.stringify({ ...report.counts, report: options.report,
    sha256: sha256(await readFile(options.report, "utf8")), error: report.error }));
  if (report.error || report.counts.rejected) process.exitCode = 2;
}
if (require.main === module) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
