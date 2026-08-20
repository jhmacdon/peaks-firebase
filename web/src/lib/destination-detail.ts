import type { Amenities } from "./amenities";

type CountMap = Record<string, number>;

export interface DestinationAverages {
  months?: Record<string, number | string | null>;
  days?: Record<string, number | string | null>;
  weekdays?: Record<string, number | string | null>;
  [key: string]: unknown;
}

export interface DestinationGuideSource {
  name: string | null;
  type: string;
  elevation: number | null;
  prominence: number | null;
  activities: string[];
  features: string[];
  explicitly_saved?: boolean;
  averages?: DestinationAverages | null;
}

const MONTH_LABELS: Record<string, string> = {
  jan: "Jan",
  january: "Jan",
  feb: "Feb",
  february: "Feb",
  mar: "Mar",
  march: "Mar",
  apr: "Apr",
  april: "Apr",
  may: "May",
  jun: "Jun",
  june: "Jun",
  jul: "Jul",
  july: "Jul",
  aug: "Aug",
  august: "Aug",
  sep: "Sep",
  sept: "Sep",
  september: "Sep",
  oct: "Oct",
  october: "Oct",
  nov: "Nov",
  november: "Nov",
  dec: "Dec",
  december: "Dec",
};

const ACTIVITY_LABELS: Record<string, string> = {
  "outdoor-trek": "hiking",
  "outdoor-moto": "moto touring",
  ski: "ski touring",
};

const DAY_LABELS: Record<string, string> = {
  mo: "Mon",
  mon: "Mon",
  monday: "Mon",
  tu: "Tue",
  tue: "Tue",
  tues: "Tue",
  tuesday: "Tue",
  we: "Wed",
  wed: "Wed",
  wednesday: "Wed",
  th: "Thu",
  thu: "Thu",
  thur: "Thu",
  thurs: "Thu",
  thursday: "Thu",
  fr: "Fri",
  fri: "Fri",
  friday: "Fri",
  sa: "Sat",
  sat: "Sat",
  saturday: "Sat",
  su: "Sun",
  sun: "Sun",
  sunday: "Sun",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toCountMap(value: unknown): CountMap {
  if (!isRecord(value)) return {};

  const output: CountMap = {};
  for (const [key, raw] of Object.entries(value)) {
    const count = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(count)) {
      output[key] = count;
    }
  }
  return output;
}

function mergeCountMaps(left: CountMap, right: CountMap): CountMap {
  const merged: CountMap = {};
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    merged[key] = (left[key] || 0) + (right[key] || 0);
  }
  return merged;
}

