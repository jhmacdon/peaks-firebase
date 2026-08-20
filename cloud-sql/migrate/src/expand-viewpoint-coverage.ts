/**
 * Audit and optionally expand named OSM viewpoint coverage for one guarded
 * jurisdiction. US state imports remain the default. Country imports may use
 * a fixed bounding box for a named mountain region.
 *
 * Dry-run is the default. Apply requires the reviewed dry-run report, its
 * SHA-256, and the same cached Overpass snapshot. The importer only adds rows,
 * adds the viewpoint feature to an exact existing place, or adds a missing
 * type-qualified OSM ID. It never deletes a destination or replaces its name,
 * coordinates, elevation, or existing features.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import db from "./db";
import { lookupElevation } from "./lib/terrarium-elevation";
import {
  DEFAULT_VIEWPOINT_NAME_PROXIMITY_METERS,
  OsmViewpointCandidate,
  OsmViewpointElementType,
  buildViewpointExternalIds,
  deterministicViewpointDestinationId,
  exactNameProximityMatches,
  normalizeViewpointName,
  osmViewpointExternalIdField,
  osmViewpointIdentity,
  parseOsmViewpointElement,
  parseOsmViewpointElements,
} from "./osm-viewpoint-coverage";
import { ISO_COUNTRY_CODES, US_STATE_CODES } from "./peak-coverage-jurisdictions";

const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
const OSM_LICENSE_NAME = "Open Data Commons Open Database License (ODbL) 1.0";
const OSM_LICENSE_URL = "https://www.openstreetmap.org/copyright";

interface ViewpointExpansionArgs {
  countryCode: string;
  stateCode: string | null;
  subdivisionCode: string | null;
  scopeKey: string;
  bbox: [number, number, number, number] | null;
  apply: boolean;
  concurrency: number;
  cacheDir: string | null;
  input: string | null;
  report: string | null;
  candidateReviews: string[];
  supplement: string | null;
  reviewReport: string | null;
  expectedReportSha256: string | null;
}

type ViewpointScope = Pick<
  ViewpointExpansionArgs,
  "countryCode" | "stateCode" | "subdivisionCode" | "scopeKey" | "bbox"
>;

interface PreparedViewpointCandidate extends OsmViewpointCandidate {
  features: Array<"viewpoint" | "landform">;
  evidenceUrls: string[];
  provenance: "osm_named" | "curated_supplement";
}

interface CandidateReviewSummary {
  files: string[];
  fingerprint: string | null;
  included: number;
  excluded: number;
  needsHuman: number;
  excludedCandidates: Array<{ identity: string; name: string; reason: string }>;
  needsHumanCandidates: Array<{ identity: string; name: string; reason: string }>;
}

interface OverpassSnapshot {
  payload: unknown;
  rawSha256: string;
  osmTimestamp: string | null;
  querySha256: string;
  sourceFile: string | null;
}

interface ExistingDestination {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  features: string[];
  activities: string[];
  countryCode: string | null;
  stateCode: string | null;
  externalIds: Record<string, unknown>;
}

interface PlannedAddition {
  action: "insert";
  identity: string;
  destinationId: string;
  name: string;
  searchName: string;
  lat: number;
  lng: number;
  elevation: number;
  elevationSource: "osm" | "terrarium";
  osmType: OsmViewpointElementType;
  osmId: string;
  externalIds: Record<string, string>;
  metadata: Record<string, unknown>;
  features: Array<"viewpoint" | "landform">;
}

interface PlannedEnrichment {
  action: "enrich";
  identity: string;
  destinationId: string;
  destinationName: string | null;
  candidateName: string;
  osmType: OsmViewpointElementType;
  osmId: string;
  externalIdField: string;
  matchMethod: "exact_external_id" | "exact_name_proximity";
  distanceMeters: number;
  addFeatures: Array<"viewpoint" | "landform">;
  addActivity: boolean;
  addExternalId: boolean;
  expectedFeatures: string[];
  expectedActivities: string[];
  expectedExternalIds: Record<string, unknown>;
}

interface PlannedAmbiguity {
  identity: string;
  name: string;
  reason:
    | "multiple_external_id_matches"
    | "multiple_name_proximity_matches"
    | "external_id_conflict"
    | "jurisdiction_mismatch"
    | "multiple_osm_candidates_for_destination";
  destinationIds: string[];
}

interface ViewpointPlan {
  additions: PlannedAddition[];
  enrichments: PlannedEnrichment[];
  unchanged: Array<{ identity: string; destinationId: string }>;
  ambiguities: PlannedAmbiguity[];
  elevationFailures: Array<{ identity: string; name: string }>;
  decisionFingerprint: string;
}

interface ViewpointDryRunReport {
  version: 1;
  generatedAt: string;
  scope: {
    countryCode: string;
    stateCode: string | null;
    subdivisionCode?: string | null;
    key?: string;
    bbox?: [number, number, number, number] | null;
  };
  query: string;
  querySha256: string;
  sourceFile: string | null;
  sourceRawSha256: string;
  osmTimestamp: string | null;
  rawElementCount: number;
  candidateCount: number;
  reviewedCandidateCount: number;
  supplementCount: number;
  candidateReview: CandidateReviewSummary;
  potentialNewSessionLinks: number | null;
  plan: ViewpointPlan;
}

type Queryable = Pick<PoolClient, "query">;

const optionValue = (argv: string[], name: string) =>
  argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);

export function parseViewpointExpansionArgs(
  argv = process.argv.slice(2)
): ViewpointExpansionArgs {
  const requestedState = optionValue(argv, "state");
  const requestedCountry = optionValue(argv, "country");
  const requestedSubdivision = optionValue(argv, "subdivision");
  if ([requestedState, requestedCountry, requestedSubdivision].filter(Boolean).length > 1) {
    throw new Error("Choose one of --state, --country, or --subdivision");
  }

  const normalizedSubdivision = requestedSubdivision?.toUpperCase() ?? null;
  if (normalizedSubdivision && !/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(normalizedSubdivision)) {
    throw new Error("--subdivision must be an ISO 3166-2 code such as IN-HP");
  }
  const stateCode = normalizedSubdivision
    ? normalizedSubdivision.split("-")[1]
    : requestedCountry ? null : (requestedState ?? "WA").toUpperCase();
  if (!normalizedSubdivision && stateCode &&
      !(US_STATE_CODES as readonly string[]).includes(stateCode)) {
    throw new Error("--state must be a valid two-letter US state code");
  }
  const countryCode = normalizedSubdivision
    ? normalizedSubdivision.split("-")[0]
    : stateCode ? "US" : requestedCountry!.toUpperCase();
  if (!(ISO_COUNTRY_CODES as readonly string[]).includes(countryCode)) {
    throw new Error("--country must be a valid ISO 3166-1 alpha-2 code");
  }
  const subdivisionCode = normalizedSubdivision ??
    (stateCode ? `US-${stateCode}` : null);

  const rawBbox = optionValue(argv, "bbox");
  if (rawBbox && requestedState) {
    throw new Error("--bbox is supported with --country or --subdivision");
  }
  let bbox: [number, number, number, number] | null = null;
  if (rawBbox) {
    const values = rawBbox.split(",").map((value) => Number(value.trim()));
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
      throw new Error("--bbox must be south,west,north,east");
    }
    const [south, west, north, east] = values;
    if (south < -90 || north > 90 || west < -180 || east > 180 ||
        south >= north || west >= east) {
      throw new Error("--bbox must contain ordered latitude and longitude bounds");
    }
    bbox = [south, west, north, east];
  }

  const requestedScope = optionValue(argv, "scope");
  if (requestedScope && requestedState) {
    throw new Error("--scope is supported with --country or --subdivision");
  }
  if (bbox && !requestedScope) {
    throw new Error("Bounded country imports require --scope");
  }
  if (requestedScope && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(requestedScope)) {
    throw new Error("--scope must be a lowercase slug of letters, numbers, and hyphens");
  }
  const scopeBase = subdivisionCode ?? countryCode;
  const scopeKey = requestedScope ? `${scopeBase}-${requestedScope}` : scopeBase;
  const concurrency = Number.parseInt(optionValue(argv, "concurrency") ?? "8", 10);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) {
    throw new Error("--concurrency must be an integer from 1 to 12");
  }

  const apply = argv.includes("--apply");
  const reviewReport = optionValue(argv, "review-report") ?? null;
  const expectedReportSha256 =
    optionValue(argv, "expected-report-sha256")?.toLowerCase() ?? null;
  if (apply && (!reviewReport || !expectedReportSha256)) {
    throw new Error("--apply requires --review-report and --expected-report-sha256");
  }
  if (expectedReportSha256 && !/^[0-9a-f]{64}$/.test(expectedReportSha256)) {
    throw new Error("--expected-report-sha256 must be a lowercase 64-character SHA-256");
  }

  return {
    countryCode,
    stateCode,
    subdivisionCode,
    scopeKey,
    bbox,
    apply,
    concurrency,
    cacheDir: optionValue(argv, "cache-dir") ?? null,
    input: optionValue(argv, "input") ?? null,
    report: optionValue(argv, "report") ?? null,
    candidateReviews: (optionValue(argv, "candidate-reviews") ?? "")
      .split(",").map((value) => value.trim()).filter(Boolean),
    supplement: optionValue(argv, "supplement") ?? null,
    reviewReport,
    expectedReportSha256,
  };
}

export function buildViewpointOverpassQuery(stateCode: string): string {
  return `[out:json][timeout:180];
area["ISO3166-2"="US-${stateCode}"]["boundary"="administrative"]->.region;
nwr["tourism"="viewpoint"]["name"](area.region);
out tags center qt;`;
}

export function buildCountryViewpointOverpassQuery(
  countryCode: string,
  bbox: [number, number, number, number] | null = null
): string {
  const bounds = bbox ? bbox.join(",") : null;
  return `[out:json][timeout:180];
area["ISO3166-1"="${countryCode}"]["boundary"="administrative"]->.region;
nwr["tourism"="viewpoint"]["name"](area.region)${bounds ? `(${bounds})` : ""};
out tags center qt;`;
}

export function buildSubdivisionViewpointOverpassQuery(
  subdivisionCode: string,
  bbox: [number, number, number, number] | null = null
): string {
  const bounds = bbox ? bbox.join(",") : null;
  return `[out:json][timeout:180];
area["ISO3166-2"="${subdivisionCode}"]["boundary"="administrative"]->.region;
nwr["tourism"="viewpoint"]["name"](area.region)${bounds ? `(${bounds})` : ""};
out tags center qt;`;
}

function queryForScope(args: ViewpointExpansionArgs): string {
  if (args.countryCode === "US" && args.stateCode) {
    return buildViewpointOverpassQuery(args.stateCode);
  }
  return args.subdivisionCode
    ? buildSubdivisionViewpointOverpassQuery(args.subdivisionCode, args.bbox)
    : buildCountryViewpointOverpassQuery(args.countryCode, args.bbox);
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
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
      const timeout = setTimeout(() => controller.abort(), 210_000);
      try {
        console.error(`[viewpoint-expand] fetching ${endpoint} (attempt ${attempt + 1})`);
        const response = await fetch(endpoint, {
          method: "POST",
          body: `data=${encodeURIComponent(query)}`,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "PeaksApp-viewpoint-coverage/1.0 (https://github.com/jhmacdon/peaks-firebase)",
          },
          signal: controller.signal,
        });
        if (response.ok) {
          const raw = await response.text();
          const parsed = JSON.parse(raw) as { elements?: unknown[]; remark?: string };
          if (parsed.remark) throw new Error(`Overpass error: ${parsed.remark}`);
          if (!Array.isArray(parsed.elements)) {
            throw new Error("Overpass response has no elements array");
          }
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

async function loadSnapshot(args: ViewpointExpansionArgs): Promise<OverpassSnapshot> {
  const query = queryForScope(args);
  const querySha256 = sha256(query);
  const cacheFile = args.cacheDir
    ? path.join(args.cacheDir, `${args.scopeKey}.viewpoints.overpass.json`)
    : null;
  const sourceFile = args.input ?? cacheFile;
  let raw: string;

  if (sourceFile) {
    try {
      raw = await fs.readFile(sourceFile, "utf8");
      console.error(`[viewpoint-expand] using ${sourceFile}`);
    } catch (error) {
      if (args.input || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
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

async function applyCandidateReviews(
  candidates: OsmViewpointCandidate[],
  files: string[]
): Promise<{ candidates: PreparedViewpointCandidate[]; summary: CandidateReviewSummary }> {
  const byIdentity = new Map(candidates.map((candidate) => [
    osmViewpointIdentity(candidate.osmType, candidate.osmId),
    candidate,
  ]));
  if (files.length === 0) {
    return {
      candidates: candidates.map((candidate) => ({
        ...candidate,
        features: ["viewpoint"],
        evidenceUrls: [],
        provenance: "osm_named",
      })),
      summary: {
        files: [],
        fingerprint: null,
        included: candidates.length,
        excluded: 0,
        needsHuman: 0,
        excludedCandidates: [],
        needsHumanCandidates: [],
      },
    };
  }

  const decisions = new Map<string, { decision: string; reason: string }>();
  for (const file of files) {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as {
      decisions?: Array<{ identity?: unknown; decision?: unknown; reason?: unknown; features?: unknown }>;
    };
    if (!Array.isArray(parsed.decisions)) throw new Error(`Candidate review has no decisions: ${file}`);
    for (const entry of parsed.decisions) {
      const identity = typeof entry.identity === "string" ? entry.identity : "";
      const decision = typeof entry.decision === "string" ? entry.decision : "";
      const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
      if (!byIdentity.has(identity)) throw new Error(`Candidate review has unknown identity: ${identity}`);
      if (decisions.has(identity)) throw new Error(`Candidate review repeats identity: ${identity}`);
      if (!["include", "exclude", "needs_human"].includes(decision) || !reason) {
        throw new Error(`Candidate review has an invalid decision: ${identity}`);
      }
      if (!Array.isArray(entry.features) || !entry.features.includes("viewpoint")) {
        throw new Error(`Candidate review must retain the viewpoint feature: ${identity}`);
      }
      decisions.set(identity, { decision, reason });
    }
  }
  if (decisions.size !== candidates.length) {
    const missing = [...byIdentity.keys()].filter((identity) => !decisions.has(identity));
    throw new Error(`Candidate reviews do not cover every source row; missing ${missing.length}`);
  }

  const included: PreparedViewpointCandidate[] = [];
  const excludedCandidates: CandidateReviewSummary["excludedCandidates"] = [];
  const needsHumanCandidates: CandidateReviewSummary["needsHumanCandidates"] = [];
  for (const candidate of candidates) {
    const identity = osmViewpointIdentity(candidate.osmType, candidate.osmId);
    const review = decisions.get(identity)!;
    if (review.decision === "include") {
      included.push({
        ...candidate,
        features: ["viewpoint"],
        evidenceUrls: [],
        provenance: "osm_named",
      });
    } else {
      const row = { identity, name: candidate.name, reason: review.reason };
      if (review.decision === "exclude") excludedCandidates.push(row);
      else needsHumanCandidates.push(row);
    }
  }
  const stableDecisions = [...decisions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([identity, review]) => ({ identity, ...review }));
  return {
    candidates: included,
    summary: {
      files,
      fingerprint: sha256(stableJson(stableDecisions)),
      included: included.length,
      excluded: excludedCandidates.length,
      needsHuman: needsHumanCandidates.length,
      excludedCandidates,
      needsHumanCandidates,
    },
  };
}

async function loadSupplement(file: string | null): Promise<PreparedViewpointCandidate[]> {
  if (!file) return [];
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as {
    candidates?: Array<Record<string, unknown>>;
  };
  if (!Array.isArray(parsed.candidates)) throw new Error("Supplement has no candidates array");
  const result: PreparedViewpointCandidate[] = [];
  for (const raw of parsed.candidates) {
    const osmType = raw.osm_type;
    const osmId = raw.osm_id;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    const features = Array.isArray(raw.features) ? raw.features.map(String) : [];
    const evidenceUrls = Array.isArray(raw.evidence_urls)
      ? raw.evidence_urls.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
    if ((osmType !== "node" && osmType !== "way" && osmType !== "relation") ||
        !name || !Number.isFinite(lat) || !Number.isFinite(lng) ||
        !features.includes("viewpoint") ||
        features.some((feature) => feature !== "viewpoint" && feature !== "landform") ||
        evidenceUrls.length === 0) {
      throw new Error(`Invalid supplement candidate: ${name || String(osmId)}`);
    }
    const candidate = parseOsmViewpointElement({
      type: osmType,
      id: osmId as string | number,
      ...(osmType === "node" ? { lat, lon: lng } : { center: { lat, lon: lng } }),
      tags: { tourism: "viewpoint", name },
    });
    if (!candidate) throw new Error(`Invalid supplement OSM identity: ${name}`);
    result.push({
      ...candidate,
      features: features as Array<"viewpoint" | "landform">,
      evidenceUrls,
      provenance: "curated_supplement",
    });
  }
  const identities = result.map((candidate) => osmViewpointIdentity(candidate.osmType, candidate.osmId));
  if (new Set(identities).size !== identities.length) throw new Error("Supplement repeats an OSM identity");
  return result;
}

function parsePgArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
    return value.slice(1, -1).split(",").filter(Boolean);
  }
  return [];
}

function destinationFromRow(row: Record<string, unknown>): ExistingDestination {
  return {
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : null,
    lat: Number(row.lat),
    lng: Number(row.lng),
    features: parsePgArray(row.features),
    activities: parsePgArray(row.activities),
    countryCode: typeof row.country_code === "string" ? row.country_code : null,
    stateCode: typeof row.state_code === "string" ? row.state_code : null,
    externalIds: row.external_ids != null && typeof row.external_ids === "object"
      ? row.external_ids as Record<string, unknown>
      : {},
  };
}

async function loadExistingDestinations(
  queryable: Queryable,
  scope: ViewpointScope,
  candidates: OsmViewpointCandidate[]
): Promise<ExistingDestination[]> {
  const nodeIds = candidates.filter((candidate) => candidate.osmType === "node").map((candidate) => candidate.osmId);
  const wayIds = candidates.filter((candidate) => candidate.osmType === "way").map((candidate) => candidate.osmId);
  const relationIds = candidates.filter((candidate) => candidate.osmType === "relation").map((candidate) => candidate.osmId);
  const result = await queryable.query(
    `SELECT id, name, ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng, features, activities,
            country_code, state_code, external_ids
     FROM destinations
     WHERE location IS NOT NULL
       AND (
         ($2::text IS NOT NULL AND (
           state_code = $2 OR ($1 <> 'US' AND country_code = $1)
         ))
         OR ($2::text IS NULL AND country_code = $1)
         OR external_ids->>'osm_node' = ANY($3::text[])
         OR external_ids->>'osm' = ANY($3::text[])
         OR external_ids->>'osm_way' = ANY($4::text[])
         OR external_ids->>'osm_relation' = ANY($5::text[])
       )`,
    [scope.countryCode, scope.stateCode, nodeIds, wayIds, relationIds]
  );
  return result.rows.map((row) => destinationFromRow(row));
}

function destinationMatchesScope(
  destination: ExistingDestination,
  scope: ViewpointScope
): boolean {
  if (destination.countryCode != null && destination.countryCode !== scope.countryCode) {
    return false;
  }
  return scope.stateCode == null ||
    destination.stateCode == null ||
    destination.stateCode === scope.stateCode;
}

function exactIdentityMatches(
  candidate: OsmViewpointCandidate,
  existing: ExistingDestination[]
): ExistingDestination[] {
  const field = osmViewpointExternalIdField(candidate.osmType);
  return existing.filter((destination) => {
    if (String(destination.externalIds[field] ?? "") === candidate.osmId) return true;
    return candidate.osmType === "node" &&
      String(destination.externalIds.osm ?? "") === candidate.osmId;
  });
}

function externalIdConflict(
  candidate: OsmViewpointCandidate,
  destination: ExistingDestination
): boolean {
  const field = osmViewpointExternalIdField(candidate.osmType);
  const typedValue = destination.externalIds[field];
  return typedValue != null && String(typedValue) !== candidate.osmId;
}

function buildEnrichment(
  candidate: PreparedViewpointCandidate,
  destination: ExistingDestination,
  matchMethod: PlannedEnrichment["matchMethod"],
  distanceMeters: number
): PlannedEnrichment {
  const field = osmViewpointExternalIdField(candidate.osmType);
  return {
    action: "enrich",
    identity: osmViewpointIdentity(candidate.osmType, candidate.osmId),
    destinationId: destination.id,
    destinationName: destination.name,
    candidateName: candidate.name,
    osmType: candidate.osmType,
    osmId: candidate.osmId,
    externalIdField: field,
    matchMethod,
    distanceMeters,
    addFeatures: candidate.features.filter((feature) => !destination.features.includes(feature)),
    addActivity: !destination.activities.includes("outdoor-trek"),
    addExternalId: String(destination.externalIds[field] ?? "") !== candidate.osmId,
    expectedFeatures: [...destination.features],
    expectedActivities: [...destination.activities],
    expectedExternalIds: { ...destination.externalIds },
  };
}

async function parallelMap<T, R>(
  values: T[],
  concurrency: number,
  fn: (value: T) => Promise<R>
): Promise<R[]> {
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

async function buildPlan(
  candidates: PreparedViewpointCandidate[],
  scope: ViewpointScope,
  concurrency: number,
  queryable: Queryable = db
): Promise<ViewpointPlan> {
  const existing = await loadExistingDestinations(queryable, scope, candidates);
  const provisionalEnrichments: Array<{
    candidate: PreparedViewpointCandidate;
    enrichment: PlannedEnrichment;
  }> = [];
  const additionsToElevate: PreparedViewpointCandidate[] = [];
  const ambiguities: PlannedAmbiguity[] = [];

  for (const candidate of candidates) {
    const identity = osmViewpointIdentity(candidate.osmType, candidate.osmId);
    const exact = exactIdentityMatches(candidate, existing);
    if (exact.length > 1) {
      ambiguities.push({
        identity,
        name: candidate.name,
        reason: "multiple_external_id_matches",
        destinationIds: exact.map((destination) => destination.id).sort(),
      });
      continue;
    }
    if (exact.length === 1) {
      if (!destinationMatchesScope(exact[0], scope)) {
        ambiguities.push({
          identity,
          name: candidate.name,
          reason: "jurisdiction_mismatch",
          destinationIds: [exact[0].id],
        });
        continue;
      }
      provisionalEnrichments.push({
        candidate,
        enrichment: buildEnrichment(candidate, exact[0], "exact_external_id", 0),
      });
      continue;
    }

    const nearby = exactNameProximityMatches(
      candidate,
      existing.filter((destination) => destinationMatchesScope(destination, scope)),
      DEFAULT_VIEWPOINT_NAME_PROXIMITY_METERS
    );
    if (nearby.length > 1) {
      ambiguities.push({
        identity,
        name: candidate.name,
        reason: "multiple_name_proximity_matches",
        destinationIds: nearby.map((match) => match.destination.id),
      });
      continue;
    }
    if (nearby.length === 1) {
      const destination = nearby[0].destination;
      if (externalIdConflict(candidate, destination)) {
        ambiguities.push({
          identity,
          name: candidate.name,
          reason: "external_id_conflict",
          destinationIds: [destination.id],
        });
        continue;
      }
      provisionalEnrichments.push({
        candidate,
        enrichment: buildEnrichment(
          candidate,
          destination,
          "exact_name_proximity",
          nearby[0].distanceMeters
        ),
      });
      continue;
    }
    additionsToElevate.push(candidate);
  }

  const byDestination = new Map<string, typeof provisionalEnrichments>();
  for (const provisional of provisionalEnrichments) {
    const matches = byDestination.get(provisional.enrichment.destinationId) ?? [];
    matches.push(provisional);
    byDestination.set(provisional.enrichment.destinationId, matches);
  }

  const enrichments: PlannedEnrichment[] = [];
  for (const matches of byDestination.values()) {
    if (matches.length === 1) {
      enrichments.push(matches[0].enrichment);
      continue;
    }
    for (const match of matches) {
      ambiguities.push({
        identity: match.enrichment.identity,
        name: match.candidate.name,
        reason: "multiple_osm_candidates_for_destination",
        destinationIds: [match.enrichment.destinationId],
      });
    }
  }

  const elevated = await parallelMap(additionsToElevate, concurrency, async (candidate) => ({
    candidate,
    elevation: candidate.elevationM ?? await lookupElevation(candidate.lat, candidate.lng),
    elevationSource: candidate.elevationM != null ? "osm" as const : "terrarium" as const,
  }));
  const additions: PlannedAddition[] = [];
  const elevationFailures: ViewpointPlan["elevationFailures"] = [];
  for (const prepared of elevated) {
    const candidate = prepared.candidate;
    const identity = osmViewpointIdentity(candidate.osmType, candidate.osmId);
    if (prepared.elevation == null || !Number.isFinite(prepared.elevation)) {
      elevationFailures.push({ identity, name: candidate.name });
      continue;
    }
    additions.push({
      action: "insert",
      identity,
      destinationId: deterministicViewpointDestinationId(candidate.osmType, candidate.osmId),
      name: candidate.name,
      searchName: normalizeViewpointName(candidate.name),
      lat: candidate.lat,
      lng: candidate.lng,
      elevation: prepared.elevation,
      elevationSource: prepared.elevationSource,
      osmType: candidate.osmType,
      osmId: candidate.osmId,
      externalIds: buildViewpointExternalIds(candidate.osmType, candidate.osmId),
      metadata: {
        source: "openstreetmap",
        source_url: `https://www.openstreetmap.org/${candidate.osmType}/${candidate.osmId}`,
        attribution: OSM_ATTRIBUTION,
        license_name: OSM_LICENSE_NAME,
        license_url: OSM_LICENSE_URL,
        osm_type: candidate.osmType,
        elevation_source: prepared.elevationSource,
        catalog_provenance: candidate.provenance,
        catalog_scope: scope.scopeKey,
        evidence_urls: candidate.evidenceUrls,
      },
      features: candidate.features,
    });
  }

  additions.sort((left, right) => left.identity.localeCompare(right.identity));
  enrichments.sort((left, right) => left.identity.localeCompare(right.identity));
  ambiguities.sort((left, right) => left.identity.localeCompare(right.identity));
  elevationFailures.sort((left, right) => left.identity.localeCompare(right.identity));

  const unchanged = enrichments
    .filter((enrichment) =>
      enrichment.addFeatures.length === 0 && !enrichment.addActivity && !enrichment.addExternalId
    )
    .map((enrichment) => ({
      identity: enrichment.identity,
      destinationId: enrichment.destinationId,
    }));
  const writes = enrichments.filter((enrichment) =>
    enrichment.addFeatures.length > 0 || enrichment.addActivity || enrichment.addExternalId
  );

  const fingerprintInput = {
    additions,
    enrichments: writes,
    unchanged,
    ambiguities,
    elevationFailures,
  };
  return {
    additions,
    enrichments: writes,
    unchanged,
    ambiguities,
    elevationFailures,
    decisionFingerprint: sha256(stableJson(fingerprintInput)),
  };
}

async function countPotentialSessionLinks(plan: ViewpointPlan): Promise<number | null> {
  const rows = [
    ...plan.additions.map((addition) => ({
      destination_id: addition.destinationId,
      lat: addition.lat,
      lng: addition.lng,
    })),
    ...plan.enrichments.map((enrichment) => ({
      destination_id: enrichment.destinationId,
      lat: null as number | null,
      lng: null as number | null,
    })),
  ];
  if (rows.length === 0) return 0;
  try {
    const result = await db.query<{ count: number }>(
      `WITH incoming AS (
         SELECT value.destination_id,
                COALESCE(
                  d.location,
                  ST_SetSRID(ST_MakePoint(value.lng, value.lat), 4326)::geography
                ) AS location
         FROM jsonb_to_recordset($1::jsonb) AS value(
           destination_id text, lat double precision, lng double precision
         )
         LEFT JOIN destinations d ON d.id = value.destination_id
       ), candidates AS MATERIALIZED (
         SELECT incoming.destination_id, incoming.location, ts.id AS session_id
         FROM incoming
         JOIN tracking_sessions ts
           ON ts.ended = true
          AND ts.path IS NOT NULL
          AND ST_DWithin(incoming.location, ts.path, 200)
       ), matches AS (
         SELECT candidate.destination_id, candidate.session_id
         FROM candidates candidate
         JOIN LATERAL (
           SELECT 1
           FROM tracking_points point
           WHERE point.session_id = candidate.session_id
             AND point.location IS NOT NULL
             AND ST_DWithin(candidate.location, point.location, 200)
           LIMIT 1
         ) proof ON true
         WHERE NOT EXISTS (
           SELECT 1 FROM session_destinations existing
           WHERE existing.session_id = candidate.session_id
             AND existing.destination_id = candidate.destination_id
         )
           AND NOT EXISTS (
             SELECT 1 FROM session_destination_rejections rejection
             WHERE rejection.session_id = candidate.session_id
               AND rejection.destination_id = candidate.destination_id
           )
       )
       SELECT count(*)::int AS count FROM matches`,
      [JSON.stringify(rows)]
    );
    return Number(result.rows[0]?.count ?? 0);
  } catch (error) {
    console.error(`[viewpoint-expand] session-link estimate failed: ${(error as Error).message}`);
    return null;
  }
}

function rawElementCount(payload: unknown): number {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return 0;
  const elements = (payload as Record<string, unknown>).elements;
  return Array.isArray(elements) ? elements.length : 0;
}

async function buildReport(
  args: ViewpointExpansionArgs,
  snapshot: OverpassSnapshot,
  sourceCandidateCount: number,
  reviewedCandidateCount: number,
  supplementCount: number,
  candidateReview: CandidateReviewSummary,
  plan: ViewpointPlan
): Promise<ViewpointDryRunReport> {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    scope: {
      countryCode: args.countryCode,
      stateCode: args.stateCode,
      subdivisionCode: args.subdivisionCode,
      key: args.scopeKey,
      bbox: args.bbox,
    },
    query: queryForScope(args),
    querySha256: snapshot.querySha256,
    sourceFile: snapshot.sourceFile,
    sourceRawSha256: snapshot.rawSha256,
    osmTimestamp: snapshot.osmTimestamp,
    rawElementCount: rawElementCount(snapshot.payload),
    candidateCount: sourceCandidateCount,
    reviewedCandidateCount,
    supplementCount,
    candidateReview,
    potentialNewSessionLinks: await countPotentialSessionLinks(plan),
    plan,
  };
}

async function writeReport(file: string, report: ViewpointDryRunReport): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const raw = `${JSON.stringify(report, null, 2)}\n`;
  await fs.writeFile(file, raw);
  console.error(`[viewpoint-expand] wrote ${file}`);
  console.error(`[viewpoint-expand] report SHA-256 ${sha256(raw)}`);
}

function reportSummary(report: ViewpointDryRunReport): Record<string, unknown> {
  return {
    scope: report.scope,
    osmTimestamp: report.osmTimestamp,
    rawElements: report.rawElementCount,
    namedPublicCandidates: report.candidateCount,
    reviewedNamedCandidates: report.reviewedCandidateCount,
    curatedSupplements: report.supplementCount,
    reviewExcluded: report.candidateReview.excluded,
    reviewNeedsHuman: report.candidateReview.needsHuman,
    insertions: report.plan.additions.length,
    enrichments: report.plan.enrichments.length,
    unchanged: report.plan.unchanged.length,
    ambiguities: report.plan.ambiguities.length,
    elevationFailures: report.plan.elevationFailures.length,
    potentialNewSessionLinks: report.potentialNewSessionLinks,
    decisionFingerprint: report.plan.decisionFingerprint,
  };
}

async function readReviewedReport(args: ViewpointExpansionArgs): Promise<ViewpointDryRunReport> {
  const raw = await fs.readFile(args.reviewReport!, "utf8");
  if (sha256(raw) !== args.expectedReportSha256) {
    throw new Error("Reviewed report SHA-256 does not match --expected-report-sha256");
  }
  const report = JSON.parse(raw) as ViewpointDryRunReport;
  const reportKey = report.scope?.key ??
    (report.scope?.countryCode === "US" && report.scope?.stateCode
      ? `US-${report.scope.stateCode}`
      : report.scope?.countryCode);
  const reportBbox = report.scope?.bbox ?? null;
  const reportSubdivision = report.scope?.subdivisionCode ??
    (report.scope?.countryCode === "US" && report.scope?.stateCode
      ? `US-${report.scope.stateCode}`
      : null);
  if (report.version !== 1 || report.scope?.countryCode !== args.countryCode ||
      report.scope?.stateCode !== args.stateCode ||
      reportSubdivision !== args.subdivisionCode || reportKey !== args.scopeKey ||
      JSON.stringify(reportBbox) !== JSON.stringify(args.bbox)) {
    throw new Error("Reviewed report scope or version does not match this run");
  }
  return report;
}

async function insertAdditions(
  client: PoolClient,
  scope: ViewpointScope,
  additions: PlannedAddition[]
): Promise<number> {
  if (additions.length === 0) return 0;
  const result = await client.query(
    `WITH incoming AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
         destination_id text, name text, search_name text,
         lat double precision, lng double precision, elevation double precision,
         features destination_feature[], external_ids jsonb, metadata jsonb
       )
     )
     INSERT INTO destinations (
       id, name, search_name, elevation, prominence, location, geohash,
       type, activities, features, country_code, state_code, hero_image,
       external_ids, metadata, owner, created_at, updated_at
     )
     SELECT destination_id, name, search_name, elevation, NULL,
            ST_SetSRID(ST_MakePoint(lng, lat, elevation), 4326)::geography,
            NULL, 'point', '{outdoor-trek}', features, $2, $3,
            NULL, external_ids, metadata, 'peaks', NOW(), NOW()
     FROM incoming
     RETURNING id`,
    [JSON.stringify(additions.map((addition) => ({
      destination_id: addition.destinationId,
      name: addition.name,
      search_name: addition.searchName,
      lat: addition.lat,
      lng: addition.lng,
      elevation: addition.elevation,
      features: addition.features,
      external_ids: addition.externalIds,
      metadata: addition.metadata,
    }))), scope.countryCode, scope.stateCode]
  );
  return result.rowCount ?? 0;
}

async function enrichDestinations(
  client: PoolClient,
  enrichments: PlannedEnrichment[]
): Promise<number> {
  if (enrichments.length === 0) return 0;
  const result = await client.query(
    `WITH incoming AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
         destination_id text, external_id_field text, osm_id text,
         add_features destination_feature[],
         expected_features destination_feature[],
         expected_activities activity_type[], expected_external_ids jsonb
       )
     )
     UPDATE destinations destination
     SET features = destination.features || ARRAY(
           SELECT feature
           FROM unnest(incoming.add_features) AS feature
           WHERE NOT feature = ANY(destination.features)
         ),
         activities = CASE
           WHEN 'outdoor-trek'::activity_type = ANY(destination.activities)
             THEN destination.activities
           ELSE array_append(destination.activities, 'outdoor-trek'::activity_type)
         END,
         external_ids = destination.external_ids ||
           jsonb_build_object(incoming.external_id_field, incoming.osm_id),
         updated_at = NOW()
     FROM incoming
     WHERE destination.id = incoming.destination_id
       AND destination.features = incoming.expected_features
       AND destination.activities = incoming.expected_activities
       AND destination.external_ids = incoming.expected_external_ids
     RETURNING destination.id`,
    [JSON.stringify(enrichments.map((enrichment) => ({
      destination_id: enrichment.destinationId,
      external_id_field: enrichment.externalIdField,
      osm_id: enrichment.osmId,
      add_features: enrichment.addFeatures,
      expected_features: enrichment.expectedFeatures,
      expected_activities: enrichment.expectedActivities,
      expected_external_ids: enrichment.expectedExternalIds,
    })))]
  );
  return result.rowCount ?? 0;
}

async function backfillSessionLinks(
  client: PoolClient,
  destinationIds: string[]
): Promise<number> {
  if (destinationIds.length === 0) return 0;
  const result = await client.query(
    `WITH destination_candidates AS MATERIALIZED (
       SELECT destination.id AS destination_id,
              destination.location,
              destination_match_radius(destination.features) AS radius_m,
              session.id AS session_id
       FROM destinations destination
       JOIN tracking_sessions session
         ON destination.id = ANY($1::text[])
        AND destination.location IS NOT NULL
        AND destination.boundary IS NULL
        AND session.ended = true
        AND session.path IS NOT NULL
        AND ST_DWithin(
          destination.location,
          session.path,
          destination_match_radius(destination.features)
        )
     ), matches AS (
       SELECT candidate.destination_id, candidate.session_id
       FROM destination_candidates candidate
       JOIN LATERAL (
         SELECT 1
         FROM tracking_points point
         WHERE point.session_id = candidate.session_id
           AND point.location IS NOT NULL
           AND ST_DWithin(candidate.location, point.location, candidate.radius_m)
         LIMIT 1
       ) proof ON true
     )
     INSERT INTO session_destinations (session_id, destination_id, relation, source)
     SELECT DISTINCT match.session_id, match.destination_id,
            'reached'::session_destination_relation, 'auto'
     FROM matches match
     WHERE NOT EXISTS (
       SELECT 1 FROM session_destination_rejections rejection
       WHERE rejection.session_id = match.session_id
         AND rejection.destination_id = match.destination_id
     )
     ON CONFLICT (session_id, destination_id) DO NOTHING
     RETURNING session_id`,
    [destinationIds]
  );
  return result.rowCount ?? 0;
}

async function applyPlan(
  args: ViewpointExpansionArgs,
  report: ViewpointDryRunReport
): Promise<Record<string, number>> {
  const client = await db.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `peaks-viewpoint-import-${args.scopeKey}`,
    ]);

    const targetIds = report.plan.enrichments.map((enrichment) => enrichment.destinationId);
    if (targetIds.length > 0) {
      await client.query("SELECT id FROM destinations WHERE id = ANY($1::text[]) FOR UPDATE", [targetIds]);
    }
    const additionIds = report.plan.additions.map((addition) => addition.destinationId);
    if (additionIds.length > 0) {
      const collision = await client.query(
        "SELECT id FROM destinations WHERE id = ANY($1::text[]) LIMIT 1",
        [additionIds]
      );
      if (collision.rows.length > 0) {
        throw new Error(`Destination ID collision: ${collision.rows[0].id}`);
      }
    }

    const enriched = await enrichDestinations(client, report.plan.enrichments);
    if (enriched !== report.plan.enrichments.length) {
      throw new Error("An enrichment target changed after dry-run; rerun review");
    }
    const inserted = await insertAdditions(client, args, report.plan.additions);
    if (inserted !== report.plan.additions.length) {
      throw new Error("Not every reviewed viewpoint was inserted");
    }
    const sessionLinks = await backfillSessionLinks(client, [...targetIds, ...additionIds]);
    await client.query("COMMIT");
    return { inserted, enriched, sessionLinks };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function runViewpointExpansion(
  args: ViewpointExpansionArgs
): Promise<void> {
  const reviewed = args.apply ? await readReviewedReport(args) : null;
  if (args.apply && !args.input && !reviewed?.sourceFile) {
    throw new Error("Apply requires --input or a reviewed report with sourceFile");
  }
  if (args.apply && !args.input && reviewed?.sourceFile) args.input = reviewed.sourceFile;

  const snapshot = await loadSnapshot(args);
  const sourceCandidates = parseOsmViewpointElements(snapshot.payload);
  const reviewedCandidates = await applyCandidateReviews(
    sourceCandidates,
    args.candidateReviews
  );
  const supplements = await loadSupplement(args.supplement);
  const combinedCandidates = [...reviewedCandidates.candidates, ...supplements];
  const combinedIdentities = combinedCandidates.map((candidate) =>
    osmViewpointIdentity(candidate.osmType, candidate.osmId)
  );
  if (new Set(combinedIdentities).size !== combinedIdentities.length) {
    throw new Error("A curated supplement repeats a reviewed named OSM candidate");
  }
  const plan = await buildPlan(combinedCandidates, args, args.concurrency);
  const report = await buildReport(
    args,
    snapshot,
    sourceCandidates.length,
    reviewedCandidates.candidates.length,
    supplements.length,
    reviewedCandidates.summary,
    plan
  );

  if (!args.apply) {
    if (args.report) await writeReport(args.report, report);
    console.log(JSON.stringify(reportSummary(report), null, 2));
    return;
  }

  if (reviewed!.querySha256 !== report.querySha256 ||
      reviewed!.sourceRawSha256 !== report.sourceRawSha256 ||
      reviewed!.candidateReview.fingerprint !== report.candidateReview.fingerprint ||
      reviewed!.plan.decisionFingerprint !== report.plan.decisionFingerprint) {
    throw new Error("OSM snapshot or database decisions changed after dry-run; rerun review");
  }
  if (report.plan.ambiguities.length > 0 || report.plan.elevationFailures.length > 0) {
    throw new Error("Apply is blocked while ambiguities or elevation failures remain");
  }
  if (report.candidateReview.fingerprint == null) {
    throw new Error("Apply requires complete --candidate-reviews");
  }

  const applied = await applyPlan(args, report);
  console.log(JSON.stringify({ ...reportSummary(report), applied }, null, 2));
}

if (/(?:^|[/\\])expand-viewpoint-coverage\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runViewpointExpansion(parseViewpointExpansionArgs())
    .then(() => db.end())
    .catch(async (error) => {
      console.error(error);
      await db.end();
      process.exit(1);
    });
}
