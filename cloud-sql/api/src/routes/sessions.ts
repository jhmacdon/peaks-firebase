import { Router, Response } from "express";
import { PoolClient } from "pg";
import { getUid } from "../auth";
import db from "../db";
import { generateId, processSession } from "../processing";
import { notifySessionProcessed } from "../slack";

const router = Router();
const PROCESSING_STATES = ["idle", "pending", "processing", "completed", "failed"] as const;

// `boundary` is included as GeoJSON so iOS can compute point-to-polygon
// distance (Destination.distance(to:) prefers boundary over centroid). Without
// it, large polygon destinations like lakes — where the user's GPS track
// follows the shoreline rather than the centroid — get dropped from
// timeline rendering even though they're correctly stored as reached.
const DESTINATIONS_REACHED_SQL = `COALESCE(
  (SELECT json_agg(json_build_object(
    'id', d.id, 'name', d.name, 'elevation', d.elevation,
    'features', d.features,
    'lat', ST_Y(d.location::geometry),
    'lng', ST_X(d.location::geometry),
    'boundary', CASE WHEN d.boundary IS NOT NULL
                     THEN ST_AsGeoJSON(d.boundary)::json END,
    'source', sd.source
  ) ORDER BY d.name, d.id)
  FROM session_destinations sd
  JOIN destinations d ON d.id = sd.destination_id
  WHERE sd.session_id = s.id AND sd.relation = 'reached'),
  '[]'::json
)`;

const DESTINATION_GOALS_SQL = `COALESCE(
  (SELECT json_agg(json_build_object(
    'id', d.id, 'name', d.name, 'elevation', d.elevation,
    'features', d.features,
    'lat', ST_Y(d.location::geometry),
    'lng', ST_X(d.location::geometry),
    'boundary', CASE WHEN d.boundary IS NOT NULL
                     THEN ST_AsGeoJSON(d.boundary)::json END,
    'source', sd.source
  ) ORDER BY d.name, d.id)
  FROM session_destinations sd
  JOIN destinations d ON d.id = sd.destination_id
  WHERE sd.session_id = s.id AND sd.relation = 'goal'),
  '[]'::json
)`;

const SESSION_ROUTES_SQL = `COALESCE(
  (SELECT json_agg(json_build_object(
    'id', r.id, 'name', r.name, 'polyline6', r.polyline6,
    'distance', r.distance, 'gain', r.gain, 'gain_loss', r.gain_loss,
    'source', sr.source, 'coverage', sr.coverage
  ) ORDER BY r.name, r.id)
  FROM session_routes sr
  JOIN routes r ON r.id = sr.route_id
  WHERE sr.session_id = s.id AND r.status = 'active'),
  '[]'::json
)`;

function parseLimit(raw: unknown, fallback = 200, max = 1000): number {
  const parsed = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function parseOffset(raw: unknown): number {
  const parsed = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function parseUpdatedSince(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("updated_since must be a valid ISO-8601 timestamp");
  }

  return parsed.toISOString();
}

function parseProcessingStates(raw: unknown): string[] | null {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }

  const states = raw
    .split(",")
    .map((state) => state.trim())
    .filter((state) => state.length > 0);

  if (states.length === 0) {
    return null;
  }

  const invalid = states.filter(
    (state) => !PROCESSING_STATES.includes(state as typeof PROCESSING_STATES[number])
  );
  if (invalid.length > 0) {
    throw new Error(`Invalid processing_state value: ${invalid.join(", ")}`);
  }

  return states;
}

/**
 * Inline auto-process a session that markSessionPendingIfReady just queued.
 * Runs synchronously so the response carries the final processing_state — iOS
 * doesn't have to poll for the typical case. Maps the concurrency-guard race
 * (`already_processing` thrown by processSession) and any other failure to a
 * non-throwing string so the surrounding handler can still respond 200.
 */
async function autoProcessIfQueued(
  queued: boolean,
  sessionId: string,
  uid: string
): Promise<string | null> {
  if (!queued) return null;
  try {
    const result = await processSession(sessionId, uid);
    notifySessionProcessed(
      sessionId,
      uid,
      result.destinations_matched,
      result.routes_matched
    ).catch((err) => console.error("Slack notify failed:", err));
    return "completed";
  } catch (err) {
    if (err instanceof Error && err.message === "already_processing") {
      return "processing";
    }
    console.error("Auto-processing failed for session", sessionId, err);
    return "failed";
  }
}

