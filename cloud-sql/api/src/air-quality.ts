// Pure air-quality logic for GET /api/plans/:id/air-quality: EPA PM2.5
// categories, HRRR grid-cell snapping, and the HRRR-Smoke/CAMS hourly merge.
// No I/O — everything here is deterministic and unit-tested.
// Design: docs/superpowers/specs/2026-08-06-plan-air-quality-design.md

export type AqCategory =
  | "good"
  | "moderate"
  | "unhealthy_sensitive"
  | "unhealthy"
  | "very_unhealthy"
  | "hazardous";

// EPA 2024 PM2.5 breakpoints (µg/m³), applied per hour. The official index
// averages over 24 h (NowCast); per-hour application is the standard display
// simplification and slightly conservative during sharp smoke peaks.
export function pm25Category(pm25: number): AqCategory {
  if (pm25 <= 9.0) return "good";
  if (pm25 <= 35.4) return "moderate";
  if (pm25 <= 55.4) return "unhealthy_sensitive";
  if (pm25 <= 125.4) return "unhealthy";
  if (pm25 <= 225.4) return "very_unhealthy";
  return "hazardous";
}

// ~3 km grid cells so nearby plans share one HRRR sample. Keep in sync with
// cloud-sql/smoke-job/src/hrrr.ts (duplicated: separate npm packages; both
// sides pin identical golden test vectors).
export const CELL_SIZE_DEG = 0.03;

export interface Cell {
  cellKey: string;
  lat: number;
  lng: number;
}

export function snapToCell(lat: number, lng: number): Cell {
  const latIdx = Math.round(lat / CELL_SIZE_DEG);
  const lngIdx = Math.round(lng / CELL_SIZE_DEG);
  return {
    cellKey: `${latIdx}:${lngIdx}`,
    lat: latIdx * CELL_SIZE_DEG,
    lng: lngIdx * CELL_SIZE_DEG,
  };
}

// Approximate HRRR CONUS domain. Outside it the smoke job never samples, so
// the endpoint serves CAMS only.
export function isInHrrrConus(lat: number, lng: number): boolean {
  return lat >= 21 && lat <= 53 && lng >= -134 && lng <= -60;
}

export interface HrrrRow {
  validAtSec: number; // unix seconds, top of hour (UTC instant)
  smokeUgM3: number;
  runAtIso: string; // HRRR cycle time as ISO UTC
}

export interface CamsData {
  timezone: string;
  utcOffsetSeconds: number;
  timesSec: number[]; // unix seconds, top of hour
  pm25: (number | null)[];
  usAqi: (number | null)[];
}

export interface AqHour {
  time: string; // local ISO8601 with offset
  source: "hrrr_smoke" | "cams";
  pm25: number;
  category: AqCategory;
}

export interface AqDay {
  date: string; // local YYYY-MM-DD
  source: "hrrr_smoke" | "cams" | "mixed";
  pm25Max: number;
  usAqiMax: number | null;
  category: AqCategory;
  isPlanDay: boolean;
  hours: AqHour[];
}

