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
// Each row carries a best-route summary (community-most-climbed route, falling
// back to shortest) and the destination's top popularity months, so the list
// screen can enrich unclimbed peaks in a single fetch.
router.get("/:id/destinations", async (req, res: Response) => {
  const { id } = req.params;
  const query = buildListDestinationsQuery(id);
  const result = await db.query(query.text, query.values);
  res.json(result.rows.map(mapListDestinationRow));
});

export function buildListDestinationsQuery(listId: string) {
  return {
    text: `SELECT d.id, d.name, d.elevation, d.prominence, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            ld.ordinal,
            d.averages, d.averages_offset,
            br.route_id, br.route_name, br.route_distance,
            br.route_gain, br.route_shape, br.route_provenance
     FROM destinations d
     JOIN list_destinations ld ON ld.destination_id = d.id
     LEFT JOIN LATERAL (
       SELECT r.id AS route_id, r.name AS route_name,
              r.distance AS route_distance, r.gain AS route_gain,
              r.shape AS route_shape,
              r.provenance AS route_provenance,
              (SELECT COUNT(*) FROM session_routes sr
                WHERE sr.route_id = r.id) AS session_count
       FROM route_destinations rd
       JOIN routes r ON r.id = rd.route_id
       WHERE rd.destination_id = d.id AND r.status = 'active'
         AND r.owner = 'peaks'
       ORDER BY session_count DESC NULLS LAST, r.distance ASC NULLS LAST, r.id ASC
       LIMIT 1
     ) br ON true
     WHERE ld.list_id = $1
     ORDER BY ld.ordinal`,
    values: [listId],
  };
}

const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun",
                    "jul", "aug", "sep", "oct", "nov", "dec"];

type MonthBlob = { months?: Record<string, number> } | null | undefined;

// Merge averages + averages_offset month counts and return the top-N calendar
// months (1-12). Empty when there's no popularity data.
function topMonths(averages: MonthBlob, offset: MonthBlob, count = 2): number[] {
  const totals = new Map<number, number>();
  for (const blob of [averages, offset]) {
    const months = blob?.months;
    if (!months) continue;
    for (const [key, value] of Object.entries(months)) {
      const idx = MONTH_KEYS.indexOf(key);
      if (idx < 0 || typeof value !== "number") continue;
      totals.set(idx + 1, (totals.get(idx + 1) ?? 0) + value);
    }
  }
  return [...totals.entries()]
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, count)
    .map(([month]) => month);
}

export function mapListDestinationRow(row: Record<string, unknown>) {
  const { averages, averages_offset, ...rest } = row;
  return {
    ...rest,
    route_id: row.route_id ?? null,
    route_name: row.route_name ?? null,
    route_distance: row.route_distance ?? null,
    route_gain: row.route_gain ?? null,
    route_shape: row.route_shape ?? null,
    popular_months: topMonths(averages as MonthBlob, averages_offset as MonthBlob),
  };
}

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
