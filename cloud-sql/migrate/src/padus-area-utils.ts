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
};

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

function sourceVersionSlug(sourceVersion: string): string {
  return sourceVersion.replace(/[^0-9a-z]/gi, "").toLowerCase();
}

function stableId(prefix: string, parts: string[]): string {
  const hash = crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 20);
  return `${prefix}-${hash}`;
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

  if (/\bnational monument\b/.test(designationText)) return "national_monument";
  if (/\bnational recreation area\b/.test(designationText)) return "national_recreation_area";
  if (/\bnational conservation area\b/.test(designationText)) return "national_conservation_area";
  if (/\bnational grassland\b/.test(designationText)) return "national_grassland";
  if (/\bnational forest\b/.test(designationText)) return "national_forest";
  if (/\bnational park\b/.test(designationText)) return "national_park";
  if (/\bwilderness\b/.test(designationText)) return "wilderness";
  if (/\bwildlife refuge\b/.test(designationText)) return "wildlife_refuge";
  if (/\bwild( |-)and( |-)scenic river\b/.test(designationText)) return "wild_and_scenic_river";
  if (/\bblm\b|\bbureau of land management\b|\bnational landscape conservation system\b/.test(`${designationText} ${managerText}`)) {
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

  return /\bfederal\b|\bnational park service\b|\bforest service\b|\bbureau of land management\b|\bfish and wildlife service\b|\busfs\b|\bnps\b|\bblm\b|\bfws\b/.test(haystack);
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
      else if (STATE_CODES[trimmed]) out.add(STATE_CODES[trimmed]);
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
    normalizeSearchName(designation ?? ""),
    normalizeSearchName(manager ?? ""),
  ].join("|");

  const sourceRecordId =
    text(props.PADUS_ID) ??
    text(props.PADUSID) ??
    text(props.GIS_ID) ??
    text(props.OBJECTID) ??
    stableId("record", [groupKey, JSON.stringify(props)]);

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
    sourceId: stableId(`padus${sourceVersionSlug(sourceVersion)}`, [groupKey]),
    sourceRecordId,
    groupKey,
    geometry: geometryToMultiPolygon(feature.geometry),
    metadata: { padus: props },
  };
}

export function buildLinkDestinationsSql(replaceExisting: boolean): string {
  const deleteSql = replaceExisting
    ? "DELETE FROM destination_areas WHERE source = 'postgis';\n\n"
    : "";
  return `${deleteSql}INSERT INTO destination_areas (destination_id, area_id, relation, source)
SELECT d.id, a.id, 'contained_by', 'postgis'
FROM destinations d
JOIN areas a ON ST_Covers(a.boundary, d.location)
WHERE d.location IS NOT NULL
  AND 'summit'::destination_feature = ANY(d.features)
ON CONFLICT (destination_id, area_id) DO NOTHING;`;
}
