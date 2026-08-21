"use server";

import type { QueryResultRow } from "pg";
import db from "../db";
import { verifyToken } from "../auth-actions";
import { normalizeSearchName } from "../search-utils";
import {
  normalizeAreaKind,
  parseAreaBoundary,
  type AreaBoundingBox,
  type AreaBoundary,
  type AreaKind,
  type ProtectedArea,
} from "../area-types";
import {
  parseRouteProvenance,
  type RouteProvenance,
} from "../route-provenance";
import type { SessionActivityType } from "./sessions";
import {
  buildNationalParkIndex,
  officialNationalParkSearchNames,
  type NationalParkAreaCandidate,
} from "../national-park-index";

export interface AreaSummary extends ProtectedArea {
  owner: string | null;
  country_code: string;
  state_codes: string[];
  source: string;
  source_version: string;
  description: string;
  description_source_name: string | null;
  description_source_url: string | null;
  description_source_license: string | null;
  parent_name: string | null;
  parent_kind: ReturnType<typeof normalizeAreaKind> | null;
  lat: number;
  lng: number;
  bbox: AreaBoundingBox;
  destination_count: number;
  route_count: number;
}

export interface AreaDestination {
  id: string;
  name: string | null;
  elevation: number | null;
  prominence: number | null;
  type: string;
  activities: string[];
  features: string[];
  country_code: string | null;
  state_code: string | null;
  lat: number | null;
  lng: number | null;
}

export interface AreaRoute {
  id: string;
  name: string | null;
  polyline6: string | null;
  distance: number | null;
  gain: number | null;
  completion: string;
  shape: string | null;
  destination_count: number;
  session_count: number;
  provenance: RouteProvenance | null;
}

export interface AreaDetail extends AreaSummary {
  boundary: AreaBoundary | null;
  destinations: AreaDestination[];
  routes: AreaRoute[];
}

export interface AreaPersonalSession {
  id: string;
  name: string | null;
  destinationNames: string[];
  start_time: string;
  end_time: string | null;
  distance: number | null;
  total_time: number | null;
  pace: number | null;
  gain: number | null;
  highest_point: number | null;
  ended: boolean;
  activity_type: SessionActivityType | null;
}

export interface AreaPersonalActivity {
  visit_count: number;
  total_distance: number;
  total_gain: number;
  total_time: number;
  latest_visit: string | null;
  sessions: AreaPersonalSession[];
}

interface RawAreaRow extends QueryResultRow {
  id: unknown;
  name: unknown;
  kind: unknown;
  designation: unknown;
  manager: unknown;
  owner: unknown;
  country_code: unknown;
  state_codes: unknown;
  source: unknown;
  source_version: unknown;
  description: unknown;
  description_source_name: unknown;
  description_source_url: unknown;
  description_source_license: unknown;
  parent_id: unknown;
  parent_name: unknown;
  parent_kind: unknown;
  lat: unknown;
  lng: unknown;
  bbox_min_lat: unknown;
  bbox_max_lat: unknown;
  bbox_min_lng: unknown;
  bbox_max_lng: unknown;
  destination_count: unknown;
  route_count: unknown;
  boundary: unknown;
}

interface RawDestinationRow extends QueryResultRow {
  id: unknown;
  name: unknown;
  elevation: unknown;
  prominence: unknown;
  type: unknown;
  activities: unknown;
  features: unknown;
  country_code: unknown;
  state_code: unknown;
  lat: unknown;
  lng: unknown;
}

interface RawRouteRow extends QueryResultRow {
  id: unknown;
  name: unknown;
  polyline6: unknown;
  distance: unknown;
  gain: unknown;
  completion: unknown;
  shape: unknown;
  destination_count: unknown;
  session_count: unknown;
  provenance: unknown;
}

interface RawPersonalSessionRow extends QueryResultRow {
  id: unknown;
  name: unknown;
  destination_names: unknown;
  start_time: unknown;
  end_time: unknown;
  distance: unknown;
  total_time: unknown;
  pace: unknown;
  gain: unknown;
  highest_point: unknown;
  ended: unknown;
  activity_type: unknown;
  visit_count: unknown;
  total_distance: unknown;
  total_gain: unknown;
  aggregate_time: unknown;
  latest_visit: unknown;
}

