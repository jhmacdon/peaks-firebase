import { Router, Request, Response } from "express";
import { asyncRoute } from "../lib/async-route";
import db, { createDbClient } from "../db";
import { getUid } from "../auth";
import { buildRouteAccessSql } from "../lib/route-access";
import { routeCoverJoinSql, routeCoverSelectSql } from "../lib/route-cover";
import { normalizeSearchName } from "../search-utils";
import { publicAreaParentSql, publicAreaSql, publicCatalogSql } from "../lib/catalog-visibility";
import { CATALOG_LIMITS, clampCatalogLimit } from "../lib/catalog-limits";
import { rankSearchResults, searchMinorPlacePenaltySql, searchPopularityScoreSql, searchTextScoreSql, SearchBuckets, summarizeSearchResults } from "../lib/search-ranking";

import { supportsGlaciers, glacierVisibilitySql } from "../lib/glacier-capability";
import { hasGlacierSupport } from "../lib/schema-features";

const router = Router();

const destinationSearchText = "search_name";
const destinationSearchVector = "to_tsvector('simple', COALESCE(NULLIF(search_name, ''), lower(name)))";
const destinationAreaRowsSql = `COALESCE(area_rows.areas, '[]'::json) AS areas`;
const destinationAreaJoinSql = (publicOnly = false) => `LEFT JOIN LATERAL (
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
                    'parent_id', ${publicAreaParentSql("a", publicOnly)},
                    'relation', da.relation,
                    'source', da.source
                  ) AS area_obj
           FROM destination_areas da
           JOIN areas a ON a.id = da.area_id
           WHERE da.destination_id = destinations.id
             AND ${publicAreaSql("a", publicOnly)}
           ORDER BY a.kind, a.name, a.designation DESC NULLS LAST, a.id
         ) deduped
       ) area_rows ON true`;
const routeAreaRowsSql = `COALESCE(area_rows.areas, '[]'::json) AS areas`;
const routeAreaJoinSql = (publicOnly = false) => `LEFT JOIN LATERAL (
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
                    'parent_id', ${publicAreaParentSql("a", publicOnly)},
                    'relation', ra.relation,
                    'source', ra.source
                  ) AS area_obj
           FROM route_areas ra
           JOIN areas a ON a.id = ra.area_id
           WHERE ra.route_id = r.id
             AND ${publicAreaSql("a", publicOnly)}
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
  publicOnly?: boolean;
  glaciers?: boolean;
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
  return ["mount baker national forest", "snoqualmie national forest"];
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

// Every word of the query, the last as a prefix: "mount stu" becomes
// "mount & stu:*". Words keep letters, marks, and digits only, the way
// to_tsvector('simple') splits names, so no tsquery syntax reaches to_tsquery.
export function wordPrefixTsQuery(normalizedQuery: string): string | null {
  const words = normalizedQuery.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return null;
  return words.map((word, index) => index === words.length - 1 ? `${word}:*` : word).join(" & ");
}

// Route and place search score candidates with similarity(), which costs far
// more than the index lookup that finds them.
// Trigram candidates for "mount stuart" were the 15k terms sharing letters
// with "mount"; about 500 matched and 2 held both words. So candidates are
// only names holding every query word (stored full-text vectors). There is no
// typo fallback: trigram matching took 10 s on the db-f1-micro, which served
// users worse than no result.
// A common word still matches tens of thousands of names ("trail": 105k route
// terms), so catalog matches are capped to the shortest names, the most
// popular, and, given a location, the nearest. Among names that hold every
// query word, shorter names score higher on similarity; popularity adds at
// most 0.10 and proximity 0.05, so the top results survive the cap.
// User-owned rows are few and never capped.
export const SEARCH_CANDIDATE_CAP = 1000;

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
       ${destinationAreaJoinSql(input.publicOnly)}
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
           AND ${publicCatalogSql("destinations", input.publicOnly)}
           AND ${glacierVisibilitySql("destinations",input.glaciers!==false)}
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
       ${destinationAreaJoinSql(input.publicOnly)}
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
           AND ${publicCatalogSql("destinations", input.publicOnly)}
           AND ${glacierVisibilitySql("destinations",input.glaciers!==false)}
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
       ${destinationAreaJoinSql(input.publicOnly)}
       ORDER BY destinations.score DESC`,
    values: [tsQuery, normalizedPrefix, rawPrefix, q, raw, shortLimit],
  };
}