async function markSessionPendingIfReady(client: PoolClient, sessionId: string): Promise<boolean> {
  const result = await client.query(
    `UPDATE tracking_sessions s
     SET processing_state = 'pending',
         processing_error = NULL
     WHERE s.id = $1
       AND s.ended = true
       AND s.processing_state <> 'processing'
       AND EXISTS (
         SELECT 1
         FROM tracking_points tp
         WHERE tp.session_id = s.id
       )
     RETURNING id`,
    [sessionId]
  );

  return (result.rowCount ?? 0) > 0;
}

async function touchSession(client: PoolClient, sessionId: string): Promise<void> {
  await client.query(
    `UPDATE tracking_sessions
     SET server_updated_at = NOW()
     WHERE id = $1`,
    [sessionId]
  );
}

function buildPointInsertQuery(sessionId: string, points: any[]) {
  const values: any[] = [];
  const placeholders: string[] = [];
  let parameterIndex = 1;

  for (const point of points) {
    if (point.lat == null || point.lng == null || point.time == null) {
      continue;
    }

    const elevation = point.elevation ?? 0;

    placeholders.push(
      `($${parameterIndex}, $${parameterIndex + 1}, $${parameterIndex + 2}, ` +
      `ST_SetSRID(ST_MakePoint($${parameterIndex + 4}, $${parameterIndex + 3}, $${parameterIndex + 5}), 4326)::geography, ` +
      `$${parameterIndex + 5}, $${parameterIndex + 6}, $${parameterIndex + 7}, $${parameterIndex + 8}, $${parameterIndex + 9})`
    );

    values.push(
      sessionId,
      point.time,
      point.segment_number ?? point.segmentNumber ?? 0,
      point.lat,
      point.lng,
      elevation,
      point.speed ?? null,
      point.azimuth ?? null,
      point.hdop ?? null,
      point.speed_accuracy ?? point.speedAccuracy ?? null
    );

    parameterIndex += 10;
  }

  return { values, placeholders };
}

