import { Router, Request, Response } from "express";
import db, { createDbClient } from "../db";
import { normalizeSearchName } from "../search-utils";

const router = Router();

const destinationSearchText = "COALESCE(NULLIF(search_name, ''), lower(name))";
const destinationSearchVector = `to_tsvector('simple', ${destinationSearchText})`;
const destinationAreaRowsSql = `COALESCE(area_rows.areas, '[]'::json) AS areas`;
const destinationAreaJoinSql = `LEFT JOIN LATERAL (
         SELECT json_agg(area_obj ORDER BY kind, name) AS areas
         FROM (
           SELECT DISTINCT ON (a.kind, a.name)
                  a.kind, a.name,
                  json_build_object(
                    'id', a.id,
                    'name', a.name,
                    'kind', a.kind,
                    'designation', a.designation,
                    'manager', a.manager,
                    'relation', da.relation,
                    'source', da.source
                  ) AS area_obj
           FROM destination_areas da
           JOIN areas a ON a.id = da.area_id
           WHERE da.destination_id = destinations.id
           ORDER BY a.kind, a.name, a.designation DESC NULLS LAST, a.id
         ) deduped
       ) area_rows ON true`;
const routeAreaRowsSql = `COALESCE(area_rows.areas, '[]'::json) AS areas`;
const routeAreaJoinSql = `LEFT JOIN LATERAL (
         SELECT json_agg(area_obj ORDER BY kind, name) AS areas
         FROM (
           SELECT DISTINCT ON (a.kind, a.name)
                  a.kind, a.name,
                  json_build_object(
                    'id', a.id,
                    'name', a.name,
                    'kind', a.kind,
                    'designation', a.designation,
                    'manager', a.manager,
                    'relation', ra.relation,
                    'source', ra.source
                  ) AS area_obj
           FROM route_areas ra
           JOIN areas a ON a.id = ra.area_id
           WHERE ra.route_id = r.id
           ORDER BY a.kind, a.name, a.designation DESC NULLS LAST, a.id
         ) deduped
       ) area_rows ON true`;

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

