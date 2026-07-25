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
  // Candidate turnarounds. Max radial distance is right for straight spokes,
  // but a trail that hooks (Crystal Peak: up the valley past the summit's
  // bearing, then back to it) puts the farthest-from-start sample
  // mid-outbound, not at the turnaround — and splitting there strands the
  // real upper half in the "return" slice, failing the overlap gate. The
  // distance midpoint and the highest sample ARE the turnaround on exactly
  // those tracks. Score every candidate by its return-retraces-outbound
  // fraction and keep the best; OUT_AND_BACK_OVERLAP_FRAC stays the sole
  // arbiter of whether the track collapses at all.
  let radIdx = 0;
  let radD = -1;
  let midIdx = 0;
  let midD = Infinity;
  let elevIdx = -1;
  for (let i = 0; i < samples.length; i++) {
    const d = haversineM(start.lat, start.lng, samples[i].lat, samples[i].lng);
    if (d > radD) {
      radD = d;
      radIdx = i;
    }
    const dm = Math.abs(samples[i].cumM - end.cumM / 2);
    if (dm < midD) {
      midD = dm;
      midIdx = i;
    }
    const e = samples[i].elevM;
    if (e !== null && (elevIdx === -1 || e > (samples[elevIdx].elevM as number))) elevIdx = i;
  }
  let best: { frac: number; outbound: SamplePoint[] } | null = null;
  for (const apexIdx of new Set([radIdx, midIdx, elevIdx])) {
    if (apexIdx < 1 || apexIdx > samples.length - 3) continue; // need ≥2 samples on each side
    const outbound = samples.slice(0, apexIdx + 1);
    const ret = samples.slice(apexIdx + 1);
    const idx = new SpatialIndex(outbound, params.CORRIDOR_OVERLAP_RADIUS_M);
    let overlapping = 0;
    for (const p of ret) {
      if (idx.near(p.lat, p.lng, params.CORRIDOR_OVERLAP_RADIUS_M)) overlapping++;
    }
    const frac = overlapping / ret.length;
    if (!best || frac > best.frac) best = { frac, outbound };
  }
  if (best && best.frac >= params.OUT_AND_BACK_OVERLAP_FRAC) {
    const outbound = best.outbound;
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

export interface Crossing {
  firstMs: number;
  lastMs: number;
  firstCumM: number;
  lastCumM: number;
}

/**
 * For each checkpoint, the first and last time this session's samples pass
 * within radiusM of it (null = never). Single forward scan with a spatial
 * index over the CHECKPOINTS (few hundred at most).
 */
export function computeCrossings(
  samples: SamplePoint[],
  checkpoints: Checkpoint[],
  radiusM: number
): (Crossing | null)[] {
  const out: (Crossing | null)[] = checkpoints.map(() => null);
  // Index checkpoints by grid; map back to indices.
  const cpAsSamples: SamplePoint[] = checkpoints.map((c, i) => ({
    timeMs: i, lat: c.lat, lng: c.lng, elevM: c.elevM, speedMps: null, cumM: c.m,
  }));
  const idx = new SpatialIndex(cpAsSamples, radiusM);
  for (const s of samples) {
    // nearest checkpoint within radius; also check its immediate neighbors so a
    // sample equidistant between two checkpoints credits the truly nearest one.
    const hit = idx.near(s.lat, s.lng, radiusM);
    if (!hit) continue;
    const ci = hit.timeMs; // index smuggled through timeMs
    const cur = out[ci];
    if (!cur) {
      out[ci] = { firstMs: s.timeMs, lastMs: s.timeMs, firstCumM: s.cumM, lastCumM: s.cumM };
    } else {
      cur.lastMs = s.timeMs;
      cur.lastCumM = s.cumM;
    }
  }
  return out;
}

export interface SideWindow {
  enterMs: number;
  exitMs: number;
  startM: number;   // this side's cumulative traveled meters at enter
  endM: number;     // ... at exit
  outAndBack: boolean;
}

export interface OverlapResult {
  cpStart: number;
  cpEnd: number;            // inclusive
  overlapM: number;
  scope: "full" | "outbound";
  a: SideWindow;
  b: SideWindow;
}

export interface OverlapParams {
  CHECKPOINT_SPACING_M: number;
  ONB_REEXIT_FRAC: number;
}

/**
 * From both sides' checkpoint crossings, find the longest consecutive
 * checkpoint range crossed by BOTH, decide direction (b must progress the same
 * way as the corridor; a does by construction since the corridor is a's), pick
 * scope, and produce each side's comparison window.
 *
 *  - Direction: within the range, count adjacent checkpoint pairs where b's
 *    firstMs increases vs decreases. Predominantly decreasing ⇒ reversed ⇒ null.
 *  - Side is out-and-back (within the range) when it re-exits through the
 *    entry checkpoint late in its own span: lastMs[cpStart] - firstMs[cpStart]
 *    > ONB_REEXIT_FRAC * (its overall span across the range).
 *  - scope 'full' (both single-pass, or both out-and-back):
 *      enter = firstMs[cpStart];
 *      exit  = out-and-back side → lastMs[cpStart] (final re-exit where it entered)
 *              single-pass side  → firstMs[cpEnd].
 *  - scope 'outbound' (mixed): both sides use enter = firstMs[cpStart],
 *      exit = firstMs[cpEnd] — the one-way traversal, honest for both.
 */
export function computeOverlap(
  aCross: (Crossing | null)[],
  bCross: (Crossing | null)[],
  checkpoints: Checkpoint[],
  params: OverlapParams
): OverlapResult | null {
  const n = checkpoints.length;
  // Longest consecutive run where both crossed.
  let bestStart = -1, bestEnd = -1, runStart = -1;
  for (let i = 0; i <= n; i++) {
    const both = i < n && aCross[i] !== null && bCross[i] !== null;
    if (both && runStart === -1) runStart = i;
    if (!both && runStart !== -1) {
      if (i - 1 - runStart > bestEnd - bestStart) {
        bestStart = runStart;
        bestEnd = i - 1;
      }
      runStart = -1;
    }
  }
  if (bestStart === -1 || bestEnd - bestStart < 1) return null;

  // Direction check on b.
  let inc = 0, dec = 0;
  for (let i = bestStart + 1; i <= bestEnd; i++) {
    const prev = bCross[i - 1]!.firstMs;
    const cur = bCross[i]!.firstMs;
    if (cur > prev) inc++;
    else if (cur < prev) dec++;
  }
  if (dec > inc) return null;
  // Net-forward invariant: the window math assumes each side FIRST reaches the
  // range's far end after first entering it. A majority-increasing vote can
  // still pass tracks that touch the far checkpoint before the entry one
  // (traverses descending the corridor, tracks starting at the far end) —
  // prod produced negative single-pass windows exactly this way. Enforce the
  // invariant directly, for both sides.
  if (bCross[bestEnd]!.firstMs <= bCross[bestStart]!.firstMs) return null;
  if (aCross[bestEnd]!.firstMs <= aCross[bestStart]!.firstMs) return null;

  const spanOf = (cross: (Crossing | null)[]): number => {
    let min = Infinity, max = -Infinity;
    for (let i = bestStart; i <= bestEnd; i++) {
      min = Math.min(min, cross[i]!.firstMs);
      max = Math.max(max, cross[i]!.lastMs);
    }
    return max - min;
  };
  const isOnB = (cross: (Crossing | null)[]): boolean => {
    const entry = cross[bestStart]!;
    const far = cross[bestEnd]!;
    // A genuine out-and-back re-exits through the entry checkpoint AFTER
    // reaching the far end of the range — a pre-hike dwell at the entry
    // (trailhead parking with GPS on) re-visits cpStart only BEFORE the far
    // end and must not classify as out-and-back.
    return (
      entry.lastMs > far.firstMs &&
      entry.lastMs - entry.firstMs > params.ONB_REEXIT_FRAC * spanOf(cross)
    );
  };
  const aOnB = isOnB(aCross);
  const bOnB = isOnB(bCross);
  const scope: "full" | "outbound" = aOnB === bOnB ? "full" : "outbound";

  const windowOf = (cross: (Crossing | null)[], onb: boolean): SideWindow => {
    const entry = cross[bestStart]!;
    const far = cross[bestEnd]!;
    const useFull = scope === "full" && onb;
    return {
      enterMs: entry.firstMs,
      exitMs: useFull ? entry.lastMs : far.firstMs,
      startM: entry.firstCumM,
      endM: useFull ? entry.lastCumM : far.firstCumM,
      outAndBack: onb,
    };
  };

  return {
    cpStart: bestStart,
    cpEnd: bestEnd,
    overlapM: (bestEnd - bestStart) * params.CHECKPOINT_SPACING_M,
    scope,
    a: windowOf(aCross, aOnB),
    b: windowOf(bCross, bOnB),
  };
}

export interface MovingParams {
  MOVING_SPEED_MPS: number;
  MOVING_MAX_GAP_S: number;
}

/**
 * Seconds spent moving within [enterMs, exitMs]: sum of inter-sample gaps
 * whose implied or reported speed is at/above the threshold, each gap capped.
 */
export function computeMovingSeconds(
  samples: SamplePoint[],
  enterMs: number,
  exitMs: number,
  params: MovingParams
): number {
  let moving = 0;
  for (let i = 1; i < samples.length; i++) {
    const p = samples[i - 1];
    const c = samples[i];
    if (c.timeMs <= enterMs || p.timeMs >= exitMs) continue;
    const dtS = (c.timeMs - p.timeMs) / 1000;
    if (dtS <= 0) continue;
    const speed =
      c.speedMps ?? haversineM(p.lat, p.lng, c.lat, c.lng) / dtS;
    if (speed >= params.MOVING_SPEED_MPS) {
      moving += Math.min(dtS, params.MOVING_MAX_GAP_S);
    }
  }
  return Math.round(moving);
}

export interface LegSplits {
  arrivalMs: number;
  departureMs: number;
  ascentS: number;
  dwellS: number;
  descentS: number;
}

export interface LegParams {
  SUMMIT_DWELL_RADIUS_M: number;
  APEX_INTERIOR_FRAC: number;
}

/**
 * Split a side's comparison window at a summit destination:
 * ascent = window enter → first sample within SUMMIT_DWELL_RADIUS_M of the
 * summit; dwell = arrival → last such sample; descent = departure → window
 * exit. Null when the track never reaches the summit inside the window, or
 * when the arrival lies in the first/last APEX_INTERIOR_FRAC of the window's
 * elapsed span (a route that merely starts or ends at the summit has no
 * meaningful legs).
 */
export function computeLegSplits(
  samples: SamplePoint[],
  window: SideWindow,
  summit: { lat: number; lng: number },
  params: LegParams
): LegSplits | null {
  let arrivalMs: number | null = null;
  let departureMs: number | null = null;
  for (const s of samples) {
    if (s.timeMs < window.enterMs || s.timeMs > window.exitMs) continue;
    if (haversineM(s.lat, s.lng, summit.lat, summit.lng) <= params.SUMMIT_DWELL_RADIUS_M) {
      if (arrivalMs === null) arrivalMs = s.timeMs;
      departureMs = s.timeMs;
    }
  }
  if (arrivalMs === null || departureMs === null) return null;
  const span = window.exitMs - window.enterMs;
  if (span <= 0) return null;
  const frac = (arrivalMs - window.enterMs) / span;
  if (frac < params.APEX_INTERIOR_FRAC || frac > 1 - params.APEX_INTERIOR_FRAC) return null;
  return {
    arrivalMs,
    departureMs,
    ascentS: Math.round((arrivalMs - window.enterMs) / 1000),
    dwellS: Math.round((departureMs - arrivalMs) / 1000),
    descentS: Math.round((window.exitMs - departureMs) / 1000),
  };
}