// GET /api/sessions — current user's sessions with inline destinations
router.get("/", async (req, res: Response) => {
  const uid = getUid(req);
  const limit = parseLimit(req.query.limit);
  const offset = parseOffset(req.query.offset);

  let processingStates: string[] | null;
  try {
    processingStates = parseProcessingStates(req.query.processing_state);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const result = await db.query(
    `SELECT s.id, s.user_id, s.name, s.start_time, s.end_time,
            s.distance, s.total_time, s.pace, s.gain, s.highest_point,
            s.ascent_time, s.descent_time, s.still_time,
            s.activity_type, s.source, s.external_id,
            s.group_id, s.processed_at, s.processing_state, s.processing_error,
            s.ended, s.is_public,
            s.created_at, s.updated_at, s.server_updated_at,
            ${DESTINATIONS_REACHED_SQL} AS destinations_reached,
            ${DESTINATION_GOALS_SQL} AS destination_goals
     FROM tracking_sessions s
     WHERE s.user_id = $1
       AND ($2::text[] IS NULL OR s.processing_state = ANY($2))
     ORDER BY s.start_time DESC
     LIMIT $3 OFFSET $4`,
    [uid, processingStates, limit, offset]
  );
  res.json(result.rows);
});

// GET /api/sessions/changes — incremental session sync feed
router.get("/changes", async (req, res: Response) => {
  const uid = getUid(req);
  const limit = parseLimit(req.query.limit);
  const afterId =
    typeof req.query.after_id === "string" && req.query.after_id.trim() !== ""
      ? req.query.after_id
      : null;

  let updatedSince: string | null;
  try {
    updatedSince = parseUpdatedSince(req.query.updated_since);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  if (afterId && !updatedSince) {
    res.status(400).json({ error: "after_id requires updated_since" });
    return;
  }

  const result = await db.query(
    `WITH changed_sessions AS (
        SELECT
          s.id,
          'upsert'::text AS change_type,
          s.server_updated_at,
          NULL::timestamptz AS deleted_at,
          json_build_object(
            'id', s.id,
            'user_id', s.user_id,
            'name', s.name,
            'start_time', s.start_time,
            'end_time', s.end_time,
            'distance', s.distance,
            'total_time', s.total_time,
            'pace', s.pace,
            'gain', s.gain,
            'highest_point', s.highest_point,
            'ascent_time', s.ascent_time,
            'descent_time', s.descent_time,
            'still_time', s.still_time,
            'activity_type', s.activity_type,
            'source', s.source,
            'external_id', s.external_id,
            'group_id', s.group_id,
            'processed_at', s.processed_at,
            'processing_state', s.processing_state,
            'processing_error', s.processing_error,
            'ended', s.ended,
            'is_public', s.is_public,
            'created_at', s.created_at,
            'updated_at', s.updated_at,
            'server_updated_at', s.server_updated_at,
            'destinations_reached', ${DESTINATIONS_REACHED_SQL},
            'destination_goals', ${DESTINATION_GOALS_SQL},
            'routes', ${SESSION_ROUTES_SQL}
          ) AS session
        FROM tracking_sessions s
        WHERE s.user_id = $1
          AND (
            $2::timestamptz IS NULL
            OR s.server_updated_at > $2
            OR (s.server_updated_at = $2 AND $3::text IS NOT NULL AND s.id > $3)
          )
    ),
    changed_deletions AS (
        SELECT
          st.session_id AS id,
          'delete'::text AS change_type,
          st.server_updated_at,
          st.deleted_at,
          NULL::json AS session
        FROM session_tombstones st
        WHERE st.user_id = $1
          AND (
            $2::timestamptz IS NULL
            OR st.server_updated_at > $2
            OR (st.server_updated_at = $2 AND $3::text IS NOT NULL AND st.session_id > $3)
          )
    )
    SELECT id, change_type, server_updated_at, deleted_at, session
    FROM (
      SELECT * FROM changed_sessions
      UNION ALL
      SELECT * FROM changed_deletions
    ) changes
    ORDER BY server_updated_at ASC, id ASC
    LIMIT $4`,
    [uid, updatedSince, afterId, limit]
  );

  const changes = result.rows.map((row) => ({
    id: row.id,
    change_type: row.change_type,
    server_updated_at: row.server_updated_at,
    deleted_at: row.deleted_at,
    session: row.session,
  }));

  const last = result.rows[result.rows.length - 1];
  res.json({
    changes,
    next_cursor: last
      ? {
          updated_since: last.server_updated_at,
          after_id: last.id,
        }
      : null,
    has_more: result.rows.length === limit,
  });
});

// GET /api/sessions/dedup — check if session already imported
router.get("/dedup", async (req, res: Response) => {
  const uid = getUid(req);
  const source = req.query.source as string;
  const externalId = req.query.externalId as string;

  if (!source || !externalId) {
    res.status(400).json({ error: "source and externalId are required" });
    return;
  }

  const result = await db.query(
    `SELECT id FROM tracking_sessions
     WHERE user_id = $1 AND source = $2 AND external_id = $3`,
    [uid, source, externalId]
  );
  res.json({ exists: result.rows.length > 0, sessionId: result.rows[0]?.id || null });
});

// GET /api/sessions/:id
router.get("/:id", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  // Inline destinations and routes match the shape returned by /changes and /api/sessions
  // so iOS pollProcessingSessions doesn't wipe locally-known destinations on every refresh.
  const result = await db.query(
    `SELECT s.id, s.user_id, s.name, s.start_time, s.end_time,
            s.distance, s.total_time, s.pace, s.gain, s.highest_point,
            s.ascent_time, s.descent_time, s.still_time,
            s.activity_type, s.source, s.external_id,
            s.health_data, s.group_id, s.processed_at, s.processing_state, s.processing_error,
            s.ended, s.is_public,
            s.created_at, s.updated_at, s.server_updated_at,
            ${DESTINATIONS_REACHED_SQL} AS destinations_reached,
            ${DESTINATION_GOALS_SQL} AS destination_goals,
            ${SESSION_ROUTES_SQL} AS routes
     FROM tracking_sessions s
     WHERE s.id = $1 AND (s.user_id = $2 OR s.is_public = true)`,
    [id, uid]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(result.rows[0]);
});

// GET /api/sessions/:id/points — GPS breadcrumbs
router.get("/:id/points", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  // Verify ownership or public access
  const session = await db.query(
    `SELECT id FROM tracking_sessions WHERE id = $1 AND (user_id = $2 OR is_public = true)`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const result = await db.query(
    `SELECT time, segment_number, elevation, speed, azimuth,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng
     FROM tracking_points
     WHERE session_id = $1
     ORDER BY time`,
    [id]
  );
  res.json(result.rows);
});

// GET /api/sessions/:id/elevation — elevation profile by time
router.get("/:id/elevation", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  const session = await db.query(
    `SELECT id FROM tracking_sessions WHERE id = $1 AND (user_id = $2 OR is_public = true)`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const result = await db.query(
    `SELECT time, elevation, speed
     FROM tracking_points
     WHERE session_id = $1
     ORDER BY time`,
    [id]
  );
  res.json(result.rows);
});

// GET /api/sessions/:id/destinations
router.get("/:id/destinations", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            CASE WHEN d.boundary IS NOT NULL
                 THEN ST_AsGeoJSON(d.boundary)::json END AS boundary,
            sd.relation, sd.source
     FROM destinations d
     JOIN session_destinations sd ON sd.destination_id = d.id
     WHERE sd.session_id = $1`,
    [id]
  );
  res.json(result.rows);
});

// GET /api/sessions/:id/routes
router.get("/:id/routes", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT r.id, r.name, r.polyline6,
            r.distance, r.gain, r.gain_loss,
            sr.source, sr.coverage
     FROM routes r
     JOIN session_routes sr ON sr.route_id = r.id
     WHERE sr.session_id = $1 AND r.status = 'active'`,
    [id]
  );
  res.json(result.rows);
});

