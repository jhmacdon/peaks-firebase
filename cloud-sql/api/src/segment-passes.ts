// How one session's track points near a segment become separate passes.
//
// NO database access in this file. buildSessionSegmentCoverageSelectSql hands
// over, per segment, the time-ordered track points within the 30 m corridor
// with their position along the segment; this module splits them into passes.

/** Out of the corridor for longer than this starts a new pass. */
export const PASS_GAP_SECONDS = 600;
/** Moving back along the segment by more than this starts a new pass. */
export const PASS_REVERSAL_M = 100;
/** A pass counts when it covers this much, or PASS_MIN_FRACTION of the segment. */
export const PASS_MIN_COVERED_M = 50;
export const PASS_MIN_FRACTION = 0.5;
/** Staying within this distance of one spot for longer than PASS_DWELL_SECONDS
 * ends the pass at arrival; moving on afterwards starts a new pass. */
export const PASS_DWELL_M = 50;
export const PASS_DWELL_SECONDS = 1200;
/** Arrival and departure are the first and last points this close to the
 * stop's median spot, so walking up to camp is not counted as the stay. */
export const PASS_DWELL_SPOT_M = 15;
/** Corridor half-width; a pass's span is widened by it to claim covered pieces. */
const CORRIDOR_M = 30;

/** [unix seconds, metres along the segment, order of the point in the whole
 * track, projected x, projected y]. x and y are metres in the track's UTM zone;
 * without them a dwell is judged by position along the segment alone. */
export type CorridorPoint = [number, number, number, number?, number?];

export interface SegmentCorridorRow {
  session_id: string;
  segment_id: string;
  length_m: number;
  /** Length that positions and runs are measured in (2D); defaults to length_m. */
  along_length_m?: number;
  covered_m: number;
  /** Covered 10 m pieces merged where they touch: [start_m, end_m]. */
  runs: Array<[number, number]> | null;
  points: CorridorPoint[] | null;
  /** First and last vertex within the corridor width: positions wrap. */
  closed?: boolean;
}

export interface SegmentPass {
  session_id: string;
  segment_id: string;
  pass_index: number;
  covered_fraction: number;
  covered_m: number;
  entered_at: string;
  exited_at: string;
  direction: "forward" | "reverse";
}

/** On a closed segment the first and last vertex meet; carry positions past
 * the join instead of reading the wrap as a 1-length reversal. */
function unwrap(points: CorridorPoint[], length: number): CorridorPoint[] {
  const out: CorridorPoint[] = [];
  let shift = 0;
  for (const [t, along, seq, x, y] of points) {
    const prev = out[out.length - 1];
    if (prev) {
      const raw = along + shift - prev[1];
      if (raw > length / 2) shift -= length;
      else if (raw < -length / 2) shift += length;
    }
    out.push([t, along + shift, seq, x, y]);
  }
  return out;
}

/** Split where the track left the corridor for more than PASS_GAP_SECONDS.
 * Consecutive corridor points with no track point between them never split:
 * a recording pause inside the corridor is not leaving it. */
function splitGaps(points: CorridorPoint[]): CorridorPoint[][] {
  const runs: CorridorPoint[][] = [];
  for (const p of points) {
    const run = runs[runs.length - 1];
    const prev = run?.[run.length - 1];
    if (prev && p[0] - prev[0] > PASS_GAP_SECONDS && p[2] - prev[2] > 1) runs.push([p]);
    else if (run) run.push(p);
    else runs.push([p]);
  }
  return runs;
}

function apart(a: CorridorPoint, b: CorridorPoint): number {
  if (a[3] != null && a[4] != null && b[3] != null && b[4] != null) return Math.hypot(a[3] - b[3], a[4] - b[4]);
  return Math.abs(a[1] - b[1]);
}

/** Split at a stop: from a point where the track then stays within
 * PASS_DWELL_M for more than PASS_DWELL_SECONDS (a camp, a long summit rest).
 * The pass ends at arrival; the points of the stop belong to no pass; the next
 * pass, if the track moves on along the segment, starts where it set off. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function splitDwells(points: CorridorPoint[]): CorridorPoint[][] {
  const passes: CorridorPoint[][] = [];
  let current: CorridorPoint[] = [];
  let i = 0;
  while (i < points.length) {
    let j = i;
    while (j + 1 < points.length && apart(points[j + 1], points[i]) <= PASS_DWELL_M) j++;
    if (points[j][0] - points[i][0] > PASS_DWELL_SECONDS) {
      const stop = points.slice(i, j + 1);
      const spot: CorridorPoint = [0, median(stop.map((p) => p[1])), 0,
        stop[0][3] == null ? undefined : median(stop.map((p) => p[3] as number)),
        stop[0][4] == null ? undefined : median(stop.map((p) => p[4] as number))];
      const near = stop.map((p, k) => (apart(p, spot) <= PASS_DWELL_SPOT_M ? k : -1)).filter((k) => k >= 0);
      const arrive = i + (near[0] ?? 0);
      const leave = i + (near[near.length - 1] ?? j - i);
      // Still a stop once the approach and the departure are taken off?
      if (points[leave][0] - points[arrive][0] > PASS_DWELL_SECONDS) {
        current.push(...points.slice(i, arrive + 1));
        passes.push(current);
        current = [points[leave]];
        i = leave + 1;
        continue;
      }
      // Not a stop: skip ahead to the approach's end rather than rescanning it.
      if (arrive > i) { current.push(...points.slice(i, arrive)); i = arrive; continue; }
    }
    current.push(points[i]);
    i++;
  }
  passes.push(current);
  return passes.filter((pass) => pass.length > 0);
}

/** Split where the position trend flips for more than PASS_REVERSAL_M. The
 * turnaround point (the last one at the extreme) ends one pass and starts the next. */
