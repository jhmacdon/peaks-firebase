import {
  getPublishableArcgisTrailSource,
  listOfficialTrailSources,
  type OfficialTrailSource,
} from "./official-trail-sources";
import { parseOfficialFeatureIdsFromSourceUrl } from "./official-route-geometry";
import { parseUsgsTrailsQueryUrl } from "./usgs-trails-source";

export type OfficialSourceAttemptStatus =
  | "selected_reusable_geometry"
  | "no_complete_geometry"
  | "not_applicable"
  | "validation_only"
  | "manual_gap"
  | "unavailable";

export type OfficialSourceAttempt = {
  status: OfficialSourceAttemptStatus;
  checked_at: string;
  note: string;
  source_url?: string;
  attempted_url?: string;
};

export type OfficialSourceAttempts = Record<string, OfficialSourceAttempt>;

export type OfficialSourceAttemptDestination = {
  countryCode: string | null;
};

export type OfficialSourceAttemptGeometry = {
  source_kind: string;
  source_url: string;
};

const CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CHECK_FUTURE_SKEW_MS = 5 * 60 * 1000;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const USGS_REGISTRY_ID = "usgs-national-digital-trails";
const USGS_GEOMETRY_KIND = "usgs-national-map";

function durableCountryCode(countryCode: string | null): string {
  const normalized = countryCode?.trim().toUpperCase() ?? "";
  if (!COUNTRY_PATTERN.test(normalized)) {
    throw new Error(
      "official source attempts require the durable ISO country code"
    );
  }
  return normalized;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} must contain exactly ${wanted.join(", ")}`);
  }
}

function publicHttpsUrl(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a public HTTPS URL`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a public HTTPS URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  ) {
    throw new Error(`${label} must be a public HTTPS URL`);
  }
  return parsed.toString();
}

function normalizedHostname(value: string): string {
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

function sourceHosts(source: OfficialTrailSource): readonly string[] {
  return [source.discoveryUrl, ...source.endpoints.map(({ url }) => url)]
    .map(normalizedHostname)
    .filter((hostname, index, all) => all.indexOf(hostname) === index);
}

function attemptedUrl(value: unknown, source: OfficialTrailSource): string {
  const label = `official_source_attempts.${source.id}.attempted_url`;
  const parsed = publicHttpsUrl(value, label);
  const hostname = normalizedHostname(parsed);
  if (!sourceHosts(source).includes(hostname)) {
    throw new Error(`${label} must use a reviewed source host`);
  }
  return parsed;
}

function selectedSourceUrl(value: unknown, source: OfficialTrailSource): string {
  const label = `official_source_attempts.${source.id}.source_url`;
  const parsed = publicHttpsUrl(value, label);
  const hostname = normalizedHostname(parsed);
  const validHost =
    source.id === USGS_REGISTRY_ID
      ? hostname === "partnerships.nationalmap.gov"
      : sourceHosts(source).includes(hostname);
  if (!validHost) {
    throw new Error(`${label} must use the selected source adapter host`);
  }
  if (source.id === USGS_REGISTRY_ID) {
    parseUsgsTrailsQueryUrl(parsed);
  } else {
    const publishable = getPublishableArcgisTrailSource(source.id);
    parseOfficialFeatureIdsFromSourceUrl(publishable.service, parsed);
  }
  return parsed;
}

function checkedAt(value: unknown, sourceId: string, nowMs: number): string {
  const label = `official_source_attempts.${sourceId}.checked_at`;
  if (typeof value !== "string") {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs) || new Date(parsedMs).toISOString() !== value) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  if (parsedMs > nowMs + CHECK_FUTURE_SKEW_MS) {
    throw new Error(`${label} is in the future`);
  }
  if (parsedMs < nowMs - CHECK_MAX_AGE_MS) {
    throw new Error(`${label} is older than 24 hours`);
  }
  return value;
}

function note(value: unknown, sourceId: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length < 3 ||
    value.trim().length > 500
  ) {
    throw new Error(
      `official_source_attempts.${sourceId}.note must contain 3 to 500 characters`
    );
  }
  return value.trim();
}

function allowedStatuses(
  source: OfficialTrailSource
): ReadonlySet<OfficialSourceAttemptStatus> {
  const common: OfficialSourceAttemptStatus[] = [
    "not_applicable",
    "unavailable",
  ];
  if (source.status === "ready_publishable") {
    return new Set([
      ...common,
      "selected_reusable_geometry",
      "no_complete_geometry",
    ]);
  }
  if (source.status === "manual_gap") {
    return new Set([...common, "manual_gap"]);
  }
  if (
    source.id === USGS_REGISTRY_ID &&
    source.existingAdapter === USGS_REGISTRY_ID
  ) {
    return new Set([
      ...common,
      "selected_reusable_geometry",
      "no_complete_geometry",
      "validation_only",
    ]);
  }
  return new Set([...common, "validation_only"]);
}

