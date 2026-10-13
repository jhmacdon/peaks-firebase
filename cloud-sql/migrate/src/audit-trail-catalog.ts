/**
 * Read-only preflight for the trail catalog backfill. Runs before its migration.
 * Reads scalar route metadata and joins, never route paths or private sessions.
 * This report does not approve geometry, provenance, covers, or publication.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

export interface AuditArgs {
  reportPath: string;
  rejectionsPath: string;
  timeoutMs: number;
}

export interface CatalogRouteRow {
  id: string;
  name: string | null;
  status: string;
  shape: string | null;
  distance: number | null;
  gain: number | null;
  gain_loss: number | null;
  source_kind: string | null;
  destination_count: number;
  destination_ordinals_valid: boolean;
  missing_destination_ids: string[];
  trailhead_id: string | null;
  trailhead_name: string | null;
  trailhead_country_code: string | null;
  trailhead_state_code: string | null;
  objective_id: string | null;
  objective_name: string | null;
  objective_country_code: string | null;
  objective_state_code: string | null;
  segment_count: number;
  segment_ordinals_valid: boolean;
  missing_segment_ids: string[];
}

export type RejectionReason =
  | "missing_route_name"
  | "missing_first_trailhead"
  | "missing_summit_objective"
  | "invalid_destination_ordinals"
  | "missing_destination_references"
  | "invalid_distance"
  | "invalid_gain"
  | "invalid_gain_loss"
  | "missing_route_shape"
  | "missing_country_code"
  | "invalid_country_code"
  | "missing_state_code"
  | "invalid_state_code"
  | "missing_segments"
  | "invalid_segment_ordinals"
  | "missing_segment_references";

// Avoid path, polyline6, and elevation_string even for null checks: these may
// detoast large catalog lines. The refresh command validates their geometry.
export const CATALOG_SQL = `
WITH catalog AS MATERIALIZED (
  SELECT id, name, status, shape::text, distance, gain, gain_loss,
         provenance->>'source_kind' AS source_kind
  FROM routes
  WHERE owner = 'peaks'
), destination_rows AS MATERIALIZED (
  SELECT rd.route_id, rd.destination_id, rd.ordinal,
         d.id, d.name, d.features, d.country_code, d.state_code
  FROM route_destinations rd
  JOIN catalog c ON c.id = rd.route_id
  LEFT JOIN destinations d ON d.id = rd.destination_id
), destination_links AS MATERIALIZED (
  SELECT rd.route_id,
         count(*)::int AS destination_count,
         (count(*) = count(DISTINCT rd.ordinal)
           AND min(rd.ordinal) = 0
           AND max(rd.ordinal) = count(*) - 1) AS ordinals_valid,
         COALESCE(array_agg(rd.destination_id ORDER BY rd.destination_id)
           FILTER (WHERE rd.id IS NULL), ARRAY[]::text[]) AS missing_ids
  FROM destination_rows rd
  GROUP BY rd.route_id
), first_trailheads AS MATERIALIZED (
  SELECT DISTINCT ON (rd.route_id)
         rd.route_id, rd.id, rd.name, rd.country_code, rd.state_code
  FROM destination_rows rd
  WHERE rd.ordinal = 0
    AND 'trailhead'::destination_feature = ANY(rd.features)
  ORDER BY rd.route_id, rd.id
), last_summits AS MATERIALIZED (
  SELECT DISTINCT ON (rd.route_id)
         rd.route_id, rd.id, rd.name, rd.country_code, rd.state_code
  FROM destination_rows rd
  WHERE 'summit'::destination_feature = ANY(rd.features)
  ORDER BY rd.route_id, rd.ordinal DESC, rd.id
), segment_links AS MATERIALIZED (
  SELECT rs.route_id,
         count(*)::int AS segment_count,
         (count(*) = count(DISTINCT rs.ordinal)
           AND min(rs.ordinal) = 0
           AND max(rs.ordinal) = count(*) - 1) AS ordinals_valid,
         COALESCE(array_agg(rs.segment_id ORDER BY rs.segment_id)
           FILTER (WHERE s.id IS NULL), ARRAY[]::text[]) AS missing_ids
  FROM route_segments rs
  JOIN catalog c ON c.id = rs.route_id
  LEFT JOIN segments s ON s.id = rs.segment_id
  GROUP BY rs.route_id
)
SELECT c.*,
       COALESCE(dl.destination_count, 0) AS destination_count,
       COALESCE(dl.ordinals_valid, false) AS destination_ordinals_valid,
       COALESCE(dl.missing_ids, ARRAY[]::text[]) AS missing_destination_ids,
       th.id AS trailhead_id, th.name AS trailhead_name,
       th.country_code AS trailhead_country_code,
       th.state_code AS trailhead_state_code,
       obj.id AS objective_id, obj.name AS objective_name,
       obj.country_code AS objective_country_code,
       obj.state_code AS objective_state_code,
       COALESCE(sl.segment_count, 0) AS segment_count,
       COALESCE(sl.ordinals_valid, false) AS segment_ordinals_valid,
       COALESCE(sl.missing_ids, ARRAY[]::text[]) AS missing_segment_ids
FROM catalog c
LEFT JOIN destination_links dl ON dl.route_id = c.id
LEFT JOIN segment_links sl ON sl.route_id = c.id
LEFT JOIN first_trailheads th ON th.route_id = c.id
LEFT JOIN last_summits obj ON obj.route_id = c.id
ORDER BY c.id`;

export const GOLDEN_QUERIES = [
  { query: "Mount Si Trail", names: ["mount si"] },
  { query: "Little Si", names: ["little si"] },
  { query: "Rattlesnake Ledge", names: ["rattlesnake ledge"] },
  { query: "Lake Serene", names: ["lake serene"] },
  { query: "Snow Lake", names: ["snow lake"] },
  { query: "Ingalls Lake via Ingalls Way", names: ["ingalls lake", "ingalls way"] },
  { query: "Ingalls Peak", names: ["ingalls peak"] },
  { query: "Esmeralda Basin", names: ["esmeralda basin"] },
  { query: "Colchuck Lake", names: ["colchuck lake"] },
  { query: "Lake Stuart", names: ["lake stuart"] },
  { query: "Enchantment Lakes traverse", names: ["enchantment"] },
  { query: "Skyline Loop (Paradise)", names: ["skyline", "paradise"] },
  { query: "Naches Peak Loop", names: ["naches peak"] },
  { query: "Mailbox Peak (both trails)", names: ["mailbox peak"] },
  { query: "Heather–Maple Pass Loop", names: ["heather", "maple pass"] },
  { query: "Blanca Lake", names: ["blanca lake"] },
  { query: "Lake 22", names: ["lake 22", "lake twenty two"] },
  { query: "Poo Poo Point", names: ["poo poo point"] },
  { query: "Tolmie Peak", names: ["tolmie peak"] },
  { query: "Mount Pilchuck", names: ["mount pilchuck"] },
] as const;

function nonblank(value: string | null): string | null {
  return value?.trim() || null;
}

export function routeRegion(row: CatalogRouteRow): {
  country_code: string | null;
  state_code: string | null;
} {
  return {
    country_code: nonblank(row.objective_country_code) ?? nonblank(row.trailhead_country_code),
    state_code: nonblank(row.objective_state_code) ?? nonblank(row.trailhead_state_code),
  };
}

export function rejectionReasons(row: CatalogRouteRow): RejectionReason[] {
  const reasons: RejectionReason[] = [];
  if (!nonblank(row.name)) reasons.push("missing_route_name");
  if (!row.trailhead_id) reasons.push("missing_first_trailhead");
  if (!row.objective_id) reasons.push("missing_summit_objective");
  if (!row.destination_ordinals_valid) reasons.push("invalid_destination_ordinals");
  if (row.missing_destination_ids.length > 0) reasons.push("missing_destination_references");
  if (row.distance === null || !Number.isFinite(row.distance) || row.distance <= 0) {
    reasons.push("invalid_distance");
  }
  if (row.gain === null || !Number.isFinite(row.gain) || row.gain < 0) {
    reasons.push("invalid_gain");
  }
  if (row.gain_loss === null || !Number.isFinite(row.gain_loss) || row.gain_loss < 0) {
    reasons.push("invalid_gain_loss");
  }
  if (row.shape === null) reasons.push("missing_route_shape");
  const region = routeRegion(row);
  if (!region.country_code) reasons.push("missing_country_code");
  else if (!/^[A-Z]{2}$/.test(region.country_code)) reasons.push("invalid_country_code");
  if (!region.state_code) reasons.push("missing_state_code");
  else if (!/^[A-Z0-9][A-Z0-9-]{0,15}$/.test(region.state_code)) {
    reasons.push("invalid_state_code");
  }
  if (row.segment_count === 0) reasons.push("missing_segments");
  if (!row.segment_ordinals_valid) reasons.push("invalid_segment_ordinals");
  if (row.missing_segment_ids.length > 0) reasons.push("missing_segment_references");
  return reasons;
}

function reportedNumber(value: number | null): number | string | null {
  return value !== null && !Number.isFinite(value) ? String(value) : value;
}

function routeFacts(row: CatalogRouteRow) {
  return {
    route_id: row.id,
    name: row.name,
    status: row.status,
    shape: row.shape,
    stored_distance_m: reportedNumber(row.distance),
    stored_gain_m: reportedNumber(row.gain),
    stored_gain_loss_m: reportedNumber(row.gain_loss),
    ...routeRegion(row),
    trailhead_id: row.trailhead_id,
    trailhead_name: row.trailhead_name,
    objective_id: row.objective_id,
    objective_name: row.objective_name,
    source_kind: row.source_kind,
    destination_count: row.destination_count,
    segment_count: row.segment_count,
  };
}

function normalizedName(value: string | null): string {
  return (value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function countBy(rows: CatalogRouteRow[], field: "status" | "source_kind"): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = nonblank(row[field]) ?? "missing";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

export function buildAuditReport(rows: CatalogRouteRow[], generatedAt = new Date().toISOString()) {
  if (rows.length === 0) throw new Error("Empty Peaks catalog: trail preflight did not audit any routes");
  const rejections = rows.flatMap((row) => {
    const reasons = rejectionReasons(row);
    return reasons.length === 0 ? [] : [{
      ...routeFacts(row), reasons,
      missing_destination_ids: row.missing_destination_ids,
      missing_segment_ids: row.missing_segment_ids,
    }];
  });
  const reasonCounts: Partial<Record<RejectionReason, number>> = {};
  for (const rejection of rejections) {
    for (const reason of rejection.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  }
  const rejectedIds = new Set(rejections.map((row) => row.route_id));
  return {
    summary: {
      mode: "read_only_preflight" as const,
      generated_at: generatedAt,
      scope: { owner: "peaks", statuses: "all" },
      checks: "scalar metadata and destination/segment links",
      deep_integrity_checked: false,
      metrics_backfill_verified: false,
      catalog_routes: rows.length,
      metadata_ready_routes: rows.length - rejections.length,
      rejected_routes: rejections.length,
      rejected_by_reason: reasonCounts,
      by_status: countBy(rows, "status"),
      rejected_by_status: countBy(rows.filter((row) => rejectedIds.has(row.id)), "status"),
      by_source_kind: countBy(rows, "source_kind"),
    },
    golden_discovery: GOLDEN_QUERIES.map(({ query, names }) => {
      const matches = rows.filter((row) => {
        const region = routeRegion(row);
        if (region.country_code !== "US" || region.state_code !== "WA") return false;
        const texts = [row.name, row.objective_name, row.trailhead_name].map(normalizedName);
        return names.some((name) => texts.some((text) =>
          (` ${text} `).includes(` ${name} `) ||
          (name === "enchantment" && (` ${text} `).includes(" enchantments "))));
      });
      return {
        query,
        match_scope: "WA catalog route, objective, or trailhead names; candidates require review",
        result: matches.length > 0 ? "observed_candidates" : "no_catalog_name_match",
        search_rank: null,
        matches: matches.map((row) => ({ ...routeFacts(row), rejection_reasons: rejectionReasons(row) })),
      };
    }),
    rejections,
  };
}

export function parseArgs(argv: string[]): AuditArgs {
  let reportPath = "/tmp/peaks-trail-catalog-preflight.json";
  let rejectionsPath: string | null = null;
  let timeoutMs = 60_000;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const separator = argument.indexOf("=");
    const flag = separator < 0 ? argument : argument.slice(0, separator);
    if (!["--report", "--rejections", "--timeout-ms"].includes(flag)) {
      throw new Error(`Unknown option ${flag}; this audit has no --apply mode`);
    }
    const value = separator < 0 ? argv[++index] : argument.slice(separator + 1);
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (flag === "--report") reportPath = value;
    else if (flag === "--rejections") rejectionsPath = value;
    else {
      if (!/^\d+$/.test(value)) throw new Error("--timeout-ms must be an integer");
      timeoutMs = Number(value);
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000) {
        throw new Error("--timeout-ms must be between 1000 and 300000");
      }
    }
  }
  const resolvedReport = path.resolve(reportPath);
  const resolvedRejections = path.resolve(rejectionsPath ?? reportPath.replace(/\.json$/, "") + ".rejected.jsonl");
  if (resolvedReport === resolvedRejections) throw new Error("Report and rejection paths must differ");
  return { reportPath: resolvedReport, rejectionsPath: resolvedRejections, timeoutMs };
}

export async function loadCatalog(
  client: Pick<PoolClient, "query">,
  timeoutMs: number,
): Promise<CatalogRouteRow[]> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000) {
    throw new Error("Audit timeout must be between 1000 and 300000 milliseconds");
  }
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query(`SET LOCAL statement_timeout = '${timeoutMs}ms'`);
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    const result = await client.query<CatalogRouteRow>(CATALOG_SQL);
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function writeReports(args: AuditArgs, report: ReturnType<typeof buildAuditReport>) {
  await Promise.all([...new Set([path.dirname(args.reportPath), path.dirname(args.rejectionsPath)])]
    .map((directory) => mkdir(directory, { recursive: true })));
  await writeFile(args.rejectionsPath,
    report.rejections.map((row) => JSON.stringify(row)).join("\n") + (report.rejections.length > 0 ? "\n" : ""));
  const summary = {
    ...report.summary,
    report_path: args.reportPath,
    rejections_path: args.rejectionsPath,
  };
  await writeFile(args.reportPath, JSON.stringify({ summary, golden_discovery: report.golden_discovery }, null, 2) + "\n");
  return summary;
}

async function main(): Promise<void> {
  if (process.argv.slice(2).some((arg) => arg === "--help" || arg === "-h")) {
    console.log("Usage: npm run audit:trail-catalog -- [--report FILE] [--rejections FILE] [--timeout-ms 60000]\n" +
      "Read-only metadata preflight. No --apply mode. Exit 2 means rejected routes; exit 1 means the audit failed.");
    return;
  }
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || "5432"),
    database: process.env.DB_NAME || "peaks",
    user: process.env.DB_USER || "peaks-api",
    password: process.env.DB_PASS,
    max: 1,
    connectionTimeoutMillis: 10_000,
    options: "-c default_transaction_read_only=on",
  });
  try {
    const client = await pool.connect();
    let rows: CatalogRouteRow[];
    try { rows = await loadCatalog(client, args.timeoutMs); }
    finally { client.release(); }
    const report = buildAuditReport(rows);
    console.log(JSON.stringify(await writeReports(args, report)));
    if (report.rejections.length > 0) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

if (/(?:^|[/\\])audit-trail-catalog\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
