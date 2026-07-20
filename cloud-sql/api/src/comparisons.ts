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
  OverlapResult,
  RawPointRow,
  SamplePoint,
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

/** Load a session's tracking points and downsample for the model. */
export async function loadSampledTrack(q: Queryable, sessionId: string): Promise<SamplePoint[]> {
  const { rows } = await q.query(
    `SELECT time, elevation, speed,
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
  const overlap = computeOverlap(aCross, bCross, checkpoints, P);
  if (!overlap) return null;
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

      const model = buildPairModel(aSamples, bSamples);
      if (!model) continue;
      const { overlap } = model;
      const shorter = Math.min(model.aCorridorLengthM, model.bCorridorLengthM);
      if (overlap.overlapM < P.MIN_OVERLAP_M) continue;
      if (shorter > 0 && overlap.overlapM < P.MIN_OVERLAP_FRAC_OF_SHORTER * shorter) continue;

      // Legs: only meaningful for 'full' scope (outbound windows end at the far
      // checkpoint — a summit there sits at the window edge and is filtered by
      // APEX_INTERIOR_FRAC anyway).
      const summitSql = buildCommonSummitSql(aId, bId);
      const summitRes = await q.query(summitSql.text, summitSql.values);
      const summit = summitRes.rows[0] as { id: string; lat: number; lng: number } | undefined;
      const aLegs = summit ? computeLegSplits(aSamples, overlap.a, summit, P) : null;
      const bLegs = summit ? computeLegSplits(bSamples, overlap.b, summit, P) : null;
      const legsOk = aLegs !== null && bLegs !== null;

      const row: ComparisonRow = {
        user_id: userId,
        session_a: aId,
        session_b: bId,
        scope: overlap.scope,
        overlap_m: overlap.overlapM,
        a_frac: model.aCorridorLengthM > 0 ? Math.min(1, overlap.overlapM / model.aCorridorLengthM) : 0,
        b_frac: model.bCorridorLengthM > 0 ? Math.min(1, overlap.overlapM / model.bCorridorLengthM) : 0,
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
        a_elapsed_s: Math.round((overlap.a.exitMs - overlap.a.enterMs) / 1000),
        b_elapsed_s: Math.round((overlap.b.exitMs - overlap.b.enterMs) / 1000),
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
}

export interface EffortCurves {
  stations: EffortCurveStation[];
}

/**
 * Effort curves for the race chart: per shared checkpoint, each side's
 * first-crossing time relative to its own window enter. Stations are clamped
 * monotonic (GPS jitter can make a first-crossing slightly precede the
 * previous checkpoint's).
 */
export function buildEffortCurves(model: PairModel): EffortCurves {
  const { overlap, checkpoints, aCross, bCross } = model;
  const stations: EffortCurveStation[] = [];
  let prevA = 0;
  let prevB = 0;
  for (let i = overlap.cpStart; i <= overlap.cpEnd; i++) {
    const a = aCross[i];
    const b = bCross[i];
    if (!a || !b) continue;
    const aS = Math.max(prevA, Math.round((a.firstMs - overlap.a.enterMs) / 1000));
    const bS = Math.max(prevB, Math.round((b.firstMs - overlap.b.enterMs) / 1000));
    stations.push({
      m: checkpoints[i].m - checkpoints[overlap.cpStart].m,
      a_s: aS,
      b_s: bS,
      elev_m: checkpoints[i].elevM,
    });
    prevA = aS;
    prevB = bS;
  }
  return { stations };
}

/** Orient, sort newest-first, cap, force-include the PB (min other elapsed), flag it. */
export function shapeComparisonList(rows: any[], sessionId: string, cap: number): OrientedComparison[] {
  const oriented = rows.map((r) => orientComparison(r, sessionId));
  if (oriented.length === 0) return [];
  const pb = oriented.reduce((best, c) => (c.other.elapsed_s < best.other.elapsed_s ? c : best));
  oriented.sort(
    (x, y) => new Date(y.session.start_time as string).getTime() - new Date(x.session.start_time as string).getTime()
  );
  let out = oriented.slice(0, cap);
  if (!out.includes(pb)) out = [...out.slice(0, cap - 1), pb];
  for (const c of out) c.is_pb = c === pb;
  return out;
}
