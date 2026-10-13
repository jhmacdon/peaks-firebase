import { Router, Request, Response } from "express";
import { asyncRoute } from "../lib/async-route";
import db, { createDbClient } from "../db";
import { getUid } from "../auth";
import { buildRouteAccessSql } from "../lib/route-access";
import { routeCoverJoinSql, routeCoverSelectSql } from "../lib/route-cover";
import { normalizeSearchName } from "../search-utils";

const router = Router();

const destinationSearchText = "search_name";
const destinationSearchVector = "to_tsvector('simple', COALESCE(NULLIF(search_name, ''), lower(name)))";
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
                    'parent_id', a.parent_area_id,
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
                    'parent_id', a.parent_area_id,
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
  uid?: string;
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

interface SearchDbClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
  release(): void;
}

interface SearchDbPool {
  connect(): Promise<SearchDbClient>;
}

interface CancellableSearchRunner {
  isClosed(): boolean;
  query(query: SearchSqlQuery): Promise<any[] | undefined>;
}

// Every mixed-search bucket uses the same text scale. A short prefix is a
// strong match without a trigram scan; a full exact match always scores 1.
function textMatchScoreSql(text: string, query: string, prefix: string, short: boolean, tokenMatch = "false"): string {
  return short
    ? `(CASE WHEN ${text} = ${query} THEN 1.0 WHEN ${text} LIKE ${prefix} THEN 0.9 WHEN ${tokenMatch} THEN 0.7 ELSE 0 END)::double precision`
    : `(CASE WHEN ${text} = ${query} THEN 1.0 ELSE
         COALESCE(similarity(${text}, ${query}), 0) * 0.70
         + CASE WHEN ${text} LIKE ${prefix} THEN 0.20 ELSE 0 END END)::double precision`;
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
  const mixedScore = `GREATEST(
    ${textMatchScoreSql(destinationSearchText, "$4", "$2", true, `${destinationSearchVector} @@ to_tsquery('simple', $1)`)},
    ${textMatchScoreSql("lower(name)", "$5", "$3", true)})`;

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
      text: `WITH ranked_destinations AS MATERIALIZED (
         SELECT id, name, elevation, prominence, type,
                activities, features, country_code, state_code, location,
                CASE WHEN ${destinationSearchVector} @@ to_tsquery('simple', $1) THEN 1 ELSE 0 END AS text_score,
                ST_Distance(location, ST_MakePoint($7, $6)::geography) AS distance_m,
                (
                  CASE WHEN ${destinationSearchVector} @@ to_tsquery('simple', $1) THEN 0.55 ELSE 0 END
                  + CASE WHEN ${destinationSearchText} LIKE $2 OR lower(name) LIKE $3 THEN 0.15 ELSE 0 END
                  + CASE WHEN ${destinationSearchText} = $4 OR lower(name) = $5 THEN 0.10 ELSE 0 END
                  + EXP(-1.0 * ST_Distance(location, ST_MakePoint($7, $6)::geography) / 500000.0) * 0.10
                  + LEAST(COALESCE(elevation, 0), 9000.0) / 9000.0 * 0.07
                  + LEAST(COALESCE(prominence, 0), 9000.0) / 9000.0 * 0.03
                ) AS score,
                ((${mixedScore}) * 0.85 + EXP(-1.0 * ST_Distance(location, ST_MakePoint($7, $6)::geography) / 500000.0) * 0.10 + LEAST(COALESCE(elevation, 0), 9000.0) / 9000.0 * 0.05)::double precision AS rank_score
         FROM destinations
         WHERE ${destinationSearchVector} @@ to_tsquery('simple', $1)
         ORDER BY score DESC
         LIMIT $8
       )
       SELECT destinations.id, destinations.name, destinations.elevation, destinations.prominence,
              destinations.type, destinations.activities, destinations.features,
              destinations.country_code, destinations.state_code,
              ${destinationAreaRowsSql},
              ST_Y(destinations.location::geometry) AS lat,
              ST_X(destinations.location::geometry) AS lng,
              destinations.text_score, destinations.distance_m, destinations.score, destinations.rank_score
       FROM ranked_destinations destinations
       ${destinationAreaJoinSql}
       ORDER BY destinations.score DESC`,
      values: [tsQuery, normalizedPrefix, rawPrefix, q, raw, input.lat, input.lng, shortLimit],
    };
  }

  return {
    text: `WITH ranked_destinations AS MATERIALIZED (
         SELECT id, name, elevation, prominence, type,
                activities, features, country_code, state_code, location,
                CASE WHEN ${destinationSearchVector} @@ to_tsquery('simple', $1) THEN 1 ELSE 0 END AS text_score,
                (
                  CASE WHEN ${destinationSearchVector} @@ to_tsquery('simple', $1) THEN 0.60 ELSE 0 END
                  + CASE WHEN ${destinationSearchText} LIKE $2 OR lower(name) LIKE $3 THEN 0.15 ELSE 0 END
                  + CASE WHEN ${destinationSearchText} = $4 OR lower(name) = $5 THEN 0.10 ELSE 0 END
                  + LEAST(COALESCE(elevation, 0), 9000.0) / 9000.0 * 0.10
                  + LEAST(COALESCE(prominence, 0), 9000.0) / 9000.0 * 0.05
                ) AS score,
                ((${mixedScore}) * 0.90 + LEAST(COALESCE(elevation, 0), 9000.0) / 9000.0 * 0.10)::double precision AS rank_score
         FROM destinations
         WHERE ${destinationSearchVector} @@ to_tsquery('simple', $1)
         ORDER BY score DESC
         LIMIT $6
       )
       SELECT destinations.id, destinations.name, destinations.elevation, destinations.prominence,
              destinations.type, destinations.activities, destinations.features,
              destinations.country_code, destinations.state_code,
              ${destinationAreaRowsSql},
              ST_Y(destinations.location::geometry) AS lat,
              ST_X(destinations.location::geometry) AS lng,
              destinations.text_score, destinations.score, destinations.rank_score
       FROM ranked_destinations destinations
       ${destinationAreaJoinSql}
       ORDER BY destinations.score DESC`,
    values: [tsQuery, normalizedPrefix, rawPrefix, q, raw, shortLimit],
  };
}

