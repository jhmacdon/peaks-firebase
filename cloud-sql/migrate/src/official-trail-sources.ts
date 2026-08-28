import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  ArcgisTrailService,
  OfficialNetworkPath,
} from "./official-route-geometry";

export type OfficialTrailSourceStatus =
  | "ready_publishable"
  | "validation_only"
  | "manual_gap";

export type OfficialTrailSourceKind =
  | "managed_trails"
  | "official_routes"
  | "official_topography"
  | "official_aggregator"
  | "existing_adapter"
  | "manual_reference";

export type OfficialTrailEndpointType =
  | "arcgis"
  | "wfs"
  | "ogc_api_features"
  | "bulk"
  | "api"
  | "catalog"
  | "web";

export type OfficialTrailSourceCoverage = {
  countries: readonly string[];
  jurisdiction: string;
  summary: string;
};

export type OfficialTrailSourceLicense = {
  name: string;
  url: string | null;
  attribution: string;
  commercialUse: "allowed" | "restricted" | "unclear";
  derivativeUse: "allowed" | "restricted" | "unclear";
};

export type OfficialTrailSourceEndpoint = {
  type: OfficialTrailEndpointType;
  url: string;
  format: string;
  purpose: string;
};

export type OfficialArcgisTrailService = ArcgisTrailService & {
  type: "arcgis";
};

export type OfficialTrailAccessRuleOperator =
  | "equals_any"
  | "contains_any"
  | "not_equals_any"
  | "not_contains_any";

export type OfficialTrailAccessRule = {
  field: string;
  operator: OfficialTrailAccessRuleOperator;
  values: readonly string[];
  reason: string;
};

export type OfficialTrailAccessPolicy = {
  type: "all_rules";
  rules: readonly OfficialTrailAccessRule[];
};

export type OfficialTrailAccessReview = {
  passed: boolean;
  checkedFeatureIds: readonly string[];
  errors: readonly string[];
};

export type OfficialTrailSource = {
  id: string;
  name: string;
  authority: string;
  sourceKind: OfficialTrailSourceKind;
  status: OfficialTrailSourceStatus;
  reviewedAt: string;
  coverage: OfficialTrailSourceCoverage;
  discoveryUrl: string;
  service?: OfficialArcgisTrailService;
  accessPolicy?: OfficialTrailAccessPolicy;
  endpoints: readonly OfficialTrailSourceEndpoint[];
  existingAdapter?: string;
  license: OfficialTrailSourceLicense;
  limits: readonly string[];
};

export type PublishableArcgisTrailSource = OfficialTrailSource & {
  status: "ready_publishable";
  service: OfficialArcgisTrailService;
  accessPolicy: OfficialTrailAccessPolicy;
};

export type OfficialTrailSourceRegistry = {
  schemaVersion: 1;
  reviewedAt: string;
  sources: readonly OfficialTrailSource[];
};

const REVIEWED_AT = "2026-08-27";
const READY_ARCGIS_IDS = new Set(["usfs-nfs-trails"]);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string
): void {
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`${label}.${key} is required`);
    }
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label}.${key} is not allowed`);
  }
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() !== value || !value) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string
): T {
  const parsed = textValue(value, label);
  if (!(values as readonly string[]).includes(parsed)) {
    throw new Error(`${label} has an unsupported value`);
  }
  return parsed as T;
}

function urlValue(
  value: unknown,
  label: string,
  options: { httpsOnly?: boolean } = {}
): string {
  const parsed = textValue(value, label);
  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (options.httpsOnly !== false && url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS`);
  }
  if (url.username || url.password) throw new Error(`${label} must not contain credentials`);
  return parsed;
}

function stringArray(
  value: unknown,
  label: string,
  validate: (item: string, label: string) => string = textValue
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  const parsed = value.map((item, index) => validate(item, `${label}[${index}]`));
  if (new Set(parsed).size !== parsed.length) {
    throw new Error(`${label} entries must be unique`);
  }
  return Object.freeze(parsed);
}

function parseCoverage(value: unknown, label: string): OfficialTrailSourceCoverage {
  const input = record(value, label);
  exactKeys(input, ["countries", "jurisdiction", "summary"], [], label);
  const countries = stringArray(input.countries, `${label}.countries`, (item, itemLabel) => {
    const country = textValue(item, itemLabel);
    if (!COUNTRY_PATTERN.test(country)) throw new Error(`${itemLabel} must be ISO 3166-1 alpha-2`);
    return country;
  });
  return Object.freeze({
    countries,
    jurisdiction: textValue(input.jurisdiction, `${label}.jurisdiction`),
    summary: textValue(input.summary, `${label}.summary`),
  });
}

