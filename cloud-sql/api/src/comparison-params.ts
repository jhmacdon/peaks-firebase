// Every tunable of the comparison matcher, mapped to the version counter it
// participates in. Changing a MATCHER_VERSION param requires re-running
// scripts/backfill-comparisons.ts (full geometry recompute). Changing a
// LEGS_VERSION param requires only scripts/recompute-comparison-legs.ts.
// Bump the corresponding version WHENEVER a value here changes.

/** Params below marked [matcher] — bump when any of them change.
 *  v2: loadSampledTrack now converts tracking_points.time from unix SECONDS
 *  (the real prod scale — the schema comment claiming ms was stale) to the
 *  model's milliseconds. v1 rows have elapsed/moving/legs off by 1000×. */
export const MATCHER_VERSION = 2;
/** Params below marked [legs] — bump when any of them change. */
export const LEGS_VERSION = 1;

/** [matcher] Planar candidate prefilter (degrees), same rationale as buildRouteCandidateSql. */
export const CANDIDATE_PLANAR_DEGREES = 0.005;
/** [matcher] Max candidate sessions examined per matching run (db-f1-micro budget). */
export const MAX_CANDIDATES_PER_RUN = 25;
/** [matcher] Target spacing when downsampling tracking_points for the model. */
export const SAMPLE_SPACING_M = 25;
/** [matcher] Checkpoint spacing along the corridor. */
export const CHECKPOINT_SPACING_M = 200;
/** [matcher] A sample within this radius of a checkpoint "crosses" it. */
export const CROSSING_RADIUS_M = 60;
/** [matcher] Return-half within this radius of outbound-half ⇒ out-and-back collapse. */
export const CORRIDOR_OVERLAP_RADIUS_M = 40;
/** [matcher] Fraction of return samples that must overlap outbound to call a track out-and-back. */
export const OUT_AND_BACK_OVERLAP_FRAC = 0.7;
/** [matcher] Start/end proximity (m) required to consider out-and-back collapse. */
export const OUT_AND_BACK_CLOSURE_M = 200;
/** [matcher] Minimum shared-corridor length to store a pair. */
export const MIN_OVERLAP_M = 500;
/** [matcher] Minimum overlap as a fraction of the shorter corridor. */
export const MIN_OVERLAP_FRAC_OF_SHORTER = 0.3;
/** [matcher] Both fracs at/above this ⇒ the pair is a "full route" match. */
export const FULL_ROUTE_FRAC = 0.9;
/** [matcher] Max stored pairs per session; lowest overlap_m pruned beyond this. */
export const MAX_PAIRS_PER_SESSION = 20;
/** [matcher] A side is out-and-back within the range when it re-exits through the
 *  entry checkpoint in the last half of its window (see computeOverlap). */
export const ONB_REEXIT_FRAC = 0.5;
/** [matcher] Speed threshold (m/s) separating moving from stopped time. */
export const MOVING_SPEED_MPS = 0.3;
/** [matcher] Max seconds a single sample gap can contribute to moving time. */
export const MOVING_MAX_GAP_S = 60;

/** [legs] A sample within this radius of the summit destination counts as "at the summit". */
export const SUMMIT_DWELL_RADIUS_M = 60;
/** [legs] Summit arrival must fall inside the window's interior by this
 *  ELAPSED-TIME fraction of the window span. */
export const APEX_INTERIOR_FRAC = 0.1;

/** Read-side cap on comparisons returned by the list endpoint (PB always
 *  force-included). Not matcher/legs-versioned — changing it needs no
 *  recompute. */
export const COMPARISON_LIST_CAP = 10;
