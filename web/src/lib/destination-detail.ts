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
  country_code: string | null;
  state_code: string | null;
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

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
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
  routeCount: number,
  listCount: number,
  sessionCount: number,
  tripReportCount: number
): {
  headline: string;
  paragraphs: string[];
  seasonalMonths: Array<{ label: string; count: number }>;
  seasonalDays: Array<{ label: string; count: number }>;
  badges: string[];
} {
  const locationParts = [source.state_code, source.country_code].filter(Boolean);
  const featureText = joinNames(source.features.filter(Boolean));
  const activityText = joinNames(source.activities.filter(Boolean));
  const descriptiveType = source.type === "region" ? "region" : "point";
  const elevationText = source.elevation != null ? `, rising to ${formatFeet(source.elevation)}` : "";

  const paragraphs: string[] = [];
  const headline = `${source.name || "This destination"} is a ${descriptiveType} guide${locationParts.length ? ` in ${locationParts.join(", ")}` : ""}${elevationText}.`;

  if (featureText && activityText) {
    paragraphs.push(
      `It is tagged with ${featureText} and most often appears in ${activityText} planning context.`
    );
  } else if (featureText) {
    paragraphs.push(`It is tagged with ${featureText}.`);
  } else if (activityText) {
    paragraphs.push(`It most often appears in ${activityText} planning context.`);
  }

  const contextBits: string[] = [];
  if (routeCount > 0) {
    contextBits.push(`${formatNumber(routeCount)} linked route${routeCount === 1 ? "" : "s"}`);
  }
  if (listCount > 0) {
    contextBits.push(`${formatNumber(listCount)} curated list${listCount === 1 ? "" : "s"}`);
  }
  if (sessionCount > 0) {
    contextBits.push(`${formatNumber(sessionCount)} recorded session${sessionCount === 1 ? "" : "s"}`);
  }
  if (tripReportCount > 0) {
    contextBits.push(`${formatNumber(tripReportCount)} trip report${tripReportCount === 1 ? "" : "s"}`);
  }
  if (contextBits.length > 0) {
    paragraphs.push(`Public activity around this destination includes ${joinNames(contextBits)}.`);
  }

  const seasonalMonths = normalizeSeasonalMap(source.averages?.months, MONTH_LABELS);
  const seasonalDays = normalizeSeasonalMap(
    source.averages?.days || source.averages?.weekdays,
    DAY_LABELS
  );

  if (seasonalMonths.length > 0) {
    const topMonths = seasonalMonths.slice(0, 3).map((entry) => entry.label);
    paragraphs.push(`Seasonality data points most strongly toward ${joinNames(topMonths)}.`);
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
