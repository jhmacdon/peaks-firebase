/**
 * Audits and optionally expands the named lake catalog from OpenStreetMap.
 *
 * The source gate is intentionally narrow: natural=water + water=lake + name.
 * Dry-run is the default. Apply requires the exact reviewed dry-run report and
 * its SHA-256, and never deletes or replaces an existing destination.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import db from "./db";
import { lookupElevation } from "./lib/terrarium-elevation";
import {
  LakeDestinationPoint,
  OsmLakeCandidate,
  buildLakeExternalIds,
  deterministicLakeDestinationId,
  matchExactNameProximity,
  normalizeLakeName,
  osmExternalIdField,
  osmIdentityKey,
  parseElevationMeters,
  parseOsmWaterLakeElements,
} from "./osm-lake-coverage";
import { US_STATE_CODES } from "./peak-coverage-jurisdictions";

const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const PROXIMITY_MATCH_METERS = 200;
const ELEVATION_CONCURRENCY = 8;
const GEOMETRY_CHUNK_SIZE = 200;
const INSERT_CHUNK_SIZE = 25;
const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
const OSM_LICENSE_URL = "https://www.openstreetmap.org/copyright";

interface LakeScope {
  key: string;
  stateCode: string;
  countryCode: "US";
}

export interface LakeExpansionArgs {
  scopes: LakeScope[];
  apply: boolean;
  concurrency: number;
  cacheDir: string | null;
  reportDir: string | null;
  input: string | null;
  reviewReport: string | null;
  expectedReportSha256: string | null;
}

interface OverpassSnapshot {
  payload: unknown;
  rawSha256: string;
  osmTimestamp: string | null;
  querySha256: string;
  sourceFile: string | null;
}

interface PreparedGeometry {
  identity: string;
  boundaryGeoJson: string | null;
  lat: number;
  lng: number;
  polygonCount: number;
  geometryStatus: "boundary" | "point_fallback";
}

interface PreparedCandidate extends OsmLakeCandidate, PreparedGeometry {}

interface ExistingLake extends LakeDestinationPoint {
  id: string;
  type: string;
  stateCode: string | null;
  countryCode: string | null;
  externalIds: Record<string, unknown>;
  hasBoundary: boolean;
}

interface LakeAddition extends PreparedCandidate {
  destinationId: string;
  elevation: number;
  elevationSource: "osm" | "terrarium";
  searchName: string;
  externalIds: Record<string, string>;
}

interface LakeBackfill {
  identity: string;
  osmType: OsmLakeCandidate["osmType"];
  osmId: string;
  candidateName: string;
  destinationId: string;
  destinationName: string;
  distanceMeters: number;
}

interface LakeAmbiguity {
  identity: string;
  name: string;
  reason: "duplicate_external_id" | "multiple_legacy_matches" | "multiple_osm_candidates_for_destination";
  destinationIds: string[];
}

interface LakePlan {
  additions: LakeAddition[];
  backfills: LakeBackfill[];
  ambiguities: LakeAmbiguity[];
  exactMatches: Array<{ identity: string; destinationId: string }>;
  elevationFailures: Array<{ identity: string; name: string }>;
  decisionFingerprint: string;
}

interface AppliedChanges {
  inserted: Array<{ id: string; identity: string }>;
  backfilled: Array<{ destinationId: string; identity: string }>;
}

const optionValue = (argv: string[], name: string) =>
  argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

function parseStateCodes(raw: string | undefined, option: string): string[] {
  if (!raw) throw new Error(`--${option} requires a comma-separated value`);
  const valid = new Set<string>(US_STATE_CODES);
  const codes = raw.split(",").map((code) => code.trim().toUpperCase()).filter(Boolean);
  if (codes.length === 0 || codes.some((code) => !valid.has(code))) {
    throw new Error(`--${option} must contain valid two-letter US state codes`);
  }
  return [...new Set(codes)];
}

function scopeForState(stateCode: string): LakeScope {
  return { key: `US-${stateCode}`, stateCode, countryCode: "US" };
}

export function parseLakeExpansionArgs(argv = process.argv.slice(2)): LakeExpansionArgs {
  const modes = [
    optionValue(argv, "state") != null,
    optionValue(argv, "states") != null,
    argv.includes("--all-states"),
  ].filter(Boolean).length;
  if (modes !== 1) {
    throw new Error("Choose exactly one of --state, --states, or --all-states");
  }

  const scopes = optionValue(argv, "state")
    ? parseStateCodes(optionValue(argv, "state"), "state").map(scopeForState)
    : optionValue(argv, "states")
      ? parseStateCodes(optionValue(argv, "states"), "states").map(scopeForState)
      : US_STATE_CODES.map(scopeForState);
  const concurrency = Number.parseInt(optionValue(argv, "concurrency") ?? "1", 10);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error("--concurrency must be an integer from 1 to 4");
  }

  const apply = argv.includes("--apply");
  const input = optionValue(argv, "input") ?? null;
  const reviewReport = optionValue(argv, "review-report") ?? null;
  const expectedReportSha256 = optionValue(argv, "expected-report-sha256")?.toLowerCase() ?? null;
  if (input && scopes.length !== 1) throw new Error("--input requires exactly one state");
  if (apply && scopes.length !== 1) throw new Error("Apply one state at a time");
  if (apply && (!reviewReport || !expectedReportSha256)) {
    throw new Error("--apply requires --review-report and --expected-report-sha256");
  }
  if (expectedReportSha256 && !/^[0-9a-f]{64}$/.test(expectedReportSha256)) {
    throw new Error("--expected-report-sha256 must be a 64-character lowercase SHA-256");
  }

  return {
    scopes,
    apply,
    concurrency,
    cacheDir: optionValue(argv, "cache-dir") ?? null,
    reportDir: optionValue(argv, "report-dir") ?? null,
    input,
    reviewReport,
    expectedReportSha256,
  };
}

export function buildLakeOverpassQuery(stateCode: string): string {
  return `[out:json][timeout:240];
area["ISO3166-2"="US-${stateCode}"]["boundary"="administrative"]->.region;
nwr["natural"="water"]["water"="lake"]["name"](area.region);
out body geom qt;`;
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readOsmTimestamp(payload: unknown): string | null {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const osm3s = (payload as Record<string, unknown>).osm3s;
  if (osm3s == null || typeof osm3s !== "object" || Array.isArray(osm3s)) return null;
  const timestamp = (osm3s as Record<string, unknown>).timestamp_osm_base;
  return typeof timestamp === "string" ? timestamp : null;
}

async function fetchOverpass(query: string): Promise<string> {
  const configured = process.env.OVERPASS_ENDPOINT?.trim();
  const endpoints = configured
    ? [configured, ...OVERPASS_ENDPOINTS.filter((endpoint) => endpoint !== configured)]
    : OVERPASS_ENDPOINTS;
  let lastError: unknown = null;

  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 270_000);
      try {
        console.error(`[lake-expand] fetching ${endpoint} (attempt ${attempt + 1})`);
        const response = await fetch(endpoint, {
          method: "POST",
          body: `data=${encodeURIComponent(query)}`,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "PeaksApp-lake-coverage/1.0 (https://github.com/jhmacdon/peaks-firebase)",
          },
          signal: controller.signal,
        });
        if (response.ok) {
          const raw = await response.text();
          const parsed = JSON.parse(raw) as { elements?: unknown[]; remark?: string };
          if (parsed.remark) throw new Error(`Overpass error: ${parsed.remark}`);
          if (!Array.isArray(parsed.elements)) throw new Error("Overpass response has no elements array");
          return raw;
        }
        lastError = new Error(`Overpass HTTP ${response.status} from ${endpoint}`);
        if (response.status !== 429 && response.status < 500) throw lastError;
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All Overpass endpoints failed");
}

async function loadSnapshot(scope: LakeScope, args: LakeExpansionArgs): Promise<OverpassSnapshot> {
  const query = buildLakeOverpassQuery(scope.stateCode);
  const querySha256 = sha256(query);
  const explicitFile = args.input;
  const cacheFile = args.cacheDir ? path.join(args.cacheDir, `${scope.key}.overpass.json`) : null;
  const sourceFile = explicitFile ?? cacheFile;
  let raw: string;

  if (sourceFile) {
    try {
      raw = await fs.readFile(sourceFile, "utf8");
      console.error(`[lake-expand] ${scope.key}: using ${sourceFile}`);
    } catch (error) {
      if (explicitFile || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      raw = await fetchOverpass(query);
      await fs.mkdir(path.dirname(sourceFile), { recursive: true });
      const temporary = `${sourceFile}.${process.pid}.tmp`;
      await fs.writeFile(temporary, raw);
      await fs.rename(temporary, sourceFile);
    }
  } else {
    raw = await fetchOverpass(query);
  }

  const payload = JSON.parse(raw) as unknown;
  return {
    payload,
    rawSha256: sha256(raw),
    osmTimestamp: readOsmTimestamp(payload),
    querySha256,
    sourceFile,
  };
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function prepareGeometries(candidates: OsmLakeCandidate[]): Promise<PreparedCandidate[]> {
  const geometries = new Map<string, PreparedGeometry>();
  const withLinework = candidates.filter((candidate) => candidate.linework != null);
  for (const batch of chunks(withLinework, GEOMETRY_CHUNK_SIZE)) {
    const rows = batch.map((candidate) => ({
      identity: osmIdentityKey(candidate.osmType, candidate.osmId),
      linework: candidate.linework,
    }));
    const result = await db.query<{
      identity: string;
      boundary_geojson: string;
      lat: string | number;
      lng: string | number;
      polygon_count: string | number;
    }>(
      `WITH incoming AS (
         SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
           identity text, linework jsonb
         )
       ), parsed AS (
         SELECT identity,
                ST_SetSRID(ST_GeomFromGeoJSON(linework::text), 4326) AS linework
         FROM incoming
       ), built AS (
         SELECT identity,
                ST_CollectionExtract(ST_MakeValid(ST_BuildArea(ST_Node(linework))), 3) AS polygons
         FROM parsed
       ), components AS (
         SELECT identity, (ST_Dump(polygons)).geom AS polygon
         FROM built
         WHERE polygons IS NOT NULL AND NOT ST_IsEmpty(polygons)
       ), ranked AS (
         SELECT identity, polygon,
                row_number() OVER (
                  PARTITION BY identity ORDER BY ST_Area(polygon::geography) DESC
                ) AS rank,
                count(*) OVER (PARTITION BY identity) AS polygon_count
         FROM components
         WHERE ST_GeometryType(polygon) = 'ST_Polygon' AND ST_IsValid(polygon)
       )
       SELECT identity,
              ST_AsGeoJSON(polygon) AS boundary_geojson,
              ST_Y(ST_PointOnSurface(polygon)) AS lat,
              ST_X(ST_PointOnSurface(polygon)) AS lng,
              polygon_count
       FROM ranked
       WHERE rank = 1`,
      [JSON.stringify(rows)]
    );
    for (const row of result.rows) {
      geometries.set(row.identity, {
        identity: row.identity,
        boundaryGeoJson: row.boundary_geojson,
        lat: Number(row.lat),
        lng: Number(row.lng),
        polygonCount: Number(row.polygon_count),
        geometryStatus: "boundary",
      });
    }
  }

  return candidates.map((candidate) => {
    const identity = osmIdentityKey(candidate.osmType, candidate.osmId);
    const geometry = geometries.get(identity) ?? {
      identity,
      boundaryGeoJson: null,
      lat: candidate.lat,
      lng: candidate.lng,
      polygonCount: 0,
      geometryStatus: "point_fallback" as const,
    };
    return { ...candidate, ...geometry };
  });
}

async function parallelMap<T, R>(values: T[], concurrency: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(values.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      result[index] = await fn(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return result;
}

async function loadExistingLakes(): Promise<ExistingLake[]> {
  const result = await db.query<{
    id: string;
    name: string | null;
    lat: string | number;
    lng: string | number;
    type: string;
    state_code: string | null;
    country_code: string | null;
    external_ids: Record<string, unknown> | null;
    has_boundary: boolean;
  }>(
    `SELECT id, name,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng,
            type::text, state_code, country_code, external_ids,
            boundary IS NOT NULL AS has_boundary
     FROM destinations
     WHERE location IS NOT NULL
       AND 'lake'::destination_feature = ANY(features)`
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    lat: Number(row.lat),
    lng: Number(row.lng),
    type: row.type,
    stateCode: row.state_code,
    countryCode: row.country_code,
    externalIds: row.external_ids ?? {},
    hasBoundary: row.has_boundary,
  }));
}

function exactIdentityMatches(candidate: PreparedCandidate, existing: ExistingLake[]): ExistingLake[] {
  const field = osmExternalIdField(candidate.osmType);
  return existing.filter((lake) => String(lake.externalIds[field] ?? "") === candidate.osmId);
}

function candidateExistingRows(scope: LakeScope, existing: ExistingLake[]): ExistingLake[] {
  return existing.filter((lake) =>
    (lake.countryCode == null || lake.countryCode === scope.countryCode) &&
    (lake.stateCode == null || lake.stateCode === scope.stateCode) &&
    (lake.hasBoundary || lake.type === "region")
  );
}

function candidateLegacyOsmRows(
  scope: LakeScope,
  candidate: PreparedCandidate,
  existing: ExistingLake[]
): ExistingLake[] {
  return existing.filter((lake) =>
    String(lake.externalIds.osm ?? "") === candidate.osmId &&
    (lake.countryCode == null || lake.countryCode === scope.countryCode) &&
    (lake.stateCode == null || lake.stateCode === scope.stateCode)
  );
}

async function buildPlan(
  scope: LakeScope,
  candidates: PreparedCandidate[],
  existing: ExistingLake[],
  sourceSha256: string
): Promise<LakePlan> {
  const exactMatches: LakePlan["exactMatches"] = [];
  const provisionalBackfills: LakeBackfill[] = [];
  const ambiguities: LakeAmbiguity[] = [];
  const newCandidates: PreparedCandidate[] = [];
  const legacyRows = candidateExistingRows(scope, existing);

  for (const candidate of candidates) {
    const identity = candidate.identity;
    const exact = exactIdentityMatches(candidate, existing);
    if (exact.length === 1) {
      exactMatches.push({ identity, destinationId: exact[0].id });
      continue;
    }
    if (exact.length > 1) {
      ambiguities.push({
        identity,
        name: candidate.name,
        reason: "duplicate_external_id",
        destinationIds: exact.map((lake) => lake.id).sort(),
      });
      continue;
    }

    // Older importers stored an unqualified `osm` ID. Since OSM number spaces
    // overlap across nodes, ways, and relations, accept that key only when an
    // exact normalized name and 200 m location check also agree.
    const legacyOsm = matchExactNameProximity(
      candidate,
      candidateLegacyOsmRows(scope, candidate, existing),
      PROXIMITY_MATCH_METERS
    );
    if (legacyOsm.kind === "match") {
      provisionalBackfills.push({
        identity,
        osmType: candidate.osmType,
        osmId: candidate.osmId,
        candidateName: candidate.name,
        destinationId: legacyOsm.candidate.id,
        destinationName: legacyOsm.candidate.name ?? candidate.name,
        distanceMeters: legacyOsm.distanceMeters,
      });
      continue;
    }
    if (legacyOsm.kind === "ambiguous") {
      ambiguities.push({
        identity,
        name: candidate.name,
        reason: "multiple_legacy_matches",
        destinationIds: legacyOsm.candidates.map((match) => match.candidate.id).sort(),
      });
      continue;
    }

    const proximity = matchExactNameProximity(candidate, legacyRows, PROXIMITY_MATCH_METERS);
    if (proximity.kind === "match") {
      provisionalBackfills.push({
        identity,
        osmType: candidate.osmType,
        osmId: candidate.osmId,
        candidateName: candidate.name,
        destinationId: proximity.candidate.id,
        destinationName: proximity.candidate.name ?? candidate.name,
        distanceMeters: proximity.distanceMeters,
      });
    } else if (proximity.kind === "ambiguous") {
      ambiguities.push({
        identity,
        name: candidate.name,
        reason: "multiple_legacy_matches",
        destinationIds: proximity.candidates.map((match) => match.candidate.id).sort(),
      });
    } else {
      newCandidates.push(candidate);
    }
  }

  const backfillCountByDestination = new Map<string, number>();
  for (const backfill of provisionalBackfills) {
    backfillCountByDestination.set(
      backfill.destinationId,
      (backfillCountByDestination.get(backfill.destinationId) ?? 0) + 1
    );
  }
  const backfills: LakeBackfill[] = [];
  for (const backfill of provisionalBackfills) {
    if ((backfillCountByDestination.get(backfill.destinationId) ?? 0) === 1) {
      backfills.push(backfill);
    } else {
      ambiguities.push({
        identity: backfill.identity,
        name: backfill.candidateName,
        reason: "multiple_osm_candidates_for_destination",
        destinationIds: [backfill.destinationId],
      });
    }
  }

  const elevated = await parallelMap(newCandidates, ELEVATION_CONCURRENCY, async (candidate) => {
    const osmElevation = parseElevationMeters(candidate.tags.ele);
    if (osmElevation != null) {
      return { candidate, elevation: osmElevation, elevationSource: "osm" as const };
    }
    const elevation = await lookupElevation(candidate.lat, candidate.lng);
    return { candidate, elevation, elevationSource: "terrarium" as const };
  });
  const elevationFailures: LakePlan["elevationFailures"] = [];
  const additions: LakeAddition[] = [];
  for (const value of elevated) {
    if (value.elevation == null) {
      elevationFailures.push({ identity: value.candidate.identity, name: value.candidate.name });
      continue;
    }
    additions.push({
      ...value.candidate,
      destinationId: deterministicLakeDestinationId(value.candidate.osmType, value.candidate.osmId),
      elevation: value.elevation,
      elevationSource: value.elevationSource,
      searchName: normalizeLakeName(value.candidate.name),
      externalIds: {
        ...buildLakeExternalIds(value.candidate.osmType, value.candidate.osmId),
        ...(value.candidate.tags.wikidata ? { wikidata: value.candidate.tags.wikidata } : {}),
        ...(value.candidate.tags["gnis:feature_id"] ? { gnis: value.candidate.tags["gnis:feature_id"] } : {}),
      },
    });
  }

  additions.sort((left, right) =>
    Math.floor(left.lat) - Math.floor(right.lat) ||
    Math.floor(left.lng) - Math.floor(right.lng) ||
    left.name.localeCompare(right.name) ||
    left.identity.localeCompare(right.identity)
  );
  backfills.sort((left, right) => left.identity.localeCompare(right.identity));
  ambiguities.sort((left, right) => left.identity.localeCompare(right.identity));
  exactMatches.sort((left, right) => left.identity.localeCompare(right.identity));
  elevationFailures.sort((left, right) => left.identity.localeCompare(right.identity));
  const fingerprintPayload = {
    scope: scope.key,
    sourceSha256,
    additions: additions.map((addition) => ({
      identity: addition.identity,
      destinationId: addition.destinationId,
      boundary: addition.boundaryGeoJson == null ? null : sha256(addition.boundaryGeoJson),
    })),
    backfills: backfills.map((backfill) => ({
      identity: backfill.identity,
      destinationId: backfill.destinationId,
    })),
    ambiguities,
    exactMatches,
    elevationFailures,
  };

  return {
    additions,
    backfills,
    ambiguities,
    exactMatches,
    elevationFailures,
    decisionFingerprint: sha256(JSON.stringify(fingerprintPayload)),
  };
}

async function verifyReviewReport(
  file: string,
  expectedSha256: string,
  scope: LakeScope,
  snapshot: OverpassSnapshot,
  plan: LakePlan
): Promise<void> {
  const raw = await fs.readFile(file, "utf8");
  const actualSha256 = sha256(raw);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Reviewed report SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
  }
  const report = JSON.parse(raw) as Record<string, any>;
  if (report.apply !== false || report.jurisdiction?.key !== scope.key) {
    throw new Error("Reviewed report is not the dry-run report for this state");
  }
  if (report.source?.sha256 !== snapshot.rawSha256) {
    throw new Error("Reviewed report source snapshot no longer matches");
  }
  if (report.source?.querySha256 !== snapshot.querySha256) {
    throw new Error("Reviewed report Overpass query no longer matches");
  }
  if (report.decisionFingerprint !== plan.decisionFingerprint) {
    throw new Error("Reviewed lake decisions no longer match the current catalog");
  }
}

function additionMetadata(addition: LakeAddition, scope: LakeScope, snapshot: OverpassSnapshot) {
  return {
    source: "openstreetmap",
    osm_lake_import: {
      importer: "lake-coverage-v1",
      jurisdiction: scope.key,
      osm_element_type: addition.osmType,
      osm_element_id: addition.osmId,
      source_url: `https://www.openstreetmap.org/${addition.osmType}/${addition.osmId}`,
      attribution: OSM_ATTRIBUTION,
      license_url: OSM_LICENSE_URL,
      osm_timestamp: snapshot.osmTimestamp,
      source_sha256: snapshot.rawSha256,
      geometry_status: addition.geometryStatus,
      polygon_count: addition.polygonCount,
      elevation_source: addition.elevationSource,
      tags: addition.tags,
    },
  };
}

async function applyPlan(
  scope: LakeScope,
  snapshot: OverpassSnapshot,
  plan: LakePlan
): Promise<AppliedChanges> {
  const client = await db.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL gin_pending_list_limit = '32MB'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('osm-lake-coverage-expansion'))");

    const backfillRows = plan.backfills.map((backfill) => ({
      destination_id: backfill.destinationId,
      identity: backfill.identity,
      external_key: osmExternalIdField(backfill.osmType),
      osm_id: backfill.osmId,
      metadata: {
        source: "openstreetmap",
        importer: "lake-coverage-v1",
        jurisdiction: scope.key,
        osm_element_type: backfill.osmType,
        osm_element_id: backfill.osmId,
        source_url: `https://www.openstreetmap.org/${backfill.osmType}/${backfill.osmId}`,
        attribution: OSM_ATTRIBUTION,
        license_url: OSM_LICENSE_URL,
        osm_timestamp: snapshot.osmTimestamp,
        source_sha256: snapshot.rawSha256,
        match_method: "exact_name_proximity",
        distance_meters: backfill.distanceMeters,
      },
    }));
    const backfillResult = backfillRows.length === 0
      ? { rows: [] as Array<{ destination_id: string; identity: string }> }
      : await client.query<{ destination_id: string; identity: string }>(
        `WITH incoming AS (
           SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
             destination_id text, identity text, external_key text, osm_id text, metadata jsonb
           )
         )
         UPDATE destinations destination
         SET external_ids = COALESCE(destination.external_ids, '{}'::jsonb) ||
               jsonb_build_object(incoming.external_key, incoming.osm_id),
             country_code = COALESCE(destination.country_code, $2),
             state_code = COALESCE(destination.state_code, $3),
             metadata = jsonb_set(
               COALESCE(destination.metadata, '{}'::jsonb),
               '{osm_lake_backfill}', incoming.metadata, true
             ),
             updated_at = now()
         FROM incoming
         WHERE destination.id = incoming.destination_id
           AND NOT (COALESCE(destination.external_ids, '{}'::jsonb) ? incoming.external_key)
           AND NOT EXISTS (
             SELECT 1
             FROM destinations other
             WHERE other.id <> destination.id
               AND other.external_ids->>incoming.external_key = incoming.osm_id
           )
         RETURNING destination.id AS destination_id, incoming.identity`,
        [JSON.stringify(backfillRows), scope.countryCode, scope.stateCode]
      );
    if (backfillResult.rows.length !== plan.backfills.length) {
      throw new Error(
        `Lake backfill precondition changed: expected ${plan.backfills.length}, ` +
        `updated ${backfillResult.rows.length}`
      );
    }

    const inserted: AppliedChanges["inserted"] = [];
    for (const batch of chunks(plan.additions, INSERT_CHUNK_SIZE)) {
      const rows = batch.map((addition) => ({
        id: addition.destinationId,
        identity: addition.identity,
        name: addition.name,
        search_name: addition.searchName,
        elevation: addition.elevation,
        lat: addition.lat,
        lng: addition.lng,
        boundary_geojson: addition.boundaryGeoJson,
        external_key: osmExternalIdField(addition.osmType),
        osm_id: addition.osmId,
        external_ids: addition.externalIds,
        metadata: additionMetadata(addition, scope, snapshot),
      }));
      const result = await client.query<{ id: string; identity: string }>(
        `WITH incoming AS (
           SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
             id text, identity text, name text, search_name text,
             elevation double precision, lat double precision, lng double precision,
             boundary_geojson text, external_key text, osm_id text,
             external_ids jsonb, metadata jsonb
           )
         ), prepared AS (
           SELECT incoming.*,
                  CASE WHEN boundary_geojson IS NULL THEN NULL::geometry
                       ELSE ST_SetSRID(ST_GeomFromGeoJSON(boundary_geojson), 4326)
                  END AS boundary_geometry
           FROM incoming
         )
         INSERT INTO destinations (
           id, name, search_name, elevation, prominence, location, boundary, geohash,
           type, activities, features, owner, country_code, state_code,
           bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng,
           external_ids, metadata, created_at, updated_at
         )
         SELECT prepared.id, prepared.name, prepared.search_name, prepared.elevation, NULL,
                ST_SetSRID(ST_MakePoint(prepared.lng, prepared.lat, prepared.elevation), 4326)::geography,
                prepared.boundary_geometry::geography, NULL,
                CASE WHEN prepared.boundary_geometry IS NULL THEN 'point' ELSE 'region' END::destination_type,
                ARRAY['outdoor-trek']::activity_type[], ARRAY['lake']::destination_feature[],
                'peaks', $2, $3,
                CASE WHEN prepared.boundary_geometry IS NULL THEN NULL
                     ELSE ST_YMin(Box3D(prepared.boundary_geometry)) END,
                CASE WHEN prepared.boundary_geometry IS NULL THEN NULL
                     ELSE ST_YMax(Box3D(prepared.boundary_geometry)) END,
                CASE WHEN prepared.boundary_geometry IS NULL THEN NULL
                     ELSE ST_XMin(Box3D(prepared.boundary_geometry)) END,
                CASE WHEN prepared.boundary_geometry IS NULL THEN NULL
                     ELSE ST_XMax(Box3D(prepared.boundary_geometry)) END,
                prepared.external_ids, prepared.metadata, now(), now()
         FROM prepared
         WHERE NOT EXISTS (
           SELECT 1 FROM destinations other
           WHERE other.external_ids->>prepared.external_key = prepared.osm_id
         )
         ON CONFLICT (id) DO NOTHING
         RETURNING id, (SELECT identity FROM incoming WHERE incoming.id = destinations.id) AS identity`,
        [JSON.stringify(rows), scope.countryCode, scope.stateCode]
      );
      inserted.push(...result.rows);
      console.error(
        `[lake-expand] ${scope.key}: inserted ${inserted.length}/${plan.additions.length}`
      );
    }
    if (inserted.length !== plan.additions.length) {
      throw new Error(
        `Lake insert precondition changed: expected ${plan.additions.length}, inserted ${inserted.length}`
      );
    }

    await client.query("COMMIT");
    return {
      inserted,
      backfilled: backfillResult.rows.map((row) => ({
        destinationId: row.destination_id,
        identity: row.identity,
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function reportFor(
  scope: LakeScope,
  args: LakeExpansionArgs,
  snapshot: OverpassSnapshot,
  rawElementCount: number,
  candidates: PreparedCandidate[],
  plan: LakePlan,
  applied: AppliedChanges
) {
  return {
    generatedAt: new Date().toISOString(),
    jurisdiction: scope,
    apply: args.apply,
    policy: {
      requiredTags: { natural: "water", water: "lake", name: "non-empty" },
      proximityMatchMeters: PROXIMITY_MATCH_METERS,
      deletions: false,
      existingFieldReplacement: false,
    },
    source: {
      sha256: snapshot.rawSha256,
      querySha256: snapshot.querySha256,
      osmTimestamp: snapshot.osmTimestamp,
      file: snapshot.sourceFile,
      attribution: OSM_ATTRIBUTION,
      licenseUrl: OSM_LICENSE_URL,
    },
    decisionFingerprint: plan.decisionFingerprint,
    totals: {
      rawElements: rawElementCount,
      acceptedNamedLakes: candidates.length,
      rejectedElements: rawElementCount - candidates.length,
      boundariesBuilt: candidates.filter((candidate) => candidate.boundaryGeoJson != null).length,
      pointFallbacks: candidates.filter((candidate) => candidate.boundaryGeoJson == null).length,
      multiPolygonLargestComponent: candidates.filter((candidate) => candidate.polygonCount > 1).length,
      exactMatches: plan.exactMatches.length,
      safeLegacyBackfills: plan.backfills.length,
      ambiguities: plan.ambiguities.length,
      elevationFailures: plan.elevationFailures.length,
      plannedAdditions: plan.additions.length,
      inserted: applied.inserted.length,
      backfilled: applied.backfilled.length,
    },
    exactMatches: plan.exactMatches,
    backfills: plan.backfills.map((backfill) => ({
      ...backfill,
      distanceMeters: Math.round(backfill.distanceMeters * 10) / 10,
      applied: applied.backfilled.some((row) => row.identity === backfill.identity),
    })),
    ambiguities: plan.ambiguities,
    elevationFailures: plan.elevationFailures,
    additions: plan.additions.map((addition) => ({
      identity: addition.identity,
      destinationId: addition.destinationId,
      osmType: addition.osmType,
      osmId: addition.osmId,
      name: addition.name,
      lat: addition.lat,
      lng: addition.lng,
      elevation: addition.elevation,
      elevationSource: addition.elevationSource,
      geometryStatus: addition.geometryStatus,
      polygonCount: addition.polygonCount,
      applied: applied.inserted.some((row) => row.identity === addition.identity),
    })),
  };
}

async function writeReport(
  reportDir: string | null,
  scope: LakeScope,
  report: unknown,
  mode: "apply" | "dry-run"
): Promise<string | null> {
  if (!reportDir) return null;
  await fs.mkdir(reportDir, { recursive: true });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const specific = path.join(reportDir, `${scope.key}.${mode}.json`);
  await fs.writeFile(specific, serialized);
  await fs.writeFile(path.join(reportDir, `${scope.key}.json`), serialized);
  return specific;
}

function overpassElementCount(payload: unknown): number {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return 0;
  const elements = (payload as Record<string, unknown>).elements;
  return Array.isArray(elements) ? elements.length : 0;
}

async function runScope(scope: LakeScope, args: LakeExpansionArgs, existing: ExistingLake[]) {
  console.error(`[lake-expand] ${scope.key}: loading OSM lakes`);
  const snapshot = await loadSnapshot(scope, args);
  const parsed = parseOsmWaterLakeElements(snapshot.payload);
  const candidates = await prepareGeometries(parsed);
  const plan = await buildPlan(scope, candidates, existing, snapshot.rawSha256);
  if (args.apply) {
    await verifyReviewReport(
      args.reviewReport!,
      args.expectedReportSha256!,
      scope,
      snapshot,
      plan
    );
  }
  const applied = args.apply
    ? await applyPlan(scope, snapshot, plan)
    : { inserted: [], backfilled: [] };
  const report = reportFor(
    scope,
    args,
    snapshot,
    overpassElementCount(snapshot.payload),
    candidates,
    plan,
    applied
  );
  const reportFile = await writeReport(
    args.reportDir,
    scope,
    report,
    args.apply ? "apply" : "dry-run"
  );
  const totals = report.totals;
  console.log(
    `${scope.key}: ${totals.acceptedNamedLakes} named OSM lakes; ` +
    `${totals.exactMatches} matched, ${totals.safeLegacyBackfills} safe backfills, ` +
    `${totals.ambiguities} ambiguous, ${totals.plannedAdditions} additions; ` +
    `${totals.inserted} inserted`
  );
  if (reportFile && !args.apply) {
    console.log(`Review report: ${reportFile}`);
    console.log(`SHA-256: ${sha256(await fs.readFile(reportFile))}`);
  }
  return report;
}

async function main(): Promise<void> {
  const args = parseLakeExpansionArgs();
  const existing = await loadExistingLakes();
  const reports = new Map<string, unknown>();
  const failures: Array<{ jurisdiction: string; error: string }> = [];
  let next = 0;
  const worker = async () => {
    while (next < args.scopes.length) {
      const scope = args.scopes[next++];
      try {
        reports.set(scope.key, await runScope(scope, args, existing));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ jurisdiction: scope.key, error: message });
        console.error(`[lake-expand] ${scope.key}: FAILED: ${message}`);
        if (args.apply || args.scopes.length === 1) throw error;
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(args.concurrency, args.scopes.length) }, worker)
    );
  } finally {
    await db.end();
  }
  if (failures.length) {
    console.error(JSON.stringify({ failures }, null, 2));
    process.exitCode = 1;
  }
}

if (/(?:^|[/\\])expand-lake-coverage\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
