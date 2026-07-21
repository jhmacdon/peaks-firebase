// Session-comparison matching: SQL builders, point loading, and the
// matchComparisons orchestrator (added in the next task). The geometry itself
// is pure and lives in comparison-geometry.ts.

import {
  buildCheckpoints,
  collapseOutAndBack,
  computeCrossings,
  computeLegSplits,
  computeMovingSeconds,
  computeOverlap,
  Checkpoint,
  Corridor,
  Crossing,
  haversineM,
  OverlapResult,
  RawPointRow,
  SamplePoint,
  SideWindow,
  sampleTrack,
} from "./comparison-geometry";
import * as P from "./comparison-params";

export interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
}

/**
 * Candidate sessions for comparison: the same user's other ended sessions
 * whose stored path is planar-near this one's. PLANAR ops only (bbox && +
 * planar ST_DWithin) — an exact geography line-line distance here would repeat
 * the buildRouteCandidateSql 30s-timeout regression. Newest first so the cap
 * keeps the most recent efforts.
 */
export function buildComparisonCandidateSql(
  sessionId: string,
  userId: string
): { text: string; values: unknown[] } {
  return {
    text: `SELECT s2.id, s2.start_time
     FROM tracking_sessions s1
     JOIN tracking_sessions s2
       ON s2.user_id = $2 AND s2.id <> s1.id
     WHERE s1.id = $1 AND s1.path IS NOT NULL
       AND s2.ended = true AND s2.path IS NOT NULL
       AND s2.path::geometry && ST_Expand(s1.path::geometry, ${P.CANDIDATE_PLANAR_DEGREES})
       AND ST_DWithin(s2.path::geometry, s1.path::geometry, ${P.CANDIDATE_PLANAR_DEGREES})
     ORDER BY s2.start_time DESC
     LIMIT ${P.MAX_CANDIDATES_PER_RUN}`,
    values: [sessionId, userId],
  };
}

/** Highest common reached summit destination of the two sessions, if any. */
export function buildCommonSummitSql(
  sessionIdA: string,
  sessionIdB: string
): { text: string; values: unknown[] } {
  return {
    text: `SELECT d.id,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng
     FROM session_destinations sa
     JOIN session_destinations sb
       ON sb.destination_id = sa.destination_id
      AND sb.session_id = $2 AND sb.relation = 'reached'
     JOIN destinations d ON d.id = sa.destination_id
     WHERE sa.session_id = $1 AND sa.relation = 'reached'
       AND d.location IS NOT NULL
       AND 'summit'::destination_feature = ANY(d.features)
     ORDER BY d.elevation DESC NULLS LAST
     LIMIT 1`,
    values: [sessionIdA, sessionIdB],
  };
}

/** Column-complete row for session_comparisons. */
export interface ComparisonRow {
  user_id: string;
  session_a: string;
  session_b: string;
  scope: "full" | "outbound";
  overlap_m: number;
  a_frac: number;
  b_frac: number;
  a_enter_ms: number;
  a_exit_ms: number;
  b_enter_ms: number;
  b_exit_ms: number;
  a_start_m: number;
  a_end_m: number;
  b_start_m: number;
  b_end_m: number;
  a_out_and_back: boolean;
  b_out_and_back: boolean;
  a_elapsed_s: number;
  b_elapsed_s: number;
  a_moving_s: number | null;
  b_moving_s: number | null;
  summit_destination_id: string | null;
  a_arrival_ms: number | null;
  a_departure_ms: number | null;
  b_arrival_ms: number | null;
  b_departure_ms: number | null;
  a_ascent_s: number | null;
  a_dwell_s: number | null;
  a_descent_s: number | null;
  b_ascent_s: number | null;
  b_dwell_s: number | null;
  b_descent_s: number | null;
  matcher_version: number;
  legs_version: number;
}

