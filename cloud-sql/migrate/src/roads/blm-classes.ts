// BLM GTLF normalization.
//
// `OBSRVE_ROUTE_USE_CLASS` is the prize field — an observed class rather than
// an engineering standard — and its values are filthy: "2WD LOW", "2WD Low"
// and "2wd Low" all occur, as do four spellings of "4WD High Clearance /
// Specialized" and both "" and " " for empty. The canonical map was reviewed
// once and lives in docs/trailheads/data/blm-route-use-class-map.jsonl. This
// module applies it; it does not rebuild it.
//
// A value the map has never seen is reported as unmapped, not quietly folded
// into "unknown" — a new spelling arriving in a later refresh should show up
// in the run summary rather than disappear.

import type { BlmRouteUseClass, RoadSurface } from "./road-enums";

/** How a raw value found its canonical class. */
export type RouteUseClassMatch = "exact" | "normalized" | "unmapped";

/** One reviewed decision: what the class means, and whether it is a road. */
export interface RouteUseClassEntry {
  routeClass: BlmRouteUseClass;
  /** Null when the map row carries no `drivable` flag — unreviewed, not false. */
  drivable: boolean | null;
}

export interface RouteUseClassResult {
  routeClass: BlmRouteUseClass | null;
  /** Null when unmapped, or mapped by a row with no `drivable` flag. */
  drivable: boolean | null;
  match: RouteUseClassMatch;
}

/** The reviewed map, indexed for exact and for forgiving lookup. */
export interface RouteUseClassMap {
  exact: Map<string, RouteUseClassEntry>;
  normalized: Map<string, RouteUseClassEntry>;
  size: number;
}

const CANONICAL_CLASSES: readonly BlmRouteUseClass[] = [
  "2wd",
  "4wd",
  "4wd_high_clearance",
  "atv",
  "unknown",
];

// Stands in for a null raw value so it can share one map. The leading space
// makes it unreachable from real data, because normalizing trims. It used to
// be a literal NUL, which made git treat this whole file as binary and broke
// every diff of it — keep the sentinel printable.
const NULL_KEY = " null";

function exactKey(raw: string | null | undefined): string {
  return raw == null ? NULL_KEY : raw;
}

/**
 * Lowercase, collapse runs of whitespace, and drop the spaces around a slash,
 * so "4WD High Clearance/ Specialized" and "4wd High Clearance / Specialized"
 * land on one key.
 */
export function normalizeRouteUseClassValue(raw: string | null | undefined): string {
  if (raw == null) return NULL_KEY;
  const collapsed = raw.trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/");
  return collapsed === "" ? NULL_KEY : collapsed;
}

/**
 * Read the reviewed map from the JSONL file's contents.
 *
 * Throws on a row with a class outside the canonical set — a typo in the map
 * would otherwise spread silently through every BLM segment.
 */
export function parseRouteUseClassMap(fileContents: string): RouteUseClassMap {
  const exact = new Map<string, RouteUseClassEntry>();
  const normalized = new Map<string, RouteUseClassEntry>();
  let size = 0;
  for (const line of fileContents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const row = JSON.parse(trimmed) as {
      raw_value?: string | null;
      canonical_class?: string;
      drivable?: unknown;
    };
    const canonical = row.canonical_class as BlmRouteUseClass | undefined;
    if (canonical === undefined || !CANONICAL_CLASSES.includes(canonical)) {
      throw new Error(
        `blm-route-use-class-map: unknown canonical_class ${JSON.stringify(row.canonical_class)}`,
      );
    }
    if (row.drivable !== undefined && typeof row.drivable !== "boolean") {
      throw new Error(
        `blm-route-use-class-map: drivable must be a boolean, got ${JSON.stringify(row.drivable)}`,
      );
    }
    // A row with no flag is unreviewed for drivability, which is not the same
    // as reviewed-and-false. It reads as null and gets reported.
    const entry: RouteUseClassEntry = {
      routeClass: canonical,
      drivable: typeof row.drivable === "boolean" ? row.drivable : null,
    };
    exact.set(exactKey(row.raw_value), entry);
    const key = normalizeRouteUseClassValue(row.raw_value);
    if (!normalized.has(key)) normalized.set(key, entry);
    size += 1;
  }
  if (size === 0) throw new Error("blm-route-use-class-map: no rows");
  return { exact, normalized, size };
}

/** Apply the map to one raw value. */
export function applyRouteUseClass(
  map: RouteUseClassMap,
  raw: string | null | undefined,
): RouteUseClassResult {
  const direct = map.exact.get(exactKey(raw));
  if (direct !== undefined) {
    return { routeClass: direct.routeClass, drivable: direct.drivable, match: "exact" };
  }
  const loose = map.normalized.get(normalizeRouteUseClassValue(raw));
  if (loose !== undefined) {
    return { routeClass: loose.routeClass, drivable: loose.drivable, match: "normalized" };
  }
  return { routeClass: null, drivable: null, match: "unmapped" };
}

