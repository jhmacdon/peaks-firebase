import db from "./db";

// Reads the data_source_freshness view and fails when a required external
// source has gone stale or has never run. Read-only: it writes nothing and
// takes no --apply. Exit code 1 means at least one required source needs a
// refresh (see cloud-sql/migrate/docs/trailhead-data-refresh.md).

// usfs_pages is imported and logged like the others but is not required: the
// page sections contribute a single leaf across the whole catalog, so a
// quarterly alarm on it would be noise. It still shows in the report as an
// [other] source.
export const REQUIRED_SOURCES: readonly string[] = ["usfs_fees", "usfs_bathrooms"];
export const STALE_AFTER_DAYS = 90;

export const FRESHNESS_VIEW_PROBE_SQL =
  `SELECT to_regclass('public.data_source_freshness') IS NOT NULL AS view_ready`;

export const FRESHNESS_SQL = `SELECT source, last_successful_at, days_stale, is_stale
FROM data_source_freshness
ORDER BY source`;

export interface FreshnessRow {
  source: string;
  last_successful_at: string | Date | null;
  days_stale: number | null;
  is_stale: boolean | null;
}

export type FreshnessState = "ok" | "stale" | "never_succeeded" | "never_run";

export interface FreshnessAssessment {
  source: string;
  required: boolean;
  state: FreshnessState;
  lastSuccessfulAt: string | null;
  daysStale: number | null;
}

export interface FreshnessReport {
  assessments: FreshnessAssessment[];
  failures: FreshnessAssessment[];
  ok: boolean;
}

interface QueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

export interface QueryExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface CheckDependencies {
  db?: QueryExecutor;
  console?: Pick<Console, "log" | "warn">;
}

export interface Args {
  staleDays: number;
  json: boolean;
  help: boolean;
}

export function usage(): string {
  return [
    "Usage:",
    "  tsx src/check-data-freshness.ts",
    "  tsx src/check-data-freshness.ts --json",
    "",
    "Options:",
    `  --stale-days=N   days before a source counts as stale (default ${STALE_AFTER_DAYS})`,
    "  --json           print the assessment as JSON",
    "  --help           print this and exit",
    "",
    `Required sources: ${REQUIRED_SOURCES.join(", ")}`,
    "Exit code 1 means a required source is stale or has never run.",
  ].join("\n");
}

export function parseArgs(argv: string[]): Args {
  const raw = argv.find((a) => a.startsWith("--stale-days="));
  let staleDays = STALE_AFTER_DAYS;
  if (raw) {
    staleDays = Number.parseInt(raw.slice("--stale-days=".length), 10);
    if (!Number.isInteger(staleDays) || staleDays < 1) {
      throw new Error("--stale-days must be a positive integer");
    }
  }
  return { staleDays, json: argv.includes("--json"), help: argv.includes("--help") || argv.includes("-h") };
}

function isoDate(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Decide the state of every required source, then of anything else the view
 * knows about. A required source missing from the view has never run at all —
 * the view only lists sources with at least one recorded run.
 */
export function evaluateFreshness(
  rows: FreshnessRow[],
  requiredSources: readonly string[] = REQUIRED_SOURCES,
  staleAfterDays: number = STALE_AFTER_DAYS
): FreshnessReport {
  const bySource = new Map<string, FreshnessRow>();
  for (const row of rows) bySource.set(row.source, row);

  const assess = (source: string, required: boolean): FreshnessAssessment => {
    const row = bySource.get(source);
    if (!row) {
      return { source, required, state: "never_run", lastSuccessfulAt: null, daysStale: null };
    }
    const lastSuccessfulAt = isoDate(row.last_successful_at);
    const daysStale = row.days_stale === null || row.days_stale === undefined ? null : Number(row.days_stale);
    if (lastSuccessfulAt === null) {
      return { source, required, state: "never_succeeded", lastSuccessfulAt: null, daysStale: null };
    }
    const stale = daysStale !== null ? daysStale > staleAfterDays : row.is_stale === true;
    return { source, required, state: stale ? "stale" : "ok", lastSuccessfulAt, daysStale };
  };

  const assessments = requiredSources.map((source) => assess(source, true));
  for (const row of rows) {
    if (!requiredSources.includes(row.source)) assessments.push(assess(row.source, false));
  }
  const failures = assessments.filter((a) => a.required && a.state !== "ok");
  return { assessments, failures, ok: failures.length === 0 };
}

export function formatReport(report: FreshnessReport, staleAfterDays: number): string[] {
  const lines: string[] = [`Data source freshness (stale after ${staleAfterDays} days):`];
  for (const a of report.assessments) {
    const tag = a.required ? "required" : "other";
    if (a.state === "never_run") {
      lines.push(`  ${a.source} [${tag}]: no run recorded — NEVER RUN`);
    } else if (a.state === "never_succeeded") {
      lines.push(`  ${a.source} [${tag}]: runs recorded but none succeeded — STALE`);
    } else {
      const age = a.daysStale === null ? "unknown age" : `${a.daysStale} days ago`;
      lines.push(
        `  ${a.source} [${tag}]: last success ${a.lastSuccessfulAt} (${age}) — ${a.state === "ok" ? "ok" : "STALE"}`
      );
    }
  }
  if (report.ok) lines.push("All required sources are current.");
  else lines.push(`Stale or missing required sources: ${report.failures.map((f) => f.source).join(", ")}`);
  return lines;
}

export async function checkDataFreshness(
  args: Args,
  deps: CheckDependencies = {}
): Promise<FreshnessReport> {
  const logger = deps.console ?? console;
  const database = deps.db ?? (db as unknown as QueryExecutor);

  const probe = await database.query<{ view_ready: boolean }>(FRESHNESS_VIEW_PROBE_SQL);
  if (!probe.rows[0]?.view_ready) {
    throw new Error(
      "data_source_freshness is missing — apply cloud-sql/migrations/20260819_data_source_runs.sql first"
    );
  }

  const result = await database.query<FreshnessRow>(FRESHNESS_SQL);
  const report = evaluateFreshness(result.rows, REQUIRED_SOURCES, args.staleDays);

  if (args.json) logger.log(JSON.stringify(report, null, 2));
  else for (const line of formatReport(report, args.staleDays)) logger.log(line);

  return report;
}

function isDirectRun(scriptPath: string | undefined): boolean {
  return /(?:^|[/\\])check-data-freshness\.(?:ts|js)$/.test(scriptPath ?? "");
}

if (isDirectRun(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  checkDataFreshness(args)
    .then(async (report) => {
      await db.end();
      process.exit(report.ok ? 0 : 1);
    })
    .catch(async (err) => {
      console.error(err instanceof Error ? err.message : err);
      await db.end();
      process.exit(1);
    });
}