function parseLicense(value: unknown, label: string): OfficialTrailSourceLicense {
  const input = record(value, label);
  exactKeys(
    input,
    ["name", "url", "attribution", "commercialUse", "derivativeUse"],
    [],
    label
  );
  const licenseUrl = input.url === null ? null : urlValue(input.url, `${label}.url`);
  return Object.freeze({
    name: textValue(input.name, `${label}.name`),
    url: licenseUrl,
    attribution: textValue(input.attribution, `${label}.attribution`),
    commercialUse: enumValue(
      input.commercialUse,
      ["allowed", "restricted", "unclear"] as const,
      `${label}.commercialUse`
    ),
    derivativeUse: enumValue(
      input.derivativeUse,
      ["allowed", "restricted", "unclear"] as const,
      `${label}.derivativeUse`
    ),
  });
}

function parseEndpoint(value: unknown, label: string): OfficialTrailSourceEndpoint {
  const input = record(value, label);
  exactKeys(input, ["type", "url", "format", "purpose"], [], label);
  return Object.freeze({
    type: enumValue(
      input.type,
      ["arcgis", "wfs", "ogc_api_features", "bulk", "api", "catalog", "web"] as const,
      `${label}.type`
    ),
    url: urlValue(input.url, `${label}.url`),
    format: textValue(input.format, `${label}.format`),
    purpose: textValue(input.purpose, `${label}.purpose`),
  });
}

function parseService(value: unknown, label: string): OfficialArcgisTrailService {
  const input = record(value, label);
  exactKeys(
    input,
    ["type", "queryUrl", "idField", "nameFields", "accessFields"],
    [],
    label
  );
  if (input.type !== "arcgis") throw new Error(`${label}.type must be arcgis`);
  const queryUrl = urlValue(input.queryUrl, `${label}.queryUrl`);
  const parsedUrl = new URL(queryUrl);
  if (!parsedUrl.pathname.endsWith("/query") || parsedUrl.search || parsedUrl.hash) {
    throw new Error(`${label}.queryUrl must be a bare ArcGIS layer query endpoint`);
  }
  const parseFields = (fields: unknown, fieldLabel: string) =>
    stringArray(fields, fieldLabel, (item, itemLabel) => {
      const field = textValue(item, itemLabel);
      if (!FIELD_PATTERN.test(field)) throw new Error(`${itemLabel} is not a safe field name`);
      return field;
    });
  const idField = textValue(input.idField, `${label}.idField`);
  if (!FIELD_PATTERN.test(idField)) throw new Error(`${label}.idField is not a safe field name`);
  return Object.freeze({
    type: "arcgis" as const,
    queryUrl,
    idField,
    nameFields: parseFields(input.nameFields, `${label}.nameFields`),
    accessFields: parseFields(input.accessFields, `${label}.accessFields`),
  });
}

function parseAccessPolicy(
  value: unknown,
  service: OfficialArcgisTrailService,
  label: string
): OfficialTrailAccessPolicy {
  const input = record(value, label);
  exactKeys(input, ["type", "rules"], [], label);
  if (input.type !== "all_rules") {
    throw new Error(`${label}.type must be all_rules`);
  }
  if (!Array.isArray(input.rules) || input.rules.length === 0) {
    throw new Error(`${label}.rules must be a non-empty array`);
  }
  const rules = input.rules.map((ruleValue, index) => {
    const ruleLabel = `${label}.rules[${index}]`;
    const ruleInput = record(ruleValue, ruleLabel);
    exactKeys(
      ruleInput,
      ["field", "operator", "values", "reason"],
      [],
      ruleLabel
    );
    const field = textValue(ruleInput.field, `${ruleLabel}.field`);
    if (!FIELD_PATTERN.test(field)) {
      throw new Error(`${ruleLabel}.field is not a safe field name`);
    }
    if (!service.accessFields.includes(field)) {
      throw new Error(
        `${ruleLabel}.field must also appear in service.accessFields`
      );
    }
    const operator = enumValue(
      ruleInput.operator,
      [
        "equals_any",
        "contains_any",
        "not_equals_any",
        "not_contains_any",
      ] as const,
      `${ruleLabel}.operator`
    );
    const values = stringArray(ruleInput.values, `${ruleLabel}.values`);
    if (new Set(values.map((item) => item.toLowerCase())).size !== values.length) {
      throw new Error(`${ruleLabel}.values must be unique ignoring case`);
    }
    return Object.freeze({
      field,
      operator,
      values,
      reason: textValue(ruleInput.reason, `${ruleLabel}.reason`),
    });
  });
  const ruleKeys = rules.map((rule) => `${rule.field}\u0000${rule.operator}`);
  if (new Set(ruleKeys).size !== ruleKeys.length) {
    throw new Error(`${label}.rules must not repeat a field and operator`);
  }
  if (
    !rules.some(
      (rule) =>
        rule.operator === "equals_any" || rule.operator === "contains_any"
    )
  ) {
    throw new Error(`${label}.rules must include a positive access rule`);
  }
  return Object.freeze({
    type: "all_rules" as const,
    rules: Object.freeze(rules),
  });
}

