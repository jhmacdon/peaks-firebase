// Pure geometry for the session-comparison checkpoint/corridor model.
// NO database access in this file — everything operates on plain arrays so it
// is unit-testable and shared verbatim by processSession, the backfill script,
// and the legs recompute script. Params live in comparison-params.ts.

/** Raw row shape from the tracking_points loader (see comparisons.ts). */
export interface RawPointRow {
  time: number;              // unix ms (BIGINT → Number via global parser)
  lat: number;
  lng: number;
  elevation: number | null;
  speed: number | null;      // m/s
}

export interface SamplePoint {
  timeMs: number;
  lat: number;
  lng: number;
  elevM: number | null;
  speedMps: number | null;
  cumM: number;              // cumulative meters over KEPT samples
}

const EARTH_R = 6_371_000;
const RAD = Math.PI / 180;

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLng = (bLng - aLng) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

/**
 * Downsample raw points to ~spacingM spacing, computing cumulative traveled
 * meters over the kept samples. The first and last raw points are always kept
 * so window edges land on real timestamps.
 */
export function sampleTrack(rows: RawPointRow[], spacingM: number): SamplePoint[] {
  const out: SamplePoint[] = [];
  let cum = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (out.length === 0) {
      out.push({ timeMs: r.time, lat: r.lat, lng: r.lng, elevM: r.elevation, speedMps: r.speed, cumM: 0 });
      continue;
    }
    const prev = out[out.length - 1];
    const d = haversineM(prev.lat, prev.lng, r.lat, r.lng);
    const isLast = i === rows.length - 1;
    // 1% tolerance guards against degree/meter conversion round-trips (e.g.
    // synthetic tracks built from a fixed m-per-degree constant) landing a
    // hair under an exact spacing multiple and skipping an extra point.
    if (d >= spacingM * 0.99 || isLast) {
      cum = prev.cumM + d;
      out.push({ timeMs: r.time, lat: r.lat, lng: r.lng, elevM: r.elevation, speedMps: r.speed, cumM: cum });
    }
  }
  return out;
}

/**
 * Uniform-grid spatial hash over sample points for O(1) radius lookups.
 * Cell size = radius, so any point within `radiusM` of a query is in the
 * query's 3×3 cell neighborhood.
 */
export class SpatialIndex {
  private cells = new Map<string, SamplePoint[]>();
  private cellDegLat: number;
  private cosLat: number;

  constructor(pts: SamplePoint[], private radiusM: number) {
    this.cellDegLat = radiusM / 111_320;
    this.cosLat = Math.max(0.01, Math.cos((pts[0]?.lat ?? 0) * RAD));
    for (const p of pts) {
      const key = this.key(p.lat, p.lng);
      const arr = this.cells.get(key);
      if (arr) arr.push(p);
      else this.cells.set(key, [p]);
    }
  }

  private key(lat: number, lng: number): string {
    const r = Math.floor(lat / this.cellDegLat);
    const c = Math.floor((lng * this.cosLat) / this.cellDegLat);
    return `${r}:${c}`;
  }

  /** Nearest indexed point within radiusM of (lat,lng), or null. */
  near(lat: number, lng: number, radiusM: number): SamplePoint | null {
    const r0 = Math.floor(lat / this.cellDegLat);
    const c0 = Math.floor((lng * this.cosLat) / this.cellDegLat);
    let best: SamplePoint | null = null;
    let bestD = Infinity;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const bucket = this.cells.get(`${r0 + dr}:${c0 + dc}`);
        if (!bucket) continue;
        for (const p of bucket) {
          const d = haversineM(lat, lng, p.lat, p.lng);
          if (d <= radiusM && d < bestD) {
            best = p;
            bestD = d;
          }
        }
      }
    }
    return best;
  }
}

export interface CorridorParams {
  CORRIDOR_OVERLAP_RADIUS_M: number;
  OUT_AND_BACK_OVERLAP_FRAC: number;
  OUT_AND_BACK_CLOSURE_M: number;
}

export interface Corridor {
  pts: SamplePoint[];
  lengthM: number;
  isOutAndBack: boolean;
}

/**
 * Collapse an out-and-back track to its outbound half so checkpoints don't
 * double back over the same ground. A track is out-and-back when it ends near
 * where it started AND most of the return half lies within the corridor of the
 * outbound half. Loops (return on different ground) and point-to-points keep
 * their full line. The apex (turnaround) is the sample geodesically farthest
 * from the start — robust for summit hikes regardless of GPS noise.
 */
export function collapseOutAndBack(samples: SamplePoint[], params: CorridorParams): Corridor {
  if (samples.length < 4) {
    return { pts: samples, lengthM: samples.length ? samples[samples.length - 1].cumM : 0, isOutAndBack: false };
  }
  const start = samples[0];
  const end = samples[samples.length - 1];
  const closed = haversineM(start.lat, start.lng, end.lat, end.lng) < params.OUT_AND_BACK_CLOSURE_M;
  if (!closed) {
    return { pts: samples, lengthM: end.cumM, isOutAndBack: false };
  }
  let apexIdx = 0;
  let apexD = -1;
  for (let i = 0; i < samples.length; i++) {
    const d = haversineM(start.lat, start.lng, samples[i].lat, samples[i].lng);
    if (d > apexD) {
      apexD = d;
      apexIdx = i;
    }
  }
  const outbound = samples.slice(0, apexIdx + 1);
  const ret = samples.slice(apexIdx + 1);
  if (outbound.length < 2 || ret.length < 2) {
    return { pts: samples, lengthM: end.cumM, isOutAndBack: false };
  }
  const idx = new SpatialIndex(outbound, params.CORRIDOR_OVERLAP_RADIUS_M);
  let overlapping = 0;
  for (const p of ret) {
    if (idx.near(p.lat, p.lng, params.CORRIDOR_OVERLAP_RADIUS_M)) overlapping++;
  }
  if (overlapping / ret.length >= params.OUT_AND_BACK_OVERLAP_FRAC) {
    return { pts: outbound, lengthM: outbound[outbound.length - 1].cumM, isOutAndBack: true };
  }
  return { pts: samples, lengthM: end.cumM, isOutAndBack: false };
}

export interface Checkpoint {
  lat: number;
  lng: number;
  m: number;        // meters from corridor start
  elevM: number | null;
}

/** Lay checkpoints every spacingM along the corridor, interpolating between samples. */
export function buildCheckpoints(corridor: Corridor, spacingM: number): Checkpoint[] {
  const pts = corridor.pts;
  const out: Checkpoint[] = [];
  if (pts.length === 0) return out;
  let target = 0;
  let i = 1;
  while (target <= corridor.lengthM && i < pts.length) {
    while (i < pts.length && pts[i].cumM < target) i++;
    if (i >= pts.length) break;
    const a = pts[i - 1];
    const b = pts[i];
    const span = b.cumM - a.cumM;
    const t = span > 0 ? (target - a.cumM) / span : 0;
    out.push({
      lat: a.lat + (b.lat - a.lat) * t,
      lng: a.lng + (b.lng - a.lng) * t,
      m: target,
      elevM: a.elevM !== null && b.elevM !== null ? a.elevM + (b.elevM - a.elevM) * t : a.elevM,
    });
    target += spacingM;
  }
  return out;
}
