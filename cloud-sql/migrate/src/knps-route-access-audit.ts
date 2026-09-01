import { readFileSync } from "node:fs";
import { join } from "node:path";

export type KnpsRouteAuditClassification =
  | "proven_open"
  | "partial_geometry_check"
  | "archive_geometry_unresolved"
  | "conditional_reservation_only"
  | "hard_block";

export type KnpsCourseIdentity =
  | "proven"
  | "absent"
  | "special_only"
  | "external_without_numeric_id";

export type KnpsRouteAccessAssessment =
  | "open"
  | "geometry_check_required"
  | "conditional"
  | "blocked";

export type KnpsClosedSection = {
  section: string;
  from: string | null;
  through: string | null;
  note: string;
};

export type KnpsAccessReference = {
  id: string;
  parkIds: readonly string[];
  office: string;
  state: "OPEN" | "PARTIAL" | "FULL";
  retrievedAt: string;
  effectiveAt: string | null;
  reportedAt: string | null;
  effectiveLocal: string;
  reason: string;
  closedSections: readonly KnpsClosedSection[];
  uncertainties: readonly string[];
  url: string;
};

export type KnpsRouteAuditRow = {
  ordinal: number;
  sourceMemberId: string;
  destinationId: string;
  name: string;
  summit: string;
  parkId: string | null;
  officialCourseSourceUrl: string;
  courseIds: readonly string[];
  nonSummitCourseIds: readonly string[];
  accessRefs: readonly string[];
  classification: KnpsRouteAuditClassification;
  courseIdentity: KnpsCourseIdentity;
  routeAccess: KnpsRouteAccessAssessment;
  uncertainties: readonly string[];
  supportingUrls: readonly string[];
  note: string;
};

export type KnpsExcludedRow = {
  ordinal: number;
  sourceMemberId: string;
  destinationId: string;
  name: string;
  summitLat: number;
  summitLng: number;
  reason: string;
  sourceUrls: readonly string[];
};

export type KnpsRouteAccessAudit = {
  schemaVersion: 1;
  auditId: string;
  sourceRegistryId: "kfs-100-famous-mountains";
  retrievedAt: string;
  retrievedAtLocal: string;
  validThrough: string;
  timeZone: "Asia/Seoul";
  use: "route_audit_only";
  summary: {
    applicableRowCount: number;
    provenOpenCount: number;
    partialGeometryCheckCount: number;
    archiveGeometryUnresolvedCount: number;
    conditionalReservationOnlyCount: number;
    hardBlockCount: number;
    blockOrSpecialCount: number;
    excludedRowCount: number;
  };
  accessRefs: readonly KnpsAccessReference[];
  rows: readonly KnpsRouteAuditRow[];
  excludedRows: readonly KnpsExcludedRow[];
};

export type KnpsCandidateEvidence = {
  destinationId: string | null;
  identitySources: readonly { type: string; url: string }[];
  accessSourceUrl: string;
  accessStatus: string;
  nowMs?: number;
};

const FIXTURE_NAME =
  "keeper-list-kfs-100-famous-mountains-knps-access-2026-09-01.json";
export const KNPS_ROUTE_ACCESS_AUDIT_PATH = join(
  __dirname,
  "../../../docs/data-audits/fixtures",
  FIXTURE_NAME
);

