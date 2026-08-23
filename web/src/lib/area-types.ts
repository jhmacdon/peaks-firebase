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
  | "other_federal_area"
  | "unknown";

export interface ProtectedArea {
  id: string;
  name: string;
  kind: AreaKind;
  designation?: string | null;
  manager?: string | null;
  parent_id?: string | null;
}

export type AreaBoundary = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export interface AreaBoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// Server-known kinds. "unknown" is intentionally excluded: any raw value not in
// this list (including the literal "unknown") falls through normalizeAreaKind to
// "unknown" — the forward-compat fallback for server enum values this build predates.
const KNOWN_KINDS: readonly AreaKind[] = [
  "national_park",
  "national_monument",
  "national_forest",
  "national_grassland",
  "wilderness",
  "national_recreation_area",
  "national_conservation_area",
  "wildlife_refuge",
  "wild_and_scenic_river",
  "other_federal_area",
];

export function normalizeAreaKind(raw: unknown): AreaKind {
  return KNOWN_KINDS.includes(raw as AreaKind) ? (raw as AreaKind) : "unknown";
}

/** Defensive parse of the `areas` json column. Skips entries missing id/name;
 *  unrecognized kinds collapse to "unknown" (forward-compat with the server enum). */
export function parseAreas(raw: unknown): ProtectedArea[] {
  if (!Array.isArray(raw)) return [];
  const out: ProtectedArea[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const obj = a as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : null;
    const name = typeof obj.name === "string" ? obj.name : null;
    if (!id || !name) continue;
    out.push({
      id,
      name,
      kind: normalizeAreaKind(obj.kind),
      designation: typeof obj.designation === "string" ? obj.designation : null,
      manager: typeof obj.manager === "string" ? obj.manager : null,
      parent_id:
        typeof obj.parent_id === "string"
          ? obj.parent_id
          : typeof obj.parentId === "string"
            ? obj.parentId
            : null,
    });
  }
  return out;
}

export function parseAreaBoundary(raw: unknown): AreaBoundary | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (
    (value.type !== "Polygon" && value.type !== "MultiPolygon") ||
    !Array.isArray(value.coordinates)
  ) {
    return null;
  }
  return value as unknown as AreaBoundary;
}

const KIND_LABELS: Record<AreaKind, string> = {
  national_park: "National park",
  national_monument: "National monument",
  national_forest: "National forest",
  national_grassland: "National grassland",
  wilderness: "Wilderness",
  national_recreation_area: "National recreation area",
  national_conservation_area: "National conservation area",
  wildlife_refuge: "Wildlife refuge",
  wild_and_scenic_river: "Wild and scenic river",
  other_federal_area: "Protected area",
  unknown: "Protected area",
};

export function areaKindLabel(kind: AreaKind): string {
  return KIND_LABELS[kind];
}

// PAD-US 4.1 `Des_Tp` designation-type codes actually present in
// `areas.designation` (checked against production 2026-08-19: ACEC, WA,
// WSA, NWR, NF, CONE, WSR, NM, MPA, NCA, NRA, NP, NG, IRA, RNA, NSBV, RECE,
// PUB, REC, SDA, FOTH, UNKE, SP). Only codes with a confirmed meaning are
// mapped; the rest fall back to the area's kind label rather than guess at
// what an abbreviation stands for.
const DESIGNATION_CODES: Record<string, string> = {
  NP: "National Park",
  NM: "National Monument",
  NF: "National Forest",
  NG: "National Grassland",
  NRA: "National Recreation Area",
  NCA: "National Conservation Area",
  NWR: "National Wildlife Refuge",
  NLS: "National Lakeshore",
  WA: "Wilderness Area",
  WSA: "Wilderness Study Area",
  WSR: "Wild and Scenic River",
  ACEC: "Area of Critical Environmental Concern",
  MPA: "Marine Protected Area",
  RNA: "Research Natural Area",
  IRA: "Inventoried Roadless Area",
  NSBV: "National Scenic Area",
  CONE: "Conservation Easement",
  REC: "Recreation Area",
  SP: "State Park",
};

