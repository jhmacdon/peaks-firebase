/**
 * Read-only audit for fractional destination elevation evidence.
 *
 * The audit starts with Peaks-owned destinations whose stored metre elevation
 * is an integer. It follows only exact provider IDs, proves that each provider
 * still names the same place, and writes a resumable JSON report. It has no
 * apply mode.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import db from "./db";

const OSM_IDENTITY_DISTANCE_M = 100;
const WIKIDATA_IDENTITY_DISTANCE_M = 100;
const DIRECT_METRE_AGREEMENT_M = 1e-6;
const OSM_BATCH_SIZE = 1_000;
const WIKIDATA_BATCH_SIZE = 50;
const METRE_UNIT = "Q11573";
const FOOT_UNIT = "Q3710";

const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

export interface AuditArgs {
  cacheDir: string;
  reportPath: string;
}

interface DestinationRow {
  id: string;
  name: string | null;
  elevation: number | string;
  lat: number | string;
  lng: number | string;
  type: string;
  features: string[];
  country_code: string | null;
  state_code: string | null;
  external_ids: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
  metadata_source: string | null;
  catalog_audit: string | null;
  coverage_backfills: unknown;
}

export interface DestinationSnapshot {
  id: string;
  name: string | null;
  elevationM: number;
  lat: number;
  lng: number;
  type: string;
  features: string[];
  countryCode: string | null;
  stateCode: string | null;
  externalIds: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
  provenance?: {
    metadataSource: string | null;
    catalogAudit: string | null;
    coverageBackfills: unknown;
  };
}

type OsmElementType = "node" | "way";

export interface OsmElement {
  type: OsmElementType;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
  timestamp?: string;
  version?: number;
}

interface OverpassResponse {
  elements?: OsmElement[];
  remark?: string;
}

interface WikidataQuantity {
  amount?: string;
  unit?: string;
  lowerBound?: string;
  upperBound?: string;
}

interface WikidataCoordinate {
  latitude?: number;
  longitude?: number;
  globe?: string;
}

interface WikidataClaim {
  id?: string;
  rank?: "preferred" | "normal" | "deprecated";
  mainsnak?: {
    snaktype?: string;
    datavalue?: { value?: WikidataQuantity | WikidataCoordinate };
  };
}

export interface WikidataEntity {
  missing?: string;
  claims?: Record<string, WikidataClaim[]>;
}

interface WikidataResponse {
  entities?: Record<string, WikidataEntity>;
}

export type EvidenceUnit = "metre" | "foot";

export interface ElevationEvidence {
  provider: "osm" | "wikidata";
  providerId: string;
  sourceUrl: string;
  rawValue: string;
  rawUnit: string;
  unit: EvidenceUnit;
  valueM: number;
  deltaM: number;
  rank?: string;
  claimId?: string;
  sourceTimestamp?: string;
  sourceVersion?: number;
}

export type AuditClassification =
  | "direct_metre_fraction_candidate"
  | "source_fraction_added_after_destination"
  | "source_fraction_timing_unknown"
  | "unit_conversion_fraction"
  | "rounded_down_near_match"
  | "cross_boundary_near_match"
  | "direct_source_conflict"
  | "identity_conflict"
  | "identity_unproven"
  | "source_delta_out_of_range"
  | "source_whole_metre"
  | "source_without_elevation"
  | "source_not_found"
  | "unsupported_source_only";

export interface DestinationAuditResult {
  destination: DestinationSnapshot;
  classification: AuditClassification;
  applyCandidate: boolean;
  proposedElevationM: number | null;
  reasons: string[];
  identity: {
    osm?: Record<string, unknown>;
    wikidata?: Record<string, unknown>;
  };
  evidence: ElevationEvidence[];
  provenanceTiming?: {
    status: "preexisting" | "later" | "unknown";
    cutoffAt: string | null;
    cutoffBasis: "destination_created_at" | "osm_id_backfill" | "unknown";
    provider: "osm";
    providerId: string;
    proof: "current_version" | "history_version" | null;
    matchingVersion: OsmElevationHistoryVersion | null;
    firstMatchingVersion: OsmElevationHistoryVersion | null;
    versionAtOrBeforeCutoff: OsmElevationHistoryVersion | null;
  };
}

export interface OsmElevationHistoryVersion {
  version: number;
  timestamp: string;
  visible: boolean;
  rawValue: string | null;
  rawUnit: string | null;
  unit: EvidenceUnit | null;
  valueM: number | null;
}

function value(argv: string[], key: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
}

export function parseArgs(argv = process.argv.slice(2)): AuditArgs {
  if (argv.some((arg) => arg === "--apply" || arg.startsWith("--apply="))) {
    throw new Error("This audit is read-only and has no --apply mode");
  }
  const cacheDir = path.resolve(value(argv, "cache-dir") ?? "/tmp/peaks-destination-elevation-fractions/cache");
  const reportPath = path.resolve(value(argv, "report") ?? "/tmp/peaks-destination-elevation-fractions/report.json");
  return { cacheDir, reportPath };
}

function providerId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}

function snapshot(row: DestinationRow): DestinationSnapshot {
  const externalIds = Object.fromEntries(
    Object.entries(row.external_ids ?? {}).flatMap(([key, raw]) => {
      const parsed = providerId(raw);
      return parsed ? [[key, parsed]] : [];
    })
  );
  return {
    id: row.id,
    name: row.name,
    elevationM: Number(row.elevation),
    lat: Number(row.lat),
    lng: Number(row.lng),
    type: row.type,
    features: row.features ?? [],
    countryCode: row.country_code,
    stateCode: row.state_code,
    externalIds,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    provenance: {
      metadataSource: row.metadata_source,
      catalogAudit: row.catalog_audit,
      coverageBackfills: row.coverage_backfills,
    },
  };
}

function unitId(raw: string | undefined): string | null {
  return raw?.split("/").pop() ?? null;
}

function strictNumber(raw: string): number | null {
  const trimmed = raw.trim();
  const plain = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed);
  const grouped = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(trimmed);
  if (!plain && !grouped) return null;
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseOsmElevationTags(tags: Record<string, string> | undefined): Array<{
  rawValue: string;
  rawUnit: string;
  unit: EvidenceUnit;
  valueM: number;
}> {
  const output: Array<{ rawValue: string; rawUnit: string; unit: EvidenceUnit; valueM: number }> = [];
  const ele = tags?.ele?.trim();
  if (ele) {
    const feet = ele.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+|\d{1,3}(?:,\d{3})+(?:\.\d+)?))\s*(?:ft|feet|foot)$/i);
    const metres = ele.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+|\d{1,3}(?:,\d{3})+(?:\.\d+)?))\s*(?:m|metres?|meters?)?$/i);
    if (feet) {
      const parsed = strictNumber(feet[1]);
      if (parsed != null) output.push({ rawValue: ele, rawUnit: "ft", unit: "foot", valueM: parsed * 0.3048 });
    } else if (metres) {
      const parsed = strictNumber(metres[1]);
      if (parsed != null) output.push({ rawValue: ele, rawUnit: "m", unit: "metre", valueM: parsed });
    }
  }
  const eleFeet = tags?.["ele:ft"]?.trim();
  if (eleFeet) {
    const parsed = strictNumber(eleFeet.replace(/\s*(?:ft|feet|foot)$/i, ""));
    if (parsed != null) output.push({ rawValue: eleFeet, rawUnit: "ft", unit: "foot", valueM: parsed * 0.3048 });
  }
  return output;
}

export function parseWikidataElevationClaims(entity: WikidataEntity | undefined): Array<{
  rawValue: string;
  rawUnit: string;
  unit: EvidenceUnit;
  valueM: number;
  rank: string;
  claimId?: string;
}> {
  return (entity?.claims?.P2044 ?? []).flatMap((claim) => {
    if (claim.rank === "deprecated" || claim.mainsnak?.snaktype !== "value") return [];
    const quantity = claim.mainsnak.datavalue?.value as WikidataQuantity | undefined;
    const parsed = quantity?.amount ? strictNumber(quantity.amount) : null;
    const unit = unitId(quantity?.unit);
    if (parsed == null || (unit !== METRE_UNIT && unit !== FOOT_UNIT)) return [];
    return [{
      rawValue: quantity!.amount!,
      rawUnit: unit!,
      unit: unit === METRE_UNIT ? "metre" as const : "foot" as const,
      valueM: unit === METRE_UNIT ? parsed : parsed * 0.3048,
      rank: claim.rank ?? "normal",
      claimId: claim.id,
    }];
  });
}

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    output.push(values.slice(offset, offset + size));
  }
  return output;
}

function stableHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 20);
}

async function readCache<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeCache(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, "utf8");
  await fs.rename(temporary, file);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function buildOverpassIdQuery(nodeIds: string[], wayIds: string[]): string {
  const lines = ["[out:json][timeout:180];", "("];
  if (nodeIds.length > 0) lines.push(`node(id:${nodeIds.join(",")});`);
  if (wayIds.length > 0) lines.push(`way(id:${wayIds.join(",")});`);
  lines.push(");", "out meta center;");
  return lines.join("\n");
}

function osmTypesFor(destination: DestinationSnapshot, key: string): OsmElementType[] {
  if (key === "osm_node") return ["node"];
  if (key === "osm_way") return ["way"];
  if (destination.features.includes("summit")) return ["node"];
  if (destination.features.includes("campsite")) {
    return destination.type === "region" ? ["way"] : ["node"];
  }
  if (destination.features.includes("waterfall")) return ["node", "way"];
  if (destination.type === "region") return ["way"];
  return ["node"];
}

interface OsmRequestIndex {
  nodeIds: Set<string>;
  wayIds: Set<string>;
}

function buildOsmRequestIndex(destinations: DestinationSnapshot[]): OsmRequestIndex {
  const index: OsmRequestIndex = { nodeIds: new Set(), wayIds: new Set() };
  for (const destination of destinations) {
    for (const key of ["osm", "osm_node", "osm_way"]) {
      const id = destination.externalIds[key];
      if (!id || !/^\d+$/.test(id)) continue;
      for (const type of osmTypesFor(destination, key)) {
        (type === "node" ? index.nodeIds : index.wayIds).add(id);
      }
    }
  }
  return index;
}

async function fetchOverpassBatch(
  query: string,
  cacheDir: string
): Promise<OverpassResponse> {
  const file = path.join(cacheDir, "osm", `${stableHash(query)}.json`);
  const cached = await readCache<OverpassResponse>(file);
  if (cached) return cached;

  const configured = process.env.OVERPASS_ENDPOINT?.trim();
  const endpoints = configured
    ? [configured, ...OVERPASS_ENDPOINTS.filter((endpoint) => endpoint !== configured)]
    : OVERPASS_ENDPOINTS;
  let lastError: unknown = null;
  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 195_000);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          body: `data=${encodeURIComponent(query)}`,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "PeaksApp-destination-elevation-audit/1.0 (https://github.com/jhmacdon/peaks-firebase)",
          },
          signal: controller.signal,
        });
        if (!response.ok) {
          lastError = new Error(`Overpass HTTP ${response.status} from ${endpoint}`);
        } else {
          const payload = await response.json() as OverpassResponse;
          if (payload.remark || !Array.isArray(payload.elements)) {
            lastError = new Error(payload.remark ?? `Overpass response from ${endpoint} has no elements`);
          } else {
            await writeCache(file, payload);
            return payload;
          }
        }
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
      if (attempt < 2) await sleep(1_000 * 2 ** attempt);
    }
  }
  throw lastError ?? new Error("All Overpass endpoints failed");
}

async function fetchOsmElements(
  destinations: DestinationSnapshot[],
  cacheDir: string
): Promise<Map<string, OsmElement>> {
  const request = buildOsmRequestIndex(destinations);
  const allIds = [...new Set([...request.nodeIds, ...request.wayIds])]
    .sort((left, right) => Number(left) - Number(right));
  const batches = chunks(allIds, OSM_BATCH_SIZE);
  const elements = new Map<string, OsmElement>();
  for (let index = 0; index < batches.length; index++) {
    const ids = batches[index];
    const nodeIds = ids.filter((id) => request.nodeIds.has(id));
    const wayIds = ids.filter((id) => request.wayIds.has(id));
    if (index === 0 || (index + 1) % 5 === 0 || index + 1 === batches.length) {
      console.error(`[destination-elevation-audit] OSM batch ${index + 1}/${batches.length}`);
    }
    const payload = await fetchOverpassBatch(buildOverpassIdQuery(nodeIds, wayIds), cacheDir);
    const requestedNodes = new Set(nodeIds);
    const requestedWays = new Set(wayIds);
    for (const element of payload.elements ?? []) {
      const id = String(element.id);
      if (
        (element.type === "node" && requestedNodes.has(id)) ||
        (element.type === "way" && requestedWays.has(id))
      ) {
        elements.set(`${element.type}:${id}`, element);
      }
    }
  }
  return elements;
}

async function fetchWikidataBatch(
  ids: string[],
  cacheDir: string
): Promise<WikidataResponse> {
  const key = ids.join("|");
  const file = path.join(cacheDir, "wikidata", `${stableHash(key)}.json`);
  const cached = await readCache<WikidataResponse>(file);
  if (cached) return cached;

  const url = new URL("https://www.wikidata.org/w/api.php");
  url.searchParams.set("action", "wbgetentities");
  url.searchParams.set("ids", key);
  url.searchParams.set("props", "claims");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxlag", "5");
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "PeaksApp-destination-elevation-audit/1.0 (https://github.com/jhmacdon/peaks-firebase)",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        lastError = new Error(`Wikidata HTTP ${response.status}`);
      } else {
        const payload = await response.json() as WikidataResponse;
        if (!payload.entities) {
          lastError = new Error("Wikidata response has no entities");
        } else {
          await writeCache(file, payload);
          return payload;
        }
      }
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < 3) await sleep(1_000 * 2 ** attempt);
  }
  throw lastError ?? new Error("Wikidata fetch failed");
}

async function fetchWikidataEntities(
  destinations: DestinationSnapshot[],
  cacheDir: string
): Promise<Map<string, WikidataEntity>> {
  const ids = [...new Set(destinations.map((destination) => destination.externalIds.wikidata)
    .filter((id): id is string => /^Q\d+$/.test(id ?? "")))]
    .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
  const batches = chunks(ids, WIKIDATA_BATCH_SIZE);
  const entities = new Map<string, WikidataEntity>();
  for (let index = 0; index < batches.length; index++) {
    if (index === 0 || (index + 1) % 50 === 0 || index + 1 === batches.length) {
      console.error(`[destination-elevation-audit] Wikidata batch ${index + 1}/${batches.length}`);
    }
    const payload = await fetchWikidataBatch(batches[index], cacheDir);
    for (const id of batches[index]) {
      if (payload.entities?.[id]) entities.set(id, payload.entities[id]);
    }
  }
  return entities;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function xmlAttributes(value: string): Record<string, string> {
  const output: Record<string, string> = {};
  const pattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/g;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    output[match[1]] = decodeXml(match[2]);
  }
  return output;
}

export function parseOsmHistoryXml(
  xml: string,
  expectedType: OsmElementType,
  expectedId: string
): OsmElevationHistoryVersion[] {
  const versions: OsmElevationHistoryVersion[] = [];
  const elementPattern = /<(node|way)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  for (let match = elementPattern.exec(xml); match; match = elementPattern.exec(xml)) {
    if (match[1] !== expectedType) continue;
    const attributes = xmlAttributes(match[2]);
    if (attributes.id !== expectedId) continue;
    const version = Number.parseInt(attributes.version ?? "", 10);
    const timestamp = attributes.timestamp;
    if (!Number.isSafeInteger(version) || version <= 0 || !timestamp) continue;
    const tags: Record<string, string> = {};
    const tagPattern = /<tag\b([^>]*)\/>/g;
    for (let tagMatch = tagPattern.exec(match[3] ?? ""); tagMatch; tagMatch = tagPattern.exec(match[3] ?? "")) {
      const tag = xmlAttributes(tagMatch[1]);
      if (tag.k != null && tag.v != null) tags[tag.k] = tag.v;
    }
    const parsed = parseOsmElevationTags(tags);
    const selected = parsed.find((entry) => entry.unit === "metre") ?? parsed[0];
    versions.push({
      version,
      timestamp,
      visible: attributes.visible !== "false",
      rawValue: selected?.rawValue ?? tags.ele ?? tags["ele:ft"] ?? null,
      rawUnit: selected?.rawUnit ?? null,
      unit: selected?.unit ?? null,
      valueM: selected?.valueM ?? null,
    });
  }
  return versions.sort((left, right) => left.version - right.version);
}

async function fetchOsmHistory(
  type: OsmElementType,
  id: string,
  cacheDir: string
): Promise<OsmElevationHistoryVersion[] | null> {
  const file = path.join(cacheDir, "osm-history", `${type}-${id}.json`);
  const cached = await readCache<OsmElevationHistoryVersion[]>(file);
  if (cached) return cached;
  const url = `https://api.openstreetmap.org/api/0.6/${type}/${id}/history`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/xml",
          "User-Agent": "PeaksApp-destination-elevation-audit/1.0 (https://github.com/jhmacdon/peaks-firebase)",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        lastError = new Error(`OSM history HTTP ${response.status} for ${type}/${id}`);
        if (response.status < 500 && response.status !== 429) break;
      } else {
        const versions = parseOsmHistoryXml(await response.text(), type, id);
        if (versions.length === 0) {
          lastError = new Error(`OSM history returned no versions for ${type}/${id}`);
        } else {
          await writeCache(file, versions);
          return versions;
        }
      }
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < 3) await sleep(1_000 * 2 ** attempt);
  }
  console.error(
    `[destination-elevation-audit] History unavailable for ${type}/${id}: ` +
    (lastError instanceof Error ? lastError.message : String(lastError))
  );
  return null;
}

function candidateOsmEvidence(result: DestinationAuditResult): ElevationEvidence | null {
  if (result.classification !== "direct_metre_fraction_candidate") return null;
  return result.evidence.find((entry) =>
    entry.provider === "osm" && entry.unit === "metre" &&
    result.proposedElevationM != null &&
    Math.abs(entry.valueM - result.proposedElevationM) <= DIRECT_METRE_AGREEMENT_M
  ) ?? null;
}

function provenanceCutoff(destination: DestinationSnapshot): {
  cutoffAt: string | null;
  cutoffBasis: "destination_created_at" | "osm_id_backfill" | "unknown";
} {
  const backfills = Array.isArray(destination.provenance?.coverageBackfills)
    ? destination.provenance!.coverageBackfills as Array<Record<string, unknown>>
    : [];
  const osmBackfillDates = backfills.flatMap((entry) => {
    if (entry.source !== "osm" || typeof entry.appliedAt !== "string") return [];
    const timestamp = Date.parse(entry.appliedAt);
    return Number.isFinite(timestamp) ? [new Date(timestamp).toISOString()] : [];
  }).sort();
  if (osmBackfillDates.length > 0) {
    return { cutoffAt: osmBackfillDates[0], cutoffBasis: "osm_id_backfill" };
  }
  if (destination.createdAt && Number.isFinite(Date.parse(destination.createdAt))) {
    return { cutoffAt: destination.createdAt, cutoffBasis: "destination_created_at" };
  }
  return { cutoffAt: null, cutoffBasis: "unknown" };
}

function parseOsmProviderId(providerId: string): { type: OsmElementType; id: string } | null {
  const match = providerId.match(/^(node|way)\/(\d+)$/);
  return match ? { type: match[1] as OsmElementType, id: match[2] } : null;
}

async function fetchNeededOsmHistories(
  preliminaryResults: DestinationAuditResult[],
  cacheDir: string
): Promise<Map<string, OsmElevationHistoryVersion[] | null>> {
  const requests = new Map<string, { type: OsmElementType; id: string }>();
  for (const result of preliminaryResults) {
    const evidence = candidateOsmEvidence(result);
    const provider = evidence ? parseOsmProviderId(evidence.providerId) : null;
    const cutoffValue = provenanceCutoff(result.destination).cutoffAt;
    const cutoff = cutoffValue ? Date.parse(cutoffValue) : Number.NaN;
    const created = result.destination.createdAt
      ? Date.parse(result.destination.createdAt)
      : Number.NaN;
    const currentTimestamp = evidence?.sourceTimestamp ? Date.parse(evidence.sourceTimestamp) : Number.NaN;
    if (provider && (
      !Number.isFinite(cutoff) || !Number.isFinite(currentTimestamp) ||
      currentTimestamp > cutoff ||
      (Number.isFinite(created) && currentTimestamp > created)
    )) {
      requests.set(`${provider.type}:${provider.id}`, provider);
    }
  }
  const histories = new Map<string, OsmElevationHistoryVersion[] | null>();
  let index = 0;
  for (const [key, request] of requests) {
    index++;
    console.error(`[destination-elevation-audit] OSM history ${index}/${requests.size}`);
    histories.set(key, await fetchOsmHistory(request.type, request.id, cacheDir));
  }
  return histories;
}

async function loadDestinations(): Promise<DestinationSnapshot[]> {
  const client = await db.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await client.query<DestinationRow>(
      `SELECT id, name, elevation,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lng,
              type::text, features::text[] AS features,
              country_code, state_code, external_ids,
              created_at, updated_at,
              metadata->>'source' AS metadata_source,
              metadata->>'catalog_audit' AS catalog_audit,
              metadata->'coverage_backfills' AS coverage_backfills
       FROM destinations
       WHERE owner = 'peaks'
         AND elevation IS NOT NULL
         AND elevation NOT IN ('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8)
         AND elevation = trunc(elevation)
         AND location IS NOT NULL
       ORDER BY id`
    );
    await client.query("COMMIT");
    return result.rows.map(snapshot);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function haversineMeters(
  left: { lat: number; lng: number },
  right: { lat: number; lng: number }
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const leftLat = radians(left.lat);
  const rightLat = radians(right.lat);
  const deltaLat = rightLat - leftLat;
  const deltaLng = radians(right.lng - left.lng);
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function osmCoordinate(element: OsmElement): { lat: number; lng: number } | null {
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat: lat!, lng: lng! } : null;
}

function osmFeatureMatches(destination: DestinationSnapshot, element: OsmElement): boolean {
  const tags = element.tags ?? {};
  if (destination.features.includes("summit")) return tags.natural === "peak";
  if (destination.features.includes("waterfall")) return tags.waterway === "waterfall";
  if (destination.features.includes("campsite")) return tags.tourism === "camp_site";
  if (destination.features.includes("trailhead")) {
    return tags.highway === "trailhead" || tags.information === "trailhead";
  }
  return true;
}

type IdentityStatus = "valid" | "conflict" | "unproven" | "not_found";

interface ResolvedOsmReference {
  key: string;
  id: string;
  element: OsmElement | null;
  status: IdentityStatus;
  distanceM: number | null;
  linkedWikidata: boolean;
  reason: string;
}

function resolveOsmReference(
  destination: DestinationSnapshot,
  key: string,
  id: string,
  elements: Map<string, OsmElement>
): ResolvedOsmReference {
  const candidates = osmTypesFor(destination, key)
    .map((type) => elements.get(`${type}:${id}`))
    .filter((element): element is OsmElement => Boolean(element));
  if (candidates.length === 0) {
    return {
      key, id, element: null, status: "not_found", distanceM: null,
      linkedWikidata: false, reason: "exact_osm_element_not_found",
    };
  }

  const ranked = candidates.map((element) => {
    const coordinate = osmCoordinate(element);
    return {
      element,
      featureMatch: osmFeatureMatches(destination, element),
      distanceM: coordinate ? haversineMeters(destination, coordinate) : null,
    };
  }).sort((left, right) =>
    Number(right.featureMatch) - Number(left.featureMatch) ||
    (left.distanceM ?? Number.POSITIVE_INFINITY) - (right.distanceM ?? Number.POSITIVE_INFINITY)
  );
  if (ranked.length > 1) {
    const first = ranked[0];
    const second = ranked[1];
    const firstClearlyWins =
      (first.featureMatch && !second.featureMatch) ||
      ((first.distanceM ?? Number.POSITIVE_INFINITY) <= OSM_IDENTITY_DISTANCE_M &&
       (second.distanceM ?? Number.POSITIVE_INFINITY) > OSM_IDENTITY_DISTANCE_M);
    if (!firstClearlyWins) {
      return {
        key, id, element: null, status: "conflict", distanceM: null,
        linkedWikidata: false, reason: "osm_id_exists_in_multiple_unresolved_namespaces",
      };
    }
  }

  const selected = ranked[0];
  const coordinate = osmCoordinate(selected.element);
  if (!coordinate || selected.distanceM == null) {
    return {
      key, id, element: selected.element, status: "unproven", distanceM: null,
      linkedWikidata: false, reason: "osm_element_has_no_identity_coordinate",
    };
  }
  if (selected.distanceM > OSM_IDENTITY_DISTANCE_M) {
    return {
      key, id, element: selected.element, status: "conflict", distanceM: selected.distanceM,
      linkedWikidata: false, reason: "osm_element_is_more_than_100m_from_destination",
    };
  }
  const expectedWikidata = destination.externalIds.wikidata;
  const taggedWikidata = selected.element.tags?.wikidata?.trim();
  if (expectedWikidata && taggedWikidata && expectedWikidata !== taggedWikidata) {
    return {
      key, id, element: selected.element, status: "conflict", distanceM: selected.distanceM,
      linkedWikidata: false, reason: "osm_wikidata_tag_conflicts_with_stored_wikidata_id",
    };
  }
  return {
    key,
    id,
    element: selected.element,
    status: "valid",
    distanceM: selected.distanceM,
    linkedWikidata: Boolean(expectedWikidata && taggedWikidata === expectedWikidata),
    reason: "exact_osm_id_and_coordinate_match",
  };
}

function resolveOsmReferences(
  destination: DestinationSnapshot,
  elements: Map<string, OsmElement>
): ResolvedOsmReference[] {
  return ["osm", "osm_node", "osm_way"].flatMap((key) => {
    const id = destination.externalIds[key];
    return id && /^\d+$/.test(id) ? [resolveOsmReference(destination, key, id, elements)] : [];
  });
}

function selectedClaims(claims: WikidataClaim[] | undefined): WikidataClaim[] {
  const usable = (claims ?? []).filter((claim) =>
    claim.rank !== "deprecated" && claim.mainsnak?.snaktype === "value"
  );
  const preferred = usable.filter((claim) => claim.rank === "preferred");
  return preferred.length > 0 ? preferred : usable;
}

function wikidataCoordinates(entity: WikidataEntity | undefined): Array<{ lat: number; lng: number }> {
  return selectedClaims(entity?.claims?.P625).flatMap((claim) => {
    const coordinate = claim.mainsnak?.datavalue?.value as WikidataCoordinate | undefined;
    const globe = unitId(coordinate?.globe);
    if (
      !Number.isFinite(coordinate?.latitude) ||
      !Number.isFinite(coordinate?.longitude) ||
      (globe != null && globe !== "Q2")
    ) return [];
    return [{ lat: coordinate!.latitude!, lng: coordinate!.longitude! }];
  });
}

interface WikidataIdentity {
  status: IdentityStatus;
  reason: string;
  distanceM: number | null;
  linkedFromOsm: boolean;
  coordinateClaims: number;
}

function resolveWikidataIdentity(
  destination: DestinationSnapshot,
  entity: WikidataEntity | undefined,
  osmReferences: ResolvedOsmReference[]
): WikidataIdentity | null {
  const id = destination.externalIds.wikidata;
  if (!id) return null;
  if (!entity || entity.missing != null) {
    return {
      status: "not_found", reason: "exact_wikidata_entity_not_found", distanceM: null,
      linkedFromOsm: false, coordinateClaims: 0,
    };
  }
  const linkedFromOsm = osmReferences.some((reference) =>
    reference.status === "valid" && reference.linkedWikidata
  );
  const coordinates = wikidataCoordinates(entity);
  if (coordinates.length > 0) {
    const distanceM = Math.min(...coordinates.map((coordinate) =>
      haversineMeters(destination, coordinate)
    ));
    if (distanceM > WIKIDATA_IDENTITY_DISTANCE_M) {
      return {
        status: "conflict", reason: "wikidata_coordinate_is_more_than_100m_from_destination",
        distanceM, linkedFromOsm, coordinateClaims: coordinates.length,
      };
    }
    return {
      status: "valid", reason: "exact_wikidata_id_and_coordinate_match", distanceM,
      linkedFromOsm, coordinateClaims: coordinates.length,
    };
  }
  if (linkedFromOsm) {
    return {
      status: "valid", reason: "wikidata_identity_confirmed_by_nearby_exact_osm_link",
      distanceM: null, linkedFromOsm, coordinateClaims: 0,
    };
  }
  return {
    status: "unproven", reason: "wikidata_has_no_coordinate_or_nearby_exact_osm_link",
    distanceM: null, linkedFromOsm, coordinateClaims: 0,
  };
}

interface InternalEvidence extends ElevationEvidence {
  identityStatus: IdentityStatus;
}

function osmEvidence(
  destination: DestinationSnapshot,
  references: ResolvedOsmReference[]
): InternalEvidence[] {
  return references.flatMap((reference) => {
    if (!reference.element) return [];
    const element = reference.element;
    return parseOsmElevationTags(element.tags).map((parsed) => ({
      provider: "osm" as const,
      providerId: `${element.type}/${element.id}`,
      sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      ...parsed,
      deltaM: parsed.valueM - destination.elevationM,
      sourceTimestamp: element.timestamp,
      sourceVersion: element.version,
      identityStatus: reference.status,
    }));
  });
}

function wikidataEvidence(
  destination: DestinationSnapshot,
  entity: WikidataEntity | undefined,
  identity: WikidataIdentity | null
): InternalEvidence[] {
  const id = destination.externalIds.wikidata;
  if (!id || !entity || !identity) return [];
  const claims = parseWikidataElevationClaims({
    ...entity,
    claims: { ...entity.claims, P2044: selectedClaims(entity.claims?.P2044) },
  });
  return claims.map((parsed) => ({
    provider: "wikidata" as const,
    providerId: id,
    sourceUrl: `https://www.wikidata.org/wiki/${id}`,
    ...parsed,
    deltaM: parsed.valueM - destination.elevationM,
    identityStatus: identity.status,
  }));
}

export function isSafeDirectMetreCandidate(currentM: number, sourceM: number): boolean {
  const deltaM = sourceM - currentM;
  return Number.isFinite(currentM) && Number.isFinite(sourceM) &&
    Number.isInteger(currentM) && !Number.isInteger(sourceM) &&
    sourceM > currentM && deltaM > 0 && deltaM < 1 &&
    Math.trunc(sourceM) === currentM;
}

function publicEvidence(evidence: InternalEvidence[]): ElevationEvidence[] {
  return evidence.map(({ identityStatus: _identityStatus, ...entry }) => entry);
}

export function auditDestination(
  destination: DestinationSnapshot,
  osmElements: Map<string, OsmElement>,
  wikidataEntities: Map<string, WikidataEntity>
): DestinationAuditResult {
  const osmReferences = resolveOsmReferences(destination, osmElements);
  const wikidataId = destination.externalIds.wikidata;
  const wikidataEntity = wikidataId ? wikidataEntities.get(wikidataId) : undefined;
  const wikidataIdentity = resolveWikidataIdentity(destination, wikidataEntity, osmReferences);
  const evidence = [
    ...osmEvidence(destination, osmReferences),
    ...wikidataEvidence(destination, wikidataEntity, wikidataIdentity),
  ];
  const identityRecords = [
    ...osmReferences.map((reference) => reference.status),
    ...(wikidataIdentity ? [wikidataIdentity.status] : []),
  ];
  const identity = {
    osm: osmReferences.length > 0 ? {
      references: osmReferences.map((reference) => ({
        key: reference.key,
        id: reference.id,
        elementType: reference.element?.type ?? null,
        status: reference.status,
        reason: reference.reason,
        distanceM: reference.distanceM,
        linkedWikidata: reference.linkedWikidata,
      })),
    } : undefined,
    wikidata: wikidataIdentity ? {
      id: wikidataId,
      ...wikidataIdentity,
    } : undefined,
  };
  const result = (
    classification: AuditClassification,
    reasons: string[],
    proposedElevationM: number | null = null
  ): DestinationAuditResult => ({
    destination,
    classification,
    applyCandidate: classification === "direct_metre_fraction_candidate",
    proposedElevationM,
    reasons,
    identity,
    evidence: publicEvidence(evidence),
  });

  const hasSupportedId = osmReferences.length > 0 || Boolean(wikidataId);
  if (!hasSupportedId) {
    return result("unsupported_source_only", ["no_supported_exact_elevation_provider_id"]);
  }
  if (identityRecords.includes("conflict")) {
    return result("identity_conflict", ["one_or_more_provider_ids_are_stale_or_misaligned"]);
  }
  if (identityRecords.includes("unproven")) {
    return result("identity_unproven", ["provider_identity_lacks_coordinate_or_link_proof"]);
  }
  const validEvidence = evidence.filter((entry) => entry.identityStatus === "valid");
  const directMetres = validEvidence.filter((entry) => entry.unit === "metre");
  if (directMetres.length > 1) {
    const values = directMetres.map((entry) => entry.valueM);
    if (Math.max(...values) - Math.min(...values) > DIRECT_METRE_AGREEMENT_M) {
      return result("direct_source_conflict", ["direct_metre_providers_disagree"]);
    }
  }

  const candidate = directMetres
    .sort((left, right) => left.provider.localeCompare(right.provider) || left.valueM - right.valueM)
    .find((entry) => isSafeDirectMetreCandidate(destination.elevationM, entry.valueM));
  if (candidate) {
    return result(
      "direct_metre_fraction_candidate",
      ["exact_direct_metre_source_restores_only_the_positive_fractional_component"],
      candidate.valueM
    );
  }

  const imperialFraction = validEvidence.find((entry) =>
    entry.unit === "foot" && !Number.isInteger(entry.valueM) &&
    entry.deltaM > 0 && entry.deltaM < 1
  );
  if (imperialFraction) {
    return result(
      "unit_conversion_fraction",
      ["exact_foot_source_converts_to_a_positive_sub_metre_fraction_but_is_not_an_apply_candidate"]
    );
  }

  const crossBoundary = validEvidence.find((entry) =>
    !Number.isInteger(entry.valueM) && Math.abs(entry.deltaM) < 1 &&
    Math.trunc(entry.valueM) !== destination.elevationM
  );
  if (crossBoundary) {
    return result("cross_boundary_near_match", ["nearby_source_value_changes_the_whole_metre_part"]);
  }
  const sourceBelow = validEvidence.find((entry) =>
    !Number.isInteger(entry.valueM) && entry.deltaM < 0 && Math.abs(entry.deltaM) < 1
  );
  if (sourceBelow) {
    return result("rounded_down_near_match", ["source_is_below_the_stored_integer_and_cannot_be_added"]);
  }
  if (validEvidence.some((entry) => Number.isInteger(entry.valueM))) {
    return result("source_whole_metre", ["exact_source_elevation_has_no_fractional_metre_component"]);
  }
  if (validEvidence.length > 0) {
    return result("source_delta_out_of_range", ["source_delta_is_not_a_positive_fraction_below_one_metre"]);
  }
  if (identityRecords.includes("valid")) {
    return result("source_without_elevation", ["identity_is_proven_but_source_has_no_supported_elevation"]);
  }
  return result("source_not_found", ["no_exact_provider_record_was_found"]);
}

function currentHistoryVersion(evidence: ElevationEvidence): OsmElevationHistoryVersion | null {
  if (!evidence.sourceTimestamp || evidence.sourceVersion == null) return null;
  return {
    version: evidence.sourceVersion,
    timestamp: evidence.sourceTimestamp,
    visible: true,
    rawValue: evidence.rawValue,
    rawUnit: evidence.rawUnit,
    unit: evidence.unit,
    valueM: evidence.valueM,
  };
}

export function refineCandidateProvenance(
  result: DestinationAuditResult,
  histories: Map<string, OsmElevationHistoryVersion[] | null>
): DestinationAuditResult {
  if (result.classification !== "direct_metre_fraction_candidate") return result;
  const evidence = candidateOsmEvidence(result);
  const provider = evidence ? parseOsmProviderId(evidence.providerId) : null;
  const { cutoffAt, cutoffBasis } = provenanceCutoff(result.destination);
  const cutoff = cutoffAt ? Date.parse(cutoffAt) : Number.NaN;
  const proposed = result.proposedElevationM;
  const unknown = (reason: string, timing: DestinationAuditResult["provenanceTiming"]): DestinationAuditResult => ({
    ...result,
    classification: "source_fraction_timing_unknown",
    applyCandidate: false,
    proposedElevationM: null,
    reasons: [reason],
    provenanceTiming: timing,
  });
  if (!evidence || !provider || proposed == null || !Number.isFinite(cutoff)) {
    return unknown("direct_fraction_lacks_osm_history_or_destination_creation_time", {
      status: "unknown",
      cutoffAt,
      cutoffBasis,
      provider: "osm",
      providerId: evidence?.providerId ?? "unknown",
      proof: null,
      matchingVersion: null,
      firstMatchingVersion: null,
      versionAtOrBeforeCutoff: null,
    });
  }

  const current = currentHistoryVersion(evidence);
  const currentTime = current ? Date.parse(current.timestamp) : Number.NaN;
  const historyKey = `${provider.type}:${provider.id}`;
  const hasFetchedHistory = histories.has(historyKey) && histories.get(historyKey) != null;
  if (current && Number.isFinite(currentTime) && currentTime <= cutoff && !hasFetchedHistory) {
    return {
      ...result,
      provenanceTiming: {
        status: "preexisting",
        cutoffAt,
        cutoffBasis,
        provider: "osm",
        providerId: evidence.providerId,
        proof: "current_version",
        matchingVersion: current,
        firstMatchingVersion: null,
        versionAtOrBeforeCutoff: current,
      },
    };
  }

  const versions = histories.get(historyKey);
  if (!versions) {
    if (current && Number.isFinite(currentTime) && currentTime <= cutoff) {
      return {
        ...result,
        provenanceTiming: {
          status: "preexisting",
          cutoffAt,
          cutoffBasis,
          provider: "osm",
          providerId: evidence.providerId,
          proof: "current_version",
          matchingVersion: current,
          firstMatchingVersion: null,
          versionAtOrBeforeCutoff: current,
        },
      };
    }
    return unknown("osm_history_was_unavailable_for_fraction_timing", {
      status: "unknown", cutoffAt, cutoffBasis, provider: "osm", providerId: evidence.providerId,
      proof: null, matchingVersion: null, firstMatchingVersion: null,
      versionAtOrBeforeCutoff: null,
    });
  }
  const timestamped = versions.filter((version) => Number.isFinite(Date.parse(version.timestamp)));
  const matching = timestamped.filter((version) =>
    version.visible && version.unit === "metre" && version.valueM != null &&
    Math.abs(version.valueM - proposed) <= DIRECT_METRE_AGREEMENT_M
  );
  const firstMatchingVersion = matching[0] ?? null;
  const matchingBefore = matching.filter((version) => Date.parse(version.timestamp) <= cutoff);
  const versionAtOrBeforeCutoff = timestamped
    .filter((version) => Date.parse(version.timestamp) <= cutoff)
    .at(-1) ?? null;
  if (matchingBefore.length > 0) {
    return {
      ...result,
      provenanceTiming: {
        status: "preexisting",
        cutoffAt,
        cutoffBasis,
        provider: "osm",
        providerId: evidence.providerId,
        proof: "history_version",
        matchingVersion: matchingBefore.at(-1)!,
        firstMatchingVersion,
        versionAtOrBeforeCutoff,
      },
    };
  }
  if (firstMatchingVersion && Date.parse(firstMatchingVersion.timestamp) > cutoff) {
    return {
      ...result,
      classification: "source_fraction_added_after_destination",
      applyCandidate: false,
      proposedElevationM: null,
      reasons: ["matching_fraction_first_appears_after_destination_creation"],
      provenanceTiming: {
        status: "later",
        cutoffAt,
        cutoffBasis,
        provider: "osm",
        providerId: evidence.providerId,
        proof: "history_version",
        matchingVersion: firstMatchingVersion,
        firstMatchingVersion,
        versionAtOrBeforeCutoff,
      },
    };
  }
  return unknown("osm_history_does_not_prove_when_the_current_fraction_appeared", {
    status: "unknown", cutoffAt, cutoffBasis, provider: "osm", providerId: evidence.providerId,
    proof: null, matchingVersion: null, firstMatchingVersion,
    versionAtOrBeforeCutoff,
  });
}

function countBy(values: string[]): Record<string, number> {
  const output: Record<string, number> = {};
  for (const value of values) output[value] = (output[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(output).sort((left, right) =>
    right[1] - left[1] || left[0].localeCompare(right[0])
  ));
}

function countProviderIds(destinations: DestinationSnapshot[]): Record<string, number> {
  const keys = destinations.flatMap((destination) => Object.keys(destination.externalIds));
  return countBy(keys);
}

export async function runAudit(args: AuditArgs): Promise<Record<string, unknown>> {
  console.error("[destination-elevation-audit] Loading integer-looking Peaks destinations read-only");
  const destinations = await loadDestinations();
  console.error(`[destination-elevation-audit] Loaded ${destinations.length} destinations`);
  const [osmElements, wikidataEntities] = await Promise.all([
    fetchOsmElements(destinations, args.cacheDir),
    fetchWikidataEntities(destinations, args.cacheDir),
  ]);
  const preliminaryResults = destinations.map((destination) =>
    auditDestination(destination, osmElements, wikidataEntities)
  );
  const histories = await fetchNeededOsmHistories(preliminaryResults, args.cacheDir);
  const results = preliminaryResults.map((result) => refineCandidateProvenance(result, histories));
  if (results.length !== destinations.length) {
    throw new Error(`Audit coverage mismatch: ${results.length}/${destinations.length}`);
  }
  const classifications = countBy(results.map((result) => result.classification));
  const candidates = results.filter((result) => result.applyCandidate);
  for (const candidate of candidates) {
    const proposed = candidate.proposedElevationM;
    if (proposed == null || !isSafeDirectMetreCandidate(candidate.destination.elevationM, proposed)) {
      throw new Error(`Unsafe candidate escaped the final guard: ${candidate.destination.id}`);
    }
    if (!candidate.evidence.some((entry) =>
      entry.unit === "metre" && Math.abs(entry.valueM - proposed) <= DIRECT_METRE_AGREEMENT_M
    )) {
      throw new Error(`Candidate lacks direct metre evidence: ${candidate.destination.id}`);
    }
    if (candidate.provenanceTiming?.status !== "preexisting") {
      throw new Error(`Candidate lacks preexisting source history: ${candidate.destination.id}`);
    }
  }

  const preliminaryCandidates = preliminaryResults.filter((result) => result.applyCandidate);
  const provenanceTiming = countBy(preliminaryCandidates.map((preliminary) => {
    const final = results.find((result) => result.destination.id === preliminary.destination.id);
    return final?.provenanceTiming?.status ?? "unknown";
  }));

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dryRun: true,
    safety: {
      applyModeAvailable: false,
      storedUnit: "metre",
      candidateRule:
        "exact direct-metre provider ID; identity proven; providers agree; non-integer source; " +
        "source > current; delta > 0 and < 1 metre; trunc(source) = current; " +
        "the same fraction existed in OSM by destinations.created_at or the recorded OSM ID backfill",
      osmIdentityMaximumDistanceM: OSM_IDENTITY_DISTANCE_M,
      wikidataIdentityMaximumDistanceM: WIKIDATA_IDENTITY_DISTANCE_M,
      directMetreAgreementToleranceM: DIRECT_METRE_AGREEMENT_M,
      imperialValues: "reported as unit_conversion_fraction evidence; never proposed",
      terrainModels: "excluded because they are coordinate estimates, not exact source-ID evidence",
    },
    inventory: {
      destinationsAudited: destinations.length,
      providerIdCoverage: countProviderIds(destinations),
      destinationsWithAnyExternalId: destinations.filter((destination) =>
        Object.keys(destination.externalIds).length > 0
      ).length,
      destinationsWithSupportedId: destinations.filter((destination) =>
        Boolean(
          destination.externalIds.osm || destination.externalIds.osm_node ||
          destination.externalIds.osm_way || destination.externalIds.wikidata
        )
      ).length,
      features: countBy(destinations.flatMap((destination) =>
        destination.features.length > 0 ? destination.features : ["<none>"]
      )),
    },
    fetched: {
      osmElements: osmElements.size,
      osmNodes: [...osmElements.values()].filter((element) => element.type === "node").length,
      osmWays: [...osmElements.values()].filter((element) => element.type === "way").length,
      wikidataEntities: wikidataEntities.size,
      osmHistoriesRequested: histories.size,
      osmHistoriesFetched: [...histories.values()].filter((history) => history != null).length,
    },
    summary: {
      classifications,
      preliminaryDirectMetreFindings: preliminaryCandidates.length,
      provenanceTiming,
      applyCandidates: candidates.length,
      directMetreEvidence: results.flatMap((result) => result.evidence)
        .filter((entry) => entry.unit === "metre").length,
      imperialEvidence: results.flatMap((result) => result.evidence)
        .filter((entry) => entry.unit === "foot").length,
    },
    candidates,
    results,
  };
  const reviewReportPath = args.reportPath.endsWith(".json")
    ? `${args.reportPath.slice(0, -5)}.review.json`
    : `${args.reportPath}.review.json`;
  await fs.mkdir(path.dirname(args.reportPath), { recursive: true });
  await fs.writeFile(args.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(reviewReportPath, `${JSON.stringify({
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    dryRun: report.dryRun,
    fullReportPath: args.reportPath,
    safety: report.safety,
    inventory: report.inventory,
    fetched: report.fetched,
    summary: report.summary,
    candidates,
    imperialConversionReview: results.filter((result) =>
      result.classification === "unit_conversion_fraction"
    ),
  }, null, 2)}\n`, "utf8");
  console.error(`[destination-elevation-audit] Wrote ${args.reportPath}`);
  console.error(`[destination-elevation-audit] Wrote ${reviewReportPath}`);
  return { ...report, reviewReportPath };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const report = await runAudit(args);
  console.log(JSON.stringify({
    report: args.reportPath,
    reviewReport: report.reviewReportPath,
    inventory: report.inventory,
    fetched: report.fetched,
    summary: report.summary,
  }, null, 2));
}

if (/(?:^|[/\\])audit-destination-elevation-fractions\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => db.end());
}