function parseSource(value: unknown, index: number): OfficialTrailSource {
  const label = `sources[${index}]`;
  const input = record(value, label);
  exactKeys(
    input,
    [
      "id",
      "name",
      "authority",
      "sourceKind",
      "status",
      "reviewedAt",
      "coverage",
      "discoveryUrl",
      "endpoints",
      "license",
      "limits",
    ],
    ["service", "accessPolicy", "existingAdapter"],
    label
  );
  const id = textValue(input.id, `${label}.id`);
  if (!ID_PATTERN.test(id)) throw new Error(`${label}.id must be a lowercase slug`);
  const status = enumValue(
    input.status,
    ["ready_publishable", "validation_only", "manual_gap"] as const,
    `${label}.status`
  );
  const reviewedAt = textValue(input.reviewedAt, `${label}.reviewedAt`);
  if (reviewedAt !== REVIEWED_AT) throw new Error(`${label}.reviewedAt must be ${REVIEWED_AT}`);
  const license = parseLicense(input.license, `${label}.license`);
  const service = input.service === undefined ? undefined : parseService(input.service, `${label}.service`);
  const accessPolicy =
    input.accessPolicy === undefined || !service
      ? undefined
      : parseAccessPolicy(input.accessPolicy, service, `${label}.accessPolicy`);
  if (input.accessPolicy !== undefined && !service) {
    throw new Error(`${label}.accessPolicy requires a service`);
  }
  if (status === "ready_publishable") {
    if (!READY_ARCGIS_IDS.has(id)) throw new Error(`${label} is not in the publishable source allowlist`);
    if (!service) throw new Error(`${label}.service is required for a publishable source`);
    if (!accessPolicy) {
      throw new Error(`${label}.accessPolicy is required for a publishable source`);
    }
    if (
      license.url === null ||
      license.commercialUse !== "allowed" ||
      license.derivativeUse !== "allowed"
    ) {
      throw new Error(`${label}.license does not allow publication`);
    }
  } else if (service || accessPolicy) {
    throw new Error(`${label}.service and accessPolicy are reserved for publishable sources`);
  }
  const endpointsValue = input.endpoints;
  if (!Array.isArray(endpointsValue)) throw new Error(`${label}.endpoints must be an array`);
  const endpoints = Object.freeze(
    endpointsValue.map((endpoint, endpointIndex) =>
      parseEndpoint(endpoint, `${label}.endpoints[${endpointIndex}]`)
    )
  );
  if (status !== "manual_gap" && endpoints.length === 0) {
    throw new Error(`${label}.endpoints must not be empty`);
  }
  const source: OfficialTrailSource = {
    id,
    name: textValue(input.name, `${label}.name`),
    authority: textValue(input.authority, `${label}.authority`),
    sourceKind: enumValue(
      input.sourceKind,
      [
        "managed_trails",
        "official_routes",
        "official_topography",
        "official_aggregator",
        "existing_adapter",
        "manual_reference",
      ] as const,
      `${label}.sourceKind`
    ),
    status,
    reviewedAt,
    coverage: parseCoverage(input.coverage, `${label}.coverage`),
    discoveryUrl: urlValue(input.discoveryUrl, `${label}.discoveryUrl`),
    endpoints,
    license,
    limits: stringArray(input.limits, `${label}.limits`),
  };
  if (service) source.service = service;
  if (accessPolicy) source.accessPolicy = accessPolicy;
  if (input.existingAdapter !== undefined) {
    source.existingAdapter = textValue(input.existingAdapter, `${label}.existingAdapter`);
  }
  if (source.sourceKind === "existing_adapter" && !source.existingAdapter) {
    throw new Error(`${label}.existingAdapter is required for an existing adapter`);
  }
  if (source.sourceKind !== "existing_adapter" && source.existingAdapter) {
    throw new Error(`${label}.existingAdapter is only valid for an existing adapter`);
  }
  return Object.freeze(source);
}

