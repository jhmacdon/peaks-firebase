// Glacier catalog for the public web: SQL, row parsing, unit wording, page
// copy, FAQ answers and JSON-LD. Pure and DB-free so it can be unit tested;
// actions/cached-glaciers.ts runs the queries.
//
// The data contract is docs/glaciers-api-contract.md. The rules that matter
// here: every measurement is SI or null (never a placeholder zero), credits
// and mountain totals come only from the facts row, and an area history
// whose scope names several glaciers must never be described as this one
// glacier's loss.

const KM2_PER_MI2 = 2.589988110336;
const KM3_PER_MI3 = 4.168181825;
const FEET_PER_METER = 3.28084;
const KM_PER_MI = 1.609344;

export const GLACIER_WIKIDATA_URL = "https://www.wikidata.org/wiki/Q35666";

export type GlacierKind = "glacier" | "snowfield";

export interface GlacierAreaPoint {
  year: number;
  area_km2: number | null;
  uncertainty_km2: number | null;
}

export interface GlacierMountainContext {
  observed_year: number | null;
  named_glacier_count: number | null;
  area_km2: number | null;
  area_uncertainty_km2: number | null;
  history_start_year: number | null;
  percent_change_since_history_start: number | null;
}

export interface GlacierOutlineProvenance {
  geometry_source: string | null;
  source_url: string | null;
  observed_at: string | null;
  snapshot_at: string | null;
  license: string | null;
  license_url: string | null;
  credit: string | null;
  method: string | null;
}

export interface GlacierReportProvenance {
  url: string | null;
  doi: string | null;
  credit: string | null;
  license: string | null;
}

export interface GlacierParent {
  id: string;
  name: string;
  elevation: number | null;
}

export interface GlacierFacts {
  id: string;
  name: string;
  kind: GlacierKind;
  parent: GlacierParent;
  inventory_name: string | null;
  observed_year: number | null;
  area_km2: number | null;
  area_uncertainty_km2: number | null;
  head_elevation_m: number | null;
  terminus_elevation_m: number | null;
  elevation_range_m: number | null;
  length_km: number | null;
  average_slope_deg: number | null;
  flow_direction_deg: number | null;
  flow_direction_label: string | null;
  type_code: string | null;
  type_label: string | null;
  estimated_volume_km3: number | null;
  volume_uncertainty_km3: number | null;
  rank_on_mountain: number | null;
  area_history: GlacierAreaPoint[];
  area_history_scope: string | null;
  percent_change_since_earliest: number | null;
  facts_credit: string;
  facts_source_url: string | null;
  geometry_credit: string;
  geometry_license: string;
  outline_source_url: string | null;
  outline_mapped_at: string | null;
  outline: GlacierOutlineProvenance | null;
  report: GlacierReportProvenance | null;
  mountain_context: GlacierMountainContext | null;
  boundary: GeoJSON.MultiPolygon | null;
  updated_at: string | null;
}

/** One glacier as a row on its mountain's roster. */
export interface GlacierSummary {
  id: string;
  name: string;
  kind: GlacierKind;
  area_km2: number | null;
  head_elevation_m: number | null;
  terminus_elevation_m: number | null;
  length_km: number | null;
  flow_direction_label: string | null;
  rank_on_mountain: number | null;
  percent_change_since_earliest: number | null;
  area_history_scope: string | null;
  inventory_name: string | null;
  history_start_year: number | null;
  observed_year: number | null;
  geometry_credit: string | null;
  geometry_license: string | null;
  geometry_license_url: string | null;
  lat: number | null;
  lng: number | null;
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  updated_at: string | null;
}

export interface GlacierMountain {
  id: string;
  name: string;
  slug: string;
  elevation: number | null;
  state_code: string | null;
  country_code: string | null;
  lat: number | null;
  lng: number | null;
  hero_image: string | null;
  hero_image_attribution: string | null;
  hero_image_attribution_url: string | null;
  glacier_count: number;
  snowfield_count: number;
  mapped_area_km2: number | null;
  context: GlacierMountainContext | null;
  facts_credit: string | null;
  facts_source_url: string | null;
  updated_at: string | null;
}

export interface GlacierRouteCrossing {
  id: string;
  name: string | null;
  distance: number | null;
  gain: number | null;
  pass_count: number;
  on_ice_m: number | null;
  min_elevation_m: number | null;
  max_elevation_m: number | null;
}

// ── SQL ──────────────────────────────────────────────────────────────────
// Public pages read the Peaks catalog only: both the glacier and its parent
// mountain must be owner 'peaks', the same rule the API applies to a
// signed-out caller.

const PUBLIC_GLACIER_SQL = `'glacier' = ANY(d.features::text[])
      AND d.owner = 'peaks' AND pm.owner = 'peaks'`;

/** Full facts for one glacier. Outline at 6 decimals (~0.1 m) — the page's
 * map is the only consumer, and nine decimals only adds bytes. */