// GET /api/sessions/:id/markers
router.get("/:id/markers", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT id, name, image, created_by, created_at,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng,
            ST_Z(location::geometry) AS elevation
     FROM session_markers
     WHERE session_id = $1
     ORDER BY created_at`,
    [id]
  );
  res.json(result.rows);
});

// POST /api/sessions/process-all — batch process all unprocessed sessions for this user
router.post("/process-all", async (req, res: Response) => {
  const uid = getUid(req);

  const unprocessed = await db.query(
    `SELECT s.id FROM tracking_sessions s
     WHERE s.user_id = $1
       AND s.ended = true
       AND s.processing_state IN ('pending', 'failed')
       AND EXISTS (SELECT 1 FROM tracking_points tp WHERE tp.session_id = s.id)
     ORDER BY s.server_updated_at ASC, s.id ASC`,
    [uid]
  );

  const results: Array<{ id: string; destinations: number; routes: number }> = [];
  for (const row of unprocessed.rows) {
    try {
      const result = await processSession(row.id, uid);
      results.push({
        id: row.id,
        destinations: result.destinations_matched,
        routes: result.routes_matched,
      });
    } catch (err) {
      console.error(`Failed to process session ${row.id}:`, err);
    }
  }

  res.json({ processed: results.length, results });
});

// POST /api/sessions/:id/process — trigger server-side session processing
router.post("/:id/process", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  // Verify ownership
  const session = await db.query(
    `SELECT id, ended, processing_state
     FROM tracking_sessions
     WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Verify session has tracking points
  const pointCount = await db.query(
    `SELECT COUNT(*) AS cnt FROM tracking_points WHERE session_id = $1`,
    [id]
  );
  if (parseInt(pointCount.rows[0].cnt) === 0) {
    res.status(400).json({ error: "Session has no tracking points" });
    return;
  }

  try {
    const result = await processSession(id, uid);
    notifySessionProcessed(id, uid, result.destinations_matched, result.routes_matched)
      .catch((err) => console.error("Slack notify failed:", err));
    res.json(result);
  } catch (err) {
    console.error("Error processing session:", err);
    res.status(500).json({ error: "Failed to process session" });
  }
});

// GET /api/sessions/:id/group — get previous attempts (group members)
router.get("/:id/group", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  // Get session's group_id
  const session = await db.query(
    `SELECT group_id FROM tracking_sessions
     WHERE id = $1 AND (user_id = $2 OR is_public = true)`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const groupId = session.rows[0].group_id;
  if (!groupId) {
    res.json({ group_id: null, group: null, sessions: [] });
    return;
  }

  const result = await db.query(
    `SELECT s.id, s.name, s.start_time, s.end_time,
            s.distance, s.total_time, s.gain, s.highest_point,
            s.activity_type, s.created_at, s.link_opt_out
     FROM tracking_sessions s
     WHERE s.group_id = $1
     ORDER BY s.start_time ASC`,
    [groupId]
  );
  const groupMeta = await db.query(
    `SELECT id, name, manually_linked, created_at, updated_at
       FROM session_groups WHERE id = $1`,
    [groupId]
  );

  res.json({
    group_id: groupId,
    group: groupMeta.rows[0] ?? null,
    sessions: result.rows,
  });
});

