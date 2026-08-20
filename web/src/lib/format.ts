// Shared formatting helpers for the public detail pages (destination, route,
// area). Centralizes copy-precision rules so pages don't each invent their
// own rounding or placeholder text.

import { formatFeetValue, formatMilesValue } from "./destination-detail";

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

/** "70,000+" — a live count floored to the nearest `step`, for marketing copy
 * that must never claim more than the catalog holds and must never need
 * hand-editing as the catalog grows. Counts below one step print plainly,
 * with no "+": "900+" would be a bigger claim than "900". */
export function formatFlooredCount(count: number, step: number = 1000): string {
  if (!Number.isFinite(count) || count < 0) return "0";
  const floored = Math.floor(count / step) * step;
  if (floored < step) return Math.floor(count).toLocaleString("en-US");
  return `${floored.toLocaleString("en-US")}+`;
}

/** The text alternative for an elevation-profile chart — "Elevation profile:
 * 9.6 miles, 3,570 feet of gain, high point 12,618 feet".
 *
 * A `<canvas>` has no readable content of its own, so this is the whole of
 * what a screen reader gets in place of the chart. Units are spelled out
 * rather than abbreviated: this string is only ever spoken, and "ft" is read
 * aloud inconsistently across screen readers. Measurements the recording
 * doesn't hold are left out rather than dashed (the never-null rule), down to
 * the bare "Elevation profile" when nothing is known. */
export function describeElevationProfile(input: {
  distanceMeters?: number | null;
  gainMeters?: number | null;
  highPointMeters?: number | null;
}): string {
  const distance = formatMilesValue(input.distanceMeters);
  const gain = formatFeetValue(input.gainMeters);
  const highPoint = formatFeetValue(input.highPointMeters);

  const parts = [
    distance ? `${distance} miles` : null,
    gain ? `${gain} feet of gain` : null,
    highPoint ? `high point ${highPoint} feet` : null,
  ].filter((part): part is string => part !== null);

  return parts.length > 0
    ? `Elevation profile: ${parts.join(", ")}`
    : "Elevation profile";
}

/** "Aug 27, 2022" — the one calendar-date phrase for discover cards and
 * report pages, instead of each page picking its own date options. */
export function formatDate(date: string | number | Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
