import { PoolClient } from "pg";
import crypto from "crypto";
import db from "./db";

export function generateId(): string {
  return crypto.randomBytes(10).toString("hex");
}

// A 'processing' claim older than this is considered dead and re-claimable.
// processSession runs in seconds; this is far longer than any real run (and any
// Cloud Run request timeout), so a live run is never re-claimed. Shared by
// processSession's claim and markSessionPendingIfReady so the two guards agree.
export const STALE_PROCESSING_MINUTES = 10;

export interface ProcessingResult {
  destinations_matched: number;
  routes_matched: number;
  areas_linked: number;
  attempt_group_id: string | null;
  attempt_group_session_count: number;
  /** True when an already-completed session was skipped (no re-matching). */
  skipped?: boolean;
}

/**
 * Minimal query interface so the area-linking helpers accept either the pool
 * (`db`) or a transaction client (`PoolClient`).
 */
interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<{ rowCount: number | null }>;
}

/**
 * Build the SQL that links a session's reached SUMMIT destinations to the
 * protected areas that contain them (or that they sit on the boundary of).
 *
 * Mirrors the schema's link_summit_destinations_to_areas() predicate but scoped
 * to one session's reached summits, so it is cheap to run inline per recording:
 * a summit is linked to an area when ST_Covers-contained OR within
 * `toleranceMeters` of the boundary. The planar ST_DWithin gate (degrees,
 * GIST-indexed) prunes candidates; the exact geography ST_DWithin makes the
 * precise meter cut. Tolerance default matches the migration (50 m) — see
 * cloud-sql/migrations/20260613_area_link_tolerance.sql for the rationale.
 */
export function buildLinkReachedSummitsToAreasSql(
  sessionId: string,
  toleranceMeters = 50
): { text: string; values: unknown[] } {
  const gateDeg = Math.max(toleranceMeters / 30000, 0.0002);
  return {
    text: `INSERT INTO destination_areas (destination_id, area_id, relation, source)
     SELECT DISTINCT sd.destination_id, a.id, 'contained_by', 'postgis'
     FROM session_destinations sd
     JOIN destinations d ON d.id = sd.destination_id
     JOIN LATERAL (
       SELECT a.id
       FROM areas a
       WHERE ST_DWithin(a.boundary, ST_Force2D(d.location::geometry), $2)
         AND (
           ST_Covers(a.boundary, ST_Force2D(d.location::geometry))
           OR ST_DWithin(a.boundary::geography, d.location, $3)
         )
     ) a ON true
     WHERE sd.session_id = $1
       AND sd.relation = 'reached'
       AND d.location IS NOT NULL
       AND 'summit'::destination_feature = ANY(d.features)
     ON CONFLICT (destination_id, area_id) DO NOTHING`,
    values: [sessionId, gateDeg, toleranceMeters],
  };
}

/**
 * Check a processed recording's reached summits against protected areas and
 * record the containment links. Enrichment, not core processing — callers run
 * it best-effort so a linking hiccup never fails session ingestion.
 */
export async function linkReachedSummitsToAreas(
  q: Queryable,
  sessionId: string,
  toleranceMeters = 50
): Promise<number> {
  const sql = buildLinkReachedSummitsToAreasSql(sessionId, toleranceMeters);
  const result = await q.query(sql.text, sql.values);
  return result.rowCount ?? 0;
}

/**
 * Match destinations within proximity of the session's GPS track.
 *
 * Reads the materialized linestring from tracking_sessions.path (set by
 * processSession Step 0) and uses GIST-indexed ST_DWithin in a single query.
 * Per-feature thresholds live in the SQL function destination_match_radius()
 * (see cloud-sql/schema.sql). Boundary destinations use a 10m polygon match
 * regardless of feature.
 *
 * Owner scope: a destination owned by 'peaks' is system-global; a
 * user-owned destination only matches that user's own sessions.
 */