interface MixedSearchSqlQueries {
  destinations: SearchSqlQuery;
  routes: SearchSqlQuery;
  areas: SearchSqlQuery;
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

function areaSearchAliases(normalizedQuery: string): string[] {
  const hasBaker = /\bbaker\b/.test(normalizedQuery);
  const hasSnoqualmie = /\bsnoqualmie\b/.test(normalizedQuery);
  if (!hasBaker || !hasSnoqualmie) {
    return [];
  }

  // PAD-US splits the current Mt. Baker-Snoqualmie National Forest into
  // historical Mt. Baker and Snoqualmie National Forest records.
  return ["mt baker national forest", "snoqualmie national forest"];
}

function watchSearchRouteClose(req: Request, res: Response): { isClosed(): boolean; dispose(): void } {
  let closed = Boolean(req.aborted || req.destroyed || res.destroyed || res.writableEnded);
  const markClosed = () => {
    closed = true;
  };

  req.on("aborted", markClosed);
  res.on("close", markClosed);

  return {
    isClosed: () => closed || Boolean(req.aborted || req.destroyed || res.destroyed || res.writableEnded),
    dispose: () => {
      req.off("aborted", markClosed);
      res.off("close", markClosed);
    },
  };
}

function tokenPrefixTsQuery(normalizedQuery: string): string | null {
  if (!/^[a-z0-9]+$/.test(normalizedQuery)) {
    return null;
  }

  return `${normalizedQuery}:*`;
}

export function clampSearchLimit(value: string | undefined, fallback = 20, max = 50): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
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
              country_code, state_code,
              ${destinationAreaRowsSql},
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lng
       FROM destinations
       ${destinationAreaJoinSql}
       WHERE false
       LIMIT $1`,
      values: [shortLimit],
    };
  }

  if (hasGeo(input)) {
    return {
      text: `SELECT id, name, elevation, prominence, type,
              activities, features,
              country_code, state_code,
              ${destinationAreaRowsSql},
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
       ${destinationAreaJoinSql}
       WHERE ${destinationSearchVector} @@ to_tsquery('simple', $1)
       ORDER BY score DESC
       LIMIT $8`,
      values: [tsQuery, normalizedPrefix, rawPrefix, q, raw, input.lat, input.lng, shortLimit],
    };
  }

  return {
    text: `SELECT id, name, elevation, prominence, type,
              activities, features,
              country_code, state_code,
              ${destinationAreaRowsSql},
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
       ${destinationAreaJoinSql}
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
              country_code, state_code,
              ${destinationAreaRowsSql},
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
       ${destinationAreaJoinSql}
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
              country_code, state_code,
              ${destinationAreaRowsSql},
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
       ${destinationAreaJoinSql}
       WHERE ${destinationSearchText} % $1
          OR ${destinationSearchText} ILIKE $2
          OR lower(name) ILIKE $3
       ORDER BY score DESC
       LIMIT $4`,
    values: [q, normalizedPrefix, rawPrefix, input.limit],
  };
}

export function buildRouteSearchQuery(input: DestinationSearchQueryInput): SearchSqlQuery {
  const q = input.normalizedQuery;
  const raw = input.rawQuery.trim().toLowerCase();
  const normalizedPrefix = `${q}%`;
  const rawPrefix = `${raw}%`;
  const routeLimit = Math.min(input.limit, 10);
  const routeSearchText = "COALESCE(NULLIF(lower(r.name), ''), '') || ' ' || COALESCE(route_dest_names.names, '')";

  const geoScore = hasGeo(input)
    ? " + EXP(-1.0 * ST_Distance(r.path, ST_MakePoint($5, $4)::geography) / 500000.0) * 0.10"
    : "";
  const geoSelect = hasGeo(input)
    ? ", ST_Distance(r.path, ST_MakePoint($5, $4)::geography) AS distance_m"
    : "";
  const limitParam = hasGeo(input) ? "$6" : "$4";
  const values = hasGeo(input)
    ? [q, normalizedPrefix, rawPrefix, input.lat, input.lng, routeLimit]
    : [q, normalizedPrefix, rawPrefix, routeLimit];

  return {
    text: `SELECT r.id, r.name, r.polyline6, r.owner,
              r.distance, r.gain, r.gain_loss, r.elevation_string,
              r.external_links, r.completion,
              ${routeAreaRowsSql}${geoSelect},
              (
                similarity(${routeSearchText}, $1) * 0.70
                + CASE WHEN lower(r.name) ILIKE $2 OR lower(r.name) ILIKE $3 THEN 0.20 ELSE 0 END
                + LEAST(COALESCE(r.gain, 0), 3000.0) / 3000.0 * 0.05
                + LEAST(COALESCE(r.distance, 0), 50000.0) / 50000.0 * 0.05
                ${geoScore}
              ) AS score
       FROM routes r
       LEFT JOIN LATERAL (
         SELECT string_agg(COALESCE(NULLIF(d.search_name, ''), lower(d.name)), ' ') AS names
         FROM route_destinations rd
         JOIN destinations d ON d.id = rd.destination_id
         WHERE rd.route_id = r.id
       ) route_dest_names ON true
       ${routeAreaJoinSql}
       WHERE r.status = 'active'
         AND (
           ${routeSearchText} % $1
           OR lower(r.name) ILIKE $2
           OR lower(r.name) ILIKE $3
         )
       ORDER BY score DESC
       LIMIT ${limitParam}`,
    values,
  };
}

export function buildAreaSearchQuery(input: DestinationSearchQueryInput): SearchSqlQuery {
  const q = input.normalizedQuery;
  const raw = input.rawQuery.trim().toLowerCase();
  const normalizedPrefix = `${q}%`;
  const rawPrefix = `${raw}%`;
  const areaLimit = Math.min(input.limit, 10);
  const aliases = areaSearchAliases(q);

  if (q.length === 2 && !/^[a-z0-9]+$/.test(q)) {
    return {
      text: `SELECT a.id, a.name, a.kind, a.designation, a.manager,
              ST_Y(a.centroid) AS lat,
              ST_X(a.centroid) AS lng,
              a.bbox_min_lat, a.bbox_max_lat, a.bbox_min_lng, a.bbox_max_lng,
              0::int AS destination_count,
              0::int AS route_count
       FROM areas a
       WHERE false
       LIMIT $1`,
      values: [areaLimit],
    };
  }

  const shortWhere = q.length === 2
    ? "(a.search_name ILIKE $2 OR lower(a.name) ILIKE $3)"
    : "(a.search_name % $1 OR a.search_name ILIKE $2 OR lower(a.name) ILIKE $3)";
  const textScore = q.length === 2
    ? "CASE WHEN a.search_name ILIKE $2 OR lower(a.name) ILIKE $3 THEN 1 ELSE 0 END"
    : "similarity(a.search_name, $1)";
  const values: unknown[] = [q, normalizedPrefix, rawPrefix, areaLimit];
  const aliasParamIndex = aliases.length > 0 ? values.push(aliases) : null;
  const aliasPredicate = aliasParamIndex
    ? `(a.search_name = ANY($${aliasParamIndex}::text[]) OR lower(a.name) = ANY($${aliasParamIndex}::text[]))`
    : "";
  const whereClause = aliasPredicate ? `(${shortWhere} OR ${aliasPredicate})` : shortWhere;
  const aliasScore = aliasPredicate ? `+ CASE WHEN ${aliasPredicate} THEN 0.45 ELSE 0 END` : "";

  return {
    text: `SELECT a.id, a.name, a.kind, a.designation, a.manager,
              ST_Y(a.centroid) AS lat,
              ST_X(a.centroid) AS lng,
              a.bbox_min_lat, a.bbox_max_lat, a.bbox_min_lng, a.bbox_max_lng,
              COALESCE(destination_counts.destination_count, 0)::int AS destination_count,
              COALESCE(route_counts.route_count, 0)::int AS route_count,
              (
                ${textScore} * 0.70
                + CASE WHEN a.search_name ILIKE $2 OR lower(a.name) ILIKE $3 THEN 0.20 ELSE 0 END
                + LEAST(COALESCE(destination_counts.destination_count, 0), 200.0) / 200.0 * 0.07
                + LEAST(COALESCE(route_counts.route_count, 0), 50.0) / 50.0 * 0.03
                ${aliasScore}
              ) AS score
       FROM areas a
       LEFT JOIN LATERAL (
         SELECT count(DISTINCT da.destination_id) AS destination_count
         FROM destination_areas da
         WHERE da.area_id = a.id
       ) destination_counts ON true
       LEFT JOIN LATERAL (
         SELECT count(DISTINCT ra.route_id) AS route_count
         FROM route_areas ra
         WHERE ra.area_id = a.id
       ) route_counts ON true
       WHERE ${whereClause}
       ORDER BY score DESC
       LIMIT $4`,
    values,
  };
}

export function buildMixedSearchQueries(input: DestinationSearchQueryInput): MixedSearchSqlQueries {
  return {
    destinations: buildDestinationSearchQuery(input),
    routes: buildRouteSearchQuery(input),
    areas: buildAreaSearchQuery(input),
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

async function runSearchRows(
  res: Response,
  query: SearchSqlQuery,
  pool: SearchDbPool = db
): Promise<any[] | undefined> {
  if (res.destroyed || res.writableEnded) {
    return undefined;
  }

  const client = await pool.connect();
  try {
    if (res.destroyed || res.writableEnded) {
      return undefined;
    }
    const result = await client.query(query.text, query.values);
    return result.rows;
  } finally {
    client.release();
  }
}

// GET /api/search?q=mt+rainier&lat=46.85&lng=-121.7&limit=20
// Composite-scored text search. Blends:
//   - Text similarity (trigram)     55%  — primary signal, must find what you searched for
//   - Prefix bonus                  15%  — flat bonus when name starts with query (strong intent signal)
//   - Proximity                     15%  — nearby results boosted (but can't override good text match)
//   - Elevation                     10%  — tiebreaker: taller peaks edge ahead
//   - Prominence                     5%  — tiebreaker: more prominent peaks edge ahead
// When lat/lng are not provided, uses no-geo ranking.
// Abbreviations are expanded (mt→mount, etc.) on both query and stored names.
router.get("/", async (req: Request, res: Response) => {
  const routeClose = watchSearchRouteClose(req, res);

  try {
    const rawQuery = (req.query.q as string || "").trim();
    const q = normalizeSearchName(rawQuery);
    const limit = clampSearchLimit(req.query.limit as string | undefined);

    if (!q) {
      if (!routeClose.isClosed()) {
        res.status(400).json({ error: "q (search query) is required" });
      }
      return;
    }

    // Use explicit lat/lng if provided. Avoid IP geolocation in the hot search
    // path: no-geo ranking is already supported, and the external lookup used
    // to add latency, rate limits, and avoidable failure modes.
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);

    if (routeClose.isClosed()) {
      return;
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
  } finally {
    routeClose.dispose();
  }
});

// GET /api/search/all?q=rainier&lat=46.85&lng=-121.7&limit=20
// Typed search buckets for the NewUI sheet. Keeps GET /api/search backwards
// compatible for older clients that expect a raw destination array.
router.get("/all", async (req: Request, res: Response) => {
  const routeClose = watchSearchRouteClose(req, res);

  try {
    const rawQuery = (req.query.q as string || "").trim();
    const q = normalizeSearchName(rawQuery);
    const limit = clampSearchLimit(req.query.limit as string | undefined);

    if (!q) {
      if (!routeClose.isClosed()) {
        res.status(400).json({ error: "q (search query) is required" });
      }
      return;
    }

    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const requestGeo = hasGeo({ lat, lng });
    const queries = buildMixedSearchQueries({
      normalizedQuery: q,
      rawQuery,
      lat: requestGeo ? lat : undefined,
      lng: requestGeo ? lng : undefined,
      limit,
    });

    const destinations = await runSearchRows(res, queries.destinations);
    if (routeClose.isClosed() || !destinations) return;
    const routes = await runSearchRows(res, queries.routes);
    if (routeClose.isClosed() || !routes) return;
    const areas = await runSearchRows(res, queries.areas);
    if (routeClose.isClosed() || !areas) return;

    res.json({ destinations, routes, areas });
  } catch (error) {
    if (!routeClose.isClosed()) {
      console.error("Mixed search failed", error);
      res.status(500).json({ error: "Search failed" });
    }
  } finally {
    routeClose.dispose();
  }
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
            country_code, state_code,
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
