import {
  listOfficialTrailSources,
  type OfficialTrailSource,
} from "./official-trail-sources";
import { validateKnpsCandidateEvidence } from "./knps-route-access-audit";

export type ValidatedRouteIdentitySource = {
  type: string;
  url: string;
};

export type RouteAccessValidationContext = {
  destinationId?: string | null;
  accessStatus?: string;
  nowMs?: number;
};

const fixedPublisherHosts = new Map<string, readonly string[]>([
  ["alltrails", ["alltrails.com"]],
  ["peakbagger", ["peakbagger.com"]],
  ["mountaineers", ["mountaineers.org"]],
  ["knps", ["knps.or.kr"]],
  ["summitpost", ["summitpost.org"]],
  ["wta", ["wta.org"]],
]);

const KNPS_COURSE_PATHS = new Set([
  "/front/portal/visit/visitCourseMain.do",
  "/front/portal/visit/visitCourseSubMain.do",
]);
const KNPS_ACCESS_PATH = "/front/portal/safe/acsCtrDtl.do";

const identityOnlyOfficialSources = new Set([
  "south-korea-kfs-hiking-trails-archive",
]);

const officialSourcesByType = new Map(
  listOfficialTrailSources().map((source) => [source.id, source])
);

function publicHttpsUrl(value: unknown, label: string): URL {
  if (typeof value !== "string") {
    throw new Error(`${label} must be an HTTPS URL`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an HTTPS URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  ) {
    throw new Error(`${label} must be a public HTTPS URL`);
  }
  return parsed;
}

function normalizedHostname(value: string): string {
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

function hostMatches(hostname: string, allowedHostname: string): boolean {
  return (
    hostname === allowedHostname || hostname.endsWith(`.${allowedHostname}`)
  );
}

function officialSourceHosts(source: OfficialTrailSource): readonly string[] {
  return [source.discoveryUrl, ...source.endpoints.map((endpoint) => endpoint.url)]
    .map(normalizedHostname)
    .filter((hostname, index, all) => all.indexOf(hostname) === index);
}

function ownershipPathname(url: URL): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    decoded = url.pathname;
  }
  const withoutMatrixParameters = decoded
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.split(";", 1)[0])
    .join("/");
  const collapsed = withoutMatrixParameters.replace(/\/{2,}/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
}

function pathBelongsToReviewedEndpoint(pathname: string, reviewed: string): boolean {
  return (
    pathname === reviewed ||
    pathname.startsWith(`${reviewed}/`) ||
    pathname.startsWith(`${reviewed};`)
  );
}

function knpsPathname(url: URL): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (
    pathname !== url.pathname ||
    pathname.includes("\\") ||
    pathname.includes(";") ||
    pathname.includes("//")
  ) {
    return null;
  }
  return pathname;
}

function knpsParkId(url: URL): string | null {
  const parkIds = url.searchParams.getAll("parkId");
  return parkIds.length === 1 && /^\d{6}$/.test(parkIds[0] ?? "")
    ? parkIds[0] ?? null
    : null;
}

function knpsAccessRef(url: URL): string | null {
  const accessRefs = url.searchParams.getAll("rstId");
  return accessRefs.length === 1 && /^\d{4}$/.test(accessRefs[0] ?? "")
    ? accessRefs[0] ?? null
    : null;
}

function hasExactQueryKeys(url: URL, expected: readonly string[]): boolean {
  return (
    [...url.searchParams.keys()].sort().join(",") === [...expected].sort().join(",")
  );
}

function isKnpsIdentityUrl(url: URL): boolean {
  const pathname = knpsPathname(url);
  return (
    !url.hash &&
    pathname !== null &&
    ((KNPS_COURSE_PATHS.has(pathname) && knpsParkId(url) !== null) ||
      (pathname === KNPS_ACCESS_PATH &&
        knpsAccessRef(url) !== null &&
        url.searchParams.get("menuNo") === "8000340" &&
        hasExactQueryKeys(url, ["menuNo", "rstId"])))
  );
}

function isKnpsAccessUrl(url: URL): boolean {
  return (
    !url.hash &&
    knpsPathname(url) === KNPS_ACCESS_PATH &&
    knpsAccessRef(url) !== null &&
    url.searchParams.get("menuNo") === "8000340" &&
    hasExactQueryKeys(url, ["menuNo", "rstId"])
  );
}