export function buildDestinationSearchQuery(input: DestinationSearchQueryInput): { text: string; values: unknown[] } {
  const shortQuery = buildShortDestinationSearchQuery(input);
  if (shortQuery) {
    return shortQuery;
  }

  const q = input.normalizedQuery;
  const normalizedPrefix = `${q}%`;

  if (hasGeo(input)) {
    return {
      text: `WITH ranked_destinations AS MATERIALIZED (
         SELECT id, name, elevation, prominence, type,
                activities, features, country_code, state_code, location,
                similarity(${destinationSearchText}, $1) AS text_score,
                ST_Distance(location, ST_MakePoint($3, $2)::geography) AS distance_m,
                (
                  similarity(${destinationSearchText}, $1) * 0.55
                  + CASE WHEN ${destinationSearchText} LIKE $4 THEN 0.15 ELSE 0 END
                  + EXP(-1.0 * ST_Distance(location, ST_MakePoint($3, $2)::geography) / 500000.0) * 0.15
                  + LEAST(COALESCE(elevation, 0), 9000.0) / 9000.0 * 0.10
                  + LEAST(COALESCE(prominence, 0), 9000.0) / 9000.0 * 0.05
                ) AS score,
                ((${textMatchScoreSql(destinationSearchText, "$1", "$4", false)}) * 0.85 + EXP(-1.0 * ST_Distance(location, ST_MakePoint($3, $2)::geography) / 500000.0) * 0.10 + LEAST(COALESCE(elevation, 0), 9000.0) / 9000.0 * 0.05)::double precision AS rank_score
         FROM destinations
         WHERE ${destinationSearchText} % $1
            OR ${destinationSearchText} LIKE $4
         ORDER BY score DESC
         LIMIT $5
       )
       SELECT destinations.id, destinations.name, destinations.elevation, destinations.prominence,
              destinations.type, destinations.activities, destinations.features,
              destinations.country_code, destinations.state_code,
              ${destinationAreaRowsSql},
              ST_Y(destinations.location::geometry) AS lat,
              ST_X(destinations.location::geometry) AS lng,
              destinations.text_score, destinations.distance_m, destinations.score, destinations.rank_score
       FROM ranked_destinations destinations
       ${destinationAreaJoinSql}
       ORDER BY destinations.score DESC`,
      values: [q, input.lat, input.lng, normalizedPrefix, input.limit],
    };
  }

  return {
    text: `WITH ranked_destinations AS MATERIALIZED (
         SELECT id, name, elevation, prominence, type,
                activities, features, country_code, state_code, location,
                similarity(${destinationSearchText}, $1) AS text_score,
                (
                  similarity(${destinationSearchText}, $1) * 0.60
                  + CASE WHEN ${destinationSearchText} LIKE $2 THEN 0.15 ELSE 0 END
                  + LEAST(COALESCE(elevation, 0), 9000.0) / 9000.0 * 0.15
                  + LEAST(COALESCE(prominence, 0), 9000.0) / 9000.0 * 0.10
                ) AS score,
                ((${textMatchScoreSql(destinationSearchText, "$1", "$2", false)}) * 0.90 + LEAST(COALESCE(elevation, 0), 9000.0) / 9000.0 * 0.10)::double precision AS rank_score
         FROM destinations
         WHERE ${destinationSearchText} % $1
            OR ${destinationSearchText} LIKE $2
         ORDER BY score DESC
         LIMIT $3
       )
       SELECT destinations.id, destinations.name, destinations.elevation, destinations.prominence,
              destinations.type, destinations.activities, destinations.features,
              destinations.country_code, destinations.state_code,
              ${destinationAreaRowsSql},
              ST_Y(destinations.location::geometry) AS lat,
              ST_X(destinations.location::geometry) AS lng,
              destinations.text_score, destinations.score, destinations.rank_score
       FROM ranked_destinations destinations
       ${destinationAreaJoinSql}
       ORDER BY destinations.score DESC`,
    values: [q, normalizedPrefix, input.limit],
  };
}

