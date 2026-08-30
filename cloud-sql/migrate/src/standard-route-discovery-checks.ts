export type RouteDiscoveryService = "alltrails" | "peakbagger";

export type RouteDiscoveryCheck =
  | { status: "matched"; url: string; checked_at: string }
  | {
      status: "no_match" | "unavailable";
      attempted_url: string;
      checked_at: string;
      note: string;
    };

export type RouteDiscoveryChecks = Record<
  RouteDiscoveryService,
  RouteDiscoveryCheck
>;

type IdentitySource = {
  type: string;
  url: string;
};

export type RouteDiscoveryDestination = {
  name: string;
};

const SERVICES = ["alltrails", "peakbagger"] as const;
const CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CHECK_FUTURE_SKEW_MS = 5 * 60 * 1000;

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

function serviceUrl(value: unknown, service: RouteDiscoveryService): string {
  if (typeof value !== "string") {
    throw new Error(`discovery_checks.${service}.url must be an HTTPS URL`);
  }
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const validHost =
    service === "alltrails"
      ? hostname === "alltrails.com" || hostname === "www.alltrails.com"
      : hostname === "peakbagger.com" || hostname === "www.peakbagger.com";
  if (
    url.protocol !== "https:" ||
    !validHost ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error(
      `discovery_checks.${service}.url must use the public ${service} HTTPS host`
    );
  }
  return url.toString();
}

function isDiscoveryResultUrl(
  url: URL,
  service: RouteDiscoveryService
): boolean {
  const path = url.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (service === "alltrails") {
    const localizedPath = path.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/, "");
    return /^\/trail\/[^/]+\/[^/]+\/[^/]+$/.test(localizedPath);
  }
  if (path === "/peak.aspx") {
    return /^\d+$/.test(url.searchParams.get("pid") ?? "");
  }
  if (path === "/climber/ascent.aspx") {
    return /^\d+$/.test(url.searchParams.get("aid") ?? "");
  }
  if (path === "/list.aspx") {
    return /^\d+$/.test(url.searchParams.get("lid") ?? "");
  }
  return false;
}

function normalizedSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function searchNamesDestination(
  query: string,
  destinationName: string
): boolean {
  const searched = normalizedSearchText(query);
  const destination = normalizedSearchText(destinationName);
  if (!searched || !destination) return false;
  return searched === destination;
}

function singleSearchQuery(url: URL, keys: readonly string[]): string | null {
  const values = keys.flatMap((key) => url.searchParams.getAll(key));
  return values.length === 1 ? values[0] : null;
}

function discoverySearchUrlNamesDestination(
  url: URL,
  service: RouteDiscoveryService,
  destinationName: string
): boolean {
  const path = url.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (service === "alltrails") {
    const localizedPath = path.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/, "");
    if (localizedPath === "/search") {
      return searchNamesDestination(
        singleSearchQuery(url, ["q", "query"]) ?? "",
        destinationName
      );
    }
    if (localizedPath === "/explore") {
      return searchNamesDestination(
        singleSearchQuery(url, ["q", "query"]) ?? "",
        destinationName
      );
    }
    return false;
  }

  if (path === "/search.aspx") {
    return searchNamesDestination(
      singleSearchQuery(url, ["query"]) ?? "",
      destinationName
    );
  }
  return false;
}

function matchedPageUrl(
  value: unknown,
  service: RouteDiscoveryService
): string {
  const raw = serviceUrl(value, service);
  if (!isDiscoveryResultUrl(new URL(raw), service)) {
    throw new Error(
      `discovery_checks.${service}.url must name a concrete public result page`
    );
  }
  return raw;
}

function attemptedPageUrl(
  value: unknown,
  service: RouteDiscoveryService,
  destinationName: string
): string {
  const raw = serviceUrl(value, service);
  const url = new URL(raw);
  if (!discoverySearchUrlNamesDestination(url, service, destinationName)) {
    throw new Error(
      `discovery_checks.${service}.attempted_url must be a public search for destination ${JSON.stringify(destinationName)}`
    );
  }
  return raw;
}

function checkedAt(
  value: unknown,
  service: RouteDiscoveryService,
  nowMs: number
): string {
  if (typeof value !== "string") {
    throw new Error(`discovery_checks.${service}.checked_at must be an ISO timestamp`);
  }
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs) || new Date(parsedMs).toISOString() !== value) {
    throw new Error(`discovery_checks.${service}.checked_at must be an ISO timestamp`);
  }
  if (parsedMs > nowMs + CHECK_FUTURE_SKEW_MS) {
    throw new Error(`discovery_checks.${service}.checked_at is in the future`);
  }
  if (parsedMs < nowMs - CHECK_MAX_AGE_MS) {
    throw new Error(`discovery_checks.${service}.checked_at is older than 24 hours`);
  }
  return value;
}

function identitySource(value: unknown, index: number): IdentitySource {
  const source = objectValue(value, `identity_sources[${index}]`);
  if (typeof source.type !== "string" || typeof source.url !== "string") {
    throw new Error("candidate identity sources require type and url strings");
  }
  return { type: source.type.trim().toLowerCase(), url: new URL(source.url).toString() };
}

export function parseRouteDiscoveryChecks(
  value: unknown,
  identitySourceValues: readonly unknown[],
  destination: RouteDiscoveryDestination,
  nowMs = Date.now()
): RouteDiscoveryChecks {
  if (
    !destination ||
    typeof destination.name !== "string" ||
    !destination.name.trim()
  ) {
    throw new Error("route discovery checks require the durable destination name");
  }
  const checks = objectValue(value, "discovery_checks");
  exactKeys(checks, SERVICES, "discovery_checks");
  const identitySources = identitySourceValues.map(identitySource);
  const output = {} as RouteDiscoveryChecks;

  for (const service of SERVICES) {
    const check = objectValue(
      checks[service],
      `discovery_checks.${service}`
    );
    const status = check.status;
    if (status === "matched") {
      exactKeys(
        check,
        ["status", "url", "checked_at"],
        `discovery_checks.${service}`
      );
      const url = matchedPageUrl(check.url, service);
      const checked_at = checkedAt(check.checked_at, service, nowMs);
      if (
        !identitySources.some(
          (source) => source.type === service && source.url === url
        )
      ) {
        throw new Error(
          `a matched ${service} discovery check must appear in identity_sources`
        );
      }
      output[service] = { status, url, checked_at };
      continue;
    }
    if (status !== "no_match" && status !== "unavailable") {
      throw new Error(
        `discovery_checks.${service}.status must be matched, no_match, or unavailable`
      );
    }
    exactKeys(
      check,
      ["status", "attempted_url", "checked_at", "note"],
      `discovery_checks.${service}`
    );
    const attempted_url = attemptedPageUrl(
      check.attempted_url,
      service,
      destination.name
    );
    const checked_at = checkedAt(check.checked_at, service, nowMs);
    if (
      typeof check.note !== "string" ||
      check.note.trim().length < 3 ||
      check.note.trim().length > 500
    ) {
      throw new Error(
        `discovery_checks.${service}.note must contain 3 to 500 characters`
      );
    }
    output[service] = {
      status,
      attempted_url,
      checked_at,
      note: check.note.trim(),
    };
  }
  return output;
}
