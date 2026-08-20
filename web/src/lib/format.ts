// Shared formatting helpers for the public detail pages (destination, route,
// area). Centralizes copy-precision rules so pages don't each invent their
// own rounding or placeholder text.

/** Round hours to the nearest quarter hour. Avoids false-precision copy like
 * "3h 27m" for numbers that are themselves estimates. */
export function roundToQuarterHour(hours: number): number {
  return Math.round(hours * 4) / 4;
}

/** "3" for a whole number, "3.5" / "3.25" for a fraction — never a trailing
 * ".0" or an unrounded decimal. */
export function formatHoursFriendly(hours: number): string {
  const rounded = roundToQuarterHour(hours);
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0$/, "");
}

/** "3.5–5 hr" — a quarter-hour-rounded range. Returns "—" when either bound
 * is missing so callers can still print it inline next to a label. */
export function formatDurationRangeFriendly(
  lowHours: number | null | undefined,
  highHours: number | null | undefined
): string {
  if (
    lowHours == null ||
    highHours == null ||
    !Number.isFinite(lowHours) ||
    !Number.isFinite(highHours)
  ) {
    return "—";
  }
  return `${formatHoursFriendly(lowHours)}–${formatHoursFriendly(highHours)} hr`;
}

/** "47.4880° N, 121.7220° W" — one compact, readable coordinate string
 * instead of raw signed decimal degrees. */
export function formatCoordinates(
  lat: number | null | undefined,
  lng: number | null | undefined
): string | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
}

/** The one session-count phrase used across every detail page — never
 * "logs", never "recorded sessions", just "N sessions". */
export function formatSessionCount(count: number): string {
  return `${count.toLocaleString("en-US")} session${count === 1 ? "" : "s"}`;
}
