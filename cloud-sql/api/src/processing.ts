import { PoolClient } from "pg";
import crypto from "crypto";
import db from "./db";

function generateId(): string {
  return crypto.randomBytes(10).toString("hex");
}

export interface ProcessingResult {
  destinations_matched: number;
  routes_matched: number;
  group_id: string | null;
  group_session_count: number;
}

/**
 * Match destinations within proximity of the session's GPS track.
 * Uses bbox pre-filter + feature-aware distance thresholds.
 */
async function matchDestinations(client: PoolClient, sessionId: string): Promise<number> {
  const result = await client.query(
    `WITH session_bbox AS (
        SELECT ST_Expand(ST_Envelope(ST_Collect(location::geometry)), 0.002) AS bbox
        FROM tracking_points WHERE session_id = $1
    ),
    candidate_destinations AS (
        SELECT d.* FROM destinations d, session_bbox b
        WHERE d.location::geometry && b.bbox
    )
    INSERT INTO session_destinations (session_id, destination_id, relation, source)
    SELECT DISTINCT ON (d.id) $1, d.id, 'reached', 'auto'
    FROM candidate_destinations d
    JOIN tracking_points tp ON tp.session_id = $1
    WHERE ST_DWithin(d.location, tp.location,
        CASE WHEN 'summit' = ANY(d.features) THEN 50
             WHEN 'trailhead' = ANY(d.features) THEN 150
             ELSE 100 END)
    ON CONFLICT (session_id, destination_id) DO NOTHING`,
    [sessionId]
  );
  return result.rowCount ?? 0;
}

/**
 * Match routes the session followed using two-phase approach:
 * 1. Find candidate routes within 100m of session track
 * 2. Compute vertex coverage — insert routes with >= 70% coverage
 */
async function matchRoutes(client: PoolClient, sessionId: string): Promise<number> {
  // Phase 1: find candidate routes near the session track
  const candidates = await client.query(
    `WITH session_track AS (
        SELECT ST_MakeLine(location::geometry ORDER BY time)::geography AS track
        FROM tracking_points WHERE session_id = $1
    )
    SELECT r.id FROM routes r, session_track st
    WHERE ST_DWithin(r.path, st.track, 100) AND r.status = 'active'`,
    [sessionId]
  );

  if (candidates.rows.length === 0) {
    return 0;
  }

  const candidateIds = candidates.rows.map((r: { id: string }) => r.id);

  // Phase 2: compute coverage and insert matches
  const result = await client.query(
    `WITH session_track AS (
        SELECT ST_MakeLine(location::geometry ORDER BY time)::geography AS track
        FROM tracking_points WHERE session_id = $1
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
 * Primary: destination-based — sessions sharing 2+ reached destinations.
 * Secondary: spatial — for sessions with <2 destinations, compare simplified
 * GPS tracks using Hausdorff distance (pre-filter by start-point proximity).
 */
async function matchPreviousAttempts(
  client: PoolClient,
  sessionId: string,
  userId: string
): Promise<{ group_id: string | null; group_session_count: number }> {
  // Primary: find sessions sharing 2+ reached destinations
  const destMatches = await client.query(
    `WITH current_dests AS (
        SELECT destination_id FROM session_destinations
        WHERE session_id = $1 AND relation = 'reached'
    )
    SELECT sd.session_id, ts.group_id, COUNT(DISTINCT sd.destination_id) AS shared
    FROM session_destinations sd
    JOIN tracking_sessions ts ON ts.id = sd.session_id
    WHERE sd.destination_id IN (SELECT destination_id FROM current_dests)
      AND sd.relation = 'reached' AND ts.user_id = $2 AND sd.session_id != $1
    GROUP BY sd.session_id, ts.group_id
    HAVING COUNT(DISTINCT sd.destination_id) >= 2`,
    [sessionId, userId]
  );

  if (destMatches.rows.length > 0) {
    return await assignGroup(client, sessionId, userId, destMatches.rows);
  }

  // Check how many reached destinations this session has
  const destCount = await client.query(
    `SELECT COUNT(*) AS cnt FROM session_destinations
     WHERE session_id = $1 AND relation = 'reached'`,
    [sessionId]
  );

  if (parseInt(destCount.rows[0].cnt) >= 2) {
    // Has destinations but no matches — no group needed
    return { group_id: null, group_session_count: 0 };
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
        SELECT tp3.session_id, ts3.group_id,
               ST_Simplify(ST_MakeLine(tp3.location::geometry ORDER BY tp3.time), 0.0005) AS track
        FROM tracking_points tp3
        JOIN tracking_sessions ts3 ON ts3.id = tp3.session_id
        WHERE tp3.session_id IN (SELECT session_id FROM candidate_sessions)
        GROUP BY tp3.session_id, ts3.group_id
    )
    SELECT ot.session_id, ot.group_id
    FROM other_tracks ot, current_track ct
    WHERE ST_HausdorffDistance(ot.track, ct.track) < 0.003`,
    [sessionId, userId]
  );

  if (spatialMatches.rows.length > 0) {
    return await assignGroup(client, sessionId, userId, spatialMatches.rows);
  }

  return { group_id: null, group_session_count: 0 };
}