export function buildRouteSearchQuery(input: DestinationSearchQueryInput): SearchSqlQuery {
  const q = input.normalizedQuery;
  const raw = input.rawQuery.trim().toLowerCase();
  const normalizedPrefix = `${q}%`;
  const rawPrefix = `${raw}%`;
  const routeLimit = Math.min(input.limit, 10);
  const isShortQuery = q.length === 2;
  const match = (text: string) => isShortQuery
    ? `${text} LIKE $2`
    : `(${text} % $1 OR ${text} LIKE $2)`;
  const indexedDestinationCandidateWhere = match("candidate_d.search_name");
  // Each branch has its own index: search_name and the alias/trail-name text
  // carry trigram indexes, so no branch scans the wide routes or segments rows.
  // Alias and trail-name text joins several names, so it matches on word
  // similarity; two-letter queries skip it (trigrams need three letters).
  const routeNameCandidateWhere = `(${match("candidate_r.search_name")}
             OR lower(candidate_r.name) LIKE $3)`;
  const aliasCandidateSql = isShortQuery ? "" : `
         UNION
         SELECT alias_r.id
         FROM routes alias_r
         WHERE alias_r.status = 'active'
           AND alias_r.aliases <> '{}'
           AND $1 <% peaks_search_names_text(alias_r.aliases)`;
  const trailNameCandidateSql = isShortQuery ? "" : `
         UNION
         SELECT trail_r.id
         FROM segments candidate_s
         JOIN route_segments candidate_rs ON candidate_rs.segment_id = candidate_s.id
         JOIN routes trail_r ON trail_r.id = candidate_rs.route_id
         WHERE trail_r.status = 'active'
           AND candidate_s.trail_names <> '{}'
           AND $1 <% peaks_search_names_text(candidate_s.trail_names)`;
  const textScore = textMatchScoreSql("route_text.name", "$1", "$2", isShortQuery);
  const geoRankSelect = hasGeo(input)
    ? ", ST_Distance(r.path, ST_MakePoint($5, $4)::geography) AS distance_m"
    : "";
  const geoOutputSelect = hasGeo(input) ? ", r.distance_m" : "";
  const popularityPrior = "LEAST(r.popularity, 20.0) / 20.0";
  const rankScore = hasGeo(input)
    ? `(COALESCE(route_match.score, 0) * 0.85
       + EXP(-1.0 * ST_Distance(r.path, ST_MakePoint($5, $4)::geography) / 500000.0) * 0.10
       + ${popularityPrior} * 0.05)::double precision`
    : `(COALESCE(route_match.score, 0) * 0.90 + ${popularityPrior} * 0.10)::double precision`;
  const limitParam = hasGeo(input) ? "$6" : "$4";
  const uidParam = hasGeo(input) ? "$7" : "$5";
  const values = hasGeo(input)
    ? [q, normalizedPrefix, rawPrefix, input.lat, input.lng, routeLimit, input.uid ?? ""]
    : [q, normalizedPrefix, rawPrefix, routeLimit, input.uid ?? ""];
  const catalogFields = `r.kind, r.slug, r.search_name, r.aliases,
                r.objective_destination_id, r.trailhead_destination_id,
                r.difficulty, r.est_moving_seconds, r.state_code, r.country_code,
                r.description, r.description_source_name, r.description_source_url,
                r.description_source_license, r.popularity`;

  return {
    // Find matching IDs before loading wide route rows, geometry, and area JSON.
    // Score each name on its own so a route is not penalized for having more stops.
    text: `WITH indexed_destination_candidates AS MATERIALIZED (
         SELECT candidate_d.id
         FROM destinations candidate_d
         WHERE ${indexedDestinationCandidateWhere}
       ),
       candidate_route_ids AS MATERIALIZED (
         SELECT candidate_r.id
         FROM routes candidate_r
         WHERE candidate_r.status = 'active'
           AND ${routeNameCandidateWhere}
         UNION
         SELECT linked_r.id
         FROM indexed_destination_candidates candidate_d
         JOIN route_destinations candidate_rd
           ON candidate_rd.destination_id = candidate_d.id
         JOIN routes linked_r
           ON linked_r.id = candidate_rd.route_id
          AND linked_r.status = 'active'
         UNION
         SELECT objective_r.id
         FROM indexed_destination_candidates candidate_d
         JOIN routes objective_r ON objective_r.objective_destination_id = candidate_d.id
         WHERE objective_r.status = 'active'
${aliasCandidateSql}${trailNameCandidateSql}
       ),
       ranked_routes AS MATERIALIZED (
         SELECT r.id, r.name, r.polyline6, r.owner,
                r.distance, r.gain, r.gain_loss, r.elevation_string, r.shape,
                r.external_links, r.provenance, r.completion,
                ${catalogFields}${geoRankSelect}, route_match.score,
                ${rankScore} AS rank_score
         FROM candidate_route_ids candidate
         JOIN routes r ON r.id = candidate.id
         LEFT JOIN LATERAL (
           SELECT MAX(${textScore}) AS score
           FROM (
             SELECT r.search_name AS name
             UNION ALL
             SELECT peaks_normalize_search_name(alias.name) FROM unnest(r.aliases) alias(name)
             UNION ALL
             SELECT d.search_name
             FROM route_destinations rd
             JOIN destinations d ON d.id = rd.destination_id
             WHERE rd.route_id = r.id
             UNION ALL
             SELECT d.search_name FROM destinations d WHERE d.id = r.objective_destination_id
             UNION ALL
             SELECT peaks_normalize_search_name(trail.name)
             FROM route_segments rs
             JOIN segments s ON s.id = rs.segment_id
             CROSS JOIN LATERAL unnest(s.trail_names) trail(name)
             WHERE rs.route_id = r.id
           ) route_text
         ) route_match ON true
         WHERE r.status = 'active'
           AND ${buildRouteAccessSql("r", uidParam)}
         ORDER BY score DESC, r.popularity DESC, r.name, r.id
         LIMIT ${limitParam}
       )
       SELECT r.id, r.name, r.polyline6, r.owner,
              r.distance, r.gain, r.gain_loss, r.elevation_string, r.shape,
              r.external_links, r.provenance, r.completion,
              ${catalogFields},
              ${routeCoverSelectSql()},
              ${routeAreaRowsSql}${geoOutputSelect}, r.score, r.rank_score
       FROM ranked_routes r
       ${routeCoverJoinSql()}
       ${routeAreaJoinSql}
       ORDER BY r.score DESC, r.popularity DESC, r.name, r.id`,
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
              a.parent_area_id AS parent_id,
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

  // search_name is required and normalized by every area importer. Keeping raw
  // lower(name) in this filter prevents PostgreSQL from using the trigram index
  // and scans the boundary-heavy areas table on every keystroke.
  const isShortQuery = q.length === 2;
  const shortWhere = isShortQuery
    ? "a.search_name LIKE $1"
    : "(a.search_name % $1 OR a.search_name LIKE $2)";
  const textScore = isShortQuery
    ? `(CASE WHEN a.search_name || '%' = $1 OR lower(a.name) || '%' = $2 THEN 1.0
             WHEN a.search_name LIKE $1 OR lower(a.name) LIKE $2 THEN 0.9 ELSE 0 END)`
    : `(CASE WHEN a.search_name = $1 THEN 1.0 ELSE similarity(a.search_name, $1) * 0.70
        + CASE WHEN a.search_name LIKE $2 OR lower(a.name) LIKE $3 THEN 0.20 ELSE 0 END END)`;
  const values: unknown[] = isShortQuery
    ? [normalizedPrefix, rawPrefix, areaLimit]
    : [q, normalizedPrefix, rawPrefix, areaLimit];
  const limitParam = isShortQuery ? "$3" : "$4";
  const aliasParamIndex = aliases.length > 0 ? values.push(aliases) : null;
  const aliasPredicate = aliasParamIndex
    ? `a.search_name = ANY($${aliasParamIndex}::text[])`
    : "";
  const whereClause = aliasPredicate ? `(${shortWhere} OR ${aliasPredicate})` : shortWhere;
  const matchScore = aliasPredicate
    ? `GREATEST(${textScore}, CASE WHEN ${aliasPredicate} THEN 0.85 ELSE 0 END)`
    : textScore;
  // Legacy bucket order, unchanged for clients that read the areas bucket.
  const legacyTextScore = isShortQuery
    ? "CASE WHEN a.search_name LIKE $1 OR lower(a.name) LIKE $2 THEN 1 ELSE 0 END"
    : "similarity(a.search_name, $1)";
  const legacyPrefixScore = isShortQuery
    ? "CASE WHEN a.search_name LIKE $1 OR lower(a.name) LIKE $2 THEN 0.20 ELSE 0 END"
    : "CASE WHEN a.search_name LIKE $2 OR lower(a.name) LIKE $3 THEN 0.20 ELSE 0 END";
  const legacyAliasScore = aliasPredicate ? `+ CASE WHEN ${aliasPredicate} THEN 0.45 ELSE 0 END` : "";

  return {
    text: `SELECT a.id, a.name, a.kind, a.designation, a.manager,
              a.parent_area_id AS parent_id,
              ST_Y(a.centroid) AS lat,
              ST_X(a.centroid) AS lng,
              a.bbox_min_lat, a.bbox_max_lat, a.bbox_min_lng, a.bbox_max_lng,
              COALESCE(destination_counts.destination_count, 0)::int AS destination_count,
              COALESCE(route_counts.route_count, 0)::int AS route_count,
              (
                ${legacyTextScore} * 0.70
                + ${legacyPrefixScore}
                + LEAST(COALESCE(destination_counts.destination_count, 0), 200.0) / 200.0 * 0.07
                + LEAST(COALESCE(route_counts.route_count, 0), 50.0) / 50.0 * 0.03
                ${legacyAliasScore}
              ) AS score,
              ((${matchScore}) * 0.90
                + LEAST(COALESCE(destination_counts.destination_count, 0), 200.0) / 200.0 * 0.10
              )::double precision AS rank_score
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
       LIMIT ${limitParam}`,
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

async function withCancellableSearchClient<T>(
  res: Response,
  work: (runner: CancellableSearchRunner) => Promise<T | undefined>,
  pool: SearchDbPool = db,
  cancelBackendFn: (pid: number) => Promise<void> = cancelBackend
): Promise<T | undefined> {
  let client: SearchDbClient | undefined;
  let released = false;
  let responseClosed = Boolean(res.destroyed || res.writableEnded);
  let queryInFlight = false;
  let cancelStarted = false;
  let cancelPromise: Promise<void> | undefined;
  let pid: number | undefined;

  const isClosed = () => responseClosed || Boolean(res.destroyed || res.writableEnded);
  const releaseOnce = () => {
    if (!released && client) {
      released = true;
      client.release();
    }
  };
  const maybeCancel = () => {
    if (!isClosed() || !queryInFlight || pid === undefined || cancelStarted) {
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
    if (isClosed()) return undefined;

    const pidResult = await client.query("SELECT pg_backend_pid() AS pid");
    const rawPid = pidResult.rows[0]?.pid;
    const parsedPid = typeof rawPid === "number" ? rawPid : parseInt(String(rawPid), 10);
    pid = Number.isFinite(parsedPid) ? parsedPid : undefined;
    if (isClosed()) return undefined;

    const runner: CancellableSearchRunner = {
      isClosed,
      query: async (query) => {
        if (isClosed()) return undefined;

        queryInFlight = true;
        try {
          const result = await client!.query(query.text, query.values);
          return isClosed() ? undefined : result.rows;
        } finally {
          queryInFlight = false;
        }
      },
    };

    return await work(runner);
  } catch (error) {
    queryInFlight = false;
    if (isClosed()) {
      if (!isPgQueryCanceled(error)) {
        console.error("Search failed after response closed", error);
      }
      return undefined;
    }
    throw error;
  } finally {
    res.off("close", handleClose);
    queryInFlight = false;
    if (cancelPromise) {
      await cancelPromise;
    }
    releaseOnce();
  }
}

export async function runSearchQuery(
  _req: Request,
  res: Response,
  query: SearchSqlQuery,
  pool: SearchDbPool = db,
  cancelBackendFn: (pid: number) => Promise<void> = cancelBackend
): Promise<void> {
  try {
    const rows = await withCancellableSearchClient(
      res,
      (runner) => runner.query(query),
      pool,
      cancelBackendFn
    );
    if (rows && !res.destroyed && !res.writableEnded) {
      res.json(rows);
    }
  } catch (error) {
    console.error("Search failed", error);
    res.status(500).json({ error: "Search failed" });
  }
}

// Secondary mixed-search buckets (routes, areas) degrade to an empty list on
// failure instead of turning the whole /search/all response into a 500 — the
// destinations bucket is the product-critical one and still hard-fails.
async function runOptionalSearchRows(
  runner: CancellableSearchRunner,
  query: SearchSqlQuery,
  bucket: string
): Promise<any[] | undefined> {
  try {
    return await runner.query(query);
  } catch (error) {
    if (runner.isClosed()) return undefined;
    console.error(`Mixed search ${bucket} bucket failed`, error);
    return [];
  }
}

interface MixedSearchBuckets {
  destinations: any[];
  routes: any[];
  areas: any[];
}

interface MixedSearchResult {
  type: "destination" | "route" | "area";
  id: string;
  score: number;
}

export function mergeMixedSearchResults(buckets: MixedSearchBuckets): MixedSearchResult[] {
  // rank_score is the cross-type scale; score stays each bucket's legacy order.
  const score = (row: { rank_score?: number; score?: number }) => {
    const value = Number(row.rank_score ?? row.score ?? 0);
    // Leave room at either end for the objective rule, including exact matches.
    return 0.01 + 0.98 * (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
  };
  const destinations = buckets.destinations.map((row) => ({
    type: "destination" as const, id: row.id as string, score: score(row),
  }));
  const objectiveScores = new Map(destinations.map((row) => [row.id, row.score]));
  const routes = buckets.routes.map((row) => {
    let routeScore = score(row);
    const objectiveScore = objectiveScores.get(row.objective_destination_id);
    if (objectiveScore !== undefined) {
      if (row.kind === "destination") routeScore = Math.max(routeScore, objectiveScore + 0.005);
      if (row.kind === "summit") routeScore = Math.min(routeScore, objectiveScore - 0.005);
    }
    return { type: "route" as const, id: row.id as string, score: routeScore };
  });
  const areas = buckets.areas.map((row) => ({
    type: "area" as const, id: row.id as string, score: score(row),
  }));
  // Stable ties keep each bucket's order.
  return [...destinations, ...routes, ...areas].sort((a, b) => b.score - a.score);
}

export async function runMixedSearchQueries(
  res: Response,
  queries: MixedSearchSqlQueries,
  pool: SearchDbPool = db,
  cancelBackendFn: (pid: number) => Promise<void> = cancelBackend
): Promise<(MixedSearchBuckets & { results: MixedSearchResult[] }) | undefined> {
  return withCancellableSearchClient(res, async (runner) => {
    const destinations = await runner.query(queries.destinations);
    if (!destinations) return undefined;

    const routes = await runOptionalSearchRows(runner, queries.routes, "routes");
    if (!routes) return undefined;

    const areas = await runOptionalSearchRows(runner, queries.areas, "areas");
    if (!areas) return undefined;

    const buckets = { destinations, routes, areas };
    return { ...buckets, results: mergeMixedSearchResults(buckets) };
  }, pool, cancelBackendFn);
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
router.get("/", asyncRoute(async (req: Request, res: Response) => {
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
}));

// GET /api/search/all?q=rainier&lat=46.85&lng=-121.7&limit=20
// Typed search buckets for the NewUI sheet. Keeps GET /api/search backwards
// compatible for older clients that expect a raw destination array.
router.get("/all", asyncRoute(async (req: Request, res: Response) => {
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
      uid: getUid(req),
    });

    const results = await runMixedSearchQueries(res, queries);
    if (routeClose.isClosed() || !results) return;

    res.json(results);
  } catch (error) {
    if (!routeClose.isClosed()) {
      console.error("Mixed search failed", error);
      res.status(500).json({ error: "Search failed" });
    }
  } finally {
    routeClose.dispose();
  }
}));

// GET /api/search/features?features=summit,volcano&activities=outdoor-trek&lat=...&lng=...&radius=50000
// Filter by features/activities with optional spatial constraint
router.get("/features", asyncRoute(async (req, res: Response) => {
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
}));

export default router;