export const GLACIER_FACTS_QUERY = `
  SELECT gf.destination_id AS id, d.name, gf.kind,
         pm.id AS parent_id, pm.name AS parent_name, pm.elevation::double precision AS parent_elevation,
         gf.inventory_name, gf.observed_year, gf.area_km2, gf.area_uncertainty_km2,
         gf.head_elevation_m, gf.terminus_elevation_m, gf.elevation_range_m, gf.length_km,
         gf.average_slope_deg, gf.flow_direction_deg, gf.flow_direction_label,
         gf.type_code, gf.type_label, gf.estimated_volume_km3, gf.volume_uncertainty_km3,
         gf.rank_on_mountain, gf.area_history, gf.area_history_scope,
         gf.percent_change_since_earliest, gf.facts_credit, gf.facts_source_url,
         gf.geometry_credit, gf.geometry_license, gf.outline_source_url,
         to_char(gf.outline_observed_at, 'YYYY-MM-DD') AS outline_mapped_at,
         gf.provenance->'outline' AS outline,
         gf.provenance->'report' AS report,
         gf.provenance->'mountain_context' AS mountain_context,
         ST_AsGeoJSON(gf.outline, 6)::json AS boundary,
         GREATEST(gf.updated_at, d.updated_at) AS updated_at
  FROM destination_glacier_facts gf
  JOIN destinations d ON d.id = gf.destination_id
  JOIN destinations pm ON pm.id = gf.parent_mountain_id
  WHERE gf.destination_id = $1 AND ${PUBLIC_GLACIER_SQL}
`;

/** Every glacier on one mountain, largest first. `$2` toggles a simplified
 * outline (≈5 m tolerance) for the mountain map; rosters elsewhere skip it. */
export const MOUNTAIN_GLACIERS_QUERY = `
  SELECT gf.destination_id AS id, d.name, gf.kind, gf.area_km2,
         gf.head_elevation_m, gf.terminus_elevation_m, gf.length_km,
         gf.flow_direction_label, gf.rank_on_mountain, gf.percent_change_since_earliest,
         gf.area_history_scope, gf.inventory_name, gf.observed_year,
         gf.geometry_credit, gf.geometry_license,
         gf.provenance->'outline'->>'license_url' AS geometry_license_url,
         (SELECT min((p->>'year')::int) FROM jsonb_array_elements(gf.area_history) p
           WHERE jsonb_typeof(p->'area_km2') = 'number') AS history_start_year,
         ST_Y(d.location::geometry) AS lat, ST_X(d.location::geometry) AS lng,
         CASE WHEN $2::boolean
              THEN ST_AsGeoJSON(ST_SimplifyPreserveTopology(gf.outline::geometry, 0.00005), 5)::json
         END AS boundary,
         GREATEST(gf.updated_at, d.updated_at) AS updated_at
  FROM destination_glacier_facts gf
  JOIN destinations d ON d.id = gf.destination_id
  JOIN destinations pm ON pm.id = gf.parent_mountain_id
  WHERE gf.parent_mountain_id = $1 AND ${PUBLIC_GLACIER_SQL}
  ORDER BY gf.area_km2 DESC NULLS LAST, d.name ASC, d.id ASC
`;

/** Mountains that carry glaciers, with roster totals. The mountain-wide
 * inventory context is identical on every row of one import, so any row's
 * copy is the mountain's. */
export const GLACIER_MOUNTAINS_QUERY = `
  SELECT pm.id, pm.name, pm.elevation::double precision AS elevation,
         pm.state_code, pm.country_code,
         ST_Y(pm.location::geometry) AS lat, ST_X(pm.location::geometry) AS lng,
         pm.hero_image, pm.hero_image_attribution, pm.hero_image_attribution_url,
         count(*) FILTER (WHERE gf.kind = 'glacier')::int AS glacier_count,
         count(*) FILTER (WHERE gf.kind = 'snowfield')::int AS snowfield_count,
         sum(gf.area_km2) AS mapped_area_km2,
         (array_agg(gf.provenance->'mountain_context' ORDER BY gf.destination_id)
            FILTER (WHERE gf.provenance ? 'mountain_context'))[1] AS context,
         (array_agg(gf.facts_credit ORDER BY gf.destination_id))[1] AS facts_credit,
         (array_agg(gf.facts_source_url ORDER BY gf.destination_id)
            FILTER (WHERE gf.facts_source_url IS NOT NULL))[1] AS facts_source_url,
         max(GREATEST(gf.updated_at, d.updated_at)) AS updated_at
  FROM destination_glacier_facts gf
  JOIN destinations d ON d.id = gf.destination_id
  JOIN destinations pm ON pm.id = gf.parent_mountain_id
  WHERE ${PUBLIC_GLACIER_SQL}
  GROUP BY pm.id
  ORDER BY sum(gf.area_km2) DESC NULLS LAST, pm.name ASC, pm.id ASC
`;

/** Active catalog routes whose current match crosses this glacier; repeat
 * passes fold into one row. Bounded like the API's glacier sheet. */
export const GLACIER_ROUTES_QUERY = `
  SELECT r.id, r.name, r.distance::double precision AS distance, r.gain::double precision AS gain,
         count(*)::int AS pass_count,
         sum(c.crossed_distance_m) AS on_ice_m,
         min(c.min_elevation_m) AS min_elevation_m,
         max(c.max_elevation_m) AS max_elevation_m
  FROM route_glacier_crossings c
  JOIN routes r ON r.id = c.route_id
  WHERE c.destination_id = $1 AND r.owner = 'peaks' AND r.status = 'active'
    AND r.glacier_match_input_hash IS NOT NULL
  GROUP BY r.id
  ORDER BY max(r.popularity) DESC, r.name ASC NULLS LAST, r.id ASC
  LIMIT 25
`;

