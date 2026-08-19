import fs from "fs";
import path from "path";
import db from "./db";
import {
  buildLocationIndex,
  buildRecSiteIndex,
  buildTrailheadAmenities,
  candidateNames,
  chooseMatch,
  bathroomLeafCandidates,
  feeLeafCandidates,
  isPlainObject,
  leafKey,
  mergeTrailheadAmenities,
  normalizeRegion,
  normalizeTrailheadName,
  pageLeafCandidates,
  PG_TRGM_NAME_THRESHOLD,
  recSiteKey,
  resolveLeafConflicts,
  resolveLocation,
  TOKEN_OVERLAP_NAME_THRESHOLD,
  tokenOverlapSimilarity,
  TRAILHEAD_FACT_SOURCES,
  TRAILHEAD_MATCH_RADIUS_M,
  type BathroomRow,
  type FeeRow,
  type LeafCandidate,
  type MatchCandidate,
  type PageSectionRow,
  type RawRecSiteRow,
  type RegistryRow,
  type SourcePoint,
  type TrailheadFactSource,
} from "./trailhead-facts-utils";

// Imports parking, fee, and bathroom facts for existing Peaks trailheads from
// the normalized US Forest Service JSONL in docs/trailheads/data. It never
// creates a destination: a fact with no trailhead to hang on is reported, not
// invented. Dry-run by default; --apply writes.

export interface Args {
  dataDir: string | null;
  feesPath: string | null;
  bathroomsPath: string | null;
  sectionsPath: string | null;
  registryPath: string | null;
  rawRecSitesPath: string | null;
  reportDir: string | null;
  apply: boolean;
  dryRun: boolean;
  log: boolean;
  nameThreshold: number | null;
  radiusM: number;
  limit: number | null;
  help: boolean;
}

interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number | null;
}

export interface QueryExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface TransactionClient extends QueryExecutor {
  release(): void;
}

export interface ImportDatabase extends QueryExecutor {
  connect(): Promise<TransactionClient>;
}

export interface ImportTrailheadFactsDependencies {
  db?: ImportDatabase;
  console?: Pick<Console, "log" | "warn">;
  readFile?: (filePath: string) => string;
  writeFile?: (filePath: string, contents: string) => void;
  mkdir?: (dir: string) => void;
  now?: () => Date;
}

export const CANDIDATE_CHUNK_SIZE = 400;
export const SIMILARITY_CHUNK_SIZE = 2000;
const CANDIDATES_PER_ROW = 10;

export const TRAILHEAD_FACTS_PREFLIGHT_SQL = `SELECT
  to_regclass('public.destinations') IS NOT NULL AS destinations_ready,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'destinations' AND column_name = 'amenities'
  ) AS amenities_ready,
  EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'destination_feature' AND e.enumlabel = 'trailhead'
  ) AS trailhead_feature_ready,
  EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis_ready`;

export const PG_TRGM_PROBE_SQL = `SELECT EXISTS (
  SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
) AS pg_trgm_ready`;

export const DATA_SOURCE_RUNS_PROBE_SQL =
  `SELECT to_regclass('public.data_source_runs') IS NOT NULL AS runs_table_ready`;

// Gate 1: trailhead-featured destinations within the radius, nearest first.
export const CANDIDATE_SQL = `WITH src(idx, lat, lng) AS (
  SELECT * FROM unnest($1::int[], $2::float8[], $3::float8[])
)
SELECT src.idx AS idx,
       d.id AS destination_id,
       d.name AS destination_name,
       ST_Distance(d.location, ST_MakePoint(src.lng, src.lat)::geography)::float8 AS distance_m
FROM src
JOIN LATERAL (
  SELECT id, name, location
  FROM destinations
  WHERE 'trailhead'::destination_feature = ANY(features)
    AND location IS NOT NULL
    AND ST_DWithin(location, ST_MakePoint(src.lng, src.lat)::geography, $4::float8)
  ORDER BY location <-> ST_MakePoint(src.lng, src.lat)::geography
  LIMIT $5::int
) d ON TRUE`;

// Gate 2 measured with pg_trgm. Normalization stays in JS so there is one
// implementation of it; Postgres only scores the pair.
export const SIMILARITY_SQL = `SELECT t.idx AS idx, similarity(t.source_name, t.destination_name)::float8 AS similarity
FROM unnest($1::int[], $2::text[], $3::text[]) AS t(idx, source_name, destination_name)`;

