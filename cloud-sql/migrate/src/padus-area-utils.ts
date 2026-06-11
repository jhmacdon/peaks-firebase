import crypto from "crypto";

export type AreaKind =
  | "national_park"
  | "national_monument"
  | "national_forest"
  | "national_grassland"
  | "wilderness"
  | "national_recreation_area"
  | "national_conservation_area"
  | "wildlife_refuge"
  | "wild_and_scenic_river"
  | "other_federal_area";

export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface GeoJsonMultiPolygon {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

export type GeoJsonAreaGeometry = GeoJsonPolygon | GeoJsonMultiPolygon;

export interface GeoJsonFeature {
  type: "Feature";
  geometry: GeoJsonAreaGeometry | null;
  properties: Record<string, unknown> | null;
}

export interface NormalizedPadusArea {
  name: string;
  searchName: string;
  kind: AreaKind;
  designation: string | null;
  manager: string | null;
  owner: string | null;
  stateCodes: string[];
  source: "padus";
  sourceVersion: string;
  sourceId: string;
  sourceRecordId: string;
  groupKey: string;
  geometry: GeoJsonMultiPolygon;
  metadata: Record<string, unknown>;
}

const STATE_CODES: Record<string, string> = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
  "District of Columbia": "DC",
  "American Samoa": "AS",
  Guam: "GU",
  "Northern Mariana Islands": "MP",
  "Commonwealth of the Northern Mariana Islands": "MP",
  "Puerto Rico": "PR",
  "U.S. Virgin Islands": "VI",
  "US Virgin Islands": "VI",
  "United States Virgin Islands": "VI",
  "Virgin Islands": "VI",
};

const STATE_CODES_BY_NAME = Object.fromEntries(
  Object.entries(STATE_CODES).map(([name, code]) => [normalizeSearchName(name), code])
);

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

export function normalizeSearchName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stableId(prefix: string, parts: string[]): string {
  const hash = crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 20);
  return `${prefix}-${hash}`;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

function canonicalAgencyName(value: unknown): string | null {
  const s = text(value);
  if (!s) return null;

  const normalized = normalizeSearchName(s);
  if (normalized === "fed" || normalized === "federal" || /\bfederal\b/.test(normalized)) {
    return "federal";
  }
  if (/\bnps\b/.test(normalized) || /\bnational park service\b/.test(normalized)) {
    return "national park service";
  }
  if (/\busfs\b/.test(normalized) || /\bu s forest service\b/.test(normalized) || /\bforest service\b/.test(normalized)) {
    return "forest service";
  }
  if (/\bblm\b/.test(normalized) || /\bbureau of land management\b/.test(normalized)) {
    return "bureau of land management";
  }
  if (
    /\bfws\b/.test(normalized) ||
    /\busfws\b/.test(normalized) ||
    /\bfish and wildlife service\b/.test(normalized) ||
    /\bfish wildlife service\b/.test(normalized)
  ) {
    return "fish and wildlife service";
  }
  return null;
}

function groupingAgencyName(props: Record<string, unknown>): string {
  const values = [
    props.Mang_Name,
    props.Own_Name,
    props.Mang_Type,
    props.Own_Type,
  ];

  for (const value of values) {
    const agency = canonicalAgencyName(value);
    if (agency) return agency;
  }

  for (const value of values) {
    const s = text(value);
    if (s) return normalizeSearchName(s);
  }

  return "";
}

function canonicalDesignationName(designation: string | null, kind: AreaKind): string {
  const normalized = normalizeSearchName(designation ?? "");

  switch (kind) {
    case "national_park":
      return "national park";
    case "national_monument":
      return "national monument";
    case "national_forest":
      return "national forest";
    case "national_grassland":
      return "national grassland";
    case "national_recreation_area":
      return "national recreation area";
    case "national_conservation_area":
      return "national conservation area";
    case "wildlife_refuge":
      return "wildlife refuge";
    case "wild_and_scenic_river":
      return "wild and scenic river";
    case "wilderness":
      return /\bwilderness study area\b/.test(normalized) ? "wilderness study area" : "wilderness";
    case "other_federal_area":
      if (/\bnational preserve\b/.test(normalized)) return "national preserve";
      if (/\bnational seashore\b/.test(normalized)) return "national seashore";
      if (/\bnational lakeshore\b/.test(normalized)) return "national lakeshore";
      if (/\barea of critical environmental concern\b/.test(normalized)) return "area of critical environmental concern";
      return normalized;
  }
}

function firstTextProperty(props: Record<string, unknown>, names: string[]): string | null {
  const propsByLowerName = new Map(
    Object.keys(props).map((key) => [key.toLowerCase(), key])
  );

  for (const name of names) {
    const direct = text(props[name]);
    if (direct) return direct;

    const actualName = propsByLowerName.get(name.toLowerCase());
    if (!actualName) continue;

    const value = text(props[actualName]);
    if (value) return value;
  }

  return null;
}