// ── Row parsing ──────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return str(value);
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseKind(value: unknown): GlacierKind {
  return value === "snowfield" ? "snowfield" : "glacier";
}

function parseHistory(value: unknown): GlacierAreaPoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      const point = obj(entry);
      const year = num(point?.year);
      if (!point || year == null) return [];
      return [{ year, area_km2: num(point.area_km2), uncertainty_km2: num(point.uncertainty_km2) }];
    })
    .sort((a, b) => a.year - b.year);
}

function parseContext(value: unknown): GlacierMountainContext | null {
  const context = obj(value);
  if (!context) return null;
  return {
    observed_year: num(context.observed_year),
    named_glacier_count: num(context.named_glacier_count),
    area_km2: num(context.area_km2),
    area_uncertainty_km2: num(context.area_uncertainty_km2),
    history_start_year: num(context.history_start_year),
    percent_change_since_history_start: num(context.percent_change_since_history_start),
  };
}

function parseOutline(value: unknown): GlacierOutlineProvenance | null {
  const outline = obj(value);
  if (!outline) return null;
  return {
    geometry_source: str(outline.geometry_source),
    source_url: str(outline.source_url),
    observed_at: str(outline.observed_at),
    snapshot_at: str(outline.snapshot_at),
    license: str(outline.license),
    license_url: str(outline.license_url),
    credit: str(outline.credit),
    method: str(outline.method),
  };
}

function parseReport(value: unknown): GlacierReportProvenance | null {
  const report = obj(value);
  if (!report) return null;
  return {
    url: str(report.url),
    doi: str(report.doi),
    credit: str(report.credit),
    license: str(report.license),
  };
}

function parseBoundary<T extends "Polygon" | "MultiPolygon">(
  value: unknown,
  types: readonly T[]
): Extract<GeoJSON.Geometry, { type: T }> | null {
  const geometry = obj(value);
  if (!geometry || !types.includes(geometry.type as T) || !Array.isArray(geometry.coordinates)) return null;
  return geometry as unknown as Extract<GeoJSON.Geometry, { type: T }>;
}

export function parseGlacierFactsRow(row: any): GlacierFacts {
  return {
    id: String(row.id),
    name: str(row.name) ?? "Unnamed glacier",
    kind: parseKind(row.kind),
    parent: {
      id: String(row.parent_id),
      name: str(row.parent_name) ?? "Unnamed mountain",
      elevation: num(row.parent_elevation),
    },
    inventory_name: str(row.inventory_name),
    observed_year: num(row.observed_year),
    area_km2: num(row.area_km2),
    area_uncertainty_km2: num(row.area_uncertainty_km2),
    head_elevation_m: num(row.head_elevation_m),
    terminus_elevation_m: num(row.terminus_elevation_m),
    elevation_range_m: num(row.elevation_range_m),
    length_km: num(row.length_km),
    average_slope_deg: num(row.average_slope_deg),
    flow_direction_deg: num(row.flow_direction_deg),
    flow_direction_label: str(row.flow_direction_label),
    type_code: str(row.type_code),
    type_label: str(row.type_label),
    estimated_volume_km3: num(row.estimated_volume_km3),
    volume_uncertainty_km3: num(row.volume_uncertainty_km3),
    rank_on_mountain: num(row.rank_on_mountain),
    area_history: parseHistory(row.area_history),
    area_history_scope: str(row.area_history_scope),
    percent_change_since_earliest: num(row.percent_change_since_earliest),
    facts_credit: str(row.facts_credit) ?? "",
    facts_source_url: str(row.facts_source_url),
    geometry_credit: str(row.geometry_credit) ?? "",
    geometry_license: str(row.geometry_license) ?? "",
    outline_source_url: str(row.outline_source_url),
    outline_mapped_at: str(row.outline_mapped_at),
    outline: parseOutline(row.outline),
    report: parseReport(row.report),
    mountain_context: parseContext(row.mountain_context),
    boundary: parseBoundary(row.boundary, ["MultiPolygon"] as const),
    updated_at: iso(row.updated_at),
  };
}

export function parseGlacierSummaryRow(row: any): GlacierSummary {
  return {
    id: String(row.id),
    name: str(row.name) ?? "Unnamed glacier",
    kind: parseKind(row.kind),
    area_km2: num(row.area_km2),
    head_elevation_m: num(row.head_elevation_m),
    terminus_elevation_m: num(row.terminus_elevation_m),
    length_km: num(row.length_km),
    flow_direction_label: str(row.flow_direction_label),
    rank_on_mountain: num(row.rank_on_mountain),
    percent_change_since_earliest: num(row.percent_change_since_earliest),
    area_history_scope: str(row.area_history_scope),
    inventory_name: str(row.inventory_name),
    history_start_year: num(row.history_start_year),
    observed_year: num(row.observed_year),
    geometry_credit: str(row.geometry_credit),
    geometry_license: str(row.geometry_license),
    geometry_license_url: str(row.geometry_license_url),
    lat: num(row.lat),
    lng: num(row.lng),
    boundary: parseBoundary(row.boundary, ["Polygon", "MultiPolygon"] as const),
    updated_at: iso(row.updated_at),
  };
}