export function parseOfficialTrailSourceRegistry(value: unknown): OfficialTrailSourceRegistry {
  const input = record(value, "registry");
  exactKeys(input, ["schemaVersion", "reviewedAt", "sources"], [], "registry");
  if (input.schemaVersion !== 1) throw new Error("registry.schemaVersion must be 1");
  const reviewedAt = textValue(input.reviewedAt, "registry.reviewedAt");
  if (reviewedAt !== REVIEWED_AT) throw new Error(`registry.reviewedAt must be ${REVIEWED_AT}`);
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw new Error("registry.sources must be a non-empty array");
  }
  const sources = Object.freeze(input.sources.map(parseSource));
  const ids = sources.map((source) => source.id);
  if (new Set(ids).size !== ids.length) throw new Error("registry source IDs must be unique");
  const readyIds = sources
    .filter((source) => source.status === "ready_publishable")
    .map((source) => source.id)
    .sort();
  const expectedReadyIds = [...READY_ARCGIS_IDS].sort();
  if (JSON.stringify(readyIds) !== JSON.stringify(expectedReadyIds)) {
    throw new Error(`registry must contain exactly these publishable sources: ${expectedReadyIds.join(", ")}`);
  }
  return Object.freeze({ schemaVersion: 1 as const, reviewedAt, sources });
}

function loadRegistry(): OfficialTrailSourceRegistry {
  const path = join(__dirname, "..", "data", "official-trail-sources.json");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read official trail source registry: ${message}`);
  }
  try {
    return parseOfficialTrailSourceRegistry(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Official trail source registry is invalid: ${message}`);
  }
}

const registry = loadRegistry();
const sourceById = new Map(registry.sources.map((source) => [source.id, source]));

function accessPropertyText(
  properties: Record<string, unknown>,
  field: string
): string {
  const direct = Object.prototype.hasOwnProperty.call(properties, field)
    ? properties[field]
    : undefined;
  const value =
    direct !== undefined
      ? direct
      : properties[
          Object.keys(properties).find(
            (key) => key.toLowerCase() === field.toLowerCase()
          ) ?? ""
        ];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "";
}

function safeAccessValue(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function accessRulePasses(
  value: string,
  rule: OfficialTrailAccessRule
): boolean {
  const normalized = value.toLowerCase();
  const expected = rule.values.map((item) => item.toLowerCase());
  if (rule.operator === "equals_any") {
    return normalized.length > 0 && expected.includes(normalized);
  }
  if (rule.operator === "contains_any") {
    return normalized.length > 0 && expected.some((item) => normalized.includes(item));
  }
  if (rule.operator === "not_equals_any") {
    return normalized.length === 0 || !expected.includes(normalized);
  }
  return normalized.length === 0 || !expected.some((item) => normalized.includes(item));
}

export function reviewOfficialTrailAccess(
  source: PublishableArcgisTrailSource,
  paths: readonly OfficialNetworkPath[]
): OfficialTrailAccessReview {
  const featureIds = [...new Set(paths.map((path) => path.featureId))].sort();
  const errors = new Set<string>();
  if (paths.length === 0) {
    errors.add("official access policy received no source features");
  }
  for (const path of paths) {
    for (const rule of source.accessPolicy.rules) {
      const value = accessPropertyText(path.properties, rule.field);
      if (accessRulePasses(value, rule)) continue;
      errors.add(
        `official feature ${path.featureId} fails ${rule.field}: ${rule.reason} ` +
          `(value ${value ? JSON.stringify(safeAccessValue(value)) : "missing"})`
      );
    }
  }
  return Object.freeze({
    passed: errors.size === 0,
    checkedFeatureIds: Object.freeze(featureIds),
    errors: Object.freeze([...errors].sort()),
  });
}

export function listOfficialTrailSources(): readonly OfficialTrailSource[] {
  return registry.sources;
}

export function getOfficialTrailSource(id: string): OfficialTrailSource {
  const source = sourceById.get(id);
  if (!source) throw new Error(`Unknown official trail source: ${id}`);
  return source;
}

export function getPublishableArcgisTrailSource(id: string): PublishableArcgisTrailSource {
  const source = getOfficialTrailSource(id);
  if (
    source.status !== "ready_publishable" ||
    !source.service ||
    !source.accessPolicy
  ) {
    throw new Error(`Official trail source is not approved for publication: ${id}`);
  }
  return source as PublishableArcgisTrailSource;
}

export function publishableArcgisTrailSourcesForCountry(
  country: string
): readonly PublishableArcgisTrailSource[] {
  const normalized = country.trim().toUpperCase();
  if (!COUNTRY_PATTERN.test(normalized)) {
    throw new Error("country must be an ISO 3166-1 alpha-2 code");
  }
  return registry.sources.filter(
    (source): source is PublishableArcgisTrailSource =>
      source.status === "ready_publishable" &&
      source.service !== undefined &&
      source.accessPolicy !== undefined &&
      source.coverage.countries.includes(normalized)
  );
}

export default {
  getOfficialTrailSource,
  getPublishableArcgisTrailSource,
  listOfficialTrailSources,
  parseOfficialTrailSourceRegistry,
  publishableArcgisTrailSourcesForCountry,
  reviewOfficialTrailAccess,
};