function splitReversals(points: CorridorPoint[]): CorridorPoint[][] {
  const passes: CorridorPoint[][] = [];
  let start = 0;
  let dir = 0;
  let ext = 0;
  let extIdx = 0;
  while (start < points.length) {
    let lo = points[start][1], hi = lo, loIdx = start, hiIdx = start;
    if (dir !== 0) { ext = points[start][1]; extIdx = start; }
    let split = -1;
    for (let i = start + 1; i < points.length; i++) {
      const along = points[i][1];
      if (dir === 0) {
        if (along >= hi) { hi = along; hiIdx = i; }
        if (along <= lo) { lo = along; loIdx = i; }
        if (hi - lo > PASS_REVERSAL_M) {
          dir = hiIdx > loIdx ? 1 : -1;
          ext = dir > 0 ? hi : lo;
          extIdx = dir > 0 ? hiIdx : loIdx;
        }
      } else if (dir * (along - ext) >= 0) {
        ext = along; extIdx = i;
      } else if (dir * (ext - along) > PASS_REVERSAL_M) {
        split = extIdx;
        break;
      }
    }
    if (split < 0) { passes.push(points.slice(start)); break; }
    if (split > start) passes.push(points.slice(start, split + 1));
    start = split;
    dir = -dir;
  }
  return passes;
}

function overlap(runs: Array<[number, number]>, lo: number, hi: number): number {
  return runs.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, hi) - Math.max(a, lo)), 0);
}

/** Passes for one segment, in time order. A single pass keeps the segment's
 * whole measured length; with several, each claims the covered pieces within
 * its own span (plus the corridor width), so a repeated stretch counts for each. */
export function segmentPasses(row: SegmentCorridorRow): SegmentPass[] {
  const length = Number(row.length_m);
  const raw = (row.points ?? []).map(([t, a, s, x, y]) =>
    [Number(t), Number(a), Number(s), x == null ? undefined : Number(x), y == null ? undefined : Number(y)] as CorridorPoint);
  if (!raw.length || !(length > 0)) return [];
  const alongLength = Number(row.along_length_m ?? length) || length;
  const points = row.closed ? unwrap(raw, alongLength) : raw;
  // A stop's last point starts the next run alone when the track leaves the
  // segment from there; one point says nothing about a pass, so it is dropped
  // whenever the segment has another pass.
  const split = splitGaps(points).flatMap(splitDwells).flatMap(splitReversals);
  const moving = split.filter((pass) => pass.length > 1);
  const groups = moving.length ? moving : split.slice(0, 1);
  const runs = row.runs ?? [];
  const measured = groups.map((pass) => {
    const first = pass[0], last = pass[pass.length - 1];
    const positions = pass.map((p) => p[1]);
    const lo = Math.min(...positions), hi = Math.max(...positions);
    const net = last[1] - first[1];
    const fallbackForward = (((first[1] % alongLength) + alongLength) % alongLength) / alongLength < 0.5;
    const covered = groups.length === 1 ? Number(row.covered_m)
      : row.closed && hi - lo + 2 * CORRIDOR_M >= alongLength ? Number(row.covered_m)
        : overlap(runs, lo - CORRIDOR_M, hi + CORRIDOR_M);
    const covered_m = Math.min(length, covered);
    return { first, last, covered_m,
      direction: (Math.abs(net) >= 1 ? net > 0 : fallbackForward) ? "forward" as const : "reverse" as const };
  });
  const gate = (m: number) => m >= PASS_MIN_COVERED_M || m / length >= PASS_MIN_FRACTION;
  let kept = measured.filter((p) => gate(p.covered_m));
  if (!kept.length) kept = [measured.reduce((a, b) => (b.covered_m > a.covered_m ? b : a))];
  return kept.map((p, pass_index) => ({
    session_id: row.session_id, segment_id: row.segment_id, pass_index,
    covered_fraction: Math.min(1, p.covered_m / length), covered_m: p.covered_m,
    entered_at: new Date(p.first[0] * 1000).toISOString(),
    exited_at: new Date(p.last[0] * 1000).toISOString(),
    direction: p.direction,
  }));
}
