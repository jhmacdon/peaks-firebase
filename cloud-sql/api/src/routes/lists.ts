import { Router, Response } from "express";
import { asyncRoute } from "../lib/async-route";
import db from "../db";
import { routeDoneCoverageSql } from "../route-coverage";
import { routeCoverJoinSql, routeCoverSelectSql } from "../lib/route-cover";

const router = Router();

// GET /api/lists/popular?limit=N
// Lists ordered by destination count desc (proxy for "substantive" / popular).
// Must precede /:id so "popular" isn't captured as an id.
router.get("/popular", asyncRoute(async (req, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 10;
  const result = await db.query(
    `SELECT l.id, l.name, l.description, l.owner,
            l.year_established, l.organization, l.source_name, l.source_url, l.region,
            list_counts.destination_count,
            effective_list_completion_target(
              l.completion_target, list_counts.destination_count
            ) AS completion_target,
            l.created_at, l.updated_at
     FROM lists l
     CROSS JOIN LATERAL (
       SELECT COUNT(*)::int AS destination_count
       FROM list_destinations
       WHERE list_id = l.id
     ) list_counts
     ORDER BY destination_count DESC NULLS LAST, l.name ASC
     LIMIT $1`,
    [limit]
  );
  res.json(result.rows);
}));

// GET /api/lists/by-destinations?ids=id1,id2,id3
// All distinct lists that contain any of the given destination IDs.
// Replaces Firestore arrayContainsAny on iOS.
// Must precede /:id so the literal segment isn't captured as an id.
router.get("/by-destinations", asyncRoute(async (req, res: Response) => {
  const idsParam = (req.query.ids as string) || "";
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    res.json([]);
    return;
  }
  const result = await db.query(
    `SELECT DISTINCT l.id, l.name, l.description, l.owner,
            l.year_established, l.organization, l.source_name, l.source_url, l.region,
            list_counts.destination_count,
            effective_list_completion_target(
              l.completion_target, list_counts.destination_count
            ) AS completion_target,
            l.created_at, l.updated_at
     FROM lists l
     CROSS JOIN LATERAL (
       SELECT COUNT(*)::int AS destination_count
       FROM list_destinations
       WHERE list_id = l.id
     ) list_counts
     JOIN list_destinations ld ON ld.list_id = l.id
     WHERE ld.destination_id = ANY($1::text[])
     ORDER BY l.name`,
    [ids]
  );
  res.json(result.rows);
}));