const COMPARISON_COLUMNS: (keyof ComparisonRow)[] = [
  "user_id", "session_a", "session_b", "scope",
  "overlap_m", "a_frac", "b_frac",
  "a_enter_ms", "a_exit_ms", "b_enter_ms", "b_exit_ms",
  "a_start_m", "a_end_m", "b_start_m", "b_end_m",
  "a_out_and_back", "b_out_and_back",
  "a_elapsed_s", "b_elapsed_s", "a_moving_s", "b_moving_s",
  "summit_destination_id",
  "a_arrival_ms", "a_departure_ms", "b_arrival_ms", "b_departure_ms",
  "a_ascent_s", "a_dwell_s", "a_descent_s",
  "b_ascent_s", "b_dwell_s", "b_descent_s",
];

export function buildComparisonUpsertSql(row: ComparisonRow): { text: string; values: unknown[] } {
  // matcher_version/legs_version are version-counter constants (see
  // comparison-params.ts), not per-row measured data, so they're written as
  // trusted integer literals rather than bound params — keeping COMPARISON_COLUMNS
  // (32 entries) as the only bound values while still covering every
  // session_comparisons column except computed_at (which defaults to now()).
  const cols = COMPARISON_COLUMNS;
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const updates = cols
    .filter((c) => c !== "session_a" && c !== "session_b")
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(", ");
  const matcherVersion = Number(row.matcher_version);
  const legsVersion = Number(row.legs_version);
  return {
    text: `INSERT INTO session_comparisons (${cols.join(", ")}, matcher_version, legs_version)
     VALUES (${placeholders}, ${matcherVersion}, ${legsVersion})
     ON CONFLICT (session_a, session_b) DO UPDATE SET ${updates},
       matcher_version = ${matcherVersion}, legs_version = ${legsVersion}, computed_at = now()`,
    values: cols.map((c) => row[c as keyof ComparisonRow]),
  };
}

/** Delete this session's pairs beyond the top MAX_PAIRS_PER_SESSION by overlap. */
export function buildPrunePairsSql(sessionId: string): { text: string; values: unknown[] } {
  return {
    text: `DELETE FROM session_comparisons sc
     WHERE (sc.session_a = $1 OR sc.session_b = $1)
       AND (sc.session_a, sc.session_b) NOT IN (
         SELECT session_a, session_b FROM session_comparisons
         WHERE session_a = $1 OR session_b = $1
         ORDER BY overlap_m DESC
         LIMIT ${P.MAX_PAIRS_PER_SESSION}
       )`,
    values: [sessionId],
  };
}

/**
 * Load a session's tracking points and downsample for the model.
 *
 * tracking_points.time is unix SECONDS in production (see cloud-sql/CLAUDE.md
 * "Postgres → wire type policy"; the schema.sql column comment claiming
 * milliseconds was stale). The comparison model works in milliseconds
 * (RawPointRow.time / SamplePoint.timeMs and every stored *_ms column), so the
 * conversion happens HERE, at the single load boundary — nothing downstream
 * may rescale again. seconds × 1000 stays far below 2^53.
 */
export async function loadSampledTrack(q: Queryable, sessionId: string): Promise<SamplePoint[]> {
  const { rows } = await q.query(
    `SELECT time * 1000 AS time, elevation, speed,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng
     FROM tracking_points
     WHERE session_id = $1 AND location IS NOT NULL
     ORDER BY time`,
    [sessionId]
  );
  return sampleTrack(rows as RawPointRow[], P.SAMPLE_SPACING_M);
}

export interface PairModel {
  corridor: Corridor;
  checkpoints: Checkpoint[];
  aCross: (Crossing | null)[];
  bCross: (Crossing | null)[];
  overlap: OverlapResult;
  aCorridorLengthM: number;
  bCorridorLengthM: number;
}

export interface CompleteSummitRouteModel {
  overlapM: number;
  a: OverlapResult["a"];
  b: OverlapResult["b"];
}

/**
 * A complete summit route may use different lines on the way up and down.
 * Spatial checkpoint coverage alone calls those pairs partial (or even
 * rejects a loop traveled in the opposite order), although both recordings
 * are complete attempts at the same objective. Promote the pair only when
 * both tracks are closed, share a trailhead area, and actually pass the
 * common reached summit. A turnaround cannot satisfy the common-summit gate.
 */