// POST /api/sessions/groups — create a group containing two or more sessions
router.post("/groups", async (req, res: Response) => {
  const uid = getUid(req);
  const { session_ids, manually_linked } = req.body as { session_ids?: string[]; manually_linked?: boolean };

  if (!Array.isArray(session_ids) || session_ids.length < 2) {
    res.status(400).json({ error: "session_ids must be an array of at least 2 ids" });
    return;
  }

  // Verify all sessions belong to the caller
  const owned = await db.query(
    `SELECT id FROM tracking_sessions WHERE id = ANY($1) AND user_id = $2`,
    [session_ids, uid]
  );
  if (owned.rows.length !== session_ids.length) {
    res.status(403).json({ error: "One or more sessions not owned or not found" });
    return;
  }

  const groupId = generateId();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO session_groups (id, user_id, manually_linked) VALUES ($1, $2, $3)`,
      [groupId, uid, manually_linked === true]
    );
    await client.query(
      `UPDATE tracking_sessions SET group_id = $1, link_opt_out = false WHERE id = ANY($2)`,
      [groupId, session_ids]
    );
    await client.query("COMMIT");
    res.json({ id: groupId, manually_linked: manually_linked === true, member_ids: session_ids });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error creating session group:", err);
    res.status(500).json({ error: "Failed to create session group" });
  } finally {
    client.release();
  }
});

// POST /api/sessions/:id/group/:groupId — join an existing group
router.post("/:id/group/:groupId", async (req, res: Response) => {
  const uid = getUid(req);
  const { id, groupId } = req.params;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const owned = await client.query(
      `SELECT id FROM tracking_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id, uid]
    );
    if (owned.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const group = await client.query(
      `SELECT id FROM session_groups WHERE id = $1 AND user_id = $2`,
      [groupId, uid]
    );
    if (group.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Group not found" });
      return;
    }

    const result = await client.query(
      `UPDATE tracking_sessions SET group_id = $1, link_opt_out = false WHERE id = $2`,
      [groupId, id]
    );
    if (result.rowCount !== 1) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Session not found" });
      return;
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[POST /:id/group/:groupId]", e);
    res.status(500).json({ error: "Internal error" });
  } finally {
    client.release();
  }
});

// DELETE /api/sessions/:id/group — leave the current group; auto-link will skip this session going forward
router.delete("/:id/group", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Read old group_id BEFORE the update (post-update subselect would return NULL)
    const pre = await client.query(
      `SELECT group_id FROM tracking_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id, uid]
    );
    if (pre.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const oldGroupId: string | null = pre.rows[0].group_id;

    await client.query(
      `UPDATE tracking_sessions SET group_id = NULL, link_opt_out = true WHERE id = $1`,
      [id]
    );

    if (oldGroupId) {
      // Delete the group if it's now empty
      await client.query(
        `DELETE FROM session_groups
           WHERE id = $1
             AND NOT EXISTS (SELECT 1 FROM tracking_sessions WHERE group_id = $1)`,
        [oldGroupId]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error leaving session group:", err);
    res.status(500).json({ error: "Failed to leave session group" });
  } finally {
    client.release();
  }
});

// POST /api/sessions/groups/:id/merge — merge another group into this one
// Body: { other_group_id: string }
// Survivor is the group with older created_at; tie-break on lex id.
router.post("/groups/:id/merge", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const { other_group_id } = req.body as { other_group_id?: string };
  if (!other_group_id) {
    res.status(400).json({ error: "other_group_id required" });
    return;
  }

  const groups = await db.query(
    `SELECT id, created_at, manually_linked
       FROM session_groups
       WHERE id IN ($1, $2) AND user_id = $3`,
    [id, other_group_id, uid]
  );
  if (groups.rows.length !== 2) {
    res.status(404).json({ error: "Both groups must exist and be owned by the caller" });
    return;
  }

  // Pick survivor: older created_at, then lex id
  const sorted = groups.rows.sort((a, b) => {
    const t = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (t !== 0) return t;
    return a.id < b.id ? -1 : 1;
  });
  const survivor = sorted[0];
  const loser = sorted[1];
  const survivorManually = survivor.manually_linked || loser.manually_linked;

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE tracking_sessions SET group_id = $1 WHERE group_id = $2 AND user_id = $3`,
      [survivor.id, loser.id, uid]
    );
    await client.query(
      `UPDATE session_groups SET manually_linked = $1 WHERE id = $2`,
      [survivorManually, survivor.id]
    );
    await client.query(`DELETE FROM session_groups WHERE id = $1`, [loser.id]);
    await client.query("COMMIT");
    res.json({ survivor_id: survivor.id, manually_linked: survivorManually });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[POST /groups/:id/merge]", e);
    res.status(500).json({ error: "Internal error" });
  } finally {
    client.release();
  }
});

