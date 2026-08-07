// Pure HRRR-Smoke helpers: cycle discovery, S3 URLs, .idx sidecar parsing,
// grib_get output parsing, and grid-cell snapping. No I/O here.
// Design: docs/superpowers/specs/2026-08-06-plan-air-quality-design.md

// ~3 km grid cells. Keep in sync with cloud-sql/api/src/air-quality.ts
// (duplicated: separate npm packages; both pin identical golden vectors).
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

// Approximate HRRR CONUS domain.
export function isInHrrrConus(lat: number, lng: number): boolean {
  return lat >= 21 && lat <= 53 && lng >= -134 && lng <= -60;
}

export interface HrrrCycle {
  ymd: string; // "20260806"
  hour: number; // 0 | 6 | 12 | 18
}

const BUCKET = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com";

export function gribUrl(c: HrrrCycle, fh: number): string {
  const hh = String(c.hour).padStart(2, "0");
  const ff = String(fh).padStart(2, "0");
  return `${BUCKET}/hrrr.${c.ymd}/conus/hrrr.t${hh}z.wrfsfcf${ff}.grib2`;
}

export function idxUrl(c: HrrrCycle, fh: number): string {
  return `${gribUrl(c, fh)}.idx`;
}

export function cycleTimeSec(c: HrrrCycle): number {
  return (
    Date.UTC(
      Number(c.ymd.slice(0, 4)),
      Number(c.ymd.slice(4, 6)) - 1,
      Number(c.ymd.slice(6, 8)),
      c.hour
    ) / 1000
  );
}

// 48-hour cycles run at 00/06/12/18 UTC and land on S3 roughly 2 h later.
// Newest-first candidates covering the last 30 h.
export function candidateCycles(nowSec: number): HrrrCycle[] {
  const out: HrrrCycle[] = [];
  for (let back = 0; back <= 30 * 3600; back += 3600) {
    const t = new Date((nowSec - back) * 1000);
    if (t.getUTCHours() % 6 !== 0) continue;
    out.push({
      ymd: t.toISOString().slice(0, 10).replace(/-/g, ""),
      hour: t.getUTCHours(),
    });
  }
  return out;
}

// .idx sidecar lines: "N:byteStart:d=YYYYMMDDHH:VAR:level:fcst:".
export interface ByteRange {
  start: number;
  end: number | null; // null → open-ended (last record in the file)
}

export function findMassdenRange(idxText: string): ByteRange | null {
  const lines = idxText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(":");
    if (parts[3] === "MASSDEN" && parts[4] === "8 m above ground") {
      const start = parseInt(parts[1], 10);
      const nextStart = lines[i + 1]?.split(":")[1];
      return { start, end: nextStart ? parseInt(nextStart, 10) - 1 : null };
    }
  }
  return null;
}

export function rangeHeader(r: ByteRange): string {
  return r.end === null ? `bytes=${r.start}-` : `bytes=${r.start}-${r.end}`;
}

// grib_get -l lat,lng,1 prints the nearest-gridpoint value as a bare number.
export function parseGribGetValue(stdout: string): number {
  const v = parseFloat(stdout.trim().split(/\s+/)[0]);
  if (!Number.isFinite(v)) {
    throw new Error(`unparseable grib_get output: ${stdout.slice(0, 120)}`);
  }
  return v;
}

// MASSDEN arrives in kg/m³; we store µg/m³.
export const KG_M3_TO_UG_M3 = 1e9;
