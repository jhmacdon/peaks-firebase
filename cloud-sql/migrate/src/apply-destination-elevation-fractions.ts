/**
 * Guarded apply path for the one reviewed destination elevation fraction report.
 *
 * The report is pinned by SHA-256 and candidate count. The default mode is a
 * repeatable-read, read-only preflight. `--apply` also requires exact Cloud SQL
 * target guards and performs one serializable transaction.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import db from "./db";
import { candidateSql as catalogCandidateSql } from "./route-catalog-audit-jobs";
import { ELEVATION_ROUTE_FINGERPRINT_SQL } from "./route-elevation-jobs";

export const REVIEWED_REPORT_SHA256 =
  "80153b5afc9a3f59a2fe157e70b36a70c4f525a2d22305d433de3d0a39719006";
export const REVIEWED_CANDIDATE_COUNT = 117;
export const REVIEWED_DESTINATION_COUNT = 41_320;
export const MAX_REPORT_BYTES = 128 * 1024 * 1024;
export const ADVISORY_LOCK_NAME = "destination-elevation-fraction-repair-v1";
export const REPAIR_METADATA_KEY = "elevation_fraction_repair";
export const DESTINATION_UPDATE_TRIGGER_SAFE_COMMENT =
  "peaks:destination-session-link-update:xy-only-with-rejection-v1";
export const DESTINATION_UPDATE_TRIGGER_SAFE_BODY_MARKER =
  "peaks_destination_session_link_xy_guard_v1";
export const REVIEWED_CATALOG_DESTINATION_COUNT = 115;
export const REVIEWED_CATALOG_DESTINATION_IDS: readonly string[] = [
  "0gOgdFeUjdmcX2czFRJA",
  "0JBxhaoJWiVQQXgw2uUV",
  "0vX1ItjGVfF13Jzg6R07",
  "179FA758A520AC2C03BF",
  "1xMvDymATUfAwfSzwkMr",
  "2AmpkxmynD62sU618AoO",
  "3Sq6qcWle2Yjoz95x28W",
  "4PcL0PKgiVXJThoKp4on",
  "4tid6zCXqb5ofZFoL3o1",
  "53E03125EE116FF42129",
  "56132C631B14DEF7D935",
  "56Semg0Xsq1rZc9pyUAQ",
  "5dMVfDQl6wKeH0F41uCn",
  "67483F5B0605425E2DE0",
  "6EDA17ED94B617C62667",
  "6EO576elY8r21xwORhiK",
  "7571AAC348F5062210D3",
  "81R5i2lkUjv00DZ7RWGZ",
  "88664781F9CBC2708044",
  "8F1CFBC1CA329D7AAE81",
  "8PW4zjoMM7ztTxI2zTPD",
  "91F740DFA715C195EFD2",
  "9A51A6816379DD89C626",
  "9tG5PRGWHnMyoCRIbvx5",
  "AO7D7nRZCWNIsEfCiX0q",
  "AOnzIJTWMIrXau7YvRxw",
  "auJp6P3XMRtdqqlrfuK4",
  "B7bF0d9njRnfJzryT7te",
  "BE881F1892C436E00192",
  "C6quyfEJeKDny4s7i9mC",
  "CC9259BAC86F2277D22A",
  "cvJtXkcB4c7T8IxRqRUE",
  "D03E1609D19822D13E4F",
  "D8CB466E19319267173D",
  "DDFB929775A703F3AA69",
  "dZSVuW8UKm6ew42jKNtk",
  "E5983D9A0031297B2D73",
  "ebNg6H2UU7myxdOgSwE0",
  "EE203772460B7EE49833",
  "EhsmPjd7xoDxxEsyWkUC",
  "elREhc1iUNtsZdCqEsNW",
  "EytY8UYQNL0yeXUhqWFa",
  "F5NgW3n6v4BcIniehd95",
  "FA7B0381CB5F4F936D71",
  "FC4A16E846EE0AE76CB4",
  "fC9zpl4WpEUZvU4HTsSI",
  "fqfRt9QLCJZDFwwqZg3T",
  "FTm7JzK2MmAxXfXWKxp4",
  "fYqSbjmi9raKEiGXxsWC",
  "fYtpYbEAeIEGlmq2Jq3f",
  "g6ZTtk7NqMXxzCcmHVa9",
  "GKYFnmdM5xpDMShh8DUX",
  "GwLKVzkyBpklFRhl69MR",
  "hAtC19h5jNQ54F4N6I85",
  "HdoumN7EGXqJdDeHXWW1",
  "In7TUP56kLdEBwC2TopT",
  "jMcHR8HJL80agcUgZ09P",
  "jMcY2yoTHVX3SPXFOKEH",
  "JRALLj6uMy0g2dk0O5qh",
  "JtMYJqhtJirdDsZwv2qx",
  "jyrNSCXDRAZSyApTkEIR",
  "jZGktQptdSqU7rEkJPg2",
  "K6DbIauPe1Dydwntzipv",
  "kNdNMPMLDXfGziXrIUVl",
  "kXqFyY3n4p28TIvJS2YA",
  "LaLahdbKh9Y9UhwVXhua",
  "lcTpveFIwm2jDxH6E8uh",
  "Miv6kWqljhiYnA5IlzSq",
  "mNSItDblaRgQcTOJ2Otl",
  "Moyx7QVvepvbXTMWiotN",
  "MRGO5QC8mOOTfNyuCa6y",
  "MYXvib5txX2JadUoCPeT",
  "MyZUwK9Jv86tQ1da1bNT",
  "nhsnF042ynS83t0zV1Fq",
  "O42VnWbqd7PUORA4YlDI",
  "O5ffVp9k5HJyNkxgKtvl",
  "oFzOuiWWqqwp4ITgFkGL",
  "olUVpqTDVciqg3oY0Qcd",
  "ozDA1s77KdutO545ygjc",
  "OzMPz93jcirXRCcIDm18",
  "p8tLTkJdGMQ99RcUM4L7",
  "PqCVlM7W06uteYp4kkbC",
  "Q4DLhH68xvTC5wkGBps0",
  "QCZWtFoogjFwBi2SttNK",
  "QkAXELOaEsMBnuArw2ZL",
  "qpHrtElXFEnpBS0N4K2q",
  "qzdOp9vxfR7vhAcetFrv",
  "sfu8DFVHbliSzInIpa8S",
  "SijgW70vauJkInNK8V45",
  "SodRp0PgexNg7qQOYJQB",
  "solpQKVv1y747QjhEtVM",
  "TdLJMxOHZW6y0qyI4PqQ",
  "UFby19xyuWOJXCBT7IO7",
  "UfM6na5hYhJGvSKkbJhq",
  "UoCmEVIzFDYUFh7SvS8f",
  "uqOvTNvOs0Wa70ydHSI3",
  "UXokVD4BTb9B4eODNhVn",
  "vd2moSN7260lv3jfHM2W",
  "W0k5oFLiNYeUYGtKFXL4",
  "W0MFobFkHvxfJ58N9cTe",
  "wfhPviBAZ4wbiqFR1OqR",
  "WIbJ0SsW17MBQ7JeFfgp",
  "Wn75NKalAGToCkBCC5ir",
  "wnaKQD1UAQQwPBD0eapZ",
  "wpCvAQphggswkLWJQiKQ",
  "wzemhHXqqqeUpfDCns2C",
  "xGE4CV7zyFgR3llPpZUd",
  "Xj5eypVslqwHk3YLcsiF",
  "xjwtWth2ie35pFqgvV8L",
  "xoddbMqeMfYKTs8odJqo",
  "Y4zxDvca6kFrxy5aHQ6z",
  "yfAu9cSgdH6IK7oSoFUb",
  "YOBHRXWT5Xt1ItVUMAmU",
  "YS051qLKOrNlrnI6QjQL",
  "zVH2thn6KOHXHXNU5uWu",
] as const;
export const REVIEWED_CATALOG_DESTINATION_SET_SHA256 =
  "0148b3dfaab0322255d1196c2b2df558fc37c3e14956a2d482c20ba4c033f742";
export const REVIEWED_CATALOG_PRESTATE_SHA256 =
  "5c5eca2180d65920d005bce406eb3260214cb0dfaff1ae5e78a83c3ca1473a9c";
const MAX_IDENTITY_DISTANCE_M = 100;
const FLOAT_TOLERANCE_M = 1e-9;

export interface ReviewedPathRepair {
  destinationId: string;
  routeId: string;
  segmentId: string;
  vertexIndex: number;
  pointCount: number;
  oldPathHash: string;
  newPathHash: string;
  xyHash: string;
  otherPointsHash: string;
  routeOtherFieldsHash: string;
  segmentOtherFieldsHash: string;
  expectedNewGainM: number;
  expectedNewLossM: number;
  expectedNewProfileHash: string;
  expectedRouteJobFingerprint: string;
  expectedRouteJobState: "queued";
  expectedStandardJobState: "needs_human";
}

export const REVIEWED_PATH_REPAIRS: readonly ReviewedPathRepair[] = [
  {
    destinationId: "GwLKVzkyBpklFRhl69MR",
    routeId: "SviDXc3ZmjsCQc6dz8zH",
    segmentId: "p2FwsOsAqQyuYeZK3Hbi",
    vertexIndex: 356,
    pointCount: 356,
    oldPathHash: "69e3d75dd3a2ac9fb516187304c067c7",
    newPathHash: "99b4e0fd7eaf38cd2572cf89037fa970",
    xyHash: "602943c4cd61d399c6be04d7a33bed2b",
    otherPointsHash: "738af7ef1f7ff79f792018d3327ed965",
    routeOtherFieldsHash: "5b79fe024e32fc0e8b24d5ceab98be95",
    segmentOtherFieldsHash: "20f57146e6e365a9093a1c35114db161",
    expectedNewGainM: 1497.9999999999993,
    expectedNewLossM: 117.60000000000036,
    expectedNewProfileHash: "89f9e1c1e1e58f7a6ebc4f777b3e43d9",
    expectedRouteJobFingerprint: "cb388b18fca8176e548756ecd77f31b3",
    expectedRouteJobState: "queued",
    expectedStandardJobState: "needs_human",
  },
  {
    destinationId: "qpHrtElXFEnpBS0N4K2q",
    routeId: "6ecb9lItJZFoUvnLgdrM",
    segmentId: "d2VTNt6jk3qZSbsuAGoT",
    vertexIndex: 158,
    pointCount: 158,
    oldPathHash: "c69ec0ab6d341f4b7ca3bcb34de1e630",
    newPathHash: "353ac5e7bb2ff8b26ae478c3a52b304a",
    xyHash: "f624d8f8438acbcbaa6f0e4c8cfdf20c",
    otherPointsHash: "18f32bc9a30cc2fe1c6286426dea25dc",
    routeOtherFieldsHash: "cb59608fef794fdf6f64e7e8a65d3666",
    segmentOtherFieldsHash: "ff44aeea85b741f922dc94f0efe219da",
    expectedNewGainM: 1412.964800000001,
    expectedNewLossM: 6.700000000000273,
    expectedNewProfileHash: "89a8307e9d1e9d56d78db215071b3846",
    expectedRouteJobFingerprint: "0440fb9ca419355f63f3de50ef993703",
    expectedRouteJobState: "queued",
    expectedStandardJobState: "needs_human",
  },
] as const;

type JsonObject = Record<string, unknown>;
type OutputFormat = "human" | "json";

export interface ApplyArgs {
  apply: boolean;
  format: OutputFormat;
  reportPath: string;
  expectedReportSha256: string | null;
  expectedCandidateCount: number | null;
  expectedDatabase: string | null;
  expectedInstance: string | null;
  expectedHost: string | null;
}

export interface ApplyTarget {
  database: string;
  instance: string;
  host: string;
}

export interface ReviewedReportExpectation {
  sha256: string;
  candidateCount: number;
  destinationCount: number;
}

export interface ValidatedCandidate {
  destinationId: string;
  destinationName: string | null;
  expectedElevationM: number;
  proposedElevationM: number;
  deltaM: number;
  lat: number;
  lng: number;
  expectedUpdatedAt: string;
  externalKey: "osm" | "osm_node" | "osm_way";
  externalId: string;
  elementType: "node" | "way";
  providerId: string;
  sourceUrl: string;
  rawValue: string;
  rawUnit: "m";
  sourceVersion: number;
  sourceTimestamp: string;
  identityDistanceM: number;
  wikidataId: string | null;
  provenanceCutoffAt: string;
  provenanceCutoffBasis: "destination_created_at" | "osm_id_backfill";
  provenanceProof: "current_version" | "history_version";
  proofVersion: number;
  proofTimestamp: string;
  proofRawValue: string;
}

interface LiveDestinationRow {
  id: string;
  owner: string;
  elevation: number | string;
  location_z: number | string | null;
  lat: number | string | null;
  lng: number | string | null;
  external_ids: JsonObject;
  updated_at_millisecond: string;
  has_repair_metadata: boolean;
}

export interface FingerprintImpact {
  directlyLinkedRoutes: number;
  catalogRoutes: number;
  catalogDestinations: number;
  existingCatalogJobs: number;
  activeCatalogLeases: number;
  routeElevationJobsOnLinkedRoutes: number;
  activeRouteElevationLeasesOnLinkedRoutes: number;
  standardRouteJobs: number;
  activeStandardRouteLeases: number;
  destinationOnlyRouteElevationFingerprintChanges: 0;
  routeElevationFingerprintChanges: number;
  standardRouteFingerprintChanges: 0;
  catalogFingerprintChanges: number;
  catalogReseedRequired: boolean;
}

export interface RouteVertexImpact {
  linkedPeaksRoutes: number;
  routesWithPinnedOldSummitVertex: number;
  activeRoutesWithPinnedOldSummitVertex: number;
  pendingRoutesWithPinnedOldSummitVertex: number;
  routeDestinationPins: number;
  routeSegmentsWithPinnedOldSummitVertex: number;
  routeSegmentPins: number;
  routePins: Array<Record<string, unknown>>;
  segmentPins: Array<Record<string, unknown>>;
  importerPinnedSummitContractApplies: boolean;
  normalWorkflowRepair: "guarded_exact_vertex_update" | null;
}

export interface PathRepairAuditRow {
  destination_id: string;
  route_id: string;
  segment_id: string;
  route_path_hash: string;
  segment_path_hash: string;
  route_xy_hash: string;
  segment_xy_hash: string;
  route_other_points_hash: string;
  segment_other_points_hash: string;
  route_other_fields_hash: string;
  segment_other_fields_hash: string;
  route_point_count: number | string;
  segment_point_count: number | string;
  route_old_matches: number | string;
  segment_old_matches: number | string;
  route_new_matches: number | string;
  segment_new_matches: number | string;
  route_gain: number | string;
  route_loss: number | string;
  segment_gain: number | string;
  segment_loss: number | string;
  computed_route_gain: number | string;
  computed_route_loss: number | string;
  computed_segment_gain: number | string;
  computed_segment_loss: number | string;
  route_profile_canonical: boolean;
  route_profile_hash: string;
  segment_consumer_route_ids: string[];
  route_job_state: string | null;
  route_job_fingerprint: string | null;
  route_job_final_evidence: JsonObject | null;
  route_job_lease_expires_at: string | null;
  standard_job_state: string | null;
  standard_job_evidence: JsonObject | null;
  standard_job_review: JsonObject | null;
  standard_job_candidate_sha256: string | null;
  standard_job_candidate_artifact_is_null: boolean;
  standard_job_candidate_path_is_null: boolean;
  standard_job_has_lease: boolean;
  standard_job_lease_expires_at: string | null;
  current_route_fingerprint: string | null;
}

interface ImpactRow {
  directly_linked_routes: number | string;
  catalog_routes: number | string;
  catalog_destinations: number | string;
  existing_catalog_jobs: number | string;
  active_catalog_leases: number | string;
  route_elevation_jobs_on_linked_routes: number | string;
  active_route_elevation_leases_on_linked_routes: number | string;
  standard_route_jobs: number | string;
  active_standard_route_leases: number | string;
}

export interface CatalogScopeRow {
  destination_id: string;
  destination_name: string | null;
  state: string | null;
  priority: number | string | null;
  route_count: number | string | null;
  audit_rule_version: number | string | null;
  catalog_fingerprint: string | null;
  attempt_count: number | string | null;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  final_result_text: string | null;
  audited_at: string | null;
}

interface DestinationUpdateTriggerGuardRow {
  function_exists: boolean;
  function_comment: string | null;
  function_definition: string | null;
  function_definition_md5: string | null;
  trigger_count: number | string;
  enabled_trigger_count: number | string;
  trigger_definition: string | null;
}

export interface DestinationUpdateTriggerGuard {
  safe: boolean;
  functionExists: boolean;
  functionDefinitionMd5: string | null;
  safeComment: boolean;
  safeBodyMarker: boolean;
  xyOnlyPredicate: boolean;
  rejectionAntiJoin: boolean;
  exactEnabledTrigger: boolean;
}

export interface SessionTrackingInvariant {
  sessionDestinationsCount: number;
  sessionDestinationsHash: string;
  sessionDestinationRejectionsCount: number;
  sessionDestinationRejectionsHash: string;
  destinationAreasCount: number;
  destinationAreasHash: string;
  relevantTrackingSessionsCount: number;
  relevantTrackingSessionsHash: string;
  relevantTrackingPointsCount: number;
  relevantTrackingPointsHash: string;
}

interface SessionTrackingInvariantRow {
  session_destinations_count: number | string;
  session_destinations_hash: string;
  session_destination_rejections_count: number | string;
  session_destination_rejections_hash: string;
  destination_areas_count: number | string;
  destination_areas_hash: string;
  relevant_tracking_sessions_count: number | string;
  relevant_tracking_sessions_hash: string;
  relevant_tracking_points_count: number | string;
  relevant_tracking_points_hash: string;
}

interface RouteVertexImpactRow {
  linked_peaks_routes: number | string;
  pinned_routes: number | string;
  pinned_active_routes: number | string;
  pinned_pending_routes: number | string;
  route_destination_pins: number | string;
  pinned_segments: number | string;
  route_segment_pins: number | string;
  route_pins: Array<Record<string, unknown>>;
  segment_pins: Array<Record<string, unknown>>;
}

interface QueryClient {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{
    rows: T[];
    rowCount: number | null;
  }>;
  release(): void;
}

interface QueryPool {
  connect(): Promise<QueryClient>;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return parsed;
}

function isoTimestamp(value: unknown, label: string): string {
  const raw = string(value, label);
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} must be an ISO timestamp`);
  return parsed.toISOString();
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= FLOAT_TOLERANCE_M;
}

function flagValue(argv: string[], key: string): string | null {
  const prefix = `${key}=`;
  const match = argv.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

export function parseApplyArgs(argv = process.argv.slice(2)): ApplyArgs {
  const knownValues = new Set([
    "--report",
    "--expected-report-sha256",
    "--expected-candidate-count",
    "--expected-database",
    "--expected-instance",
    "--expected-host",
  ]);
  for (const argument of argv) {
    if (argument === "--apply" || argument === "--format=json" || argument === "--format=human") {
      continue;
    }
    const equalsAt = argument.indexOf("=");
    const key = equalsAt >= 0 ? argument.slice(0, equalsAt) : argument;
    if (!knownValues.has(key) || equalsAt < 0 || equalsAt === argument.length - 1) {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  const reportValue = flagValue(argv, "--report");
  if (!reportValue) throw new Error("--report is required");
  const countValue = flagValue(argv, "--expected-candidate-count");
  const expectedCandidateCount = countValue == null
    ? null
    : positiveInteger(countValue, "--expected-candidate-count");
  const expectedReportSha256 = flagValue(argv, "--expected-report-sha256");
  if (expectedReportSha256 && !/^[0-9a-f]{64}$/.test(expectedReportSha256)) {
    throw new Error("--expected-report-sha256 must be 64 lower-case hexadecimal characters");
  }
  return {
    apply: argv.includes("--apply"),
    format: argv.includes("--format=json") ? "json" : "human",
    reportPath: path.resolve(reportValue),
    expectedReportSha256,
    expectedCandidateCount,
    expectedDatabase: flagValue(argv, "--expected-database"),
    expectedInstance: flagValue(argv, "--expected-instance"),
    expectedHost: flagValue(argv, "--expected-host"),
  };
}

export function resolveReviewedExpectation(args: ApplyArgs): ReviewedReportExpectation {
  if (args.expectedReportSha256 == null || args.expectedCandidateCount == null) {
    throw new Error(
      "the reviewed report SHA-256 and candidate count must be supplied explicitly"
    );
  }
  if (args.expectedReportSha256 !== REVIEWED_REPORT_SHA256) {
    throw new Error("the supplied report SHA-256 is not the reviewed report SHA-256");
  }
  if (args.expectedCandidateCount !== REVIEWED_CANDIDATE_COUNT) {
    throw new Error("the supplied candidate count is not the reviewed count of 117");
  }
  return {
    sha256: REVIEWED_REPORT_SHA256,
    candidateCount: REVIEWED_CANDIDATE_COUNT,
    destinationCount: REVIEWED_DESTINATION_COUNT,
  };
}

export function resolveApplyTarget(args: ApplyArgs): ApplyTarget {
  if (!args.expectedDatabase || !args.expectedInstance || !args.expectedHost) {
    throw new Error("--apply requires exact expected database, instance, and host values");
  }
  if (!path.isAbsolute(args.expectedHost)) {
    throw new Error("--expected-host must be an absolute instance-bound Unix socket path");
  }
  const instanceParts = args.expectedInstance.split(":");
  if (instanceParts.length !== 3 || instanceParts.some((part) => !part)) {
    throw new Error("--expected-instance must be PROJECT:REGION:INSTANCE");
  }
  return {
    database: args.expectedDatabase,
    instance: args.expectedInstance,
    host: args.expectedHost,
  };
}

function validateCandidate(raw: unknown, index: number): ValidatedCandidate {
  const label = `candidate[${index}]`;
  const candidate = object(raw, label);
  if (candidate.classification !== "direct_metre_fraction_candidate" || candidate.applyCandidate !== true) {
    throw new Error(`${label} is not an approved direct-metre candidate`);
  }
  const destination = object(candidate.destination, `${label}.destination`);
  const destinationId = string(destination.id, `${label}.destination.id`);
  if (!/^[A-Za-z0-9_-]+$/.test(destinationId)) {
    throw new Error(`${label}.destination.id has unsupported characters`);
  }
  const expectedElevationM = finiteNumber(
    destination.elevationM,
    `${label}.destination.elevationM`
  );
  const proposedElevationM = finiteNumber(candidate.proposedElevationM, `${label}.proposedElevationM`);
  const deltaM = proposedElevationM - expectedElevationM;
  if (!Number.isInteger(expectedElevationM)) {
    throw new Error(`${label} current elevation is not an integer`);
  }
  if (Number.isInteger(proposedElevationM)) {
    throw new Error(`${label} proposed elevation has no fractional component`);
  }
  if (!(deltaM > 0 && deltaM < 1)) {
    throw new Error(`${label} delta must be positive and less than one metre`);
  }
  if (Math.trunc(proposedElevationM) !== expectedElevationM) {
    throw new Error(`${label} would change the whole-metre portion`);
  }
  const lat = finiteNumber(destination.lat, `${label}.destination.lat`);
  const lng = finiteNumber(destination.lng, `${label}.destination.lng`);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error(`${label} has invalid stored coordinates`);
  }
  const expectedUpdatedAt = isoTimestamp(destination.updatedAt, `${label}.destination.updatedAt`);
  const externalIds = object(destination.externalIds, `${label}.destination.externalIds`);

  const evidence = array(candidate.evidence, `${label}.evidence`).map((item, evidenceIndex) =>
    object(item, `${label}.evidence[${evidenceIndex}]`)
  );
  const osmEvidence = evidence.filter((item) =>
    item.provider === "osm" && item.unit === "metre" && item.valueM === proposedElevationM
  );
  if (osmEvidence.length !== 1) {
    throw new Error(`${label} must have exactly one matching direct-metre OSM source`);
  }
  const source = osmEvidence[0];
  const providerId = string(source.providerId, `${label}.evidence.providerId`);
  const providerMatch = providerId.match(/^(node|way)\/([1-9][0-9]*)$/);
  if (!providerMatch) throw new Error(`${label} OSM provider ID is not an exact node/way ID`);
  const elementType = providerMatch[1] as "node" | "way";
  const externalId = providerMatch[2];
  const sourceUrl = string(source.sourceUrl, `${label}.evidence.sourceUrl`);
  if (sourceUrl !== `https://www.openstreetmap.org/${elementType}/${externalId}`) {
    throw new Error(`${label} OSM source URL does not match its exact provider ID`);
  }
  const rawValue = string(source.rawValue, `${label}.evidence.rawValue`);
  if (source.rawUnit !== "m" || source.unit !== "metre") {
    throw new Error(`${label} OSM evidence is not a direct metre value`);
  }
  if (!close(Number(rawValue.replace(/,/g, "")), proposedElevationM)) {
    throw new Error(`${label} raw OSM value does not match the proposed elevation`);
  }
  if (!close(finiteNumber(source.deltaM, `${label}.evidence.deltaM`), deltaM)) {
    throw new Error(`${label} source delta does not match the proposed change`);
  }
  const sourceVersion = positiveInteger(source.sourceVersion, `${label}.evidence.sourceVersion`);
  const sourceTimestamp = isoTimestamp(source.sourceTimestamp, `${label}.evidence.sourceTimestamp`);

  const identity = object(candidate.identity, `${label}.identity`);
  const osmIdentity = object(identity.osm, `${label}.identity.osm`);
  const references = array(osmIdentity.references, `${label}.identity.osm.references`).map(
    (item, referenceIndex) => object(item, `${label}.identity.osm.references[${referenceIndex}]`)
  );
  const matchingReferences = references.filter((reference) =>
    reference.id === externalId && reference.elementType === elementType
  );
  if (matchingReferences.length !== 1) {
    throw new Error(`${label} must have one exact OSM identity reference`);
  }
  const reference = matchingReferences[0];
  const externalKey = string(reference.key, `${label}.identity.osm.reference.key`);
  if (externalKey !== "osm" && externalKey !== "osm_node" && externalKey !== "osm_way") {
    throw new Error(`${label} has an unsupported OSM external ID key`);
  }
  if (externalKey === "osm_node" && elementType !== "node" ||
      externalKey === "osm_way" && elementType !== "way") {
    throw new Error(`${label} OSM external ID key conflicts with its element type`);
  }
  if (reference.status !== "valid" || reference.reason !== "exact_osm_id_and_coordinate_match") {
    throw new Error(`${label} OSM identity is not proven`);
  }
  const identityDistanceM = finiteNumber(reference.distanceM, `${label}.identity.osm.distanceM`);
  if (identityDistanceM < 0 || identityDistanceM > MAX_IDENTITY_DISTANCE_M) {
    throw new Error(`${label} OSM identity is farther than 100 metres`);
  }
  if (externalIds[externalKey] !== externalId) {
    throw new Error(`${label} exact OSM identity does not match destination.externalIds`);
  }
  if (references.some((item) => item.status !== "valid")) {
    throw new Error(`${label} contains a conflicting OSM identity reference`);
  }

  const wikidataId = typeof externalIds.wikidata === "string" ? externalIds.wikidata : null;
  if (wikidataId) {
    const wikidataIdentity = object(identity.wikidata, `${label}.identity.wikidata`);
    if (wikidataIdentity.id !== wikidataId || wikidataIdentity.status !== "valid") {
      throw new Error(`${label} linked Wikidata identity is not valid`);
    }
  }

  const timing = object(candidate.provenanceTiming, `${label}.provenanceTiming`);
  if (timing.status !== "preexisting" || timing.provider !== "osm" || timing.providerId !== providerId) {
    throw new Error(`${label} has no preexisting exact-source proof`);
  }
  if (timing.cutoffBasis !== "destination_created_at" && timing.cutoffBasis !== "osm_id_backfill") {
    throw new Error(`${label} has no accepted provenance cutoff`);
  }
  if (timing.proof !== "current_version" && timing.proof !== "history_version") {
    throw new Error(`${label} has no accepted provenance proof`);
  }
  const provenanceCutoffAt = isoTimestamp(timing.cutoffAt, `${label}.provenanceTiming.cutoffAt`);
  const proof = object(
    timing.versionAtOrBeforeCutoff,
    `${label}.provenanceTiming.versionAtOrBeforeCutoff`
  );
  const proofTimestamp = isoTimestamp(proof.timestamp, `${label}.provenanceTiming.proof.timestamp`);
  if (new Date(proofTimestamp).getTime() > new Date(provenanceCutoffAt).getTime()) {
    throw new Error(`${label} provenance proof is later than its cutoff`);
  }
  if (proof.visible !== true || proof.unit !== "metre" || proof.rawUnit !== "m") {
    throw new Error(`${label} provenance proof is not a visible direct-metre OSM version`);
  }
  if (!close(finiteNumber(proof.valueM, `${label}.provenanceTiming.proof.valueM`), proposedElevationM)) {
    throw new Error(`${label} provenance proof value does not match the proposal`);
  }
  const proofRawValue = string(proof.rawValue, `${label}.provenanceTiming.proof.rawValue`);
  if (!close(Number(proofRawValue.replace(/,/g, "")), proposedElevationM)) {
    throw new Error(`${label} raw provenance proof does not match the proposal`);
  }

  return {
    destinationId,
    destinationName: destination.name == null ? null : string(destination.name, `${label}.destination.name`),
    expectedElevationM,
    proposedElevationM,
    deltaM,
    lat,
    lng,
    expectedUpdatedAt,
    externalKey: externalKey as ValidatedCandidate["externalKey"],
    externalId,
    elementType,
    providerId,
    sourceUrl,
    rawValue,
    rawUnit: "m",
    sourceVersion,
    sourceTimestamp,
    identityDistanceM,
    wikidataId,
    provenanceCutoffAt,
    provenanceCutoffBasis: timing.cutoffBasis,
    provenanceProof: timing.proof,
    proofVersion: positiveInteger(proof.version, `${label}.provenanceTiming.proof.version`),
    proofTimestamp,
    proofRawValue,
  };
}

export function validateElevationFractionReport(
  rawReport: unknown,
  actualSha256: string,
  expected: ReviewedReportExpectation
): ValidatedCandidate[] {
  if (actualSha256 !== expected.sha256) throw new Error("report SHA-256 does not match review");
  const report = object(rawReport, "report");
  if (report.schemaVersion !== 1 || report.dryRun !== true) {
    throw new Error("report must be the version 1 dry-run audit report");
  }
  const safety = object(report.safety, "report.safety");
  if (safety.applyModeAvailable !== false || safety.storedUnit !== "metre") {
    throw new Error("report safety declaration is missing or uses the wrong unit");
  }
  const inventory = object(report.inventory, "report.inventory");
  if (inventory.destinationsAudited !== expected.destinationCount) {
    throw new Error("report does not cover the reviewed destination inventory");
  }
  const summary = object(report.summary, "report.summary");
  if (summary.applyCandidates !== expected.candidateCount) {
    throw new Error("report summary candidate count does not match review");
  }
  const candidates = array(report.candidates, "report.candidates");
  if (candidates.length !== expected.candidateCount) {
    throw new Error("report candidate array count does not match review");
  }
  const results = array(report.results, "report.results");
  if (results.length !== expected.destinationCount) {
    throw new Error("report results do not cover every audited destination");
  }
  const resultCandidateIds = results
    .filter((value) => object(value, "report.results item").applyCandidate === true)
    .map((value) => string(object(object(value, "report.results item").destination, "result destination").id, "result destination id"))
    .sort();
  if (resultCandidateIds.length !== expected.candidateCount) {
    throw new Error("full audit results do not contain the reviewed candidate count");
  }
  const validated = candidates.map(validateCandidate);
  const ids = validated.map((candidate) => candidate.destinationId);
  if (new Set(ids).size !== ids.length) throw new Error("report has duplicate candidate destination IDs");
  if (ids.slice().sort().join("\n") !== resultCandidateIds.join("\n")) {
    throw new Error("report candidate list does not match candidates in the full audit results");
  }
  return validated.sort((a, b) => a.destinationId.localeCompare(b.destinationId));
}

export async function readReviewedReport(
  reportPath: string,
  expected: ReviewedReportExpectation
): Promise<{ sha256: string; candidates: ValidatedCandidate[] }> {
  const stat = await fs.lstat(reportPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("--report must be a regular file, not a symlink");
  }
  if (stat.size <= 0 || stat.size > MAX_REPORT_BYTES) {
    throw new Error(`--report must be between 1 byte and ${MAX_REPORT_BYTES} bytes`);
  }
  const bytes = await fs.readFile(reportPath);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expected.sha256) throw new Error("report SHA-256 does not match review");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("--report is not valid JSON");
  }
  return { sha256, candidates: validateElevationFractionReport(parsed, sha256, expected) };
}

function candidatesJson(candidates: ValidatedCandidate[]): string {
  return JSON.stringify(candidates.map((candidate) => ({
    destination_id: candidate.destinationId,
    destination_name: candidate.destinationName,
    expected_elevation_m: candidate.expectedElevationM,
    proposed_elevation_m: candidate.proposedElevationM,
    delta_m: candidate.deltaM,
    lat: candidate.lat,
    lng: candidate.lng,
    expected_updated_at: candidate.expectedUpdatedAt,
    external_key: candidate.externalKey,
    external_id: candidate.externalId,
    element_type: candidate.elementType,
    provider_id: candidate.providerId,
    source_url: candidate.sourceUrl,
    raw_value: candidate.rawValue,
    raw_unit: candidate.rawUnit,
    source_version: candidate.sourceVersion,
    source_timestamp: candidate.sourceTimestamp,
    identity_distance_m: candidate.identityDistanceM,
    wikidata_id: candidate.wikidataId,
    provenance_cutoff_at: candidate.provenanceCutoffAt,
    provenance_cutoff_basis: candidate.provenanceCutoffBasis,
    provenance_proof: candidate.provenanceProof,
    proof_version: candidate.proofVersion,
    proof_timestamp: candidate.proofTimestamp,
    proof_raw_value: candidate.proofRawValue,
  })));
}

function pathRepairsJson(): string {
  return JSON.stringify(REVIEWED_PATH_REPAIRS.map((repair) => ({
    destination_id: repair.destinationId,
    route_id: repair.routeId,
    segment_id: repair.segmentId,
    vertex_index: repair.vertexIndex,
    point_count: repair.pointCount,
    old_path_hash: repair.oldPathHash,
    new_path_hash: repair.newPathHash,
    xy_hash: repair.xyHash,
    other_points_hash: repair.otherPointsHash,
    route_other_fields_hash: repair.routeOtherFieldsHash,
    segment_other_fields_hash: repair.segmentOtherFieldsHash,
    expected_new_gain_m: repair.expectedNewGainM,
    expected_new_loss_m: repair.expectedNewLossM,
    expected_new_profile_hash: repair.expectedNewProfileHash,
    expected_route_job_fingerprint: repair.expectedRouteJobFingerprint,
    expected_route_job_state: repair.expectedRouteJobState,
    expected_standard_job_state: repair.expectedStandardJobState,
  })));
}

const INCOMING_SQL = `
  SELECT *
  FROM jsonb_to_recordset($1::jsonb) AS incoming(
    destination_id text,
    destination_name text,
    expected_elevation_m double precision,
    proposed_elevation_m double precision,
    delta_m double precision,
    lat double precision,
    lng double precision,
    expected_updated_at timestamptz,
    external_key text,
    external_id text,
    element_type text,
    provider_id text,
    source_url text,
    raw_value text,
    raw_unit text,
    source_version integer,
    source_timestamp timestamptz,
    identity_distance_m double precision,
    wikidata_id text,
    provenance_cutoff_at timestamptz,
    provenance_cutoff_basis text,
    provenance_proof text,
    proof_version integer,
    proof_timestamp timestamptz,
    proof_raw_value text
  )`;

const PATH_REPAIR_INPUT_SQL = `
  WITH all_candidates AS (${INCOMING_SQL}), repair_manifest AS (
    SELECT *
    FROM jsonb_to_recordset($2::jsonb) AS repair(
      destination_id text,
      route_id text,
      segment_id text,
      vertex_index integer,
      point_count integer,
      old_path_hash text,
      new_path_hash text,
      xy_hash text,
      other_points_hash text,
      route_other_fields_hash text,
      segment_other_fields_hash text,
      expected_new_gain_m double precision,
      expected_new_loss_m double precision,
      expected_new_profile_hash text,
      expected_route_job_fingerprint text,
      expected_route_job_state text,
      expected_standard_job_state text
    )
  )
  SELECT repair_manifest.*, all_candidates.expected_elevation_m,
         all_candidates.proposed_elevation_m, all_candidates.delta_m,
         all_candidates.lat, all_candidates.lng
  FROM repair_manifest
  JOIN all_candidates USING (destination_id)`;

export const LOCK_REVIEWED_ROUTES_SQL = `
WITH repair AS (${PATH_REPAIR_INPUT_SQL})
SELECT route.id
FROM repair
JOIN routes route ON route.id = repair.route_id
ORDER BY route.id
FOR UPDATE OF route`;

export const LOCK_REVIEWED_SEGMENTS_SQL = `
WITH repair AS (${PATH_REPAIR_INPUT_SQL})
SELECT segment.id
FROM repair
JOIN segments segment ON segment.id = repair.segment_id
ORDER BY segment.id
FOR UPDATE OF segment`;

export const LOCK_REVIEWED_ROUTE_JOBS_SQL = `
WITH repair AS (${PATH_REPAIR_INPUT_SQL})
SELECT job.route_id, job.state, job.lease_expires_at
FROM repair
JOIN route_elevation_backfill_jobs job ON job.route_id = repair.route_id
ORDER BY job.route_id
FOR UPDATE OF job`;

export const LOCK_REVIEWED_STANDARD_JOBS_SQL = `
WITH repair AS (${PATH_REPAIR_INPUT_SQL})
SELECT job.destination_id, job.state, job.lease_expires_at
FROM repair
JOIN standard_route_backfill_jobs job
  ON job.destination_id = repair.destination_id
 AND job.published_route_id = repair.route_id
 AND job.replacement_route_id = repair.route_id
ORDER BY job.destination_id
FOR UPDATE OF job`;

export const PATH_REPAIR_AUDIT_SQL = `
WITH repair AS (${PATH_REPAIR_INPUT_SQL})
SELECT repair.destination_id,
       repair.route_id,
       repair.segment_id,
       md5(encode(ST_AsEWKB(route.path::geometry), 'hex')) AS route_path_hash,
       md5(encode(ST_AsEWKB(segment.path::geometry), 'hex')) AS segment_path_hash,
       md5(encode(ST_AsEWKB(ST_Force2D(route.path::geometry)), 'hex')) AS route_xy_hash,
       md5(encode(ST_AsEWKB(ST_Force2D(segment.path::geometry)), 'hex')) AS segment_xy_hash,
       route_other_points.hash AS route_other_points_hash,
       segment_other_points.hash AS segment_other_points_hash,
       md5((to_jsonb(route) - ARRAY[
         'path', 'elevation_string', 'gain', 'gain_loss', 'updated_at'
       ]::text[])::text) AS route_other_fields_hash,
       md5((to_jsonb(segment) - ARRAY[
         'path', 'gain', 'gain_loss', 'updated_at'
       ]::text[])::text) AS segment_other_fields_hash,
       ST_NPoints(route.path::geometry)::int AS route_point_count,
       ST_NPoints(segment.path::geometry)::int AS segment_point_count,
       route_matches.old_matches::int AS route_old_matches,
       segment_matches.old_matches::int AS segment_old_matches,
       route_matches.new_matches::int AS route_new_matches,
       segment_matches.new_matches::int AS segment_new_matches,
       route.gain AS route_gain,
       route.gain_loss AS route_loss,
       segment.gain AS segment_gain,
       segment.gain_loss AS segment_loss,
       route_stats.gain AS computed_route_gain,
       route_stats.loss AS computed_route_loss,
       segment_stats.gain AS computed_segment_gain,
       segment_stats.loss AS computed_segment_loss,
       route.elevation_string IS NOT DISTINCT FROM
         encode_route_elevation_profile(route.path) AS route_profile_canonical,
       md5(COALESCE(route.elevation_string, '')) AS route_profile_hash,
       consumers.route_ids AS segment_consumer_route_ids,
       route_job.state AS route_job_state,
       route_job.path_fingerprint AS route_job_fingerprint,
       route_job.final_evidence AS route_job_final_evidence,
       route_job.lease_expires_at AS route_job_lease_expires_at,
       standard_job.state AS standard_job_state,
       standard_job.evidence AS standard_job_evidence,
       standard_job.review AS standard_job_review,
       standard_job.candidate_sha256 AS standard_job_candidate_sha256,
       standard_job.candidate_artifact IS NULL AS standard_job_candidate_artifact_is_null,
       standard_job.candidate_path IS NULL AS standard_job_candidate_path_is_null,
       standard_job.lease_owner IS NOT NULL OR standard_job.lease_token IS NOT NULL
         AS standard_job_has_lease,
       standard_job.lease_expires_at AS standard_job_lease_expires_at,
       current_fingerprint.path_fingerprint AS current_route_fingerprint
FROM repair
JOIN routes route ON route.id = repair.route_id
JOIN segments segment ON segment.id = repair.segment_id
JOIN route_destinations destination_link
  ON destination_link.route_id = route.id
 AND destination_link.destination_id = repair.destination_id
JOIN route_segments segment_link
  ON segment_link.route_id = route.id
 AND segment_link.segment_id = segment.id
LEFT JOIN route_elevation_backfill_jobs route_job ON route_job.route_id = route.id
LEFT JOIN standard_route_backfill_jobs standard_job
  ON standard_job.destination_id = repair.destination_id
 AND standard_job.published_route_id = route.id
 AND standard_job.replacement_route_id = route.id
LEFT JOIN (${ELEVATION_ROUTE_FINGERPRINT_SQL}) current_fingerprint
  ON current_fingerprint.route_id = route.id
CROSS JOIN LATERAL route_elevation_stats(route.path) route_stats
CROSS JOIN LATERAL route_elevation_stats(segment.path) segment_stats
CROSS JOIN LATERAL (
  SELECT md5(string_agg(
    encode(ST_AsEWKB((dumped).geom), 'hex'), '|' ORDER BY (dumped).path
  )) AS hash
  FROM ST_DumpPoints(route.path::geometry) dumped
  WHERE (dumped).path[1] <> repair.vertex_index
) route_other_points
CROSS JOIN LATERAL (
  SELECT md5(string_agg(
    encode(ST_AsEWKB((dumped).geom), 'hex'), '|' ORDER BY (dumped).path
  )) AS hash
  FROM ST_DumpPoints(segment.path::geometry) dumped
  WHERE (dumped).path[1] <> repair.vertex_index
) segment_other_points
CROSS JOIN LATERAL (
  SELECT count(*) FILTER (
           WHERE ST_X((dumped).geom) = repair.lng
             AND ST_Y((dumped).geom) = repair.lat
             AND ST_Z((dumped).geom) = repair.expected_elevation_m
         ) AS old_matches,
         count(*) FILTER (
           WHERE ST_X((dumped).geom) = repair.lng
             AND ST_Y((dumped).geom) = repair.lat
             AND ST_Z((dumped).geom) = repair.proposed_elevation_m
         ) AS new_matches
  FROM ST_DumpPoints(route.path::geometry) dumped
) route_matches
CROSS JOIN LATERAL (
  SELECT count(*) FILTER (
           WHERE ST_X((dumped).geom) = repair.lng
             AND ST_Y((dumped).geom) = repair.lat
             AND ST_Z((dumped).geom) = repair.expected_elevation_m
         ) AS old_matches,
         count(*) FILTER (
           WHERE ST_X((dumped).geom) = repair.lng
             AND ST_Y((dumped).geom) = repair.lat
             AND ST_Z((dumped).geom) = repair.proposed_elevation_m
         ) AS new_matches
  FROM ST_DumpPoints(segment.path::geometry) dumped
) segment_matches
CROSS JOIN LATERAL (
  SELECT array_agg(link.route_id ORDER BY link.route_id) AS route_ids
  FROM route_segments link
  WHERE link.segment_id = segment.id
) consumers
ORDER BY repair.destination_id`;

export const UPDATE_REVIEWED_SEGMENT_VERTICES_SQL = `
WITH repair AS (${PATH_REPAIR_INPUT_SQL}), prepared AS MATERIALIZED (
  SELECT segment.id,
         repair.*,
         ST_SetPoint(
           segment.path::geometry,
           repair.vertex_index - 1,
           ST_SetSRID(ST_MakePoint(
             ST_X(ST_PointN(segment.path::geometry, repair.vertex_index)),
             ST_Y(ST_PointN(segment.path::geometry, repair.vertex_index)),
             repair.proposed_elevation_m
           ), 4326)
         )::geography AS new_path
  FROM repair
  JOIN segments segment ON segment.id = repair.segment_id
  WHERE repair.proposed_elevation_m - repair.expected_elevation_m = repair.delta_m
    AND repair.delta_m > 0 AND repair.delta_m < 1
    AND trunc(repair.proposed_elevation_m) = repair.expected_elevation_m
    AND md5(encode(ST_AsEWKB(segment.path::geometry), 'hex')) = repair.old_path_hash
    AND md5(encode(ST_AsEWKB(ST_Force2D(segment.path::geometry)), 'hex')) = repair.xy_hash
    AND md5((to_jsonb(segment) - ARRAY[
      'path', 'gain', 'gain_loss', 'updated_at'
    ]::text[])::text) = repair.segment_other_fields_hash
    AND ST_NPoints(segment.path::geometry) = repair.point_count
    AND ST_X(ST_PointN(segment.path::geometry, repair.vertex_index)) = repair.lng
    AND ST_Y(ST_PointN(segment.path::geometry, repair.vertex_index)) = repair.lat
    AND ST_Z(ST_PointN(segment.path::geometry, repair.vertex_index)) = repair.expected_elevation_m
    AND (
      SELECT count(*)
      FROM ST_DumpPoints(segment.path::geometry) dumped
      WHERE ST_X((dumped).geom) = repair.lng
        AND ST_Y((dumped).geom) = repair.lat
        AND ST_Z((dumped).geom) = repair.expected_elevation_m
    ) = 1
    AND (
      SELECT array_agg(link.route_id ORDER BY link.route_id)
      FROM route_segments link
      WHERE link.segment_id = segment.id
    ) = ARRAY[repair.route_id]
    AND (
      SELECT md5(string_agg(
        encode(ST_AsEWKB((dumped).geom), 'hex'), '|' ORDER BY (dumped).path
      ))
      FROM ST_DumpPoints(segment.path::geometry) dumped
      WHERE (dumped).path[1] <> repair.vertex_index
    ) = repair.other_points_hash
), calculated AS MATERIALIZED (
  SELECT prepared.*, stats.gain, stats.loss
  FROM prepared
  CROSS JOIN LATERAL route_elevation_stats(prepared.new_path) stats
), updated AS (
  UPDATE segments segment
  SET path = calculated.new_path,
      gain = calculated.gain,
      gain_loss = calculated.loss,
      updated_at = now()
  FROM calculated
  WHERE segment.id = calculated.id
    AND calculated.gain = calculated.expected_new_gain_m
    AND calculated.loss = calculated.expected_new_loss_m
    AND md5(encode(ST_AsEWKB(calculated.new_path::geometry), 'hex')) = calculated.new_path_hash
    AND md5(encode(ST_AsEWKB(ST_Force2D(calculated.new_path::geometry)), 'hex')) = calculated.xy_hash
  RETURNING segment.id,
            md5(encode(ST_AsEWKB(segment.path::geometry), 'hex')) AS path_hash
)
SELECT * FROM updated ORDER BY id`;

export const UPDATE_REVIEWED_ROUTE_VERTICES_SQL = `
WITH repair AS (${PATH_REPAIR_INPUT_SQL}), prepared AS MATERIALIZED (
  SELECT route.id,
         repair.*,
         ST_SetPoint(
           route.path::geometry,
           repair.vertex_index - 1,
           ST_SetSRID(ST_MakePoint(
             ST_X(ST_PointN(route.path::geometry, repair.vertex_index)),
             ST_Y(ST_PointN(route.path::geometry, repair.vertex_index)),
             repair.proposed_elevation_m
           ), 4326)
         )::geography AS new_path
  FROM repair
  JOIN routes route ON route.id = repair.route_id
  JOIN route_destinations destination_link
    ON destination_link.route_id = route.id
   AND destination_link.destination_id = repair.destination_id
  JOIN route_segments segment_link
    ON segment_link.route_id = route.id
   AND segment_link.segment_id = repair.segment_id
  WHERE route.owner = 'peaks' AND route.status = 'active'
    AND repair.proposed_elevation_m - repair.expected_elevation_m = repair.delta_m
    AND repair.delta_m > 0 AND repair.delta_m < 1
    AND trunc(repair.proposed_elevation_m) = repair.expected_elevation_m
    AND md5(encode(ST_AsEWKB(route.path::geometry), 'hex')) = repair.old_path_hash
    AND md5(encode(ST_AsEWKB(ST_Force2D(route.path::geometry)), 'hex')) = repair.xy_hash
    AND md5((to_jsonb(route) - ARRAY[
      'path', 'elevation_string', 'gain', 'gain_loss', 'updated_at'
    ]::text[])::text) = repair.route_other_fields_hash
    AND ST_NPoints(route.path::geometry) = repair.point_count
    AND ST_X(ST_PointN(route.path::geometry, repair.vertex_index)) = repair.lng
    AND ST_Y(ST_PointN(route.path::geometry, repair.vertex_index)) = repair.lat
    AND ST_Z(ST_PointN(route.path::geometry, repair.vertex_index)) = repair.expected_elevation_m
    AND (
      SELECT count(*)
      FROM ST_DumpPoints(route.path::geometry) dumped
      WHERE ST_X((dumped).geom) = repair.lng
        AND ST_Y((dumped).geom) = repair.lat
        AND ST_Z((dumped).geom) = repair.expected_elevation_m
    ) = 1
    AND (
      SELECT md5(string_agg(
        encode(ST_AsEWKB((dumped).geom), 'hex'), '|' ORDER BY (dumped).path
      ))
      FROM ST_DumpPoints(route.path::geometry) dumped
      WHERE (dumped).path[1] <> repair.vertex_index
    ) = repair.other_points_hash
), calculated AS MATERIALIZED (
  SELECT prepared.*, stats.gain, stats.loss,
         encode_route_elevation_profile(prepared.new_path) AS elevation_string
  FROM prepared
  CROSS JOIN LATERAL route_elevation_stats(prepared.new_path) stats
), updated AS (
  UPDATE routes route
  SET path = calculated.new_path,
      gain = calculated.gain,
      gain_loss = calculated.loss,
      elevation_string = calculated.elevation_string,
      updated_at = now()
  FROM calculated
  WHERE route.id = calculated.id
    AND calculated.gain = calculated.expected_new_gain_m
    AND calculated.loss = calculated.expected_new_loss_m
    AND md5(calculated.elevation_string) = calculated.expected_new_profile_hash
    AND md5(encode(ST_AsEWKB(calculated.new_path::geometry), 'hex')) = calculated.new_path_hash
    AND md5(encode(ST_AsEWKB(ST_Force2D(calculated.new_path::geometry)), 'hex')) = calculated.xy_hash
  RETURNING route.id,
            md5(encode(ST_AsEWKB(route.path::geometry), 'hex')) AS path_hash,
            md5(route.elevation_string) AS profile_hash
)
SELECT * FROM updated ORDER BY id`;

export const RECONCILE_ROUTE_ELEVATION_JOBS_SQL = `
WITH repair AS (${PATH_REPAIR_INPUT_SQL}), current_fingerprint AS MATERIALIZED (
  SELECT fingerprint.*
  FROM (${ELEVATION_ROUTE_FINGERPRINT_SQL}) fingerprint
  JOIN repair ON repair.route_id = fingerprint.route_id
), updated AS (
  UPDATE route_elevation_backfill_jobs job
  SET state = 'queued',
      path_fingerprint = current_fingerprint.path_fingerprint,
      attempt_count = 0,
      final_evidence = NULL,
      last_error = NULL,
      next_attempt_at = now(),
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  FROM repair
  JOIN current_fingerprint ON current_fingerprint.route_id = repair.route_id
  WHERE job.route_id = repair.route_id
    AND job.state = repair.expected_route_job_state
    AND job.path_fingerprint = repair.expected_route_job_fingerprint
    AND job.final_evidence IS NULL
    AND (job.lease_expires_at IS NULL OR job.lease_expires_at < now())
  RETURNING job.route_id, job.state, job.path_fingerprint, job.final_evidence
)
SELECT * FROM updated ORDER BY route_id`;

export const RECONCILE_STANDARD_ROUTE_JOBS_SQL = `
WITH repair AS (${PATH_REPAIR_INPUT_SQL}), updated AS (
  UPDATE standard_route_backfill_jobs job
  SET evidence = jsonb_set(
        COALESCE(job.evidence, '{}'::jsonb),
        '{destination_elevation_fraction_repair}',
        jsonb_build_object(
          'schemaVersion', 1,
          'auditReportSha256', $3::text,
          'routeId', repair.route_id,
          'segmentId', repair.segment_id,
          'previousElevationM', repair.expected_elevation_m,
          'elevationM', repair.proposed_elevation_m,
          'deltaM', repair.delta_m,
          'previousPathHash', repair.old_path_hash,
          'pathHash', repair.new_path_hash,
          'vertexIndex', repair.vertex_index,
          'otherPointsHash', repair.other_points_hash,
          'appliedAt', now()
        ),
        true
      ),
      updated_at = now()
  FROM repair
  WHERE job.destination_id = repair.destination_id
    AND job.published_route_id = repair.route_id
    AND job.replacement_route_id = repair.route_id
    AND job.state = repair.expected_standard_job_state
    AND job.evidence = '{}'::jsonb
    AND job.review = '{}'::jsonb
    AND job.candidate_sha256 IS NULL
    AND job.candidate_artifact IS NULL
    AND job.candidate_path IS NULL
    AND job.lease_token IS NULL
    AND job.lease_owner IS NULL
    AND job.lease_expires_at IS NULL
  RETURNING job.destination_id, job.state,
            job.evidence->'destination_elevation_fraction_repair' AS repair_evidence
)
SELECT * FROM updated ORDER BY destination_id`;

export const LIVE_ROWS_SQL = `
WITH incoming AS (${INCOMING_SQL})
SELECT d.id,
       d.owner,
       d.elevation,
       ST_Z(d.location::geometry) AS location_z,
       ST_Y(d.location::geometry) AS lat,
       ST_X(d.location::geometry) AS lng,
       d.external_ids,
       to_char(date_trunc('milliseconds', d.updated_at) AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at_millisecond,
       COALESCE(d.metadata, '{}'::jsonb) ? '${REPAIR_METADATA_KEY}' AS has_repair_metadata
FROM incoming
JOIN destinations d ON d.id = incoming.destination_id
ORDER BY d.id`;

export const LIVE_ROWS_FOR_UPDATE_SQL = `${LIVE_ROWS_SQL}\nFOR UPDATE OF d`;

export const OSM_ID_UNIQUENESS_SQL = `
WITH incoming AS (${INCOMING_SQL})
SELECT incoming.destination_id,
       array_agg(other.id ORDER BY other.id) AS matching_destination_ids
FROM incoming
JOIN destinations other ON (
  CASE incoming.element_type
    WHEN 'node' THEN other.external_ids->>'osm' = incoming.external_id
                  OR other.external_ids->>'osm_node' = incoming.external_id
    WHEN 'way' THEN other.external_ids->>'osm' = incoming.external_id
                 OR other.external_ids->>'osm_way' = incoming.external_id
    ELSE false
  END
)
GROUP BY incoming.destination_id
ORDER BY incoming.destination_id`;

export const DESTINATION_UPDATE_TRIGGER_GUARD_SQL = `
WITH target AS (
  SELECT to_regprocedure('public.link_sessions_on_destination_update()') AS function_oid
), function_state AS (
  SELECT target.function_oid,
         p.oid IS NOT NULL AS function_exists,
         obj_description(p.oid, 'pg_proc') AS function_comment,
         pg_get_functiondef(p.oid) AS function_definition
  FROM target
  LEFT JOIN pg_proc p ON p.oid = target.function_oid
), trigger_state AS (
  SELECT count(*) AS trigger_count,
         count(*) FILTER (WHERE trg.tgenabled IN ('O', 'A')) AS enabled_trigger_count,
         min(pg_get_triggerdef(trg.oid)) AS trigger_definition
  FROM pg_trigger trg
  CROSS JOIN function_state fn_state
  WHERE NOT trg.tgisinternal
    AND trg.tgrelid = to_regclass('public.destinations')
    AND trg.tgname = 'trg_destination_update_link_sessions'
    AND trg.tgfoid = fn_state.function_oid
)
SELECT fn_state.function_exists,
       fn_state.function_comment,
       fn_state.function_definition,
       md5(fn_state.function_definition) AS function_definition_md5,
       trg_state.trigger_count,
       trg_state.enabled_trigger_count,
       trg_state.trigger_definition
FROM function_state fn_state
CROSS JOIN trigger_state trg_state`;

export const SESSION_TRACKING_INVARIANT_SQL = `
WITH changed(destination_id) AS (
  SELECT jsonb_array_elements_text($1::jsonb)
), candidate_destinations AS MATERIALIZED (
  SELECT d.id, d.location, d.boundary, d.features
  FROM destinations d
  JOIN changed ON changed.destination_id = d.id
), nearby_sessions AS MATERIALIZED (
  SELECT DISTINCT ts.id
  FROM candidate_destinations d
  JOIN tracking_points point
    ON d.boundary IS NULL
   AND d.location IS NOT NULL
   AND point.location IS NOT NULL
   AND ST_DWithin(
         d.location,
         point.location,
         CASE WHEN 'summit'::destination_feature = ANY(d.features) THEN 30
              WHEN 'trailhead'::destination_feature = ANY(d.features) THEN 100
              ELSE 50 END
       )
  JOIN tracking_sessions ts ON ts.id = point.session_id AND ts.ended = true
), related_sessions AS MATERIALIZED (
  SELECT session_id
  FROM session_destinations link
  JOIN changed ON changed.destination_id = link.destination_id
  UNION
  SELECT session_id
  FROM session_destination_rejections rejection
  JOIN changed ON changed.destination_id = rejection.destination_id
  UNION
  SELECT id FROM nearby_sessions
), session_destinations_state AS (
  SELECT count(*) AS row_count,
         md5(COALESCE(string_agg(md5(to_jsonb(link)::text), '' ORDER BY link.session_id, link.destination_id), '')) AS row_hash
  FROM session_destinations link
  JOIN changed ON changed.destination_id = link.destination_id
), session_rejections_state AS (
  SELECT count(*) AS row_count,
         md5(COALESCE(string_agg(md5(to_jsonb(rejection)::text), '' ORDER BY rejection.session_id, rejection.destination_id), '')) AS row_hash
  FROM session_destination_rejections rejection
  JOIN changed ON changed.destination_id = rejection.destination_id
), destination_areas_state AS (
  SELECT count(*) AS row_count,
         md5(COALESCE(string_agg(md5(to_jsonb(link)::text), '' ORDER BY link.destination_id, link.area_id), '')) AS row_hash
  FROM destination_areas link
  JOIN changed ON changed.destination_id = link.destination_id
), tracking_sessions_state AS (
  SELECT count(*) AS row_count,
         md5(COALESCE(string_agg(md5(to_jsonb(ts_row)::text), '' ORDER BY ts_row.id), '')) AS row_hash
  FROM tracking_sessions ts_row
  JOIN related_sessions related ON related.session_id = ts_row.id
), tracking_points_state AS (
  SELECT count(*) AS row_count,
         md5(COALESCE(string_agg(
           md5(jsonb_build_array(
             point.session_id,
             point.time,
             point.segment_number,
             CASE WHEN point.location IS NULL THEN NULL
                  ELSE encode(ST_AsEWKB(point.location::geometry), 'hex') END,
             point.elevation,
             point.speed,
             point.azimuth,
             point.hdop,
             point.speed_accuracy,
             point.geohash
           )::text),
           '' ORDER BY point.session_id, point.time
         ), '')) AS row_hash
  FROM tracking_points point
  JOIN related_sessions related ON related.session_id = point.session_id
)
SELECT destinations.row_count AS session_destinations_count,
       destinations.row_hash AS session_destinations_hash,
       rejections.row_count AS session_destination_rejections_count,
       rejections.row_hash AS session_destination_rejections_hash,
       areas.row_count AS destination_areas_count,
       areas.row_hash AS destination_areas_hash,
       sessions.row_count AS relevant_tracking_sessions_count,
       sessions.row_hash AS relevant_tracking_sessions_hash,
       points.row_count AS relevant_tracking_points_count,
       points.row_hash AS relevant_tracking_points_hash
FROM session_destinations_state destinations
CROSS JOIN session_rejections_state rejections
CROSS JOIN destination_areas_state areas
CROSS JOIN tracking_sessions_state sessions
CROSS JOIN tracking_points_state points`;

export const FINGERPRINT_IMPACT_SQL = `
WITH changed(destination_id) AS (
  SELECT jsonb_array_elements_text($1::jsonb)
), directly_linked_routes AS MATERIALIZED (
  SELECT DISTINCT rd.route_id
  FROM route_destinations rd
  JOIN changed ON changed.destination_id = rd.destination_id
), catalog_routes AS MATERIALIZED (
  SELECT r.id
  FROM routes r
  JOIN directly_linked_routes linked ON linked.route_id = r.id
  WHERE r.owner = 'peaks'
    AND (
      r.status = 'active'
      OR (
        r.status = 'superseded'
        AND r.id ~ '^osm-route-[0-9]+-[0-9a-f]{10}$'
        AND r.provenance IS NULL
        AND r.completion = 'none'
        AND r.shape IS NULL
        AND r.gain IS NULL
        AND r.gain_loss IS NULL
        AND jsonb_typeof(r.external_links) = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(r.external_links) link
          WHERE link->>'type' = 'osm' AND link->>'id' ~ '^relation/[0-9]+$'
        )
        AND NOT EXISTS (SELECT 1 FROM route_segments rs WHERE rs.route_id = r.id)
        AND NOT EXISTS (
          SELECT 1
          FROM route_destinations rd
          JOIN destinations linked_destination ON linked_destination.id = rd.destination_id
          WHERE rd.route_id = r.id
            AND 'trailhead'::destination_feature = ANY(linked_destination.features)
        )
      )
    )
), affected_catalog_destinations AS MATERIALIZED (
  SELECT DISTINCT rd.destination_id
  FROM catalog_routes route
  JOIN route_destinations rd ON rd.route_id = route.id
  JOIN destinations destination ON destination.id = rd.destination_id
  WHERE 'summit'::destination_feature = ANY(destination.features)
), affected_standard_jobs AS MATERIALIZED (
  SELECT DISTINCT job.destination_id
  FROM standard_route_backfill_jobs job
  WHERE job.destination_id IN (SELECT destination_id FROM changed)
     OR job.published_route_id IN (SELECT route_id FROM directly_linked_routes)
     OR job.replacement_route_id IN (SELECT route_id FROM directly_linked_routes)
)
SELECT
  (SELECT count(*) FROM directly_linked_routes) AS directly_linked_routes,
  (SELECT count(*) FROM catalog_routes) AS catalog_routes,
  (SELECT count(*) FROM affected_catalog_destinations) AS catalog_destinations,
  (SELECT count(*) FROM route_catalog_audit_jobs job
   JOIN affected_catalog_destinations affected ON affected.destination_id = job.destination_id)
    AS existing_catalog_jobs,
  (SELECT count(*) FROM route_catalog_audit_jobs job
   JOIN affected_catalog_destinations affected ON affected.destination_id = job.destination_id
   WHERE job.state = 'auditing' AND job.lease_expires_at >= now()) AS active_catalog_leases,
  (SELECT count(*) FROM route_elevation_backfill_jobs job
   JOIN directly_linked_routes linked ON linked.route_id = job.route_id)
    AS route_elevation_jobs_on_linked_routes,
  (SELECT count(*) FROM route_elevation_backfill_jobs job
   JOIN directly_linked_routes linked ON linked.route_id = job.route_id
   WHERE job.state = 'working' AND job.lease_expires_at >= now())
    AS active_route_elevation_leases_on_linked_routes,
  (SELECT count(*) FROM affected_standard_jobs) AS standard_route_jobs,
  (SELECT count(*) FROM standard_route_backfill_jobs job
   JOIN affected_standard_jobs affected ON affected.destination_id = job.destination_id
   WHERE job.lease_token IS NOT NULL AND job.lease_expires_at >= now())
    AS active_standard_route_leases`;

export const CATALOG_SCOPE_SQL = `
WITH changed(destination_id) AS (
  SELECT jsonb_array_elements_text($1::jsonb)
), catalog_routes AS MATERIALIZED (
  SELECT r.id
  FROM routes r
  WHERE r.owner = 'peaks'
    AND EXISTS (
      SELECT 1
      FROM route_destinations changed_link
      JOIN changed ON changed.destination_id = changed_link.destination_id
      WHERE changed_link.route_id = r.id
    )
    AND (
      r.status = 'active'
      OR (
        r.status = 'superseded'
        AND r.id ~ '^osm-route-[0-9]+-[0-9a-f]{10}$'
        AND r.provenance IS NULL
        AND r.completion = 'none'
        AND r.shape IS NULL
        AND r.gain IS NULL
        AND r.gain_loss IS NULL
        AND jsonb_typeof(r.external_links) = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(r.external_links) link
          WHERE link->>'type' = 'osm' AND link->>'id' ~ '^relation/[0-9]+$'
        )
        AND NOT EXISTS (SELECT 1 FROM route_segments rs WHERE rs.route_id = r.id)
        AND NOT EXISTS (
          SELECT 1
          FROM route_destinations rd
          JOIN destinations linked_destination ON linked_destination.id = rd.destination_id
          WHERE rd.route_id = r.id
            AND 'trailhead'::destination_feature = ANY(linked_destination.features)
        )
      )
    )
), affected AS MATERIALIZED (
  SELECT DISTINCT linked.destination_id
  FROM catalog_routes route
  JOIN route_destinations linked ON linked.route_id = route.id
  JOIN destinations destination ON destination.id = linked.destination_id
  WHERE 'summit'::destination_feature = ANY(destination.features)
)
SELECT affected.destination_id,
       job.destination_name,
       job.state,
       job.priority,
       job.route_count,
       job.audit_rule_version,
       job.catalog_fingerprint,
       job.attempt_count,
       job.lease_owner,
       job.lease_token,
       CASE WHEN job.lease_expires_at IS NULL THEN NULL ELSE
         to_char(job.lease_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
       END AS lease_expires_at,
       job.last_error,
       job.final_result::text AS final_result_text,
       CASE WHEN job.audited_at IS NULL THEN NULL ELSE
         to_char(job.audited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
       END AS audited_at
FROM affected
LEFT JOIN route_catalog_audit_jobs job
  ON job.destination_id = affected.destination_id
ORDER BY affected.destination_id`;

export const ROUTE_VERTEX_IMPACT_SQL = `
WITH incoming AS (${INCOMING_SQL}), linked_peaks_routes AS MATERIALIZED (
  SELECT incoming.destination_id,
         incoming.destination_name,
         incoming.expected_elevation_m,
         incoming.proposed_elevation_m,
         incoming.lat,
         incoming.lng,
         route.id AS route_id,
         route.name AS route_name,
         route.status,
         route.path
  FROM incoming
  JOIN route_destinations linked ON linked.destination_id = incoming.destination_id
  JOIN routes route ON route.id = linked.route_id
  WHERE route.owner = 'peaks' AND route.path IS NOT NULL
), nearest_route_vertices AS MATERIALIZED (
  SELECT linked.*,
         nearest.vertex_index,
         nearest.vertex_z,
         nearest.vertex_distance_m
  FROM linked_peaks_routes linked
  CROSS JOIN LATERAL (
    SELECT (dumped).path[1]::int AS vertex_index,
           ST_Z((dumped).geom) AS vertex_z,
           ST_Distance(
             (dumped).geom::geography,
             ST_SetSRID(ST_MakePoint(linked.lng, linked.lat), 4326)::geography
           ) AS vertex_distance_m
    FROM ST_DumpPoints(linked.path::geometry) dumped
    ORDER BY (dumped).geom <-> ST_SetSRID(ST_MakePoint(linked.lng, linked.lat), 4326),
             (dumped).path
    LIMIT 1
  ) nearest
), route_pins AS MATERIALIZED (
  SELECT *
  FROM nearest_route_vertices
  WHERE vertex_distance_m <= 20
    AND vertex_z = expected_elevation_m
    AND vertex_z <> proposed_elevation_m
), nearest_segment_vertices AS MATERIALIZED (
  SELECT pin.destination_id,
         pin.destination_name,
         pin.expected_elevation_m,
         pin.proposed_elevation_m,
         pin.lat,
         pin.lng,
         pin.route_id,
         pin.route_name,
         pin.status,
         segment.id AS segment_id,
         nearest.vertex_index,
         nearest.vertex_z,
         nearest.vertex_distance_m
  FROM route_pins pin
  JOIN route_segments route_segment ON route_segment.route_id = pin.route_id
  JOIN segments segment ON segment.id = route_segment.segment_id
  CROSS JOIN LATERAL (
    SELECT (dumped).path[1]::int AS vertex_index,
           ST_Z((dumped).geom) AS vertex_z,
           ST_Distance(
             (dumped).geom::geography,
             ST_SetSRID(ST_MakePoint(pin.lng, pin.lat), 4326)::geography
           ) AS vertex_distance_m
    FROM ST_DumpPoints(segment.path::geometry) dumped
    ORDER BY (dumped).geom <-> ST_SetSRID(ST_MakePoint(pin.lng, pin.lat), 4326),
             (dumped).path
    LIMIT 1
  ) nearest
), segment_pins AS MATERIALIZED (
  SELECT *
  FROM nearest_segment_vertices
  WHERE vertex_distance_m <= 20
    AND vertex_z = expected_elevation_m
    AND vertex_z <> proposed_elevation_m
)
SELECT
  (SELECT count(DISTINCT route_id) FROM linked_peaks_routes) AS linked_peaks_routes,
  (SELECT count(DISTINCT route_id) FROM route_pins) AS pinned_routes,
  (SELECT count(DISTINCT route_id) FROM route_pins WHERE status = 'active') AS pinned_active_routes,
  (SELECT count(DISTINCT route_id) FROM route_pins WHERE status = 'pending') AS pinned_pending_routes,
  (SELECT count(*) FROM route_pins) AS route_destination_pins,
  (SELECT count(DISTINCT segment_id) FROM segment_pins) AS pinned_segments,
  (SELECT count(*) FROM segment_pins) AS route_segment_pins,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'destinationId', destination_id,
      'destinationName', destination_name,
      'routeId', route_id,
      'routeName', route_name,
      'routeStatus', status,
      'vertexIndex', vertex_index,
      'vertexDistanceM', vertex_distance_m,
      'oldVertexElevationM', vertex_z,
      'proposedDestinationElevationM', proposed_elevation_m
    ) ORDER BY destination_id, route_id)
    FROM route_pins
  ), '[]'::jsonb) AS route_pins,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'destinationId', destination_id,
      'destinationName', destination_name,
      'routeId', route_id,
      'segmentId', segment_id,
      'vertexIndex', vertex_index,
      'vertexDistanceM', vertex_distance_m,
      'oldVertexElevationM', vertex_z,
      'proposedDestinationElevationM', proposed_elevation_m
    ) ORDER BY destination_id, route_id, segment_id)
    FROM segment_pins
  ), '[]'::jsonb) AS segment_pins`;

export const LOCK_AFFECTED_CATALOG_JOBS_SQL = `
WITH reviewed(destination_id) AS (
  SELECT jsonb_array_elements_text($1::jsonb)
)
SELECT job.destination_id,
       job.destination_name,
       job.state,
       job.priority,
       job.route_count,
       job.audit_rule_version,
       job.catalog_fingerprint,
       job.attempt_count,
       job.lease_owner,
       job.lease_token,
       CASE WHEN job.lease_expires_at IS NULL THEN NULL ELSE
         to_char(job.lease_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
       END AS lease_expires_at,
       job.last_error,
       job.final_result::text AS final_result_text,
       CASE WHEN job.audited_at IS NULL THEN NULL ELSE
         to_char(job.audited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
       END AS audited_at
FROM route_catalog_audit_jobs job
JOIN reviewed ON reviewed.destination_id = job.destination_id
ORDER BY job.destination_id
FOR UPDATE OF job`;

export const RECOVER_EXPIRED_AFFECTED_CATALOG_JOBS_SQL = `
WITH locked AS (${LOCK_AFFECTED_CATALOG_JOBS_SQL})
UPDATE route_catalog_audit_jobs job
SET state = 'queued',
    lease_owner = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    last_error = COALESCE(job.last_error, 'expired lease recovered before elevation fraction repair'),
    updated_at = now()
FROM locked
WHERE job.destination_id = locked.destination_id
  AND locked.state = 'auditing'
  AND locked.lease_expires_at::timestamptz < now()
RETURNING job.destination_id`;

export const TARGETED_CATALOG_SEED_SQL = `
WITH reviewed(destination_id) AS (
  SELECT jsonb_array_elements_text($1::jsonb)
), candidates AS MATERIALIZED (
  SELECT normal_candidate.*
  FROM (${catalogCandidateSql}) normal_candidate
  JOIN reviewed ON reviewed.destination_id = normal_candidate.destination_id
)
INSERT INTO route_catalog_audit_jobs AS job (
  destination_id, destination_name, priority, route_count,
  audit_rule_version, catalog_fingerprint
)
SELECT destination_id, destination_name, priority, route_count,
       audit_rule_version, catalog_fingerprint
FROM candidates
ON CONFLICT (destination_id) DO UPDATE SET
  destination_name = EXCLUDED.destination_name,
  priority = EXCLUDED.priority,
  route_count = EXCLUDED.route_count,
  audit_rule_version = EXCLUDED.audit_rule_version,
  catalog_fingerprint = EXCLUDED.catalog_fingerprint,
  state = CASE
    WHEN job.audit_rule_version < EXCLUDED.audit_rule_version
      OR job.catalog_fingerprint <> EXCLUDED.catalog_fingerprint
    THEN 'queued'
    ELSE job.state
  END,
  final_result = CASE
    WHEN job.audit_rule_version < EXCLUDED.audit_rule_version
      OR job.catalog_fingerprint <> EXCLUDED.catalog_fingerprint
    THEN NULL ELSE job.final_result
  END,
  audited_at = CASE
    WHEN job.audit_rule_version < EXCLUDED.audit_rule_version
      OR job.catalog_fingerprint <> EXCLUDED.catalog_fingerprint
    THEN NULL ELSE job.audited_at
  END,
  last_error = CASE
    WHEN job.audit_rule_version < EXCLUDED.audit_rule_version
      OR job.catalog_fingerprint <> EXCLUDED.catalog_fingerprint
    THEN NULL ELSE job.last_error
  END,
  lease_owner = CASE
    WHEN job.audit_rule_version < EXCLUDED.audit_rule_version
      OR job.catalog_fingerprint <> EXCLUDED.catalog_fingerprint
    THEN NULL ELSE job.lease_owner
  END,
  lease_token = CASE
    WHEN job.audit_rule_version < EXCLUDED.audit_rule_version
      OR job.catalog_fingerprint <> EXCLUDED.catalog_fingerprint
    THEN NULL ELSE job.lease_token
  END,
  lease_expires_at = CASE
    WHEN job.audit_rule_version < EXCLUDED.audit_rule_version
      OR job.catalog_fingerprint <> EXCLUDED.catalog_fingerprint
    THEN NULL ELSE job.lease_expires_at
  END,
  updated_at = now()
RETURNING destination_id, state, catalog_fingerprint`;

export const UPDATE_SQL = `
WITH incoming AS (${INCOMING_SQL}), updated AS (
  UPDATE destinations d
  SET elevation = incoming.proposed_elevation_m,
      location = ST_SetSRID(ST_MakePoint(
        ST_X(d.location::geometry),
        ST_Y(d.location::geometry),
        incoming.proposed_elevation_m
      ), 4326)::geography,
      metadata = jsonb_set(
        COALESCE(d.metadata, '{}'::jsonb),
        '{${REPAIR_METADATA_KEY}}',
        jsonb_strip_nulls(jsonb_build_object(
          'schemaVersion', 1,
          'auditReportSha256', $2::text,
          'source', 'openstreetmap',
          'sourceId', incoming.provider_id,
          'sourceUrl', incoming.source_url,
          'sourceAttribution', '© OpenStreetMap contributors',
          'sourceLicenseUrl', 'https://www.openstreetmap.org/copyright',
          'sourceVersion', incoming.source_version,
          'sourceTimestamp', incoming.source_timestamp,
          'rawElevation', incoming.raw_value,
          'rawUnit', incoming.raw_unit,
          'previousElevationM', incoming.expected_elevation_m,
          'elevationM', incoming.proposed_elevation_m,
          'deltaM', incoming.delta_m,
          'identityDistanceM', incoming.identity_distance_m,
          'wikidataId', incoming.wikidata_id,
          'provenanceCutoffAt', incoming.provenance_cutoff_at,
          'provenanceCutoffBasis', incoming.provenance_cutoff_basis,
          'provenanceProof', incoming.provenance_proof,
          'proofVersion', incoming.proof_version,
          'proofTimestamp', incoming.proof_timestamp,
          'proofRawElevation', incoming.proof_raw_value,
          'appliedAt', now()
        )),
        true
      )
  FROM incoming
  WHERE d.id = incoming.destination_id
    AND d.owner = 'peaks'
    AND d.location IS NOT NULL
    AND d.elevation IS NOT NULL
    AND d.elevation NOT IN (
      'NaN'::double precision,
      'Infinity'::double precision,
      '-Infinity'::double precision
    )
    AND incoming.proposed_elevation_m NOT IN (
      'NaN'::double precision,
      'Infinity'::double precision,
      '-Infinity'::double precision
    )
    AND d.elevation = incoming.expected_elevation_m
    AND d.elevation = trunc(d.elevation)
    AND ST_Z(d.location::geometry) = d.elevation
    AND ST_X(d.location::geometry) = incoming.lng
    AND ST_Y(d.location::geometry) = incoming.lat
    AND date_trunc('milliseconds', d.updated_at) = incoming.expected_updated_at
    AND d.external_ids->>incoming.external_key = incoming.external_id
    AND incoming.proposed_elevation_m <> trunc(incoming.proposed_elevation_m)
    AND incoming.proposed_elevation_m > d.elevation
    AND incoming.proposed_elevation_m - d.elevation > 0
    AND incoming.proposed_elevation_m - d.elevation < 1
    AND trunc(incoming.proposed_elevation_m) = d.elevation
    AND incoming.delta_m = incoming.proposed_elevation_m - d.elevation
    AND incoming.raw_unit = 'm'
    AND incoming.identity_distance_m BETWEEN 0 AND ${MAX_IDENTITY_DISTANCE_M}
    AND incoming.provenance_cutoff_basis IN ('destination_created_at', 'osm_id_backfill')
    AND incoming.provenance_proof IN ('current_version', 'history_version')
    AND incoming.proof_timestamp <= incoming.provenance_cutoff_at
    AND NOT (COALESCE(d.metadata, '{}'::jsonb) ? '${REPAIR_METADATA_KEY}')
  RETURNING d.id,
            d.elevation,
            ST_X(d.location::geometry) AS lng,
            ST_Y(d.location::geometry) AS lat,
            ST_Z(d.location::geometry) AS location_z,
            d.metadata->'${REPAIR_METADATA_KEY}' AS repair_metadata
)
SELECT * FROM updated ORDER BY id`;

export const POST_UPDATE_SQL = `
WITH incoming AS (${INCOMING_SQL})
SELECT d.id,
       d.elevation,
       ST_Z(d.location::geometry) AS location_z,
       ST_X(d.location::geometry) AS lng,
       ST_Y(d.location::geometry) AS lat,
       d.metadata->'${REPAIR_METADATA_KEY}'->>'auditReportSha256' AS report_sha256
FROM incoming
JOIN destinations d ON d.id = incoming.destination_id
WHERE d.elevation = incoming.proposed_elevation_m
  AND ST_Z(d.location::geometry) = incoming.proposed_elevation_m
  AND ST_X(d.location::geometry) = incoming.lng
  AND ST_Y(d.location::geometry) = incoming.lat
  AND d.metadata->'${REPAIR_METADATA_KEY}'->>'auditReportSha256' = $2::text
ORDER BY d.id`;

function number(value: number | string): number {
  return Number(value);
}

export function catalogDestinationSetSha256(destinationIds: readonly string[]): string {
  return crypto.createHash("sha256").update([...destinationIds].sort().join("\n")).digest("hex");
}

export function catalogPreStateSha256(rows: readonly CatalogScopeRow[]): string {
  const payload = [...rows]
    .sort((a, b) => a.destination_id.localeCompare(b.destination_id))
    .map((row) => JSON.stringify({
      destinationId: row.destination_id,
      destinationName: row.destination_name,
      state: row.state,
      priority: row.priority == null ? null : number(row.priority),
      routeCount: row.route_count == null ? null : number(row.route_count),
      auditRuleVersion: row.audit_rule_version == null ? null : number(row.audit_rule_version),
      catalogFingerprint: row.catalog_fingerprint,
      attemptCount: row.attempt_count == null ? null : number(row.attempt_count),
      leaseOwner: row.lease_owner,
      leaseToken: row.lease_token,
      leaseExpiresAt: row.lease_expires_at,
      lastError: row.last_error,
      finalResult: row.final_result_text,
      auditedAt: row.audited_at,
    }))
    .join("\n");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function validateReviewedCatalogManifest(): void {
  if (REVIEWED_CATALOG_DESTINATION_IDS.length !== REVIEWED_CATALOG_DESTINATION_COUNT) {
    throw new Error("reviewed catalog manifest must contain exactly 115 destination IDs");
  }
  if (new Set(REVIEWED_CATALOG_DESTINATION_IDS).size !== REVIEWED_CATALOG_DESTINATION_COUNT) {
    throw new Error("reviewed catalog manifest contains a duplicate destination ID");
  }
  if (catalogDestinationSetSha256(REVIEWED_CATALOG_DESTINATION_IDS) !==
      REVIEWED_CATALOG_DESTINATION_SET_SHA256) {
    throw new Error("reviewed catalog manifest set hash does not match its pinned SHA-256");
  }
}

export function validateCatalogScopeRows(
  rows: readonly CatalogScopeRow[],
  requireReviewedPreState = true
): { destinationCount: number; destinationSetSha256: string; preStateSha256: string } {
  validateReviewedCatalogManifest();
  const ids = rows.map((row) => row.destination_id);
  const setSha256 = catalogDestinationSetSha256(ids);
  const reviewedIds = [...REVIEWED_CATALOG_DESTINATION_IDS].sort();
  const liveIds = [...ids].sort();
  if (rows.length !== REVIEWED_CATALOG_DESTINATION_COUNT ||
      setSha256 !== REVIEWED_CATALOG_DESTINATION_SET_SHA256 ||
      liveIds.join("\n") !== reviewedIds.join("\n")) {
    throw new Error(
      `live catalog scope is not the reviewed 115-ID set (count ${rows.length}, SHA-256 ${setSha256})`
    );
  }
  if (rows.some((row) => row.state == null || row.catalog_fingerprint == null)) {
    throw new Error("one or more reviewed catalog destinations has no audit job");
  }
  const preStateSha256 = catalogPreStateSha256(rows);
  if (requireReviewedPreState && preStateSha256 !== REVIEWED_CATALOG_PRESTATE_SHA256) {
    throw new Error(
      `live catalog job pre-state SHA-256 ${preStateSha256} does not match review`
    );
  }
  return {
    destinationCount: rows.length,
    destinationSetSha256: setSha256,
    preStateSha256,
  };
}

export function destinationUpdateTriggerGuard(
  row: DestinationUpdateTriggerGuardRow
): DestinationUpdateTriggerGuard {
  const definition = row.function_definition ?? "";
  const triggerDefinition = row.trigger_definition ?? "";
  const safeComment = row.function_comment === DESTINATION_UPDATE_TRIGGER_SAFE_COMMENT;
  const safeBodyMarker = definition.includes(DESTINATION_UPDATE_TRIGGER_SAFE_BODY_MARKER);
  const xyOnlyPredicate =
    definition.includes(
      "(OLD.location IS NULL) IS DISTINCT FROM (NEW.location IS NULL)"
    ) &&
    definition.includes(
      "ST_X(OLD.location::geometry) IS DISTINCT FROM ST_X(NEW.location::geometry)"
    ) &&
    definition.includes(
      "ST_Y(OLD.location::geometry) IS DISTINCT FROM ST_Y(NEW.location::geometry)"
    ) &&
    !definition.includes("OLD.location != NEW.location");
  const rejectionAntiJoin =
    definition.split("FROM session_destination_rejections r").length - 1 === 2 &&
    definition.includes("r.session_id = tp.session_id") &&
    definition.includes("r.destination_id = NEW.id");
  const exactEnabledTrigger =
    number(row.trigger_count) === 1 &&
    number(row.enabled_trigger_count) === 1 &&
    triggerDefinition.includes("AFTER UPDATE OF boundary, location ON public.destinations") &&
    triggerDefinition.includes("EXECUTE FUNCTION link_sessions_on_destination_update()");
  const guard = {
    safe: row.function_exists && safeComment && safeBodyMarker && xyOnlyPredicate &&
      rejectionAntiJoin && exactEnabledTrigger,
    functionExists: row.function_exists,
    functionDefinitionMd5: row.function_definition_md5,
    safeComment,
    safeBodyMarker,
    xyOnlyPredicate,
    rejectionAntiJoin,
    exactEnabledTrigger,
  };
  return guard;
}

export function assertDestinationUpdateTriggerGuard(
  guard: DestinationUpdateTriggerGuard
): void {
  if (!guard.safe) {
    throw new Error(
      "destination session-link update trigger lacks the reviewed XY-only/rejection guard"
    );
  }
}

export function sessionTrackingInvariant(
  row: SessionTrackingInvariantRow
): SessionTrackingInvariant {
  const invariant = {
    sessionDestinationsCount: number(row.session_destinations_count),
    sessionDestinationsHash: row.session_destinations_hash,
    sessionDestinationRejectionsCount: number(row.session_destination_rejections_count),
    sessionDestinationRejectionsHash: row.session_destination_rejections_hash,
    destinationAreasCount: number(row.destination_areas_count),
    destinationAreasHash: row.destination_areas_hash,
    relevantTrackingSessionsCount: number(row.relevant_tracking_sessions_count),
    relevantTrackingSessionsHash: row.relevant_tracking_sessions_hash,
    relevantTrackingPointsCount: number(row.relevant_tracking_points_count),
    relevantTrackingPointsHash: row.relevant_tracking_points_hash,
  };
  for (const hash of [
    invariant.sessionDestinationsHash,
    invariant.sessionDestinationRejectionsHash,
    invariant.destinationAreasHash,
    invariant.relevantTrackingSessionsHash,
    invariant.relevantTrackingPointsHash,
  ]) {
    if (!/^[0-9a-f]{32}$/.test(hash)) {
      throw new Error("session/tracking invariant query returned an invalid hash");
    }
  }
  return invariant;
}

export function assertSessionTrackingInvariantUnchanged(
  before: SessionTrackingInvariant,
  after: SessionTrackingInvariant
): void {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("session, destination-area, or tracking rows changed during elevation repair");
  }
}

export function fingerprintImpact(row: ImpactRow): FingerprintImpact {
  const catalogDestinations = number(row.catalog_destinations);
  return {
    directlyLinkedRoutes: number(row.directly_linked_routes),
    catalogRoutes: number(row.catalog_routes),
    catalogDestinations,
    existingCatalogJobs: number(row.existing_catalog_jobs),
    activeCatalogLeases: number(row.active_catalog_leases),
    routeElevationJobsOnLinkedRoutes: number(row.route_elevation_jobs_on_linked_routes),
    activeRouteElevationLeasesOnLinkedRoutes: number(row.active_route_elevation_leases_on_linked_routes),
    standardRouteJobs: number(row.standard_route_jobs),
    activeStandardRouteLeases: number(row.active_standard_route_leases),
    destinationOnlyRouteElevationFingerprintChanges: 0,
    routeElevationFingerprintChanges: 0,
    standardRouteFingerprintChanges: 0,
    catalogFingerprintChanges: catalogDestinations,
    catalogReseedRequired: catalogDestinations > 0,
  };
}

function withReviewedPathFingerprintImpact(
  impact: FingerprintImpact,
  pathRepairCount: number
): FingerprintImpact {
  return { ...impact, routeElevationFingerprintChanges: pathRepairCount };
}

export function routeVertexImpact(row: RouteVertexImpactRow): RouteVertexImpact {
  const routesWithPinnedOldSummitVertex = number(row.pinned_routes);
  return {
    linkedPeaksRoutes: number(row.linked_peaks_routes),
    routesWithPinnedOldSummitVertex,
    activeRoutesWithPinnedOldSummitVertex: number(row.pinned_active_routes),
    pendingRoutesWithPinnedOldSummitVertex: number(row.pinned_pending_routes),
    routeDestinationPins: number(row.route_destination_pins),
    routeSegmentsWithPinnedOldSummitVertex: number(row.pinned_segments),
    routeSegmentPins: number(row.route_segment_pins),
    routePins: row.route_pins,
    segmentPins: row.segment_pins,
    importerPinnedSummitContractApplies: routesWithPinnedOldSummitVertex > 0,
    normalWorkflowRepair: routesWithPinnedOldSummitVertex > 0
      ? "guarded_exact_vertex_update"
      : null,
  };
}

export function validateReviewedRouteVertexScope(impact: RouteVertexImpact): void {
  if (impact.routesWithPinnedOldSummitVertex !== REVIEWED_PATH_REPAIRS.length ||
      impact.routeSegmentsWithPinnedOldSummitVertex !== REVIEWED_PATH_REPAIRS.length ||
      impact.routeDestinationPins !== REVIEWED_PATH_REPAIRS.length ||
      impact.routeSegmentPins !== REVIEWED_PATH_REPAIRS.length) {
    throw new Error("live pinned summit vertex scope is not the reviewed two routes and segments");
  }
  const reviewedRoutes = REVIEWED_PATH_REPAIRS.map((repair) => repair.routeId).sort();
  const reviewedSegments = REVIEWED_PATH_REPAIRS.map((repair) => repair.segmentId).sort();
  const liveRoutes = impact.routePins.map((pin) => String(pin.routeId)).sort();
  const liveSegments = impact.segmentPins.map((pin) => String(pin.segmentId)).sort();
  if (liveRoutes.join("\n") !== reviewedRoutes.join("\n") ||
      liveSegments.join("\n") !== reviewedSegments.join("\n")) {
    throw new Error("live pinned summit vertex IDs do not match the reviewed manifest");
  }
}

async function queryImpact(client: QueryClient, candidates: ValidatedCandidate[]): Promise<FingerprintImpact> {
  const ids = candidates.map((candidate) => candidate.destinationId);
  const result = await client.query<ImpactRow>(FINGERPRINT_IMPACT_SQL, [JSON.stringify(ids)]);
  if (result.rows.length !== 1) throw new Error("fingerprint impact query returned no result");
  return fingerprintImpact(result.rows[0]);
}

async function queryCatalogScope(
  client: QueryClient,
  candidates: ValidatedCandidate[],
  requireReviewedPreState = true
): Promise<{
  destinationCount: number;
  destinationSetSha256: string;
  preStateSha256: string;
}> {
  const ids = JSON.stringify(candidates.map((candidate) => candidate.destinationId));
  const result = await client.query<CatalogScopeRow>(CATALOG_SCOPE_SQL, [ids]);
  return validateCatalogScopeRows(result.rows, requireReviewedPreState);
}

async function inspectDestinationUpdateTrigger(
  client: QueryClient
): Promise<DestinationUpdateTriggerGuard> {
  const result = await client.query<DestinationUpdateTriggerGuardRow>(
    DESTINATION_UPDATE_TRIGGER_GUARD_SQL
  );
  if (result.rows.length !== 1) {
    throw new Error("destination update trigger guard query returned no result");
  }
  return destinationUpdateTriggerGuard(result.rows[0]);
}

async function querySessionTrackingInvariant(
  client: QueryClient,
  candidates: ValidatedCandidate[]
): Promise<SessionTrackingInvariant> {
  const ids = JSON.stringify(candidates.map((candidate) => candidate.destinationId));
  const result = await client.query<SessionTrackingInvariantRow>(
    SESSION_TRACKING_INVARIANT_SQL,
    [ids]
  );
  if (result.rows.length !== 1) {
    throw new Error("session/tracking invariant query returned no result");
  }
  return sessionTrackingInvariant(result.rows[0]);
}

async function queryRouteVertexImpact(
  client: QueryClient,
  candidateJson: string
): Promise<RouteVertexImpact> {
  const result = await client.query<RouteVertexImpactRow>(ROUTE_VERTEX_IMPACT_SQL, [candidateJson]);
  if (result.rows.length !== 1) throw new Error("route vertex impact query returned no result");
  return routeVertexImpact(result.rows[0]);
}

export function validateReviewedPathRepairs(candidates: ValidatedCandidate[]): void {
  if (REVIEWED_PATH_REPAIRS.length !== 2) {
    throw new Error("reviewed path repair manifest must contain exactly two repairs");
  }
  const candidatesById = new Map(candidates.map((candidate) => [candidate.destinationId, candidate]));
  if (new Set(REVIEWED_PATH_REPAIRS.map((repair) => repair.destinationId)).size !== 2 ||
      new Set(REVIEWED_PATH_REPAIRS.map((repair) => repair.routeId)).size !== 2 ||
      new Set(REVIEWED_PATH_REPAIRS.map((repair) => repair.segmentId)).size !== 2) {
    throw new Error("reviewed path repair destination, route, and segment IDs must be unique");
  }
  for (const repair of REVIEWED_PATH_REPAIRS) {
    const candidate = candidatesById.get(repair.destinationId);
    if (!candidate) throw new Error(`${repair.destinationId} path repair is not in the reviewed report`);
    if (!(candidate.deltaM > 0 && candidate.deltaM < 1) ||
        Math.trunc(candidate.proposedElevationM) !== candidate.expectedElevationM) {
      throw new Error(`${repair.destinationId} path repair does not restore one fractional component`);
    }
    if (repair.vertexIndex < 1 || repair.vertexIndex > repair.pointCount) {
      throw new Error(`${repair.routeId} reviewed vertex index is outside its path`);
    }
    for (const hash of [
      repair.oldPathHash,
      repair.newPathHash,
      repair.xyHash,
      repair.otherPointsHash,
      repair.routeOtherFieldsHash,
      repair.segmentOtherFieldsHash,
      repair.expectedNewProfileHash,
      repair.expectedRouteJobFingerprint,
    ]) {
      if (!/^[0-9a-f]{32}$/.test(hash)) throw new Error(`${repair.routeId} has an invalid pinned hash`);
    }
  }
}

async function queryPathRepairAudit(
  client: QueryClient,
  candidateJson: string
): Promise<PathRepairAuditRow[]> {
  const result = await client.query<PathRepairAuditRow>(
    PATH_REPAIR_AUDIT_SQL,
    [candidateJson, pathRepairsJson()]
  );
  return result.rows;
}

function jsonIsEmpty(value: JsonObject | null): boolean {
  return value != null && Object.keys(value).length === 0;
}

export function validatePathRepairAudit(
  rows: PathRepairAuditRow[],
  phase: "before" | "after",
  reportSha256 = REVIEWED_REPORT_SHA256
): void {
  if (rows.length !== REVIEWED_PATH_REPAIRS.length) {
    throw new Error(`path repair ${phase} audit returned ${rows.length} rows instead of 2`);
  }
  const repairByDestination = new Map(
    REVIEWED_PATH_REPAIRS.map((repair) => [repair.destinationId, repair])
  );
  for (const row of rows) {
    const repair = repairByDestination.get(row.destination_id);
    if (!repair || row.route_id !== repair.routeId || row.segment_id !== repair.segmentId) {
      throw new Error(`path repair ${phase} audit returned an unexpected object`);
    }
    const expectedPathHash = phase === "before" ? repair.oldPathHash : repair.newPathHash;
    if (row.route_path_hash !== expectedPathHash || row.segment_path_hash !== expectedPathHash) {
      throw new Error(`${repair.routeId} ${phase} route or segment path hash changed unexpectedly`);
    }
    if (row.route_xy_hash !== repair.xyHash || row.segment_xy_hash !== repair.xyHash) {
      throw new Error(`${repair.routeId} ${phase} XY hash does not match review`);
    }
    if (row.route_other_points_hash !== repair.otherPointsHash ||
        row.segment_other_points_hash !== repair.otherPointsHash) {
      throw new Error(`${repair.routeId} ${phase} changed a non-summit point`);
    }
    if (row.route_other_fields_hash !== repair.routeOtherFieldsHash ||
        row.segment_other_fields_hash !== repair.segmentOtherFieldsHash) {
      throw new Error(`${repair.routeId} ${phase} changed a field outside the reviewed set`);
    }
    if (number(row.route_point_count) !== repair.pointCount ||
        number(row.segment_point_count) !== repair.pointCount) {
      throw new Error(`${repair.routeId} ${phase} point count changed`);
    }
    const expectedOldMatches = phase === "before" ? 1 : 0;
    const expectedNewMatches = phase === "before" ? 0 : 1;
    if (number(row.route_old_matches) !== expectedOldMatches ||
        number(row.segment_old_matches) !== expectedOldMatches ||
        number(row.route_new_matches) !== expectedNewMatches ||
        number(row.segment_new_matches) !== expectedNewMatches) {
      throw new Error(`${repair.routeId} ${phase} does not have exactly one reviewed summit vertex`);
    }
    if (row.segment_consumer_route_ids.length !== 1 ||
        row.segment_consumer_route_ids[0] !== repair.routeId) {
      throw new Error(`${repair.segmentId} has an unreviewed route consumer`);
    }
    if (row.route_profile_canonical !== true) {
      throw new Error(`${repair.routeId} ${phase} elevation profile is not canonical`);
    }
    if (phase === "after") {
      for (const [actual, expected, label] of [
        [number(row.route_gain), repair.expectedNewGainM, "route gain"],
        [number(row.route_loss), repair.expectedNewLossM, "route loss"],
        [number(row.segment_gain), repair.expectedNewGainM, "segment gain"],
        [number(row.segment_loss), repair.expectedNewLossM, "segment loss"],
        [number(row.computed_route_gain), repair.expectedNewGainM, "computed route gain"],
        [number(row.computed_route_loss), repair.expectedNewLossM, "computed route loss"],
        [number(row.computed_segment_gain), repair.expectedNewGainM, "computed segment gain"],
        [number(row.computed_segment_loss), repair.expectedNewLossM, "computed segment loss"],
      ] as Array<[number, number, string]>) {
        if (actual !== expected) throw new Error(`${repair.routeId} ${label} does not match review`);
      }
      if (row.route_profile_hash !== repair.expectedNewProfileHash) {
        throw new Error(`${repair.routeId} canonical profile hash does not match review`);
      }
      if (row.route_job_state !== "queued" ||
          row.route_job_fingerprint !== row.current_route_fingerprint ||
          row.route_job_final_evidence !== null ||
          row.route_job_lease_expires_at !== null) {
        throw new Error(`${repair.routeId} route elevation job was not reconciled`);
      }
      const receipt = row.standard_job_evidence?.destination_elevation_fraction_repair;
      if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) ||
          (receipt as JsonObject).auditReportSha256 !== reportSha256 ||
          (receipt as JsonObject).pathHash !== repair.newPathHash) {
        throw new Error(`${repair.routeId} standard route job receipt is missing`);
      }
      if (row.standard_job_state !== repair.expectedStandardJobState ||
          !jsonIsEmpty(row.standard_job_review) ||
          row.standard_job_candidate_sha256 !== null ||
          row.standard_job_candidate_artifact_is_null !== true ||
          row.standard_job_candidate_path_is_null !== true ||
          row.standard_job_has_lease !== false ||
          row.standard_job_lease_expires_at !== null) {
        throw new Error(`${repair.routeId} standard route job state changed during repair`);
      }
    } else {
      if (row.route_job_state !== repair.expectedRouteJobState ||
          row.route_job_fingerprint !== repair.expectedRouteJobFingerprint ||
          row.route_job_fingerprint !== row.current_route_fingerprint ||
          row.route_job_final_evidence !== null ||
          row.route_job_lease_expires_at !== null) {
        throw new Error(`${repair.routeId} route elevation job changed after review`);
      }
      if (row.standard_job_state !== repair.expectedStandardJobState ||
          !jsonIsEmpty(row.standard_job_evidence) ||
          !jsonIsEmpty(row.standard_job_review) ||
          row.standard_job_candidate_sha256 !== null ||
          row.standard_job_candidate_artifact_is_null !== true ||
          row.standard_job_candidate_path_is_null !== true ||
          row.standard_job_has_lease !== false ||
          row.standard_job_lease_expires_at !== null) {
        throw new Error(`${repair.routeId} standard route job changed after review`);
      }
    }
  }
}

async function lockReviewedPathRepairRows(
  client: QueryClient,
  candidateJson: string
): Promise<void> {
  const values = [candidateJson, pathRepairsJson()];
  const routes = await client.query(LOCK_REVIEWED_ROUTES_SQL, values);
  const segments = await client.query(LOCK_REVIEWED_SEGMENTS_SQL, values);
  const routeJobs = await client.query<{ state: string; lease_expires_at: string | null }>(
    LOCK_REVIEWED_ROUTE_JOBS_SQL,
    values
  );
  const standardJobs = await client.query<{ state: string; lease_expires_at: string | null }>(
    LOCK_REVIEWED_STANDARD_JOBS_SQL,
    values
  );
  for (const [label, count] of [
    ["routes", routes.rows.length],
    ["segments", segments.rows.length],
    ["route elevation jobs", routeJobs.rows.length],
    ["standard route jobs", standardJobs.rows.length],
  ] as Array<[string, number]>) {
    if (count !== 2) throw new Error(`locked ${count} reviewed ${label} instead of 2`);
  }
  const now = Date.now();
  if (routeJobs.rows.some((row) => row.state === "working" && row.lease_expires_at &&
      new Date(row.lease_expires_at).getTime() >= now)) {
    throw new Error("a reviewed route elevation job has an active lease");
  }
  if (standardJobs.rows.some((row) => row.lease_expires_at &&
      new Date(row.lease_expires_at).getTime() >= now)) {
    throw new Error("a reviewed standard route job has an active lease");
  }
}

async function lockAffectedCatalogJobs(
  client: QueryClient,
  candidates: ValidatedCandidate[]
): Promise<{
  destinationCount: number;
  destinationSetSha256: string;
  preStateSha256: string;
}> {
  // Validate the dynamic normal-workflow scope before taking any catalog job
  // lock. The lock and every later write use only the pinned 115-ID manifest.
  const liveScope = await queryCatalogScope(client, candidates, true);
  const reviewedIds = JSON.stringify(REVIEWED_CATALOG_DESTINATION_IDS);
  const locked = await client.query<CatalogScopeRow>(
    LOCK_AFFECTED_CATALOG_JOBS_SQL,
    [reviewedIds]
  );
  validateCatalogScopeRows(locked.rows, true);
  const active = locked.rows.filter((row) =>
    row.state === "auditing" && row.lease_expires_at != null &&
    new Date(row.lease_expires_at).getTime() >= Date.now()
  );
  if (active.length > 0) {
    throw new Error(`${active.length} affected catalog audit leases are active`);
  }
  await client.query(RECOVER_EXPIRED_AFFECTED_CATALOG_JOBS_SQL, [reviewedIds]);
  return liveScope;
}

async function seedAffectedCatalogJobs(
  client: QueryClient,
  expectedCount: number
): Promise<number> {
  const ids = JSON.stringify(REVIEWED_CATALOG_DESTINATION_IDS);
  const result = await client.query<{ destination_id: string; state: string }>(
    TARGETED_CATALOG_SEED_SQL,
    [ids]
  );
  if (result.rows.length !== expectedCount || result.rowCount !== expectedCount) {
    throw new Error(
      `targeted catalog seed returned ${result.rowCount ?? result.rows.length} rows instead of ${expectedCount}`
    );
  }
  if (result.rows.some((row) => row.state !== "queued")) {
    throw new Error("one or more affected catalog jobs did not enter the queue");
  }
  return result.rows.length;
}

async function validateApplySqlPlans(
  client: QueryClient,
  candidates: ValidatedCandidate[],
  candidateJson: string,
  reportSha256: string
): Promise<void> {
  const ids = JSON.stringify(candidates.map((candidate) => candidate.destinationId));
  const reviewedCatalogIds = JSON.stringify(REVIEWED_CATALOG_DESTINATION_IDS);
  await client.query(`EXPLAIN (FORMAT JSON, COSTS OFF) ${LIVE_ROWS_FOR_UPDATE_SQL}`, [candidateJson]);
  await client.query(`EXPLAIN (FORMAT JSON, COSTS OFF) ${CATALOG_SCOPE_SQL}`, [ids]);
  await client.query(`EXPLAIN (FORMAT JSON, COSTS OFF) ${LOCK_AFFECTED_CATALOG_JOBS_SQL}`, [reviewedCatalogIds]);
  await client.query(`EXPLAIN (FORMAT JSON, COSTS OFF) ${RECOVER_EXPIRED_AFFECTED_CATALOG_JOBS_SQL}`, [reviewedCatalogIds]);
  await client.query(`EXPLAIN (FORMAT JSON, COSTS OFF) ${UPDATE_SQL}`, [candidateJson, reportSha256]);
  await client.query(`EXPLAIN (FORMAT JSON, COSTS OFF) ${POST_UPDATE_SQL}`, [candidateJson, reportSha256]);
  await client.query(`EXPLAIN (FORMAT JSON, COSTS OFF) ${TARGETED_CATALOG_SEED_SQL}`, [reviewedCatalogIds]);
  await client.query(`EXPLAIN (FORMAT JSON, COSTS OFF) ${SESSION_TRACKING_INVARIANT_SQL}`, [ids]);
  const repairValues = [candidateJson, pathRepairsJson()];
  await client.query(`EXPLAIN (FORMAT JSON, COSTS OFF) ${LOCK_REVIEWED_ROUTES_SQL}`, repairValues);
  await client.query(`EXPLAIN (FORMAT JSON, COSTS OFF) ${LOCK_REVIEWED_SEGMENTS_SQL}`, repairValues);
  await client.query(`EXPLAIN (FORMAT JSON, COSTS OFF) ${LOCK_REVIEWED_ROUTE_JOBS_SQL}`, repairValues);
  await client.query(`EXPLAIN (FORMAT JSON, COSTS OFF) ${LOCK_REVIEWED_STANDARD_JOBS_SQL}`, repairValues);
  await client.query(`EXPLAIN (FORMAT JSON, COSTS OFF) ${UPDATE_REVIEWED_SEGMENT_VERTICES_SQL}`, repairValues);
  await client.query(`EXPLAIN (FORMAT JSON, COSTS OFF) ${UPDATE_REVIEWED_ROUTE_VERTICES_SQL}`, repairValues);
  await client.query(`EXPLAIN (FORMAT JSON, COSTS OFF) ${RECONCILE_ROUTE_ELEVATION_JOBS_SQL}`, repairValues);
  await client.query(
    `EXPLAIN (FORMAT JSON, COSTS OFF) ${RECONCILE_STANDARD_ROUTE_JOBS_SQL}`,
    [candidateJson, pathRepairsJson(), reportSha256]
  );
}

async function applyReviewedPathRepairs(
  client: QueryClient,
  candidateJson: string,
  reportSha256: string
): Promise<JsonObject> {
  const values = [candidateJson, pathRepairsJson()];
  const segments = await client.query<{ id: string; path_hash: string }>(
    UPDATE_REVIEWED_SEGMENT_VERTICES_SQL,
    values
  );
  if (segments.rows.length !== 2 || segments.rowCount !== 2) {
    throw new Error(`guarded segment vertex update changed ${segments.rowCount ?? segments.rows.length} rows instead of 2`);
  }
  const routes = await client.query<{ id: string; path_hash: string; profile_hash: string }>(
    UPDATE_REVIEWED_ROUTE_VERTICES_SQL,
    values
  );
  if (routes.rows.length !== 2 || routes.rowCount !== 2) {
    throw new Error(`guarded route vertex update changed ${routes.rowCount ?? routes.rows.length} rows instead of 2`);
  }
  const routeJobs = await client.query(RECONCILE_ROUTE_ELEVATION_JOBS_SQL, values);
  if (routeJobs.rows.length !== 2 || routeJobs.rowCount !== 2) {
    throw new Error(`reconciled ${routeJobs.rowCount ?? routeJobs.rows.length} route elevation jobs instead of 2`);
  }
  const standardJobs = await client.query(
    RECONCILE_STANDARD_ROUTE_JOBS_SQL,
    [candidateJson, pathRepairsJson(), reportSha256]
  );
  if (standardJobs.rows.length !== 2 || standardJobs.rowCount !== 2) {
    throw new Error(`reconciled ${standardJobs.rowCount ?? standardJobs.rows.length} standard route jobs instead of 2`);
  }
  const after = await queryPathRepairAudit(client, candidateJson);
  validatePathRepairAudit(after, "after", reportSha256);
  return {
    routesUpdated: routes.rows.length,
    segmentsUpdated: segments.rows.length,
    routeElevationJobsReconciled: routeJobs.rows.length,
    standardRouteJobsReceipted: standardJobs.rows.length,
    postflight: after.map((row) => ({
      destinationId: row.destination_id,
      routeId: row.route_id,
      segmentId: row.segment_id,
      routePathHash: row.route_path_hash,
      segmentPathHash: row.segment_path_hash,
      routeXYHash: row.route_xy_hash,
      segmentXYHash: row.segment_xy_hash,
      routeOtherPointsHash: row.route_other_points_hash,
      segmentOtherPointsHash: row.segment_other_points_hash,
      routeOtherFieldsHash: row.route_other_fields_hash,
      segmentOtherFieldsHash: row.segment_other_fields_hash,
      routeProfileHash: row.route_profile_hash,
      routeFingerprint: row.current_route_fingerprint,
    })),
  };
}

function validateLiveRows(rows: LiveDestinationRow[], candidates: ValidatedCandidate[]): void {
  const candidateById = new Map(candidates.map((candidate) => [candidate.destinationId, candidate]));
  if (rows.length !== candidates.length) {
    throw new Error(`live destination count ${rows.length} does not match ${candidates.length}`);
  }
  for (const row of rows) {
    const candidate = candidateById.get(row.id);
    if (!candidate) throw new Error(`unexpected live destination ${row.id}`);
    if (row.owner !== "peaks") throw new Error(`${row.id} is no longer Peaks-owned`);
    const elevation = number(row.elevation);
    const locationZ = row.location_z == null ? null : number(row.location_z);
    const lat = row.lat == null ? null : number(row.lat);
    const lng = row.lng == null ? null : number(row.lng);
    if (!Number.isFinite(elevation) || !Number.isInteger(elevation) || elevation !== candidate.expectedElevationM) {
      throw new Error(`${row.id} no longer has the reviewed integer elevation`);
    }
    if (locationZ !== elevation) throw new Error(`${row.id} scalar elevation and PointZ no longer agree`);
    if (lat !== candidate.lat || lng !== candidate.lng) {
      throw new Error(`${row.id} XY coordinates changed after the identity audit`);
    }
    if (row.external_ids?.[candidate.externalKey] !== candidate.externalId) {
      throw new Error(`${row.id} exact external ID changed after the identity audit`);
    }
    if (row.updated_at_millisecond !== candidate.expectedUpdatedAt) {
      throw new Error(`${row.id} changed after the reviewed audit snapshot`);
    }
    if (row.has_repair_metadata) throw new Error(`${row.id} already has fraction-repair metadata`);
  }
}

async function validateOsmUniqueness(
  client: QueryClient,
  candidateJson: string,
  candidates: ValidatedCandidate[]
): Promise<void> {
  const result = await client.query<{
    destination_id: string;
    matching_destination_ids: string[];
  }>(OSM_ID_UNIQUENESS_SQL, [candidateJson]);
  if (result.rows.length !== candidates.length) {
    throw new Error("one or more reviewed exact OSM IDs no longer resolve to a destination");
  }
  for (const row of result.rows) {
    if (row.matching_destination_ids.length !== 1 || row.matching_destination_ids[0] !== row.destination_id) {
      throw new Error(
        `${row.destination_id} exact OSM ID is missing, duplicated, or assigned to another destination`
      );
    }
  }
}

async function loadAndValidateLiveRows(
  client: QueryClient,
  candidates: ValidatedCandidate[],
  forUpdate: boolean
): Promise<string> {
  const candidateJson = candidatesJson(candidates);
  const result = await client.query<LiveDestinationRow>(
    forUpdate ? LIVE_ROWS_FOR_UPDATE_SQL : LIVE_ROWS_SQL,
    [candidateJson]
  );
  validateLiveRows(result.rows, candidates);
  await validateOsmUniqueness(client, candidateJson, candidates);
  return candidateJson;
}

export async function runPreflight(
  pool: QueryPool,
  candidates: ValidatedCandidate[],
  reportSha256: string
): Promise<JsonObject> {
  validateReviewedPathRepairs(candidates);
  validateReviewedCatalogManifest();
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      await client.query("SET LOCAL extra_float_digits = 1");
      const candidateJson = await loadAndValidateLiveRows(client, candidates, false);
      const destinationUpdateTrigger = await inspectDestinationUpdateTrigger(client);
      const catalogScope = await queryCatalogScope(client, candidates, true);
      const sessionTracking = await querySessionTrackingInvariant(client, candidates);
      const impact = await queryImpact(client, candidates);
      if (impact.catalogDestinations !== REVIEWED_CATALOG_DESTINATION_COUNT) {
        throw new Error("fingerprint impact does not match the reviewed 115 catalog destinations");
      }
      const routeVertices = await queryRouteVertexImpact(client, candidateJson);
      validateReviewedRouteVertexScope(routeVertices);
      const pathRepairRows = await queryPathRepairAudit(client, candidateJson);
      validatePathRepairAudit(pathRepairRows, "before", reportSha256);
      const reviewedImpact = withReviewedPathFingerprintImpact(impact, pathRepairRows.length);
      await validateApplySqlPlans(client, candidates, candidateJson, reportSha256);
      await client.query("COMMIT");
      return {
        mode: "dry_run",
        reportSha256,
        candidateCount: candidates.length,
        totalPositiveDeltaM: candidates.reduce((sum, candidate) => sum + candidate.deltaM, 0),
        minimumDeltaM: Math.min(...candidates.map((candidate) => candidate.deltaM)),
        maximumDeltaM: Math.max(...candidates.map((candidate) => candidate.deltaM)),
        fingerprintImpact: reviewedImpact,
        catalogScope,
        destinationUpdateTrigger,
        sessionTrackingInvariant: sessionTracking,
        routeVertexImpact: routeVertices,
        pathRepairPlan: {
          routeUpdates: pathRepairRows.length,
          segmentUpdates: pathRepairRows.length,
          routeElevationJobsReconciled: pathRepairRows.length,
          standardRouteJobStatesChanged: 0,
          standardRouteJobReceiptsAdded: pathRepairRows.length,
          repairs: pathRepairRows.map((row) => ({
            destinationId: row.destination_id,
            routeId: row.route_id,
            segmentId: row.segment_id,
            oldPathHash: row.route_path_hash,
            expectedNewPathHash: REVIEWED_PATH_REPAIRS.find(
              (repair) => repair.destinationId === row.destination_id
            )?.newPathHash,
            xyHash: row.route_xy_hash,
            otherPointsHash: row.route_other_points_hash,
            routeJobState: row.route_job_state,
            standardJobState: row.standard_job_state,
          })),
        },
        applySqlPlansValidated: true,
        applyBlockedByActiveCatalogLease: impact.activeCatalogLeases > 0,
        applyBlockedByUnsafeDestinationUpdateTrigger: !destinationUpdateTrigger.safe,
        productionWrites: 0,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

interface TargetDependencies {
  realpath?: (socketPath: string) => Promise<string>;
}

export async function verifyApplyTarget(
  pool: Pool,
  expected: ApplyTarget,
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: TargetDependencies = {}
): Promise<void> {
  const configuredHost = environment.DB_HOST;
  if (!configuredHost || !path.isAbsolute(configuredHost) || !path.isAbsolute(expected.host)) {
    throw new Error("DB_HOST and --expected-host must be absolute instance-bound Unix socket paths");
  }
  if (pool.options.host !== configuredHost) {
    throw new Error("Pool host does not match DB_HOST");
  }
  const resolveRealpath = dependencies.realpath ?? fs.realpath;
  const [configuredRealpath, expectedRealpath] = await Promise.all([
    resolveRealpath(configuredHost),
    resolveRealpath(expected.host),
  ]);
  if (configuredRealpath !== expectedRealpath || path.basename(configuredRealpath) !== expected.instance) {
    throw new Error("Unix socket does not match the expected Cloud SQL instance");
  }
  const result = await pool.query<{ current_database: string }>("SELECT current_database()");
  if (result.rows[0]?.current_database !== expected.database) {
    throw new Error("connected database does not match --expected-database");
  }
}

export async function applyReviewedFractions(
  pool: Pool,
  candidates: ValidatedCandidate[],
  reportSha256: string
): Promise<JsonObject> {
  if (reportSha256 !== REVIEWED_REPORT_SHA256 || candidates.length !== REVIEWED_CANDIDATE_COUNT) {
    throw new Error("apply requires the exact reviewed report and all 117 candidates");
  }
  validateReviewedPathRepairs(candidates);
  validateReviewedCatalogManifest();
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    try {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '60s'");
      await client.query("SET LOCAL extra_float_digits = 1");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ADVISORY_LOCK_NAME]);
      const destinationUpdateTrigger = await inspectDestinationUpdateTrigger(client);
      assertDestinationUpdateTriggerGuard(destinationUpdateTrigger);
      const candidateJson = await loadAndValidateLiveRows(client, candidates, true);
      const beforeSessionTracking = await querySessionTrackingInvariant(client, candidates);
      await lockReviewedPathRepairRows(client, candidateJson);
      const beforePathRepair = await queryPathRepairAudit(client, candidateJson);
      validatePathRepairAudit(beforePathRepair, "before", reportSha256);
      const catalogScope = await lockAffectedCatalogJobs(client, candidates);
      const impact = await queryImpact(client, candidates);
      if (impact.catalogDestinations !== REVIEWED_CATALOG_DESTINATION_COUNT) {
        throw new Error("fingerprint impact does not match the reviewed 115 catalog destinations");
      }
      if (impact.activeCatalogLeases !== 0) {
        throw new Error(
          `${impact.activeCatalogLeases} affected catalog audit leases are active; retry after they finish`
        );
      }
      const routeVertices = await queryRouteVertexImpact(client, candidateJson);
      validateReviewedRouteVertexScope(routeVertices);
      const updated = await client.query<{
        id: string;
        elevation: number | string;
        location_z: number | string;
        lat: number | string;
        lng: number | string;
        repair_metadata: JsonObject;
      }>(UPDATE_SQL, [candidateJson, reportSha256]);
      if (updated.rows.length !== REVIEWED_CANDIDATE_COUNT || updated.rowCount !== REVIEWED_CANDIDATE_COUNT) {
        throw new Error(
          `guarded update changed ${updated.rowCount ?? updated.rows.length} rows instead of 117`
        );
      }
      const postUpdate = await client.query(POST_UPDATE_SQL, [candidateJson, reportSha256]);
      if (postUpdate.rows.length !== REVIEWED_CANDIDATE_COUNT || postUpdate.rowCount !== REVIEWED_CANDIDATE_COUNT) {
        throw new Error("post-update scalar, PointZ, XY, or provenance verification failed");
      }
      const pathRepair = await applyReviewedPathRepairs(
        client,
        candidateJson,
        reportSha256
      );
      const postChangeImpact = await queryImpact(client, candidates);
      const postChangeCatalogScope = await queryCatalogScope(client, candidates, false);
      if (postChangeImpact.catalogDestinations !== impact.catalogDestinations ||
          postChangeImpact.catalogRoutes !== impact.catalogRoutes ||
          postChangeCatalogScope.destinationSetSha256 !== catalogScope.destinationSetSha256 ||
          postChangeImpact.activeCatalogLeases !== 0) {
        throw new Error("catalog scope changed unexpectedly after the guarded vertex repair");
      }
      const reviewedImpact = withReviewedPathFingerprintImpact(
        impact,
        beforePathRepair.length
      );
      const reviewedPostChangeImpact = withReviewedPathFingerprintImpact(
        postChangeImpact,
        beforePathRepair.length
      );
      const catalogJobsQueued = await seedAffectedCatalogJobs(
        client,
        REVIEWED_CATALOG_DESTINATION_COUNT
      );
      const finalCatalogScope = await queryCatalogScope(client, candidates, false);
      if (finalCatalogScope.destinationSetSha256 !== REVIEWED_CATALOG_DESTINATION_SET_SHA256) {
        throw new Error("catalog scope changed during the exact targeted seed");
      }
      const afterSessionTracking = await querySessionTrackingInvariant(client, candidates);
      assertSessionTrackingInvariantUnchanged(beforeSessionTracking, afterSessionTracking);
      await client.query("COMMIT");
      return {
        mode: "applied",
        reportSha256,
        updatedDestinations: updated.rows.length,
        fingerprintImpact: reviewedImpact,
        postChangeFingerprintImpact: reviewedPostChangeImpact,
        catalogScope,
        finalCatalogScope,
        destinationUpdateTrigger,
        sessionTrackingInvariant: afterSessionTracking,
        routeVertexImpact: routeVertices,
        pathRepair,
        catalogJobsQueued,
        catalogReseedRequired: impact.catalogReseedRequired,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

function printHuman(result: JsonObject): void {
  console.log("Destination elevation fraction repair");
  console.log(`Mode: ${String(result.mode)}`);
  console.log(`Reviewed report: ${String(result.reportSha256)}`);
  console.log(`Candidates: ${String(result.candidateCount ?? result.updatedDestinations)}`);
  const impact = result.fingerprintImpact as FingerprintImpact | undefined;
  if (impact) {
    console.log(
      `Catalog fingerprints affected/active leases: ${impact.catalogFingerprintChanges}/${impact.activeCatalogLeases}`
    );
    console.log(
      `Route elevation/standard fingerprint changes: ${impact.routeElevationFingerprintChanges}/${impact.standardRouteFingerprintChanges}`
    );
  }
  const routeVertices = result.routeVertexImpact as RouteVertexImpact | undefined;
  if (routeVertices) {
    console.log(
      `Pinned old summit vertices (routes/segments): ` +
      `${routeVertices.routesWithPinnedOldSummitVertex}/` +
      `${routeVertices.routeSegmentsWithPinnedOldSummitVertex}`
    );
  }
  if (result.productionWrites === 0) console.log("Production writes: 0");
}

async function main(): Promise<void> {
  const args = parseApplyArgs();
  try {
    const expected = resolveReviewedExpectation(args);
    const reviewed = await readReviewedReport(args.reportPath, expected);
    const result = args.apply
      ? await (async () => {
        const target = resolveApplyTarget(args);
        await verifyApplyTarget(db, target);
        return applyReviewedFractions(db, reviewed.candidates, reviewed.sha256);
      })()
      : await runPreflight(db, reviewed.candidates, reviewed.sha256);
    if (args.format === "json") console.log(JSON.stringify(result, null, 2));
    else printHuman(result);
  } finally {
    await db.end();
  }
}

if (/(?:^|[/\\])apply-destination-elevation-fractions\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
