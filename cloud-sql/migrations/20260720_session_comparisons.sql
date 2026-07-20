-- Pairwise session comparisons ("Your Efforts").
-- One row per overlapping pair of a user's sessions; session_a is the EARLIER
-- session (by start_time). Populated by processSession Step 8 (matchComparisons)
-- and api/scripts/backfill-comparisons.ts. Semantics doc:
-- docs/superpowers/specs/2026-07-20-pacer-comparisons-design.md.
--
-- Overlap is NOT transitive, so this is deliberately pairwise (not a group
-- table like session_attempt_groups).
--
-- *_ms columns are unix MILLISECONDS (BIGINT, < 2^53 — safe under the global
-- OID-20 parser in api/src/db.ts; see cloud-sql/CLAUDE.md wire-type policy).
-- Run as postgres.

CREATE TABLE session_comparisons (
    user_id      TEXT NOT NULL,
    session_a    TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
    session_b    TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,

    -- 'full': both sides compared over their entire pass(es) through the
    -- shared corridor (incl. out-and-back return). 'outbound': mixed topology
    -- (one side out-and-back, one single-pass) — both sides compared over the
    -- one-way traversal only.
    scope        TEXT NOT NULL CHECK (scope IN ('full', 'outbound')),

    overlap_m    DOUBLE PRECISION NOT NULL,  -- corridor meters shared
    a_frac       DOUBLE PRECISION NOT NULL,  -- overlap_m / a's corridor length
    b_frac       DOUBLE PRECISION NOT NULL,

    -- comparison window per side: wall-clock entry/exit of the shared range
    a_enter_ms   BIGINT NOT NULL,
    a_exit_ms    BIGINT NOT NULL,
    b_enter_ms   BIGINT NOT NULL,
    b_exit_ms    BIGINT NOT NULL,

    -- traveled meters (sampled cumulative distance) at window edges, for map
    -- highlighting / scope labels on iOS
    a_start_m    DOUBLE PRECISION NOT NULL,
    a_end_m      DOUBLE PRECISION NOT NULL,
    b_start_m    DOUBLE PRECISION NOT NULL,
    b_end_m      DOUBLE PRECISION NOT NULL,

    a_out_and_back BOOLEAN NOT NULL,
    b_out_and_back BOOLEAN NOT NULL,

    a_elapsed_s  INTEGER NOT NULL,
    b_elapsed_s  INTEGER NOT NULL,
    a_moving_s   INTEGER,
    b_moving_s   INTEGER,

    -- leg splits; NULL when the pair is not leg-splittable
    summit_destination_id TEXT REFERENCES destinations(id) ON DELETE SET NULL,
    a_arrival_ms   BIGINT,
    a_departure_ms BIGINT,
    b_arrival_ms   BIGINT,
    b_departure_ms BIGINT,
    a_ascent_s   INTEGER, a_dwell_s INTEGER, a_descent_s INTEGER,
    b_ascent_s   INTEGER, b_dwell_s INTEGER, b_descent_s INTEGER,

    matcher_version INTEGER NOT NULL,
    legs_version    INTEGER NOT NULL,
    computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (session_a, session_b),
    CHECK (session_a <> session_b)
);

CREATE INDEX idx_session_comparisons_user_a ON session_comparisons (user_id, session_a);
CREATE INDEX idx_session_comparisons_user_b ON session_comparisons (user_id, session_b);

GRANT SELECT, INSERT, UPDATE, DELETE ON session_comparisons TO "peaks-api";