async function matchDestinations(client: PoolClient, sessionId: string): Promise<number> {
  const result = await client.query(
    `INSERT INTO session_destinations (session_id, destination_id, relation, source)
     SELECT s.id, d.id, 'reached', 'auto'
     FROM tracking_sessions s
     JOIN destinations d ON (d.owner = 'peaks' OR d.owner = s.user_id)
     WHERE s.id = $1
       AND s.path IS NOT NULL
       AND CASE WHEN d.boundary IS NOT NULL
             THEN ST_DWithin(s.path, d.boundary, 10)
             ELSE ST_DWithin(s.path, d.location, destination_match_radius(d.features))
           END
     ON CONFLICT (session_id, destination_id) DO NOTHING`,
    [sessionId]
  );
  return result.rowCount ?? 0;
}

/**
 * Match routes the session followed using two-phase approach:
 * 1. Find candidate routes within 100m of the session's stored linestring.
 * 2. Compute vertex coverage — insert routes with >= 70% coverage.
 *
 * Reads tracking_sessions.path (set by processSession Step 0) so both
 * phases run as indexed lookups instead of rebuilding the line per query.
 */
async function matchRoutes(client: PoolClient, sessionId: string): Promise<number> {
  // Phase 1: find candidate routes near the session track
  const candidates = await client.query(
    `SELECT r.id FROM routes r, tracking_sessions s
     WHERE s.id = $1 AND s.path IS NOT NULL
       AND ST_DWithin(r.path, s.path, 100) AND r.status = 'active'`,
    [sessionId]
  );

  if (candidates.rows.length === 0) {
    return 0;
  }

  const candidateIds = candidates.rows.map((r: { id: string }) => r.id);

  // Phase 2: compute coverage and insert matches
  const result = await client.query(
    `WITH session_track AS (
        SELECT s.path AS track FROM tracking_sessions s WHERE s.id = $1
    ),
    route_points AS (
        SELECT r.id AS route_id, (ST_DumpPoints(r.path::geometry)).geom AS pt
        FROM routes r WHERE r.id = ANY($2)
    ),
    coverage AS (
        SELECT rp.route_id,
               COUNT(*) AS total_points,
               COUNT(*) FILTER (WHERE ST_DWithin(rp.pt::geography, st.track, 30)) AS matched_points
        FROM route_points rp, session_track st
        GROUP BY rp.route_id
    )
    INSERT INTO session_routes (session_id, route_id, source, coverage)
    SELECT $1, route_id, 'auto', matched_points::float / total_points
    FROM coverage
    WHERE matched_points::float / NULLIF(total_points, 0) >= 0.70
    ON CONFLICT (session_id, route_id) DO NOTHING`,
    [sessionId, candidateIds]
  );
  return result.rowCount ?? 0;
}

/**
 * Group sessions that represent repeated attempts of the same climb.
 *
 * Writes to tracking_sessions.attempt_group_id and session_attempt_groups.
 * Distinct from tracking_sessions.group_id, which is reserved for smart-link
 * multi-day chains (client-driven, opt-in under SmartLinkFlag). This function
 * runs unconditionally on every session import; the iOS log-row collapse is
 * gated on group_id (smart-link only), so previous-attempts groupings are
 * stored but never surfaced as merged log rows.
 *
 * Primary: destination-based — sessions sharing 2+ reached destinations.
 * Secondary: spatial — for sessions with <2 destinations, compare simplified
 * GPS tracks using Hausdorff distance (pre-filter by start-point proximity).
 */