/** Designation display text: expands a known PAD-US code and otherwise
 * falls back to the kind label — never a raw code, never nothing. Fails
 * closed: an unlisted value is never passed through as-is, even if it looks
 * "already spelled out", since that heuristic can't be verified against
 * every code PAD-US might use. */
export function describeDesignation(
  designation: string | null | undefined,
  kind: AreaKind
): string {
  if (!designation) return areaKindLabel(kind);
  const mapped = DESIGNATION_CODES[designation.toUpperCase()];
  return mapped ?? areaKindLabel(kind);
}

/** The index can surface a PAD-US parcel whose legal designation is less
 * useful than the place name. A row named for a National Park should not
 * tell readers it is a conservation easement. */
export function describeAreaIndexDesignation(
  name: string,
  designation: string | null | undefined,
  kind: AreaKind
): string {
  if (/\bNational Park(?: and Preserve)?$/i.test(name.trim())) {
    return "National Park";
  }
  return describeDesignation(designation, kind);
}

// PAD-US `Mang_Name` manager codes actually present in `areas.manager`
// (checked against production 2026-08-19: BLM, USFS, FWS, NPS, OTHF, JNT,
// USBR, DOD).
const MANAGER_CODES: Record<string, string> = {
  NPS: "National Park Service",
  USFS: "U.S. Forest Service",
  BLM: "Bureau of Land Management",
  FWS: "U.S. Fish and Wildlife Service",
  USBR: "Bureau of Reclamation",
  DOD: "Department of Defense",
  JNT: "Joint management",
  OTHF: "Other federal agency",
  FED: "Federal government",
};

/** Manager display text: expands a known code and otherwise omits the row
 * (null) rather than show a raw code. Fails closed — see describeDesignation. */
export function describeManager(manager: string | null | undefined): string | null {
  if (!manager) return null;
  return MANAGER_CODES[manager.toUpperCase()] ?? null;
}

/** Shared contract — must match the iOS `ProtectedArea.isNationalParkService`. */
export function isNationalParkService(area: ProtectedArea): boolean {
  const m = (area.manager ?? "").toLowerCase();
  if (/\bnational park service\b/.test(m)) return true;
  if (/\bnps\b/.test(m)) return true;
  if (!area.manager && area.kind === "national_park") return true;
  return false;
}

// Ranks mirror iOS SessionDetailView.areaKindSortPriority exactly so chip
// ordering matches across platforms.
const PROMINENCE: Record<AreaKind, number> = {
  national_park: 0,
  national_monument: 1,
  national_recreation_area: 2,
  national_conservation_area: 3,
  wilderness: 4,
  national_forest: 5,
  national_grassland: 6,
  wildlife_refuge: 7,
  wild_and_scenic_river: 8,
  other_federal_area: 9,
  unknown: 10,
};

/** Most-prominent-designation first, then by name — mirrors iOS SessionDetailView. */
export function sortAreasByProminence(areas: ProtectedArea[]): ProtectedArea[] {
  return [...areas].sort(
    (a, b) => PROMINENCE[a.kind] - PROMINENCE[b.kind] || a.name.localeCompare(b.name)
  );
}

// The /areas index's filter chips. NP means the official National Park
// Service roster, not the PAD-US parcel code: many of the 63 parks have a
// different PAD-US designation. The other values remain designation filters.
// "All" (no filter) isn't listed here; the page renders that option itself.
// Lives in this plain module
// rather than lib/actions/areas.ts because that file has "use server" at
// the top: Next.js treats every export of a "use server" module as a
// server-action reference, which only works for async functions — a plain
// const array (or a synchronous type guard) can't be exported from it.
export const AREA_INDEX_DESIGNATIONS = ["NP", "WA", "NF", "SP"] as const;
export type AreaIndexDesignation = (typeof AREA_INDEX_DESIGNATIONS)[number];

export const AREA_INDEX_DESIGNATION_LABELS: Record<AreaIndexDesignation, string> = {
  NP: "National Park",
  WA: "Wilderness Area",
  NF: "National Forest",
  SP: "State Park",
};

export function isAreaIndexDesignation(
  value: string | null | undefined
): value is AreaIndexDesignation {
  if (!value) return false;
  return (AREA_INDEX_DESIGNATIONS as readonly string[]).includes(value.toUpperCase());
}
