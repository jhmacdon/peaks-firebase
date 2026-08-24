export const AIRNOW_SOURCE = {
  id: "airnow",
  name: "U.S. EPA AirNow",
  url: "https://www.airnow.gov/",
  dataUrl: "https://files.airnowtech.org/airnow/today/reportingarea.dat",
  termsUrl: "https://docs.airnowapi.org/docs/DataUseGuidelines.pdf",
  attribution: "Participating air agencies and U.S. EPA AirNow • Preliminary",
  preliminary: true,
  precision: "reporting_area_centroid",
  precisionNote:
    "Regional reporting-area value shown at its source centroid; not conditions at this exact point.",
  coverageRegion: "US",
  standard: "us_epa_aqi",
  fileRefreshMinutesPastHour: [25, 55],
  observationCadence: "hourly",
} as const;

export const AIR_QUALITY_CATEGORY_IDS = [
  "good",
  "moderate",
  "unhealthy_sensitive_groups",
  "unhealthy",
  "very_unhealthy",
  "hazardous",
] as const;

export type AirQualityCategoryId = (typeof AIR_QUALITY_CATEGORY_IDS)[number];

export interface AirQualityCategory {
  id: AirQualityCategoryId;
  label: string;
  sourceValue: string;
}

export interface AirQualityReportingArea {
  id: string;
  name: string;
  kind: "reporting_area";
  geometry: {
    type: "Point";
    coordinates: [longitude: number, latitude: number];
  };
  aqi: number;
  category: AirQualityCategory;
  dominantPollutant: string | null;
  observedAt: {
    date: string;
    time: string;
    timeZone: string;
  } | null;
  sourceAgency: string | null;
}

export type AirNowLineResult =
  | { kind: "observation"; reportingArea: AirQualityReportingArea }
  | { kind: "ignored" }
  | { kind: "malformed"; reason: string };

export interface AirNowFileResult {
  reportingAreas: AirQualityReportingArea[];
  ignoredRowCount: number;
  malformedRowCount: number;
}

const CATEGORY_IDS: Record<string, AirQualityCategoryId> = {
  good: "good",
  moderate: "moderate",
  "unhealthy for sensitive groups": "unhealthy_sensitive_groups",
  unhealthy: "unhealthy",
  "very unhealthy": "very_unhealthy",
  hazardous: "hazardous",
};

const US_REGION_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "AS", "GU", "MP", "PR", "VI",
]);

// This is only a malformed-input guard. Hazardous AQI values above 500 remain
// valid; Peaks never derives a category or AQI from a pollutant concentration.
const MAX_PLAUSIBLE_SOURCE_AQI = 10_000;
const SOURCE_DECIMAL = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;

function parseSourceDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = 2000 + Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year.toString().padStart(4, "0")}-${match[1]}-${match[2]}`;
}

function parseSourceTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? value : null;
}

function parseFiniteDecimal(value: string): number | null {
  const normalized = value.trim();
  if (!SOURCE_DECIMAL.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function reportingAreaId(stateCode: string, name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `airnow:${stateCode.toLowerCase()}:${slug}`;
}

function categoryForReportedAqi(aqi: number): AirQualityCategoryId {
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "unhealthy_sensitive_groups";
  if (aqi <= 200) return "unhealthy";
  if (aqi <= 300) return "very_unhealthy";
  return "hazardous";
}

/**
 * Parses one AirNow reportingarea.dat row. Only sequence-0, observed, primary
 * pollutant rows become map records. AQI, category, pollutant, time, centroid,
 * and source agency all pass through from AirNow; no AQI is calculated here.
 */
export function parseAirNowReportingAreaLine(line: string): AirNowLineResult {
  if (line.trim() === "") return { kind: "ignored" };

  const fields = line.replace(/\r$/, "").split("|");
  if (fields.length !== 17) return { kind: "malformed", reason: "field_count" };

  const sequence = fields[4].trim();
  const dataType = fields[5].trim();
  const primary = fields[6].trim();
  if (sequence !== "0" || dataType !== "O" || primary !== "Y") {
    return { kind: "ignored" };
  }

  const issuedDate = parseSourceDate(fields[0].trim());
  const observedDate = parseSourceDate(fields[1].trim());
  const observedTime = parseSourceTime(fields[2].trim());
  const timeZone = fields[3].trim();
  const name = fields[7].trim();
  const stateCode = fields[8].trim().toUpperCase();
  if (!US_REGION_CODES.has(stateCode)) return { kind: "ignored" };
  const latitude = parseFiniteDecimal(fields[9]);
  const longitude = parseFiniteDecimal(fields[10]);
  const pollutant = fields[11].trim();
  const aqi = parseFiniteDecimal(fields[12]);
  const sourceCategory = fields[13].trim();
  const categoryId = CATEGORY_IDS[sourceCategory.toLowerCase()];
  const sourceAgency = fields[16].trim();

  if (!issuedDate || !observedDate || !observedTime || !/^[A-Z]{3}$/.test(timeZone)) {
    return { kind: "malformed", reason: "observation_time" };
  }
  if (!name || !/^[A-Z0-9-]{2,3}$/.test(stateCode)) {
    return { kind: "malformed", reason: "reporting_area" };
  }
  if (latitude === null || latitude < -90 || latitude > 90) {
    return { kind: "malformed", reason: "latitude" };
  }
  if (longitude === null || longitude < -180 || longitude > 180) {
    return { kind: "malformed", reason: "longitude" };
  }
  if (
    aqi === null ||
    !Number.isSafeInteger(aqi) ||
    aqi < 0 ||
    aqi > MAX_PLAUSIBLE_SOURCE_AQI
  ) {
    return { kind: "malformed", reason: "aqi" };
  }
  if (!categoryId || !sourceCategory) {
    return { kind: "malformed", reason: "category" };
  }
  if (categoryForReportedAqi(aqi) !== categoryId) {
    return { kind: "malformed", reason: "category_mismatch" };
  }
  if (!pollutant || !sourceAgency) {
    return { kind: "malformed", reason: "source" };
  }

  return {
    kind: "observation",
    reportingArea: {
      id: reportingAreaId(stateCode, name),
      name,
      kind: "reporting_area",
      geometry: { type: "Point", coordinates: [longitude, latitude] },
      aqi,
      category: { id: categoryId, label: sourceCategory, sourceValue: sourceCategory },
      dominantPollutant: pollutant,
      observedAt: { date: observedDate, time: observedTime, timeZone },
      sourceAgency,
    },
  };
}

export function parseAirNowReportingAreaFile(contents: string): AirNowFileResult {
  const reportingAreas: AirQualityReportingArea[] = [];
  let ignoredRowCount = 0;
  let malformedRowCount = 0;

  for (const line of contents.split("\n")) {
    const result = parseAirNowReportingAreaLine(line);
    if (result.kind === "observation") reportingAreas.push(result.reportingArea);
    else if (result.kind === "ignored") ignoredRowCount += 1;
    else malformedRowCount += 1;
  }

  reportingAreas.sort((left, right) => left.id.localeCompare(right.id));
  return { reportingAreas, ignoredRowCount, malformedRowCount };
}
