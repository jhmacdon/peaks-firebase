// Pure HRRR-Smoke helpers: cycle discovery, S3 URLs, .idx sidecar parsing,
// grid indexing, IEEE GRIB2 value reads, and grid-cell snapping. No I/O here.
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

// HRRR CONUS 3 km Lambert conformal grid (GRIB2 template 3.30, spherical
// earth, scanning mode 64: rows run south→north, columns west→east). The job
// checks these against each run's GRIB metadata before trusting gridIndex.
export const HRRR_GRID = {
  nx: 1799,
  ny: 1059,
  firstLat: 21.138123,
  firstLng: 237.280472,
  lov: 262.5,
  latin: 38.5,
  dxMetres: 3000,
  earthRadiusMetres: 6371229,
} as const;

// grib_get -p order used by the job to read the grid metadata.
export const HRRR_GRID_KEYS = [
  "Nx",
  "Ny",
  "latitudeOfFirstGridPointInDegrees",
  "longitudeOfFirstGridPointInDegrees",
  "LoVInDegrees",
  "Latin1InDegrees",
  "Latin2InDegrees",
  "DxInMetres",
  "DyInMetres",
  "scanningMode",
];

export function gridMatchesHrrr(gribGetOutput: string): boolean {
  const v = gribGetOutput.trim().split(/\s+/).map(Number);
  const g = HRRR_GRID;
  const expected = [g.nx, g.ny, g.firstLat, g.firstLng, g.lov, g.latin, g.latin, g.dxMetres, g.dxMetres, 64];
  // grib_get prints doubles with ~6 significant digits (237.280472 → 237.28).
  return v.length === expected.length && expected.every((e, i) => Math.abs(v[i] - e) < 1e-3);
}

const RAD = Math.PI / 180;
const CONE = Math.sin(HRRR_GRID.latin * RAD);
const RHO_SCALE =
  (HRRR_GRID.earthRadiusMetres * Math.cos(HRRR_GRID.latin * RAD) *
    Math.tan(Math.PI / 4 + (HRRR_GRID.latin * RAD) / 2) ** CONE) / CONE;

function lambertXY(lat: number, lng: number): { x: number; y: number } {
  const rho = RHO_SCALE / Math.tan(Math.PI / 4 + (lat * RAD) / 2) ** CONE;
  let dLng = lng - HRRR_GRID.lov;
  dLng -= 360 * Math.round(dLng / 360);
  const theta = CONE * dLng * RAD;
  return { x: rho * Math.sin(theta), y: -rho * Math.cos(theta) };
}

const FIRST_POINT = lambertXY(HRRR_GRID.firstLat, HRRR_GRID.firstLng);

// Flat index into the GRIB values array of the grid point nearest
// (lat, lng), or null outside the grid. Replaces a per-hour grib_get -l
// nearest search (~260 ms each) with arithmetic.
export function gridIndex(lat: number, lng: number): number | null {
  const p = lambertXY(lat, lng);
  const i = Math.round((p.x - FIRST_POINT.x) / HRRR_GRID.dxMetres);
  const j = Math.round((p.y - FIRST_POINT.y) / HRRR_GRID.dxMetres);
  if (i < 0 || i >= HRRR_GRID.nx || j < 0 || j >= HRRR_GRID.ny) return null;
  return j * HRRR_GRID.nx + i;
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

// Values of a single-message GRIB2 file repacked by
// `grib_set -r -s packingType=grid_ieee`: 32-bit big-endian floats in
// section 7, one per grid point in scan order. One decode serves every cell.
export function readIeeeGrib2Values(grib: Buffer): (index: number) => number {
  if (grib.toString("ascii", 0, 4) !== "GRIB" || grib[7] !== 2) {
    throw new Error("not a GRIB2 message");
  }
  let offset = 16;
  let pointCount = -1;
  while (offset + 5 <= grib.length && grib.toString("ascii", offset, offset + 4) !== "7777") {
    const length = grib.readUInt32BE(offset);
    const section = grib[offset + 4];
    if (section === 5) {
      pointCount = grib.readUInt32BE(offset + 5);
      const template = grib.readUInt16BE(offset + 9);
      const precision = grib[offset + 11];
      if (template !== 4 || precision !== 1) {
        throw new Error(`expected 32-bit IEEE packing, got template ${template} precision ${precision}`);
      }
    } else if (section === 6 && grib[offset + 5] !== 255) {
      throw new Error("bitmapped GRIB2 fields are not supported");
    } else if (section === 7) {
      if (pointCount < 0) throw new Error("GRIB2 data section before representation section");
      const dataStart = offset + 5;
      if (length - 5 < pointCount * 4) throw new Error("GRIB2 data section is truncated");
      return (index: number) => {
        if (!Number.isInteger(index) || index < 0 || index >= pointCount) {
          throw new Error(`grid index ${index} outside 0..${pointCount - 1}`);
        }
        return grib.readFloatBE(dataStart + index * 4);
      };
    }
    if (length < 5) throw new Error("corrupt GRIB2 section length");
    offset += length;
  }
  throw new Error("GRIB2 message has no data section");
}

// MASSDEN arrives in kg/m³; we store µg/m³.
export const KG_M3_TO_UG_M3 = 1e9;