/**
 * Assign the current session to a group based on matched sessions.
 * If any match already has a group_id, use that. Otherwise create a new group.
 */
async function assignGroup(
  client: PoolClient,
  sessionId: string,
  userId: string,
  matches: Array<{ session_id: string; group_id: string | null }>
): Promise<{ group_id: string; group_session_count: number }> {
  // Find an existing group from matched sessions
  const existingGroupId = matches.find((m) => m.group_id)?.group_id;

  let groupId: string;

  if (existingGroupId) {
    groupId = existingGroupId;
  } else {
    // Create a new group
    groupId = generateId();
    await client.query(
      `INSERT INTO session_groups (id, user_id) VALUES ($1, $2)`,
      [groupId, userId]
    );

    // Assign all matched sessions to the new group
    const matchedIds = matches.map((m) => m.session_id);
    await client.query(
      `UPDATE tracking_sessions SET group_id = $1 WHERE id = ANY($2)`,
      [groupId, matchedIds]
    );
  }

  // Assign current session to the group
  await client.query(
    `UPDATE tracking_sessions SET group_id = $1 WHERE id = $2`,
    [groupId, sessionId]
  );

  // Count total sessions in the group
  const countResult = await client.query(
    `SELECT COUNT(*) AS cnt FROM tracking_sessions WHERE group_id = $1`,
    [groupId]
  );

  return {
    group_id: groupId,
    group_session_count: parseInt(countResult.rows[0].cnt),
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
 */
export async function processSession(
  sessionId: string,
  userId: string
): Promise<ProcessingResult> {
  await db.query(
    `UPDATE tracking_sessions
     SET processing_state = 'processing',
         processing_error = NULL
     WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Step 0: Clear previous auto-tags (idempotent re-processing)
    await client.query(
      `DELETE FROM session_destinations WHERE session_id = $1 AND source = 'auto'`,
      [sessionId]
    );
    await client.query(
      `DELETE FROM session_routes WHERE session_id = $1 AND source = 'auto'`,
      [sessionId]
    );

    // Step 1: Destination matching
    const destinationsMatched = await matchDestinations(client, sessionId);

    // Step 2: Route matching
    const routesMatched = await matchRoutes(client, sessionId);

    // Step 3: Update destination averages (popular times)
    await updateDestinationAverages(client, sessionId);

    // Step 4: Previous attempt grouping
    const { group_id, group_session_count } = await matchPreviousAttempts(
      client,
      sessionId,
      userId
    );

    // Step 5: Mark as processed
    await client.query(
      `UPDATE tracking_sessions
       SET processed_at = NOW(),
           processing_state = 'completed',
           processing_error = NULL
       WHERE id = $1`,
      [sessionId]
    );

    await client.query("COMMIT");

    return {
      destinations_matched: destinationsMatched,
      routes_matched: routesMatched,
      group_id,
      group_session_count,
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