// GET /api/lists/:id
router.get("/:id", asyncRoute(async (req, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT l.id, l.name, l.description, l.owner,
            l.year_established, l.organization, l.source_name, l.source_url, l.region,
            list_counts.destination_count,
            effective_list_completion_target(
              l.completion_target, list_counts.destination_count
            ) AS completion_target,
            l.created_at, l.updated_at
     FROM lists l
     CROSS JOIN LATERAL (
       SELECT COUNT(*)::int AS destination_count
       FROM list_destinations
       WHERE list_id = l.id
     ) list_counts
     WHERE l.id = $1`,
    [id]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "List not found" });
    return;
  }
  res.json(result.rows[0]);
}));

// GET /api/lists/:id/destinations
// Each row carries a best-route summary (community-most-climbed route, falling
// back to shortest) and the destination's common climbing months, so the list
// screen can enrich unclimbed peaks in a single fetch.
router.get("/:id/destinations", asyncRoute(async (req, res: Response) => {
  const { id } = req.params;
  const query = buildListDestinationsQuery(id);
  const result = await db.query(query.text, query.values);
  res.json(result.rows.map(mapListDestinationRow));
}));

export function buildListDestinationsQuery(listId: string) {
  return {
    text: `SELECT d.id, d.name, d.elevation, d.prominence, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            ld.ordinal,
            d.averages, d.averages_offset,
            br.route_id, br.route_name, br.route_distance,
            br.route_gain, br.route_shape, br.route_provenance,
            ${routeCoverSelectSql()}
     FROM destinations d
     JOIN list_destinations ld ON ld.destination_id = d.id
     LEFT JOIN LATERAL (
       SELECT r.id AS route_id, r.name AS route_name,
              r.distance AS route_distance, r.gain AS route_gain,
              r.shape AS route_shape,
              r.provenance AS route_provenance,
              (SELECT COUNT(*) FROM session_routes sr
                WHERE sr.route_id = r.id
                  AND ${routeDoneCoverageSql("sr")}) AS session_count
       FROM route_destinations rd
       JOIN routes r ON r.id = rd.route_id
       WHERE rd.destination_id = d.id AND r.status = 'active'
         AND r.owner = 'peaks'
       ORDER BY session_count DESC NULLS LAST, r.distance ASC NULLS LAST, r.id ASC
       LIMIT 1
     ) br ON true
     ${routeCoverJoinSql("br", "cover", "route_id")}
     WHERE ld.list_id = $1
     ORDER BY ld.ordinal`,
    values: [listId],
  };
}

const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun",
                    "jul", "aug", "sep", "oct", "nov", "dec"];

type MonthBlob = { months?: Record<string, number> } | null | undefined;

const MIN_CLIMB_LOGS = 12;
const DOMINANT_SEASON_SHARE = 0.6;
const MAX_SEASON_MONTHS = 6;
const SHOULDER_MONTH_FRACTION = 0.5;
const MIN_SEASON_DENSITY_RATIO = 1.5;

/**
 * Returns a statistically useful climbing season instead of simply returning
 * the highest-count months. The season must:
 * - have at least 12 climb logs behind it;
 * - contain at least 60% of climbs in six or fewer adjacent calendar months;
 * - stay at least 1.5 times denser per month than the rest of the year.
 *
 * Adjacent shoulder months with at least half the core season's monthly mean
 * are retained. This keeps a balanced multi-month season intact while a sharp
 * one-month spike remains a one-month result. Months wrap across year end.
 */
export function commonClimbingMonths(
  averages: MonthBlob,
  offset: MonthBlob
): number[] {
  const totals = Array<number>(12).fill(0);
  for (const blob of [averages, offset]) {
    const months = blob?.months;
    if (!months) continue;
    for (const [key, value] of Object.entries(months)) {
      const idx = MONTH_KEYS.indexOf(key);
      if (idx < 0 || typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        continue;
      }
      totals[idx] += value;
    }
  }

  const totalClimbs = totals.reduce((sum, value) => sum + value, 0);
  if (totalClimbs < MIN_CLIMB_LOGS) return [];

  const windowTotal = (start: number, length: number): number => {
    let sum = 0;
    for (let offsetIndex = 0; offsetIndex < length; offsetIndex += 1) {
      sum += totals[(start + offsetIndex) % totals.length];
    }
    return sum;
  };

  let seasonStart = -1;
  let seasonLength = 0;
  let seasonTotal = 0;

  // The shortest window that carries a clear majority is the season's core.
  for (let length = 1; length <= MAX_SEASON_MONTHS; length += 1) {
    let bestStart = 0;
    let bestTotal = -1;
    for (let start = 0; start < totals.length; start += 1) {
      const candidateTotal = windowTotal(start, length);
      if (candidateTotal > bestTotal) {
        bestStart = start;
        bestTotal = candidateTotal;
      }
    }
    if (bestTotal / totalClimbs >= DOMINANT_SEASON_SHARE) {
      seasonStart = bestStart;
      seasonLength = length;
      seasonTotal = bestTotal;
      break;
    }
  }

  if (seasonStart < 0) return [];

  // Restore balanced shoulders that the shortest-majority rule may trim.
  while (seasonLength < MAX_SEASON_MONTHS) {
    const leftIndex = (seasonStart - 1 + totals.length) % totals.length;
    const rightIndex = (seasonStart + seasonLength) % totals.length;
    const threshold = (seasonTotal / seasonLength) * SHOULDER_MONTH_FRACTION;
    const leftTotal = totals[leftIndex];
    const rightTotal = totals[rightIndex];

    if (leftTotal < threshold && rightTotal < threshold) break;
    if (leftTotal >= rightTotal) {
      seasonStart = leftIndex;
      seasonTotal += leftTotal;
    } else {
      seasonTotal += rightTotal;
    }
    seasonLength += 1;
  }

  const outsideTotal = totalClimbs - seasonTotal;
  const insideDensity = seasonTotal / seasonLength;
  const outsideDensity = outsideTotal / (totals.length - seasonLength);
  if (outsideDensity > 0 && insideDensity / outsideDensity < MIN_SEASON_DENSITY_RATIO) {
    return [];
  }

  return Array.from(
    { length: seasonLength },
    (_, index) => ((seasonStart + index) % totals.length) + 1
  );
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
    // Keep the existing wire key for compatibility with released clients.
    popular_months: commonClimbingMonths(
      averages as MonthBlob,
      averages_offset as MonthBlob
    ),
  };
}

// GET /api/lists — all lists (paginated)
router.get("/", asyncRoute(async (req, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;

  const result = await db.query(
    `SELECT l.id, l.name, l.description, l.owner,
            l.year_established, l.organization, l.source_name, l.source_url, l.region,
            list_counts.destination_count,
            effective_list_completion_target(
              l.completion_target, list_counts.destination_count
            ) AS completion_target,
            l.created_at, l.updated_at
     FROM lists l
     CROSS JOIN LATERAL (
       SELECT COUNT(*)::int AS destination_count
       FROM list_destinations
       WHERE list_id = l.id
     ) list_counts
     ORDER BY l.name
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json(result.rows);
}));

export default router;