// `PLAN_ALLOW_MODE_TRNSPRT` codes that permit only vehicles narrower than a
// car. This one stays in code rather than in the reviewed map, because it reads
// a different field: the map is keyed by observed route-use class, and a route
// carries both. The shared codes are not exclusive and stay in;
// `TECH_HI_CLEAR_VEH_ONLY` is a vehicle, just a demanding one, so it stays too.
const NON_DRIVABLE_ALLOWED_MODES = new Set(["MTC_ONLY", "MTC_ATV_UTV_ONLY"]);

/** Why a route was kept out of the drivable graph, or `null` when it is in. */
export type NotDrivableReason = "route_class" | "allowed_modes" | "unreviewed_class";

export interface DrivableResult {
  drivable: boolean;
  reason: NotDrivableReason | null;
}

/**
 * Whether a BLM route belongs in the drivable road graph.
 *
 * The class half of this answer lives in the reviewed map beside the canonical
 * class, as a `drivable` flag, so a spelling that arrives in a later refresh
 * cannot pass through as a road on nobody's authority. **A class the map does
 * not cover, or covers without a flag, is kept out and reported** — a new
 * unreviewed value should stop a road appearing rather than invent a
 * connection. Failing the other way is the quiet one: a hiking trail admitted
 * to the graph fabricates a route to a trailhead nothing can drive to.
 *
 * Why the flag is needed at all: the canonical map folds Non-Motorized,
 * Motorized Single Track and Over Snow Vehicle into "unknown", which is the
 * right answer for "what vehicle" — there is none — and the wrong one for "is
 * this a road".
 *
 * The layer is "public display", which sounds like it would already be only
 * drivable roads, and two of its planning fields agree uselessly:
 * `PLAN_MODE_TRNSPRT` is `Motorized` on all 111,149 rows and
 * `PLAN_ASSET_CLASS` is always Road or Primitive Road, so neither can exclude
 * anything. `OHV_ROUTE_DSGNTN_LIM` only says a limit exists, never that a car
 * is barred. The observed class and the allowed-mode code carry the answer.
 *
 * ATV and UTV routes deliberately stay in — the map flags them drivable. They
 * are motorized, and a walk that crosses one should say "ATV only", which
 * `vehicleRank` already does, rather than lose the connection.
 */
export function classifyBlmDrivability(
  map: RouteUseClassMap,
  rawRouteClass: string | null | undefined,
  rawAllowedModes: string | null | undefined,
): DrivableResult {
  const modes = (rawAllowedModes ?? "").trim().toUpperCase();
  if (NON_DRIVABLE_ALLOWED_MODES.has(modes)) {
    return { drivable: false, reason: "allowed_modes" };
  }
  const applied = applyRouteUseClass(map, rawRouteClass);
  if (applied.drivable === null) {
    return { drivable: false, reason: "unreviewed_class" };
  }
  return applied.drivable
    ? { drivable: true, reason: null }
    : { drivable: false, reason: "route_class" };
}

/** The plain yes/no, for callers that do not need the reason. */
export function isDrivableBlmRoute(
  map: RouteUseClassMap,
  rawRouteClass: string | null | undefined,
  rawAllowedModes: string | null | undefined,
): boolean {
  return classifyBlmDrivability(map, rawRouteClass, rawAllowedModes).drivable;
}

// BLM surface values are dirty in the same way but small enough to fold by
// hand. "Solid Surface" is BLM's term for a hardened, paved-equivalent road.
const BLM_SURFACES: Record<string, RoadSurface> = {
  natural: "native",
  "natural improved": "improved_native",
  aggregate: "aggregate",
  "gravel/aggregate": "aggregate",
  "solid surface": "asphalt",
  solid: "asphalt",
  paved: "asphalt",
  other: "other",
};

/** `OBSRVE_SRFCE_TYPE` to the shared surface enum. "Unknown" gives null. */
export function normalizeBlmSurface(raw: string | null | undefined): RoadSurface | null {
  const key = (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/");
  if (key === "" || key === "unknown") return null;
  return BLM_SURFACES[key] ?? null;
}

/**
 * `PLAN_SEASON_RSTRCT_CODE` to a flag.
 *
 * This is a Yes/No/UNK/N/A field with no dates attached — far weaker than an
 * MVUM window, and it must never be turned into one.
 */
export function normalizeBlmSeasonRestriction(raw: string | null | undefined): boolean | null {
  const value = (raw ?? "").trim().toUpperCase();
  if (value === "YES") return true;
  if (value === "NO") return false;
  return null;
}