export function buildDestinationSearchQuery(input: DestinationSearchQueryInput): { text: string; values: unknown[] } {
  if (input.glaciers) return buildRankedDestinationSearchQuery(input);
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
         WHERE (${destinationSearchText} % $1
            OR ${destinationSearchText} LIKE $4)
           AND ${publicCatalogSql("destinations", input.publicOnly)}
           AND ${glacierVisibilitySql("destinations",input.glaciers!==false)}
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
       ${destinationAreaJoinSql(input.publicOnly)}
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
         WHERE (${destinationSearchText} % $1
            OR ${destinationSearchText} LIKE $2)
           AND ${publicCatalogSql("destinations", input.publicOnly)}
           AND ${glacierVisibilitySql("destinations",input.glaciers!==false)}
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
       ${destinationAreaJoinSql(input.publicOnly)}
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
  const wordQuery = short ? tokenPrefixTsQuery(q) : wordPrefixTsQuery(q);
  const values: unknown[] = [q, prefix, input.limit, wordQuery ?? ""];
  const geo = hasGeo(input);
  if (geo) values.push(input.lat, input.lng);
  // Ranking reads destination_search_rows, a narrow trigger-maintained copy of
  // each place's search fields; destinations rows average 2.8 KB, and
  // rechecking thousands of trigram matches against them read tens of MB per
  // search. Full rows load only for the final page.
  // Each SQL piece must reference its parameter even when it can never match:
  // node-postgres sends untyped values, and Postgres rejects one it never sees.
  const wordMatch = wordQuery ? "ds.search_vector @@ to_tsquery('simple', $4::text)" : "$4::text IS NULL";
  const distance = geo ? "ST_Distance(ds.location, ST_MakePoint($6, $5)::geography)" : "NULL::double precision";
  const proximity = geo ? `COALESCE(EXP(-1.0 * ${distance} / 500000.0) * 0.05, 0)` : "0";
  const publicRow = `(${publicCatalogSql("ds", input.publicOnly)}) AND ${glacierVisibilitySql("ds",input.glaciers!==false)}`;
  // Each list walks its own partial index and stops at the cap; the shortest
  // and popular indexes include every column a list reads, so those walks
  // never visit the table. Places have no distance index: no word matches
  // more than ~30k places, and sorting those beat a distance walk.
  const candidateColumns = "ds.id, ds.name, ds.search_name, ds.features, ds.session_count_offset, ds.location";
  const cappedIds = (order: string) => `(SELECT ${candidateColumns} FROM destination_search_rows ds
          WHERE owner = 'peaks' AND ${wordMatch} AND ${publicRow}
          ORDER BY ${order} LIMIT ${SEARCH_CANDIDATE_CAP})`;

  return {
    text: `WITH candidate_rows AS MATERIALIZED (
         ${cappedIds("ds.search_length, ds.search_name, ds.id")}
         UNION ALL
         ${cappedIds("ds.session_count_offset DESC, ds.search_length, ds.search_name, ds.id")}${geo ? `
         UNION ALL
         ${cappedIds("ds.location <-> ST_MakePoint($6, $5)::geography")}` : ""}
         UNION ALL
         SELECT ${candidateColumns} FROM destination_search_rows ds
         WHERE owner <> 'peaks' AND ${wordMatch} AND ${publicRow}
       ),
       -- Scoring sits behind its own fence so the planner never scores the
       -- whole table to stop early at the final LIMIT.
       scored_destinations AS MATERIALIZED (
         SELECT ds.id, ds.name,
                (ds.search_name = $1) AS name_exact_match,
                (ds.search_name LIKE $2 OR ds.search_name LIKE ('% ' || $1 || '%')) AS name_prefix_match,
                ${distance} AS distance_m,
                (${searchTextScoreSql("ds.search_name", "$1", "$2")}
                  + ${searchPopularityScoreSql("ds.session_count_offset")}
                  + ${proximity}
                  - ${searchMinorPlacePenaltySql("ds.features", "ds.search_name", "$1")}) AS score
         -- A place can sit in several lists; score it once.
         FROM (SELECT DISTINCT ON (id) * FROM candidate_rows) ds
       ),
       ranked_destinations AS MATERIALIZED (
         SELECT * FROM scored_destinations
         ORDER BY score DESC, name, id
         LIMIT $3
       )
       SELECT destinations.id, destinations.name, destinations.elevation, destinations.prominence,
              destinations.type, destinations.activities, destinations.features,
              destinations.country_code, destinations.state_code,
              ${destinationAreaRowsSql},
              ST_Y(destinations.location::geometry) AS lat,
              ST_X(destinations.location::geometry) AS lng,
              ranked.distance_m, ranked.name_exact_match, ranked.name_prefix_match, ranked.score
       FROM ranked_destinations ranked
       JOIN destinations ON destinations.id = ranked.id
       ${destinationAreaJoinSql(input.publicOnly)}
       WHERE ${publicCatalogSql("destinations", input.publicOnly)}
       ORDER BY ranked.score DESC, destinations.name, destinations.id`,
    values,
  };
}