export function buildCompleteSummitRouteModel(
  aSamples: SamplePoint[],
  bSamples: SamplePoint[],
  summit: { lat: number; lng: number }
): CompleteSummitRouteModel | null {
  if (aSamples.length < 4 || bSamples.length < 4) return null;
  const aFirst = aSamples[0];
  const aLast = aSamples[aSamples.length - 1];
  const bFirst = bSamples[0];
  const bLast = bSamples[bSamples.length - 1];

  const closedA = haversineM(aFirst.lat, aFirst.lng, aLast.lat, aLast.lng) <= P.COMPLETE_ROUTE_ENDPOINT_RADIUS_M;
  const closedB = haversineM(bFirst.lat, bFirst.lng, bLast.lat, bLast.lng) <= P.COMPLETE_ROUTE_ENDPOINT_RADIUS_M;
  const sharedBase = haversineM(aFirst.lat, aFirst.lng, bFirst.lat, bFirst.lng) <= P.COMPLETE_ROUTE_ENDPOINT_RADIUS_M;
  if (!closedA || !closedB || !sharedBase) return null;

  const reachesSummit = (samples: SamplePoint[]): boolean => samples.some(
    (point) => haversineM(point.lat, point.lng, summit.lat, summit.lng) <= P.SUMMIT_DWELL_RADIUS_M
  );
  if (!reachesSummit(aSamples) || !reachesSummit(bSamples)) return null;

  const aDistance = aLast.cumM - aFirst.cumM;
  const bDistance = bLast.cumM - bFirst.cumM;
  if (aDistance <= 0 || bDistance <= 0) return null;

  return {
    overlapM: Math.min(aDistance, bDistance),
    a: {
      enterMs: aFirst.timeMs,
      exitMs: aLast.timeMs,
      startM: aFirst.cumM,
      endM: aLast.cumM,
      outAndBack: true,
    },
    b: {
      enterMs: bFirst.timeMs,
      exitMs: bLast.timeMs,
      startM: bFirst.cumM,
      endM: bLast.cumM,
      outAndBack: true,
    },
  };
}

/**
 * Run the checkpoint model for a pair. `aSamples` MUST be the EARLIER session
 * — the corridor is always built from session_a so the model is deterministic
 * for a pair regardless of processing order. Null ⇒ no valid overlap.
 */
export function buildPairModel(aSamples: SamplePoint[], bSamples: SamplePoint[]): PairModel | null {
  if (aSamples.length < 4 || bSamples.length < 4) return null;
  const corridor = collapseOutAndBack(aSamples, P);
  const bCorridor = collapseOutAndBack(bSamples, P); // for b_frac only
  const checkpoints = buildCheckpoints(corridor, P.CHECKPOINT_SPACING_M);
  if (checkpoints.length < 2) return null;
  const aCross = computeCrossings(aSamples, checkpoints, P.CROSSING_RADIUS_M);
  const bCross = computeCrossings(bSamples, checkpoints, P.CROSSING_RADIUS_M);
  let overlap = computeOverlap(aCross, bCross, checkpoints, P);
  if (!overlap) return null;
  const aFrac = corridor.lengthM > 0 ? overlap.overlapM / corridor.lengthM : 0;
  const bFrac = bCorridor.lengthM > 0 ? overlap.overlapM / bCorridor.lengthM : 0;

  // Two closed tracks can both re-exit the shared entry checkpoint even when
  // one turns around far earlier. Timing that as a full window compares the
  // longer climb's entire outing with the failed attempt's shorter outing.
  // For partial coverage, stop both clocks at the last shared checkpoint.
  if (
    overlap.scope === "full" &&
    overlap.a.outAndBack &&
    overlap.b.outAndBack &&
    (aFrac < P.FULL_ROUTE_FRAC || bFrac < P.FULL_ROUTE_FRAC)
  ) {
    const aFar = aCross[overlap.cpEnd]!;
    const bFar = bCross[overlap.cpEnd]!;
    overlap = {
      ...overlap,
      scope: "outbound",
      a: {
        ...overlap.a,
        exitMs: aFar.firstMs,
        endM: aFar.firstCumM,
      },
      b: {
        ...overlap.b,
        exitMs: bFar.firstMs,
        endM: bFar.firstCumM,
      },
    };
  }
  return {
    corridor,
    checkpoints,
    aCross,
    bCross,
    overlap,
    aCorridorLengthM: corridor.lengthM,
    bCorridorLengthM: bCorridor.lengthM,
  };
}

