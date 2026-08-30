export const USGS_TRAILS_QUERY_URL =
  "https://partnerships.nationalmap.gov/arcgis/rest/services/" +
  "USGSTrails/MapServer/0/query";
export const USGS_TRAILS_LICENSE_NAME = "Public domain";
export const USGS_TRAILS_LICENSE_URL =
  "https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map";
export const USGS_TRAILS_DEFAULT_ORIGINATOR = "U.S. Geological Survey";

const MAX_USGS_TRAIL_OBJECT_IDS = 200;
const OBJECT_ID_QUERY_PATTERN = /^objectid IN \(([1-9]\d*(?:,[1-9]\d*)*)\)$/;

export function normalizeUsgsTrailOriginators(
  values: readonly unknown[]
): string[] {
  if (values.length === 0 || values.length > 100) {
    throw new Error("USGS trail originators must contain from 1 to 100 values");
  }
  const normalized = values.map((value, index) => {
    if (typeof value !== "string") {
      throw new Error(`USGS trail originator ${index + 1} must be a string`);
    }
    const text = value.trim();
    if (!text || text.length > 500 || /[\u0000-\u001f\u007f]/.test(text)) {
      throw new Error(
        `USGS trail originator ${index + 1} must be 1 to 500 printable characters`
      );
    }
    return text;
  });
  return [...new Set(normalized)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );
}

export function usgsTrailOriginatorFromProperties(
  properties: Readonly<Record<string, unknown>>
): string {
  const value = properties.sourceoriginator ?? properties.SOURCEORIGINATOR;
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return USGS_TRAILS_DEFAULT_ORIGINATOR;
  }
  return normalizeUsgsTrailOriginators([value])[0];
}

export function buildUsgsTrailAttribution(
  originators: readonly unknown[]
): string {
  return (
    `${normalizeUsgsTrailOriginators(originators).join(" and ")} via ` +
    "U.S. Geological Survey, The National Map"
  );
}

export function normalizeUsgsTrailObjectIds(
  values: readonly number[]
): number[] {
  if (values.length === 0) {
    throw new Error("at least one USGS trail object ID is required");
  }
  if (values.length > MAX_USGS_TRAIL_OBJECT_IDS) {
    throw new Error(
      `USGS trail queries may contain at most ${MAX_USGS_TRAIL_OBJECT_IDS} object IDs`
    );
  }
  const ids = values.map((value, index) => {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`USGS trail object ID ${index + 1} must be a positive safe integer`);
    }
    return value;
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error("USGS trail object IDs must be unique");
  }
  return ids.sort((left, right) => left - right);
}

export function buildUsgsTrailsQueryUrl(
  objectIds: readonly number[]
): URL {
  const ids = normalizeUsgsTrailObjectIds(objectIds);
  const url = new URL(USGS_TRAILS_QUERY_URL);
  url.searchParams.set("where", `objectid IN (${ids.join(",")})`);
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("f", "geojson");
  return url;
}

export function parseUsgsTrailsQueryUrl(sourceUrl: string): number[] {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Error("USGS source URL must be an absolute URL");
  }
  const service = new URL(USGS_TRAILS_QUERY_URL);
  if (
    url.protocol !== "https:" ||
    url.origin !== service.origin ||
    url.pathname !== service.pathname
  ) {
    throw new Error("USGS source URL is not the National Digital Trails layer-0 query");
  }
  const where = url.searchParams.get("where") ?? "";
  const match = OBJECT_ID_QUERY_PATTERN.exec(where);
  if (!match) {
    throw new Error("USGS source URL has an invalid object-ID query");
  }
  const ids = normalizeUsgsTrailObjectIds(match[1].split(",").map(Number));
  if (url.toString() !== buildUsgsTrailsQueryUrl(ids).toString()) {
    throw new Error("USGS source URL is not the canonical trail query");
  }
  return ids;
}

export function assertExactUsgsTrailObjectIds(
  expectedValues: readonly number[],
  returnedValues: readonly number[]
): void {
  const expected = normalizeUsgsTrailObjectIds(expectedValues);
  const returned = normalizeUsgsTrailObjectIds(returnedValues);
  if (
    returned.length !== expected.length ||
    returned.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `USGS trail query returned object IDs ${returned.join(",")}; expected ` +
        expected.join(",")
    );
  }
}

export default {
  USGS_TRAILS_DEFAULT_ORIGINATOR,
  USGS_TRAILS_LICENSE_NAME,
  USGS_TRAILS_LICENSE_URL,
  USGS_TRAILS_QUERY_URL,
  assertExactUsgsTrailObjectIds,
  buildUsgsTrailAttribution,
  buildUsgsTrailsQueryUrl,
  normalizeUsgsTrailObjectIds,
  normalizeUsgsTrailOriginators,
  parseUsgsTrailsQueryUrl,
  usgsTrailOriginatorFromProperties,
};
