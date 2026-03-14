import { Router, Response } from "express";
import db from "../db";

const router = Router();

// GET /api/lists/:id
router.get("/:id", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT id, name, description, owner, created_at, updated_at
     FROM lists WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "List not found" });
    return;
  }
  res.json(result.rows[0]);
});

// GET /api/lists/:id/destinations
router.get("/:id/destinations", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.prominence, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            ld.ordinal
     FROM destinations d
     JOIN list_destinations ld ON ld.destination_id = d.id
     WHERE ld.list_id = $1
     ORDER BY ld.ordinal`,
    [id]
  );
  res.json(result.rows);
});

// GET /api/lists — all lists (paginated)
router.get("/", async (req, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;

  const result = await db.query(
    `SELECT l.id, l.name, l.description, l.owner,
            (SELECT COUNT(*) FROM list_destinations WHERE list_id = l.id) AS destination_count,
            l.created_at, l.updated_at
     FROM lists l
     ORDER BY l.name
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json(result.rows);
});

export default router;