/**
 * Match `sessionId` against the user's nearby sessions and upsert
 * session_comparisons rows. Serial by construction (db-f1-micro). Called
 * post-commit from processSession (best-effort) and from the backfill script.
 * `skipExisting` (backfill): a pair already stored at the current
 * MATCHER_VERSION is not recomputed.
 */
export async function matchComparisons(
  q: Queryable,
  sessionId: string,
  userId: string,
  opts: { skipExisting?: boolean } = {}
): Promise<number> {
  const self = await q.query(
    `SELECT id, start_time FROM tracking_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
  if (self.rows.length === 0) return 0;
  const selfStart = new Date(self.rows[0].start_time).getTime();

  const cand = buildComparisonCandidateSql(sessionId, userId);
  const candidates = await q.query(cand.text, cand.values);
  if (candidates.rows.length === 0) return 0;

  const selfSamples = await loadSampledTrack(q, sessionId);
  let written = 0;
  const affectedOthers = new Set<string>();

  for (const c of candidates.rows as Array<{ id: string; start_time: string | Date }>) {
    try {
      const candStart = new Date(c.start_time).getTime();
      // Canonical orientation: session_a = earlier (ties broken by id).
      const selfIsA = selfStart < candStart || (selfStart === candStart && sessionId < c.id);
      const aId = selfIsA ? sessionId : c.id;
      const bId = selfIsA ? c.id : sessionId;

      if (opts.skipExisting) {
        const existing = await q.query(
          `SELECT 1 FROM session_comparisons
           WHERE session_a = $1 AND session_b = $2 AND matcher_version = $3`,
          [aId, bId, P.MATCHER_VERSION]
        );
        if ((existing.rowCount ?? 0) > 0) continue;
      }

      const candSamples = await loadSampledTrack(q, c.id);
      const aSamples = selfIsA ? selfSamples : candSamples;
      const bSamples = selfIsA ? candSamples : selfSamples;

      const checkpointModel = buildPairModel(aSamples, bSamples);

      const summitSql = buildCommonSummitSql(aId, bId);
      const summitRes = await q.query(summitSql.text, summitSql.values);
      const summit = summitRes.rows[0] as { id: string; lat: number; lng: number } | undefined;
      const completeRouteModel = summit
        ? buildCompleteSummitRouteModel(aSamples, bSamples, summit)
        : null;

      const checkpointIsFullRoute = checkpointModel !== null &&
        checkpointModel.aCorridorLengthM > 0 &&
        checkpointModel.bCorridorLengthM > 0 &&
        checkpointModel.overlap.overlapM / checkpointModel.aCorridorLengthM >= P.FULL_ROUTE_FRAC &&
        checkpointModel.overlap.overlapM / checkpointModel.bCorridorLengthM >= P.FULL_ROUTE_FRAC;
      const useCompleteRoute = completeRouteModel !== null && !checkpointIsFullRoute;
      if (!checkpointModel && !useCompleteRoute) continue;

      const overlap = useCompleteRoute
        ? {
          scope: "full" as const,
          overlapM: completeRouteModel!.overlapM,
          a: completeRouteModel!.a,
          b: completeRouteModel!.b,
        }
        : checkpointModel!.overlap;
      const aFrac = useCompleteRoute
        ? 1
        : Math.min(1, overlap.overlapM / checkpointModel!.aCorridorLengthM);
      const bFrac = useCompleteRoute
        ? 1
        : Math.min(1, overlap.overlapM / checkpointModel!.bCorridorLengthM);

      if (!useCompleteRoute) {
        const shorter = Math.min(checkpointModel!.aCorridorLengthM, checkpointModel!.bCorridorLengthM);
        if (overlap.overlapM < P.MIN_OVERLAP_M) continue;
        if (shorter > 0 && overlap.overlapM < P.MIN_OVERLAP_FRAC_OF_SHORTER * shorter) continue;
      }

      // Data-quality gate: a side whose comparison window is implausibly short
      // for a ≥MIN_OVERLAP_M corridor is timing noise (GPS gaps, degenerate
      // crossings) — storing it would surface nonsense deltas in the UI.
      const aElapsedS = Math.round((overlap.a.exitMs - overlap.a.enterMs) / 1000);
      const bElapsedS = Math.round((overlap.b.exitMs - overlap.b.enterMs) / 1000);
      if (aElapsedS < P.MIN_PAIR_ELAPSED_S || bElapsedS < P.MIN_PAIR_ELAPSED_S) continue;

      // Legs: only meaningful for 'full' scope (outbound windows end at the far
      // checkpoint — a summit there sits at the window edge and is filtered by
      // APEX_INTERIOR_FRAC anyway).
      const aLegs = summit ? computeLegSplits(aSamples, overlap.a, summit, P) : null;
      const bLegs = summit ? computeLegSplits(bSamples, overlap.b, summit, P) : null;
      const legsOk = aLegs !== null && bLegs !== null;

      const row: ComparisonRow = {
        user_id: userId,
        session_a: aId,
        session_b: bId,
        scope: overlap.scope,
        overlap_m: overlap.overlapM,
        a_frac: aFrac,
        b_frac: bFrac,
        a_enter_ms: overlap.a.enterMs,
        a_exit_ms: overlap.a.exitMs,
        b_enter_ms: overlap.b.enterMs,
        b_exit_ms: overlap.b.exitMs,
        a_start_m: overlap.a.startM,
        a_end_m: overlap.a.endM,
        b_start_m: overlap.b.startM,
        b_end_m: overlap.b.endM,
        a_out_and_back: overlap.a.outAndBack,
        b_out_and_back: overlap.b.outAndBack,
        a_elapsed_s: aElapsedS,
        b_elapsed_s: bElapsedS,
        a_moving_s: computeMovingSeconds(aSamples, overlap.a.enterMs, overlap.a.exitMs, P),
        b_moving_s: computeMovingSeconds(bSamples, overlap.b.enterMs, overlap.b.exitMs, P),
        summit_destination_id: legsOk ? summit!.id : null,
        a_arrival_ms: legsOk ? aLegs!.arrivalMs : null,
        a_departure_ms: legsOk ? aLegs!.departureMs : null,
        b_arrival_ms: legsOk ? bLegs!.arrivalMs : null,
        b_departure_ms: legsOk ? bLegs!.departureMs : null,
        a_ascent_s: legsOk ? aLegs!.ascentS : null,
        a_dwell_s: legsOk ? aLegs!.dwellS : null,
        a_descent_s: legsOk ? aLegs!.descentS : null,
        b_ascent_s: legsOk ? bLegs!.ascentS : null,
        b_dwell_s: legsOk ? bLegs!.dwellS : null,
        b_descent_s: legsOk ? bLegs!.descentS : null,
        matcher_version: P.MATCHER_VERSION,
        legs_version: P.LEGS_VERSION,
      };
      const upsert = buildComparisonUpsertSql(row);
      await q.query(upsert.text, upsert.values);
      written++;
      affectedOthers.add(c.id);
    } catch (err) {
      console.error(`[matchComparisons] candidate ${c.id} failed for ${sessionId}:`, err);
      continue;
    }
  }

  if (written > 0) {
    for (const id of [sessionId, ...affectedOthers]) {
      const prune = buildPrunePairsSql(id);
      await q.query(prune.text, prune.values);
    }
  }
  return written;
}

export interface ComparisonSide {
  elapsed_s: number;
  moving_s: number | null;
  enter_ms: number;
  exit_ms: number;
  start_m: number;
  end_m: number;
  out_and_back: boolean;
  ascent_s: number | null;
  dwell_s: number | null;
  descent_s: number | null;
}

export interface OrientedComparison {
  session: { id: string; name: string | null; start_time: unknown; distance: number | null; total_time: number | null };
  scope: "full" | "outbound";
  overlap_m: number;
  this_frac: number;
  other_frac: number;
  full_route: boolean;
  this: ComparisonSide;
  other: ComparisonSide;
  delta_s: number;
  summit_destination_id: string | null;
  is_pb: boolean;
}

function side(row: any, prefix: "a" | "b"): ComparisonSide {
  return {
    elapsed_s: row[`${prefix}_elapsed_s`],
    moving_s: row[`${prefix}_moving_s`],
    enter_ms: row[`${prefix}_enter_ms`],
    exit_ms: row[`${prefix}_exit_ms`],
    start_m: row[`${prefix}_start_m`],
    end_m: row[`${prefix}_end_m`],
    out_and_back: row[`${prefix}_out_and_back`],
    ascent_s: row[`${prefix}_ascent_s`],
    dwell_s: row[`${prefix}_dwell_s`],
    descent_s: row[`${prefix}_descent_s`],
  };
}

/** Map a session_comparisons row (+ joined other_* summary) to the viewed session's perspective. */
export function orientComparison(row: any, sessionId: string): OrientedComparison {
  const thisIsA = row.session_a === sessionId;
  const mine = side(row, thisIsA ? "a" : "b");
  const theirs = side(row, thisIsA ? "b" : "a");
  return {
    session: {
      id: row.other_id,
      name: row.other_name ?? null,
      start_time: row.other_start_time,
      distance: row.other_distance ?? null,
      total_time: row.other_total_time ?? null,
    },
    scope: row.scope,
    overlap_m: row.overlap_m,
    this_frac: thisIsA ? row.a_frac : row.b_frac,
    other_frac: thisIsA ? row.b_frac : row.a_frac,
    full_route: row.a_frac >= P.FULL_ROUTE_FRAC && row.b_frac >= P.FULL_ROUTE_FRAC,
    this: mine,
    other: theirs,
    delta_s: mine.elapsed_s - theirs.elapsed_s,
    summit_destination_id: row.summit_destination_id,
    is_pb: false,
  };
}

export interface EffortCurveStation {
  m: number;                 // meters from shared-range start
  a_s: number;               // a's seconds from its window enter at first crossing
  b_s: number;
  elev_m: number | null;     // corridor elevation at the station
  // Full-route pairs that use different lines have no single corridor meter.
  // Keep each side's traveled distance so the endpoint can orient `m` to the
  // recording the user is actually scrubbing.
  a_m?: number;
  b_m?: number;
  a_elev_m?: number | null;
  b_elev_m?: number | null;
}

export interface EffortCurves {
  stations: EffortCurveStation[];
}

/**
 * Effort curves for the race chart: per shared checkpoint, each side's
 * crossing time relative to its own window enter. Full out-and-back pairs
 * include the outbound checkpoints followed by the return checkpoints, so
 * the distance-domain gap keeps changing after the summit instead of freezing
 * at the final outbound station. Stations are clamped monotonic because GPS
 * jitter can make adjacent checkpoint crossings arrive slightly out of order.
 */
export function buildEffortCurves(model: PairModel): EffortCurves {
  const { overlap, checkpoints, aCross, bCross } = model;
  const stations: EffortCurveStation[] = [];
  let prevA = 0;
  let prevB = 0;

  const appendStation = (i: number, m: number, returning: boolean): void => {
    const a = aCross[i];
    const b = bCross[i];
    if (!a || !b) return;
    const aMs = returning ? a.lastMs : a.firstMs;
    const bMs = returning ? b.lastMs : b.firstMs;
    const aS = Math.max(prevA, Math.round((aMs - overlap.a.enterMs) / 1000));
    const bS = Math.max(prevB, Math.round((bMs - overlap.b.enterMs) / 1000));
    stations.push({
      m,
      a_s: aS,
      b_s: bS,
      elev_m: checkpoints[i].elevM,
    });
    prevA = aS;
    prevB = bS;
  };

  for (let i = overlap.cpStart; i <= overlap.cpEnd; i++) {
    appendStation(i, checkpoints[i].m - checkpoints[overlap.cpStart].m, false);
  }

  if (overlap.scope === "full" && overlap.a.outAndBack && overlap.b.outAndBack) {
    const farM = checkpoints[overlap.cpEnd].m;
    for (let i = overlap.cpEnd - 1; i >= overlap.cpStart; i--) {
      const returnM = overlap.overlapM + (farM - checkpoints[i].m);
      appendStation(i, returnM, true);
    }
  }
  return { stations };
}

interface InterpolatedTrackProgress {
  seconds: number;
  meters: number;
  elevM: number | null;
}

function trackProgressAt(
  samples: SamplePoint[],
  window: SideWindow,
  fraction: number
): InterpolatedTrackProgress | null {
  const inWindow = samples.filter((sample) => sample.timeMs >= window.enterMs && sample.timeMs <= window.exitMs);
  if (inWindow.length === 0) return null;
  const startM = window.startM;
  const endM = window.endM;
  const targetM = startM + (endM - startM) * fraction;
  const increasing = endM >= startM;
  let upper = inWindow.findIndex((sample) => increasing ? sample.cumM >= targetM : sample.cumM <= targetM);
  if (upper < 0) upper = inWindow.length - 1;
  const lower = Math.max(0, upper - 1);
  const a = inWindow[lower];
  const b = inWindow[upper];
  const span = b.cumM - a.cumM;
  const t = span !== 0 ? Math.max(0, Math.min(1, (targetM - a.cumM) / span)) : 0;
  const timeMs = a.timeMs + (b.timeMs - a.timeMs) * t;
  const elevM = a.elevM !== null && b.elevM !== null
    ? a.elevM + (b.elevM - a.elevM) * t
    : a.elevM ?? b.elevM;
  return {
    seconds: Math.max(0, Math.round((timeMs - window.enterMs) / 1000)),
    meters: Math.abs(targetM - startM),
    elevM,
  };
}

/**
 * Complete same-summit routes may diverge and reconnect, so a single spatial
 * checkpoint line cannot describe both. Sample equal fractions of each
 * recording's traveled distance instead. The returned per-side meters let
 * the read endpoint orient the curve to whichever recording is being viewed.
 */
export function buildCompleteRouteEffortCurves(
  aSamples: SamplePoint[],
  bSamples: SamplePoint[],
  aWindow: SideWindow,
  bWindow: SideWindow,
  stationCount = 40
): EffortCurves {
  const stations: EffortCurveStation[] = [];
  let previousA = 0;
  let previousB = 0;
  for (let i = 0; i <= stationCount; i++) {
    const fraction = i / stationCount;
    const a = trackProgressAt(aSamples, aWindow, fraction);
    const b = trackProgressAt(bSamples, bWindow, fraction);
    if (!a || !b) continue;
    const aS = Math.max(previousA, a.seconds);
    const bS = Math.max(previousB, b.seconds);
    stations.push({
      m: a.meters,
      a_m: a.meters,
      b_m: b.meters,
      a_s: aS,
      b_s: bS,
      elev_m: a.elevM,
      a_elev_m: a.elevM,
      b_elev_m: b.elevM,
    });
    previousA = aS;
    previousB = bS;
  }
  return { stations };
}

/**
 * PB-candidate ordering: lower other.elapsed_s wins. Rows arrive in
 * nondeterministic DB order, so exact elapsed_s ties must be broken
 * deterministically — prefer the EARLIER other-session start_time, then the
 * lower session id. Pure; independent of input order.
 */
function comparePbCandidate(a: OrientedComparison, b: OrientedComparison): number {
  if (a.other.elapsed_s !== b.other.elapsed_s) return a.other.elapsed_s - b.other.elapsed_s;
  const aStart = new Date(a.session.start_time as string).getTime();
  const bStart = new Date(b.session.start_time as string).getTime();
  if (aStart !== bStart) return aStart - bStart;
  return a.session.id < b.session.id ? -1 : a.session.id > b.session.id ? 1 : 0;
}

/** Orient, sort newest-first, cap, force-include the complete-route PB, and flag it. */
export function shapeComparisonList(rows: any[], sessionId: string, cap: number): OrientedComparison[] {
  const oriented = rows.map((r) => orientComparison(r, sessionId));
  if (oriented.length === 0) return [];
  const completeRoutes = oriented.filter((comparison) => comparison.full_route);
  const pb = completeRoutes.length > 0
    ? completeRoutes.reduce((best, c) => (comparePbCandidate(c, best) < 0 ? c : best))
    : null;
  oriented.sort(
    (x, y) => new Date(y.session.start_time as string).getTime() - new Date(x.session.start_time as string).getTime()
  );
  let out = oriented.slice(0, cap);
  if (pb && !out.includes(pb)) out = [...out.slice(0, cap - 1), pb];
  for (const c of out) c.is_pb = c === pb;
  return out;
}