export function buildRouteSearchQuery(input: DestinationSearchQueryInput): SearchSqlQuery {
  const q = input.normalizedQuery;
  const short = q.length === 2;
  const geo = hasGeo(input);
  const wordQuery = short ? tokenPrefixTsQuery(q) : wordPrefixTsQuery(q);
  const values: unknown[] = [q, `${q}%`, input.limit, input.uid ?? "", wordQuery ?? ""];
  if (geo) values.push(input.lat, input.lng);
  // route_search_terms holds one row per (active route, searchable term):
  // name, aliases, linked place names, and segment trail names. One pass over
  // the matching rows scores each route by its best matching term; routes rows
  // load only for the shortlist. Candidates follow SEARCH_CANDIDATE_CAP;
  // two-character queries never fall back to trigram matching.
  // Each SQL piece must reference its parameter even when it can never match:
  // node-postgres sends untyped values, and Postgres rejects one it never sees.
  const wordMatch = wordQuery ? "t.term_vector @@ to_tsquery('simple', $5::text)" : "$5::text IS NULL";
  // Signed-out callers never match or score a private place's name.
  const publicTerm = input.publicOnly ? "AND t.public" : "";
  // A name the route only borrows from a segment's trail weighs 0.8; its own
  // name, aliases, and linked places weigh 1. public_weight counts public
  // sources only.
  const termWeight = input.publicOnly ? "COALESCE(t.public_weight, 0)" : "t.weight";
  // Each list walks its own partial index and stops at the cap, carrying the
  // scoring columns. The shortest and popular indexes include every column a
  // list reads, so those walks never visit the table (a table visit per row
  // cost ~3 ms on a throttled, cold db-f1-micro). Capped rows are all
  // owner = 'peaks', so the lists name it rather than read it.
  const weightColumn = input.publicOnly ? "t.public_weight" : "t.weight";
  const cappedKeys = (order: string) => `(SELECT t.route_id, t.term, 'peaks'::text AS owner, t.popularity, t.anchor, ${weightColumn}
          FROM route_search_terms t
          WHERE owner = 'peaks' AND ${wordMatch} ${publicTerm}
          ORDER BY ${order} LIMIT ${SEARCH_CANDIDATE_CAP})`;
  const shortlistSize = Math.min(500, Math.max(100, input.limit * 10));
  // Proximity measures to the route's start point, kept on each term row, so
  // ranking never reads a route's full path (about 13 ms per long path on the
  // db-f1-micro). distance_m is therefore the distance to the start.
  const distance = geo ? "ST_Distance(s.anchor, ST_MakePoint($7, $6)::geography)" : "NULL::double precision";
  const proximity = geo ? `COALESCE(EXP(-1.0 * ${distance} / 500000.0) * 0.05, 0)` : "0";

  return {
    text: `WITH candidate_terms AS MATERIALIZED (
         ${cappedKeys("t.term_length, t.term, t.route_id")}
         UNION ALL
         ${cappedKeys("t.popularity DESC, t.term_length, t.term, t.route_id")}${geo ? `
         UNION ALL
         -- A KNN index scan needs the distance as the only sort key.
         ${cappedKeys("t.anchor <-> ST_MakePoint($7, $6)::geography")}` : ""}
         UNION ALL
         SELECT t.route_id, t.term, t.owner, t.popularity, t.anchor, ${weightColumn}
         FROM route_search_terms t
         WHERE owner <> 'peaks' AND ${wordMatch} ${publicTerm}
       ),
       scored_routes AS MATERIALIZED (
         SELECT t.route_id AS id,
                max(${searchTextScoreSql("t.term", "$1", "$2")} * ${termWeight}) AS text_score,
                bool_or(t.term = $1) AS exact_match,
                min(t.owner) AS owner,
                max(t.popularity) AS popularity,
                (array_agg(t.anchor))[1] AS anchor
         -- A term can sit in several lists; score it once.
         FROM (SELECT DISTINCT ON (route_id, term) * FROM candidate_terms) t
         GROUP BY t.route_id
       ),
       -- Proximity (at most 0.05) joins the score after this cut, so a broad
       -- query such as "trail" measures 200 distances, not thousands.
       shortlist AS MATERIALIZED (
         SELECT s.id, s.text_score, s.exact_match, s.anchor
         FROM scored_routes s
         WHERE ${buildRouteAccessSql("s", "$4")}
         ORDER BY s.text_score + ${searchPopularityScoreSql("s.popularity")} DESC, s.id
         LIMIT ${shortlistSize}
       ),
       -- Ranking reads only narrow route columns; long text such as the path
       -- loads for the final page alone.
       ranked_routes AS MATERIALIZED (
         SELECT r.id,
                (r.search_name = $1) AS name_exact_match,
                s.exact_match AS term_exact_match,
                ${distance} AS distance_m,
                (s.text_score
                  + ${searchPopularityScoreSql("r.popularity")}
                  + ${proximity}) AS score
         FROM shortlist s
         JOIN routes r ON r.id = s.id
         WHERE r.status = 'active'
           AND ${buildRouteAccessSql("r", "$4")}
         ORDER BY score DESC, r.name, r.id
         LIMIT $3
       )
       SELECT r.id, r.name, r.polyline6, r.owner,
              r.distance, r.gain, r.gain_loss, r.elevation_string,
              r.external_links, r.provenance, r.completion, r.shape,
              r.description, r.description_source_name, r.description_source_url, r.description_source_license,
              r.kind, r.slug, r.aliases, r.objective_destination_id, r.trailhead_destination_id,
              r.difficulty, r.terrain_category, r.terrain_summary, r.est_moving_seconds, r.state_code, r.country_code, r.popularity,
              ${routeCoverSelectSql()},
              ${routeAreaRowsSql}, ranked.distance_m, ranked.name_exact_match, ranked.term_exact_match, ranked.score
       FROM ranked_routes ranked
       JOIN routes r ON r.id = ranked.id
       ${routeCoverJoinSql("r", "cover", "id", input.publicOnly)}
       ${routeAreaJoinSql(input.publicOnly)}
       ORDER BY ranked.score DESC, r.name, r.id`,
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
              ${publicAreaParentSql("a", input.publicOnly)} AS parent_id,
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
         JOIN destinations d ON d.id = da.destination_id
         WHERE da.area_id = a.id
           AND ${publicCatalogSql("d", input.publicOnly)}
       ) destination_counts ON true
       LEFT JOIN LATERAL (
         SELECT count(DISTINCT ra.route_id) AS route_count
         FROM route_areas ra
         JOIN routes r ON r.id = ra.route_id
         WHERE ra.area_id = a.id
           AND ${publicCatalogSql("r", input.publicOnly)}
           AND ${input.publicOnly ? "r.status = 'active'" : "TRUE"}
       ) route_counts ON true
       WHERE ${candidateWhere}
         AND ${publicAreaSql("a", input.publicOnly)}
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
         AND (l.owner = 'peaks' OR ($4 <> '' AND l.owner = $4))
         AND ${publicCatalogSql("l", input.publicOnly)}
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
    return { ...buckets, results: summarizeSearchResults(rankSearchResults(buckets, queries.limit)) };
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
      publicOnly: !getUid(req),
      glaciers: supportsGlaciers(req),
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
      publicOnly: !getUid(req),
      glaciers: supportsGlaciers(req),
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
  if (features.includes("glacier")) {
    if (!supportsGlaciers(req)) { res.json([]); return; }
    if (!await hasGlacierSupport()) { res.status(503).json({error:"Glacier migration not installed"}); return; }
  }
  const activities = (req.query.activities as string || "").split(",").filter(Boolean);
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const radius = parseFloat(req.query.radius as string) || 50000;
  const limit = clampCatalogLimit(req.query.limit, 50, CATALOG_LIMITS.features);

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

  conditions.push(publicCatalogSql("destinations", !getUid(req)));
  conditions.push(glacierVisibilitySql("destinations",supportsGlaciers(req)));
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