const CLASSIFICATIONS = new Set<KnpsRouteAuditClassification>([
  "proven_open",
  "partial_geometry_check",
  "archive_geometry_unresolved",
  "conditional_reservation_only",
  "hard_block",
]);
const COURSE_IDENTITIES = new Set<KnpsCourseIdentity>([
  "proven",
  "absent",
  "special_only",
  "external_without_numeric_id",
]);
const ROUTE_ACCESS_VALUES = new Set<KnpsRouteAccessAssessment>([
  "open",
  "geometry_check_required",
  "conditional",
  "blocked",
]);
const ACCESS_STATES = new Set(["OPEN", "PARTIAL", "FULL"] as const);
const DESTINATION_ID = /^[A-Za-z0-9]{20}$/;
const PARK_ID = /^\d{6}$/;
const ACCESS_REF = /^\d{4}$/;
const STANDARD_COURSE_ID = /^(\d{6})V\d{3}$/;
const SPECIAL_COURSE_ID = /^TB\d{3}XXX\d{2}$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} must contain exactly ${expected.join(", ")}`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be non-empty trimmed text`);
  }
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label);
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return Number(value);
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const result = value.map((item, index) => text(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
  return Object.freeze(result);
}

function isoInstant(value: unknown, label: string): string {
  const result = text(value, label);
  if (!result.endsWith("Z") || Number.isNaN(Date.parse(result))) {
    throw new Error(`${label} must be an ISO-8601 UTC instant`);
  }
  return result;
}

function nullableIsoInstant(value: unknown, label: string): string | null {
  return value === null ? null : isoInstant(value, label);
}

function httpsUrl(value: unknown, label: string): string {
  const result = text(value, label);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new Error(`${label} must be an HTTPS URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    (parsed.port && parsed.port !== "443")
  ) {
    throw new Error(`${label} must be a public HTTPS URL without a fragment`);
  }
  return parsed.toString();
}

function parseClosedSection(value: unknown, index: number): KnpsClosedSection {
  const label = `access.closedSections[${index}]`;
  const input = record(value, label);
  exactKeys(input, ["section", "from", "through", "note"], label);
  return Object.freeze({
    section: text(input.section, `${label}.section`),
    from: nullableText(input.from, `${label}.from`),
    through: nullableText(input.through, `${label}.through`),
    note: text(input.note, `${label}.note`),
  });
}

function parseAccessReference(
  value: unknown,
  index: number,
  auditRetrievedAt: string
): KnpsAccessReference {
  const label = `audit.accessRefs[${index}]`;
  const input = record(value, label);
  exactKeys(
    input,
    [
      "id",
      "parkIds",
      "office",
      "state",
      "retrievedAt",
      "effectiveAt",
      "reportedAt",
      "effectiveLocal",
      "reason",
      "closedSections",
      "uncertainties",
      "url",
    ],
    label
  );
  const id = text(input.id, `${label}.id`);
  if (id !== "HALLA" && !ACCESS_REF.test(id)) {
    throw new Error(`${label}.id must be a four-digit rstId or HALLA`);
  }
  const parkIds = stringArray(input.parkIds, `${label}.parkIds`);
  if (parkIds.some((parkId) => !PARK_ID.test(parkId))) {
    throw new Error(`${label}.parkIds must contain six-digit park IDs`);
  }
  const state = text(input.state, `${label}.state`);
  if (!ACCESS_STATES.has(state as "OPEN" | "PARTIAL" | "FULL")) {
    throw new Error(`${label}.state is invalid`);
  }
  const retrievedAt = isoInstant(input.retrievedAt, `${label}.retrievedAt`);
  if (retrievedAt !== auditRetrievedAt) {
    throw new Error(`${label}.retrievedAt must match audit.retrievedAt`);
  }
  if (!Array.isArray(input.closedSections)) {
    throw new Error(`${label}.closedSections must be an array`);
  }
  const closedSections = Object.freeze(
    input.closedSections.map(parseClosedSection)
  );
  const uncertainties = stringArray(input.uncertainties, `${label}.uncertainties`);
  if (state === "OPEN" && closedSections.length > 0) {
    throw new Error(`${label} cannot be OPEN with closed sections`);
  }
  if (state !== "OPEN" && closedSections.length === 0 && uncertainties.length === 0) {
    throw new Error(`${label} must name closed sections or preserve the uncertainty`);
  }
  const url = httpsUrl(input.url, `${label}.url`);
  const parsedUrl = new URL(url);
  if (id === "HALLA") {
    if (parsedUrl.hostname !== "visithalla.jeju.go.kr" || parkIds.length !== 0) {
      throw new Error(`${label} HALLA evidence must use the Jeju land manager`);
    }
  } else if (
    parsedUrl.hostname !== "www.knps.or.kr" ||
    parsedUrl.pathname !== "/front/portal/safe/acsCtrDtl.do" ||
    parsedUrl.searchParams.getAll("rstId").length !== 1 ||
    parsedUrl.searchParams.get("rstId") !== id ||
    parsedUrl.searchParams.get("menuNo") !== "8000340" ||
    [...parsedUrl.searchParams.keys()].sort().join(",") !== "menuNo,rstId"
  ) {
    throw new Error(`${label}.url must be the exact KNPS rstId detail URL`);
  }
  return Object.freeze({
    id,
    parkIds,
    office: text(input.office, `${label}.office`),
    state: state as KnpsAccessReference["state"],
    retrievedAt,
    effectiveAt: nullableIsoInstant(input.effectiveAt, `${label}.effectiveAt`),
    reportedAt: nullableIsoInstant(input.reportedAt, `${label}.reportedAt`),
    effectiveLocal: text(input.effectiveLocal, `${label}.effectiveLocal`),
    reason: text(input.reason, `${label}.reason`),
    closedSections,
    uncertainties,
    url,
  });
}

function parseRow(value: unknown, index: number): KnpsRouteAuditRow {
  const label = `audit.rows[${index}]`;
  const input = record(value, label);
  exactKeys(
    input,
    [
      "ordinal",
      "sourceMemberId",
      "destinationId",
      "name",
      "summit",
      "parkId",
      "officialCourseSourceUrl",
      "courseIds",
      "nonSummitCourseIds",
      "accessRefs",
      "classification",
      "courseIdentity",
      "routeAccess",
      "uncertainties",
      "supportingUrls",
      "note",
    ],
    label
  );
  const ordinal = integer(input.ordinal, `${label}.ordinal`);
  if (ordinal < 1 || ordinal > 100) {
    throw new Error(`${label}.ordinal must be from 1 through 100`);
  }
  const sourceMemberId = text(input.sourceMemberId, `${label}.sourceMemberId`);
  if (!/^kfs:\d{8}$/.test(sourceMemberId)) {
    throw new Error(`${label}.sourceMemberId must be kfs:<eight-digit mntnId>`);
  }
  const destinationId = text(input.destinationId, `${label}.destinationId`);
  if (!DESTINATION_ID.test(destinationId)) {
    throw new Error(`${label}.destinationId is invalid`);
  }
  const parkId = nullableText(input.parkId, `${label}.parkId`);
  if (parkId !== null && !PARK_ID.test(parkId)) {
    throw new Error(`${label}.parkId must be six digits or null`);
  }
  const courseIds = stringArray(input.courseIds, `${label}.courseIds`);
  const nonSummitCourseIds = stringArray(
    input.nonSummitCourseIds,
    `${label}.nonSummitCourseIds`
  );
  for (const [courseIndex, courseId] of courseIds.entries()) {
    const standardMatch = STANDARD_COURSE_ID.exec(courseId);
    if (!standardMatch && !SPECIAL_COURSE_ID.test(courseId)) {
      throw new Error(`${label}.courseIds[${courseIndex}] is invalid`);
    }
    if (standardMatch && standardMatch[1] !== parkId) {
      throw new Error(`${label}.courseIds[${courseIndex}] has the wrong park ID`);
    }
  }
  for (const [courseIndex, courseId] of nonSummitCourseIds.entries()) {
    if (!STANDARD_COURSE_ID.test(courseId) && !SPECIAL_COURSE_ID.test(courseId)) {
      throw new Error(`${label}.nonSummitCourseIds[${courseIndex}] is invalid`);
    }
  }
  const classification = text(input.classification, `${label}.classification`);
  if (!CLASSIFICATIONS.has(classification as KnpsRouteAuditClassification)) {
    throw new Error(`${label}.classification is invalid`);
  }
  const courseIdentity = text(input.courseIdentity, `${label}.courseIdentity`);
  if (!COURSE_IDENTITIES.has(courseIdentity as KnpsCourseIdentity)) {
    throw new Error(`${label}.courseIdentity is invalid`);
  }
  const routeAccess = text(input.routeAccess, `${label}.routeAccess`);
  if (!ROUTE_ACCESS_VALUES.has(routeAccess as KnpsRouteAccessAssessment)) {
    throw new Error(`${label}.routeAccess is invalid`);
  }
  const supportingUrls = stringArray(input.supportingUrls, `${label}.supportingUrls`).map(
    (url, urlIndex) => httpsUrl(url, `${label}.supportingUrls[${urlIndex}]`)
  );
  const parsed: KnpsRouteAuditRow = Object.freeze({
    ordinal,
    sourceMemberId,
    destinationId,
    name: text(input.name, `${label}.name`),
    summit: text(input.summit, `${label}.summit`),
    parkId,
    officialCourseSourceUrl: httpsUrl(
      input.officialCourseSourceUrl,
      `${label}.officialCourseSourceUrl`
    ),
    courseIds,
    nonSummitCourseIds,
    accessRefs: stringArray(input.accessRefs, `${label}.accessRefs`),
    classification: classification as KnpsRouteAuditClassification,
    courseIdentity: courseIdentity as KnpsCourseIdentity,
    routeAccess: routeAccess as KnpsRouteAccessAssessment,
    uncertainties: stringArray(input.uncertainties, `${label}.uncertainties`),
    supportingUrls: Object.freeze(supportingUrls),
    note: text(input.note, `${label}.note`),
  });
  if (parsed.accessRefs.length === 0) {
    throw new Error(`${label}.accessRefs must not be empty`);
  }
  const courseUrl = new URL(parsed.officialCourseSourceUrl);
  if (courseUrl.pathname === "/front/portal/visit/visitCourseSubMain.do") {
    if (
      courseUrl.hostname !== "www.knps.or.kr" ||
      courseUrl.searchParams.get("menuNo") !== "8000275" ||
      courseUrl.searchParams.get("parkId") !== parsed.parkId ||
      courseUrl.searchParams.get("parkNavGb") !== "guide" ||
      [...courseUrl.searchParams.keys()].sort().join(",") !==
        "menuNo,parkId,parkNavGb"
    ) {
      throw new Error(`${label}.officialCourseSourceUrl has the wrong park`);
    }
  } else if (parsed.courseIdentity === "proven") {
    throw new Error(`${label} proven courses require the exact KNPS course page`);
  }
  if (parsed.classification === "proven_open") {
    if (
      parsed.courseIdentity !== "proven" ||
      parsed.routeAccess !== "open" ||
      parsed.courseIds.length === 0
    ) {
      throw new Error(`${label} proven_open rows require a proven open course`);
    }
  } else if (parsed.classification === "partial_geometry_check") {
    if (
      parsed.courseIdentity !== "proven" ||
      parsed.routeAccess !== "geometry_check_required" ||
      parsed.courseIds.length === 0
    ) {
      throw new Error(`${label} partial rows require a proven course and geometry check`);
    }
  } else if (parsed.classification === "archive_geometry_unresolved") {
    if (
      parsed.courseIdentity !== "proven" ||
      parsed.routeAccess !== "open" ||
      !parsed.uncertainties.includes("archive_geometry_binding_unresolved")
    ) {
      throw new Error(`${label} archive-unresolved rows must preserve the missing binding`);
    }
  } else if (parsed.classification === "conditional_reservation_only") {
    if (
      parsed.courseIdentity !== "special_only" ||
      parsed.routeAccess !== "conditional" ||
      parsed.courseIds.length === 0
    ) {
      throw new Error(`${label} conditional rows require a named special course`);
    }
  } else if (parsed.routeAccess !== "blocked") {
    throw new Error(`${label} hard blocks must remain blocked`);
  }
  return parsed;
}

function parseExcludedRow(value: unknown, index: number): KnpsExcludedRow {
  const label = `audit.excludedRows[${index}]`;
  const input = record(value, label);
  exactKeys(
    input,
    [
      "ordinal",
      "sourceMemberId",
      "destinationId",
      "name",
      "summitLat",
      "summitLng",
      "reason",
      "sourceUrls",
    ],
    label
  );
  const destinationId = text(input.destinationId, `${label}.destinationId`);
  if (!DESTINATION_ID.test(destinationId)) {
    throw new Error(`${label}.destinationId is invalid`);
  }
  return Object.freeze({
    ordinal: integer(input.ordinal, `${label}.ordinal`),
    sourceMemberId: text(input.sourceMemberId, `${label}.sourceMemberId`),
    destinationId,
    name: text(input.name, `${label}.name`),
    summitLat: finiteNumber(input.summitLat, `${label}.summitLat`),
    summitLng: finiteNumber(input.summitLng, `${label}.summitLng`),
    reason: text(input.reason, `${label}.reason`),
    sourceUrls: Object.freeze(
      stringArray(input.sourceUrls, `${label}.sourceUrls`).map((url, urlIndex) =>
        httpsUrl(url, `${label}.sourceUrls[${urlIndex}]`)
      )
    ),
  });
}

function parseSummary(value: unknown): KnpsRouteAccessAudit["summary"] {
  const label = "audit.summary";
  const input = record(value, label);
  const keys = [
    "applicableRowCount",
    "provenOpenCount",
    "partialGeometryCheckCount",
    "archiveGeometryUnresolvedCount",
    "conditionalReservationOnlyCount",
    "hardBlockCount",
    "blockOrSpecialCount",
    "excludedRowCount",
  ] as const;
  exactKeys(input, keys, label);
  return Object.freeze(
    Object.fromEntries(
      keys.map((key) => [key, integer(input[key], `${label}.${key}`)])
    )
  ) as KnpsRouteAccessAudit["summary"];
}

export function parseKnpsRouteAccessAudit(value: unknown): KnpsRouteAccessAudit {
  const input = record(value, "audit");
  exactKeys(
    input,
    [
      "schemaVersion",
      "auditId",
      "sourceRegistryId",
      "retrievedAt",
      "retrievedAtLocal",
      "validThrough",
      "timeZone",
      "use",
      "summary",
      "accessRefs",
      "rows",
      "excludedRows",
    ],
    "audit"
  );
  if (input.schemaVersion !== 1) throw new Error("audit.schemaVersion must be 1");
  if (input.sourceRegistryId !== "kfs-100-famous-mountains") {
    throw new Error("audit.sourceRegistryId is invalid");
  }
  if (input.timeZone !== "Asia/Seoul" || input.use !== "route_audit_only") {
    throw new Error("audit must remain a Seoul-time route-only audit");
  }
  const retrievedAt = isoInstant(input.retrievedAt, "audit.retrievedAt");
  const validThrough = isoInstant(input.validThrough, "audit.validThrough");
  if (Date.parse(validThrough) <= Date.parse(retrievedAt)) {
    throw new Error("audit.validThrough must follow audit.retrievedAt");
  }
  if (!Array.isArray(input.accessRefs) || !Array.isArray(input.rows) || !Array.isArray(input.excludedRows)) {
    throw new Error("audit accessRefs, rows, and excludedRows must be arrays");
  }
  const accessRefs = Object.freeze(
    input.accessRefs.map((item, index) =>
      parseAccessReference(item, index, retrievedAt)
    )
  );
  const rows = Object.freeze(input.rows.map(parseRow));
  const excludedRows = Object.freeze(input.excludedRows.map(parseExcludedRow));
  const summary = parseSummary(input.summary);
  const accessById = new Map(accessRefs.map((access) => [access.id, access]));
  const unique = (values: readonly (string | number)[], label: string): void => {
    if (new Set(values).size !== values.length) {
      throw new Error(`${label} must be unique`);
    }
  };
  unique(accessRefs.map((access) => access.id), "audit access reference IDs");
  unique(rows.map((row) => row.ordinal), "audit row ordinals");
  unique(rows.map((row) => row.sourceMemberId), "audit source member IDs");
  unique(rows.map((row) => row.destinationId), "audit destination IDs");
  unique(excludedRows.map((row) => row.ordinal), "audit excluded ordinals");
  unique(excludedRows.map((row) => row.destinationId), "audit excluded destinations");
  for (const row of rows) {
    for (const accessRef of row.accessRefs) {
      const access = accessById.get(accessRef);
      if (!access) throw new Error(`audit row ${row.ordinal} has unknown access ref ${accessRef}`);
      if (row.parkId && !access.parkIds.includes(row.parkId)) {
        throw new Error(`audit row ${row.ordinal} access ref ${accessRef} has the wrong park`);
      }
    }
  }
  const rowDestinations = new Set(rows.map((row) => row.destinationId));
  if (excludedRows.some((row) => rowDestinations.has(row.destinationId))) {
    throw new Error("excluded KNPS rows cannot also appear as applicable rows");
  }
  const counts = new Map<KnpsRouteAuditClassification, number>();
  for (const classification of CLASSIFICATIONS) counts.set(classification, 0);
  for (const row of rows) {
    counts.set(row.classification, (counts.get(row.classification) ?? 0) + 1);
  }
  const expectedCounts = {
    applicableRowCount: rows.length,
    provenOpenCount: counts.get("proven_open") ?? 0,
    partialGeometryCheckCount: counts.get("partial_geometry_check") ?? 0,
    archiveGeometryUnresolvedCount: counts.get("archive_geometry_unresolved") ?? 0,
    conditionalReservationOnlyCount:
      counts.get("conditional_reservation_only") ?? 0,
    hardBlockCount: counts.get("hard_block") ?? 0,
    blockOrSpecialCount:
      (counts.get("conditional_reservation_only") ?? 0) +
      (counts.get("hard_block") ?? 0),
    excludedRowCount: excludedRows.length,
  };
  if (JSON.stringify(summary) !== JSON.stringify(expectedCounts)) {
    throw new Error("audit.summary does not match the audited rows");
  }
  return Object.freeze({
    schemaVersion: 1,
    auditId: text(input.auditId, "audit.auditId"),
    sourceRegistryId: "kfs-100-famous-mountains",
    retrievedAt,
    retrievedAtLocal: text(input.retrievedAtLocal, "audit.retrievedAtLocal"),
    validThrough,
    timeZone: "Asia/Seoul",
    use: "route_audit_only",
    summary,
    accessRefs,
    rows,
    excludedRows,
  });
}

function loadAudit(): KnpsRouteAccessAudit {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(KNPS_ROUTE_ACCESS_AUDIT_PATH, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read KNPS route access audit: ${message}`);
  }
  try {
    return parseKnpsRouteAccessAudit(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`KNPS route access audit is invalid: ${message}`);
  }
}