function expectedSelectedSourceId(
  geometry: OfficialSourceAttemptGeometry
): string | null {
  if (geometry.source_kind === "openstreetmap") return null;
  if (geometry.source_kind === USGS_GEOMETRY_KIND) return USGS_REGISTRY_ID;
  const publishable = listOfficialTrailSources().some(
    (source) =>
      source.id === geometry.source_kind &&
      source.status === "ready_publishable"
  );
  if (!publishable) {
    throw new Error(
      "candidate geometry must use OSM, the USGS adapter, or a publishable official source"
    );
  }
  return geometry.source_kind;
}

function requiresExhaustedAttempt(
  source: OfficialTrailSource,
  geometry: OfficialSourceAttemptGeometry
): boolean {
  if (geometry.source_kind === "openstreetmap") {
    return (
      source.status === "ready_publishable" ||
      (source.id === USGS_REGISTRY_ID &&
        source.existingAdapter === USGS_REGISTRY_ID)
    );
  }
  return (
    geometry.source_kind === USGS_GEOMETRY_KIND &&
    source.status === "ready_publishable"
  );
}

export function officialTrailSourcesForCountry(
  countryCode: string | null
): readonly OfficialTrailSource[] {
  const normalized = durableCountryCode(countryCode);
  const sources = listOfficialTrailSources().filter((source) =>
    source.coverage.countries.includes(normalized)
  );
  if (sources.length === 0) {
    throw new Error(
      `official source registry has no reviewed coverage for ${normalized}`
    );
  }
  return sources;
}

export function assertOfficialSourceCountryBinding(
  value: unknown,
  destination: OfficialSourceAttemptDestination
): string {
  const durable = durableCountryCode(destination.countryCode);
  if (value !== durable) {
    throw new Error(
      "official_source_country_code must match the durable destination country code"
    );
  }
  officialTrailSourcesForCountry(durable);
  return durable;
}

export function parseOfficialSourceAttempts(
  value: unknown,
  destination: OfficialSourceAttemptDestination,
  geometry: OfficialSourceAttemptGeometry,
  nowMs = Date.now()
): OfficialSourceAttempts {
  const sources = officialTrailSourcesForCountry(destination.countryCode);
  const attempts = objectValue(value, "official_source_attempts");
  exactKeys(
    attempts,
    sources.map(({ id }) => id),
    "official_source_attempts"
  );
  const selectedSourceId = expectedSelectedSourceId(geometry);
  const normalizedGeometryUrl = publicHttpsUrl(
    geometry.source_url,
    "candidate geometry.source_url"
  );
  const output: OfficialSourceAttempts = {};

  for (const source of sources) {
    const label = `official_source_attempts.${source.id}`;
    const raw = objectValue(attempts[source.id], label);
    const status = raw.status;
    if (
      typeof status !== "string" ||
      !allowedStatuses(source).has(status as OfficialSourceAttemptStatus)
    ) {
      throw new Error(
        `${label}.status is incompatible with registry status ${source.status}`
      );
    }
    const checked_at = checkedAt(raw.checked_at, source.id, nowMs);
    const checkedNote = note(raw.note, source.id);
    if (status === "selected_reusable_geometry") {
      exactKeys(raw, ["status", "source_url", "checked_at", "note"], label);
      const source_url = selectedSourceUrl(raw.source_url, source);
      if (source.id !== selectedSourceId || source_url !== normalizedGeometryUrl) {
        throw new Error(
          `${label} selected geometry must match the candidate geometry source`
        );
      }
      output[source.id] = { status, source_url, checked_at, note: checkedNote };
      continue;
    }
    exactKeys(raw, ["status", "attempted_url", "checked_at", "note"], label);
    if (source.id === selectedSourceId) {
      throw new Error(
        `${label} must select the reusable candidate geometry`
      );
    }
    if (
      requiresExhaustedAttempt(source, geometry) &&
      status !== "no_complete_geometry" &&
      status !== "not_applicable" &&
      status !== "unavailable"
    ) {
      throw new Error(
        `${label} must be exhausted before using this geometry fallback`
      );
    }
    output[source.id] = {
      status: status as OfficialSourceAttemptStatus,
      attempted_url: attemptedUrl(raw.attempted_url, source),
      checked_at,
      note: checkedNote,
    };
  }

  const selectedAttempts = Object.values(output).filter(
    ({ status }) => status === "selected_reusable_geometry"
  );
  if ((selectedSourceId === null ? 0 : 1) !== selectedAttempts.length) {
    throw new Error(
      "official_source_attempts selected geometry does not match the candidate"
    );
  }
  return output;
}

export default {
  assertOfficialSourceCountryBinding,
  officialTrailSourcesForCountry,
  parseOfficialSourceAttempts,
};
