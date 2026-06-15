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
    });
  }
  return out;
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