function mapKind(props: Record<string, unknown>): AreaKind | null {
  const designationText = [
    text(props.Des_Tp),
    text(props.Loc_Ds),
    text(props.Unit_Nm),
    text(props.Category),
  ].filter(Boolean).join(" ").toLowerCase();
  const managerText = [
    text(props.Mang_Name),
    text(props.Own_Name),
  ].filter(Boolean).join(" ").toLowerCase();
  const normalizedDesignationText = normalizeSearchName(designationText);

  if (/\bnational monument\b/.test(normalizedDesignationText)) return "national_monument";
  if (/\bnational recreation area\b/.test(normalizedDesignationText)) return "national_recreation_area";
  if (/\bnational conservation area\b/.test(normalizedDesignationText)) return "national_conservation_area";
  if (/\bnational grassland\b/.test(normalizedDesignationText)) return "national_grassland";
  if (/\bnational forest\b/.test(normalizedDesignationText)) return "national_forest";
  if (/\bnational park\b/.test(normalizedDesignationText)) return "national_park";
  if (/\bwilderness\b/.test(normalizedDesignationText)) return "wilderness";
  if (/\bwildlife refuge\b/.test(normalizedDesignationText)) return "wildlife_refuge";
  if (/\bwild and scenic river\b/.test(normalizedDesignationText)) return "wild_and_scenic_river";
  if (
    /\bnational preserve\b/.test(normalizedDesignationText) ||
    /\bnational seashore\b/.test(normalizedDesignationText) ||
    /\bnational lakeshore\b/.test(normalizedDesignationText) ||
    /\barea of critical environmental concern\b/.test(normalizedDesignationText) ||
    /\bblm\b|\bbureau of land management\b|\bnational landscape conservation system\b/.test(`${designationText} ${managerText}`) ||
    isFederal(props)
  ) {
    return "other_federal_area";
  }
  return null;
}

function isFederal(props: Record<string, unknown>): boolean {
  const haystack = [
    text(props.Mang_Name),
    text(props.Own_Name),
    text(props.Mang_Type),
    text(props.Own_Type),
  ].filter(Boolean).join(" ").toLowerCase();

  return [
    props.Mang_Name,
    props.Own_Name,
    props.Mang_Type,
    props.Own_Type,
  ].some((value) => canonicalAgencyName(value) !== null) ||
    /\bfederal\b|\bnational park service\b|\bforest service\b|\bbureau of land management\b|\bfish and wildlife service\b|\busfs\b|\bnps\b|\bblm\b|\bfws\b/.test(haystack);
}

function stateCodes(props: Record<string, unknown>): string[] {
  const values = [
    text(props.State_Nm),
    text(props.State_Nm2),
    text(props.State_Nm3),
    text(props.State),
    text(props.STATE),
  ].filter(Boolean) as string[];
  const out = new Set<string>();
  for (const value of values) {
    for (const part of value.split(/[;,]/)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const upper = trimmed.toUpperCase();
      if (/^[A-Z]{2}$/.test(upper)) out.add(upper);
      else {
        const code = STATE_CODES_BY_NAME[normalizeSearchName(trimmed)];
        if (code) out.add(code);
      }
    }
  }
  return Array.from(out).sort();
}

export function geometryToMultiPolygon(geometry: GeoJsonAreaGeometry): GeoJsonMultiPolygon {
  if (geometry.type === "MultiPolygon") return geometry;
  return { type: "MultiPolygon", coordinates: [geometry.coordinates] };
}

export function shouldImportPadusFeature(feature: GeoJsonFeature): boolean {
  const props = feature.properties ?? {};
  if (!feature.geometry) return false;
  if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") return false;
  return isFederal(props) && mapKind(props) !== null;
}

export function normalizePadusFeature(
  feature: GeoJsonFeature,
  sourceVersion: string
): NormalizedPadusArea | null {
  if (!shouldImportPadusFeature(feature)) return null;

  const props = feature.properties ?? {};
  const name = text(props.Unit_Nm) ?? text(props.Name) ?? text(props.NAME);
  const kind = mapKind(props);
  if (!name || !kind || !feature.geometry) return null;

  const designation = text(props.Des_Tp) ?? text(props.Loc_Ds);
  const manager = text(props.Mang_Name);
  const owner = text(props.Own_Name);
  const searchName = normalizeSearchName(name);
  const groupKey = [
    kind,
    searchName,
    canonicalDesignationName(designation, kind),
    groupingAgencyName(props),
  ].join("|");

  const sourceRecordId =
    firstTextProperty(props, ["Source_PAID", "PADUS_ID", "PADUSID", "GIS_ID", "OBJECTID"]) ??
    stableId("record", [groupKey, stableSerialize(props)]);

  return {
    name,
    searchName,
    kind,
    designation,
    manager,
    owner,
    stateCodes: stateCodes(props),
    source: "padus",
    sourceVersion,
    sourceId: stableId("padus", [groupKey]),
    sourceRecordId,
    groupKey,
    geometry: geometryToMultiPolygon(feature.geometry),
    metadata: { padus: props },
  };
}

export function buildLinkDestinationsSql(replaceExisting: boolean): string {
  return `SELECT link_summit_destinations_to_areas(${replaceExisting ? "true" : "false"}) AS inserted_count;`;
}

function requireGeoJsonFeature(value: unknown, errorMessage: string): GeoJsonFeature {
  if (!value || typeof value !== "object" || (value as { type?: unknown }).type !== "Feature") {
    throw new Error(errorMessage);
  }
  return value as GeoJsonFeature;
}

export function parseGeoJsonFeatures(contents: string): GeoJsonFeature[] {
  const trimmed = contents.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
        return parsed.features.map((feature: unknown) =>
          requireGeoJsonFeature(
            feature,
            "FeatureCollection.features must contain only GeoJSON Feature objects"
          )
        );
      }
      if (parsed.type === "Feature") {
        return [requireGeoJsonFeature(parsed, "GeoJSON input must be a FeatureCollection or Feature")];
      }
      throw new Error("GeoJSON input must be a FeatureCollection or Feature");
    } catch (err) {
      if (!(err instanceof SyntaxError) || !/\r?\n/.test(trimmed)) {
        throw err;
      }
    }
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parsed = JSON.parse(line);
      return requireGeoJsonFeature(parsed, "NDJSON input lines must be GeoJSON Feature objects");
    });
}
