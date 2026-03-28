import { Router, Response } from "express";
import { getUid } from "../auth";
import db from "../db";

const router = Router();

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

// GET /api/plans/:id/routes
router.get("/:id/routes", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT r.id, r.name, r.polyline6,
            r.distance, r.gain, r.gain_loss, r.shape,
            pr.ordinal
     FROM routes r
     JOIN plan_routes pr ON pr.route_id = r.id
     WHERE pr.plan_id = $1
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
  const { id, name, description, date, destinations, routes: routeIds } = req.body;

  if (!id || !name) {
    res.status(400).json({ error: "id and name are required" });
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO plans (id, user_id, name, description, date)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         date = EXCLUDED.date`,
      [id, uid, name, description || null, date || null]
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
        await client.query(
          `INSERT INTO plan_routes (plan_id, route_id, ordinal)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [id, routeIds[i], i]
        );
      }
    }

    await client.query("COMMIT");
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
  const { name, description, date, destinations, routes: routeIds } = req.body;

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

    await client.query(
      `UPDATE plans SET
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         date = COALESCE($4, date)
       WHERE id = $1`,
      [id, name ?? null, description ?? null, date ?? null]
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
        await client.query(
          `INSERT INTO plan_routes (plan_id, route_id, ordinal)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [id, routeIds[i], i]
        );
      }
    }

    await client.query("COMMIT");
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
