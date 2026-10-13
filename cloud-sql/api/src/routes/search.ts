import { Router, Request, Response } from "express";
import { asyncRoute } from "../lib/async-route";
import db, { createDbClient } from "../db";
import { getUid } from "../auth";
import { buildRouteAccessSql } from "../lib/route-access";
import { routeCoverJoinSql, routeCoverSelectSql } from "../lib/route-cover";
import { normalizeSearchName } from "../search-utils";
import { rankSearchResults, searchPopularityScoreSql, searchTextScoreSql, SearchBuckets } from "../lib/search-ranking";

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
  lists: SearchSqlQuery;
  limit: number;
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
                ) AS score
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
              destinations.text_score, destinations.distance_m, destinations.score
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
                ) AS score
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
              destinations.text_score, destinations.score
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
                ) AS score
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
              destinations.text_score, destinations.distance_m, destinations.score
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
                ) AS score
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
              destinations.text_score, destinations.score
       FROM ranked_destinations destinations
       ${destinationAreaJoinSql}
       ORDER BY destinations.score DESC`,
    values: [q, normalizedPrefix, input.limit],
  };
}

// Mixed search uses the same scoring weights for each entity. Keep the legacy
// destination-only endpoint's ranking and response intact.
export function buildRankedDestinationSearchQuery(input: DestinationSearchQueryInput): SearchSqlQuery {
  const q = input.normalizedQuery;
  const prefix = `${q}%`;
  const short = q.length === 2;
  const tokenQuery = tokenPrefixTsQuery(q);
  const values: unknown[] = [q, prefix, input.limit];
  const geo = hasGeo(input);
  if (geo) values.push(input.lat, input.lng);
  if (short && tokenQuery) values.push(tokenQuery);
  const tokenParam = `$${values.length}`;
  const candidateWhere = short
    ? tokenQuery ? `${destinationSearchVector} @@ to_tsquery('simple', ${tokenParam})` : "false"
    : "search_name % $1 OR search_name LIKE $2";
  const distance = geo ? "ST_Distance(location, ST_MakePoint($5, $4)::geography)" : "NULL::double precision";
  const proximity = geo ? `COALESCE(EXP(-1.0 * ${distance} / 500000.0) * 0.05, 0)` : "0";

  return {
    text: `WITH ranked_destinations AS MATERIALIZED (
         SELECT id, name, elevation, prominence, type, activities, features,
                country_code, state_code, location,
                (search_name = $1) AS name_exact_match,
                (search_name LIKE $2) AS name_prefix_match,
                ${distance} AS distance_m,
                (${searchTextScoreSql("search_name", "$1", "$2")}
                  + ${searchPopularityScoreSql("session_count_offset")}
                  + ${proximity}) AS score
         FROM destinations
         WHERE ${candidateWhere}
         ORDER BY score DESC, name, id
         LIMIT $3
       )
       SELECT destinations.id, destinations.name, destinations.elevation, destinations.prominence,
              destinations.type, destinations.activities, destinations.features,
              destinations.country_code, destinations.state_code,
              ${destinationAreaRowsSql},
              ST_Y(destinations.location::geometry) AS lat,
              ST_X(destinations.location::geometry) AS lng,
              destinations.distance_m, destinations.name_exact_match, destinations.name_prefix_match, destinations.score
       FROM ranked_destinations destinations
       ${destinationAreaJoinSql}
       ORDER BY destinations.score DESC, destinations.name, destinations.id`,
    values,
  };
}

export function buildRouteSearchQuery(input: DestinationSearchQueryInput): SearchSqlQuery {
  const q = input.normalizedQuery;
  const short = q.length === 2;
  const geo = hasGeo(input);
  const values: unknown[] = [q, `${q}%`, short ? tokenPrefixTsQuery(q) : `%${q}%`, input.limit, input.uid ?? ""];
  if (geo) values.push(input.lat, input.lng);
  const indexedNameMatch = (name: string) => short ? `${name} LIKE $2` : `(${name} % $1 OR ${name} LIKE $2)`;
  // Expression indexes find a name anywhere in each array. Two-character
  // queries use token prefixes so later array entries need no substring scan.
  const indexedArrayMatch = (names: string) => short
    ? `to_tsvector('simple', ${names}) @@ to_tsquery('simple', $3::text)`
    : `(${names} % $1 OR ${names} %> $1 OR ${names} LIKE $3)`;
  const individualTermMatch = short
    ? "to_tsvector('simple', terms.term) @@ to_tsquery('simple', $3::text)"
    : "(terms.term % $1 OR terms.term %> $1 OR terms.term LIKE $3)";
  const distance = geo ? "ST_Distance(r.path, ST_MakePoint($7, $6)::geography)" : "NULL::double precision";
  const proximity = geo ? `COALESCE(EXP(-1.0 * ${distance} / 500000.0) * 0.05, 0)` : "0";

  return {
    text: `WITH indexed_destination_candidates AS MATERIALIZED (
         SELECT candidate_d.id
         FROM destinations candidate_d
         WHERE ${indexedNameMatch("candidate_d.search_name")}
       ),
       candidate_route_ids AS MATERIALIZED (
         SELECT candidate_r.id
         FROM routes candidate_r
         WHERE candidate_r.status = 'active'
           AND ${indexedNameMatch("candidate_r.search_name")}
         UNION
         SELECT candidate_r.id
         FROM routes candidate_r
         WHERE candidate_r.status = 'active'
           AND ${indexedArrayMatch("peaks_search_names(candidate_r.aliases)")}
         UNION
         SELECT linked_r.id
         FROM indexed_destination_candidates candidate_d
         JOIN routes linked_r
           ON linked_r.objective_destination_id = candidate_d.id
          AND linked_r.status = 'active'
         UNION
         SELECT linked_r.id
         FROM indexed_destination_candidates candidate_d
         JOIN route_destinations candidate_rd
           ON candidate_rd.destination_id = candidate_d.id
         JOIN routes linked_r
           ON linked_r.id = candidate_rd.route_id
          AND linked_r.status = 'active'
         UNION
         SELECT linked_r.id
         FROM segments candidate_s
         JOIN route_segments candidate_rs ON candidate_rs.segment_id = candidate_s.id
         JOIN routes linked_r ON linked_r.id = candidate_rs.route_id AND linked_r.status = 'active'
         WHERE ${indexedArrayMatch("peaks_search_names(candidate_s.trail_names)")}
       ),
       ${short ? `visible_candidate_route_ids AS MATERIALIZED (
         SELECT candidate_r.id
         FROM candidate_route_ids candidate
         JOIN routes candidate_r ON candidate_r.id = candidate.id
         WHERE ${buildRouteAccessSql("candidate_r", "$5")}
         ORDER BY (candidate_r.search_name = $1) DESC NULLS LAST,
                  (candidate_r.search_name LIKE $2) DESC NULLS LAST,
                  similarity(candidate_r.search_name, $1) DESC NULLS LAST,
                  candidate_r.popularity DESC NULLS LAST, candidate_r.id
         LIMIT ${Math.min(500, Math.max(100, input.limit * 10))}
       ),` : ""}
       ranked_routes AS MATERIALIZED (
         SELECT r.id, r.name, r.polyline6, r.owner,
                r.distance, r.gain, r.gain_loss, r.elevation_string,
                r.external_links, r.provenance, r.completion, r.shape,
                r.description, r.description_source_name, r.description_source_url, r.description_source_license,
                r.kind, r.slug, r.aliases, r.objective_destination_id, r.trailhead_destination_id,
                r.difficulty, r.est_moving_seconds, r.state_code, r.country_code, r.popularity,
                (r.search_name = $1) AS name_exact_match,
                matched_terms.exact_match AS term_exact_match,
                ${distance} AS distance_m,
                (COALESCE(matched_terms.text_score, 0)
                  + ${searchPopularityScoreSql("r.popularity")}
                  + ${proximity}) AS score
         FROM ${short ? "visible_candidate_route_ids" : "candidate_route_ids"} candidate
         JOIN routes r ON r.id = candidate.id
         LEFT JOIN LATERAL (
           SELECT max(${searchTextScoreSql("terms.term", "$1", "$2")}) AS text_score,
                  bool_or(${individualTermMatch}) AS matches,
                  bool_or(terms.term = $1) AS exact_match
           FROM (
             SELECT r.search_name AS term
             UNION ALL
             SELECT peaks_search_name(alias) FROM unnest(r.aliases) alias
             UNION ALL
             SELECT d.search_name FROM destinations d WHERE d.id = r.objective_destination_id
             UNION ALL
             SELECT d.search_name
             FROM route_destinations rd JOIN destinations d ON d.id = rd.destination_id
             WHERE rd.route_id = r.id
             UNION ALL
             SELECT peaks_search_name(trail_name)
             FROM route_segments rs JOIN segments s ON s.id = rs.segment_id
             CROSS JOIN LATERAL unnest(s.trail_names) trail_name
             WHERE rs.route_id = r.id
           ) terms
         ) matched_terms ON true
         WHERE r.status = 'active'
           AND matched_terms.matches
           AND ${buildRouteAccessSql("r", "$5")}
         ORDER BY score DESC, r.name, r.id
         LIMIT $4
       )
       SELECT r.id, r.name, r.polyline6, r.owner,
              r.distance, r.gain, r.gain_loss, r.elevation_string,
              r.external_links, r.provenance, r.completion, r.shape,
              r.description, r.description_source_name, r.description_source_url, r.description_source_license,
              r.kind, r.slug, r.aliases, r.objective_destination_id, r.trailhead_destination_id,
              r.difficulty, r.est_moving_seconds, r.state_code, r.country_code, r.popularity,
              ${routeCoverSelectSql()},
              ${routeAreaRowsSql}, r.distance_m, r.name_exact_match, r.term_exact_match, r.score
       FROM ranked_routes r
       ${routeCoverJoinSql()}
       ${routeAreaJoinSql}
       ORDER BY r.score DESC, r.name, r.id`,
    values,
  };
}

export function buildAreaSearchQuery(input: DestinationSearchQueryInput): SearchSqlQuery {
  const q = input.normalizedQuery;
  const short = q.length === 2;
  const aliases = areaSearchAliases(q);
  const geo = hasGeo(input);
  const values: unknown[] = [q, `${q}%`, input.limit, aliases];
  if (geo) values.push(input.lat, input.lng);
  const nameMatch = short ? "a.search_name LIKE $2" : "(a.search_name % $1 OR a.search_name LIKE $2)";
  const candidateWhere = short && !/^[a-z0-9]+$/.test(q)
    ? "false"
    : `(${nameMatch} OR a.search_name = ANY($4::text[]))`;
  const distance = geo ? "ST_Distance(a.centroid::geography, ST_MakePoint($6, $5)::geography)" : "NULL::double precision";
  const proximity = geo ? `COALESCE(EXP(-1.0 * ${distance} / 500000.0) * 0.05, 0)` : "0";

  return {
    text: `SELECT a.id, a.name, a.kind, a.designation, a.manager,
              a.parent_area_id AS parent_id,
              ST_Y(a.centroid) AS lat,
              ST_X(a.centroid) AS lng,
              a.bbox_min_lat, a.bbox_max_lat, a.bbox_min_lng, a.bbox_max_lng,
              COALESCE(destination_counts.destination_count, 0)::int AS destination_count,
              COALESCE(route_counts.route_count, 0)::int AS route_count,
              ${distance} AS distance_m,
              (GREATEST(${searchTextScoreSql("a.search_name", "$1", "$2")},
                 CASE WHEN a.search_name = ANY($4::text[]) THEN 0.85 ELSE 0 END)
                + ${searchPopularityScoreSql("destination_counts.destination_count + route_counts.route_count")}
                + ${proximity}) AS score
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
       WHERE ${candidateWhere}
       ORDER BY score DESC, a.name, a.id
       LIMIT $3`,
    values,
  };
}

export function buildListSearchQuery(input: DestinationSearchQueryInput): SearchSqlQuery {
  const q = input.normalizedQuery;
  const short = q.length === 2;
  const text = "peaks_search_name(l.name)";
  const candidateWhere = short && !/^[a-z0-9]+$/.test(q)
    ? "false"
    : short ? `${text} LIKE $2` : `(${text} % $1 OR ${text} LIKE $2)`;
  return {
    text: `SELECT l.id, l.name, l.description, l.owner, l.region,
              l.year_established, l.organization, l.source_name, l.source_url,
              members.destination_count, members.route_count,
              (${searchTextScoreSql(text, "$1", "$2")}
                + ${searchPopularityScoreSql("members.destination_count + members.route_count")}) AS score
       FROM lists l
       CROSS JOIN LATERAL (
         SELECT (SELECT count(*)::int FROM list_destinations ld WHERE ld.list_id = l.id) AS destination_count,
                (SELECT count(*)::int FROM list_routes lr WHERE lr.list_id = l.id) AS route_count
       ) members
       WHERE ${candidateWhere}
         AND (l.owner = 'peaks' OR l.owner = $4)
       ORDER BY score DESC, l.name, l.id
       LIMIT $3`,
    values: [q, `${q}%`, input.limit, input.uid ?? ""],
  };
}

export function buildMixedSearchQueries(input: DestinationSearchQueryInput): MixedSearchSqlQueries {
  // Keep a two-letter prefix when it also covers the expanded abbreviation:
  // "br" finds Bridal and Bridge, while "mt" still expands to Mount.
  const raw = input.rawQuery.trim().toLowerCase();
  const queryInput = /^[a-z0-9]{2}$/.test(raw) && input.normalizedQuery.startsWith(raw)
    ? { ...input, normalizedQuery: raw } : input;
  return {
    destinations: buildRankedDestinationSearchQuery(queryInput),
    routes: buildRouteSearchQuery(queryInput),
    areas: buildAreaSearchQuery(queryInput),
    lists: buildListSearchQuery(queryInput),
    limit: input.limit,
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

// Area lookup may still degrade for older clients. Missing route catalog data
// must remain visible as an error, just like failed destination or list search.
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

export async function runMixedSearchQueries(
  res: Response,
  queries: MixedSearchSqlQueries,
  pool: SearchDbPool = db,
  cancelBackendFn: (pid: number) => Promise<void> = cancelBackend
): Promise<(SearchBuckets & { results: ReturnType<typeof rankSearchResults> }) | undefined> {
  return withCancellableSearchClient(res, async (runner) => {
    const destinations = await runner.query(queries.destinations);
    if (!destinations) return undefined;

    const routes = await runner.query(queries.routes);
    if (!routes) return undefined;

    const areas = await runOptionalSearchRows(runner, queries.areas, "areas");
    if (!areas) return undefined;

    const lists = await runner.query(queries.lists);
    if (!lists) return undefined;

    const buckets = { destinations, routes, areas, lists };
    return { ...buckets, results: rankSearchResults(buckets, queries.limit) };
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
// One ranked result list plus typed buckets for existing clients. Each ranked
// item wraps its original row in data so geographic type fields stay intact.
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
