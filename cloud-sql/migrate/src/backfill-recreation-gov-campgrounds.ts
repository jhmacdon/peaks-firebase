/**
 * Audit and apply reviewed Recreation.gov campground links.
 *
 * Dry-run is the default. Without --review, the report proposes only unique
 * exact-name matches within 5 km. Applying requires a reviewed match file;
 * source and target names, locations, features, and IDs are checked again.
 *
 * Usage:
 *   RIDB_API_KEY=... npm run backfill:recreation-gov-campgrounds -- --report=/tmp/ridb-audit.json
 *   RIDB_API_KEY=... npm run backfill:recreation-gov-campgrounds -- --review=review.json
 *   RIDB_API_KEY=... npm run backfill:recreation-gov-campgrounds -- --review=review.json --apply
 *
 * Tests and repeatable audits can replace the live API with --source=facilities.json.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PoolClient } from "pg";
import db from "./db";

const RIDB_FACILITIES_URL = "https://ridb.recreation.gov/api/v1/facilities";
const PAGE_SIZE = 50;
const MAX_MATCH_DISTANCE_METERS = 5_000;
const NEARBY_DISTANCE_METERS = 10_000;

interface Args {
  apply: boolean;
  report: string | null;
  review: string | null;
  source: string | null;
}

interface RidbApiPage {
  RECDATA?: unknown;
  METADATA?: {
    RESULTS?: {
      TOTAL_COUNT?: number | string;
    };
  };
}

export interface RidbCampground {
  facilityId: string;
  name: string;
  lat: number;
  lng: number;
  lastUpdatedDate: string | null;
}

export interface CampsiteDestination {
  id: string;
  name: string;
  lat: number;
  lng: number;
  features: string[];
  externalIds: Record<string, unknown>;
}

export interface CampgroundMatchCandidate {
  facilityId: string;
  facilityName: string;
  distanceMeters: number;
}

export interface CampgroundAuditRow {
  destinationId: string;
  destinationName: string;
  candidates: CampgroundMatchCandidate[];
}

export interface CampgroundAudit {
  existing: Array<CampgroundAuditRow & { facilityId: string }>;
  proposals: Array<CampgroundAuditRow & { facilityId: string; facilityName: string }>;
  ambiguities: CampgroundAuditRow[];
  unmatched: Array<{ destinationId: string; destinationName: string }>;
}

export interface ReviewedCampgroundMatch {
  destinationId: string;
  destinationName: string;
  ridbFacilityId: string;
  facilityName: string;
}

export interface CampgroundReviewFile {
  version: 1;
  matches: ReviewedCampgroundMatch[];
}

export interface CampgroundUpdate {
  destinationId: string;
  destinationName: string;
  ridbFacilityId: string;
  expectedExternalIds: Record<string, unknown>;
  distanceMeters: number;
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const args: Args = { apply: false, report: null, review: null, source: null };
  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg.startsWith("--report=")) args.report = path.resolve(arg.slice(9));
    else if (arg.startsWith("--review=")) args.review = path.resolve(arg.slice(9));
    else if (arg.startsWith("--source=")) args.source = path.resolve(arg.slice(9));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.apply && !args.review) throw new Error("--apply requires --review");
  return args;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function booleanValue(value: unknown): boolean {
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

function numberValue(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseRidbCampgrounds(records: unknown): RidbCampground[] {
  if (!Array.isArray(records)) throw new Error("RIDB source has no RECDATA array");
  const campgrounds: RidbCampground[] = [];
  const seen = new Set<string>();
  for (const value of records) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    if (row.FacilityTypeDescription !== "Campground" || !booleanValue(row.Enabled) ||
        !booleanValue(row.Reservable)) continue;
    const facilityId = String(row.FacilityID ?? "").trim();
    const name = typeof row.FacilityName === "string" ? row.FacilityName.trim() : "";
    const lat = numberValue(row.FacilityLatitude);
    const lng = numberValue(row.FacilityLongitude);
    if (!/^[1-9]\d*$/.test(facilityId) || !name || lat == null || lng == null ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    if (seen.has(facilityId)) throw new Error(`RIDB source repeats facility ${facilityId}`);
    seen.add(facilityId);
    campgrounds.push({
      facilityId,
      name,
      lat,
      lng,
      lastUpdatedDate: typeof row.LastUpdatedDate === "string" ? row.LastUpdatedDate : null,
    });
  }
  return campgrounds.sort((left, right) => left.facilityId.localeCompare(right.facilityId));
}

export function normalizeCampgroundName(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function distanceMeters(
  left: { lat: number; lng: number },
  right: { lat: number; lng: number }
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latDelta = radians(right.lat - left.lat);
  const lngDelta = radians(right.lng - left.lng);
  const startLat = radians(left.lat);
  const endLat = radians(right.lat);
  const a = Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function candidate(
  destination: CampsiteDestination,
  facility: RidbCampground
): CampgroundMatchCandidate {
  return {
    facilityId: facility.facilityId,
    facilityName: facility.name,
    distanceMeters: Math.round(distanceMeters(destination, facility)),
  };
}

export function buildCampgroundAudit(
  facilities: RidbCampground[],
  destinations: CampsiteDestination[]
): CampgroundAudit {
  const facilityById = new Map(facilities.map((facility) => [facility.facilityId, facility]));
  const mappedFacilityIds = new Map<string, string>();
  for (const destination of destinations) {
    const facilityId = String(destination.externalIds.ridb_facility ?? "");
    if (!facilityId) continue;
    const prior = mappedFacilityIds.get(facilityId);
    if (prior && prior !== destination.id) {
      throw new Error(`RIDB facility ${facilityId} is mapped to ${prior} and ${destination.id}`);
    }
    mappedFacilityIds.set(facilityId, destination.id);
  }

  const audit: CampgroundAudit = { existing: [], proposals: [], ambiguities: [], unmatched: [] };
  for (const destination of destinations.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const currentId = String(destination.externalIds.ridb_facility ?? "");
    if (currentId) {
      const facility = facilityById.get(currentId);
      audit.existing.push({
        destinationId: destination.id,
        destinationName: destination.name,
        facilityId: currentId,
        candidates: facility ? [candidate(destination, facility)] : [],
      });
      continue;
    }

    const nearby = facilities
      .map((facility) => candidate(destination, facility))
      .filter((value) => value.distanceMeters <= NEARBY_DISTANCE_METERS)
      .sort((a, b) => a.distanceMeters - b.distanceMeters || a.facilityId.localeCompare(b.facilityId));
    const exactName = nearby.filter((value) =>
      value.distanceMeters <= MAX_MATCH_DISTANCE_METERS &&
      normalizeCampgroundName(value.facilityName) === normalizeCampgroundName(destination.name)
    );
    if (exactName.length === 1 && !mappedFacilityIds.has(exactName[0].facilityId)) {
      const match = exactName[0];
      audit.proposals.push({
        destinationId: destination.id,
        destinationName: destination.name,
        facilityId: match.facilityId,
        facilityName: match.facilityName,
        candidates: nearby.slice(0, 5),
      });
    } else if (nearby.length > 0) {
      audit.ambiguities.push({
        destinationId: destination.id,
        destinationName: destination.name,
        candidates: nearby.slice(0, 5),
      });
    } else {
      audit.unmatched.push({ destinationId: destination.id, destinationName: destination.name });
    }
  }

  const proposalDestinationsByFacility = new Map<string, string[]>();
  for (const proposal of audit.proposals) {
    const ids = proposalDestinationsByFacility.get(proposal.facilityId) ?? [];
    ids.push(proposal.destinationId);
    proposalDestinationsByFacility.set(proposal.facilityId, ids);
  }
  const repeatedFacilities = new Set(
    [...proposalDestinationsByFacility].filter(([, ids]) => ids.length > 1).map(([id]) => id)
  );
  if (repeatedFacilities.size > 0) {
    const kept = [] as CampgroundAudit["proposals"];
    for (const proposal of audit.proposals) {
      if (repeatedFacilities.has(proposal.facilityId)) {
        audit.ambiguities.push({
          destinationId: proposal.destinationId,
          destinationName: proposal.destinationName,
          candidates: proposal.candidates,
        });
      } else kept.push(proposal);
    }
    audit.proposals = kept;
    audit.ambiguities.sort((a, b) => a.destinationId.localeCompare(b.destinationId));
  }
  return audit;
}

export function buildReviewedCampgroundUpdates(
  review: CampgroundReviewFile,
  facilities: RidbCampground[],
  destinations: CampsiteDestination[]
): CampgroundUpdate[] {
  if (review.version !== 1 || !Array.isArray(review.matches)) {
    throw new Error("Campground review must have version 1 and a matches array");
  }
  const facilityById = new Map(facilities.map((facility) => [facility.facilityId, facility]));
  const destinationById = new Map(destinations.map((destination) => [destination.id, destination]));
  const reviewedDestinations = new Set<string>();
  const reviewedFacilities = new Set<string>();
  const currentFacilityOwners = new Map<string, string>();
  for (const destination of destinations) {
    const currentId = String(destination.externalIds.ridb_facility ?? "");
    if (!currentId) continue;
    const prior = currentFacilityOwners.get(currentId);
    if (prior && prior !== destination.id) {
      throw new Error(`RIDB facility ${currentId} is already mapped twice`);
    }
    currentFacilityOwners.set(currentId, destination.id);
  }

  const updates: CampgroundUpdate[] = [];
  for (const match of review.matches) {
    if (reviewedDestinations.has(match.destinationId)) {
      throw new Error(`Review repeats destination ${match.destinationId}`);
    }
    if (reviewedFacilities.has(match.ridbFacilityId)) {
      throw new Error(`Review repeats RIDB facility ${match.ridbFacilityId}`);
    }
    reviewedDestinations.add(match.destinationId);
    reviewedFacilities.add(match.ridbFacilityId);

    const destination = destinationById.get(match.destinationId);
    const facility = facilityById.get(match.ridbFacilityId);
    if (!destination) throw new Error(`Missing reviewed destination ${match.destinationId}`);
    if (!facility) throw new Error(`Missing reviewed RIDB facility ${match.ridbFacilityId}`);
    if (destination.name !== match.destinationName) {
      throw new Error(`Destination ${match.destinationId} changed name after review`);
    }
    if (facility.name !== match.facilityName) {
      throw new Error(`RIDB facility ${match.ridbFacilityId} changed name after review`);
    }
    if (!destination.features.includes("campsite")) {
      throw new Error(`Destination ${match.destinationId} is not a campsite`);
    }
    const separation = Math.round(distanceMeters(destination, facility));
    if (separation > MAX_MATCH_DISTANCE_METERS) {
      throw new Error(`Reviewed match ${match.destinationId} is ${separation} m apart`);
    }
    const currentId = destination.externalIds.ridb_facility;
    if (currentId != null && String(currentId) !== facility.facilityId) {
      throw new Error(`Destination ${match.destinationId} already has RIDB facility ${String(currentId)}`);
    }
    const currentOwner = currentFacilityOwners.get(facility.facilityId);
    if (currentOwner && currentOwner !== destination.id) {
      throw new Error(`RIDB facility ${facility.facilityId} already belongs to ${currentOwner}`);
    }
    if (currentId == null) {
      updates.push({
        destinationId: destination.id,
        destinationName: destination.name,
        ridbFacilityId: facility.facilityId,
        expectedExternalIds: destination.externalIds,
        distanceMeters: separation,
      });
    }
  }
  return updates.sort((left, right) => left.destinationId.localeCompare(right.destinationId));
}

async function fetchRidbRecords(apiKey: string): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  let offset = 0;
  let total: number | null = null;
  while (total == null || offset < total) {
    const url = new URL(RIDB_FACILITIES_URL);
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("full", "true");
    const response = await fetch(url, {
      headers: {
        apikey: apiKey,
        "user-agent": "Peaks RIDB campground audit (https://github.com/jhmacdon/peaks-firebase)",
      },
    });
    if (!response.ok) throw new Error(`RIDB facilities request failed with HTTP ${response.status}`);
    const page = await response.json() as RidbApiPage;
    if (!Array.isArray(page.RECDATA)) throw new Error("RIDB response has no RECDATA array");
    const pageTotal = numberValue(page.METADATA?.RESULTS?.TOTAL_COUNT);
    if (pageTotal == null || pageTotal < 0) throw new Error("RIDB response has no valid total count");
    if (total != null && total !== pageTotal) throw new Error("RIDB total count changed during pagination");
    total = pageTotal;
    if (page.RECDATA.length === 0 && offset < total) {
      throw new Error("RIDB pagination ended before the reported total");
    }
    records.push(...page.RECDATA as Record<string, unknown>[]);
    offset += page.RECDATA.length;
  }
  if (records.length !== total) throw new Error(`RIDB returned ${records.length} of ${total} facilities`);
  return records;
}

async function loadSource(args: Args): Promise<{ records: Record<string, unknown>[]; sha256: string }> {
  if (args.source) {
    const raw = await fs.readFile(args.source, "utf8");
    const parsed = JSON.parse(raw) as RidbApiPage | unknown[];
    const records = (Array.isArray(parsed) ? parsed : parsed.RECDATA) as Record<string, unknown>[];
    if (!Array.isArray(records)) throw new Error("RIDB source has no records array");
    return { records, sha256: sha256(raw) };
  }
  const apiKey = process.env.RIDB_API_KEY?.trim();
  if (!apiKey) throw new Error("RIDB_API_KEY is required unless --source is provided");
  const records = await fetchRidbRecords(apiKey);
  return { records, sha256: sha256(JSON.stringify(records)) };
}

function parsePgArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
    return value.slice(1, -1).split(",").filter(Boolean);
  }
  return [];
}

async function loadCampsiteDestinations(client: PoolClient): Promise<CampsiteDestination[]> {
  const result = await client.query<{
    id: string;
    name: string;
    lat: number | string;
    lng: number | string;
    features: unknown;
    external_ids: Record<string, unknown> | null;
  }>(
    `SELECT id, name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
            features, external_ids
       FROM destinations
      WHERE location IS NOT NULL
        AND ('campsite'::destination_feature = ANY(features) OR external_ids ? 'ridb_facility')`
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    lat: Number(row.lat),
    lng: Number(row.lng),
    features: parsePgArray(row.features),
    externalIds: row.external_ids ?? {},
  }));
}

async function applyUpdates(client: PoolClient, updates: CampgroundUpdate[]): Promise<number> {
  if (updates.length === 0) return 0;
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('recreation-gov-campground-backfill'))");
    const result = await client.query(
      `WITH incoming AS (
         SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
           destination_id text, ridb_facility_id text, expected_external_ids jsonb
         )
       )
       UPDATE destinations destination
          SET external_ids = destination.external_ids ||
                jsonb_build_object('ridb_facility', incoming.ridb_facility_id),
              updated_at = NOW()
         FROM incoming
        WHERE destination.id = incoming.destination_id
          AND destination.external_ids = incoming.expected_external_ids
          AND NOT destination.external_ids ? 'ridb_facility'
          AND 'campsite'::destination_feature = ANY(destination.features)
          AND NOT EXISTS (
            SELECT 1 FROM destinations other
             WHERE other.id <> destination.id
               AND other.external_ids->>'ridb_facility' = incoming.ridb_facility_id
          )
      RETURNING destination.id`,
      [JSON.stringify(updates.map((update) => ({
        destination_id: update.destinationId,
        ridb_facility_id: update.ridbFacilityId,
        expected_external_ids: update.expectedExternalIds,
      })))]
    );
    if (result.rowCount !== updates.length) {
      throw new Error("A reviewed destination changed during apply; rerun the audit");
    }
    await client.query("COMMIT");
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function writeReport(file: string, report: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const source = await loadSource(args);
  const facilities = parseRidbCampgrounds(source.records);
  const client = await db.connect();
  try {
    const destinations = await loadCampsiteDestinations(client);
    const audit = buildCampgroundAudit(facilities, destinations);
    const review = args.review
      ? JSON.parse(await fs.readFile(args.review, "utf8")) as CampgroundReviewFile
      : null;
    const updates = review
      ? buildReviewedCampgroundUpdates(review, facilities, destinations)
      : [];
    const report = {
      version: 1,
      generatedAt: new Date().toISOString(),
      source: {
        name: "Recreation Information Database",
        url: "https://ridb.recreation.gov/",
        sha256: source.sha256,
        reservableCampgrounds: facilities.length,
      },
      destinations: destinations.length,
      audit,
      reviewed: review ? review.matches.length : 0,
      plannedUpdates: updates,
      applied: args.apply ? await applyUpdates(client, updates) : 0,
    };
    if (args.report) await writeReport(args.report, report);
    console.log(JSON.stringify({
      sourceCampgrounds: facilities.length,
      destinations: destinations.length,
      existing: audit.existing.length,
      proposals: audit.proposals.length,
      ambiguities: audit.ambiguities.length,
      unmatched: audit.unmatched.length,
      reviewed: review?.matches.length ?? 0,
      plannedUpdates: updates.length,
      applied: report.applied,
      report: args.report,
    }, null, 2));
  } finally {
    client.release();
    await db.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