export const EXISTING_AMENITIES_SQL =
  `SELECT id, amenities FROM destinations WHERE id = ANY($1::text[])`;

export const UPDATE_AMENITIES_SQL =
  `UPDATE destinations SET amenities = $2::jsonb WHERE id = $1`;

export const INSERT_RUN_SQL = `INSERT INTO data_source_runs
  (source, run_kind, status, started_at, finished_at, rows_in, rows_matched, rows_written, notes)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;

export function usage(): string {
  return [
    "Usage:",
    "  tsx src/import-trailhead-facts.ts --data-dir=/path/docs/trailheads/data",
    "  tsx src/import-trailhead-facts.ts --data-dir=/path/docs/trailheads/data --apply",
    "",
    "Options:",
    "  --data-dir=DIR        directory holding the normalized JSONL (required)",
    "  --fees=FILE           override <data-dir>/trailhead-fees.jsonl",
    "  --bathrooms=FILE      override <data-dir>/trailhead-bathrooms.jsonl",
    "  --sections=FILE       override <data-dir>/fs-page-sections.jsonl",
    "  --registry=FILE       override <data-dir>/fs-trailhead-page-registry.jsonl",
    "  --raw-rec-sites=FILE  override <data-dir>/raw/usfs-rec-sites-trailheads.jsonl",
    "  --report-dir=DIR      where the unmatched/rejected reports go (default: data dir)",
    "  --apply               write; without it the run is a dry run",
    "  --dry-run             the default, stated explicitly",
    "  --no-log              skip the data_source_runs entries",
    `  --name-threshold=N    name-gate cut (default ${PG_TRGM_NAME_THRESHOLD} with pg_trgm, ${TOKEN_OVERLAP_NAME_THRESHOLD} without)`,
    `  --radius-m=N          match radius in metres (default ${TRAILHEAD_MATCH_RADIUS_M})`,
    "  --limit=N             match at most N rows per source (smoke runs); every",
    "                        file is still read whole, since the location index",
    "                        and the fee guard need all of it",
    "  --help                print this and exit",
  ].join("\n");
}

function numberArg(argv: string[], flag: string): number | null {
  const raw = argv.find((a) => a.startsWith(`${flag}=`));
  if (!raw) return null;
  const value = Number.parseFloat(raw.slice(flag.length + 1));
  if (!Number.isFinite(value)) throw new Error(`${flag} must be a number`);
  return value;
}

function textArg(argv: string[], flag: string): string | null {
  const raw = argv.find((a) => a.startsWith(`${flag}=`));
  return raw ? raw.slice(flag.length + 1) : null;
}

export function parseArgs(argv: string[]): Args {
  const apply = argv.includes("--apply");
  const dryRunFlag = argv.includes("--dry-run");
  if (apply && dryRunFlag) throw new Error("--apply and --dry-run cannot be used together");

  const nameThreshold = numberArg(argv, "--name-threshold");
  if (nameThreshold !== null && (nameThreshold <= 0 || nameThreshold > 1)) {
    throw new Error("--name-threshold must be greater than 0 and at most 1");
  }
  const radiusM = numberArg(argv, "--radius-m") ?? TRAILHEAD_MATCH_RADIUS_M;
  if (radiusM <= 0) throw new Error("--radius-m must be a positive number");
  const limit = numberArg(argv, "--limit");
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }

  return {
    dataDir: textArg(argv, "--data-dir"),
    feesPath: textArg(argv, "--fees"),
    bathroomsPath: textArg(argv, "--bathrooms"),
    sectionsPath: textArg(argv, "--sections"),
    registryPath: textArg(argv, "--registry"),
    rawRecSitesPath: textArg(argv, "--raw-rec-sites"),
    reportDir: textArg(argv, "--report-dir"),
    apply,
    dryRun: dryRunFlag || !apply,
    log: !argv.includes("--no-log"),
    nameThreshold,
    radiusM,
    limit,
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

interface ParsedFile<T> {
  rows: T[];
  /** Unparseable lines in the whole file — --limit never hides one. */
  malformed: number;
}

function parseJsonl<T>(contents: string): ParsedFile<T> {
  const rows: T[] = [];
  let malformed = 0;
  for (const line of contents.split("\n")) {
    const text = line.trim();
    if (text.length === 0) continue;
    try {
      rows.push(JSON.parse(text) as T);
    } catch {
      malformed += 1;
    }
  }
  return { rows, malformed };
}

/** One input row lifted to a common shape: a point, its names, and its facts. */
interface FactRow {
  source: TrailheadFactSource;
  rowKey: string;
  name: string;
  /** Every name the gate may match on: the row's own, plus the EDW public one. */
  names: string[];
  point: SourcePoint;
  leaves: LeafCandidate[];
  refusals: string[];
  raw: Record<string, unknown>;
}

interface SourceCounts {
  rowsIn: number;
  malformed: number;
  noLocation: number;
  noFacts: number;
  noNearbyTrailhead: number;
  nameRejected: number;
  matched: number;
  rowsWritten: number;
  refusals: Record<string, number>;
  notices: Record<string, number>;
}

function emptyCounts(): SourceCounts {
  return {
    rowsIn: 0,
    malformed: 0,
    noLocation: 0,
    noFacts: 0,
    noNearbyTrailhead: 0,
    nameRejected: 0,
    matched: 0,
    rowsWritten: 0,
    refusals: {},
    notices: {},
  };
}

function countRefusals(counts: SourceCounts, refusals: string[]): void {
  for (const reason of refusals) {
    counts.refusals[reason] = (counts.refusals[reason] ?? 0) + 1;
  }
}

function countNotices(counts: SourceCounts, notices: string[]): void {
  for (const note of notices) {
    counts.notices[note] = (counts.notices[note] ?? 0) + 1;
  }
}

interface ReportRecord {
  reason: string;
  source: TrailheadFactSource;
  name: string;
  lat?: number;
  lng?: number;
  best_candidate?: {
    destination_id: string;
    destination_name: string;
    distance_m: number;
    similarity: number;
    /** Which of the row's names scored best against that destination. */
    matched_name: string;
  };
  refusals?: string[];
  /** Page rows only: the region asked for and the regions the name lives in. */
  wanted_region?: string | null;
  point_regions?: string[];
  row: Record<string, unknown>;
}

export interface TrailheadFactsSummary {
  dryRun: boolean;
  nameThreshold: number;
  nameMeasure: "pg_trgm" | "token_overlap";
  radiusM: number;
  counts: Record<TrailheadFactSource, SourceCounts>;
  destinationsConsidered: number;
  destinationsChanged: number;
  destinationsUnchanged: number;
  leafConflicts: number;
  preservedForeignLeaves: number;
  reportFiles: string[];
}

async function chunkedCandidates(
  database: QueryExecutor,
  rows: FactRow[],
  radiusM: number
): Promise<Map<number, MatchCandidate[]>> {
  const byIndex = new Map<number, MatchCandidate[]>();
  for (let start = 0; start < rows.length; start += CANDIDATE_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CANDIDATE_CHUNK_SIZE);
    const idx = chunk.map((_, i) => start + i);
    const result = await database.query<{
      idx: number;
      destination_id: string;
      destination_name: string;
      distance_m: number;
    }>(CANDIDATE_SQL, [
      idx,
      chunk.map((row) => row.point.lat),
      chunk.map((row) => row.point.lng),
      radiusM,
      CANDIDATES_PER_ROW,
    ]);
    for (const row of result.rows) {
      const list = byIndex.get(row.idx) ?? [];
      list.push({
        destinationId: row.destination_id,
        destinationName: row.destination_name ?? "",
        distanceM: Number(row.distance_m),
        similarity: 0,
        matchedName: "",
      });
      byIndex.set(row.idx, list);
    }
  }
  return byIndex;
}

/**
 * Score every (candidate, source name) pair and keep the best per candidate.
 * A row carries more than one name — the EDW site name is an internal code
 * name that differs from the public one on most rows — and Peaks catalogs
 * trailheads under the public name, so either name may clear the gate.
 */
async function scoreNames(
  database: QueryExecutor,
  rows: FactRow[],
  candidates: Map<number, MatchCandidate[]>,
  usePgTrgm: boolean
): Promise<void> {
  const pairs: Array<{ candidate: MatchCandidate; sourceName: string; destinationName: string }> = [];
  for (const [rowIndex, list] of candidates) {
    for (const candidate of list) {
      for (const sourceName of rows[rowIndex].names) {
        pairs.push({
          candidate,
          sourceName,
          destinationName: candidate.destinationName,
        });
      }
    }
  }
  if (pairs.length === 0) return;

  const keepBest = (pairIndex: number, similarity: number) => {
    const pair = pairs[pairIndex];
    if (pair.candidate.matchedName === "" || similarity > pair.candidate.similarity) {
      pair.candidate.similarity = similarity;
      pair.candidate.matchedName = pair.sourceName;
    }
  };

  if (!usePgTrgm) {
    pairs.forEach((pair, index) => {
      keepBest(
        index,
        tokenOverlapSimilarity(
          normalizeTrailheadName(pair.sourceName),
          normalizeTrailheadName(pair.destinationName)
        )
      );
    });
    return;
  }

  for (let start = 0; start < pairs.length; start += SIMILARITY_CHUNK_SIZE) {
    const chunk = pairs.slice(start, start + SIMILARITY_CHUNK_SIZE);
    const result = await database.query<{ idx: number; similarity: number }>(SIMILARITY_SQL, [
      chunk.map((_, i) => start + i),
      chunk.map((pair) => normalizeTrailheadName(pair.sourceName)),
      chunk.map((pair) => normalizeTrailheadName(pair.destinationName)),
    ]);
    for (const row of result.rows) {
      keepBest(row.idx, Number(row.similarity ?? 0));
    }
  }
}

function readSources(
  args: Args,
  readFile: (filePath: string) => string,
  counts: Record<TrailheadFactSource, SourceCounts>,
  skipped: ReportRecord[],
  logger: Pick<Console, "log" | "warn">
): FactRow[] {
  const dataDir = args.dataDir as string;
  const feesPath = args.feesPath ?? path.join(dataDir, "trailhead-fees.jsonl");
  const bathroomsPath = args.bathroomsPath ?? path.join(dataDir, "trailhead-bathrooms.jsonl");
  const sectionsPath = args.sectionsPath ?? path.join(dataDir, "fs-page-sections.jsonl");
  const registryPath = args.registryPath ?? path.join(dataDir, "fs-trailhead-page-registry.jsonl");
  const rawRecSitesPath =
    args.rawRecSitesPath ?? path.join(dataDir, "raw", "usfs-rec-sites-trailheads.jsonl");

  // Every file is read whole, even under --limit. The raw pull carries the
  // fee_charged flag, the public site name, and the region; the fee and
  // bathroom files carry the coordinates a page row borrows. Reading a slice
  // of any of them would change which rows can be located or believed, so
  // --limit is applied further down, to the rows that go on to match.
  const rawRecSites = parseJsonl<RawRecSiteRow>(readFile(rawRecSitesPath));
  const recSites = buildRecSiteIndex(rawRecSites.rows);
  if (recSites.size === 0) {
    throw new Error(
      `${rawRecSitesPath} yielded no usable rows — the fee guard and the region check need the raw EDW pull (--raw-rec-sites=FILE)`
    );
  }
  const fees = parseJsonl<FeeRow>(readFile(feesPath));
  const bathrooms = parseJsonl<BathroomRow>(readFile(bathroomsPath));
  const sections = parseJsonl<PageSectionRow>(readFile(sectionsPath));
  const registry = parseJsonl<RegistryRow>(readFile(registryPath));
  logger.log(`  Raw EDW rec-site rows indexed: ${recSites.size}`);

  counts.usfs_fees.malformed = fees.malformed;
  counts.usfs_bathrooms.malformed = bathrooms.malformed;
  counts.usfs_pages.malformed = sections.malformed;

  const limited = <T>(list: T[]): T[] => (args.limit === null ? list : list.slice(0, args.limit));
  const rows: FactRow[] = [];

  for (const row of limited(fees.rows)) {
    counts.usfs_fees.rowsIn += 1;
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) {
      counts.usfs_fees.noLocation += 1;
      skipped.push({
        reason: "no_coordinates",
        source: "usfs_fees",
        name: row.name,
        row: row as unknown as Record<string, unknown>,
      });
      continue;
    }
    const facts = recSites.get(recSiteKey(row.source_dataset, row.source_id)) ?? null;
    const extraction = feeLeafCandidates(row, facts);
    countRefusals(counts.usfs_fees, extraction.refusals);
    countNotices(counts.usfs_fees, extraction.notices);
    if (extraction.leaves.length === 0) {
      counts.usfs_fees.noFacts += 1;
      continue;
    }
    rows.push({
      source: "usfs_fees",
      rowKey: `${row.source_dataset}:${row.source_id}`,
      name: row.name,
      names: candidateNames(row.name, facts),
      point: { lat: row.lat, lng: row.lng },
      leaves: extraction.leaves,
      refusals: extraction.refusals,
      raw: row as unknown as Record<string, unknown>,
    });
  }

  for (const row of limited(bathrooms.rows)) {
    counts.usfs_bathrooms.rowsIn += 1;
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) {
      counts.usfs_bathrooms.noLocation += 1;
      skipped.push({
        reason: "no_coordinates",
        source: "usfs_bathrooms",
        name: row.name,
        row: row as unknown as Record<string, unknown>,
      });
      continue;
    }
    const extraction = bathroomLeafCandidates(row);
    countRefusals(counts.usfs_bathrooms, extraction.refusals);
    countNotices(counts.usfs_bathrooms, extraction.notices);
    if (extraction.leaves.length === 0) {
      counts.usfs_bathrooms.noFacts += 1;
      continue;
    }
    rows.push({
      source: "usfs_bathrooms",
      rowKey: `${row.source_dataset}:${row.source_id}`,
      name: row.name,
      names: candidateNames(row.name, recSites.get(recSiteKey(row.source_dataset, row.source_id)) ?? null),
      point: { lat: row.lat, lng: row.lng },
      leaves: extraction.leaves,
      refusals: extraction.refusals,
      raw: row as unknown as Record<string, unknown>,
    });
  }

  // The page registry carries no coordinates, so a page row borrows the point
  // of the EDW trailhead with the same name, in the same Forest Service
  // region. Region is the guard that matters: without it a single same-named
  // point anywhere in the country looks confident, and a Missouri page took a
  // point in Tennessee. A name that clears the region check but still covers
  // far-apart points stays unlocated.
  const registryByUrl = new Map<string, RegistryRow>();
  for (const entry of registry.rows) registryByUrl.set(entry.url, entry);
  const locatable = [...fees.rows, ...bathrooms.rows]
    .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng))
    .map((row) => {
      const facts = recSites.get(recSiteKey(row.source_dataset, row.source_id)) ?? null;
      return {
        name: row.name,
        lat: row.lat,
        lng: row.lng,
        region: facts?.region ?? null,
        publicName: facts?.publicName ?? null,
      };
    });
  const locationIndex = buildLocationIndex(locatable);
  logger.log(
    `  Page registry rows: ${registry.rows.length}; EDW names available for locating: ${locationIndex.size}`
  );

  for (const row of limited(sections.rows)) {
    counts.usfs_pages.rowsIn += 1;
    const entry = registryByUrl.get(row.url);
    if (!entry) {
      counts.usfs_pages.noLocation += 1;
      countRefusals(counts.usfs_pages, ["no_registry_row"]);
      skipped.push({
        reason: "no_registry_row",
        source: "usfs_pages",
        name: row.url,
        row: row as unknown as Record<string, unknown>,
      });
      continue;
    }
    const located = resolveLocation(locationIndex, entry.name, entry.region);
    if (located.kind !== "located") {
      const reason =
        located.kind === "ambiguous"
          ? "ambiguous_name_location"
          : located.kind === "region_mismatch"
            ? "region_mismatch"
            : located.kind === "region_unknown"
              ? "region_unknown"
              : "no_edw_name_location";
      counts.usfs_pages.noLocation += 1;
      countRefusals(counts.usfs_pages, [reason]);
      skipped.push({
        reason,
        source: "usfs_pages",
        name: entry.name,
        // Say what was compared, so a reader can tell a cross-country name
        // clash from a point that simply carries no region label.
        ...(located.kind === "region_mismatch" || located.kind === "region_unknown"
          ? { wanted_region: normalizeRegion(entry.region), point_regions: located.regions }
          : {}),
        row: row as unknown as Record<string, unknown>,
      });
      continue;
    }
    const extraction = pageLeafCandidates(row);
    countRefusals(counts.usfs_pages, extraction.refusals);
    countNotices(counts.usfs_pages, extraction.notices);
    if (extraction.leaves.length === 0) {
      counts.usfs_pages.noFacts += 1;
      continue;
    }
    rows.push({
      source: "usfs_pages",
      rowKey: row.url,
      name: entry.name,
      names: candidateNames(entry.name, {
        sourceId: row.url,
        feeCharged: null,
        feeType: null,
        publicName: located.point.publicName,
        region: located.point.region,
      }),
      point: located.point,
      leaves: extraction.leaves,
      refusals: extraction.refusals,
      raw: row as unknown as Record<string, unknown>,
    });
  }

  return rows;
}

async function assertApplySchema(client: QueryExecutor): Promise<void> {
  const result = await client.query<{
    destinations_ready: boolean;
    amenities_ready: boolean;
    trailhead_feature_ready: boolean;
    postgis_ready: boolean;
  }>(TRAILHEAD_FACTS_PREFLIGHT_SQL);
  const readiness = result.rows[0];
  if (
    !readiness?.destinations_ready ||
    !readiness.amenities_ready ||
    !readiness.trailhead_feature_ready ||
    !readiness.postgis_ready
  ) {
    throw new Error(
      "Trailhead facts apply requires destinations.amenities, the 'trailhead' destination_feature, and PostGIS"
    );
  }
}

async function logRuns(
  database: QueryExecutor,
  summary: TrailheadFactsSummary,
  startedAt: Date,
  finishedAt: Date,
  status: string,
  logger: Pick<Console, "log" | "warn">
): Promise<void> {
  const probe = await database.query<{ runs_table_ready: boolean }>(DATA_SOURCE_RUNS_PROBE_SQL);
  if (!probe.rows[0]?.runs_table_ready) {
    logger.warn("  data_source_runs is missing — skipping run logging (apply 20260819_data_source_runs.sql)");
    return;
  }
  for (const source of TRAILHEAD_FACT_SOURCES) {
    const counts = summary.counts[source];
    const notes = [
      `no_location=${counts.noLocation}`,
      `no_facts=${counts.noFacts}`,
      `no_nearby_trailhead=${counts.noNearbyTrailhead}`,
      `name_rejected=${counts.nameRejected}`,
      `threshold=${summary.nameThreshold} (${summary.nameMeasure})`,
    ].join(" ");
    await database.query(INSERT_RUN_SQL, [
      source,
      "import",
      status,
      startedAt.toISOString(),
      finishedAt.toISOString(),
      counts.rowsIn,
      counts.matched,
      counts.rowsWritten,
      notes,
    ]);
  }
}

export async function importTrailheadFacts(
  args: Args,
  deps: ImportTrailheadFactsDependencies = {}
): Promise<TrailheadFactsSummary> {
  const logger = deps.console ?? console;
  const readFile = deps.readFile ?? ((filePath: string) => fs.readFileSync(filePath, "utf8"));
  const writeFile =
    deps.writeFile ?? ((filePath: string, contents: string) => fs.writeFileSync(filePath, contents, "utf8"));
  const mkdir = deps.mkdir ?? ((dir: string) => fs.mkdirSync(dir, { recursive: true }));
  const now = deps.now ?? (() => new Date());
  const database = (deps.db ?? db) as ImportDatabase;

  if (!args.dataDir) throw new Error(`${usage()}\n\n--data-dir is required`);

  // The reports are written at the very end, after the apply transaction has
  // already committed. A report directory that does not exist must therefore
  // fail here, before anything is read or written, and not after the database
  // has taken the writes but before the run is logged as a success.
  const reportDir = args.reportDir ?? args.dataDir;
  mkdir(reportDir);

  const startedAt = now();
  const counts: Record<TrailheadFactSource, SourceCounts> = {
    usfs_fees: emptyCounts(),
    usfs_bathrooms: emptyCounts(),
    usfs_pages: emptyCounts(),
  };

  logger.log(args.dryRun ? "Trailhead facts import (dry run)" : "Trailhead facts import (apply)");
  const skipped: ReportRecord[] = [];
  const rows = readSources(args, readFile, counts, skipped, logger);
  logger.log(`  Rows carrying at least one fact: ${rows.length}`);

  const trgmProbe = await database.query<{ pg_trgm_ready: boolean }>(PG_TRGM_PROBE_SQL);
  const usePgTrgm = trgmProbe.rows[0]?.pg_trgm_ready === true;
  const nameMeasure: "pg_trgm" | "token_overlap" = usePgTrgm ? "pg_trgm" : "token_overlap";
  const nameThreshold =
    args.nameThreshold ?? (usePgTrgm ? PG_TRGM_NAME_THRESHOLD : TOKEN_OVERLAP_NAME_THRESHOLD);
  logger.log(`  Name gate: ${nameMeasure} >= ${nameThreshold}; radius ${args.radiusM} m`);

  const candidates = await chunkedCandidates(database, rows, args.radiusM);
  await scoreNames(database, rows, candidates, usePgTrgm);

  const reports: Record<TrailheadFactSource, ReportRecord[]> = {
    usfs_fees: [],
    usfs_bathrooms: [],
    usfs_pages: [],
  };
  // Rows dropped before matching (no coordinates, no way to locate a page)
  // belong in the same report as the ones the gates rejected.
  for (const record of skipped) reports[record.source].push(record);
  const byDestination = new Map<string, LeafCandidate[]>();
  const rowsByDestination = new Map<string, Set<string>>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const outcome = chooseMatch(candidates.get(i) ?? [], nameThreshold);
    if (outcome.kind === "no_nearby_trailhead") {
      counts[row.source].noNearbyTrailhead += 1;
      reports[row.source].push({
        reason: "no_nearby_trailhead",
        source: row.source,
        name: row.name,
        lat: row.point.lat,
        lng: row.point.lng,
        row: row.raw,
      });
      continue;
    }
    if (outcome.kind === "name_below_threshold") {
      counts[row.source].nameRejected += 1;
      reports[row.source].push({
        reason: "name_below_threshold",
        source: row.source,
        name: row.name,
        lat: row.point.lat,
        lng: row.point.lng,
        best_candidate: {
          destination_id: outcome.best.destinationId,
          destination_name: outcome.best.destinationName,
          distance_m: outcome.best.distanceM,
          similarity: outcome.best.similarity,
          matched_name: outcome.best.matchedName,
        },
        row: row.raw,
      });
      continue;
    }

    counts[row.source].matched += 1;
    const id = outcome.candidate.destinationId;
    const existing = byDestination.get(id) ?? [];
    existing.push(...row.leaves);
    byDestination.set(id, existing);
    const rowKeys = rowsByDestination.get(id) ?? new Set<string>();
    rowKeys.add(`${row.source} ${row.rowKey}`);
    rowsByDestination.set(id, rowKeys);
  }

  const destinationIds = [...byDestination.keys()];
  const existingById = new Map<string, unknown>();
  if (destinationIds.length > 0) {
    const existing = await database.query<{ id: string; amenities: unknown }>(EXISTING_AMENITIES_SQL, [
      destinationIds,
    ]);
    for (const row of existing.rows) existingById.set(row.id, row.amenities);
  }

  interface PendingUpdate {
    id: string;
    merged: Record<string, unknown>;
    appliedLeaves: Set<string>;
  }
  const pending: PendingUpdate[] = [];
  let leafConflicts = 0;
  let preservedForeignLeaves = 0;
  let unchanged = 0;
  let skippedShape = 0;

  for (const [id, leaves] of byDestination) {
    const existing = existingById.get(id) ?? null;
    if (existing !== null && existing !== undefined && !isPlainObject(existing)) {
      skippedShape += 1;
      logger.warn(`  Skipping ${id}: amenities is not a JSON object`);
      continue;
    }
    const { chosen, conflicts } = resolveLeafConflicts(leaves);
    leafConflicts += conflicts.length;
    const merge = mergeTrailheadAmenities(existing, buildTrailheadAmenities(chosen));
    preservedForeignLeaves += merge.preservedLeaves.length;
    if (!merge.changed) {
      unchanged += 1;
      continue;
    }
    pending.push({ id, merged: merge.merged, appliedLeaves: new Set(merge.appliedLeaves) });
  }

  // A source row counts as written when one of its leaves survived conflict
  // resolution and landed on a row that actually changed.
  for (const update of pending) {
    const written = new Set<string>();
    for (const leaf of byDestination.get(update.id) ?? []) {
      if (update.appliedLeaves.has(leafKey(leaf))) written.add(`${leaf.source} ${leaf.rowKey}`);
    }
    for (const key of written) {
      const source = key.split(" ")[0] as TrailheadFactSource;
      counts[source].rowsWritten += 1;
    }
  }

  const summary: TrailheadFactsSummary = {
    dryRun: args.dryRun,
    nameThreshold,
    nameMeasure,
    radiusM: args.radiusM,
    counts,
    destinationsConsidered: byDestination.size,
    destinationsChanged: pending.length,
    destinationsUnchanged: unchanged,
    leafConflicts,
    preservedForeignLeaves,
    reportFiles: [],
  };

  // Run logging never fails the import: a missing table or a lost connection is
  // a reporting gap, not a reason to lose the writes.
  const recordRun = async (status: string): Promise<void> => {
    if (!args.log) return;
    try {
      await logRuns(database, summary, startedAt, now(), status, logger);
    } catch (err) {
      logger.warn(`  Run logging failed (continuing): ${(err as Error).message}`);
    }
  };

  if (!args.dryRun) {
    try {
      if (pending.length === 0) {
        // Nothing to write, but still prove the schema is what apply expects.
        await assertApplySchema(database);
      } else {
        const client = await database.connect();
        let transactionActive = false;
        try {
          await assertApplySchema(client);
          await client.query("BEGIN");
          transactionActive = true;
          for (const update of pending) {
            await client.query(UPDATE_AMENITIES_SQL, [update.id, JSON.stringify(update.merged)]);
          }
          await client.query("COMMIT");
          transactionActive = false;
        } catch (err) {
          if (transactionActive) await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
    } catch (err) {
      await recordRun("failed");
      throw err;
    }
  }

  const reportNames: Record<TrailheadFactSource, string> = {
    usfs_fees: "import-unmatched-fees.jsonl",
    usfs_bathrooms: "import-unmatched-bathrooms.jsonl",
    usfs_pages: "import-unmatched-pages.jsonl",
  };
  for (const source of TRAILHEAD_FACT_SOURCES) {
    const filePath = path.join(reportDir, reportNames[source]);
    writeFile(filePath, reports[source].map((record) => JSON.stringify(record)).join("\n") + "\n");
    summary.reportFiles.push(filePath);
  }

  await recordRun(args.dryRun ? "dry_run" : "success");

  logSummary(summary, skippedShape, logger);
  return summary;
}

function logSummary(
  summary: TrailheadFactsSummary,
  skippedShape: number,
  logger: Pick<Console, "log" | "warn">
): void {
  logger.log("");
  for (const source of TRAILHEAD_FACT_SOURCES) {
    const counts = summary.counts[source];
    logger.log(`${source}:`);
    logger.log(`  rows read:            ${counts.rowsIn}`);
    if (counts.malformed > 0) logger.log(`  malformed lines:      ${counts.malformed} (whole file, never limited)`);
    logger.log(`  no usable location:   ${counts.noLocation}`);
    logger.log(`  no fact to write:     ${counts.noFacts}`);
    logger.log(`  no trailhead in ${summary.radiusM}m: ${counts.noNearbyTrailhead}`);
    logger.log(`  name gate rejected:   ${counts.nameRejected}`);
    logger.log(`  matched:              ${counts.matched}`);
    logger.log(`  rows written:         ${counts.rowsWritten}`);
    const refusals = Object.entries(counts.refusals).sort((a, b) => b[1] - a[1]);
    for (const [reason, count] of refusals) logger.log(`    - not written, ${reason}: ${count}`);
    const notices = Object.entries(counts.notices).sort((a, b) => b[1] - a[1]);
    for (const [note, count] of notices) logger.log(`    - written with a caveat, ${note}: ${count}`);
  }
  logger.log("");
  logger.log(`Destinations with facts:  ${summary.destinationsConsidered}`);
  logger.log(`  changed:                ${summary.destinationsChanged}`);
  logger.log(`  already current:        ${summary.destinationsUnchanged}`);
  if (skippedShape > 0) logger.log(`  skipped (bad amenities): ${skippedShape}`);
  logger.log(`Leaf conflicts resolved:  ${summary.leafConflicts}`);
  logger.log(`Leaves left to other sources: ${summary.preservedForeignLeaves}`);
  logger.log("Reports:");
  for (const file of summary.reportFiles) logger.log(`  ${file}`);
  if (summary.dryRun) logger.log("DRY RUN - no rows written. Re-run with --apply to persist.");
}

function isDirectRun(scriptPath: string | undefined): boolean {
  return /(?:^|[/\\])import-trailhead-facts\.(?:ts|js)$/.test(scriptPath ?? "");
}

if (isDirectRun(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  importTrailheadFacts(args)
    .then(() => db.end())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(err);
      await db.end();
      process.exit(1);
    });
}
