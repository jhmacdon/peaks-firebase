import {
  listOfficialTrailSources,
  type OfficialTrailSource,
} from "./official-trail-sources";

export type ValidatedRouteIdentitySource = {
  type: string;
  url: string;
};

const fixedPublisherHosts = new Map<string, readonly string[]>([
  ["alltrails", ["alltrails.com"]],
  ["peakbagger", ["peakbagger.com"]],
  ["mountaineers", ["mountaineers.org"]],
  ["summitpost", ["summitpost.org"]],
  ["wta", ["wta.org"]],
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
  const hostname = normalizedHostname(parsedUrl.toString());
  const fixedHosts = fixedPublisherHosts.get(type);
  if (fixedHosts) {
    if (!fixedHosts.some((allowed) => hostMatches(hostname, allowed))) {
      throw new Error(
        `candidate identity source type ${type} has the wrong publisher host`
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
  identitySources: readonly ValidatedRouteIdentitySource[]
): string {
  const sourceUrl = publicHttpsUrl(
    value,
    "candidate access.source_url"
  ).toString();
  if (
    !identitySources.some(
      (source) => isStrongRouteIdentitySource(source.type) && source.url === sourceUrl
    )
  ) {
    throw new Error(
      "candidate access.source_url must exactly match a strong identity source"
    );
  }
  return sourceUrl;
}