function identityOnlyOfficialSourceForUrl(url: URL): string | null {
  const hostname = normalizedHostname(url.toString());
  const pathname = ownershipPathname(url);
  for (const sourceId of identityOnlyOfficialSources) {
    const source = officialSourcesByType.get(sourceId);
    if (!source) {
      throw new Error(`identity-only official source is not registered: ${sourceId}`);
    }
    for (const reviewedUrl of [
      source.discoveryUrl,
      ...source.endpoints.map(({ url: endpointUrl }) => endpointUrl),
    ]) {
      const reviewed = new URL(reviewedUrl);
      const reviewedPathname = ownershipPathname(reviewed);
      if (
        hostMatches(hostname, normalizedHostname(reviewed.toString())) &&
        pathBelongsToReviewedEndpoint(pathname, reviewedPathname)
      ) {
        return sourceId;
      }
    }
  }
  return null;
}

export function validateRouteIdentitySource(
  value: unknown,
  index: number
): ValidatedRouteIdentitySource {
  const label = `candidate identity_sources[${index}]`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("candidate identity sources must be objects");
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["type", "url"])) {
    throw new Error(`${label} must contain exactly type and url`);
  }
  if (typeof source.type !== "string") {
    throw new Error("candidate identity source types are invalid");
  }
  const type = source.type.trim().toLowerCase();
  const parsedUrl = publicHttpsUrl(source.url, `${label}.url`);
  const identityOnlyOwner = identityOnlyOfficialSourceForUrl(parsedUrl);
  if (identityOnlyOwner && identityOnlyOwner !== type) {
    throw new Error(
      `candidate identity source URL belongs to ${identityOnlyOwner}, not ${type}`
    );
  }
  const hostname = normalizedHostname(parsedUrl.toString());
  const fixedHosts = fixedPublisherHosts.get(type);
  if (fixedHosts) {
    if (!fixedHosts.some((allowed) => hostMatches(hostname, allowed))) {
      throw new Error(
        `candidate identity source type ${type} has the wrong publisher host`
      );
    }
    if (type === "knps" && !isKnpsIdentityUrl(parsedUrl)) {
      throw new Error(
        "candidate identity source type knps requires an exact course URL with one six-digit parkId or control-detail URL with one four-digit rstId"
      );
    }
    return { type, url: parsedUrl.toString() };
  }

  const officialSource = officialSourcesByType.get(type);
  if (!officialSource) {
    throw new Error(`candidate identity source type is not allowed: ${type}`);
  }
  const allowedHosts = officialSourceHosts(officialSource);
  if (!allowedHosts.some((allowed) => hostMatches(hostname, allowed))) {
    throw new Error(
      `candidate identity source ${type} does not use its reviewed official publisher host`
    );
  }
  return { type, url: parsedUrl.toString() };
}

export function isStrongRouteIdentitySource(type: string): boolean {
  return type !== "alltrails" && type !== "peakbagger";
}

export function validateRouteAccessSource(
  value: unknown,
  identitySources: readonly ValidatedRouteIdentitySource[],
  context: RouteAccessValidationContext = {}
): string {
  const parsedSourceUrl = publicHttpsUrl(value, "candidate access.source_url");
  const sourceUrl = parsedSourceUrl.toString();
  if (identityOnlyOfficialSourceForUrl(parsedSourceUrl)) {
    throw new Error(
      "candidate access.source_url is archival identity evidence and cannot prove current access"
    );
  }
  const matchingSource = identitySources.find(
    (source) =>
      isStrongRouteIdentitySource(source.type) &&
      !identityOnlyOfficialSources.has(source.type) &&
      source.url === sourceUrl
  );
  if (!matchingSource) {
    throw new Error(
      "candidate access.source_url must exactly match a strong current-access source"
    );
  }
  if (matchingSource.type === "knps" && !isKnpsAccessUrl(parsedSourceUrl)) {
    throw new Error(
      "candidate KNPS access.source_url must use the exact current control-detail page"
    );
  }
  if (matchingSource.type === "knps") {
    validateKnpsCandidateEvidence({
      destinationId: context.destinationId ?? null,
      identitySources,
      accessSourceUrl: sourceUrl,
      accessStatus: context.accessStatus ?? "",
      nowMs: context.nowMs,
    });
  }
  return sourceUrl;
}
