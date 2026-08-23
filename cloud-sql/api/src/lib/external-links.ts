export interface CatalogExternalLink {
  type: string;
  id: string;
}

type ExternalIds = Record<string, unknown>;

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

function providerName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) return null;
  return PROVIDER_ALIASES[normalized] ?? normalized;
}

function valueString(value: unknown): string | null {
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

/** Turn a provider ID into one unambiguous public page. Unknown ID schemes
 * stay hidden; a name-only search result can point at the wrong mountain. */
export function externalIdUrl(provider: string, rawId: unknown): string | null {
  const id = valueString(rawId);
  if (!id) return null;

  const direct = httpsUrl(id);
  if (direct) return direct;

  switch (providerName(provider)) {
  case "peakbagger":
    return /^-?[1-9]\d*$/.test(id)
      ? `https://www.peakbagger.com/peak.aspx?pid=${id}`
      : null;
  case "summitpost":
    return /^[1-9]\d*$/.test(id)
      ? `https://www.summitpost.org/page/${id}`
      : null;
  case "listsofjohn":
    return /^[1-9]\d*$/.test(id)
      ? `https://listsofjohn.com/peak/${id}`
      : null;
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
  const id = valueString(raw.id ?? raw.url ?? raw.href);
  if (!id) return null;
  const url = externalIdUrl(type, id);
  return url ? { type, id: url } : null;
}

/** Merge reviewed URLs with links that can be derived from stable provider
 * IDs. Stored links lead, duplicates collapse by final URL. */
export function normalizeExternalLinks(
  stored: unknown,
  externalIds: ExternalIds = {}
): CatalogExternalLink[] {
  const links: CatalogExternalLink[] = Array.isArray(stored)
    ? stored.map(storedLink).filter((link): link is CatalogExternalLink => link !== null)
    : [];

  for (const [rawProvider, rawId] of Object.entries(externalIds)) {
    const type = providerName(rawProvider);
    if (!type) continue;
    const id = externalIdUrl(type, rawId);
    if (id) links.push({ type, id });
  }

  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.id)) return false;
    seen.add(link.id);
    return true;
  });
}
