import { Router, Request, Response } from "express";
import db, { createDbClient } from "../db";
import { normalizeSearchName } from "../search-utils";
import { geolocateRequest } from "../ip-geo";

const router = Router();

const destinationSearchText = "COALESCE(NULLIF(search_name, ''), lower(name))";
const destinationSearchVector = `to_tsvector('simple', ${destinationSearchText})`;

export interface DestinationSearchQueryInput {
  normalizedQuery: string;
  rawQuery: string;
  lat?: number;
  lng?: number;
  limit: number;
}

interface SearchSqlQuery {
  text: string;
  values: unknown[];
}

interface SearchDbPool {
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
    release(): void;
  }>;
}

function hasGeo(input: { lat?: number; lng?: number }): input is { lat: number; lng: number } {
  return input.lat !== undefined
    && input.lng !== undefined
    && !isNaN(input.lat)
    && !isNaN(input.lng);
}

function tokenPrefixTsQuery(normalizedQuery: string): string | null {
  if (!/^[a-z0-9]+$/.test(normalizedQuery)) {
    return null;
  }

  return `${normalizedQuery}:*`;
}

function buildShortDestinationSearchQuery(input: DestinationSearchQueryInput): { text: string; values: unknown[] } | null {
  const q = input.normalizedQuery;
  if (q.length !== 2) {
    return null;
  }

  const tsQuery = tokenPrefixTsQuery(q);
  const raw = input.rawQuery.trim().toLowerCase();
  const normalizedPrefix = `${q}%`;
  const rawPrefix = `${raw}%`;
  const shortLimit = Math.min(input.limit, 10);

  if (!tsQuery) {
    return {
      text: `SELECT id, name, elevation, prominence, type,
              activities, features,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lng
       FROM destinations
       WHERE false
       LIMIT $1`,
      values: [shortLimit],
    };
  }

  if (hasGeo(input)) {
    return {
      text: `SELECT id, name, elevation, prominence, type,
              activities, features,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lng,
              CASE WHEN ${destinationSearchVector} @@ to_tsquery('simple', $1) THEN 1 ELSE 0 END AS text_score,
              ST_Distance(location, ST_MakePoint($7, $6)::geography) AS distance_m,
              (
                CASE WHEN ${destinationSearchVector} @@ to_tsquery('simple', $1) THEN 0.55 ELSE 0 END
                + CASE WHEN ${destinationSearchText} ILIKE $2 OR lower(name) ILIKE $3 THEN 0.15 ELSE 0 END
                + CASE WHEN ${destinationSearchText} = $4 OR lower(name) = $5 THEN 0.10 ELSE 0 END
                + EXP(-1.0 * ST_Distance(location, ST_MakePoint($7, $6)::geography) / 500000.0) * 0.10
                + LEAST(COALESCE(elevation, 0), 9000.0) / 9000.0 * 0.07
                + LEAST(COALESCE(prominence, 0), 9000.0) / 9000.0 * 0.03
              ) AS score
       FROM destinations
       WHERE ${destinationSearchVector} @@ to_tsquery('simple', $1)
       ORDER BY score DESC
       LIMIT $8`,
      values: [tsQuery, normalizedPrefix, rawPrefix, q, raw, input.lat, input.lng, shortLimit],
    };
  }

  return {
    text: `SELECT id, name, elevation, prominence, type,
              activities, features,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lng,
              CASE WHEN ${destinationSearchVector} @@ to_tsquery('simple', $1) THEN 1 ELSE 0 END AS text_score,
              (
                CASE WHEN ${destinationSearchVector} @@ to_tsquery('simple', $1) THEN 0.60 ELSE 0 END
                + CASE WHEN ${destinationSearchText} ILIKE $2 OR lower(name) ILIKE $3 THEN 0.15 ELSE 0 END
                + CASE WHEN ${destinationSearchText} = $4 OR lower(name) = $5 THEN 0.10 ELSE 0 END
                + LEAST(COALESCE(elevation, 0), 9000.0) / 9000.0 * 0.10
                + LEAST(COALESCE(prominence, 0), 9000.0) / 9000.0 * 0.05
              ) AS score
       FROM destinations
       WHERE ${destinationSearchVector} @@ to_tsquery('simple', $1)
       ORDER BY score DESC
       LIMIT $6`,
    values: [tsQuery, normalizedPrefix, rawPrefix, q, raw, shortLimit],
  };
}

