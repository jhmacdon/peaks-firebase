// Session-comparison matching: SQL builders, point loading, and the
// matchComparisons orchestrator (added in the next task). The geometry itself
// is pure and lives in comparison-geometry.ts.

import {
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
