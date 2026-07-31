export interface RouteProvenance {
  source_kind: string;
  source_url: string;
  license_name: string;
  license_url: string;
  attribution: string;
  retrieved_at: string;
  osm_way_ids: number[];
  osm_way_urls: string[];
  contains_osm_geometry: boolean;
  elevation_source?: string;
  elevation_profile?: "terrain" | "monotonic_ascent";
}

export interface RouteProvenanceInput {
  source_kind?: string;
  source_url?: string;
  license_name?: string;
  license_url?: string;
  attribution?: string;
  retrieved_at?: string;
  osm_way_ids?: number[];
  osm_way_urls?: string[];
  contains_osm_geometry?: boolean;
  elevation_source?: string;
  elevation_profile?: "terrain" | "monotonic_ascent";
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned : null;
}

function cleanHttpUrl(value: unknown, field: string): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;

  try {
    const url = new URL(cleaned);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error();
    }
    return url.toString();
  } catch {
    throw new Error(`${field} must be an http or https URL`);
  }
}

function cleanPositiveIntegerArray(value: unknown, field: string): number[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return [...new Set(value.map((item) => {
    if (typeof item !== "number" || !Number.isSafeInteger(item) || item <= 0) {
      throw new Error(`${field} must contain positive safe integers`);
    }
    return item;
  }))];
}

function cleanUrlArray(value: unknown, field: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return [...new Set(value.map((item) => cleanHttpUrl(item, field)).filter((item): item is string => item !== null))];
}

function cleanTimestamp(value: unknown): string {
  const cleaned = cleanText(value);
  if (!cleaned) return new Date().toISOString();
  const timestamp = new Date(cleaned);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("retrieved_at must be a valid timestamp");
  }
  return timestamp.toISOString();
}

/**
 * Normalize provenance before it reaches the routes JSONB column.
 * Returns null when the caller did not supply provenance.
 */
export function normalizeRouteProvenance(
  input: RouteProvenanceInput | null | undefined
): RouteProvenance | null {
  if (!input) return null;

  const sourceKind = cleanText(input.source_kind)?.toLowerCase() ?? null;
  const sourceUrl = cleanHttpUrl(input.source_url, "source_url");
  const licenseName = cleanText(input.license_name);
  const licenseUrl = cleanHttpUrl(input.license_url, "license_url");
  const attribution = cleanText(input.attribution);
  const osmWayIds = cleanPositiveIntegerArray(input.osm_way_ids, "osm_way_ids");
  const suppliedOsmWayUrls = cleanUrlArray(input.osm_way_urls, "osm_way_urls");
  const expectedOsmWayUrls = osmWayIds.map(
    (wayId) => `https://www.openstreetmap.org/way/${wayId}`
  );
  if (suppliedOsmWayUrls.length > 0 && (
    suppliedOsmWayUrls.length !== expectedOsmWayUrls.length ||
    suppliedOsmWayUrls.some((url, index) => url !== expectedOsmWayUrls[index])
  )) {
    throw new Error("osm_way_urls must match their OpenStreetMap way IDs in order");
  }
  if (suppliedOsmWayUrls.length > 0 && osmWayIds.length === 0) {
    throw new Error("osm_way_urls require matching osm_way_ids");
  }
  const containsOsmGeometry = osmWayIds.length > 0;
  const elevationSource = cleanText(input.elevation_source);
  const elevationProfile = input.elevation_profile;
  if ((elevationSource == null) !== (elevationProfile == null)) {
    throw new Error(
      "elevation_source and elevation_profile must be supplied together"
    );
  }
  if (
    elevationProfile != null &&
    elevationProfile !== "terrain" &&
    elevationProfile !== "monotonic_ascent"
  ) {
    throw new Error("elevation_profile must be terrain or monotonic_ascent");
  }

  if (!sourceKind || !sourceUrl || !licenseName || !licenseUrl || !attribution) {
    throw new Error(
      "Route provenance requires source_kind, source_url, license_name, license_url, and attribution"
    );
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(sourceKind)) {
    throw new Error("source_kind must use lowercase letters, numbers, underscores, or hyphens");
  }
  if (input.contains_osm_geometry !== undefined && input.contains_osm_geometry !== containsOsmGeometry) {
    throw new Error("contains_osm_geometry must match whether OSM way IDs are present");
  }
  if (containsOsmGeometry && (
    sourceKind !== "openstreetmap" ||
    licenseName !== "Open Data Commons Open Database License (ODbL) 1.0" ||
    licenseUrl !== "https://opendatacommons.org/licenses/odbl/1-0/" ||
    attribution !== "© OpenStreetMap contributors"
  )) {
    throw new Error("OpenStreetMap geometry requires the canonical ODbL license and attribution");
  }

  const normalized: RouteProvenance = {
    source_kind: sourceKind,
    source_url: sourceUrl,
    license_name: licenseName,
    license_url: licenseUrl,
    attribution,
    retrieved_at: cleanTimestamp(input.retrieved_at),
    osm_way_ids: osmWayIds,
    osm_way_urls: expectedOsmWayUrls,
    contains_osm_geometry: containsOsmGeometry,
  };
  if (elevationSource && elevationProfile) {
    normalized.elevation_source = elevationSource;
    normalized.elevation_profile = elevationProfile;
  }
  return normalized;
}

/** Safely parse JSONB loaded from Postgres. Invalid legacy values stay hidden. */
export function parseRouteProvenance(value: unknown): RouteProvenance | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!cleanText((value as Record<string, unknown>).retrieved_at)) return null;
  try {
    return normalizeRouteProvenance(value as RouteProvenanceInput);
  } catch {
    return null;
  }
}
