import { Router, Request, Response } from "express";
import { getUid } from "../auth";
import db from "../db";
import { processPlan } from "../processing";
import { parseStatusIds } from "./sessions";

const router = Router();

// Minimal structural type so the status handler can take an injected pool in
// tests without depending on the concrete pg Pool.
interface StatusQueryable {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}

// Validate a client-supplied GeoJSON geometry is a usable plan path: a
// LineString with >= 2 coordinate pairs of finite numbers. Returns true when
// absent (geometry is optional) so callers pass it straight through. Guards the
// DB call from a 500 on malformed/wrong-type input (return 400 instead) and
// from a non-LineString reaching ST_GeomFromGeoJSON.
export function isValidPlanGeometry(g: unknown): boolean {
  if (g === undefined || g === null) return true;
  if (typeof g !== "object") return false;
  const geo = g as { type?: unknown; coordinates?: unknown };
  if (geo.type !== "LineString") return false;
  if (!Array.isArray(geo.coordinates) || geo.coordinates.length < 2) return false;
  return geo.coordinates.every(
    (c) =>
      Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])
  );
}

// GET /api/plans/processing-status?ids=a,b — batch poll for plan processing
// state. Returns ONLY scalar processing fields (owned by the caller) in a single
// query — same poll-storm-safe contract as the sessions endpoint. Registered
// before GET /:id so "processing-status" isn't swallowed as an :id.
export async function handlePlanProcessingStatus(
  req: Request,
  res: Response,
  pool: StatusQueryable = db
): Promise<void> {
  const uid = getUid(req);
  const ids = parseStatusIds(req.query.ids);
  if (ids.length === 0) {
    res.status(400).json({ error: "ids query parameter required" });
    return;
  }
  const result = await pool.query(
    `SELECT id, processing_state, processing_error, processed_at, updated_at AS server_updated_at
     FROM plans
     WHERE user_id = $1 AND id = ANY($2)`,
    [uid, ids]
  );
  res.json(result.rows);
}

router.get("/processing-status", (req, res: Response) => handlePlanProcessingStatus(req, res));

// GET /api/plans — current user's plans (owned + party member)
router.get("/", async (req, res: Response) => {
  const uid = getUid(req);
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;

  const result = await db.query(
    `SELECT DISTINCT p.id, p.user_id, p.name, p.description, p.date,
            (SELECT COUNT(*) FROM plan_destinations WHERE plan_id = p.id) AS destination_count,
            (SELECT COUNT(*) FROM plan_routes WHERE plan_id = p.id) AS route_count,
            (SELECT COUNT(*) FROM plan_party WHERE plan_id = p.id) AS party_count,
            p.created_at, p.updated_at
     FROM plans p
     LEFT JOIN plan_party pp ON pp.plan_id = p.id AND pp.user_id = $1
     WHERE p.user_id = $1 OR pp.user_id = $1
     ORDER BY p.updated_at DESC
     LIMIT $2 OFFSET $3`,
    [uid, limit, offset]
  );
  res.json(result.rows);
});

// GET /api/plans/:id
router.get("/:id", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  const result = await db.query(
    `SELECT p.id, p.user_id, p.name, p.description, p.date,
            p.created_at, p.updated_at
     FROM plans p
     LEFT JOIN plan_party pp ON pp.plan_id = p.id AND pp.user_id = $2
     WHERE p.id = $1 AND (p.user_id = $2 OR pp.user_id = $2)`,
    [id, uid]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  res.json(result.rows[0]);
});

// GET /api/plans/:id/destinations
router.get("/:id/destinations", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            pd.ordinal
     FROM destinations d
     JOIN plan_destinations pd ON pd.destination_id = d.id
     WHERE pd.plan_id = $1
     ORDER BY pd.ordinal`,
    [id]
  );
  res.json(result.rows);
});

// GET /api/plans/:id/reached-destinations — auto-matched destinations along the
// plan path, ordered. Powers the clockless plan timeline (route import + plan
// detail). Distinct from /:id/destinations (user-chosen goals).
router.get("/:id/reached-destinations", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            prd.ordinal
     FROM destinations d
     JOIN plan_reached_destinations prd ON prd.destination_id = d.id
     WHERE prd.plan_id = $1
       AND EXISTS (
         SELECT 1 FROM plans p
         LEFT JOIN plan_party pp ON pp.plan_id = p.id AND pp.user_id = $2
         WHERE p.id = $1 AND (p.user_id = $2 OR pp.user_id = $2)
       )
     ORDER BY prd.ordinal`,
    [id, uid]
  );
  res.json(result.rows);
});

