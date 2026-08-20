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
