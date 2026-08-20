// Clean enums for the access-road attributes, shared by every source.
//
// Two rules from docs/trailheads/research-roads.md §A3 are load-bearing here
// and must not be softened:
//
//   1. "What vehicle do I need" comes from the RoadCore operational
//      maintenance level and the BLM observed route-use class. It never comes
//      from an MVUM permission flag: 82.1% of the segments MVUM marks open to
//      passenger vehicles are built to high-clearance standard only.
//   2. A bare "open" is never rendered. The MVUM flag means permitted, not
//      passable, so it stays in the raw table and never reaches these enums.
//
// Nothing here touches duckdb or the file system, so every mapping decision is
// unit-tested without a store — the same split as padus-area-utils.ts.

/** RoadCore OPER_MAINT_LEVEL, cleaned. `na` is the agency's own "not applicable". */
export type MaintenanceLevel = "ml0" | "ml1" | "ml2" | "ml3" | "ml4" | "ml5" | "na";

/** Surface families, ordered from smoothest to roughest by `SURFACE_RANK`. */
export type RoadSurface =
  | "asphalt"
  | "bituminous"
  | "aggregate"
  | "improved_native"
  | "native"
  | "other";

/**
 * What you need to drive the segment. Ordered by `VEHICLE_RANK`, so an
 * approach path takes the maximum rank it crosses.
 */
export type VehicleRequirement =
  | "passenger_car"
  | "high_clearance"
  | "four_wheel_drive"
  | "four_wheel_drive_high_clearance"
  | "atv_only"
  | "not_maintained";

/** BLM OBSRVE_ROUTE_USE_CLASS after the reviewed canonical map is applied. */
export type BlmRouteUseClass = "2wd" | "4wd" | "4wd_high_clearance" | "atv" | "unknown";

/** Higher is rougher. Null-ranked surfaces ("other") cannot be compared. */
export const SURFACE_RANK: Record<RoadSurface, number | null> = {
  asphalt: 1,
  bituminous: 2,
  aggregate: 3,
  improved_native: 4,
  native: 5,
  other: null,
};

/** Higher demands more of the vehicle. An approach path takes the maximum. */
export const VEHICLE_RANK: Record<VehicleRequirement, number> = {
  passenger_car: 1,
  high_clearance: 2,
  four_wheel_drive: 3,
  four_wheel_drive_high_clearance: 4,
  atv_only: 5,
  not_maintained: 6,
};

// RoadCore and MVUM both write "<CODE> - <LABEL>", but MVUM also carries bare
// codes ("2") and a truncated "2 - ", so only the code before the dash is read.
const SURFACE_BY_CODE: Record<string, RoadSurface> = {
  AC: "asphalt",
  P: "asphalt",
  PCC: "asphalt",
  BST: "bituminous",
  AGG: "aggregate",
  CIN: "aggregate",
  IMP: "improved_native",
  CSOIL: "improved_native",
  NAT: "native",
  PIT: "native",
  FSOIL: "native",
  SOD: "native",
  GRA: "native",
  OTHER: "other",
};

const MAINT_LEVEL_BY_CODE: Record<string, MaintenanceLevel> = {
  "0": "ml0",
  "1": "ml1",
  "2": "ml2",
  "3": "ml3",
  "4": "ml4",
  "5": "ml5",
  NA: "na",
};

/** The numeric part of a maintenance level; `na` has none. */
export const MAINT_LEVEL_NUMBER: Record<MaintenanceLevel, number | null> = {
  ml0: 0,
  ml1: 1,
  ml2: 2,
  ml3: 3,
  ml4: 4,
  ml5: 5,
  na: null,
};

/** Take the code in front of the " - " separator, uppercased. */
function leadingCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const code = trimmed.split("-")[0]!.trim().toUpperCase();
  return code === "" ? null : code;
}

/** "2 - HIGH CLEARANCE VEHICLES" and "2" both give `ml2`. */
export function parseMaintenanceLevel(
  raw: string | null | undefined,
): MaintenanceLevel | null {
  const code = leadingCode(raw);
  if (code === null) return null;
  return MAINT_LEVEL_BY_CODE[code] ?? null;
}

/** "NAT - NATIVE MATERIAL" gives `native`; an unknown code gives null. */
export function parseSurfaceType(raw: string | null | undefined): RoadSurface | null {
  const code = leadingCode(raw);
  if (code === null) return null;
  return SURFACE_BY_CODE[code] ?? null;
}

/**
 * The passability read of a maintenance level, per §A3 rule 1.
 *
 * Levels 3, 4 and 5 are all built for passenger cars — the difference between
 * them is comfort, not capability. Level 2 is the high-clearance line, and
 * levels 0 and 1 are not maintained for passenger travel at all.
 */
export function vehicleRequirementFromMaintenanceLevel(
  level: MaintenanceLevel | null,
): VehicleRequirement | null {
  switch (level) {
    case "ml5":
    case "ml4":
    case "ml3":
      return "passenger_car";
    case "ml2":
      return "high_clearance";
    case "ml1":
    case "ml0":
      return "not_maintained";
    default:
      return null;
  }
}

/** The BLM observed class read the same way. "unknown" stays unknown. */
export function vehicleRequirementFromBlmClass(
  routeClass: BlmRouteUseClass | null,
): VehicleRequirement | null {
  switch (routeClass) {
    case "2wd":
      return "passenger_car";
    case "4wd":
      return "four_wheel_drive";
    case "4wd_high_clearance":
      return "four_wheel_drive_high_clearance";
    case "atv":
      return "atv_only";
    default:
      return null;
  }
}

/**
 * The RoadCore open/closed split, reproduced from the bulk geodatabase.
 *
 * The EDW publishes two layers — `EDW_RoadBasic_01/0` (open) and `/1` (closed
 * to motorized use) — but the bulk `Trans_RoadCore_FS.gdb` is one undivided
 * feature class. Probing the live service pinned the filter: layer 0 holds
 * exactly the rows whose `OPENFORUSETO` is `ALL` or `PUBLIC`, with a
 * maintenance level that is present and is not level 1. Level 0 (15 rows) and
 * `NA` (13 rows) are both in layer 0, and both counts match the geodatabase.
 */
export function isPublicMotorized(
  openForUseTo: string | null | undefined,
  maintLevelRaw: string | null | undefined,
): boolean {
  const audience = (openForUseTo ?? "").trim().toUpperCase();
  if (audience !== "ALL" && audience !== "PUBLIC") return false;
  const level = parseMaintenanceLevel(maintLevelRaw);
  if (level === null) return false;
  return level !== "ml1";
}