const audit = loadAudit();
const rowsByDestinationId = new Map(
  audit.rows.map((row) => [row.destinationId, row])
);
const excludedByDestinationId = new Map(
  audit.excludedRows.map((row) => [row.destinationId, row])
);
const accessById = new Map(audit.accessRefs.map((access) => [access.id, access]));

export function getKnpsRouteAccessAudit(): KnpsRouteAccessAudit {
  return audit;
}

export function getKnpsRouteAuditRow(
  destinationId: string
): KnpsRouteAuditRow | undefined {
  return rowsByDestinationId.get(destinationId);
}

export function validateKnpsCandidateEvidence(
  evidence: KnpsCandidateEvidence
): KnpsRouteAuditRow {
  if (!evidence.destinationId) {
    throw new Error("KNPS evidence requires the durable destination ID");
  }
  const excluded = excludedByDestinationId.get(evidence.destinationId);
  if (excluded) {
    throw new Error(
      `KNPS evidence is not allowed for excluded KFS row ${excluded.ordinal}`
    );
  }
  const row = rowsByDestinationId.get(evidence.destinationId);
  if (!row) {
    throw new Error("KNPS evidence requires a destination in the reviewed KFS audit");
  }
  if (row.classification !== "proven_open") {
    throw new Error(
      `KNPS evidence for KFS row ${row.ordinal} is fail-closed: ${row.classification}`
    );
  }
  const nowMs = evidence.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs) || nowMs > Date.parse(audit.validThrough)) {
    throw new Error("KNPS current-access audit is stale and must be refreshed");
  }
  if (evidence.accessStatus !== "open") {
    throw new Error("reviewed KNPS open evidence requires access.status open");
  }
  const normalizedIdentityUrls = evidence.identitySources
    .filter((source) => source.type === "knps")
    .map((source) => new URL(source.url).toString());
  if (!normalizedIdentityUrls.includes(row.officialCourseSourceUrl)) {
    throw new Error(
      `KNPS evidence for KFS row ${row.ordinal} requires its exact audited course page`
    );
  }
  const allowedAccessUrls = row.accessRefs.map((accessRef) => {
    const access = accessById.get(accessRef);
    if (!access) throw new Error(`KNPS audit is missing access ref ${accessRef}`);
    return access.url;
  });
  if (!allowedAccessUrls.includes(evidence.accessSourceUrl)) {
    throw new Error(
      `KNPS evidence for KFS row ${row.ordinal} requires an exact audited rstId page`
    );
  }
  return row;
}

export default {
  getKnpsRouteAccessAudit,
  getKnpsRouteAuditRow,
  parseKnpsRouteAccessAudit,
  validateKnpsCandidateEvidence,
};