async function matchPreviousAttempts(
  client: PoolClient,
  sessionId: string,
  userId: string
): Promise<{ attempt_group_id: string | null; attempt_group_session_count: number }> {
  // Primary: find sessions sharing 2+ reached destinations
  const destMatches = await client.query(
    `WITH current_dests AS (
        SELECT destination_id FROM session_destinations
        WHERE session_id = $1 AND relation = 'reached'
    )
    SELECT sd.session_id, ts.attempt_group_id, COUNT(DISTINCT sd.destination_id) AS shared
    FROM session_destinations sd
    JOIN tracking_sessions ts ON ts.id = sd.session_id
    WHERE sd.destination_id IN (SELECT destination_id FROM current_dests)
      AND sd.relation = 'reached' AND ts.user_id = $2 AND sd.session_id != $1
    GROUP BY sd.session_id, ts.attempt_group_id
    HAVING COUNT(DISTINCT sd.destination_id) >= 2`,
    [sessionId, userId]
  );

  if (destMatches.rows.length > 0) {
    return await assignAttemptGroup(client, sessionId, userId, destMatches.rows);
  }

  // Check how many reached destinations this session has
  const destCount = await client.query(
    `SELECT COUNT(*) AS cnt FROM session_destinations
     WHERE session_id = $1 AND relation = 'reached'`,
    [sessionId]
  );

  if (parseInt(destCount.rows[0].cnt) >= 2) {
    // Has destinations but no matches — no group needed
    return { attempt_group_id: null, attempt_group_session_count: 0 };
  }

  // Secondary: spatial matching for sessions with <2 destinations
  const spatialMatches = await client.query(
    `WITH current_track AS (
        SELECT ST_Simplify(ST_MakeLine(location::geometry ORDER BY time), 0.0005) AS track,
               (SELECT location FROM tracking_points WHERE session_id = $1 ORDER BY time LIMIT 1) AS start_pt
        FROM tracking_points WHERE session_id = $1
    ),
    candidate_sessions AS (
        SELECT DISTINCT tp2.session_id
        FROM current_track ct, tracking_points tp2
        JOIN tracking_sessions ts2 ON ts2.id = tp2.session_id
        WHERE ts2.user_id = $2
          AND tp2.session_id != $1
          AND tp2.time = (SELECT MIN(time) FROM tracking_points WHERE session_id = tp2.session_id)
          AND ST_DWithin(tp2.location, ct.start_pt, 10000)
    ),
    other_tracks AS (
        SELECT tp3.session_id, ts3.attempt_group_id,
               ST_Simplify(ST_MakeLine(tp3.location::geometry ORDER BY tp3.time), 0.0005) AS track
        FROM tracking_points tp3
        JOIN tracking_sessions ts3 ON ts3.id = tp3.session_id
        WHERE tp3.session_id IN (SELECT session_id FROM candidate_sessions)
        GROUP BY tp3.session_id, ts3.attempt_group_id
    )
    SELECT ot.session_id, ot.attempt_group_id
    FROM other_tracks ot, current_track ct
    WHERE ST_HausdorffDistance(ot.track, ct.track) < 0.003`,
    [sessionId, userId]
  );

  if (spatialMatches.rows.length > 0) {
    return await assignAttemptGroup(client, sessionId, userId, spatialMatches.rows);
  }

  return { attempt_group_id: null, attempt_group_session_count: 0 };
}

/**
 * Assign the current session to a previous-attempts group based on matched
 * sessions. If any match already has an attempt_group_id, use that.
 * Otherwise create a new session_attempt_groups row.
 */
async function assignAttemptGroup(
  client: PoolClient,
  sessionId: string,
  userId: string,
  matches: Array<{ session_id: string; attempt_group_id: string | null }>
): Promise<{ attempt_group_id: string; attempt_group_session_count: number }> {
  // Find an existing group from matched sessions
  const existingGroupId = matches.find((m) => m.attempt_group_id)?.attempt_group_id;

  let groupId: string;

  if (existingGroupId) {
    groupId = existingGroupId;
  } else {
    // Create a new previous-attempts group
    groupId = generateId();
    await client.query(
      `INSERT INTO session_attempt_groups (id, user_id) VALUES ($1, $2)`,
      [groupId, userId]
    );

    // Assign all matched sessions to the new group
    const matchedIds = matches.map((m) => m.session_id);
    await client.query(
      `UPDATE tracking_sessions SET attempt_group_id = $1 WHERE id = ANY($2)`,
      [groupId, matchedIds]
    );
  }

  // Assign current session to the group
  await client.query(
    `UPDATE tracking_sessions SET attempt_group_id = $1 WHERE id = $2`,
    [groupId, sessionId]
  );

  // Count total sessions in the group
  const countResult = await client.query(
    `SELECT COUNT(*) AS cnt FROM tracking_sessions WHERE attempt_group_id = $1`,
    [groupId]
  );

  return {
    attempt_group_id: groupId,
    attempt_group_session_count: parseInt(countResult.rows[0].cnt),
  };
}

