import { Router, Response } from "express";
import db from "../db";

const router = Router();

// GET /api/routes/:id
router.get("/:id", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT r.id, r.name, r.polyline6, r.owner,
            r.distance, r.gain, r.gain_loss, r.elevation_string,
            r.external_links, r.completion,
            r.created_at, r.updated_at
     FROM routes r WHERE r.id = $1 AND r.status = 'active'`,
    [id]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Route not found" });
    return;
  }
  res.json(result.rows[0]);
});

// GET /api/routes/:id/destinations
router.get("/:id/destinations", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            rd.ordinal
     FROM destinations d
     JOIN route_destinations rd ON rd.destination_id = d.id
     WHERE rd.route_id = $1
     ORDER BY rd.ordinal`,
    [id]
  );
  res.json(result.rows);
});

// GET /api/routes/:id/elevation — elevation profile from LineStringZ vertices
router.get("/:id/elevation", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT (dp).path[1] AS vertex_index,
            ST_X((dp).geom) AS lng,
            ST_Y((dp).geom) AS lat,
            ST_Z((dp).geom) AS elevation
     FROM (SELECT ST_DumpPoints(path::geometry) AS dp
           FROM routes WHERE id = $1) sub
     ORDER BY vertex_index`,
    [id]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Route not found or has no path" });
    return;
  }
  res.json(result.rows);
});

// GET /api/routes/near?lat=46.85&lng=-121.7&radius=5000&limit=20
router.get("/near", async (req, res: Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const radius = parseFloat(req.query.radius as string) || 5000;
  const limit = parseInt(req.query.limit as string) || 20;

  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }

  const result = await db.query(
    `SELECT id, name, distance, gain, gain_loss, elevation_string,
            external_links, completion,
            ST_Distance(path, ST_MakePoint($2, $1)::geography) AS distance_to_point
     FROM routes
     WHERE ST_DWithin(path, ST_MakePoint($2, $1)::geography, $3)
       AND status = 'active'
     ORDER BY distance_to_point
     LIMIT $4`,
    [lat, lng, radius, limit]
  );
  res.json(result.rows);
});

export default router;