export function buildDestinationSearchQuery(input: DestinationSearchQueryInput): { text: string; values: unknown[] } {
  const shortQuery = buildShortDestinationSearchQuery(input);
  if (shortQuery) {
    return shortQuery;
  }

  const q = input.normalizedQuery;
  const raw = input.rawQuery.trim().toLowerCase();
  const normalizedPrefix = `${q}%`;
  const rawPrefix = `${raw}%`;

  if (hasGeo(input)) {
    return {
      text: `SELECT id, name, elevation, prominence, type,
              activities, features,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lng,
              similarity(${destinationSearchText}, $1) AS text_score,
              ST_Distance(location, ST_MakePoint($3, $2)::geography) AS distance_m,
              (
                similarity(${destinationSearchText}, $1) * 0.55
                + CASE WHEN ${destinationSearchText} ILIKE $4 OR lower(name) ILIKE $5 THEN 0.15 ELSE 0 END
                + EXP(-1.0 * ST_Distance(location, ST_MakePoint($3, $2)::geography) / 500000.0) * 0.15
                + LEAST(COALESCE(elevation, 0), 9000.0) / 9000.0 * 0.10
                + LEAST(COALESCE(prominence, 0), 9000.0) / 9000.0 * 0.05
              ) AS score
       FROM destinations
       WHERE ${destinationSearchText} % $1
          OR ${destinationSearchText} ILIKE $4
          OR lower(name) ILIKE $5
       ORDER BY score DESC
       LIMIT $6`,
      values: [q, input.lat, input.lng, normalizedPrefix, rawPrefix, input.limit],
    };
  }

  return {
    text: `SELECT id, name, elevation, prominence, type,
              activities, features,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lng,
              similarity(${destinationSearchText}, $1) AS text_score,
              (
                similarity(${destinationSearchText}, $1) * 0.60
                + CASE WHEN ${destinationSearchText} ILIKE $2 OR lower(name) ILIKE $3 THEN 0.15 ELSE 0 END
                + LEAST(COALESCE(elevation, 0), 9000.0) / 9000.0 * 0.15
                + LEAST(COALESCE(prominence, 0), 9000.0) / 9000.0 * 0.10
              ) AS score
       FROM destinations
       WHERE ${destinationSearchText} % $1
          OR ${destinationSearchText} ILIKE $2
          OR lower(name) ILIKE $3
       ORDER BY score DESC
       LIMIT $4`,
    values: [q, normalizedPrefix, rawPrefix, input.limit],
  };
}

export function isPgQueryCanceled(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "57014";
}