/**
 * Update destination averages (popular times) based on the session's start date.
 * Increments the month and day-of-week counters in the JSONB averages column
 * for all destinations matched (reached) by the session.
 */
async function updateDestinationAverages(
  client: PoolClient,
  sessionId: string
): Promise<void> {
  // Get session start time
  const sessionResult = await client.query(
    `SELECT start_time FROM tracking_sessions WHERE id = $1`,
    [sessionId]
  );
  if (sessionResult.rows.length === 0) return;

  const startTime = new Date(sessionResult.rows[0].start_time);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const days = ["su", "mo", "tu", "we", "th", "fr", "sa"];
  const month = months[startTime.getMonth()];
  const day = days[startTime.getDay()];

  // Get all reached destinations for this session
  const destResult = await client.query(
    `SELECT destination_id FROM session_destinations
     WHERE session_id = $1 AND relation = 'reached'`,
    [sessionId]
  );
  if (destResult.rows.length === 0) return;

  const destIds = destResult.rows.map((r: { destination_id: string }) => r.destination_id);

  // Atomically increment month and day counters in the JSONB averages column.
  // Initializes the averages object if null, and initializes individual counters if missing.
  await client.query(
    `UPDATE destinations SET averages = jsonb_set(
        jsonb_set(
          COALESCE(averages, '{"months":{},"days":{}}'),
          ARRAY['months', $2],
          to_jsonb(COALESCE((averages->'months'->>$2)::int, 0) + 1)
        ),
        ARRAY['days', $3],
        to_jsonb(COALESCE((averages->'days'->>$3)::int, 0) + 1)
      ),
      recency = NOW()
     WHERE id = ANY($1)`,
    [destIds, month, day]
  );
}

/**
 * Process a session: match destinations, routes, and group previous attempts.
 * Runs all steps in a single transaction. Idempotent — clears auto-tags first.
 *
 * Concurrency: the opening UPDATE is gated on `processing_state IS DISTINCT
 * FROM 'processing'` so a second concurrent caller (e.g. iOS poll racing
 * with the inline auto-process from PUT /api/sessions/:id) bails out with
 * `already_processing` instead of running matching twice.
 */