function normalizeSeasonalMap(
  source: unknown,
  labels: Record<string, string>
): Array<{ label: string; count: number }> {
  const map = toCountMap(source);
  return Object.entries(map)
    .map(([key, count]) => ({
      label: labels[key.toLowerCase()] || key,
      count,
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function joinNames(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

export function formatFeet(meters: number | null | undefined): string {
  if (meters == null) return "—";
  return `${Math.round(meters * 3.28084).toLocaleString("en-US")} ft`;
}

export function formatMiles(meters: number | null | undefined): string {
  if (meters == null) return "—";
  return `${(meters / 1609.34).toFixed(1)} mi`;
}

/** The bare numeral a StatCluster wants — "14,411", with the unit supplied
 * separately as its own smaller span. Returns null (not "—") when there is
 * nothing to show, so the caller drops the whole cluster rather than
 * printing a placeholder numeral (plan constraint 6). */
export function formatFeetValue(meters: number | null | undefined): string | null {
  if (meters == null || !Number.isFinite(meters)) return null;
  return Math.round(meters * 3.28084).toLocaleString("en-US");
}

/** "5.6" — the mile numeral without its unit. Same null contract as
 * formatFeetValue. */
export function formatMilesValue(meters: number | null | undefined): string | null {
  if (meters == null || !Number.isFinite(meters)) return null;
  return (meters / 1609.34).toFixed(1);
}

/** "3h 12m" / "48m" — elapsed time as one compact numeral string. */
export function formatElapsed(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "0m";
  const roundedMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** "820 m away" / "3.4 mi away" — how far a nearby destination sits. */
export function formatDistanceAway(meters: number): string {
  if (meters < 1609.34) {
    return `${Math.round(meters).toLocaleString("en-US")} m away`;
  }
  return `${(meters / 1609.34).toFixed(1)} mi away`;
}

/** "fire-lookout" → "Fire lookout" */
export function titleize(value: string): string {
  const spaced = value.replace(/[-_]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** What a recorded session at this destination is called. On a summit it is
 * an ascent; on a lake, viewpoint, or trailhead it plainly is not — and one
 * template serves all 70,000 catalog pages, so the word follows the
 * feature rather than assuming every destination is climbed. */
export function describeSessionNoun(features: string[]): "Ascents" | "Sessions" {
  const climbed = new Set(["summit", "volcano"]);
  return features.some((feature) => climbed.has(feature)) ? "Ascents" : "Sessions";
}

export const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

// Every spelling of a month key seen in the averages JSONB across sources
// (Peakbagger imports, the iOS app, the ascent backfill) folded onto one
// slot each.
const MONTH_KEYS: string[][] = [
  ["jan", "january", "1", "01"],
  ["feb", "february", "2", "02"],
  ["mar", "march", "3", "03"],
  ["apr", "april", "4", "04"],
  ["may", "5", "05"],
  ["jun", "june", "6", "06"],
  ["jul", "july", "7", "07"],
  ["aug", "august", "8", "08"],
  ["sep", "sept", "september", "9", "09"],
  ["oct", "october", "10"],
  ["nov", "november", "11"],
  ["dec", "december", "12"],
];

/** Twelve visit counts, Jan-first, or null when the record carries no
 * seasonal data at all — the section is dropped rather than drawn empty. */
export function monthlyVisitCounts(
  averages: DestinationAverages | null | undefined
): number[] | null {
  const source = averages?.months;
  if (!source || typeof source !== "object") return null;

  const byKey: CountMap = {};
  for (const [key, raw] of Object.entries(source)) {
    const count = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(count)) {
      const normalized = key.toLowerCase();
      byKey[normalized] = (byKey[normalized] || 0) + count;
    }
  }

  const counts = MONTH_KEYS.map((keys) =>
    keys.reduce((sum, key) => sum + (byKey[key] || 0), 0)
  );
  return counts.some((count) => count > 0) ? counts : null;
}

/** Indexes of the busiest month(s) — the one bar that earns the accent. */
export function peakMonthIndexes(counts: number[]): number[] {
  const max = Math.max(...counts, 0);
  if (max <= 0) return [];
  return counts.reduce<number[]>((peaks, count, index) => {
    if (count === max) peaks.push(index);
    return peaks;
  }, []);
}

/** Campsite/hut facts, in a fixed reading order, with every raw enum turned
 * into a word. Absent facts are left out, never printed as "Unknown". */
export function amenityRows(
  amenities: Amenities | null | undefined
): Array<{ label: string; value: string }> {
  if (!amenities) return [];
  const rows: Array<{ label: string; value: string }> = [];
  if (amenities.toilet) {
    rows.push({
      label: "Toilet",
      value: amenities.toilet === "none" ? "None" : titleize(amenities.toilet),
    });
  }
  if (amenities.drinking_water) {
    rows.push({ label: "Drinking water", value: titleize(amenities.drinking_water) });
  }
  if (amenities.shower != null) {
    rows.push({ label: "Showers", value: amenities.shower ? "Yes" : "No" });
  }
  if (amenities.fee) {
    rows.push({
      label: "Fee",
      value: amenities.fee.required ? amenities.fee.amount || "Required" : "None",
    });
  }
  if (amenities.reservation) {
    rows.push({
      label: "Reservation",
      value:
        amenities.reservation === "no" ? "Not needed" : titleize(amenities.reservation),
    });
  }
  if (amenities.capacity != null) {
    rows.push({ label: "Capacity", value: String(amenities.capacity) });
  }
  if (amenities.fire_pit != null) {
    rows.push({ label: "Fire pit", value: amenities.fire_pit ? "Yes" : "No" });
  }
  if (amenities.backcountry != null) {
    rows.push({
      label: "Setting",
      value: amenities.backcountry ? "Backcountry" : "Frontcountry",
    });
  }
  return rows;
}

/** The first paragraph of a trip report, clipped for a list row. Structural
 * block shape rather than the TripReport type, so this stays a plain module
 * and doesn't pull a "use server" file into the client bundle. */
export function reportPreview(
  blocks: Array<{ type: string; content?: string | null }> | null | undefined
): string | null {
  const textBlock = blocks?.find((block) => block.type === "text");
  const raw = textBlock?.content?.trim();
  if (!raw) return null;
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
}

export function formatShortDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Sidebar "Type" row text: the destination's most specific feature
 * ("summit" → "Summit"), or "Region" for an area-shaped destination. A
 * generic "point" with no features carries no information over the rest of
 * the page, so it returns null — the row is omitted rather than show
 * "Point". */
export function describeDestinationType(
  type: string,
  features: string[]
): string | null {
  const primaryFeature = features.find(Boolean);
  if (primaryFeature) {
    const spaced = primaryFeature.replace(/[-_]+/g, " ").trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
  if (type === "region") return "Region";
  return null;
}

export function getDestinationMapLinks(lat: number, lng: number) {
  const coords = `${lat},${lng}`;
  return {
    openStreetMap: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`,
    googleMaps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coords)}`,
  };
}

export function mergeDestinationAverages(
  averages: DestinationAverages | null,
  offset: DestinationAverages | null
): DestinationAverages | null {
  if (!offset) return averages;
  if (!averages) return offset;

  const averageRecord = averages;
  const offsetRecord = offset;
  const mergedMonths = mergeCountMaps(
    toCountMap(averageRecord.months),
    toCountMap(offsetRecord.months)
  );
  const mergedDays = mergeCountMaps(
    toCountMap(averageRecord.days || averageRecord.weekdays),
    toCountMap(offsetRecord.days || offsetRecord.weekdays)
  );

  return {
    ...averageRecord,
    ...offsetRecord,
    months: mergedMonths,
    days: mergedDays,
    weekdays: mergedDays,
  };
}

export function buildDestinationGuide(
  source: DestinationGuideSource,
  regionLabel: string | null,
  sessionCount: number
): {
  headline: string;
  paragraphs: string[];
  seasonalMonths: Array<{ label: string; count: number }>;
  seasonalDays: Array<{ label: string; count: number }>;
  badges: string[];
} {
  const primaryFeature = source.features.find(Boolean);
  const featureWord =
    source.type === "region"
      ? "region"
      : primaryFeature
        ? primaryFeature.replace(/[-_]+/g, " ")
        : "destination";
  const article = /^[aeiou]/i.test(featureWord) ? "an" : "a";

  const paragraphs: string[] = [];
  // Elevation and prominence are intentionally left out here — they're
  // already the first two cells in the stat row above this copy.
  const headline = `${source.name || "This destination"} is ${article} ${featureWord}${regionLabel ? ` in ${regionLabel}` : ""}.`;

  const secondaryFeatures = source.features
    .filter(Boolean)
    .slice(1)
    .map((feature) => feature.replace(/[-_]+/g, " "));
  const activityText = joinNames(
    source.activities.filter(Boolean).map((a) => ACTIVITY_LABELS[a] || a)
  );
  // Only claim an activity happens here when there's recorded activity to
  // back it up — otherwise this is a configured-but-unused activity type,
  // not something that's actually true of the destination yet.
  if (sessionCount > 0 && secondaryFeatures.length > 0 && activityText) {
    paragraphs.push(
      `It doubles as a ${joinNames(secondaryFeatures)}, and most of the activity recorded here is ${activityText}.`
    );
  } else if (sessionCount > 0 && activityText) {
    paragraphs.push(`Most of the activity recorded here is ${activityText}.`);
  }

  const seasonalMonths = normalizeSeasonalMap(source.averages?.months, MONTH_LABELS);
  const seasonalDays = normalizeSeasonalMap(
    source.averages?.days || source.averages?.weekdays,
    DAY_LABELS
  );

  if (seasonalMonths.length > 0) {
    const topMonths = seasonalMonths.slice(0, 2).map((entry) => entry.label);
    paragraphs.push(`Traffic peaks in ${joinNames(topMonths)}.`);
  }

  return {
    headline,
    paragraphs,
    seasonalMonths,
    seasonalDays,
    badges: [
      source.type,
      ...(source.explicitly_saved ? ["saved"] : []),
      ...(source.features || []),
      ...(source.activities || []),
    ].filter(Boolean),
  };
}
