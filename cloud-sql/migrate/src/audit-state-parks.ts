/**
 * Read-only, destination-first audit of lower-48 summits against USGS PAD-US
 * state parks. The only database writes are temporary tables rolled back at
 * the end of the spatial check.
 *
 * Examples:
 *   npm run audit:state-parks
 *   npm run audit:state-parks -- --state=NC --format=json
 *   npm run audit:state-parks -- --geojson-output=/tmp/state-parks.geojson \
 *     --report-output=/tmp/state-parks-report.json
 */

import fs from "node:fs/promises";
import type { PoolClient } from "pg";
import db from "./db";
import { AREA_LINK_TOLERANCE_M } from "./import-padus-areas";
import {
  normalizePadusFeature,
  type GeoJsonFeature,
} from "./padus-area-utils";

const PADUS_ENDPOINT =
  "https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/0/query";
const PADUS_SOURCE_VERSION = "4.1";
const DEFAULT_BATCH_SIZE = 200;
const FEATURE_BATCH_SIZE = 100;
const STAGING_BATCH_SIZE = 25;
const CANDIDATE_PAIR_BATCH_SIZE = 1_000;
const REQUEST_TIMEOUT_MS = 120_000;
// Keep this conservative planar gate in sync with the production importer. It
// only narrows index candidates; the geography check below enforces 50 metres.
const AREA_LINK_GATE_DEG = AREA_LINK_TOLERANCE_M / 30_000;
const LOWER_48_STATE_CODES = [
  "AL", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "ID", "IL", "IN",
  "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;

type OutputFormat = "summary" | "json";

export interface StateParkAuditArgs {
  stateCode: string | null;
  format: OutputFormat;
  batchSize: number;
  geojsonOutput: string | null;
  reportOutput: string | null;
}

interface SummitRow {
  id: string;
  name: string | null;
  state_code: string;
  prominence_m: string | number | null;
  lat: string | number;
  lng: string | number;
}

export interface SummitPoint {
  id: string;
  name: string;
  stateCode: string;
  prominenceM: number | null;
  lat: number;
  lng: number;
}

interface ArcGisIdsResponse {
  objectIds?: unknown;
  error?: { message?: unknown; details?: unknown };
}

interface ArcGisGeoJsonResponse {
  type?: unknown;
  features?: unknown;
  exceededTransferLimit?: unknown;
  error?: { message?: unknown; details?: unknown };
}

interface SpatialMatchRow {
  destination_id: string;
  object_id: string | number;
  area_id: string;
  covers: boolean;
  distance_m: string | number;
}

interface CandidateDiscovery {
  objectIds: number[];
  destinationIdsByObjectId: Map<number, Set<string>>;
}

interface CatalogAreaRow {
  id: string;
}

interface DestinationHealthRow {
  id: string;
  name: string | null;
  state_code: string;
  prominence_m: string | number | null;
  has_cover: boolean;
  has_cover_credit: boolean;
  active_route_count: string | number;
  route_with_trailhead_count: string | number;
  linked_state_parks: unknown;
}

interface ExistingParkLink {
  id: string;
  name: string;
}

export interface AuditPark {
  areaId: string;
  name: string;
  stateCodes: string[];
  sourcePaid: string | null;
  sourceFeatureCount: number;
  presentInCatalog: boolean;
}

export interface AuditDestinationPark {
  areaId: string;
  name: string;
  distanceM: number;
  covers: boolean;
  linked: boolean;
}

export interface AuditDestination {
  id: string;
  name: string;
  stateCode: string;
  prominenceM: number | null;
  isUltra: boolean;
  hasCover: boolean;
  hasCoverCredit: boolean;
  hasStandardRoute: boolean;
  hasRouteTrailhead: boolean;
  parks: AuditDestinationPark[];
}

export interface StateParkAuditReport {
  source: {
    name: "USGS PAD-US";
    version: "4.1";
    endpoint: string;
    designation: "SP";
    toleranceM: number;
  };
  scope: {
    stateCode: string | null;
    summitCount: number;
    ultraCount: number;
    stateCount: number;
  };
  summary: {
    candidateFeatureCount: number;
    relevantParkCount: number;
    matchedSummitCount: number;
    matchedUltraCount: number;
    parksMissingFromCatalog: number;
    parkLinksMissing: number;
    matchedUltrasMissingCover: number;
    matchedUltrasMissingCoverCredit: number;
    matchedUltrasMissingStandardRoute: number;
    matchedUltrasMissingRouteTrailhead: number;
  };
  parks: AuditPark[];
  destinations: AuditDestination[];
}

interface QueryResult<T> {
  rows: T[];
}

interface AuditDatabase {
  query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

export interface StateParkAuditDependencies {
  db?: AuditDatabase;
  fetch?: typeof fetch;
  console?: Pick<Console, "log" | "error">;
}

function valueFor(argv: string[], key: string): string | null {
  const prefix = `--${key}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

export function parseStateParkAuditArgs(
  argv = process.argv.slice(2)
): StateParkAuditArgs {
  const stateCode = valueFor(argv, "state")?.toUpperCase() ?? null;
  if (stateCode && !LOWER_48_STATE_CODES.includes(stateCode as typeof LOWER_48_STATE_CODES[number])) {
    throw new Error("--state must be a two-letter lower-48 state code");
  }

  const format = (valueFor(argv, "format") ?? "summary") as OutputFormat;
  if (format !== "summary" && format !== "json") {
    throw new Error("--format must be summary or json");
  }

  const batchSize = Number.parseInt(
    valueFor(argv, "batch-size") ?? String(DEFAULT_BATCH_SIZE),
    10
  );
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("--batch-size must be a whole number from 1 to 500");
  }

  const allowed = new Set([
    "state", "format", "batch-size", "geojson-output", "report-output",
  ]);
  const unknown = argv.find((arg) => {
    const match = /^--([^=]+)=/.exec(arg);
    return !match || !allowed.has(match[1]);
  });
  if (unknown) throw new Error(`Unknown argument: ${unknown}`);

  return {
    stateCode,
    format,
    batchSize,
    geojsonOutput: valueFor(argv, "geojson-output"),
    reportOutput: valueFor(argv, "report-output"),
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    out.push(items.slice(offset, offset + size));
  }
  return out;
}

function arcGisWhereLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildStateParkDiscoveryParams(
  stateCode: string,
  summits: SummitPoint[]
): URLSearchParams {
  if (summits.length === 0) throw new Error("Discovery requires at least one summit");
  return new URLSearchParams({
    where: `Des_Tp='SP' AND State_Nm=${arcGisWhereLiteral(stateCode)}`,
    geometry: JSON.stringify({
      points: summits.map((summit) => [summit.lng, summit.lat]),
      spatialReference: { wkid: 4326 },
    }),
    geometryType: "esriGeometryMultipoint",
    spatialRel: "esriSpatialRelIntersects",
    inSR: "4326",
    distance: String(AREA_LINK_TOLERANCE_M),
    units: "esriSRUnit_Meter",
    returnIdsOnly: "true",
    f: "json",
  });
}

export function buildStateParkFeatureParams(objectIds: number[]): URLSearchParams {
  if (objectIds.length === 0) throw new Error("Feature query requires object IDs");
  return new URLSearchParams({
    objectIds: objectIds.join(","),
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  });
}

export function parseArcGisObjectIds(
  payload: ArcGisIdsResponse,
  stateCode: string
): number[] {
  if (payload.objectIds === null) return [];
  if (!Array.isArray(payload.objectIds)) {
    throw new Error(`PAD-US ${stateCode} response has no objectIds array`);
  }
  return payload.objectIds.map((value) => {
    const objectId = Number(value);
    if (!Number.isInteger(objectId) || objectId <= 0) {
      throw new Error(`PAD-US returned an invalid OBJECTID for ${stateCode}`);
    }
    return objectId;
  });
}

export function buildLogicalParkWhere(features: GeoJsonFeature[]): string[] {
  const sourcePaidByState = new Map<string, Set<string>>();
  const fallbackObjectIds: number[] = [];

  for (const feature of features) {
    const props = feature.properties ?? {};
    const stateCode = String(props.State_Nm ?? "").trim().toUpperCase();
    const sourcePaid = String(props.Source_PAID ?? "").trim();
    const objectId = Number(props.OBJECTID);
    if (stateCode && sourcePaid) {
      const values = sourcePaidByState.get(stateCode) ?? new Set<string>();
      values.add(sourcePaid);
      sourcePaidByState.set(stateCode, values);
    } else if (Number.isInteger(objectId) && objectId > 0) {
      fallbackObjectIds.push(objectId);
    } else {
      throw new Error("Matched PAD-US feature lacks Source_PAID and OBJECTID");
    }
  }

  const clauses: string[] = [];
  for (const [stateCode, values] of Array.from(sourcePaidByState.entries()).sort()) {
    for (const batch of chunks(Array.from(values).sort(), 40)) {
      clauses.push(
        `Des_Tp='SP' AND State_Nm=${arcGisWhereLiteral(stateCode)} AND ` +
        `Source_PAID IN (${batch.map(arcGisWhereLiteral).join(",")})`
      );
    }
  }
  for (const batch of chunks(fallbackObjectIds.sort((a, b) => a - b), FEATURE_BATCH_SIZE)) {
    clauses.push(`OBJECTID IN (${batch.join(",")})`);
  }
  return clauses;
}

function parseNumber(value: string | number | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSummits(rows: SummitRow[]): SummitPoint[] {
  return rows.map((row) => {
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error(`Invalid catalog coordinates for ${row.id}`);
    }
    return {
      id: row.id,
      name: row.name?.trim() || row.id,
      stateCode: row.state_code,
      prominenceM: parseNumber(row.prominence_m),
      lat,
      lng,
    };
  });
}

function arcGisError(payload: { error?: { message?: unknown; details?: unknown } }): Error | null {
  if (!payload.error) return null;
  const message = String(payload.error.message ?? "Unknown ArcGIS error");
  const details = Array.isArray(payload.error.details)
    ? payload.error.details.map(String).join("; ")
    : "";
  return new Error(`PAD-US ArcGIS error: ${message}${details ? ` (${details})` : ""}`);
}

async function fetchPadus(
  params: URLSearchParams,
  fetchImpl: typeof fetch,
  logger: Pick<Console, "error">
): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(PADUS_ENDPOINT, {
        method: "POST",
        body: params,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "PeaksApp-state-park-audit/1.0 (https://github.com/jhmacdon/peaks-firebase)",
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`PAD-US HTTP ${response.status}`);
      const payload = await response.json() as { error?: { message?: unknown; details?: unknown } };
      const serviceError = arcGisError(payload);
      if (serviceError) throw serviceError;
      return payload;
    } catch (error) {
      lastError = error;
      logger.error(`[state-park-audit] PAD-US request failed (attempt ${attempt}/3)`);
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("PAD-US request failed");
}

async function discoverCandidateObjectIds(
  summits: SummitPoint[],
  batchSize: number,
  fetchImpl: typeof fetch,
  logger: Pick<Console, "error">
): Promise<CandidateDiscovery> {
  const byState = new Map<string, SummitPoint[]>();
  for (const summit of summits) {
    const stateSummits = byState.get(summit.stateCode) ?? [];
    stateSummits.push(summit);
    byState.set(summit.stateCode, stateSummits);
  }

  const objectIds = new Set<number>();
  const destinationIdsByObjectId = new Map<number, Set<string>>();
  for (const [stateCode, stateSummits] of Array.from(byState.entries()).sort()) {
    const batches = chunks(stateSummits, batchSize);
    logger.error(
      `[state-park-audit] ${stateCode}: checking ${stateSummits.length} summit(s) in ${batches.length} batch(es)`
    );
    for (const batch of batches) {
      const payload = await fetchPadus(
        buildStateParkDiscoveryParams(stateCode, batch),
        fetchImpl,
        logger
      ) as ArcGisIdsResponse;
      for (const objectId of parseArcGisObjectIds(payload, stateCode)) {
        objectIds.add(objectId);
        const destinationIds = destinationIdsByObjectId.get(objectId) ?? new Set<string>();
        for (const summit of batch) destinationIds.add(summit.id);
        destinationIdsByObjectId.set(objectId, destinationIds);
      }
    }
  }
  return {
    objectIds: Array.from(objectIds).sort((a, b) => a - b),
    destinationIdsByObjectId,
  };
}

function parseGeoJsonResponse(payload: ArcGisGeoJsonResponse): GeoJsonFeature[] {
  if (payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
    throw new Error("PAD-US response is not a GeoJSON FeatureCollection");
  }
  if (payload.exceededTransferLimit === true) {
    throw new Error("PAD-US response exceeded its record limit");
  }
  return payload.features as GeoJsonFeature[];
}

async function fetchFeaturesByObjectId(
  objectIds: number[],
  fetchImpl: typeof fetch,
  logger: Pick<Console, "error">
): Promise<GeoJsonFeature[]> {
  const features: GeoJsonFeature[] = [];
  for (const batch of chunks(objectIds, FEATURE_BATCH_SIZE)) {
    const payload = await fetchPadus(buildStateParkFeatureParams(batch), fetchImpl, logger);
    features.push(...parseGeoJsonResponse(payload as ArcGisGeoJsonResponse));
  }
  return features;
}

async function fetchFeaturesByWhere(
  clauses: string[],
  fetchImpl: typeof fetch,
  logger: Pick<Console, "error">
): Promise<GeoJsonFeature[]> {
  const byObjectId = new Map<number, GeoJsonFeature>();
  for (const where of clauses) {
    let offset = 0;
    while (true) {
      const params = new URLSearchParams({
        where,
        outFields: "*",
        returnGeometry: "true",
        outSR: "4326",
        orderByFields: "OBJECTID",
        resultOffset: String(offset),
        resultRecordCount: "1000",
        f: "geojson",
      });
      const payload = await fetchPadus(params, fetchImpl, logger) as ArcGisGeoJsonResponse;
      const page = parseGeoJsonResponse({ ...payload, exceededTransferLimit: false });
      for (const feature of page) {
        const objectId = Number(feature.properties?.OBJECTID);
        if (!Number.isInteger(objectId) || objectId <= 0) {
          throw new Error("PAD-US feature has an invalid OBJECTID");
        }
        byObjectId.set(objectId, feature);
      }
      if (page.length < 1000 && payload.exceededTransferLimit !== true) break;
      offset += page.length;
      if (page.length === 0) throw new Error("PAD-US pagination stopped making progress");
    }
  }
  return Array.from(byObjectId.values()).sort(
    (left, right) => Number(left.properties?.OBJECTID) - Number(right.properties?.OBJECTID)
  );
}

async function exactSpatialMatches(
  client: PoolClient,
  features: GeoJsonFeature[],
  destinationIdsByObjectId: Map<number, Set<string>>
): Promise<SpatialMatchRow[]> {
  const stagedFeatures = features.map((feature) => {
    const normalized = normalizePadusFeature(feature, PADUS_SOURCE_VERSION);
    const objectId = Number(feature.properties?.OBJECTID);
    const stateCode = normalized?.stateCodes[0];
    if (!normalized || normalized.kind !== "state_park" || !stateCode) {
      throw new Error(`PAD-US OBJECTID ${objectId} did not normalize as a state park`);
    }
    return {
      object_id: objectId,
      area_id: normalized.sourceId,
      state_code: stateCode,
      geometry: feature.geometry,
    };
  });
  const candidatePairs = Array.from(destinationIdsByObjectId.entries()).flatMap(
    ([objectId, destinationIds]) => Array.from(destinationIds).map((destinationId) => ({
      object_id: objectId,
      destination_id: destinationId,
    }))
  );

  await client.query("BEGIN");
  try {
    await client.query(`CREATE TEMP TABLE audit_state_park_features (
      object_id BIGINT PRIMARY KEY,
      area_id TEXT NOT NULL,
      state_code TEXT NOT NULL,
      geom geometry(MultiPolygon, 4326) NOT NULL
    ) ON COMMIT DROP`);
    await client.query(`CREATE TEMP TABLE audit_state_park_candidates (
      object_id BIGINT NOT NULL,
      destination_id TEXT NOT NULL,
      PRIMARY KEY (object_id, destination_id)
    ) ON COMMIT DROP`);

    for (const batch of chunks(stagedFeatures, STAGING_BATCH_SIZE)) {
      await client.query(
        `INSERT INTO audit_state_park_features (object_id, area_id, state_code, geom)
         SELECT input.object_id, input.area_id, input.state_code,
                ST_Multi(ST_CollectionExtract(
                  CASE
                    WHEN ST_IsValid(parsed.geom) THEN parsed.geom
                    ELSE ST_MakeValid(parsed.geom)
                  END,
                  3
                ))
         FROM JSONB_TO_RECORDSET($1::jsonb) AS input (
           object_id BIGINT,
           area_id TEXT,
           state_code TEXT,
           geometry JSONB
         )
         CROSS JOIN LATERAL (
           SELECT ST_SetSRID(ST_GeomFromGeoJSON(input.geometry::text), 4326) AS geom
         ) parsed`,
        [JSON.stringify(batch)]
      );
    }
    for (const batch of chunks(candidatePairs, CANDIDATE_PAIR_BATCH_SIZE)) {
      await client.query(
        `INSERT INTO audit_state_park_candidates (object_id, destination_id)
         SELECT input.object_id, input.destination_id
         FROM JSONB_TO_RECORDSET($1::jsonb) AS input (
           object_id BIGINT,
           destination_id TEXT
         )
         ON CONFLICT DO NOTHING`,
        [JSON.stringify(batch)]
      );
    }
    await client.query("CREATE INDEX ON audit_state_park_features USING GIST (geom)");
    await client.query(
      "CREATE INDEX ON audit_state_park_candidates (destination_id, object_id)"
    );

    const result = await client.query<SpatialMatchRow>(
      `SELECT d.id AS destination_id,
              f.object_id,
              f.area_id,
              ST_Covers(f.geom, d.location::geometry) AS covers,
              ST_Distance(f.geom::geography, d.location) AS distance_m
       FROM audit_state_park_candidates candidate
       JOIN audit_state_park_features f ON f.object_id = candidate.object_id
       JOIN destinations d ON d.id = candidate.destination_id
       WHERE d.location IS NOT NULL
         AND f.geom && ST_Expand(d.location::geometry, $2)
         AND (
          ST_Covers(f.geom, d.location::geometry)
          OR ST_DWithin(f.geom::geography, d.location, $1)
         )
       ORDER BY d.id, f.area_id, f.object_id`,
      [AREA_LINK_TOLERANCE_M, AREA_LINK_GATE_DEG]
    );
    await client.query("ROLLBACK");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function sourcePaid(feature: GeoJsonFeature): string | null {
  const value = String(feature.properties?.Source_PAID ?? "").trim();
  return value || null;
}

function existingLinks(value: unknown): ExistingParkLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const id = String(record.id ?? "").trim();
    const name = String(record.name ?? "").trim();
    return id && name ? [{ id, name }] : [];
  });
}

function printSummary(report: StateParkAuditReport, logger: Pick<Console, "log">): void {
  logger.log(`Lower-48 summits audited: ${report.scope.summitCount}`);
  logger.log(`Ultra-prominent summits audited: ${report.scope.ultraCount}`);
  logger.log(`PAD-US state-park candidate features: ${report.summary.candidateFeatureCount}`);
  logger.log(`Relevant state parks: ${report.summary.relevantParkCount}`);
  logger.log(`Summits matched to a state park: ${report.summary.matchedSummitCount}`);
  logger.log(`Ultra-prominent summits matched: ${report.summary.matchedUltraCount}`);
  logger.log(`Relevant parks missing from catalog: ${report.summary.parksMissingFromCatalog}`);
  logger.log(`Summit-to-park links missing: ${report.summary.parkLinksMissing}`);
  logger.log(`Matched ultras missing covers: ${report.summary.matchedUltrasMissingCover}`);
  logger.log(`Matched ultras missing cover credit: ${report.summary.matchedUltrasMissingCoverCredit}`);
  logger.log(`Matched ultras missing standard routes: ${report.summary.matchedUltrasMissingStandardRoute}`);
  logger.log(`Matched ultras missing route-linked trailheads: ${report.summary.matchedUltrasMissingRouteTrailhead}`);
}

export async function auditStateParks(
  args: StateParkAuditArgs,
  dependencies: StateParkAuditDependencies = {}
): Promise<StateParkAuditReport> {
  const database = dependencies.db ?? db;
  const fetchImpl = dependencies.fetch ?? fetch;
  const logger = dependencies.console ?? console;
  const states = args.stateCode ? [args.stateCode] : [...LOWER_48_STATE_CODES];

  try {
    const summitResult = await database.query<SummitRow>(
      `SELECT id,
              name,
              state_code,
              prominence AS prominence_m,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lng
       FROM destinations
       WHERE country_code = 'US'
         AND state_code = ANY($1::text[])
         AND 'summit'::destination_feature = ANY(features)
         AND location IS NOT NULL
       ORDER BY state_code, id`,
      [states]
    );
    const summits = parseSummits(summitResult.rows);
    const discovery = await discoverCandidateObjectIds(
      summits,
      args.batchSize,
      fetchImpl,
      logger
    );
    const candidateObjectIds = discovery.objectIds;
    logger.error(
      `[state-park-audit] fetching ${candidateObjectIds.length} candidate feature(s)`
    );
    const candidateFeatures = await fetchFeaturesByObjectId(
      candidateObjectIds,
      fetchImpl,
      logger
    );

    logger.error("[state-park-audit] running exact PostGIS matches");
    const client = await database.connect();
    let matches: SpatialMatchRow[];
    try {
      matches = await exactSpatialMatches(
        client,
        candidateFeatures,
        discovery.destinationIdsByObjectId
      );
    } finally {
      client.release();
    }

    const featureByObjectId = new Map(
      candidateFeatures.map((feature) => [Number(feature.properties?.OBJECTID), feature])
    );
    const matchedCandidateFeatures = Array.from(new Set(matches.map((match) => Number(match.object_id))))
      .map((objectId) => featureByObjectId.get(objectId))
      .filter((feature): feature is GeoJsonFeature => feature != null);
    const relevantAreaIds = new Set(matches.map((match) => match.area_id));
    logger.error(
      `[state-park-audit] ${matches.length} exact feature match(es); fetching full geometry for ` +
      `${relevantAreaIds.size} park(s)`
    );
    const fullFeatures = (await fetchFeaturesByWhere(
      buildLogicalParkWhere(matchedCandidateFeatures),
      fetchImpl,
      logger
    )).filter((feature) => {
      const normalized = normalizePadusFeature(feature, PADUS_SOURCE_VERSION);
      return normalized != null && relevantAreaIds.has(normalized.sourceId);
    });

    const relevantFeatureCount = new Map<string, number>();
    const parkByAreaId = new Map<string, ReturnType<typeof normalizePadusFeature>>();
    for (const feature of fullFeatures) {
      const normalized = normalizePadusFeature(feature, PADUS_SOURCE_VERSION);
      if (!normalized) continue;
      parkByAreaId.set(normalized.sourceId, normalized);
      relevantFeatureCount.set(
        normalized.sourceId,
        (relevantFeatureCount.get(normalized.sourceId) ?? 0) + 1
      );
    }

    const areaResult = relevantAreaIds.size === 0
      ? { rows: [] as CatalogAreaRow[] }
      : await database.query<CatalogAreaRow>(
        "SELECT id FROM areas WHERE id = ANY($1::text[])",
        [Array.from(relevantAreaIds)]
      );
    const catalogAreaIds = new Set(areaResult.rows.map((row) => row.id));
    const destinationIds = Array.from(new Set(matches.map((match) => match.destination_id)));
    const healthResult = destinationIds.length === 0
      ? { rows: [] as DestinationHealthRow[] }
      : await database.query<DestinationHealthRow>(
        `SELECT d.id,
                d.name,
                d.state_code,
                d.prominence AS prominence_m,
                d.hero_image IS NOT NULL AS has_cover,
                d.hero_image IS NOT NULL
                  AND d.hero_image_attribution IS NOT NULL
                  AND d.hero_image_attribution_url IS NOT NULL AS has_cover_credit,
                COALESCE(routes.active_route_count, 0) AS active_route_count,
                COALESCE(routes.route_with_trailhead_count, 0) AS route_with_trailhead_count,
                COALESCE(parks.linked_state_parks, '[]'::jsonb) AS linked_state_parks
         FROM destinations d
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT r.id) FILTER (
                    WHERE r.owner = 'peaks' AND r.status = 'active'
                  ) AS active_route_count,
                  COUNT(DISTINCT r.id) FILTER (
                    WHERE r.owner = 'peaks'
                      AND r.status = 'active'
                      AND EXISTS (
                        SELECT 1
                        FROM route_destinations trailhead_link
                        JOIN destinations trailhead
                          ON trailhead.id = trailhead_link.destination_id
                        WHERE trailhead_link.route_id = r.id
                          AND 'trailhead'::destination_feature = ANY(trailhead.features)
                      )
                  ) AS route_with_trailhead_count
           FROM route_destinations summit_link
           JOIN routes r ON r.id = summit_link.route_id
           WHERE summit_link.destination_id = d.id
         ) routes ON true
         LEFT JOIN LATERAL (
           SELECT JSONB_AGG(
                    JSONB_BUILD_OBJECT('id', a.id, 'name', a.name)
                    ORDER BY a.name, a.id
                  ) AS linked_state_parks
           FROM destination_areas da
           JOIN areas a ON a.id = da.area_id
           WHERE da.destination_id = d.id
             AND a.kind::text = 'state_park'
         ) parks ON true
         WHERE d.id = ANY($1::text[])
         ORDER BY d.name, d.id`,
        [destinationIds]
      );

    const matchesByDestination = new Map<string, SpatialMatchRow[]>();
    for (const match of matches) {
      const rows = matchesByDestination.get(match.destination_id) ?? [];
      if (!rows.some((row) => row.area_id === match.area_id)) rows.push(match);
      matchesByDestination.set(match.destination_id, rows);
    }

    const destinations: AuditDestination[] = healthResult.rows.map((row) => {
      const linked = new Set(existingLinks(row.linked_state_parks).map((park) => park.id));
      const prominenceM = parseNumber(row.prominence_m);
      const parks = (matchesByDestination.get(row.id) ?? []).map((match) => {
        const park = parkByAreaId.get(match.area_id);
        return {
          areaId: match.area_id,
          name: park?.name ?? match.area_id,
          distanceM: Number(match.distance_m),
          covers: match.covers,
          linked: linked.has(match.area_id),
        };
      }).sort((left, right) => left.name.localeCompare(right.name));
      return {
        id: row.id,
        name: row.name?.trim() || row.id,
        stateCode: row.state_code,
        prominenceM,
        isUltra: prominenceM != null && prominenceM >= 1500,
        hasCover: row.has_cover,
        hasCoverCredit: row.has_cover_credit,
        hasStandardRoute: Number(row.active_route_count) > 0,
        hasRouteTrailhead: Number(row.route_with_trailhead_count) > 0,
        parks,
      };
    }).sort((left, right) => left.name.localeCompare(right.name));

    const parks: AuditPark[] = Array.from(relevantAreaIds).map((areaId) => {
      const park = parkByAreaId.get(areaId);
      if (!park) throw new Error(`Full PAD-US geometry missing for ${areaId}`);
      const exampleFeature = fullFeatures.find((feature) =>
        normalizePadusFeature(feature, PADUS_SOURCE_VERSION)?.sourceId === areaId
      );
      return {
        areaId,
        name: park.name,
        stateCodes: park.stateCodes,
        sourcePaid: exampleFeature ? sourcePaid(exampleFeature) : null,
        sourceFeatureCount: relevantFeatureCount.get(areaId) ?? 0,
        presentInCatalog: catalogAreaIds.has(areaId),
      };
    }).sort((left, right) => left.name.localeCompare(right.name));

    const ultras = summits.filter((summit) => (summit.prominenceM ?? 0) >= 1500);
    const matchedUltras = destinations.filter((destination) => destination.isUltra);
    const report: StateParkAuditReport = {
      source: {
        name: "USGS PAD-US",
        version: PADUS_SOURCE_VERSION,
        endpoint: PADUS_ENDPOINT,
        designation: "SP",
        toleranceM: AREA_LINK_TOLERANCE_M,
      },
      scope: {
        stateCode: args.stateCode,
        summitCount: summits.length,
        ultraCount: ultras.length,
        stateCount: new Set(summits.map((summit) => summit.stateCode)).size,
      },
      summary: {
        candidateFeatureCount: candidateFeatures.length,
        relevantParkCount: parks.length,
        matchedSummitCount: destinations.length,
        matchedUltraCount: matchedUltras.length,
        parksMissingFromCatalog: parks.filter((park) => !park.presentInCatalog).length,
        parkLinksMissing: destinations.reduce(
          (count, destination) => count + destination.parks.filter((park) => !park.linked).length,
          0
        ),
        matchedUltrasMissingCover: matchedUltras.filter((destination) => !destination.hasCover).length,
        matchedUltrasMissingCoverCredit: matchedUltras.filter(
          (destination) => destination.hasCover && !destination.hasCoverCredit
        ).length,
        matchedUltrasMissingStandardRoute: matchedUltras.filter(
          (destination) => !destination.hasStandardRoute
        ).length,
        matchedUltrasMissingRouteTrailhead: matchedUltras.filter(
          (destination) => !destination.hasRouteTrailhead
        ).length,
      },
      parks,
      destinations,
    };

    if (args.geojsonOutput) {
      await fs.writeFile(
        args.geojsonOutput,
        `${JSON.stringify({ type: "FeatureCollection", features: fullFeatures })}\n`,
        "utf8"
      );
    }
    if (args.reportOutput) {
      await fs.writeFile(args.reportOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    if (args.format === "json") logger.log(JSON.stringify(report, null, 2));
    else printSummary(report, logger);
    return report;
  } finally {
    await database.end();
  }
}

if (require.main === module) {
  let args: StateParkAuditArgs;
  try {
    args = parseStateParkAuditArgs();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }
  auditStateParks(args).catch((error) => {
    console.error("State-park audit failed:", error);
    process.exitCode = 1;
  });
}