// GET /api/plans/:id/routes
router.get("/:id/routes", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT r.id, r.name, r.polyline6,
            r.distance, r.gain, r.gain_loss, r.shape,
            pr.ordinal
     FROM routes r
     JOIN plan_routes pr ON pr.route_id = r.id
     WHERE pr.plan_id = $1 AND r.status = 'active'
     ORDER BY pr.ordinal`,
    [id]
  );
  res.json(result.rows);
});

// GET /api/plans/:id/party
router.get("/:id/party", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT user_id, joined_at FROM plan_party
     WHERE plan_id = $1
     ORDER BY joined_at`,
    [id]
  );
  res.json(result.rows);
});

// POST /api/plans — create a new plan
router.post("/", async (req, res: Response) => {
  const uid = getUid(req);
  const { id, name, description, date, destinations, routes: routeIds, geometry, distance, gain } = req.body;

  if (!id || !name) {
    res.status(400).json({ error: "id and name are required" });
    return;
  }
  if (!isValidPlanGeometry(geometry)) {
    res.status(400).json({ error: "geometry must be a GeoJSON LineString with >= 2 points" });
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // When the client supplies geometry (GeoJSON LineString of the plan's full
    // concatenated path), store it in plans.path and flag the plan 'pending' so
    // a poll started right away sees the lifecycle. processPlan is kicked after
    // COMMIT. plan_routes can't supply geometry for user routes (they live only
    // in Firestore), so the client-supplied path is the source of truth.
    await client.query(
      `INSERT INTO plans (id, user_id, name, description, date, path, distance, gain,
                          processing_state, updated_at)
       VALUES ($1, $2, $3, $4, $5,
               CASE WHEN $6::text IS NOT NULL THEN ST_Force2D(ST_GeomFromGeoJSON($6))::geography ELSE NULL END,
               $7, $8,
               CASE WHEN $6::text IS NOT NULL THEN 'pending' ELSE 'idle' END,
               now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         date = EXCLUDED.date,
         path = COALESCE(EXCLUDED.path, plans.path),
         distance = COALESCE(EXCLUDED.distance, plans.distance),
         gain = COALESCE(EXCLUDED.gain, plans.gain),
         processing_state = CASE WHEN EXCLUDED.path IS NOT NULL THEN 'pending' ELSE plans.processing_state END,
         updated_at = now()`,
      [id, uid, name, description || null, date || null,
       geometry ? JSON.stringify(geometry) : null, distance ?? null, gain ?? null]
    );

    if (destinations) {
      await client.query(
        `DELETE FROM plan_destinations WHERE plan_id = $1`,
        [id]
      );
      for (let i = 0; i < destinations.length; i++) {
        await client.query(
          `INSERT INTO plan_destinations (plan_id, destination_id, ordinal)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [id, destinations[i], i]
        );
      }
    }

    if (routeIds) {
      await client.query(
        `DELETE FROM plan_routes WHERE plan_id = $1`,
        [id]
      );
      for (let i = 0; i < routeIds.length; i++) {
        // Only link routes that actually exist in PostGIS (system routes).
        // User-imported routes live in Firestore only and would violate the
        // plan_routes → routes FK; the plan's geometry comes from plans.path.
        await client.query(
          `INSERT INTO plan_routes (plan_id, route_id, ordinal)
           SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM routes WHERE id = $2)
           ON CONFLICT DO NOTHING`,
          [id, routeIds[i], i]
        );
      }
    }

    await client.query("COMMIT");

    // Kick processing inline (best-effort) when geometry was supplied. iOS polls
    // /processing-status to observe pending→completed; a failure here flips the
    // plan to 'failed' inside processPlan and is surfaced the same way.
    if (geometry) {
      processPlan(id, uid).catch((err) =>
        console.error(`Inline plan process failed for ${id}:`, err)
      );
    }

    res.status(201).json({ id });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error creating plan:", err);
    res.status(500).json({ error: "Failed to create plan" });
  } finally {
    client.release();
  }
});

// PUT /api/plans/:id — update plan metadata
router.put("/:id", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const { name, description, date, destinations, routes: routeIds, geometry, distance, gain } = req.body;

  if (!isValidPlanGeometry(geometry)) {
    res.status(400).json({ error: "geometry must be a GeoJSON LineString with >= 2 points" });
    return;
  }

  // Verify ownership
  const plan = await db.query(
    `SELECT id FROM plans WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (plan.rows.length === 0) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Geometry (when supplied) replaces plans.path and re-flags 'pending' so the
    // plan re-processes; processPlan is kicked after COMMIT.
    await client.query(
      `UPDATE plans SET
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         date = COALESCE($4, date),
         path = CASE WHEN $5::text IS NOT NULL THEN ST_Force2D(ST_GeomFromGeoJSON($5))::geography ELSE path END,
         distance = COALESCE($6, distance),
         gain = COALESCE($7, gain),
         processing_state = CASE WHEN $5::text IS NOT NULL THEN 'pending' ELSE processing_state END,
         updated_at = now()
       WHERE id = $1`,
      [id, name ?? null, description ?? null, date ?? null,
       geometry ? JSON.stringify(geometry) : null, distance ?? null, gain ?? null]
    );

    if (destinations) {
      await client.query(
        `DELETE FROM plan_destinations WHERE plan_id = $1`,
        [id]
      );
      for (let i = 0; i < destinations.length; i++) {
        await client.query(
          `INSERT INTO plan_destinations (plan_id, destination_id, ordinal)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [id, destinations[i], i]
        );
      }
    }

    if (routeIds) {
      await client.query(
        `DELETE FROM plan_routes WHERE plan_id = $1`,
        [id]
      );
      for (let i = 0; i < routeIds.length; i++) {
        // Only link routes that actually exist in PostGIS (system routes).
        // User-imported routes live in Firestore only and would violate the
        // plan_routes → routes FK; the plan's geometry comes from plans.path.
        await client.query(
          `INSERT INTO plan_routes (plan_id, route_id, ordinal)
           SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM routes WHERE id = $2)
           ON CONFLICT DO NOTHING`,
          [id, routeIds[i], i]
        );
      }
    }

    await client.query("COMMIT");

    if (geometry) {
      processPlan(id, uid).catch((err) =>
        console.error(`Inline plan process failed for ${id}:`, err)
      );
    }

    res.json({ id });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating plan:", err);
    res.status(500).json({ error: "Failed to update plan" });
  } finally {
    client.release();
  }
});

// DELETE /api/plans/:id
router.delete("/:id", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  const result = await db.query(
    `DELETE FROM plans WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, uid]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  res.json({ deleted: true, id });
});

// POST /api/plans/:id/process — trigger server-side plan processing (match
// reached destinations against plans.path). Used for explicit re-process; the
// create/update endpoints already kick processing inline when geometry changes.
router.post("/:id/process", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const plan = await db.query(`SELECT id FROM plans WHERE id = $1 AND user_id = $2`, [id, uid]);
  if (plan.rows.length === 0) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  try {
    const result = await processPlan(id, uid);
    res.json(result);
  } catch (err) {
    // A concurrent run (the inline auto-process kicked on create/update, or
    // another poll) already owns the claim — that's a benign race, not a
    // failure. Surface 409 so iOS keeps polling instead of treating it as an
    // error and retrying (which would worsen the race; cf. incident #54).
    if (err instanceof Error && err.message === "already_processing") {
      res.status(409).json({ error: "already_processing" });
      return;
    }
    console.error("Error processing plan:", err);
    res.status(500).json({ error: "Failed to process plan" });
  }
});

// POST /api/plans/:id/party — add a party member
router.post("/:id/party", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const { user_id: memberId } = req.body;

  if (!memberId) {
    res.status(400).json({ error: "user_id is required" });
    return;
  }

  // Verify ownership
  const plan = await db.query(
    `SELECT id FROM plans WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (plan.rows.length === 0) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  await db.query(
    `INSERT INTO plan_party (plan_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [id, memberId]
  );
  res.status(201).json({ plan_id: id, user_id: memberId });
});

// DELETE /api/plans/:id/party/:userId — remove a party member
router.delete("/:id/party/:userId", async (req, res: Response) => {
  const uid = getUid(req);
  const { id, userId: memberId } = req.params;

  // Owner can remove anyone; members can remove themselves
  const plan = await db.query(
    `SELECT user_id FROM plans WHERE id = $1`,
    [id]
  );
  if (plan.rows.length === 0) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  if (plan.rows[0].user_id !== uid && memberId !== uid) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await db.query(
    `DELETE FROM plan_party WHERE plan_id = $1 AND user_id = $2`,
    [id, memberId]
  );
  res.json({ deleted: true, plan_id: id, user_id: memberId });
});

export default router;
