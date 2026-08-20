// MVUM seasonal-gate parsing.
//
// MVUM is the only structured national source of open/close windows, and the
// one place in this pipeline where a careless read produces the exact wrong
// answer the research warns about. Two rules from
// docs/trailheads/research-roads.md §A3 are binding:
//
//   - Read `*_datesopen` only where `seasonal` is `seasonal`. Under `yearlong`
//     the dates are filler.
//   - `01/01-12/31` means the agency recorded no window. It does not mean the
//     road is open all year. FR 8040-500 to the Mount Adams South Climb
//     trailhead carries "yearlong, passenger vehicle open, 01/01-12/31" while
//     the same federal database rates it high-clearance-only.
//
// So a window survives only when the segment is flagged seasonal AND the dates
// describe something narrower than the whole year. Everything else is null:
// no data, not "open all year".

/** A recurring gate window. Month-day only — the source carries no year. */
export interface SeasonWindow {
  /** "MM-DD" the window opens. */
  opens: string;
  /** "MM-DD" the window closes. */
  closes: string;
  /** True when the window runs through New Year (05-16 to 03-14). */
  wrapsYear: boolean;
}

/** The `seasonal` column, cleaned. Anything else is treated as no data. */
export type SeasonalFlag = "seasonal" | "yearlong";

/** One vehicle class as MVUM names it, with the two columns that carry it. */
export interface MvumVehicleClass {
  /** Our name for the class, used as the key in the windows table. */
  name: string;
  /** The permission column. Kept for the raw table only — never a passability signal. */
  permissionField: string;
  /** The column holding the date windows. */
  datesField: string;
}

/**
 * The fourteen vehicle classes plus the three e-bike classes, which use the
 * `_DUR` suffix instead of `_DATESOPEN`.
 */
export const MVUM_VEHICLE_CLASSES: readonly MvumVehicleClass[] = [
  { name: "passenger_vehicle", permissionField: "PASSENGERVEHICLE", datesField: "PASSENGERVEHICLE_DATESOPEN" },
  { name: "high_clearance_vehicle", permissionField: "HIGHCLEARANCEVEHICLE", datesField: "HIGHCLEARANCEVEHICLE_DATESOPEN" },
  { name: "truck", permissionField: "TRUCK", datesField: "TRUCK_DATESOPEN" },
  { name: "bus", permissionField: "BUS", datesField: "BUS_DATESOPEN" },
  { name: "motorhome", permissionField: "MOTORHOME", datesField: "MOTORHOME_DATESOPEN" },
  { name: "fourwd_gt50in", permissionField: "FOURWD_GT50INCHES", datesField: "FOURWD_GT50_DATESOPEN" },
  { name: "twowd_gt50in", permissionField: "TWOWD_GT50INCHES", datesField: "TWOWD_GT50_DATESOPEN" },
  { name: "tracked_ohv_gt50in", permissionField: "TRACKED_OHV_GT50INCHES", datesField: "TRACKED_OHV_GT50_DATESOPEN" },
  { name: "other_ohv_gt50in", permissionField: "OTHER_OHV_GT50INCHES", datesField: "OTHER_OHV_GT50_DATESOPEN" },
  { name: "atv", permissionField: "ATV", datesField: "ATV_DATESOPEN" },
  { name: "motorcycle", permissionField: "MOTORCYCLE", datesField: "MOTORCYCLE_DATESOPEN" },
  { name: "otherwheeled_ohv", permissionField: "OTHERWHEELED_OHV", datesField: "OTHERWHEELED_OHV_DATESOPEN" },
  { name: "tracked_ohv_lt50in", permissionField: "TRACKED_OHV_LT50INCHES", datesField: "TRACKED_OHV_LT50_DATESOPEN" },
  { name: "other_ohv_lt50in", permissionField: "OTHER_OHV_LT50INCHES", datesField: "OTHER_OHV_LT50_DATESOPEN" },
  { name: "e_bike_class1", permissionField: "E_BIKE_CLASS1", datesField: "E_BIKE_CLASS1_DUR" },
  { name: "e_bike_class2", permissionField: "E_BIKE_CLASS2", datesField: "E_BIKE_CLASS2_DUR" },
  { name: "e_bike_class3", permissionField: "E_BIKE_CLASS3", datesField: "E_BIKE_CLASS3_DUR" },
];

