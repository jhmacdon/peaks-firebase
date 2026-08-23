export interface CatalogExternalLink {
  type: string;
  id: string;
}

export interface ParsedExternalLink extends CatalogExternalLink {
  href: string;
  label: string;
  display: string;
}

const PROVIDER_ALIASES: Record<string, string> = {
  "all-trails": "alltrails",
  all_trails: "alltrails",
  lists_of_john: "listsofjohn",
  "lists-of-john": "listsofjohn",
  loj: "listsofjohn",
  openstreetmap: "osm",
  recreation_gov: "recreation_gov",
  "recreation-gov": "recreation_gov",
  ridb: "recreation_gov",
  ridb_facility: "recreation_gov",
  summit_post: "summitpost",
  "summit-post": "summitpost",
};

const PROVIDER_LABELS: Record<string, string> = {
  alltrails: "AllTrails",
  caltopo: "CalTopo",
  gaia: "Gaia GPS",
  gnis: "USGS GNIS",
  hiking_project: "Hiking Project",
  listsofjohn: "ListsOfJohn",
  mountaineers: "The Mountaineers",
  nps: "National Park Service",
  osm: "OpenStreetMap",
  osm_node: "OpenStreetMap",
  osm_relation: "OpenStreetMap",
  osm_way: "OpenStreetMap",
  peakbagger: "Peakbagger",
  recreation_gov: "Recreation.gov",
  summitpost: "SummitPost",
  strava: "Strava",
  trailforks: "Trailforks",
  usfs: "US Forest Service",
  wikidata: "Wikidata",
  wikiloc: "Wikiloc",
  wta: "Washington Trails Association",
};

const DERIVED_PROVIDER_ORDER = [
  "peakbagger",
  "summitpost",
  "listsofjohn",
  "alltrails",
  "wta",
  "gnis",
  "wikidata",
  "osm_node",
  "osm_way",
  "osm_relation",
];

function providerName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) return null;
  return PROVIDER_ALIASES[normalized] ?? normalized;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function externalIdUrl(provider: string, rawId: unknown): string | null {
  const id = stringValue(rawId);
  if (!id) return null;

  const direct = httpsUrl(id);
  if (direct) return direct;

  switch (providerName(provider)) {
  case "peakbagger":
    return /^-?[1-9]\d*$/.test(id)
      ? `https://www.peakbagger.com/peak.aspx?pid=${id}`
      : null;
  case "summitpost":
    return /^[1-9]\d*$/.test(id) ? `https://www.summitpost.org/page/${id}` : null;
  case "listsofjohn":
    return /^[1-9]\d*$/.test(id) ? `https://listsofjohn.com/peak/${id}` : null;
  case "wikidata":
    return /^Q[1-9]\d*$/i.test(id)
      ? `https://www.wikidata.org/wiki/${id.toUpperCase()}`
      : null;
  case "gnis":
    return /^\d+$/.test(id)
      ? `https://edits.nationalmap.gov/apps/gaz-domestic/public/summary/${id}`
      : null;
  case "osm_node":
    return /^\d+$/.test(id) ? `https://www.openstreetmap.org/node/${id}` : null;
  case "osm_way":
    return /^\d+$/.test(id) ? `https://www.openstreetmap.org/way/${id}` : null;
  case "osm_relation":
    return /^\d+$/.test(id) ? `https://www.openstreetmap.org/relation/${id}` : null;
  case "wta":
    return /^[a-z0-9][a-z0-9-]*$/i.test(id)
      ? `https://www.wta.org/go-hiking/hikes/${id}`
      : null;
  case "alltrails": {
    const path = id.replace(/^\/+/, "");
    return /^(?:[a-z]{2}(?:-[a-z]{2})?\/)?trail\/[a-z0-9/_-]+$/i.test(path)
      ? `https://www.alltrails.com/${path}`
      : null;
  }
  case "strava":
    return /^[1-9]\d*$/.test(id) ? `https://www.strava.com/routes/${id}` : null;
  case "caltopo":
    return /^[a-z0-9]+$/i.test(id) ? `https://caltopo.com/m/${id}` : null;
  case "gaia":
    return /^[a-z0-9_-]+$/i.test(id) ? `https://www.gaiagps.com/public/${id}` : null;
  case "wikiloc":
    return /^[1-9]\d*$/.test(id)
      ? `https://www.wikiloc.com/wikiloc/view.do?id=${id}`
      : null;
  case "hiking_project":
    return /^[1-9]\d*$/.test(id)
      ? `https://www.hikingproject.com/trail/${id}`
      : null;
  case "recreation_gov":
    return /^[1-9]\d*$/.test(id)
      ? `https://www.recreation.gov/camping/campgrounds/${id}`
      : null;
  default:
    return null;
  }
}

function storedLink(value: unknown): CatalogExternalLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const type = providerName(raw.type ?? raw.provider ?? raw.source);
  if (!type) return null;
  const id = externalIdUrl(type, raw.id ?? raw.url ?? raw.href);
  return id ? { type, id } : null;
}

export function normalizeExternalLinks(
  stored: unknown,
  externalIds: Record<string, unknown> = {}
): CatalogExternalLink[] {
  const links = Array.isArray(stored)
    ? stored.map(storedLink).filter((link): link is CatalogExternalLink => link !== null)
    : [];

  const providers = [
    ...DERIVED_PROVIDER_ORDER,
    ...Object.keys(externalIds).filter((provider) => !DERIVED_PROVIDER_ORDER.includes(provider)),
  ];
  for (const rawProvider of providers) {
    const type = providerName(rawProvider);
    if (!type) continue;
    const id = externalIdUrl(type, externalIds[rawProvider]);
    if (id) links.push({ type, id });
  }

  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.id)) return false;
    seen.add(link.id);
    return true;
  });
}

function titleize(input: string): string {
  return input
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function parseExternalLinks(
  stored: unknown,
  externalIds: Record<string, unknown> = {}
): ParsedExternalLink[] {
  return normalizeExternalLinks(stored, externalIds).map((link) => ({
    ...link,
    href: link.id,
    label: PROVIDER_LABELS[link.type] ?? titleize(link.type),
    display: new URL(link.id).host.replace(/^www\./, ""),
  }));
}

export function parseExternalRouteLinks(stored: unknown): ParsedExternalLink[] {
  return parseExternalLinks(stored);
}

export function parseDestinationExternalLinks(
  stored: unknown,
  externalIds: Record<string, unknown>
): ParsedExternalLink[] {
  return parseExternalLinks(stored, externalIds);
}

export function partitionDestinationExternalLinks(links: ParsedExternalLink[]): {
  recreationGov: ParsedExternalLink | null;
  other: ParsedExternalLink[];
} {
  const recreationGov = links.find((link) => link.type === "recreation_gov") ?? null;
  return {
    recreationGov,
    other: links.filter((link) => link.type !== "recreation_gov"),
  };
}

export type ParsedExternalRouteLink = ParsedExternalLink;