// PATCH /api/sessions/groups/:id — rename or toggle manually_linked
router.patch("/groups/:id", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const { name, manually_linked } = req.body as { name?: string | null; manually_linked?: boolean };

  const updates: string[] = [];
  const values: any[] = [];
  let i = 1;
  if (name !== undefined) { updates.push(`name = $${i++}`); values.push(name); }
  if (manually_linked !== undefined) { updates.push(`manually_linked = $${i++}`); values.push(manually_linked); }
  if (updates.length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  values.push(id, uid);
  const result = await db.query(
    `UPDATE session_groups SET ${updates.join(", ")}, updated_at = now()
       WHERE id = $${i++} AND user_id = $${i++}
       RETURNING id, name, manually_linked, updated_at`,
    values
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  res.json(result.rows[0]);
});

// POST /api/sessions — create a new session
router.post("/", async (req, res: Response) => {
  const uid = getUid(req);
  const {
    id, name, start_date, end_date,
    distance, total_time, pace, gain, high_point,
    ascent_time, descent_time, still_time,
    activity_type, source, external_id,
    ended, is_public,
    destinations_reached, destination_goals, routes: routeIds,
  } = req.body;

  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const existingSession = await client.query(
      `SELECT ended
       FROM tracking_sessions
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [id, uid]
    );
    const wasEnded = existingSession.rows[0]?.ended ?? false;
    const nextEnded = ended ?? false;

    await client.query(
      `INSERT INTO tracking_sessions
        (id, user_id, name, start_time, end_time,
         distance, total_time, pace, gain, highest_point,
         ascent_time, descent_time, still_time,
         activity_type, source, external_id,
         ended, is_public)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
         distance = EXCLUDED.distance, total_time = EXCLUDED.total_time,
         pace = EXCLUDED.pace, gain = EXCLUDED.gain,
         highest_point = EXCLUDED.highest_point,
         ascent_time = EXCLUDED.ascent_time, descent_time = EXCLUDED.descent_time,
         still_time = EXCLUDED.still_time,
         activity_type = EXCLUDED.activity_type,
         source = EXCLUDED.source, external_id = EXCLUDED.external_id,
         ended = EXCLUDED.ended, is_public = EXCLUDED.is_public`,
      [
        id, uid, name || null,
        start_date || null, end_date || null,
        distance || null, total_time || null, pace || null,
        gain || null, high_point || null,
        ascent_time || null, descent_time || null, still_time || null,
        activity_type || null, source || null, external_id || null,
        ended ?? false, is_public ?? false,
      ]
    );

    // Set destinations
    if (destinations_reached || destination_goals) {
      await client.query(
        `DELETE FROM session_destinations WHERE session_id = $1`,
        [id]
      );
      for (const destId of destinations_reached || []) {
        await client.query(
          `INSERT INTO session_destinations (session_id, destination_id, relation)
           VALUES ($1, $2, 'reached') ON CONFLICT DO NOTHING`,
          [id, destId]
        );
      }
      for (const destId of destination_goals || []) {
        await client.query(
          `INSERT INTO session_destinations (session_id, destination_id, relation)
           VALUES ($1, $2, 'goal') ON CONFLICT DO NOTHING`,
          [id, destId]
        );
      }
    }

    // Set routes
    if (routeIds) {
      await client.query(
        `DELETE FROM session_routes WHERE session_id = $1`,
        [id]
      );
      for (const routeId of routeIds) {
        await client.query(
          `INSERT INTO session_routes (session_id, route_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, routeId]
        );
      }
    }

    await client.query(
      `DELETE FROM session_tombstones
       WHERE session_id = $1 AND user_id = $2`,
      [id, uid]
    );

    const queuedForProcessing =
      (!existingSession.rows[0] && nextEnded) || (!wasEnded && nextEnded)
        ? await markSessionPendingIfReady(client, id)
        : false;

    await client.query("COMMIT");

    const finalState = await autoProcessIfQueued(queuedForProcessing, id, uid);
    res.status(201).json({
      id,
      processing_state: finalState ?? (queuedForProcessing ? "pending" : null),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error creating session:", err);
    res.status(500).json({ error: "Failed to create session" });
  } finally {
    client.release();
  }
});