const AREA_BASE_SELECT = `
  SELECT a.id, a.name, a.kind, a.designation, a.manager, a.owner,
         a.country_code, a.state_codes, a.source, a.source_version,
         NULLIF(to_jsonb(a)->>'description', '') AS description,
         NULLIF(to_jsonb(a)->>'description_source_name', '') AS description_source_name,
         NULLIF(to_jsonb(a)->>'description_source_url', '') AS description_source_url,
         NULLIF(to_jsonb(a)->>'description_source_license', '') AS description_source_license,
         NULLIF(to_jsonb(a)->>'parent_area_id', '') AS parent_id,
         parent.name AS parent_name,
         parent.kind AS parent_kind,
         ST_Y(a.centroid) AS lat,
         ST_X(a.centroid) AS lng,
         a.bbox_min_lat, a.bbox_max_lat, a.bbox_min_lng, a.bbox_max_lng,
         (
           SELECT count(DISTINCT da.destination_id)::int
           FROM destination_areas da
           JOIN destinations d ON d.id = da.destination_id
           WHERE da.area_id = a.id AND d.owner = 'peaks'
         ) AS destination_count,
         (
           SELECT count(DISTINCT ra.route_id)::int
           FROM route_areas ra
           JOIN routes r ON r.id = ra.route_id
           WHERE ra.area_id = a.id
             AND r.owner = 'peaks'
             AND r.status = 'active'
         ) AS route_count`;

async function loadAreaBase(
  id: string,
  includeBoundary: boolean
): Promise<(AreaSummary & { boundary: AreaBoundary | null }) | null> {
  const boundarySelect = includeBoundary
    ? `ST_AsGeoJSON(
         COALESCE(
           a.boundary_display,
           ST_SimplifyPreserveTopology(
             a.boundary,
             GREATEST(
               0.00005,
               LEAST(
                 0.02,
                 GREATEST(
                   a.bbox_max_lat - a.bbox_min_lat,
                   a.bbox_max_lng - a.bbox_min_lng
                 ) / 1500.0
               )
             )
           )
         ),
         6
       )::json AS boundary`
    : "NULL::json AS boundary";

  const result = await db.query<RawAreaRow>(
    `${AREA_BASE_SELECT},
            ${boundarySelect}
     FROM areas a
     LEFT JOIN areas parent
       ON parent.id = NULLIF(to_jsonb(a)->>'parent_area_id', '')
     WHERE a.id = $1`,
    [id]
  );

  const row = result.rows[0];
  if (!row) return null;

  const name = textValue(row.name) ?? "Protected area";
  const kind = normalizeAreaKind(row.kind);
  const stateCodes = stringArray(row.state_codes);
  const description =
    textValue(row.description) ??
    buildGenericDescription(name, kind);

  return {
    id: textValue(row.id) ?? id,
    name,
    kind,
    designation: textValue(row.designation),
    manager: textValue(row.manager),
    parent_id: textValue(row.parent_id),
    parent_name: textValue(row.parent_name),
    parent_kind: row.parent_kind == null ? null : normalizeAreaKind(row.parent_kind),
    owner: textValue(row.owner),
    country_code: textValue(row.country_code) ?? "US",
    state_codes: stateCodes,
    source: textValue(row.source) ?? "padus",
    source_version: textValue(row.source_version) ?? "",
    description,
    description_source_name: textValue(row.description_source_name),
    description_source_url: httpUrl(row.description_source_url),
    description_source_license: textValue(row.description_source_license),
    lat: numberValue(row.lat) ?? 0,
    lng: numberValue(row.lng) ?? 0,
    bbox: {
      minLat: numberValue(row.bbox_min_lat) ?? 0,
      maxLat: numberValue(row.bbox_max_lat) ?? 0,
      minLng: numberValue(row.bbox_min_lng) ?? 0,
      maxLng: numberValue(row.bbox_max_lng) ?? 0,
    },
    destination_count: integerValue(row.destination_count),
    route_count: integerValue(row.route_count),
    boundary: parseAreaBoundary(row.boundary),
  };
}

