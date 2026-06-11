import fs from "fs";
import readline from "readline";
import db from "./db";
import {
  buildLinkDestinationsSql,
  isFederalPadusFeature,
  normalizePadusFeature,
  parseGeoJsonFeatures,
  shouldImportPadusFeature,
  type NormalizedPadusArea,
  type GeoJsonFeature,
} from "./padus-area-utils";

export interface Args {
  input: string | null;
  sourceVersion: string;
  apply: boolean;
  dryRun: boolean;
  linkDestinations: boolean;
  replaceLinks: boolean;
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

export interface ImportPadusDependencies {
  db?: ImportDatabase;
  readFile?: (path: string) => string;
  console?: Pick<Console, "log">;
}

export const PADUS_IMPORT_INSERT_CHUNK_SIZE = 250;
export const MAX_BUFFERED_GEOJSON_BYTES = 50 * 1024 * 1024;
const INSERT_PART_PARAM_COUNT = 15;

interface ImportAudit {
  readFeatures: number;
  importableParts: number;
  groupKeys: Set<string>;
  byKind: Map<string, number>;
  designationCounts: Map<string, number>;
  skippedReasons: Map<string, number>;
}

type AreaHandler = (area: NormalizedPadusArea) => Promise<void> | void;

function validateArgs(args: Args): void {
  if (args.apply && args.dryRun) {
    throw new Error("--apply and --dry-run cannot be used together");
  }
  if (args.replaceLinks && !args.linkDestinations) {
    throw new Error("--replace-links requires --link-destinations");
  }
}

export function parseArgs(argv: string[]): Args {
  const inputArg = argv.find((a) => a.startsWith("--input="));
  const versionArg = argv.find((a) => a.startsWith("--source-version="));
  const apply = argv.includes("--apply");
  const dryRunFlag = argv.includes("--dry-run");
  const args = {
    input: inputArg ? inputArg.slice("--input=".length) : null,
    sourceVersion: versionArg ? versionArg.slice("--source-version=".length) : "4.1",
    apply,
    dryRun: dryRunFlag || !apply,
    linkDestinations: argv.includes("--link-destinations"),
    replaceLinks: argv.includes("--replace-links"),
  };
  validateArgs(args);
  return args;
}

function usage(): string {
  return [
    "Usage:",
    "  tsx src/import-padus-areas.ts --input=/path/padus.ndjson --dry-run",
    "  tsx src/import-padus-areas.ts --input=/path/padus.ndjson --apply",
    "  tsx src/import-padus-areas.ts --input=/path/padus.ndjson --apply --link-destinations",
    "  tsx src/import-padus-areas.ts --input=/path/padus.ndjson --apply --link-destinations --replace-links",
  ].join("\n");
}

function countMapValue(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function designationLabel(feature: GeoJsonFeature): string {
  const props = feature.properties ?? {};
  const value = props.Des_Tp ?? props.Loc_Ds ?? props.Category ?? props.FeatClass;
  if (value === null || value === undefined) return "(missing)";
  const label = String(value).trim();
  return label.length > 0 ? label : "(missing)";
}

function skipReason(feature: GeoJsonFeature): string {
  if (!feature.geometry || (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon")) {
    return "unsupported_or_missing_geometry";
  }
  if (!isFederalPadusFeature(feature)) {
    return "non_federal";
  }
  if (!shouldImportPadusFeature(feature)) {
    return "unsupported_designation";
  }
  return "normalization_failed";
}

function logCountMap(
  logger: Pick<Console, "log">,
  title: string,
  counts: Map<string, number>
): void {
  logger.log(title);
  for (const [key, count] of Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    logger.log(`  ${key}: ${count}`);
  }
}

function createImportAudit(): ImportAudit {
  return {
    readFeatures: 0,
    importableParts: 0,
    groupKeys: new Set<string>(),
    byKind: new Map<string, number>(),
    designationCounts: new Map<string, number>(),
    skippedReasons: new Map<string, number>(),
  };
}

async function recordFeature(
  feature: GeoJsonFeature,
  sourceVersion: string,
  audit: ImportAudit,
  onArea?: AreaHandler
): Promise<void> {
  audit.readFeatures++;

  const area = normalizePadusFeature(feature, sourceVersion);
  if (area) {
    audit.importableParts++;
    audit.groupKeys.add(area.groupKey);
    countMapValue(audit.byKind, area.kind);
    countMapValue(audit.designationCounts, designationLabel(feature));
    await onArea?.(area);
  } else {
    countMapValue(audit.skippedReasons, skipReason(feature));
  }
}

async function scanParsedFeatures(
  features: GeoJsonFeature[],
  sourceVersion: string,
  audit: ImportAudit,
  onArea?: AreaHandler
): Promise<void> {
  for (const feature of features) {
    await recordFeature(feature, sourceVersion, audit, onArea);
  }
}

function isNdjsonPath(inputPath: string): boolean {
  return /\.(?:ndjson|geojsonl|jsonl)$/i.test(inputPath);
}

function assertBufferedGeoJsonSize(inputPath: string): void {
  const size = fs.statSync(inputPath).size;
  if (size > MAX_BUFFERED_GEOJSON_BYTES) {
    throw new Error(
      `Large GeoJSON imports must be converted to NDJSON or GeoJSONL before running this importer. ` +
      `${inputPath} is ${size} bytes; buffered GeoJSON is limited to ${MAX_BUFFERED_GEOJSON_BYTES} bytes.`
    );
  }
}

async function scanNdjsonFile(
  inputPath: string,
  sourceVersion: string,
  audit: ImportAudit,
  onArea?: AreaHandler
): Promise<void> {
  const lines = readline.createInterface({
    input: fs.createReadStream(inputPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const features = parseGeoJsonFeatures(line);
    if (features.length !== 1) {
      throw new Error("NDJSON input lines must be GeoJSON Feature objects");
    }
    await recordFeature(features[0], sourceVersion, audit, onArea);
  }
}

async function scanInputFeatures(
  inputPath: string,
  sourceVersion: string,
  readFile?: (path: string) => string,
  onArea?: AreaHandler
): Promise<ImportAudit> {
  const audit = createImportAudit();

  if (readFile) {
    await scanParsedFeatures(parseGeoJsonFeatures(readFile(inputPath)), sourceVersion, audit, onArea);
    return audit;
  }

  if (isNdjsonPath(inputPath)) {
    await scanNdjsonFile(inputPath, sourceVersion, audit, onArea);
    return audit;
  }

  assertBufferedGeoJsonSize(inputPath);
  const contents = fs.readFileSync(inputPath, "utf8");
  await scanParsedFeatures(parseGeoJsonFeatures(contents), sourceVersion, audit, onArea);
  return audit;
}

function logImportAudit(logger: Pick<Console, "log">, audit: ImportAudit): void {
  logger.log(`Read features: ${audit.readFeatures}`);
  logger.log(`Importable PAD-US area parts: ${audit.importableParts}`);
  logger.log(`Dissolved logical areas: ${audit.groupKeys.size}`);
  logger.log(`Skipped PAD-US features: ${audit.readFeatures - audit.importableParts}`);

  for (const [kind, count] of Array.from(audit.byKind.entries()).sort()) {
    logger.log(`  ${kind}: ${count}`);
  }
  logCountMap(logger, "Importable PAD-US designations:", audit.designationCounts);
  logCountMap(logger, "Skipped PAD-US features by reason:", audit.skippedReasons);
}

async function createTempTable(client: QueryExecutor): Promise<void> {
  await client.query(`
    CREATE TEMP TABLE padus_area_import_parts (
      group_key text NOT NULL,
      id text NOT NULL,
      name text NOT NULL,
      search_name text NOT NULL,
      kind area_kind NOT NULL,
      designation text,
      manager text,
      owner_name text,
      country_code text NOT NULL,
      state_codes text[] NOT NULL,
      source text NOT NULL,
      source_id text NOT NULL,
      source_version text NOT NULL,
      source_record_id text NOT NULL,
      metadata jsonb NOT NULL,
      geom geometry(MultiPolygon, 4326) NOT NULL
    ) ON COMMIT DROP
  `);
}

function insertPartValuesSql(rowIndex: number): string {
  const param = (offset: number) => `$${rowIndex * INSERT_PART_PARAM_COUNT + offset}`;
  return `(
    ${param(1)}, ${param(2)}, ${param(3)}, ${param(4)}, ${param(5)}::area_kind, ${param(6)}, ${param(7)},
    ${param(8)}, 'US', ${param(9)}::text[], ${param(10)}, ${param(11)},
    ${param(12)}, ${param(13)}, ${param(14)}::jsonb,
    ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${param(15)}), 4326)), 3))
  )`;
}

function insertPartParams(area: NormalizedPadusArea): unknown[] {
  return [
    area.groupKey,
    area.sourceId,
    area.name,
    area.searchName,
    area.kind,
    area.designation,
    area.manager,
    area.owner,
    area.stateCodes,
    area.source,
    area.sourceId,
    area.sourceVersion,
    area.sourceRecordId,
    JSON.stringify(area.metadata),
    JSON.stringify(area.geometry),
  ];
}

async function insertParts(
  client: QueryExecutor,
  areas: NormalizedPadusArea[],
  chunkSize = PADUS_IMPORT_INSERT_CHUNK_SIZE
): Promise<void> {
  for (let start = 0; start < areas.length; start += chunkSize) {
    const chunk = areas.slice(start, start + chunkSize);
    const valuesSql = chunk.map((_, index) => insertPartValuesSql(index)).join(",\n");
    const params = chunk.flatMap(insertPartParams);

    await client.query(
      `INSERT INTO padus_area_import_parts (
         group_key, id, name, search_name, kind, designation, manager,
         owner_name, country_code, state_codes, source, source_id,
         source_version, source_record_id, metadata, geom
       ) VALUES
       ${valuesSql}`,
      params
    );
  }
}

async function upsertAreas(client: QueryExecutor): Promise<number> {
  const result = await client.query(`
    WITH dissolved AS (
      SELECT
        group_key,
        min(id) AS id,
        min(name) AS name,
        min(search_name) AS search_name,
        min(kind::text)::area_kind AS kind,
        min(designation) AS designation,
        min(manager) AS manager,
        min(owner_name) AS owner_name,
        'US' AS country_code,
        ARRAY(
          SELECT DISTINCT code
          FROM padus_area_import_parts p2, unnest(p2.state_codes) AS code
          WHERE p2.group_key = p.group_key
          ORDER BY code
        ) AS state_codes,
        min(source) AS source,
        min(source_id) AS source_id,
        min(source_version) AS source_version,
        jsonb_build_object(
          'source_record_ids', jsonb_agg(DISTINCT source_record_id ORDER BY source_record_id),
          'parts', jsonb_agg(metadata ORDER BY source_record_id)
        ) AS metadata,
        ST_Multi(ST_Union(geom)) AS geom
      FROM padus_area_import_parts p
      GROUP BY group_key
    ),
    validated AS (
      SELECT
        id, name, search_name, kind, designation, manager, owner_name,
        country_code, state_codes, source, source_id, source_version,
        metadata,
        ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3)) AS validated_geom
      FROM dissolved
    ),
    prepared AS (
      SELECT
        id, name, search_name, kind, designation, manager, owner_name,
        country_code, state_codes, source, source_id, source_version,
        metadata,
        validated_geom AS geom
      FROM validated
      WHERE NOT ST_IsEmpty(validated_geom)
    )
    INSERT INTO areas (
      id, name, search_name, kind, designation, manager, owner,
      country_code, state_codes, source, source_id, source_version,
      boundary, centroid,
      bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng,
      metadata, created_at, updated_at
    )
    SELECT
      id, name, search_name, kind, designation, manager, owner_name,
      country_code, state_codes, source, source_id, source_version,
      geom::geography,
      ST_Centroid(geom)::geography,
      ST_YMin(Box2D(geom)),
      ST_YMax(Box2D(geom)),
      ST_XMin(Box2D(geom)),
      ST_XMax(Box2D(geom)),
      metadata,
      NOW(), NOW()
    FROM prepared
    ON CONFLICT (source, source_id) DO UPDATE SET
      name = EXCLUDED.name,
      search_name = EXCLUDED.search_name,
      kind = EXCLUDED.kind,
      designation = EXCLUDED.designation,
      manager = EXCLUDED.manager,
      owner = EXCLUDED.owner,
      state_codes = EXCLUDED.state_codes,
      source_version = EXCLUDED.source_version,
      boundary = EXCLUDED.boundary,
      centroid = EXCLUDED.centroid,
      bbox_min_lat = EXCLUDED.bbox_min_lat,
      bbox_max_lat = EXCLUDED.bbox_max_lat,
      bbox_min_lng = EXCLUDED.bbox_min_lng,
      bbox_max_lng = EXCLUDED.bbox_max_lng,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
    WHERE (
      areas.name,
      areas.search_name,
      areas.kind,
      areas.designation,
      areas.manager,
      areas.owner,
      areas.state_codes,
      areas.source_version,
      areas.bbox_min_lat,
      areas.bbox_max_lat,
      areas.bbox_min_lng,
      areas.bbox_max_lng,
      areas.metadata
    ) IS DISTINCT FROM (
      EXCLUDED.name,
      EXCLUDED.search_name,
      EXCLUDED.kind,
      EXCLUDED.designation,
      EXCLUDED.manager,
      EXCLUDED.owner,
      EXCLUDED.state_codes,
      EXCLUDED.source_version,
      EXCLUDED.bbox_min_lat,
      EXCLUDED.bbox_max_lat,
      EXCLUDED.bbox_min_lng,
      EXCLUDED.bbox_max_lng,
      EXCLUDED.metadata
    )
      OR areas.boundary::geometry IS DISTINCT FROM EXCLUDED.boundary::geometry
      OR areas.centroid::geometry IS DISTINCT FROM EXCLUDED.centroid::geometry
  `);
  return result.rowCount ?? 0;
}

async function countEmptyGeometryGroups(client: QueryExecutor): Promise<number> {
  const result = await client.query<{ empty_geometry_groups: number | string }>(`
    WITH dissolved AS (
      SELECT
        group_key,
        ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(geom)), 3)) AS geom
      FROM padus_area_import_parts
      GROUP BY group_key
    )
    SELECT count(*)::int AS empty_geometry_groups
    FROM dissolved
    WHERE ST_IsEmpty(geom)
  `);
  const value = result.rows[0]?.empty_geometry_groups ?? 0;
  return typeof value === "number" ? value : parseInt(value, 10);
}

async function linkDestinations(client: QueryExecutor, replaceLinks: boolean): Promise<number> {
  const result = await client.query<{ inserted_count: number | string }>(
    buildLinkDestinationsSql(replaceLinks)
  );
  const value = result.rows[0]?.inserted_count ?? 0;
  return typeof value === "number" ? value : parseInt(value, 10);
}

async function report(database: QueryExecutor, logger: Pick<Console, "log">): Promise<void> {
  const byKind = await database.query(
    `SELECT kind, count(*)::int AS count FROM areas GROUP BY kind ORDER BY kind`
  );
  logger.log("Database-wide areas by kind:");
  for (const row of byKind.rows) {
    logger.log(`  ${row.kind}: ${row.count}`);
  }

  const linked = await database.query(`
    SELECT count(DISTINCT da.destination_id)::int AS linked_destinations,
           count(*)::int AS links
    FROM destination_areas da
    JOIN destinations d ON d.id = da.destination_id
    WHERE da.source = 'postgis'
      AND 'summit'::destination_feature = ANY(d.features)
  `);
  logger.log(`Database-wide linked summit destinations with postgis area links: ${linked.rows[0].linked_destinations}`);
  logger.log(`Database-wide summit destination-area postgis links: ${linked.rows[0].links}`);

  const unlinked = await database.query(`
    SELECT count(*)::int AS unlinked_summits
    FROM destinations d
    WHERE d.location IS NOT NULL
      AND 'summit'::destination_feature = ANY(d.features)
      AND NOT EXISTS (
        SELECT 1
        FROM destination_areas da
        WHERE da.destination_id = d.id
          AND da.source = 'postgis'
      )
  `);
  logger.log(`Database-wide summit destinations with no postgis area link: ${unlinked.rows[0].unlinked_summits}`);

  const topLinked = await database.query(`
    SELECT d.name, count(*)::int AS linked_area_count
    FROM destination_areas da
    JOIN destinations d ON d.id = da.destination_id
    WHERE da.source = 'postgis'
      AND 'summit'::destination_feature = ANY(d.features)
    GROUP BY d.id, d.name
    ORDER BY linked_area_count DESC, d.name
    LIMIT 25
  `);
  logger.log("Top linked summit destinations by area count:");
  for (const row of topLinked.rows) {
    logger.log(`  ${row.name}: ${row.linked_area_count}`);
  }
}

export async function importPadusAreas(
  args: Args,
  deps: ImportPadusDependencies = {}
): Promise<void> {
  validateArgs(args);

  if (!args.input) {
    throw new Error(`${usage()}\n\n--input is required`);
  }

  const database = (deps.db ?? db) as ImportDatabase;
  const readFile = deps.readFile;
  const logger = deps.console ?? console;

  if (args.dryRun || !args.apply) {
    const audit = await scanInputFeatures(args.input, args.sourceVersion, readFile);
    logImportAudit(logger, audit);
    logger.log("DRY RUN - no rows written. Re-run with --apply to persist.");
    return;
  }

  const client = await database.connect();
  let transactionActive = false;
  try {
    await client.query("BEGIN");
    transactionActive = true;

    await createTempTable(client);

    let pendingAreas: NormalizedPadusArea[] = [];
    const flushPendingAreas = async () => {
      if (pendingAreas.length === 0) return;
      const areas = pendingAreas;
      pendingAreas = [];
      await insertParts(client, areas);
    };
    const audit = await scanInputFeatures(args.input, args.sourceVersion, readFile, async (area) => {
      pendingAreas.push(area);
      if (pendingAreas.length >= PADUS_IMPORT_INSERT_CHUNK_SIZE) {
        await flushPendingAreas();
      }
    });
    await flushPendingAreas();
    logImportAudit(logger, audit);

    const emptyGeometryGroups = await countEmptyGeometryGroups(client);
    logger.log(`Skipped empty geometry groups after PostGIS validation: ${emptyGeometryGroups}`);

    const upserted = await upsertAreas(client);
    logger.log(`Upserted inserted or changed areas: ${upserted}`);

    if (args.linkDestinations) {
      const linked = await linkDestinations(client, args.replaceLinks);
      logger.log(`Inserted destination-area links: ${linked}`);
    }

    await client.query("COMMIT");
    transactionActive = false;
  } catch (err) {
    if (transactionActive) {
      await client.query("ROLLBACK");
      transactionActive = false;
    }
    throw err;
  } finally {
    client.release();
  }

  await report(database, logger);
}

function isDirectRun(scriptPath: string | undefined): boolean {
  return /(?:^|[/\\])import-padus-areas\.(?:ts|js)$/.test(scriptPath ?? "");
}

if (isDirectRun(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  importPadusAreas(args)
    .then(() => db.end())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(err);
      await db.end();
      process.exit(1);
    });
}
