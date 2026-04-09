import { Router, Response } from "express";
import { getUid } from "../auth";
import db from "../db";
import { processSession } from "../processing";
import { notifySessionProcessed } from "../slack";

const router = Router();

// GET /api/sessions — current user's sessions with inline destinations
router.get("/", async (req, res: Response) => {
  const uid = getUid(req);
  const limit = parseInt(req.query.limit as string) || 200;
  const offset = parseInt(req.query.offset as string) || 0;

  const result = await db.query(
    `SELECT s.id, s.user_id, s.name, s.start_time, s.end_time,
            s.distance, s.total_time, s.pace, s.gain, s.highest_point,
            s.ascent_time, s.descent_time, s.still_time,
            s.activity_type, s.source, s.external_id,
            s.ended, s.is_public,
            s.created_at, s.updated_at,
            COALESCE(
              (SELECT json_agg(json_build_object(
                'id', d.id, 'name', d.name, 'elevation', d.elevation,
                'features', d.features,
                'lat', ST_Y(d.location::geometry),
                'lng', ST_X(d.location::geometry)
              ))
              FROM session_destinations sd
              JOIN destinations d ON d.id = sd.destination_id
              WHERE sd.session_id = s.id AND sd.relation = 'reached'),
              '[]'::json
            ) AS destinations_reached,
            COALESCE(
              (SELECT json_agg(json_build_object(
                'id', d.id, 'name', d.name, 'elevation', d.elevation,
                'features', d.features,
                'lat', ST_Y(d.location::geometry),
                'lng', ST_X(d.location::geometry)
              ))
              FROM session_destinations sd
              JOIN destinations d ON d.id = sd.destination_id
              WHERE sd.session_id = s.id AND sd.relation = 'goal'),
              '[]'::json
            ) AS destination_goals
     FROM tracking_sessions s
     WHERE s.user_id = $1
     ORDER BY s.start_time DESC
     LIMIT $2 OFFSET $3`,
    [uid, limit, offset]
  );
  res.json(result.rows);
});

// GET /api/sessions/:id
router.get("/:id", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  const result = await db.query(
    `SELECT id, user_id, name, start_time, end_time,
            distance, total_time, pace, gain, highest_point,
            ascent_time, descent_time, still_time,
            activity_type, source, external_id,
            health_data, ended, is_public,
            created_at, updated_at
     FROM tracking_sessions
     WHERE id = $1 AND (user_id = $2 OR is_public = true)`,
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
     WHERE s.user_id = $1 AND s.ended = true AND s.processed_at IS NULL
       AND EXISTS (SELECT 1 FROM tracking_points tp WHERE tp.session_id = s.id)
     ORDER BY s.start_time DESC`,
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
    `SELECT id, ended FROM tracking_sessions WHERE id = $1 AND user_id = $2`,
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
    res.json({ group_id: null, sessions: [] });
    return;
  }

  const result = await db.query(
    `SELECT id, name, start_time, end_time,
            distance, total_time, gain, highest_point,
            activity_type, created_at
     FROM tracking_sessions
     WHERE group_id = $1
     ORDER BY start_time DESC`,
    [groupId]
  );

  res.json({ group_id: groupId, sessions: result.rows });
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

    await client.query("COMMIT");
    res.status(201).json({ id });
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

    await client.query("COMMIT");
    res.json({ id });
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

  const result = await db.query(
    `DELETE FROM tracking_sessions WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, uid]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ deleted: true, id });
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

    for (const pt of points) {
      await client.query(
        `INSERT INTO tracking_points
          (session_id, time, segment_number, location, elevation,
           speed, azimuth, hdop, speed_accuracy)
         VALUES ($1, $2, $3,
                 ST_SetSRID(ST_MakePoint($5, $4, $6), 4326)::geography,
                 $6, $7, $8, $9, $10)
         ON CONFLICT (session_id, time) DO NOTHING`,
        [
          id,
          pt.time,
          pt.segment_number ?? 0,
          pt.lat,
          pt.lng,
          pt.elevation ?? 0,
          pt.speed ?? null,
          pt.azimuth ?? null,
          pt.hdop ?? null,
          pt.speed_accuracy ?? null,
        ]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ inserted: points.length });

    // Auto-trigger processing (fire-and-forget) if session is ended
    if (session.rows[0].ended) {
      processSession(id, uid)
        .then((result) =>
          notifySessionProcessed(id, uid, result.destinations_matched, result.routes_matched)
        )
        .catch((err) =>
          console.error("Auto-processing failed for session", id, err)
        );
    }
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