export async function getAreaSummary(id: string): Promise<AreaSummary | null> {
  const area = await loadAreaBase(id, false);
  if (!area) return null;
  const { boundary, ...summary } = area;
  void boundary;
  return summary;
}

export async function getArea(id: string): Promise<AreaDetail | null> {
  const area = await loadAreaBase(id, true);
  if (!area) return null;

  const [destinationResult, routeResult] = await Promise.all([
    db.query<RawDestinationRow>(
      `SELECT d.id, d.name, d.elevation, d.prominence, d.type,
              d.activities, d.features, d.country_code, d.state_code,
              ST_Y(d.location::geometry) AS lat,
              ST_X(d.location::geometry) AS lng
       FROM destination_areas da
       JOIN destinations d ON d.id = da.destination_id
       WHERE da.area_id = $1 AND d.owner = 'peaks'
       ORDER BY d.prominence DESC NULLS LAST,
                d.elevation DESC NULLS LAST,
                d.name ASC NULLS LAST
       LIMIT 30`,
      [id]
    ),
    db.query<RawRouteRow>(
      `SELECT r.id, r.name, r.polyline6, r.distance, r.gain,
              r.completion, r.shape, r.provenance,
              (
                SELECT count(*)::int
                FROM route_destinations rd
                WHERE rd.route_id = r.id
              ) AS destination_count,
              (
                SELECT count(*)::int
                FROM session_routes sr
                WHERE sr.route_id = r.id
              ) AS session_count
       FROM route_areas ra
       JOIN routes r ON r.id = ra.route_id
       WHERE ra.area_id = $1
         AND r.owner = 'peaks'
         AND r.status = 'active'
       ORDER BY r.gain DESC NULLS LAST,
                r.distance DESC NULLS LAST,
                r.name ASC NULLS LAST
       LIMIT 15`,
      [id]
    ),
  ]);

  return {
    ...area,
    destinations: destinationResult.rows.map(mapDestination),
    routes: routeResult.rows.map(mapRoute),
  };
}

export async function getAreaPersonalActivity(
  token: string,
  areaId: string,
  recentLimit: number = 5
): Promise<AreaPersonalActivity> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");

  const safeLimit = Math.min(Math.max(Math.trunc(recentLimit), 1), 20);
  const result = await db.query<RawPersonalSessionRow>(
    `WITH area_sessions AS MATERIALIZED (
       SELECT s.*
       FROM session_areas sa
       JOIN tracking_sessions s ON s.id = sa.session_id
       WHERE sa.area_id = $1 AND s.user_id = $2
     )
     SELECT s.id, s.name, s.start_time, s.end_time, s.distance,
            s.total_time, s.pace, s.gain, s.highest_point, s.ended,
            s.activity_type,
            ARRAY(
              SELECT d.name
              FROM session_destinations sd
              JOIN destinations d ON d.id = sd.destination_id
              WHERE sd.session_id = s.id
                AND sd.relation = 'reached'
                AND d.name IS NOT NULL
              ORDER BY d.elevation DESC NULLS LAST, d.name
            ) AS destination_names,
            count(*) OVER ()::int AS visit_count,
            COALESCE(sum(s.distance) OVER (), 0) AS total_distance,
            COALESCE(sum(s.gain) OVER (), 0) AS total_gain,
            COALESCE(sum(s.total_time) OVER (), 0) AS aggregate_time,
            max(s.start_time) OVER () AS latest_visit
     FROM area_sessions s
     ORDER BY s.start_time DESC, s.id
     LIMIT $3`,
    [areaId, user.uid, safeLimit]
  );

  const first = result.rows[0];
  if (!first) {
    return {
      visit_count: 0,
      total_distance: 0,
      total_gain: 0,
      total_time: 0,
      latest_visit: null,
      sessions: [],
    };
  }

  return {
    visit_count: integerValue(first.visit_count),
    total_distance: numberValue(first.total_distance) ?? 0,
    total_gain: numberValue(first.total_gain) ?? 0,
    total_time: integerValue(first.aggregate_time),
    latest_visit: isoValue(first.latest_visit),
    sessions: result.rows.map(mapPersonalSession),
  };
}

