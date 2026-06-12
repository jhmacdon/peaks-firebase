import fs from "fs";
import readline from "readline";
import db from "./db";
import {
  isFederalPadusFeature,
  normalizePadusFeature,
  parseGeoJsonFeatures,
  shouldImportPadusFeature,
  type AreaKind,
  type GeoJsonMultiPolygon,
  type NormalizedPadusArea,
  type GeoJsonFeature,
} from "./padus-area-utils";

export interface Args {
  input: string | null;
  sourceVersion: string;
  insertChunkSize: number;
  trustSourceGeometry: boolean;
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
const INSERT_GROUP_PARAM_COUNT = 13;
const LINK_DESTINATION_BATCH_SIZE = 100;

interface ImportAudit {
  readFeatures: number;
  importableParts: number;
  groupKeys: Set<string>;
  byKind: Map<string, number>;
  designationCounts: Map<string, number>;
  skippedReasons: Map<string, number>;
}

type AreaHandler = (area: NormalizedPadusArea) => Promise<void> | void;

interface ComposedPadusArea {
  id: string;
  name: string;
  searchName: string;
  kind: AreaKind;
  designation: string | null;
  manager: string | null;
  owner: string | null;
  stateCodes: string[];
  source: "padus";
  sourceId: string;
  sourceVersion: string;
  metadata: Record<string, unknown>;
  geometry: GeoJsonMultiPolygon;
}

interface AreaGroupAccumulator {
  id: string;
  name: string;
  searchName: string;
  kind: AreaKind;
  designation: string | null;
  manager: string | null;
  owner: string | null;
  source: "padus";
  sourceId: string;
  sourceVersion: string;
  stateCodes: Set<string>;
  sourceRecordIds: Set<string>;
  parts: Array<{ sourceRecordId: string; metadata: Record<string, unknown> }>;
  coordinates: GeoJsonMultiPolygon["coordinates"];
}

function validateArgs(args: Args): void {
  if (!Number.isInteger(args.insertChunkSize) || args.insertChunkSize < 1) {
    throw new Error("--insert-chunk-size must be a positive integer");
  }
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
  const insertChunkSizeArg = argv.find((a) => a.startsWith("--insert-chunk-size="));
  const apply = argv.includes("--apply");
  const dryRunFlag = argv.includes("--dry-run");
  const args = {
    input: inputArg ? inputArg.slice("--input=".length) : null,
    sourceVersion: versionArg ? versionArg.slice("--source-version=".length) : "4.1",
    insertChunkSize: insertChunkSizeArg
      ? Number.parseInt(insertChunkSizeArg.slice("--insert-chunk-size=".length), 10)
      : Number.parseInt(
        process.env.PADUS_IMPORT_INSERT_CHUNK_SIZE ?? `${PADUS_IMPORT_INSERT_CHUNK_SIZE}`,
        10
      ),
    trustSourceGeometry: argv.includes("--trust-source-geometry"),
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
    "  tsx src/import-padus-areas.ts --input=/path/padus.ndjson --apply --insert-chunk-size=10",
    "  tsx src/import-padus-areas.ts --input=/path/padus.ndjson --apply --trust-source-geometry",
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

function minText(current: string, next: string): string {
  return next.localeCompare(current) < 0 ? next : current;
}

function minNullableText(current: string | null, next: string | null): string | null {
  if (current === null) return next;
  if (next === null) return current;
  return minText(current, next);
}

function createAreaGroup(area: NormalizedPadusArea): AreaGroupAccumulator {
  return {
    id: area.sourceId,
    name: area.name,
    searchName: area.searchName,
    kind: area.kind,
    designation: area.designation,
    manager: area.manager,
    owner: area.owner,
    source: area.source,
    sourceId: area.sourceId,
    sourceVersion: area.sourceVersion,
    stateCodes: new Set(area.stateCodes),
    sourceRecordIds: new Set(),
    parts: [],
    coordinates: [],
  };
}

function addAreaToGroup(group: AreaGroupAccumulator, area: NormalizedPadusArea): void {
  group.id = minText(group.id, area.sourceId);
  group.name = minText(group.name, area.name);
  group.searchName = minText(group.searchName, area.searchName);
  group.designation = minNullableText(group.designation, area.designation);
  group.manager = minNullableText(group.manager, area.manager);
  group.owner = minNullableText(group.owner, area.owner);
  group.sourceVersion = minText(group.sourceVersion, area.sourceVersion);

  for (const code of area.stateCodes) {
    group.stateCodes.add(code);
  }
  group.sourceRecordIds.add(area.sourceRecordId);
  group.parts.push({
    sourceRecordId: area.sourceRecordId,
    metadata: area.metadata,
  });
  group.coordinates.push(...area.geometry.coordinates);
}

function composeAreaGroup(group: AreaGroupAccumulator): ComposedPadusArea {
  const parts = [...group.parts].sort((a, b) =>
    a.sourceRecordId.localeCompare(b.sourceRecordId)
  );

  return {
    id: group.id,
    name: group.name,
    searchName: group.searchName,
    kind: group.kind,
    designation: group.designation,
    manager: group.manager,
    owner: group.owner,
    stateCodes: Array.from(group.stateCodes).sort(),
    source: group.source,
    sourceId: group.sourceId,
    sourceVersion: group.sourceVersion,
    metadata: {
      source_record_ids: Array.from(group.sourceRecordIds).sort(),
      parts: parts.map((part) => part.metadata),
    },
    geometry: {
      type: "MultiPolygon",
      coordinates: group.coordinates,
    },
  };
}

function recordGroupedArea(
  groups: Map<string, AreaGroupAccumulator>,
  area: NormalizedPadusArea
): void {
  let group = groups.get(area.groupKey);
  if (!group) {
    group = createAreaGroup(area);
    groups.set(area.groupKey, group);
  }
  addAreaToGroup(group, area);
}

function composeAreaGroups(groups: Map<string, AreaGroupAccumulator>): ComposedPadusArea[] {
  return Array.from(groups.values())
    .map(composeAreaGroup)
    .filter((area) => area.geometry.coordinates.length > 0)
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

function multiPolygonWkbByteLength(geometry: GeoJsonMultiPolygon): number {
  let size = 1 + 4 + 4;
  for (const polygon of geometry.coordinates) {
    size += 1 + 4 + 4;
    for (const ring of polygon) {
      size += 4 + ring.length * 16;
    }
  }
  return size;
}

function multiPolygonToWkb(geometry: GeoJsonMultiPolygon): Buffer {
  const buffer = Buffer.allocUnsafe(multiPolygonWkbByteLength(geometry));
  let offset = 0;

  const writeHeader = (geometryType: number) => {
    buffer.writeUInt8(1, offset);
    offset += 1;
    buffer.writeUInt32LE(geometryType, offset);
    offset += 4;
  };

  writeHeader(6);
  buffer.writeUInt32LE(geometry.coordinates.length, offset);
  offset += 4;

  for (const polygon of geometry.coordinates) {
    writeHeader(3);
    buffer.writeUInt32LE(polygon.length, offset);
    offset += 4;

    for (const ring of polygon) {
      buffer.writeUInt32LE(ring.length, offset);
      offset += 4;

      for (const position of ring) {
        buffer.writeDoubleLE(position[0], offset);
        offset += 8;
        buffer.writeDoubleLE(position[1], offset);
        offset += 8;
      }
    }
  }

  return buffer;
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
    CREATE TEMP TABLE padus_area_import_raw_parts (
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
      geometry_json text NOT NULL
    ) ON COMMIT DROP;

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

function insertRawPartValuesSql(rowIndex: number): string {
  const param = (offset: number) => `$${rowIndex * INSERT_PART_PARAM_COUNT + offset}`;
  return `(
    ${param(1)}, ${param(2)}, ${param(3)}, ${param(4)}, ${param(5)}::area_kind, ${param(6)}, ${param(7)},
    ${param(8)}, 'US', ${param(9)}::text[], ${param(10)}, ${param(11)},
    ${param(12)}, ${param(13)}, ${param(14)}::jsonb, ${param(15)}
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

async function insertRawParts(
  client: QueryExecutor,
  areas: NormalizedPadusArea[],
  chunkSize = PADUS_IMPORT_INSERT_CHUNK_SIZE
): Promise<void> {
  for (let start = 0; start < areas.length; start += chunkSize) {
    const chunk = areas.slice(start, start + chunkSize);
    const valuesSql = chunk.map((_, index) => insertRawPartValuesSql(index)).join(",\n");
    const params = chunk.flatMap(insertPartParams);

    await client.query(
      `INSERT INTO padus_area_import_raw_parts (
         group_key, id, name, search_name, kind, designation, manager,
         owner_name, country_code, state_codes, source, source_id,
         source_version, source_record_id, metadata, geometry_json
       ) VALUES
       ${valuesSql}`,
      params
    );
  }
}

function insertGroupValuesSql(rowIndex: number): string {
  const param = (offset: number) => `$${rowIndex * INSERT_GROUP_PARAM_COUNT + offset}`;
  return `(
    ${param(1)}, ${param(2)}, ${param(3)}, ${param(4)}::area_kind, ${param(5)}, ${param(6)}, ${param(7)},
    ${param(8)}::text[], ${param(9)}, ${param(10)}, ${param(11)}, ${param(12)}::jsonb, ${param(13)}::bytea
  )`;
}

function insertGroupParams(area: ComposedPadusArea): unknown[] {
  return [
    area.id,
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
    JSON.stringify(area.metadata),
    multiPolygonToWkb(area.geometry),
  ];
}

async function upsertComposedAreaChunk(
  client: QueryExecutor,
  areas: ComposedPadusArea[],
  repairGeometry: boolean
): Promise<number> {
  if (areas.length === 0) return 0;

  const valuesSql = areas.map((_, index) => insertGroupValuesSql(index)).join(",\n");
  const params = areas.flatMap(insertGroupParams);
  const preparedGeometrySql = repairGeometry
    ? "ST_Multi(ST_CollectionExtract(ST_MakeValid(parsed_geom), 3))"
    : "ST_Multi(ST_CollectionExtract(parsed_geom, 3))";

  const result = await client.query(
    `
      WITH input (
        id, name, search_name, kind, designation, manager, owner_name,
        state_codes, source, source_id, source_version, metadata, geometry_wkb
      ) AS (
        VALUES
        ${valuesSql}
      ),
      parsed AS (
        SELECT
          id, name, search_name, kind, designation, manager, owner_name,
          'US' AS country_code, state_codes, source, source_id, source_version, metadata,
          ST_SetSRID(ST_GeomFromWKB(geometry_wkb), 4326) AS parsed_geom
        FROM input
      ),
      prepared AS (
        SELECT
          id, name, search_name, kind, designation, manager, owner_name,
          country_code, state_codes, source, source_id, source_version, metadata,
          ${preparedGeometrySql} AS geom
        FROM parsed
      ),
      non_empty AS (
        SELECT *
        FROM prepared
        WHERE NOT ST_IsEmpty(geom)
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
        geom,
        ST_SetSRID(ST_MakePoint(
          (ST_XMin(Box2D(geom)) + ST_XMax(Box2D(geom))) / 2,
          (ST_YMin(Box2D(geom)) + ST_YMax(Box2D(geom))) / 2
        ), 4326),
        ST_YMin(Box2D(geom)),
        ST_YMax(Box2D(geom)),
        ST_XMin(Box2D(geom)),
        ST_XMax(Box2D(geom)),
        metadata,
        NOW(), NOW()
      FROM non_empty
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
    `,
    params
  );
  return result.rowCount ?? 0;
}

async function upsertComposedAreas(
  client: QueryExecutor,
  areas: ComposedPadusArea[],
  chunkSize: number,
  trustSourceGeometry: boolean,
  logger: Pick<Console, "log">
): Promise<number> {
  let changedRows = 0;
  const totalChunks = Math.ceil(areas.length / chunkSize);
  const verboseChunks = process.env.PADUS_IMPORT_VERBOSE_CHUNKS === "1";
  for (let start = 0; start < areas.length; start += chunkSize) {
    const chunk = areas.slice(start, start + chunkSize);
    const chunkNumber = Math.floor(start / chunkSize) + 1;
    if (verboseChunks || chunkNumber === 1 || chunkNumber % 50 === 0 || chunkNumber === totalChunks) {
      const firstArea = chunk[0];
      logger.log(`Upserting PAD-US area chunk ${chunkNumber}/${totalChunks}: ${firstArea.name}`);
    }

    if (!trustSourceGeometry) {
      changedRows += await upsertComposedAreaChunk(client, chunk, true);
      continue;
    }

    const savepoint = `padus_area_chunk_${chunkNumber}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      changedRows += await upsertComposedAreaChunk(client, chunk, false);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    } catch {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      logger.log(`Retrying PAD-US area chunk ${chunkNumber} with PostGIS geometry repair`);
      for (const area of chunk) {
        changedRows += await upsertComposedAreaChunk(client, [area], true);
      }
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    }
  }
  return changedRows;
}

async function parseStagedParts(client: QueryExecutor, trustSourceGeometry: boolean): Promise<number> {
  const stagedGeomSql = trustSourceGeometry
    ? "parsed.geom"
    : `CASE
        WHEN ST_IsValid(parsed.geom) THEN parsed.geom
        ELSE ST_MakeValid(parsed.geom)
      END`;

  const result = await client.query(`
    INSERT INTO padus_area_import_parts (
      group_key, id, name, search_name, kind, designation, manager,
      owner_name, country_code, state_codes, source, source_id,
      source_version, source_record_id, metadata, geom
    )
    SELECT
      raw.group_key,
      raw.id,
      raw.name,
      raw.search_name,
      raw.kind,
      raw.designation,
      raw.manager,
      raw.owner_name,
      raw.country_code,
      raw.state_codes,
      raw.source,
      raw.source_id,
      raw.source_version,
      raw.source_record_id,
      raw.metadata,
      ST_Multi(ST_CollectionExtract(${stagedGeomSql}, 3))
    FROM padus_area_import_raw_parts raw
    CROSS JOIN LATERAL (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON(raw.geometry_json), 4326) AS geom
    ) parsed
  `);
  return result.rowCount ?? 0;
}

async function upsertAreas(client: QueryExecutor): Promise<number> {
  const result = await client.query(`
    WITH valid_parts AS (
      SELECT
        group_key,
        id,
        name,
        search_name,
        kind,
        designation,
        manager,
        owner_name,
        state_codes,
        source,
        source_id,
        source_version,
        source_record_id,
        metadata,
        ST_Multi(ST_CollectionExtract(
          CASE
            WHEN ST_IsValid(geom) THEN geom
            ELSE ST_MakeValid(geom)
          END,
          3
        )) AS valid_geom
      FROM padus_area_import_parts
    ),
    dissolved AS (
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
          FROM valid_parts p2, unnest(p2.state_codes) AS code
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
        ST_Multi(ST_CollectionExtract(ST_Collect(valid_geom), 3)) AS geom
      FROM valid_parts p
      WHERE NOT ST_IsEmpty(valid_geom)
      GROUP BY group_key
    ),
    validated AS (
      SELECT
        id, name, search_name, kind, designation, manager, owner_name,
        country_code, state_codes, source, source_id, source_version,
        metadata,
        ST_Multi(ST_CollectionExtract(
          CASE
            WHEN ST_IsValid(geom) THEN geom
            ELSE ST_MakeValid(geom)
          END,
          3
        )) AS validated_geom
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
      geom,
      ST_SetSRID(ST_MakePoint(
        (ST_XMin(Box2D(geom)) + ST_XMax(Box2D(geom))) / 2,
        (ST_YMin(Box2D(geom)) + ST_YMax(Box2D(geom))) / 2
      ), 4326),
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
    WITH grouped AS (
      SELECT
        group_key,
        bool_and(ST_IsEmpty(geom)) AS all_parts_empty
      FROM padus_area_import_parts
      GROUP BY group_key
    )
    SELECT count(*)::int AS empty_geometry_groups
    FROM grouped
    WHERE all_parts_empty
  `);
  const value = result.rows[0]?.empty_geometry_groups ?? 0;
  return typeof value === "number" ? value : parseInt(value, 10);
}

async function linkDestinationBatch(client: QueryExecutor, destinationIds: string[]): Promise<number> {
  if (destinationIds.length === 0) return 0;

  const result = await client.query(
    `
      INSERT INTO destination_areas (destination_id, area_id, relation, source)
      SELECT d.id, a.id, 'contained_by', 'postgis'
      FROM (
        SELECT id, geom, ST_X(geom) AS lng, ST_Y(geom) AS lat
        FROM (
          SELECT id, ST_Force2D(location::geometry) AS geom
          FROM destinations
          WHERE id = ANY($1::text[])
        ) summit_points
      ) d
      JOIN LATERAL (
        SELECT id
        FROM areas a
        WHERE d.lng BETWEEN a.bbox_min_lng AND a.bbox_max_lng
          AND d.lat BETWEEN a.bbox_min_lat AND a.bbox_max_lat
          AND a.boundary && d.geom
          AND ST_Covers(a.boundary, d.geom)
      ) a ON true
      ON CONFLICT (destination_id, area_id) DO NOTHING
    `,
    [destinationIds]
  );
  return result.rowCount ?? 0;
}

async function linkDestinations(
  client: QueryExecutor,
  replaceLinks: boolean,
  logger: Pick<Console, "log">
): Promise<number> {
  if (replaceLinks) {
    await client.query("DELETE FROM destination_areas WHERE source = 'postgis'");
  }

  const summitRows = await client.query<{ id: string }>(`
    SELECT id
    FROM destinations
    WHERE location IS NOT NULL
      AND 'summit'::destination_feature = ANY(features)
    ORDER BY id
  `);

  let inserted = 0;
  const totalBatches = Math.ceil(summitRows.rows.length / LINK_DESTINATION_BATCH_SIZE);
  for (let start = 0; start < summitRows.rows.length; start += LINK_DESTINATION_BATCH_SIZE) {
    const batchNumber = Math.floor(start / LINK_DESTINATION_BATCH_SIZE) + 1;
    const ids = summitRows.rows
      .slice(start, start + LINK_DESTINATION_BATCH_SIZE)
      .map((row) => row.id);
    inserted += await linkDestinationBatch(client, ids);
    if (batchNumber === 1 || batchNumber % 10 === 0 || batchNumber === totalBatches) {
      logger.log(`Linked destination-area batch ${batchNumber}/${totalBatches}`);
    }
  }

  return inserted;
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

    const groups = new Map<string, AreaGroupAccumulator>();
    const audit = await scanInputFeatures(args.input, args.sourceVersion, readFile, async (area) => {
      recordGroupedArea(groups, area);
    });
    logImportAudit(logger, audit);

    const composedAreas = composeAreaGroups(groups);
    logger.log(`Prepared PAD-US logical area geometries: ${composedAreas.length}`);

    const upserted = await upsertComposedAreas(
      client,
      composedAreas,
      args.insertChunkSize,
      args.trustSourceGeometry,
      logger
    );
    logger.log(`Upserted inserted or changed areas: ${upserted}`);

    if (args.linkDestinations) {
      const linked = await linkDestinations(client, args.replaceLinks, logger);
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