export function parseGlacierRouteRow(row: any): GlacierRouteCrossing {
  return {
    id: String(row.id),
    name: str(row.name),
    distance: num(row.distance),
    gain: num(row.gain),
    pass_count: num(row.pass_count) ?? 1,
    on_ice_m: num(row.on_ice_m),
    min_elevation_m: num(row.min_elevation_m),
    max_elevation_m: num(row.max_elevation_m),
  };
}

/** Parses mountain rows and gives each a stable URL slug. Two mountains
 * that slug alike keep the bare slug for the first by glacier area and
 * suffix the rest with their id, so no hub URL ever points at two places. */
export function parseGlacierMountainRows(rows: any[]): GlacierMountain[] {
  const taken = new Set<string>();
  return rows.map((row) => {
    const name = str(row.name) ?? "Unnamed mountain";
    const base = slugify(name) || "mountain";
    const slug = taken.has(base) ? `${base}-${slugify(String(row.id))}` : base;
    taken.add(slug);
    return {
      id: String(row.id),
      name,
      slug,
      elevation: num(row.elevation),
      state_code: str(row.state_code),
      country_code: str(row.country_code),
      lat: num(row.lat),
      lng: num(row.lng),
      hero_image: str(row.hero_image),
      hero_image_attribution: str(row.hero_image_attribution),
      hero_image_attribution_url: str(row.hero_image_attribution_url),
      glacier_count: num(row.glacier_count) ?? 0,
      snowfield_count: num(row.snowfield_count) ?? 0,
      mapped_area_km2: num(row.mapped_area_km2),
      context: parseContext(row.context),
      facts_credit: str(row.facts_credit),
      facts_source_url: str(row.facts_source_url),
      updated_at: iso(row.updated_at),
    };
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function glacierMountainPath(mountain: Pick<GlacierMountain, "slug">): string {
  return `/glaciers/${mountain.slug}`;
}

// ── Units and wording ────────────────────────────────────────────────────

function fixed(value: number, digits: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function whole(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function km2ToMi2(km2: number): number {
  return km2 / KM2_PER_MI2;
}

/** "4.23 mi²" / "10.96 km²", with "± …" when an uncertainty is given. */
export function formatAreaMi2(km2: number, uncertaintyKm2?: number | null): string {
  const error = uncertaintyKm2 != null ? ` ± ${fixed(km2ToMi2(uncertaintyKm2), 2)}` : "";
  return `${fixed(km2ToMi2(km2), 2)}${error} mi²`;
}

export function formatAreaKm2(km2: number, uncertaintyKm2?: number | null): string {
  const error = uncertaintyKm2 != null ? ` ± ${fixed(uncertaintyKm2, 2)}` : "";
  return `${fixed(km2, 2)}${error} km²`;
}

export function formatVolumeMi3(km3: number, uncertaintyKm3?: number | null): string {
  const error = uncertaintyKm3 != null ? ` ± ${fixed(uncertaintyKm3 / KM3_PER_MI3, 3)}` : "";
  return `${fixed(km3 / KM3_PER_MI3, 3)}${error} mi³`;
}

export function formatVolumeKm3(km3: number, uncertaintyKm3?: number | null): string {
  const error = uncertaintyKm3 != null ? ` ± ${fixed(uncertaintyKm3, 3)}` : "";
  return `${fixed(km3, 3)}${error} km³`;
}

export function feetValue(meters: number): string {
  return whole(meters * FEET_PER_METER);
}

export function formatFeetAndMeters(meters: number): string {
  return `${feetValue(meters)} ft (${whole(meters)} m)`;
}

export function formatLengthMiles(km: number): string {
  return `${fixed(km / KM_PER_MI, 1)} mi`;
}

export function formatLengthKm(km: number): string {
  return `${fixed(km, km < 10 ? 2 : 1)} km`;
}

/** "−37%" with a true minus; "+4%" for growth; "0%" without a sign. */
export function formatPercentChange(percent: number): string {
  const value = whole(Math.abs(percent));
  if (value === "0") return "0%";
  return `${percent < 0 ? "−" : "+"}${value}%`;
}

const COMPASS_POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const COMPASS_WORDS: Record<string, string> = { N: "north", E: "east", S: "south", W: "west" };

export function compassLabel(degrees: number): string {
  const normalized = ((degrees % 360) + 360) % 360;
  return COMPASS_POINTS[Math.round(normalized / 22.5) % 16];
}

/** "NE" → "Northeast", "SSW" → "South-southwest". Null for anything that
 * isn't a 16-point compass label. */
export function directionName(label: string | null | undefined): string | null {
  const code = label?.trim().toUpperCase();
  if (!code || !COMPASS_POINTS.includes(code)) return null;
  const word = (part: string) => [...part].map((c) => COMPASS_WORDS[c]).join("");
  const name = code.length === 3 ? `${COMPASS_WORDS[code[0]]}-${word(code.slice(1))}` : word(code);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function flowDirectionName(facts: Pick<GlacierFacts, "flow_direction_label" | "flow_direction_deg">): string | null {
  return (
    directionName(facts.flow_direction_label) ??
    (facts.flow_direction_deg != null ? directionName(compassLabel(facts.flow_direction_deg)) : null)
  );
}

/** Where the ice begins, from the NPS type code; the saved label otherwise. */
export function glacierHeadLabel(facts: Pick<GlacierFacts, "type_code" | "type_label">): string | null {
  switch (facts.type_code?.toUpperCase()) {
    case "S":
      return "Near summit";
    case "C":
      return "Below summit";
    default:
      return facts.type_label;
  }
}

export function kindWord(kind: GlacierKind): "Glacier" | "Snowfield" {
  return kind === "snowfield" ? "Snowfield" : "Glacier";
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  const suffix = rem100 >= 11 && rem100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

function listWords(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

/** Names inside a combined history scope ("Cowlitz-Ingraham"); one name for
 * a glacier measured on its own. */
export function historyScopeNames(scope: string | null | undefined): string[] {
  return (scope ?? "")
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isCombinedHistory(facts: Pick<GlacierFacts, "area_history_scope">): boolean {
  return historyScopeNames(facts.area_history_scope).length > 1;
}

/** "Cowlitz and Ingraham are measured together" — null when the history is
 * this glacier's own. */
export function historyScopeNote(facts: Pick<GlacierFacts, "area_history_scope">): string | null {
  const names = historyScopeNames(facts.area_history_scope);
  return names.length > 1 ? `${listWords(names)} are measured together` : null;
}

export function measuredHistory(history: GlacierAreaPoint[]): Array<GlacierAreaPoint & { area_km2: number }> {
  return history.filter((point): point is GlacierAreaPoint & { area_km2: number } => point.area_km2 != null);
}

export interface GlacierAreaChange {
  percent: number;
  fromYear: number;
  toYear: number;
  fromKm2: number;
  toKm2: number;
}

/** Change across the published history, from its first measured year. The
 * stored percentage is authoritative; the endpoints are for wording. */
export function glacierAreaChange(facts: Pick<GlacierFacts, "area_history" | "percent_change_since_earliest">): GlacierAreaChange | null {
  const points = measuredHistory(facts.area_history);
  if (points.length < 2 || facts.percent_change_since_earliest == null) return null;
  const first = points[0];
  const last = points[points.length - 1];
  return {
    percent: facts.percent_change_since_earliest,
    fromYear: first.year,
    toYear: last.year,
    fromKm2: first.area_km2,
    toKm2: last.area_km2,
  };
}

export interface GlacierFactRow {
  key: string;
  label: string;
  value: string;
  detail?: string;
}

/** The definition list under the topline. Every row is a measured value;
 * a null fact is left out, never shown as a dash. */
export function glacierFactRows(facts: GlacierFacts): GlacierFactRow[] {
  const rows: Array<GlacierFactRow | null> = [
    facts.area_km2 != null
      ? {
          key: "area",
          label: facts.observed_year ? `Area (${facts.observed_year})` : "Area",
          value: formatAreaMi2(facts.area_km2, facts.area_uncertainty_km2),
          detail: formatAreaKm2(facts.area_km2, facts.area_uncertainty_km2),
        }
      : null,
    facts.head_elevation_m != null
      ? { key: "head", label: "Top elevation", value: `${feetValue(facts.head_elevation_m)} ft`, detail: `${whole(facts.head_elevation_m)} m` }
      : null,
    facts.terminus_elevation_m != null
      ? { key: "terminus", label: "Terminus elevation", value: `${feetValue(facts.terminus_elevation_m)} ft`, detail: `${whole(facts.terminus_elevation_m)} m` }
      : null,
    facts.elevation_range_m != null
      ? { key: "range", label: "Vertical span", value: `${feetValue(facts.elevation_range_m)} ft`, detail: `${whole(facts.elevation_range_m)} m` }
      : null,
    facts.length_km != null
      ? { key: "length", label: "Length", value: formatLengthMiles(facts.length_km), detail: formatLengthKm(facts.length_km) }
      : null,
    facts.average_slope_deg != null
      ? { key: "slope", label: "Average slope", value: `${whole(facts.average_slope_deg)}°` }
      : null,
    flowDirectionName(facts)
      ? {
          key: "flow",
          label: "Flows toward",
          value: flowDirectionName(facts)!,
          detail: facts.flow_direction_deg != null ? `${whole(facts.flow_direction_deg)}° from north` : undefined,
        }
      : null,
    glacierHeadLabel(facts) ? { key: "begins", label: "Begins", value: glacierHeadLabel(facts)! } : null,
    facts.estimated_volume_km3 != null
      ? {
          key: "volume",
          label: "Est. ice volume",
          value: formatVolumeMi3(facts.estimated_volume_km3, facts.volume_uncertainty_km3),
          detail: `${formatVolumeKm3(facts.estimated_volume_km3, facts.volume_uncertainty_km3)} · statistical estimate`,
        }
      : null,
    facts.rank_on_mountain != null
      ? {
          key: "rank",
          label: "Size rank",
          value: facts.mountain_context?.named_glacier_count
            ? `#${facts.rank_on_mountain} of ${facts.mountain_context.named_glacier_count}`
            : `#${facts.rank_on_mountain}`,
          detail: `on ${facts.parent.name}`,
        }
      : null,
    facts.inventory_name && facts.inventory_name !== facts.name && !facts.name.startsWith(`${facts.inventory_name} `)
      ? { key: "inventory", label: "Inventory name", value: facts.inventory_name }
      : null,
  ];
  return rows.filter((row): row is GlacierFactRow => row !== null);
}

// ── SEO copy ─────────────────────────────────────────────────────────────

export function glacierPageTitle(facts: Pick<GlacierFacts, "name" | "kind" | "parent" | "area_history">): string {
  const hasHistory = measuredHistory(facts.area_history).length >= 2;
  const about = hasHistory ? "size, retreat & map" : "facts & map";
  return `${facts.name}, ${facts.parent.name}: ${about}`;
}

/** One meta-description sentence set, kept near 160 characters by dropping
 * the least useful clause first. */
export function describeGlacier(facts: GlacierFacts, region: string | null): string {
  const where = region ? `${facts.parent.name}, ${region}` : facts.parent.name;
  const kind = facts.kind === "snowfield" ? "snowfield" : "glacier";
  const size =
    facts.area_km2 != null
      ? `${formatAreaMi2(facts.area_km2)} (${formatAreaKm2(facts.area_km2)})${facts.observed_year ? ` in ${facts.observed_year}` : ""}`
      : null;
  const span =
    facts.head_elevation_m != null && facts.terminus_elevation_m != null
      ? `from ${feetValue(facts.head_elevation_m)} to ${feetValue(facts.terminus_elevation_m)} ft`
      : null;
  const change = glacierAreaChange(facts);
  const changeText = change
    ? `${isCombinedHistory(facts) ? `${listWords(historyScopeNames(facts.area_history_scope))} together` : "Area"} ${
        change.percent < 0 ? "down" : "up"
      } ${whole(Math.abs(change.percent))}% since ${change.fromYear}.`
    : null;

  const lead = [`${facts.name} is a ${kind} on ${where}`, [size, span].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(": ");
  const candidates = [
    [`${lead}.`, changeText, "Outline map, facts, history, and routes."],
    [`${lead}.`, changeText, "Map and routes on Peaks."],
    [`${lead}.`, changeText],
    [`${lead}.`],
  ];
  for (const parts of candidates) {
    const text = parts.filter(Boolean).join(" ");
    if (text.length <= 165) return text;
  }
  return `${facts.name} is a ${kind} on ${where}.`;
}

/** The page's lead paragraph when no credited description exists. Written
 * only from measured facts — no claim the data doesn't carry. */
export function glacierLeadParagraph(facts: GlacierFacts, region: string | null): string {
  const kind = facts.kind === "snowfield" ? "snowfield" : "glacier";
  const where = region ? `${facts.parent.name} in ${region}` : facts.parent.name;
  const sentences: string[] = [`${facts.name} is a ${kind} on ${where}.`];
  const flow = flowDirectionName(facts)?.toLowerCase();
  if (facts.head_elevation_m != null && facts.terminus_elevation_m != null) {
    sentences.push(
      `Its ice runs from ${formatFeetAndMeters(facts.head_elevation_m)} down to a terminus at ${formatFeetAndMeters(facts.terminus_elevation_m)}${
        flow ? `, flowing ${flow}` : ""
      }${facts.length_km != null ? ` over ${formatLengthMiles(facts.length_km)}` : ""}.`
    );
  }
  if (facts.area_km2 != null) {
    const rank =
      facts.rank_on_mountain != null && facts.mountain_context?.named_glacier_count
        ? `, ${facts.rank_on_mountain === 1 ? "the largest" : `the ${ordinal(facts.rank_on_mountain)} largest`} of ${facts.parent.name}’s ${facts.mountain_context.named_glacier_count} named glaciers`
        : "";
    sentences.push(
      `It covered ${formatAreaMi2(facts.area_km2)} (${formatAreaKm2(facts.area_km2)})${facts.observed_year ? ` in ${facts.observed_year}` : ""}${rank}.`
    );
  }
  return sentences.join(" ");
}

export interface GlacierFaq {
  question: string;
  answer: string;
}

export function glacierFaqs(
  facts: GlacierFacts,
  region: string | null,
  routes: GlacierRouteCrossing[]
): GlacierFaq[] {
  const faqs: GlacierFaq[] = [];
  const name = facts.name;
  const kind = facts.kind === "snowfield" ? "snowfield" : "glacier";

  faqs.push({
    question: `Where is ${name}?`,
    answer: `${name} is a ${kind} on ${facts.parent.name}${region ? ` in ${region}` : ""}.${
      flowDirectionName(facts) ? ` Its ice flows toward the ${flowDirectionName(facts)!.toLowerCase()}.` : ""
    }`,
  });

  if (facts.area_km2 != null) {
    const count = facts.mountain_context?.named_glacier_count;
    const rank =
      facts.rank_on_mountain != null && count
        ? ` That makes it ${facts.rank_on_mountain === 1 ? "the largest" : `the ${ordinal(facts.rank_on_mountain)} largest`} of the ${count} named glaciers on ${facts.parent.name}.`
        : "";
    faqs.push({
      question: `How big is ${name}?`,
      answer: `${name} covered ${formatAreaMi2(facts.area_km2, facts.area_uncertainty_km2)} (${formatAreaKm2(facts.area_km2, facts.area_uncertainty_km2)})${
        facts.observed_year ? ` in ${facts.observed_year}` : ""
      }.${rank}`,
    });
  }

  const change = glacierAreaChange(facts);
  if (change) {
    const combined = isCombinedHistory(facts);
    const subject = combined ? `${listWords(historyScopeNames(facts.area_history_scope))}, measured together,` : name;
    const verb = change.percent < 0 ? "shrank" : change.percent > 0 ? "grew" : "held steady";
    faqs.push({
      question: `How much has ${name} ${change.percent <= 0 ? "shrunk" : "changed"}?`,
      answer: `Between ${change.fromYear} and ${change.toYear}, ${subject} ${verb}${
        change.percent !== 0 ? ` by ${whole(Math.abs(change.percent))}%` : ""
      }, from ${formatAreaMi2(change.fromKm2)} (${formatAreaKm2(change.fromKm2)}) to ${formatAreaMi2(change.toKm2)} (${formatAreaKm2(change.toKm2)}).${
        combined ? ` The published survey history does not separate ${name} from the others.` : ""
      }`,
    });
  }

  if (facts.head_elevation_m != null || facts.terminus_elevation_m != null) {
    const parts = [
      facts.head_elevation_m != null
        ? `begins ${glacierHeadLabel(facts) === "Near summit" ? "near the summit " : ""}at ${formatFeetAndMeters(facts.head_elevation_m)}`
        : null,
      facts.terminus_elevation_m != null ? `ends at a terminus of ${formatFeetAndMeters(facts.terminus_elevation_m)}` : null,
    ].filter(Boolean);
    const extra = [
      facts.elevation_range_m != null ? `a vertical span of ${feetValue(facts.elevation_range_m)} ft` : null,
      facts.length_km != null ? `a length of ${formatLengthMiles(facts.length_km)} (${formatLengthKm(facts.length_km)})` : null,
      facts.average_slope_deg != null ? `an average slope of ${whole(facts.average_slope_deg)}°` : null,
    ].filter(Boolean) as string[];
    faqs.push({
      question: `How high is ${name}?`,
      answer: `${name} ${parts.join(" and ")}.${extra.length ? ` It has ${listWords(extra)}.` : ""}`,
    });
  }

  if (facts.estimated_volume_km3 != null) {
    faqs.push({
      question: `How much ice is in ${name}?`,
      answer: `About ${formatVolumeMi3(facts.estimated_volume_km3)} (${formatVolumeKm3(facts.estimated_volume_km3)}) of ice${
        facts.observed_year ? ` as of ${facts.observed_year}` : ""
      }. This is a statistical estimate from the glacier’s area, not a direct thickness survey.`,
    });
  }

  if (routes.length > 0) {
    const names = routes.slice(0, 5).map((route) => route.name || "an unnamed route");
    faqs.push({
      question: `Which routes cross ${name}?`,
      answer: `${routes.length === 1 ? "One Peaks route crosses" : `${routes.length} Peaks routes cross`} ${name}: ${listWords(names)}${
        routes.length > names.length ? `, and ${routes.length - names.length} more` : ""
      }. Glacier travel requires crevasse-rescue skills, a rope team, and current conditions.`,
    });
  }

  return faqs;
}

// ── JSON-LD ──────────────────────────────────────────────────────────────

type JsonLd = Record<string, unknown>;

function property(name: string, value: number | null, unitCode: string, unitText: string): JsonLd | null {
  return value != null && Number.isFinite(value)
    ? { "@type": "PropertyValue", name, value: Number(value.toFixed(6)), unitCode, unitText }
    : null;
}

/** schema.org has no Glacier type; a Landform typed by Wikidata's glacier
 * item is the closest honest description. */
export function buildGlacierJsonLd(input: {
  facts: GlacierFacts;
  url: string;
  parentUrl: string;
  description: string;
  latitude: number | null;
  longitude: number | null;
  image?: string | null;
}): JsonLd {
  const { facts } = input;
  const additionalProperty = [
    property(`Area${facts.observed_year ? ` (${facts.observed_year})` : ""}`, facts.area_km2, "KMK", "km²"),
    property("Top elevation", facts.head_elevation_m, "MTR", "m"),
    property("Terminus elevation", facts.terminus_elevation_m, "MTR", "m"),
    property("Length", facts.length_km, "KMT", "km"),
    property("Average slope", facts.average_slope_deg, "DD", "°"),
    property("Flow direction", facts.flow_direction_deg, "DD", "° from north"),
    property("Estimated ice volume", facts.estimated_volume_km3, "C21", "km³"),
    property(
      glacierAreaChange(facts) ? `Area change since ${glacierAreaChange(facts)!.fromYear}` : "Area change",
      facts.percent_change_since_earliest,
      "P1",
      "%"
    ),
  ].filter(Boolean);
  const citation = facts.report?.url ?? facts.facts_source_url;

  return {
    "@context": "https://schema.org",
    "@type": "Landform",
    ...(facts.kind === "glacier" ? { additionalType: GLACIER_WIKIDATA_URL } : {}),
    name: facts.name,
    ...(facts.inventory_name && facts.inventory_name !== facts.name ? { alternateName: facts.inventory_name } : {}),
    description: input.description,
    url: input.url,
    ...(input.image ? { image: input.image } : {}),
    ...(input.latitude != null && input.longitude != null
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: input.latitude,
            longitude: input.longitude,
            ...(facts.head_elevation_m != null ? { elevation: facts.head_elevation_m } : {}),
          },
        }
      : {}),
    containedInPlace: { "@type": "Mountain", name: facts.parent.name, url: input.parentUrl },
    ...(additionalProperty.length ? { additionalProperty } : {}),
    ...(citation ? { citation } : {}),
  };
}

export function buildBreadcrumbJsonLd(items: Array<{ name: string; url: string }>): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

// ── Mountain roster copy ─────────────────────────────────────────────────

export function mountainGlacierTitle(mountain: Pick<GlacierMountain, "name">): string {
  return `${mountain.name} glaciers: map, sizes & retreat`;
}

export function describeGlacierMountain(mountain: GlacierMountain, region: string | null): string {
  const count = mountain.glacier_count;
  const lead = `All ${count} mapped ${count === 1 ? "glacier" : "glaciers"} on ${mountain.name}${region ? `, ${region}` : ""}`;
  const context = mountain.context;
  const loss =
    context?.percent_change_since_history_start != null && context.history_start_year != null
      ? ` Total ice area ${context.percent_change_since_history_start < 0 ? "down" : "up"} ${whole(
          Math.abs(context.percent_change_since_history_start)
        )}% since ${context.history_start_year}.`
      : "";
  const text = `${lead}, ranked by size with outline map, elevations, and survey history.${loss}`;
  return text.length <= 165 ? text : `${lead}, with outline map and survey history.${loss}`;
}

export function glacierMountainFaqs(mountain: GlacierMountain, glaciers: GlacierSummary[], region: string | null): GlacierFaq[] {
  const faqs: GlacierFaq[] = [];
  const context = mountain.context;
  const iceOnly = glaciers.filter((g) => g.kind === "glacier");
  const named = context?.named_glacier_count;

  faqs.push({
    question: `How many glaciers are on ${mountain.name}?`,
    answer: named
      ? `The glacier inventory counts ${named} named glaciers on ${mountain.name}${context?.observed_year ? ` as of ${context.observed_year}` : ""}. Peaks maps the outlines of ${iceOnly.length} named ${iceOnly.length === 1 ? "glacier" : "glaciers"} there${
          mountain.snowfield_count ? `, plus ${mountain.snowfield_count} permanent ${mountain.snowfield_count === 1 ? "snowfield" : "snowfields"}` : ""
        }.`
      : `Peaks maps ${iceOnly.length} named ${iceOnly.length === 1 ? "glacier" : "glaciers"} on ${mountain.name}${region ? ` in ${region}` : ""}.`,
  });

  const largest = iceOnly.find((g) => g.area_km2 != null);
  if (largest?.area_km2 != null) {
    faqs.push({
      question: `What is the largest glacier on ${mountain.name}?`,
      answer: `${largest.name} is the largest, at ${formatAreaMi2(largest.area_km2)} (${formatAreaKm2(largest.area_km2)})${
        largest.observed_year ? ` in ${largest.observed_year}` : ""
      }.`,
    });
  }

  if (context?.area_km2 != null) {
    faqs.push({
      question: `How much glacier ice covers ${mountain.name}?`,
      answer: `Its glaciers covered ${formatAreaMi2(context.area_km2, context.area_uncertainty_km2)} (${formatAreaKm2(
        context.area_km2,
        context.area_uncertainty_km2
      )})${context.observed_year ? ` in ${context.observed_year}` : ""}.`,
    });
  }

  if (context?.percent_change_since_history_start != null && context.history_start_year != null) {
    const pct = whole(Math.abs(context.percent_change_since_history_start));
    faqs.push({
      question: `Are ${mountain.name}’s glaciers shrinking?`,
      answer:
        context.percent_change_since_history_start < 0
          ? `Yes. Total glacier area on ${mountain.name} fell ${pct}% between ${context.history_start_year} and ${context.observed_year ?? "the latest survey"}. Each glacier page shows its own survey history.`
          : `Total glacier area on ${mountain.name} changed by ${pct}% between ${context.history_start_year} and ${context.observed_year ?? "the latest survey"}.`,
    });
  }

  return faqs;
}

/** Distinct outline credits across a roster, most-used first, for the
 * mountain map's attribution and sources line. */
export function rosterOutlineCredits(glaciers: GlacierSummary[]): Array<{ credit: string; license: string | null; licenseUrl: string | null; count: number }> {
  const byCredit = new Map<string, { credit: string; license: string | null; licenseUrl: string | null; count: number }>();
  for (const glacier of glaciers) {
    if (!glacier.geometry_credit) continue;
    const key = `${glacier.geometry_credit}|${glacier.geometry_license ?? ""}`;
    const entry = byCredit.get(key) ?? {
      credit: glacier.geometry_credit,
      license: glacier.geometry_license,
      licenseUrl: glacier.geometry_license_url,
      count: 0,
    };
    entry.count += 1;
    byCredit.set(key, entry);
  }
  return [...byCredit.values()].sort((a, b) => b.count - a.count || a.credit.localeCompare(b.credit));
}