function mapDestination(row: RawDestinationRow): AreaDestination {
  return {
    id: textValue(row.id) ?? "",
    name: textValue(row.name),
    elevation: numberValue(row.elevation),
    prominence: numberValue(row.prominence),
    type: textValue(row.type) ?? "other",
    activities: stringArray(row.activities),
    features: stringArray(row.features),
    country_code: textValue(row.country_code),
    state_code: textValue(row.state_code),
    lat: numberValue(row.lat),
    lng: numberValue(row.lng),
  };
}

function mapRoute(row: RawRouteRow): AreaRoute {
  return {
    id: textValue(row.id) ?? "",
    name: textValue(row.name),
    polyline6: textValue(row.polyline6),
    distance: numberValue(row.distance),
    gain: numberValue(row.gain),
    completion: textValue(row.completion) ?? "none",
    shape: textValue(row.shape),
    destination_count: integerValue(row.destination_count),
    session_count: integerValue(row.session_count),
    provenance: parseRouteProvenance(row.provenance),
  };
}

function mapPersonalSession(row: RawPersonalSessionRow): AreaPersonalSession {
  return {
    id: textValue(row.id) ?? "",
    name: textValue(row.name),
    destinationNames: stringArray(row.destination_names),
    start_time: isoValue(row.start_time) ?? new Date(0).toISOString(),
    end_time: isoValue(row.end_time),
    distance: numberValue(row.distance),
    total_time: numberValue(row.total_time),
    pace: numberValue(row.pace),
    gain: numberValue(row.gain),
    highest_point: numberValue(row.highest_point),
    ended: row.ended === true,
    activity_type: sessionActivityType(row.activity_type),
  };
}

function buildGenericDescription(
  name: string,
  kind: ReturnType<typeof normalizeAreaKind>
): string {
  switch (kind) {
    case "national_park":
      return `${name} protects a landmark landscape and its plants, wildlife, and wild places.`;
    case "national_monument":
      return `${name} protects a landscape known for its natural or historic features.`;
    case "national_forest":
      return `${name} spans forest, mountain, and watershed country open to public use.`;
    case "national_grassland":
      return `${name} protects open prairie, native plants, and wildlife habitat.`;
    case "wilderness":
      return `${name} preserves wild country with few roads or built sites.`;
    case "national_recreation_area":
      return `${name} brings together protected land and room for outdoor recreation.`;
    case "national_conservation_area":
      return `${name} protects a distinct landscape, its wildlife, and its cultural sites.`;
    case "wildlife_refuge":
      return `${name} protects key habitat for native wildlife.`;
    case "wild_and_scenic_river":
      return `${name} protects a free-flowing river and the land along its banks.`;
    case "other_federal_area":
    case "unknown":
      return `${name} protects land set aside for nature, history, or public use.`;
  }
}

// ── /areas index ──────────────────────────────────────────────────────────
// AREA_INDEX_DESIGNATIONS/isAreaIndexDesignation live in ../area-types
// instead of here: this file has "use server" at the top, which requires
// every export to be an async function — a plain const array or a
// synchronous type guard can't live in it (Next.js build-time constraint on
// server-action modules). Re-imported below for getAreasIndex's own use.

export interface AreaIndexRow {
  id: string;
  name: string;
  kind: AreaKind;
  designation: string | null;
  stateCode: string;
  destinationCount: number;
}

export interface AreaIndexState {
  code: string;
  count: number;
}