export async function cancelBackend(pid: number): Promise<void> {
  const client = createDbClient();
  try {
    await client.connect();
    await client.query("SELECT pg_cancel_backend($1)", [pid]);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function runSearchQuery(
  _req: Request,
  res: Response,
  query: SearchSqlQuery,
  pool: SearchDbPool = db,
  cancelBackendFn: (pid: number) => Promise<void> = cancelBackend
): Promise<void> {
  let client: Awaited<ReturnType<SearchDbPool["connect"]>> | undefined;
  let released = false;
  let responseClosed = false;
  let queryInFlight = false;
  let cancelStarted = false;
  let cancelPromise: Promise<void> | undefined;
  let pid: number | undefined;

  const releaseOnce = () => {
    if (!released && client) {
      released = true;
      client.release();
    }
  };

  const maybeCancel = () => {
    if (!responseClosed || !queryInFlight || pid === undefined || cancelStarted) {
      return;
    }

    cancelStarted = true;
    cancelPromise = cancelBackendFn(pid).catch((error) => {
      console.error("Failed to cancel search query", error);
    });
  };

  const handleClose = () => {
    responseClosed = true;
    maybeCancel();
  };

  res.on("close", handleClose);

  try {
    client = await pool.connect();

    if (responseClosed) {
      return;
    }

    const pidResult = await client.query("SELECT pg_backend_pid() AS pid");
    const rawPid = pidResult.rows[0]?.pid;
    const parsedPid = typeof rawPid === "number" ? rawPid : parseInt(String(rawPid), 10);
    pid = Number.isFinite(parsedPid) ? parsedPid : undefined;

    if (responseClosed) {
      return;
    }

    queryInFlight = true;
    const result = await client.query(query.text, query.values);
    queryInFlight = false;

    if (!responseClosed) {
      res.json(result.rows);
    }
  } catch (error) {
    queryInFlight = false;

    if (responseClosed) {
      if (!isPgQueryCanceled(error)) {
        console.error("Search failed after response closed", error);
      }
      return;
    }

    console.error("Search failed", error);
    res.status(500).json({ error: "Search failed" });
  } finally {
    res.off("close", handleClose);
    queryInFlight = false;
    if (cancelPromise) {
      await cancelPromise;
    }
    releaseOnce();
  }
}

// GET /api/search?q=mt+rainier&lat=46.85&lng=-121.7&limit=20
// Composite-scored text search. Blends:
//   - Text similarity (trigram)     55%  — primary signal, must find what you searched for
//   - Prefix bonus                  15%  — flat bonus when name starts with query (strong intent signal)
//   - Proximity                     15%  — nearby results boosted (but can't override good text match)
//   - Elevation                     10%  — tiebreaker: taller peaks edge ahead
//   - Prominence                     5%  — tiebreaker: more prominent peaks edge ahead
// When lat/lng are not provided, falls back to IP-based geolocation.
// Abbreviations are expanded (mt→mount, etc.) on both query and stored names.
router.get("/", async (req: Request, res: Response) => {
  const rawQuery = (req.query.q as string || "").trim();
  const q = normalizeSearchName(rawQuery);
  const limit = parseInt(req.query.limit as string) || 20;

  if (!q) {
    res.status(400).json({ error: "q (search query) is required" });
    return;
  }

  // Use explicit lat/lng if provided, otherwise fall back to IP geolocation
  let lat = parseFloat(req.query.lat as string);
  let lng = parseFloat(req.query.lng as string);

  if (isNaN(lat) || isNaN(lng)) {
    const ipGeo = await geolocateRequest(req);
    if (ipGeo) {
      lat = ipGeo.lat;
      lng = ipGeo.lng;
    }
  }

  const requestGeo = hasGeo({ lat, lng });

  // Scoring components (all normalized to 0-1):
  //   text:       similarity(search_name, query)
  //   prefix:     1 if search_name starts with query, else 0
  //   proximity:  EXP(-distance_m / 500000)  (half-life ~350km)
  //   elevation:  LEAST(elevation, 9000) / 9000
  //   prominence: LEAST(prominence, 9000) / 9000

  const query = buildDestinationSearchQuery({
    normalizedQuery: q,
    rawQuery,
    lat: requestGeo ? lat : undefined,
    lng: requestGeo ? lng : undefined,
    limit,
  });
  await runSearchQuery(req, res, query);
});

// GET /api/search/features?features=summit,volcano&activities=outdoor-trek&lat=...&lng=...&radius=50000
// Filter by features/activities with optional spatial constraint
router.get("/features", async (req, res: Response) => {
  const features = (req.query.features as string || "").split(",").filter(Boolean);
  const activities = (req.query.activities as string || "").split(",").filter(Boolean);
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const radius = parseFloat(req.query.radius as string) || 50000;
  const limit = parseInt(req.query.limit as string) || 50;

  const conditions: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  if (features.length > 0) {
    conditions.push(`features @> $${paramIdx}::destination_feature[]`);
    params.push(`{${features.join(",")}}`);
    paramIdx++;
  }

  if (activities.length > 0) {
    conditions.push(`activities @> $${paramIdx}::activity_type[]`);
    params.push(`{${activities.join(",")}}`);
    paramIdx++;
  }

  if (!isNaN(lat) && !isNaN(lng)) {
    conditions.push(`ST_DWithin(location, ST_MakePoint($${paramIdx + 1}, $${paramIdx})::geography, $${paramIdx + 2})`);
    params.push(lat, lng, radius);
    paramIdx += 3;
  }

  if (conditions.length === 0) {
    res.status(400).json({ error: "At least one filter (features, activities, or lat/lng) is required" });
    return;
  }

  params.push(limit);

  const result = await db.query(
    `SELECT id, name, elevation, prominence, type,
            activities, features,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng
     FROM destinations
     WHERE ${conditions.join(" AND ")}
     LIMIT $${paramIdx}`,
    params
  );
  res.json(result.rows);
});

export default router;