// PUT /api/sessions/:id — update session metadata
router.put("/:id", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const {
    name, start_date, end_date,
    distance, total_time, pace, gain, high_point,
    ascent_time, descent_time, still_time,
    activity_type, ended, is_public,
    destinations_reached, destination_goals, routes: routeIds,
  } = req.body;

  // Verify ownership
  const session = await db.query(
    `SELECT id, ended, processing_state
     FROM tracking_sessions
     WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE tracking_sessions SET
         name = COALESCE($2, name),
         start_time = COALESCE($3, start_time),
         end_time = COALESCE($4, end_time),
         distance = COALESCE($5, distance),
         total_time = COALESCE($6, total_time),
         pace = COALESCE($7, pace),
         gain = COALESCE($8, gain),
         highest_point = COALESCE($9, highest_point),
         ascent_time = COALESCE($10, ascent_time),
         descent_time = COALESCE($11, descent_time),
         still_time = COALESCE($12, still_time),
         activity_type = COALESCE($13, activity_type),
         ended = COALESCE($14, ended),
         is_public = COALESCE($15, is_public)
       WHERE id = $1`,
      [
        id,
        name ?? null, start_date ?? null, end_date ?? null,
        distance ?? null, total_time ?? null, pace ?? null,
        gain ?? null, high_point ?? null,
        ascent_time ?? null, descent_time ?? null, still_time ?? null,
        activity_type ?? null, ended ?? null, is_public ?? null,
      ]
    );

    // Update destinations if provided
    if (destinations_reached || destination_goals) {
      await client.query(
        `DELETE FROM session_destinations WHERE session_id = $1`,
        [id]
      );
      for (const destId of destinations_reached || []) {
        await client.query(
          `INSERT INTO session_destinations (session_id, destination_id, relation)
           VALUES ($1, $2, 'reached') ON CONFLICT DO NOTHING`,
          [id, destId]
        );
      }
      for (const destId of destination_goals || []) {
        await client.query(
          `INSERT INTO session_destinations (session_id, destination_id, relation)
           VALUES ($1, $2, 'goal') ON CONFLICT DO NOTHING`,
          [id, destId]
        );
      }
    }

    // Update routes if provided
    if (routeIds) {
      await client.query(
        `DELETE FROM session_routes WHERE session_id = $1`,
        [id]
      );
      for (const routeId of routeIds) {
        await client.query(
          `INSERT INTO session_routes (session_id, route_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, routeId]
        );
      }
    }

    const queuedForProcessing =
      session.rows[0].ended === false && ended === true
        ? await markSessionPendingIfReady(client, id)
        : false;

    await client.query("COMMIT");

    const finalState = await autoProcessIfQueued(queuedForProcessing, id, uid);
    res.json({
      id,
      processing_state: finalState ?? (queuedForProcessing ? "pending" : null),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating session:", err);
    res.status(500).json({ error: "Failed to update session" });
  } finally {
    client.release();
  }
});

// DELETE /api/sessions/:id — delete session (cascades to points, markers, etc.)
router.delete("/:id", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `DELETE FROM tracking_sessions
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [id, uid]
    );
    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const tombstone = await client.query(
      `INSERT INTO session_tombstones (session_id, user_id, deleted_at, server_updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (session_id, user_id) DO UPDATE SET
         deleted_at = EXCLUDED.deleted_at,
         server_updated_at = EXCLUDED.server_updated_at
       RETURNING deleted_at, server_updated_at`,
      [id, uid]
    );

    await client.query("COMMIT");
    res.json({
      deleted: true,
      id,
      deleted_at: tombstone.rows[0].deleted_at,
      server_updated_at: tombstone.rows[0].server_updated_at,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error deleting session:", err);
    res.status(500).json({ error: "Failed to delete session" });
  } finally {
    client.release();
  }
});

// POST /api/sessions/:id/points — batch insert GPS points
router.post("/:id/points", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const { points } = req.body;

  if (!Array.isArray(points) || points.length === 0) {
    res.status(400).json({ error: "points array is required" });
    return;
  }

  // Verify ownership
  const session = await db.query(
    `SELECT id, ended FROM tracking_sessions WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const chunkSize = 250;
    let inserted = 0;
    let queuedForProcessing = false;

    for (let i = 0; i < points.length; i += chunkSize) {
      const chunk = points.slice(i, i + chunkSize);
      const { placeholders, values } = buildPointInsertQuery(id, chunk);

      if (placeholders.length === 0) {
        continue;
      }

      const insertResult = await client.query(
        `INSERT INTO tracking_points
          (session_id, time, segment_number, location, elevation,
           speed, azimuth, hdop, speed_accuracy)
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (session_id, time) DO NOTHING`,
        values
      );

      inserted += insertResult.rowCount ?? 0;
    }

    let processingState: string | null = null;
    if (inserted > 0 && session.rows[0].ended) {
      queuedForProcessing = await markSessionPendingIfReady(client, id);
      processingState = queuedForProcessing ? "pending" : session.rows[0].processing_state;
    } else if (inserted > 0) {
      await touchSession(client, id);
    }

    await client.query("COMMIT");

    // Auto-process inline. Inline await (vs fire-and-forget) so iOS gets the
    // final state in the response and Cloud Run can't kill the worker mid-process.
    const finalState = await autoProcessIfQueued(queuedForProcessing, id, uid);
    res.status(201).json({ inserted, processing_state: finalState ?? processingState });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error inserting points:", err);
    res.status(500).json({ error: "Failed to insert points" });
  } finally {
    client.release();
  }
});

// POST /api/sessions/:id/destinations — set reached/goal destinations
router.post("/:id/destinations", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const { reached, goals } = req.body;

  // Verify ownership
  const session = await db.query(
    `SELECT id FROM tracking_sessions WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM session_destinations WHERE session_id = $1`,
      [id]
    );

    for (const destId of reached || []) {
      await client.query(
        `INSERT INTO session_destinations (session_id, destination_id, relation)
         VALUES ($1, $2, 'reached') ON CONFLICT DO NOTHING`,
        [id, destId]
      );
    }

    for (const destId of goals || []) {
      await client.query(
        `INSERT INTO session_destinations (session_id, destination_id, relation)
         VALUES ($1, $2, 'goal') ON CONFLICT DO NOTHING`,
        [id, destId]
      );
    }

    await client.query("COMMIT");
    res.json({ session_id: id });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error setting destinations:", err);
    res.status(500).json({ error: "Failed to set destinations" });
  } finally {
    client.release();
  }
});

// POST /api/sessions/:id/markers — create a marker
router.post("/:id/markers", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const { name, image, lat, lng, elevation } = req.body;

  // Verify ownership
  const session = await db.query(
    `SELECT id FROM tracking_sessions WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const result = await db.query(
    `INSERT INTO session_markers (session_id, location, name, image, created_by)
     VALUES ($1,
             ST_SetSRID(ST_MakePoint($3, $2, $4), 4326)::geography,
             $5, $6, $7)
     RETURNING id, name, image, created_by, created_at,
               ST_Y(location::geometry) AS lat,
               ST_X(location::geometry) AS lng,
               ST_Z(location::geometry) AS elevation`,
    [id, lat ?? 0, lng ?? 0, elevation ?? 0, name ?? null, image ?? null, uid]
  );
  res.status(201).json(result.rows[0]);
});

// DELETE /api/sessions/:id/markers/:markerId — delete a marker
router.delete("/:id/markers/:markerId", async (req, res: Response) => {
  const uid = getUid(req);
  const { id, markerId } = req.params;

  // Verify session ownership
  const session = await db.query(
    `SELECT id FROM tracking_sessions WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const result = await db.query(
    `DELETE FROM session_markers WHERE id = $1 AND session_id = $2 RETURNING id`,
    [markerId, id]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Marker not found" });
    return;
  }
  res.json({ deleted: true, id: markerId });
});

export default router;