export interface AreasIndexResult {
  /** Areas within the states chosen below, ranked by destination count
   * inside each state and capped per state — the "sensible cap" the index
   * page renders. */
  areas: AreaIndexRow[];
  /** The states shown, in the same order the areas above are grouped by —
   * most areas (matching the current search/filter) first. */
  states: AreaIndexState[];
  /** How many areas match the current search/designation filter, across
   * every state — not capped, so the page can say "showing N of M". */
  totalMatching: number;
  /** The whole catalog's area count, unfiltered — the "of 3,869" side of
   * that same honest line. */
  totalAreas: number;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** Builds the shared WHERE clause + params for the index's search and
 * designation filters, so the matching-count, per-state-count, and ranked
 * queries below all filter identically. Every area query here excludes
 * areas with no recorded state (a handful of non-US/placeholder rows) —
 * the index groups by state, so a state-less area has nowhere to render. */
function areaIndexFilter(
  search: string,
  designation: string
): { clause: string; params: unknown[] } {
  const clauses = ["cardinality(a.state_codes) > 0"];
  const params: unknown[] = [];

  if (designation) {
    params.push(designation);
    clauses.push(`UPPER(a.designation) = $${params.length}`);
  }

  if (search) {
    params.push(normalizeSearchName(search));
    const similarityIndex = params.length;
    params.push(`${escapeLikePattern(search)}%`);
    const prefixIndex = params.length;
    clauses.push(
      `(a.search_name % $${similarityIndex} OR a.search_name ILIKE $${prefixIndex} ESCAPE E'\\\\')`
    );
  }

  return { clause: clauses.join(" AND "), params };
}

const DESTINATION_COUNT_SUBQUERY = `(
  SELECT COUNT(DISTINCT da.destination_id)::int
  FROM destination_areas da
  JOIN destinations d ON d.id = da.destination_id
  WHERE da.area_id = a.id AND d.owner = 'peaks'
)`;

/**
 * Powers the /areas index: areas grouped by state, capped to the top
 * `statesLimit` states (by matching area count) and `perStateLimit` areas
 * per state — the "top states" + "sensible cap" the page promises, rather
 * than rendering all ~3,869 rows on one request.
 */
export async function getAreasIndex(
  options: {
    search?: string;
    designation?: string;
    statesLimit?: number;
    perStateLimit?: number;
  } = {}
): Promise<AreasIndexResult> {
  const search = (options.search ?? "").trim().slice(0, 120);
  const designation = (options.designation ?? "").trim().toUpperCase();
  const statesLimit = Math.min(Math.max(Math.trunc(options.statesLimit ?? 12), 1), 30);
  const perStateLimit = Math.min(Math.max(Math.trunc(options.perStateLimit ?? 25), 1), 100);

  const totalAreasResult = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM areas`
  );
  const totalAreas = Number(totalAreasResult.rows[0]?.count ?? 0);

  // `NP` is a UI choice for the legal National Park roster, not a PAD-US
  // parcel code. PAD-US labels many real parks MPA, CONE, or NCA; it also
  // contains small easements and other NPS units that are not among the 63
  // national parks. Match the roster by normalized name, then use the largest
  // matching PAD-US boundary as the park's detail-page row.
  if (designation === "NP") {
    const candidateResult = await db.query<{
      id: unknown;
      search_name: unknown;
      boundary_area_square_meters: unknown;
      destination_count: unknown;
    }>(
      `SELECT a.id, a.search_name,
              ST_Area(a.boundary::geography)::double precision
                AS boundary_area_square_meters,
              ${DESTINATION_COUNT_SUBQUERY} AS destination_count
       FROM areas a
       WHERE a.search_name = ANY($1::text[])`,
      [officialNationalParkSearchNames()]
    );
    const candidates: NationalParkAreaCandidate[] = candidateResult.rows.map((row) => ({
      id: textValue(row.id) ?? "",
      searchName: textValue(row.search_name) ?? "",
      boundaryAreaSquareMeters: numberValue(row.boundary_area_square_meters) ?? 0,
      destinationCount: integerValue(row.destination_count),
    }));
    const nationalParks = buildNationalParkIndex(candidates, {
      search,
      statesLimit,
      perStateLimit,
    });
    return { ...nationalParks, totalAreas };
  }

  const { clause, params } = areaIndexFilter(search, designation);

  const totalMatchingResult = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM areas a WHERE ${clause}`,
    params
  );
  const totalMatching = Number(totalMatchingResult.rows[0]?.count ?? 0);

