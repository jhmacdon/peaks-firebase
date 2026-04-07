import { Router, Response } from "express";
import { AuthRequest } from "../auth";
import db from "../db";

const router = Router();

// GET /api/destinations/:id
router.get("/:id", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.prominence, d.type,
            d.activities, d.features, d.owner,
            d.country_code, d.state_code,
            d.hero_image, d.hero_image_attribution, d.hero_image_attribution_url,
            d.averages, d.explicitly_saved, d.recency,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            ST_Z(d.location::geometry) AS elev_z,
            d.bbox_min_lat, d.bbox_max_lat, d.bbox_min_lng, d.bbox_max_lng,
            d.created_at, d.updated_at,
            COALESCE(stats.session_count, 0) AS session_count,
            COALESCE(stats.success_count, 0) AS success_count
     FROM destinations d
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS session_count,
              COUNT(*) FILTER (WHERE sd.relation = 'reached') AS success_count
       FROM session_destinations sd WHERE sd.destination_id = d.id
     ) stats ON true
     WHERE d.id = $1`,
    [id]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Destination not found" });
    return;
  }
  res.json(result.rows[0]);
});

// GET /api/destinations/nearby?lat=46.85&lng=-121.7&radius=10000&limit=50
router.get("/nearby", async (req, res: Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const radius = parseFloat(req.query.radius as string) || 10000; // meters
  const limit = parseInt(req.query.limit as string) || 50;

  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }

  const result = await db.query(
    `SELECT id, name, elevation, prominence, type,
            activities, features,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng,
            ST_Distance(location, ST_MakePoint($2, $1)::geography) AS distance_m
     FROM destinations
     WHERE ST_DWithin(location, ST_MakePoint($2, $1)::geography, $3)
     ORDER BY distance_m
     LIMIT $4`,
    [lat, lng, radius, limit]
  );
  res.json(result.rows);
});

// GET /api/destinations/viewport?minLat=46.5&maxLat=47.0&minLng=-122.0&maxLng=-121.0&limit=200
router.get("/viewport", async (req, res: Response) => {
  const minLat = parseFloat(req.query.minLat as string);
  const maxLat = parseFloat(req.query.maxLat as string);
  const minLng = parseFloat(req.query.minLng as string);
  const maxLng = parseFloat(req.query.maxLng as string);
  const limit = parseInt(req.query.limit as string) || 200;

  if ([minLat, maxLat, minLng, maxLng].some(isNaN)) {
    res.status(400).json({ error: "minLat, maxLat, minLng, maxLng are required" });
    return;
  }

  const result = await db.query(
    `SELECT id, name, elevation, prominence, type,
            activities, features,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng
     FROM destinations
     WHERE ST_Intersects(location,
       ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography)
     LIMIT $5`,
    [minLng, minLat, maxLng, maxLat, limit]
  );
  res.json(result.rows);
});

// GET /api/destinations/:id/routes — routes for this destination
router.get("/:id/routes", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT r.id, r.name, r.polyline6, r.owner,
            r.distance, r.gain, r.gain_loss, r.elevation_string,
            r.external_links, r.completion
     FROM routes r
     JOIN route_destinations rd ON rd.route_id = r.id
     WHERE rd.destination_id = $1 AND r.status = 'active'
     ORDER BY r.name`,
    [id]
  );
  res.json(result.rows);
});

// GET /api/destinations/:id/lists — lists containing this destination
router.get("/:id/lists", async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT l.id, l.name, l.description, l.owner,
            (SELECT COUNT(*) FROM list_destinations WHERE list_id = l.id) AS destination_count
     FROM lists l
     JOIN list_destinations ld ON ld.list_id = l.id
     WHERE ld.destination_id = $1
     ORDER BY l.name`,
    [id]
  );
  res.json(result.rows);
});

export default router;
