import { Router, Response } from "express";
import db from "../db";

const router = Router();

// GET /api/lists/popular?limit=N
// Lists ordered by destination count desc (proxy for "substantive" / popular).
// Must precede /:id so "popular" isn't captured as an id.
router.get("/popular", async (req, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 10;
  const result = await db.query(
    `SELECT l.id, l.name, l.description, l.owner,
            (SELECT COUNT(*) FROM list_destinations WHERE list_id = l.id)
              AS destination_count,
            l.created_at, l.updated_at
     FROM lists l
     ORDER BY destination_count DESC NULLS LAST, l.name ASC
     LIMIT $1`,
    [limit]
  );
  res.json(result.rows);
});

// GET /api/lists/by-destinations?ids=id1,id2,id3
// All distinct lists that contain any of the given destination IDs.
// Replaces Firestore arrayContainsAny on iOS.
// Must precede /:id so the literal segment isn't captured as an id.
router.get("/by-destinations", async (req, res: Response) => {
  const idsParam = (req.query.ids as string) || "";
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    res.json([]);
    return;
  }
  const result = await db.query(
    `SELECT DISTINCT l.id, l.name, l.description, l.owner,
            (SELECT COUNT(*) FROM list_destinations WHERE list_id = l.id)
              AS destination_count,
            l.created_at, l.updated_at
     FROM lists l
     JOIN list_destinations ld ON ld.list_id = l.id
     WHERE ld.destination_id = ANY($1::text[])
     ORDER BY l.name`,
    [ids]
  );
  res.json(result.rows);
});

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