/**
 * Clean the `seasonal` column.
 *
 * The column is dirty: "Seasonal", "seasonal " and a bare space all occur, and
 * one row holds a date range instead of a word. Case and padding are fixed;
 * anything that is not one of the two words gives null, which means no
 * seasonal data and therefore no window.
 */
export function normalizeSeasonalFlag(raw: string | null | undefined): SeasonalFlag | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "seasonal") return "seasonal";
  if (value === "yearlong") return "yearlong";
  return null;
}

// Windows appear as "04/01-11/30", "06/01 - 9/30", "7/01-10/11", and as
// several windows in one cell separated by commas or runs of spaces:
// "01/01-10/11    10/22-12/31" and "04/01-09/27,10/14-11/30". Scanning for
// every date pair in the string handles all of them without guessing at the
// separator. Non-date filler — a blank, or the literal "open" in the e-bike
// duration columns — simply yields no matches.
const WINDOW_PATTERN = /(\d{1,2})\s*\/\s*(\d{1,2})\s*-\s*(\d{1,2})\s*\/\s*(\d{1,2})/g;

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function monthDay(month: number, day: number): string | null {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;
  // February 29 is a real value in this data. There is no year to check it
  // against, so the leap day is allowed.
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]!) return null;
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Pull every date window out of one `*_datesopen` cell.
 *
 * Returns an empty array when the cell holds no parseable window. Malformed
 * pairs are dropped rather than guessed at.
 */
export function parseDateWindows(raw: string | null | undefined): SeasonWindow[] {
  if (raw == null) return [];
  const windows: SeasonWindow[] = [];
  WINDOW_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WINDOW_PATTERN.exec(raw)) !== null) {
    const opens = monthDay(Number(match[1]), Number(match[2]));
    const closes = monthDay(Number(match[3]), Number(match[4]));
    if (opens === null || closes === null) continue;
    windows.push({ opens, closes, wrapsYear: closes < opens });
  }
  return windows;
}

/**
 * True when the windows say nothing more than "the whole year".
 *
 * A single 01/01-12/31 is the filler value §A3 warns about. Several windows
 * are never filler even when they nearly cover the year — "01/01-10/11,
 * 10/22-12/31" is a real eleven-day closure.
 */
export function isFullYearWindow(windows: readonly SeasonWindow[]): boolean {
  return windows.length === 1 && windows[0]!.opens === "01-01" && windows[0]!.closes === "12-31";
}

/**
 * The windows to store for one vehicle class on one segment.
 *
 * Null — never an empty array — when there is no seasonal data, so a caller
 * cannot mistake "no window recorded" for "closed all year".
 */
export function seasonWindowsForClass(
  seasonal: SeasonalFlag | null,
  datesOpenRaw: string | null | undefined,
): SeasonWindow[] | null {
  if (seasonal !== "seasonal") return null;
  const windows = parseDateWindows(datesOpenRaw);
  if (windows.length === 0) return null;
  if (isFullYearWindow(windows)) return null;
  return windows;
}

/** Every class on one segment that has a real window, keyed by class name. */
export function seasonWindowsForSegment(
  seasonalRaw: string | null | undefined,
  row: Record<string, unknown>,
): Record<string, SeasonWindow[]> {
  const seasonal = normalizeSeasonalFlag(seasonalRaw);
  const result: Record<string, SeasonWindow[]> = {};
  if (seasonal !== "seasonal") return result;
  for (const vehicleClass of MVUM_VEHICLE_CLASSES) {
    const raw = row[vehicleClass.datesField];
    const windows = seasonWindowsForClass(seasonal, typeof raw === "string" ? raw : null);
    if (windows !== null) result[vehicleClass.name] = windows;
  }
  return result;
}