export async function processSession(
  sessionId: string,
  userId: string,
  opts: { force?: boolean } = {}
): Promise<ProcessingResult> {
  // Idempotency: an already-completed session is NOT re-processed unless
  // explicitly forced. iOS's upload step 3 (and stray re-process triggers)
  // otherwise re-claim and re-run the expensive PostGIS matching on sessions
  // that are already done — which under load 503s the whole API. The points
  // endpoint marks 'pending' only when NEW points are actually inserted, so a
  // genuinely-changed session still re-processes. Old clients re-POSTing
  // unchanged points insert 0 rows → stay 'completed' → skipped here too.
  if (!opts.force) {
    const cur = await db.query(
      `SELECT processing_state FROM tracking_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    if (cur.rows[0]?.processing_state === "completed") {
      return {
        destinations_matched: 0,
        routes_matched: 0,
        areas_linked: 0,
        attempt_group_id: null,
        attempt_group_session_count: 0,
        skipped: true,
      };
    }
  }

  // Claim the session. A row already 'processing' is normally off-limits (a
  // concurrent run owns it), but a claim older than STALE_PROCESSING_MINUTES is
  // treated as dead — a prior run that died between here and Step 6 without
  // hitting the catch (e.g. Cloud Run killed the worker), which would otherwise
  // wedge the session at 'processing' forever. processSession is idempotent, so
  // re-claiming a truly-dead run is safe; the window is far longer than any real
  // run so a live run is never stolen.
  const claim = await db.query(
    `UPDATE tracking_sessions
     SET processing_state = 'processing',
         processing_error = NULL,
         processing_started_at = now()
     WHERE id = $1 AND user_id = $2
       AND (processing_state IS DISTINCT FROM 'processing'
            OR processing_started_at IS NULL
            OR processing_started_at < now() - make_interval(mins => ${STALE_PROCESSING_MINUTES}))`,
    [sessionId, userId]
  );
  if ((claim.rowCount ?? 0) === 0) {
    throw new Error("already_processing");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Step 0: Materialize the session's GPS track as a single linestring.
    // Used by destination/route matching here AND by reverse-match queries
    // when a new destination is created. Stored on tracking_sessions.path
    // so subsequent reads hit a GIST index instead of rebuilding the line.
    await client.query(
      `UPDATE tracking_sessions s
       SET path = (
         SELECT ST_MakeLine(tp.location::geometry ORDER BY tp.time)::geography
         FROM tracking_points tp
         WHERE tp.session_id = s.id
       )
       WHERE s.id = $1`,
      [sessionId]
    );

    // Step 1: Clear previous auto-tags (idempotent re-processing)
    await client.query(
      `DELETE FROM session_destinations WHERE session_id = $1 AND source = 'auto'`,
      [sessionId]
    );
    await client.query(
      `DELETE FROM session_routes WHERE session_id = $1 AND source = 'auto'`,
      [sessionId]
    );

    // Step 2: Destination matching
    const destinationsMatched = await matchDestinations(client, sessionId);

    // Step 3: Route matching
    const routesMatched = await matchRoutes(client, sessionId);

    // Step 4: Update destination averages (popular times)
    await updateDestinationAverages(client, sessionId);

    // Step 5: Previous attempt grouping
    const { attempt_group_id, attempt_group_session_count } = await matchPreviousAttempts(
      client,
      sessionId,
      userId
    );

    // Step 6: Mark as processed
    await client.query(
      `UPDATE tracking_sessions
       SET processed_at = NOW(),
           processing_state = 'completed',
           processing_error = NULL
       WHERE id = $1`,
      [sessionId]
    );

    await client.query("COMMIT");

    // Step 7: Check reached summits against protected areas and record the
    // containment links. Runs after COMMIT on the pool (not the just-released
    // client) and is best-effort: destination_areas rows are global and
    // idempotent (ON CONFLICT DO NOTHING), so a failure here must never fail an
    // otherwise-successful recording ingestion.
    let areasLinked = 0;
    try {
      areasLinked = await linkReachedSummitsToAreas(db, sessionId);
    } catch (err) {
      console.error(`[processSession] area linking failed for session ${sessionId}:`, err);
    }

    return {
      destinations_matched: destinationsMatched,
      routes_matched: routesMatched,
      areas_linked: areasLinked,
      attempt_group_id,
      attempt_group_session_count,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    const message = err instanceof Error ? err.message.slice(0, 500) : "Unknown processing error";
    await db.query(
      `UPDATE tracking_sessions
       SET processing_state = 'failed',
           processing_error = $2
       WHERE id = $1`,
      [sessionId, message]
    );
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Build the destination-match INSERT for a plan, ordered along the plan path.
 *
 * Mirrors session matchDestinations() but operates on plans.path (a 2D
 * LineString supplied by the client) and writes to plan_reached_destinations.
 * Ordinal is assigned by ST_LineLocatePoint fraction so destinations read
 * start→finish along the route. ST_LineMerge collapses a multi-route plan path
 * to a single line where contiguous; for a still-multipart path the fraction
 * falls back to 0 (insertion order), which is acceptable for disjoint plans.
 */
export function buildPlanDestinationMatchSql(planId: string): { text: string; values: unknown[] } {
  return {
    text: `INSERT INTO plan_reached_destinations (plan_id, destination_id, ordinal, source)
     SELECT p.id, m.destination_id,
            (row_number() OVER (ORDER BY m.frac, m.destination_id) - 1) AS ordinal,
            'auto'
     FROM plans p
     JOIN LATERAL (
       SELECT d.id AS destination_id,
              CASE WHEN ST_GeometryType(ST_LineMerge(p.path::geometry)) = 'ST_LineString'
                   THEN ST_LineLocatePoint(ST_LineMerge(p.path::geometry), d.location::geometry)
                   ELSE 0 END AS frac
       FROM destinations d
       WHERE (d.owner = 'peaks' OR d.owner = p.user_id)
         AND CASE WHEN d.boundary IS NOT NULL
               THEN ST_DWithin(p.path, d.boundary, 10)
               ELSE ST_DWithin(p.path, d.location, destination_match_radius(d.features))
             END
     ) m ON true
     WHERE p.id = $1 AND p.path IS NOT NULL
     ON CONFLICT (plan_id, destination_id) DO NOTHING`,
    values: [planId],
  };
}

/**
 * Process a plan: match reached destinations against plans.path. Idempotent —
 * clears source='auto' rows first. Claims the plan with the same stale-recovery
 * guard as processSession so a poll racing the inline auto-process bails out
 * with `already_processing` rather than matching twice.
 *
 * plans.path is normally set by the create/update endpoint from client-supplied
 * geometry. If absent (a system-route plan), Step 0 assembles it from the
 * constituent routes that DO exist in the PostGIS routes table.
 */
export async function processPlan(
  planId: string,
  userId: string
): Promise<{ destinations_matched: number }> {
  const claim = await db.query(
    `UPDATE plans
     SET processing_state = 'processing',
         processing_error = NULL,
         processing_started_at = now()
     WHERE id = $1 AND user_id = $2
       AND (processing_state IS DISTINCT FROM 'processing'
            OR processing_started_at IS NULL
            OR processing_started_at < now() - make_interval(mins => ${STALE_PROCESSING_MINUTES}))`,
    [planId, userId]
  );
  if ((claim.rowCount ?? 0) === 0) {
    throw new Error("already_processing");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Step 0: if the client did not supply geometry (system-route plan), try to
    // assemble a path from constituent routes that DO exist in PostGIS.
    await client.query(
      `UPDATE plans p
       SET path = sub.merged
       FROM (
         SELECT pr.plan_id,
                ST_Force2D(ST_LineMerge(ST_Collect(r.path::geometry ORDER BY pr.ordinal)))::geography AS merged
         FROM plan_routes pr JOIN routes r ON r.id = pr.route_id
         WHERE pr.plan_id = $1
         GROUP BY pr.plan_id
       ) sub
       WHERE p.id = $1 AND p.path IS NULL`,
      [planId]
    );

    // Step 1: clear previous auto-tags (idempotent re-processing). Never touches
    // user-chosen plan_destinations goals.
    await client.query(
      `DELETE FROM plan_reached_destinations WHERE plan_id = $1 AND source = 'auto'`,
      [planId]
    );

    // Step 2: destination matching, ordered along the path.
    const match = buildPlanDestinationMatchSql(planId);
    const result = await client.query(match.text, match.values);
    const destinationsMatched = result.rowCount ?? 0;

    // Step 3: materialize distance from the path if the client didn't provide it.
    await client.query(
      `UPDATE plans SET distance = COALESCE(distance, ST_Length(path))
       WHERE id = $1 AND path IS NOT NULL`,
      [planId]
    );

    // Step 4: mark completed.
    await client.query(
      `UPDATE plans
       SET processed_at = NOW(), processing_state = 'completed', processing_error = NULL
       WHERE id = $1`,
      [planId]
    );

    await client.query("COMMIT");
    return { destinations_matched: destinationsMatched };
  } catch (err) {
    await client.query("ROLLBACK");
    const message = err instanceof Error ? err.message.slice(0, 500) : "Unknown processing error";
    await db.query(
      `UPDATE plans SET processing_state = 'failed', processing_error = $2 WHERE id = $1`,
      [planId, message]
    );
    throw err;
  } finally {
    client.release();
  }
}