export interface AirQualityResponse {
  available: boolean;
  reason?: string;
  point?: { lat: number; lng: number };
  timezone?: string;
  planDate?: string | null;
  planDayBeyondHorizon?: boolean;
  days?: AqDay[];
  sources?: { hrrrRun: string | null; cams: boolean };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function offsetSuffix(offsetSeconds: number): string {
  const sign = offsetSeconds < 0 ? "-" : "+";
  const abs = Math.abs(offsetSeconds);
  return `${sign}${pad2(Math.floor(abs / 3600))}:${pad2(Math.floor((abs % 3600) / 60))}`;
}

function localDate(sec: number, offsetSeconds: number): string {
  return new Date((sec + offsetSeconds) * 1000).toISOString().slice(0, 10);
}

function localIso(sec: number, offsetSeconds: number): string {
  return (
    new Date((sec + offsetSeconds) * 1000).toISOString().slice(0, 19) +
    offsetSuffix(offsetSeconds)
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function buildAirQualityResponse(opts: {
  point: { lat: number; lng: number };
  hrrrRows: HrrrRow[];
  cams: CamsData | null;
  planDateSec: number | null;
  nowSec: number;
}): AirQualityResponse {
  const { point, hrrrRows, cams, planDateSec, nowSec } = opts;

  // CAMS supplies the timezone; without it fall back to a crude
  // longitude-derived offset (degraded path, only when Open-Meteo is down).
  const offset = cams
    ? cams.utcOffsetSeconds
    : Math.round(point.lng / 15) * 3600;
  const timezone = cams
    ? cams.timezone
    : `UTC${offset >= 0 ? "+" : "-"}${Math.abs(offset / 3600)}`;

  // Hours from local midnight today onward. CAMS first, HRRR overwrites
  // (higher fidelity inside its 48 h window).
  const startOfToday = Math.floor((nowSec + offset) / 86400) * 86400 - offset;
  const hours = new Map<
    number,
    { source: "hrrr_smoke" | "cams"; pm25: number; usAqi: number | null }
  >();
  if (cams) {
    for (let i = 0; i < cams.timesSec.length; i++) {
      const t = cams.timesSec[i];
      const pm = cams.pm25[i];
      if (t < startOfToday || pm === null || pm === undefined) continue;
      hours.set(t, { source: "cams", pm25: pm, usAqi: cams.usAqi[i] ?? null });
    }
  }
  let hrrrRun: string | null = null;
  for (const row of hrrrRows) {
    if (row.validAtSec < startOfToday) continue;
    hours.set(row.validAtSec, {
      source: "hrrr_smoke",
      pm25: row.smokeUgM3,
      usAqi: null,
    });
    if (!hrrrRun || row.runAtIso > hrrrRun) hrrrRun = row.runAtIso;
  }

  if (hours.size === 0) {
    return { available: false, reason: "upstream_unavailable" };
  }

  const planDate = planDateSec === null ? null : localDate(planDateSec, offset);

  const dayMap = new Map<
    string,
    {
      hours: AqHour[];
      pm25Max: number;
      usAqiMax: number | null;
      sources: Set<"hrrr_smoke" | "cams">;
    }
  >();
  const sorted = [...hours.entries()].sort((a, b) => a[0] - b[0]);
  for (const [t, h] of sorted) {
    const date = localDate(t, offset);
    let day = dayMap.get(date);
    if (!day) {
      day = { hours: [], pm25Max: 0, usAqiMax: null, sources: new Set() };
      dayMap.set(date, day);
    }
    day.hours.push({
      time: localIso(t, offset),
      source: h.source,
      pm25: round1(h.pm25),
      category: pm25Category(h.pm25),
    });
    day.pm25Max = Math.max(day.pm25Max, h.pm25);
    if (h.usAqi !== null) {
      day.usAqiMax = day.usAqiMax === null ? h.usAqi : Math.max(day.usAqiMax, h.usAqi);
    }
    day.sources.add(h.source);
  }

  const days: AqDay[] = [...dayMap.entries()].map(([date, d]) => ({
    date,
    source:
      d.sources.size > 1
        ? "mixed"
        : d.sources.has("hrrr_smoke")
          ? "hrrr_smoke"
          : "cams",
    pm25Max: round1(d.pm25Max),
    usAqiMax: d.usAqiMax,
    category: pm25Category(d.pm25Max),
    isPlanDay: planDate !== null && date === planDate,
    hours: d.hours,
  }));

  const lastDate = days[days.length - 1].date;
  return {
    available: true,
    point,
    timezone,
    planDate,
    planDayBeyondHorizon: planDate !== null && planDate > lastDate,
    days,
    sources: { hrrrRun, cams: cams !== null },
  };
}