  const statesResult = await db.query<{ code: string; count: number }>(
    `SELECT a.state_codes[1] AS code, COUNT(*)::int AS count
     FROM areas a
     WHERE ${clause}
     GROUP BY 1
     ORDER BY count DESC, code ASC
     LIMIT $${params.length + 1}`,
    [...params, statesLimit]
  );
  const states = statesResult.rows.map((row) => ({
    code: String(row.code),
    count: Number(row.count),
  }));

  if (states.length === 0) {
    return { areas: [], states: [], totalMatching, totalAreas };
  }

  const stateCodes = states.map((state) => state.code);
  const rankedResult = await db.query<{
    id: unknown;
    name: unknown;
    kind: unknown;
    designation: unknown;
    state_code: unknown;
    destination_count: unknown;
    rn: unknown;
  }>(
    `SELECT * FROM (
       SELECT a.id, a.name, a.kind, a.designation, a.state_codes[1] AS state_code,
              ${DESTINATION_COUNT_SUBQUERY} AS destination_count,
              ROW_NUMBER() OVER (
                PARTITION BY a.state_codes[1]
                ORDER BY ${DESTINATION_COUNT_SUBQUERY} DESC, a.name ASC
              ) AS rn
       FROM areas a
       WHERE ${clause} AND a.state_codes[1] = ANY($${params.length + 1}::text[])
     ) ranked
     WHERE rn <= $${params.length + 2}
     ORDER BY state_code ASC, rn ASC`,
    [...params, stateCodes, perStateLimit]
  );

  // Re-sort into the same most-areas-first state order as `states` — the
  // SQL above orders alphabetically by state for a stable ROW_NUMBER scan,
  // not by which state has the most matches.
  const stateOrder = new Map(stateCodes.map((code, index) => [code, index]));
  const areas = rankedResult.rows
    .map((row) => ({
      id: textValue(row.id) ?? "",
      name: textValue(row.name) ?? "Protected area",
      kind: normalizeAreaKind(row.kind),
      designation: textValue(row.designation),
      stateCode: textValue(row.state_code) ?? "",
      destinationCount: integerValue(row.destination_count),
    }))
    .sort(
      (left, right) =>
        (stateOrder.get(left.stateCode) ?? 0) - (stateOrder.get(right.stateCode) ?? 0)
    );

  return { areas, states, totalMatching, totalAreas };
}

/**
 * /peaks/[state]'s protected-areas row: the areas with the most linked
 * destinations in one state, US-only for the same reason
 * getTopDestinationsForState is (search.ts) — a raw `state_code` match can
 * otherwise pick up a same-coded foreign province.
 */
export async function getTopAreasForState(
  stateCode: string,
  limit: number = 6
): Promise<AreaIndexRow[]> {
  const result = await db.query<{
    id: unknown;
    name: unknown;
    kind: unknown;
    designation: unknown;
    destination_count: unknown;
  }>(
    `SELECT a.id, a.name, a.kind, a.designation,
            ${DESTINATION_COUNT_SUBQUERY} AS destination_count
     FROM areas a
     WHERE $1 = ANY(a.state_codes) AND a.country_code = 'US'
     ORDER BY destination_count DESC, a.name ASC
     LIMIT $2`,
    [stateCode, limit]
  );

  return result.rows.map((row) => ({
    id: textValue(row.id) ?? "",
    name: textValue(row.name) ?? "Protected area",
    kind: normalizeAreaKind(row.kind),
    designation: textValue(row.designation),
    stateCode,
    destinationCount: integerValue(row.destination_count),
  }));
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value: unknown): number {
  const parsed = numberValue(value);
  return parsed == null ? 0 : Math.trunc(parsed);
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0
    );
  }
  if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
    return value.slice(1, -1).split(",").filter(Boolean);
  }
  return [];
}

function isoValue(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function sessionActivityType(value: unknown): SessionActivityType | null {
  return value === "outdoor-trek" || value === "outdoor-moto" || value === "ski"
    ? value
    : null;
}

function httpUrl(value: unknown): string | null {
  const text = textValue(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
