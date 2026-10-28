import { lineCoverageCtes, routeSourceLinesSql, sessionTrackCte, TRIPLE_CROWN_INDEXED_ROUTE_IDS, utmSridSql } from "./line-coverage";
import { Pool, PoolClient } from "pg";
import crypto from "crypto";
import db, { createDbClient } from "./db";
import { matchComparisons } from "./comparisons";
import {
  selectRouteMatches,
  dropContainedRouteMatches,
  mergeRouteIntervals,
  type RouteCoverageRow,
  type RouteMatch,
} from "./route-coverage";
import { segmentPasses, type SegmentCorridorRow, type SegmentPass } from "./segment-passes";
import { pathPlacesCtes, planTrackVerticesSql } from "./lib/path-places";
import { refreshSessionGlacierCrossings } from "./lib/glacier-crossings";
import { planSourceFingerprintSql } from "./lib/plan-repair";

export function generateId(): string {
  return crypto.randomBytes(10).toString("hex");
}

// A 'processing' claim older than this is considered dead and re-claimable.
// processSession runs in seconds; this is far longer than any real run (and any
// Cloud Run request timeout), so a live run is never re-claimed. Shared by
// processSession's claim and markSessionPendingIfReady so the two guards agree.
export const STALE_PROCESSING_MINUTES = 10;

/**
 * True iff `err` is a Postgres statement_timeout cancel (SQLSTATE 57014).
 * Used so an INLINE match that ran out of the web pool's 30s budget is left
 * 'pending' for the relaxed sweep to finish, rather than marked 'failed'.
 */
export function isStatementTimeout(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "57014"
  );
}

export interface ProcessingResult {
  destinations_matched: number;
  routes_matched: number;
  areas_linked: number;
  attempt_group_id: string | null;
  attempt_group_session_count: number;
  /** True when an already-completed session was skipped (no re-matching). */
  skipped?: boolean;
}

/**
 * Minimal query interface so the area-linking helpers accept either the pool
 * (`db`) or a transaction client (`PoolClient`).
 */
interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<{ rowCount: number | null }>;
}

/**
 * Row-returning query interface, so the coverage helpers accept the pool
 * (`db`), a transaction client (`PoolClient`), or a stub in tests.
 */
interface RowQueryable {
  query: (
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: unknown[]; rowCount: number | null }>;
}

/**
 * Build the SQL that links a session's reached SUMMIT destinations to the
 * protected areas that contain them (or that they sit on the boundary of).
 *
 * Mirrors the schema's link_summit_destinations_to_areas() predicate but scoped
 * to one session's reached summits, so it is cheap to run inline per recording:
 * a summit is linked to an area when ST_Covers-contained OR within
 * `toleranceMeters` of the boundary. The planar ST_DWithin gate (degrees,
 * GIST-indexed) prunes candidates; the exact geography ST_DWithin makes the
 * precise meter cut. Tolerance default matches the migration (50 m) — see
 * cloud-sql/migrations/20260613_area_link_tolerance.sql for the rationale.
 */
export function buildLinkReachedSummitsToAreasSql(
  sessionId: string,
  toleranceMeters = 50
): { text: string; values: unknown[] } {
  const gateDeg = Math.max(toleranceMeters / 30000, 0.0002);
  return {
    text: `INSERT INTO destination_areas (destination_id, area_id, relation, source)
     SELECT DISTINCT sd.destination_id, a.id, 'contained_by', 'postgis'
     FROM session_destinations sd
     JOIN destinations d ON d.id = sd.destination_id
     JOIN LATERAL (
       SELECT a.id
       FROM areas a
       WHERE ST_DWithin(a.boundary, ST_Force2D(d.location::geometry), $2)
         AND (
           ST_Covers(a.boundary, ST_Force2D(d.location::geometry))
           OR ST_DWithin(a.boundary::geography, d.location, $3)
         )
     ) a ON true
     WHERE sd.session_id = $1
       AND sd.relation = 'reached'
       AND d.location IS NOT NULL
       AND 'summit'::destination_feature = ANY(d.features)
     ON CONFLICT (destination_id, area_id) DO NOTHING`,
    values: [sessionId, gateDeg, toleranceMeters],
  };
}

/**
 * Check a processed recording's reached summits against protected areas and
 * record the containment links. Enrichment, not core processing — callers run
 * it best-effort so a linking hiccup never fails session ingestion.
 */
export async function linkReachedSummitsToAreas(
  q: Queryable,
  sessionId: string,
  toleranceMeters = 50
): Promise<number> {
  const sql = buildLinkReachedSummitsToAreasSql(sessionId, toleranceMeters);
  const result = await q.query(sql.text, sql.values);
  return result.rowCount ?? 0;
}

/**
 * Build the bounded PostGIS query that tags one or more sessions from their
 * saved track segments. Each segment gets its own geometry so a recording gap
 * cannot create a false straight-line area crossing. The geometry bbox check
 * lets the GiST parts index remove distant polygons before ST_Intersects checks
 * the small candidate set.
 *
 * linkSessionsToAreas clears existing PostGIS tags first, so reprocessing a
 * changed path removes areas it no longer crosses. Non-PostGIS rows remain.
 */
export function buildLinkSessionsToAreasSql(
  sessionIds: string[]
): { text: string; values: unknown[] } {
  return {
    text: `WITH session_segments AS MATERIALIZED (
       SELECT tp.session_id,
              CASE WHEN count(*) = 1
                   THEN (array_agg(
                     ST_Force2D(tp.location::geometry)
                     ORDER BY tp.time
                   ))[1]
                   ELSE ST_MakeLine(
                     ST_Force2D(tp.location::geometry)
                     ORDER BY tp.time
                   )
              END AS geom
       FROM tracking_points tp
       WHERE tp.session_id = ANY($1::text[])
         AND tp.location IS NOT NULL
       GROUP BY tp.session_id, tp.segment_number
     )
     INSERT INTO session_areas (session_id, area_id, relation, source)
     SELECT DISTINCT s.session_id, a.id, 'intersects', 'postgis'
     FROM session_segments s
     JOIN LATERAL (
       SELECT DISTINCT parts.area_id AS id
       FROM area_boundary_parts parts
       WHERE parts.boundary_part && s.geom
         AND ST_Intersects(parts.boundary_part, s.geom)
     ) a ON true
     ON CONFLICT (session_id, area_id) DO NOTHING`,
    values: [sessionIds],
  };
}

export async function linkSessionsToAreas(
  q: Queryable,
  sessionIds: string[]
): Promise<number> {
  if (sessionIds.length === 0) return 0;
  await q.query(
    `DELETE FROM session_areas
     WHERE session_id = ANY($1::text[]) AND source = 'postgis'`,
    [sessionIds]
  );
  const sql = buildLinkSessionsToAreasSql(sessionIds);
  const result = await q.query(sql.text, sql.values);
  return result.rowCount ?? 0;
}

export async function linkSessionToAreas(
  q: Queryable,
  sessionId: string
): Promise<number> {
  return linkSessionsToAreas(q, [sessionId]);
}

/**
 * The widest radius destination_match_radius() can return (waterfall /
 * viewpoint = 200 m). A constant-distance ST_DWithin with THIS value is
 * GIST-index-usable, so the planner prunes the global `destinations` table down
 * to the handful near the track before the exact, per-feature radius is applied.
 *
 * MUST stay >= the largest value in destination_match_radius() — a smaller
 * constant would silently drop legitimate matches. Bump both together.
 */
export const MAX_DESTINATION_MATCH_RADIUS_M = 200;

/**
 * The widest distance destination_boundary_match_radius() can return (lake =
 * 50 m). Same role as MAX_DESTINATION_MATCH_RADIUS_M for outlined places: a
 * constant the GIST index on destination_boundary_parts can prune with before
 * the per-feature distance applies. Bump both together.
 */
export const MAX_BOUNDARY_MATCH_RADIUS_M = 50;

/**
 * Segments per track piece when matching outlines. Each piece holds this many
 * consecutive segments of the recorded track, sharing its end point with the
 * next, so the pieces together are exactly the track.
 */
export const TRACK_PIECE_SEGMENTS = 31;

/**
 * Destinations a path reaches, as one `id` column: point destinations within
 * their per-feature radius, and boundary destinations whose indexed boundary
 * pieces lie within their per-feature distance (50 m for lakes, 10 m
 * otherwise). Owner-scoped. Shared by session and plan matching.
 */
function destinationMatchCandidatesSql(pathExpr: string, ownerExpr: string): string {
  return `SELECT d.id
       FROM destinations d
       WHERE d.boundary IS NULL
         AND NOT ('glacier'=ANY(d.features::text[]))
         AND (d.owner = 'peaks' OR d.owner = ${ownerExpr})
         AND ST_DWithin(d.location, ${pathExpr}, ${MAX_DESTINATION_MATCH_RADIUS_M})
         AND ST_DWithin(d.location, ${pathExpr}, destination_match_radius(d.features))
       UNION
       SELECT d.id
       FROM (
         SELECT ST_MakeLine(pt.geom ORDER BY pt.i)::geography AS piece
         FROM (SELECT line.path AS line, (dp).path[1] AS i, (dp).geom
               FROM ST_Dump(${pathExpr}::geometry) line
               CROSS JOIN LATERAL ST_DumpPoints(line.geom) dp
               WHERE ST_Dimension(line.geom) = 1) pt
         CROSS JOIN LATERAL (
           SELECT (pt.i - 1) / ${TRACK_PIECE_SEGMENTS}
           UNION ALL
           SELECT (pt.i - 2) / ${TRACK_PIECE_SEGMENTS}
           WHERE pt.i > 1 AND (pt.i - 1) % ${TRACK_PIECE_SEGMENTS} = 0
         ) grp(g)
         GROUP BY pt.line, grp.g
         HAVING count(*) > 1
       ) track
       JOIN destination_boundary_parts bp
         ON ST_DWithin(bp.boundary_part, track.piece, ${MAX_BOUNDARY_MATCH_RADIUS_M})
       JOIN destinations d ON d.id = bp.destination_id
       WHERE d.boundary IS NOT NULL
         AND NOT ('glacier'=ANY(d.features::text[]))
         AND (d.owner = 'peaks' OR d.owner = ${ownerExpr})
         AND ST_DWithin(bp.boundary_part, track.piece, destination_boundary_match_radius(d.features))`;
}

/**
 * Build the destination-match INSERT for a session.
 *
 * Reads the materialized linestring from tracking_sessions.path (set by
 * processSession Step 0). Per-feature thresholds live in the SQL function
 * destination_match_radius() (see cloud-sql/schema.sql). Boundary destinations
 * use destination_boundary_match_radius(): 50 m for lakes, whose shores a
 * hiker stops at rather than enters, and 10 m for other outlines
 * (migrations/20261010_forgiving_lake_match.sql).
 *
 * Performance (the 30s-timeout regression): the per-feature
 * `destination_match_radius(d.features)` distance is computed per row, so the
 * GIST index on destinations.location CANNOT prune with it — the query fell
 * back to an exact ST_DWithin of the full track against EVERY global
 * destination and tripped the 30s statement_timeout as the table grew, wedging
 * sessions at 'failed'/'processing'. The constant-distance
 * `ST_DWithin(d.location, s.path, MAX_DESTINATION_MATCH_RADIUS_M)` is
 * index-usable and prunes first; the exact per-feature ST_DWithin then runs on
 * just the near rows. Results are identical to the old CASE — the constant is a
 * superset of every per-feature radius, and the point branch stays gated on
 * `boundary IS NULL`.
 *
 * Boundary destinations match against destination_boundary_parts, never the
 * whole polygon (migrations/20261008_destination_boundary_parts.sql). A lake
 * outline can hold 475k points; checking one whole cost a 16-point session
 * over 150 s. The track is split too, into runs of TRACK_PIECE_SEGMENTS
 * recorded segments, so each outline piece is measured against a short
 * stretch rather than the whole hike. Measured whole, a 103 km, 4,441-point
 * track cost about 0.5 s per nearby outline piece and passed the 120 s
 * processing limit (2026-10-11); in pieces it takes under 6 s. The pieces are the
 * track's own segments, so distances and matches are unchanged. A plan path
 * can be a MultiLineString (disjoint routes merged), so each line is split
 * on its own and no piece joins the end of one line to the start of the next.
 *
 * Do not split with ST_Subdivide. It took nearly two minutes on a dense
 * 5,001-point track that doubles back on itself, and it cuts long segments
 * at points on the straight degree-space line, which drift off the geodesic:
 * a track with a GPS gap matched Echo Lake, which is 95 m away.
 * The two branches are a UNION inside a LATERAL so each one is driven by its
 * own GIST index.
 *
 * Owner scope: a destination owned by 'peaks' is system-global; a
 * user-owned destination only matches that user's own sessions.
 *
 * Pure builder so its shape is unit-testable without a live DB (mirrors
 * buildPlanDestinationMatchSql).
 *
 * Rejections: a (session, destination) pair recorded in
 * session_destination_rejections is anti-joined out. The user said they did not
 * reach that destination; re-processing must not overrule them. The same
 * anti-join lives in link_sessions_on_destination_insert (cloud-sql/schema.sql)
 * and backfillDestinationToSessions (web/src/lib/destination-backfill.ts) —
 * scripts/check-cross-refs.sh fails CI if any of them drops it. Destination
 * edits and route changes do not match on their own: they queue the nearby
 * sessions for processSession (see drainSessionRematchQueue).
 */
export function buildSessionDestinationMatchSql(
  sessionId: string
): { text: string; values: unknown[] } {
  return {
    text: `INSERT INTO session_destinations (session_id, destination_id, relation, source)
     SELECT s.id, d.id, 'reached', 'auto'
     FROM tracking_sessions s
     CROSS JOIN LATERAL (${destinationMatchCandidatesSql("s.path", "s.user_id")}) d
     WHERE s.id = $1
       AND s.path IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM session_destination_rejections r
         WHERE r.session_id = s.id AND r.destination_id = d.id
       )
     ON CONFLICT (session_id, destination_id) DO NOTHING`,
    values: [sessionId],
  };
}

async function matchDestinations(client: PoolClient, sessionId: string): Promise<number> {
  const sql = buildSessionDestinationMatchSql(sessionId);
  const result = await client.query(sql.text, sql.values);
  return result.rowCount ?? 0;
}

/** Keep the long-trail point index isolated by CASE; it must never enter
 * segment-chain or whole-path distance tests. Other geography bbox predicates
 * use idx_routes_path / idx_segments_path before bounded exact tests. */
/** Candidate routes come from each route's own path. rebuild_route_path keeps a
 * route's path equal to its chained segments, so no separate segment branch is needed;
 * Triple Crown routes keep their indexed point path. */
export function buildRouteCandidateSql(sessionId: string): { text: string; values: unknown[] } {
  // idx_routes_path (GiST on geography) prunes before any route path is
  // detoasted; the 0.01 degree box is a strict superset of the 0.005 degree
  // planar tests below, which still decide. Without it every active route's
  // path was read and cast (3.5 s on a db-f1-micro for one Rainier session).
  return {
    text: `WITH session_track AS MATERIALIZED (
      SELECT s.user_id, s.path::geometry AS track, ST_Expand(s.path::geometry, 0.005) AS box,
        ST_Expand(s.path::geometry, 0.01)::geography AS index_box
      FROM tracking_sessions s WHERE s.id = $1 AND s.path IS NOT NULL
    )
    SELECT r.id FROM routes r, session_track st
     WHERE r.status = 'active'
       AND (r.owner = 'peaks' OR r.owner = st.user_id)
       AND r.path && st.index_box
       AND r.path::geometry && st.box
       AND CASE
         WHEN r.id = ANY($2::text[])
           THEN EXISTS (
             SELECT 1
             FROM triple_crown_route_points tcp
             WHERE tcp.route_id = r.id
               AND tcp.pt && st.box
               AND ST_DWithin(tcp.pt, st.track, 0.005)
           )
         WHEN ST_NPoints(r.path::geometry) <= 8192
           THEN ST_DWithin(r.path::geometry, st.track, 0.005)
         ELSE EXISTS (
           SELECT 1
           FROM ST_Subdivide(r.path::geometry, 512) AS route_part(geom)
           WHERE route_part.geom && st.box
             AND ST_DWithin(route_part.geom, st.track, 0.005)
         )
       END`,
    values: [sessionId, TRIPLE_CROWN_INDEXED_ROUTE_IDS],
  };
}

/** Measure covered lengths on 10 m pieces; containment runs after primary selection. */
export function buildRouteCoverageSql(
  sessionId: string,
  routeIds: string[]
): { text: string; values: unknown[] } {
  return {
    text: `WITH ${sessionTrackCte()}, source_lines AS (${routeSourceLinesSql()}),
    ${lineCoverageCtes(true)}
    SELECT cs.line_id AS route_id, cs.length_m, LEAST(cs.length_m, cs.covered_m) AS covered_m,
      cs.covered_intervals, cs.covered_geometry, r.kind,
      objective.id IS NOT NULL AS has_objective,
      EXISTS (SELECT 1 FROM session_destinations sd WHERE sd.session_id = $1
        AND sd.relation = 'reached' AND sd.destination_id = objective.id) AS objective_reached
    FROM coverage_stats cs JOIN routes r ON r.id = cs.line_id
    LEFT JOIN LATERAL (SELECT COALESCE(r.objective_destination_id, (
      SELECT rd.destination_id FROM route_destinations rd WHERE rd.route_id = r.id
      ORDER BY rd.ordinal DESC, rd.destination_id DESC LIMIT 1
    )) AS id) objective ON true`,
    values: [sessionId, routeIds, TRIPLE_CROWN_INDEXED_ROUTE_IDS],
  };
}

/** Actual covered samples are merged by coverage SQL and passed back as EWKB.
 * Fractions are display facts; applying them to planar geometry shifts visits.
 * The primary scalar subquery stays constant on ST_DWithin's right side, in the
 * UTM zone at its centroid (see sessionTrackCte); sample lengths stay geodesic. */
export function buildRouteContainmentSql(matches: RouteMatch[]): { text: string; values: unknown[] } {
  return {
    text: `WITH matches AS MATERIALIZED (
      SELECT route_id, is_primary, ST_GeomFromEWKB(decode(covered_geometry, 'hex')) AS geom
      FROM jsonb_to_recordset($1::jsonb)
        AS m(route_id text, covered_geometry text, is_primary boolean)
    ), primary_covered AS MATERIALIZED (
      SELECT ${utmSridSql("geom")} AS srid, geom FROM matches WHERE is_primary
    ), primary_covered_m AS MATERIALIZED (
      SELECT srid, ST_Transform(ST_Force2D(geom), srid) AS path FROM primary_covered
    ), secondary_portions AS (
      SELECT route_id, part.geom, ST_Length(part.geom::geography, false) AS length_m
      FROM matches CROSS JOIN LATERAL ST_Dump(geom) part WHERE NOT is_primary
    ), sample_counts AS MATERIALIZED (
      -- Materialized so each portion's geodesic length is computed once, not
      -- once per sample in the aggregate (2.4 s for 136 samples on prod).
      SELECT *, GREATEST(1, ceil(length_m / 50)::integer) AS sample_count
      FROM secondary_portions WHERE length_m > 0
    ), samples AS (
      SELECT route_id, length_m / sample_count AS sample_m,
        ST_Transform(ST_LineInterpolatePoint(geom, (sample.idx + 0.5) / sample_count),
          (SELECT srid FROM primary_covered_m)) AS pt
      FROM sample_counts CROSS JOIN LATERAL generate_series(0, sample_count - 1) AS sample(idx)
    )
    SELECT route_id FROM samples GROUP BY route_id
    HAVING COALESCE(sum(sample_m) FILTER (
      WHERE ST_DWithin(pt, (SELECT path FROM primary_covered_m), 30)
    ), 0) >= 0.9 * sum(sample_m)`,
    values: [JSON.stringify(matches.map(({ route_id, covered_geometry, is_primary }) => ({ route_id, covered_geometry, is_primary })))],
  };
}

/** Shared by live processing, rematching, and the coverage audit script. */
async function measureCandidateRouteCoverage(q: RowQueryable, sessionId: string, routeIds: string[]): Promise<RouteMatch[]> {
  const coverageSql = buildRouteCoverageSql(sessionId, routeIds);
  const measured = await q.query(coverageSql.text, coverageSql.values);
  const rows = measured.rows as RouteCoverageRow[];
  for (const id of routeIds) {
    if ((TRIPLE_CROWN_INDEXED_ROUTE_IDS as readonly string[]).includes(id) && !rows.some((row) => row.route_id === id)) {
      throw new Error(`triple_crown_route_points_missing:${id}`);
    }
  }
  const matches = selectRouteMatches(rows);
  if (matches.length < 2) return matches;
  const containmentSql = buildRouteContainmentSql(matches);
  const contained = await q.query(containmentSql.text, containmentSql.values);
  return dropContainedRouteMatches(matches, (contained.rows as Array<{ route_id: string }>).map((row) => row.route_id));
}

/** Read-only segment measurement, also used by the perf script. Session points
 * are read once through their (session_id,time) PK and projected to the
 * track's UTM zone; each segment's 30 m visit test is planar in that zone.
 * One row per segment that clears the visit gate: its covered 10 m pieces as
 * touching runs, and the corridor points as [time, metres along, track order,
 * UTM x, UTM y]
 * in time order. segmentPasses splits those into passes in JavaScript, so no
 * point is read twice. */
export function buildSessionSegmentCoverageSelectSql(sessionId: string, routeIds: string[]): { text: string; values: unknown[] } {
  return {
    text: `WITH ${sessionTrackCte()}, source_lines AS MATERIALIZED (
      SELECT DISTINCT seg.id AS line_id, seg.path
      FROM route_segments rs JOIN segments seg ON seg.id = rs.segment_id
      WHERE rs.route_id = ANY($2::text[]) AND NOT (rs.route_id = ANY($3::text[]))
        AND NOT EXISTS (SELECT 1 FROM route_segments tc WHERE tc.segment_id = seg.id AND tc.route_id = ANY($3::text[]))
    ), ${lineCoverageCtes()}, session_points AS MATERIALIZED (
      SELECT tp.time, row_number() OVER (ORDER BY tp.time) AS seq,
        ST_Transform(ST_Force2D(tp.location::geometry), st.srid) AS pt_m
      FROM tracking_points tp, session_track st WHERE tp.session_id = $1 AND tp.location IS NOT NULL
    ), segment_shapes AS MATERIALIZED (
      SELECT shapes.line_id, shapes.geom_m, ST_Expand(ST_Envelope(shapes.geom_m), 30) AS box_m,
        ST_Transform(ST_Force2D(l.path::geometry), shapes.srid) AS line_m,
        -- Positions use the same 2D geodesic metres as the 10 m pieces.
        -- ST_Length(geography) adds elevation change; ST_Distance does not.
        ST_Length(ST_Force2D(l.path::geometry)::geography, false) AS along_length_m
      FROM (SELECT bp.line_id, st.srid, ST_Transform(ST_Force2D(ST_Collect(bp.geom)), st.srid) AS geom_m
        FROM bounded_parts bp, session_track st GROUP BY bp.line_id, st.srid) shapes
      JOIN source_lines l ON l.line_id = shapes.line_id
    ), touching_samples AS (
      SELECT line_id, start_m, end_m, CASE WHEN start_m <= lag(end_m) OVER
        (PARTITION BY line_id ORDER BY start_m, end_m) + 0.001 THEN 0 ELSE 1 END AS new_run
      FROM covered_samples
    ), sample_runs AS (
      SELECT line_id, json_agg(json_build_array(start_m, end_m) ORDER BY start_m) AS runs
      FROM (SELECT line_id, min(start_m) AS start_m, max(end_m) AS end_m FROM (
        SELECT *, sum(new_run) OVER (PARTITION BY line_id ORDER BY start_m, end_m) AS run FROM touching_samples
      ) r GROUP BY line_id, run) merged GROUP BY line_id
    )
    SELECT $1::text AS session_id, cs.line_id AS segment_id, cs.length_m, shape.along_length_m,
      LEAST(cs.length_m, cs.covered_m) AS covered_m, sr.runs, corridor.points,
      ST_Distance(ST_StartPoint(shape.line_m), ST_EndPoint(shape.line_m)) <= 30 AS closed
    FROM coverage_stats cs
    JOIN segment_shapes shape ON shape.line_id = cs.line_id
    LEFT JOIN sample_runs sr ON sr.line_id = cs.line_id
    CROSS JOIN LATERAL (
      SELECT json_agg(json_build_array(tp.time,
          ST_LineLocatePoint(shape.line_m, tp.pt_m) * shape.along_length_m, tp.seq,
          round(ST_X(tp.pt_m)::numeric, 1), round(ST_Y(tp.pt_m)::numeric, 1)) ORDER BY tp.time) AS points
      FROM session_points tp WHERE tp.pt_m && shape.box_m AND ST_DWithin(tp.pt_m, shape.geom_m, 30)
    ) corridor
    WHERE (cs.covered_m >= 50 OR cs.covered_m / cs.length_m >= 0.5) AND corridor.points IS NOT NULL`,
    values: [sessionId, routeIds, TRIPLE_CROWN_INDEXED_ROUTE_IDS],
  };
}

/** Passes for every segment the select measured, in segment then time order. */
export function sessionSegmentPasses(rows: SegmentCorridorRow[]): SegmentPass[] {
  return rows.flatMap(segmentPasses);
}

/** Measure, split into passes, and replace the session's segment visits. */
export async function writeSessionSegmentVisits(q: RowQueryable, sessionId: string, routeIds: string[]): Promise<number> {
  await q.query(`DELETE FROM session_segments WHERE session_id = $1`, [sessionId]);
  if (routeIds.length === 0) return 0;
  const select = buildSessionSegmentCoverageSelectSql(sessionId, routeIds);
  const passes = sessionSegmentPasses((await q.query(select.text, select.values)).rows as SegmentCorridorRow[]);
  if (passes.length === 0) return 0;
  const result = await q.query(SESSION_SEGMENT_INSERT_SQL, [JSON.stringify(passes)]);
  return result.rowCount ?? 0;
}

export const SESSION_SEGMENT_INSERT_SQL = `INSERT INTO session_segments
    (session_id, segment_id, pass_index, covered_fraction, covered_m, entered_at, exited_at, direction)
  SELECT p.session_id, p.segment_id, p.pass_index, p.covered_fraction, p.covered_m, p.entered_at, p.exited_at, p.direction
  FROM jsonb_to_recordset($1::jsonb) AS p(session_id text, segment_id text, pass_index integer,
    covered_fraction double precision, covered_m double precision, entered_at timestamptz,
    exited_at timestamptz, direction text)
  ON CONFLICT (session_id, segment_id, pass_index) DO UPDATE SET
    covered_fraction = EXCLUDED.covered_fraction, covered_m = EXCLUDED.covered_m,
    entered_at = EXCLUDED.entered_at, exited_at = EXCLUDED.exited_at, direction = EXCLUDED.direction`;

export { TRIPLE_CROWN_INDEXED_ROUTE_IDS };

/**
 * Measure one session against every active route near its track and return the
 * rows that clear the write gate. Read-only — the caller decides how to write,
 * because processSession and the backfill script differ on conflicts.
 */
export async function measureSessionRouteCoverage(
  q: RowQueryable,
  sessionId: string
): Promise<RouteMatch[]> {
  const candidateSql = buildRouteCandidateSql(sessionId);
  const candidates = await q.query(candidateSql.text, candidateSql.values);
  if (candidates.rows.length === 0) return [];

  const candidateIds = (candidates.rows as Array<{ id: string }>).map((r) => r.id);
  return measureCandidateRouteCoverage(q, sessionId, candidateIds);
}

/** Atomically replace all route facts, including stale auto rows and legacy
 * manual echoes. Both processing and the coverage backfill use this writer. */
export async function upsertSessionRouteCoverage(q: RowQueryable, sessionId: string, matches: RouteMatch[]): Promise<number> {
  const result = await q.query(
    `WITH locked AS (SELECT id FROM tracking_sessions WHERE id = $1 FOR UPDATE), removed AS (
      DELETE FROM session_routes WHERE session_id IN (SELECT id FROM locked) RETURNING route_id
    )
    INSERT INTO session_routes (session_id, route_id, source, coverage, covered_intervals, covered_m, is_primary)
    SELECT $1::text, m.route_id, 'auto', m.coverage, m.covered_intervals, m.covered_m, m.is_primary
    FROM jsonb_to_recordset($2::jsonb)
      AS m(route_id text, coverage double precision, covered_intervals jsonb, covered_m double precision, is_primary boolean)
    CROSS JOIN (SELECT count(*) AS n FROM removed) barrier WHERE barrier.n >= 0`,
    [sessionId, JSON.stringify(matches.map(({ route_id, coverage, covered_m, covered_intervals, is_primary }) => ({
      route_id, coverage, covered_m, is_primary,
      covered_intervals: mergeRouteIntervals(covered_intervals, coverage > 0 ? covered_m / coverage : 0),
    })))]
  );
  return result.rowCount ?? 0;
}

/** The session transaction replaces route and segment measurements together. */
async function matchRoutes(client: PoolClient, sessionId: string): Promise<number> {
  const candidateSql = buildRouteCandidateSql(sessionId);
  const candidates = await client.query(candidateSql.text, candidateSql.values);
  const routeIds = candidates.rows.map((row: { id: string }) => row.id);
  await writeSessionSegmentVisits(client, sessionId, routeIds);
  if (routeIds.length === 0) return upsertSessionRouteCoverage(client, sessionId, []);
  const matches = await measureCandidateRouteCoverage(client, sessionId, routeIds);
  return upsertSessionRouteCoverage(client, sessionId, matches);
}

/**
 * Group sessions that represent repeated attempts of the same climb.
 *
 * Writes to tracking_sessions.attempt_group_id and session_attempt_groups.
 * Distinct from tracking_sessions.group_id, which is reserved for smart-link
 * multi-day chains (client-driven, opt-in under SmartLinkFlag). This function
 * runs unconditionally on every session import; the iOS log-row collapse is
 * gated on group_id (smart-link only), so previous-attempts groupings are
 * stored but never surfaced as merged log rows.
 *
 * Primary: destination-based — sessions sharing 2+ reached destinations.
 * Secondary: spatial — for sessions with <2 destinations, compare simplified
 * GPS tracks using Hausdorff distance (pre-filter by start-point proximity).
 */
async function matchPreviousAttempts(
  client: PoolClient,
  sessionId: string,
  userId: string
): Promise<{ attempt_group_id: string | null; attempt_group_session_count: number }> {
  // Primary: find sessions sharing 2+ reached destinations
  const destMatches = await client.query(
    `WITH current_dests AS (
        SELECT destination_id FROM session_destinations
        WHERE session_id = $1 AND relation = 'reached'
    )
    SELECT sd.session_id, ts.attempt_group_id, COUNT(DISTINCT sd.destination_id) AS shared
    FROM session_destinations sd
    JOIN tracking_sessions ts ON ts.id = sd.session_id
    WHERE sd.destination_id IN (SELECT destination_id FROM current_dests)
      AND sd.relation = 'reached' AND ts.user_id = $2 AND sd.session_id != $1
    GROUP BY sd.session_id, ts.attempt_group_id
    HAVING COUNT(DISTINCT sd.destination_id) >= 2`,
    [sessionId, userId]
  );

  if (destMatches.rows.length > 0) {
    return await assignAttemptGroup(client, sessionId, userId, destMatches.rows);
  }

  // Check how many reached destinations this session has
  const destCount = await client.query(
    `SELECT COUNT(*) AS cnt FROM session_destinations
     WHERE session_id = $1 AND relation = 'reached'`,
    [sessionId]
  );

  if (parseInt(destCount.rows[0].cnt) >= 2) {
    // Has destinations but no matches — no group needed
    return { attempt_group_id: null, attempt_group_session_count: 0 };
  }

  // Secondary: spatial matching for sessions with <2 destinations
  const spatialMatches = await client.query(
    `WITH current_track AS (
        SELECT ST_Simplify(ST_MakeLine(location::geometry ORDER BY time), 0.0005) AS track,
               (SELECT location FROM tracking_points WHERE session_id = $1 ORDER BY time LIMIT 1) AS start_pt
        FROM tracking_points WHERE session_id = $1
    ),
    candidate_sessions AS (
        SELECT DISTINCT tp2.session_id
        FROM current_track ct, tracking_points tp2
        JOIN tracking_sessions ts2 ON ts2.id = tp2.session_id
        WHERE ts2.user_id = $2
          AND tp2.session_id != $1
          AND tp2.time = (SELECT MIN(time) FROM tracking_points WHERE session_id = tp2.session_id)
          AND ST_DWithin(tp2.location, ct.start_pt, 10000)
    ),
    other_tracks AS (
        SELECT tp3.session_id, ts3.attempt_group_id,
               ST_Simplify(ST_MakeLine(tp3.location::geometry ORDER BY tp3.time), 0.0005) AS track
        FROM tracking_points tp3
        JOIN tracking_sessions ts3 ON ts3.id = tp3.session_id
        WHERE tp3.session_id IN (SELECT session_id FROM candidate_sessions)
        GROUP BY tp3.session_id, ts3.attempt_group_id
    )
    SELECT ot.session_id, ot.attempt_group_id
    FROM other_tracks ot, current_track ct
    WHERE ST_HausdorffDistance(ot.track, ct.track) < 0.003`,
    [sessionId, userId]
  );

  if (spatialMatches.rows.length > 0) {
    return await assignAttemptGroup(client, sessionId, userId, spatialMatches.rows);
  }

  return { attempt_group_id: null, attempt_group_session_count: 0 };
}

/**
 * Assign the current session to a previous-attempts group based on matched
 * sessions. If any match already has an attempt_group_id, use that.
 * Otherwise create a new session_attempt_groups row.
 */
async function assignAttemptGroup(
  client: PoolClient,
  sessionId: string,
  userId: string,
  matches: Array<{ session_id: string; attempt_group_id: string | null }>
): Promise<{ attempt_group_id: string; attempt_group_session_count: number }> {
  // Find an existing group from matched sessions
  const existingGroupId = matches.find((m) => m.attempt_group_id)?.attempt_group_id;

  let groupId: string;

  if (existingGroupId) {
    groupId = existingGroupId;
  } else {
    // Create a new previous-attempts group
    groupId = generateId();
    await client.query(
      `INSERT INTO session_attempt_groups (id, user_id) VALUES ($1, $2)`,
      [groupId, userId]
    );

    // Assign all matched sessions to the new group
    const matchedIds = matches.map((m) => m.session_id);
    await client.query(
      `UPDATE tracking_sessions SET attempt_group_id = $1 WHERE id = ANY($2)`,
      [groupId, matchedIds]
    );
  }

  // Assign current session to the group
  await client.query(
    `UPDATE tracking_sessions SET attempt_group_id = $1 WHERE id = $2`,
    [groupId, sessionId]
  );

  // Count total sessions in the group
  const countResult = await client.query(
    `SELECT COUNT(*) AS cnt FROM tracking_sessions WHERE attempt_group_id = $1`,
    [groupId]
  );

  return {
    attempt_group_id: groupId,
    attempt_group_session_count: parseInt(countResult.rows[0].cnt),
  };
}

/**
 * Rebuild the popularity buckets (`destinations.averages`) for a set of
 * destinations from the live `session_destinations` rows.
 *
 * This used to be a blind `+1` per process, which double-counted on every
 * re-process and could never decrement — so a removed or rejected ascent stayed
 * in the histogram forever. Recomputing makes processing idempotent and makes a
 * rejection decrement automatically.
 *
 * Reached rows ONLY. A 'goal' row records an intention, not an ascent, and a
 * rejection deliberately spares it (see applyDestinationRejections in
 * routes/sessions.ts) — so counting goals here would put the retracted ascent
 * straight back into the histogram.
 *
 * Month and day-of-week are derived with EXTRACT, like the live
 * GET /api/destinations/averages endpoint, so the stored buckets and the live
 * aggregation can never disagree about which bucket a session falls in. (The
 * old code derived them in JS from the API server's local clock, which could
 * disagree with the database's.) The endpoint indexes a 0-based Sunday-first
 * array by EXTRACT(DOW); this indexes a 1-based Monday-first array by
 * EXTRACT(ISODOW), which is the same mapping written without an offset.
 *
 * Buckets are UTC, deliberately. EXTRACT on a TIMESTAMPTZ resolves in the
 * connection's TimeZone, which is UTC on Cloud SQL and in Cloud Run, so a
 * session is filed by its UTC month and weekday rather than the climber's local
 * one. That is a known, accepted approximation: `averages_offset` holds
 * historical local-date counts from Firestore and is merged in blindly at read
 * time, so the two halves of a merged histogram already answer to different
 * clocks. Filing live rows by local date would need a per-session timezone the
 * schema does not carry.
 *
 * `averages_offset` (pre-migration Firestore history) is NEVER written here —
 * it is merged in at read time by mergeAverages (routes/destinations.ts) and
 * topMonths (routes/lists.ts). Any other keys already on `averages` (e.g. a
 * migrated `lastUpdated`) are preserved; only `months` and `days` are replaced.
 *
 * `recency` comes from the data like everything else here: the latest
 * start_time among the counted reached sessions. It is NOT stamped with now().
 * A retraction has to be able to move it DOWN — bumping it on the write that
 * removes an ascent would advertise a destination as freshly visited precisely
 * when the user said they never visited it.
 *
 * When no reached rows remain the existing value is kept, NOT nulled. Unlike
 * `averages` there is no `recency_offset`: the Firestore migration wrote each
 * destination's historical recency straight into this column
 * (migrate/src/migrate-destinations.ts), and nothing can regenerate it. A peak
 * whose visits all live in `averages_offset` has no live reached rows at all,
 * so an unconditional write would erase that history irreversibly on the first
 * recompute that named it.
 *
 * Pure builder so the shape is unit-testable without a live DB.
 */
export function buildDestinationAveragesRecomputeSql(): { text: string } {
  return {
    text: `WITH ids AS (
      SELECT DISTINCT unnest($1::text[]) AS id
    ),
    reached AS (
      SELECT sd.destination_id AS id, ts.start_time
      FROM session_destinations sd
      JOIN tracking_sessions ts ON ts.id = sd.session_id
      WHERE sd.destination_id IN (SELECT id FROM ids)
        AND sd.relation = 'reached'
        AND ts.start_time IS NOT NULL
    ),
    months AS (
      SELECT id, jsonb_object_agg(m, cnt) AS blob FROM (
        SELECT id,
               (ARRAY['jan','feb','mar','apr','may','jun',
                      'jul','aug','sep','oct','nov','dec'])[EXTRACT(MONTH FROM start_time)::int] AS m,
               COUNT(*)::int AS cnt
        FROM reached GROUP BY 1, 2
      ) x GROUP BY id
    ),
    days AS (
      SELECT id, jsonb_object_agg(d, cnt) AS blob FROM (
        SELECT id,
               (ARRAY['mo','tu','we','th','fr','sa','su'])[EXTRACT(ISODOW FROM start_time)::int] AS d,
               COUNT(*)::int AS cnt
        FROM reached GROUP BY 1, 2
      ) y GROUP BY id
    ),
    totals AS (
      SELECT id, MAX(start_time) AS last_at FROM reached GROUP BY id
    )
    UPDATE destinations dst
    SET averages = (COALESCE(dst.averages, '{}'::jsonb) - 'months' - 'days')
                   || jsonb_build_object(
                        'months', COALESCE(months.blob, '{}'::jsonb),
                        'days',   COALESCE(days.blob,   '{}'::jsonb)
                      ),
        recency = COALESCE(totals.last_at, dst.recency)
    FROM ids
    LEFT JOIN months ON months.id = ids.id
    LEFT JOIN days   ON days.id   = ids.id
    LEFT JOIN totals ON totals.id = ids.id
    WHERE dst.id = ids.id`,
  };
}

/**
 * Serializes concurrent recomputes of the same destination. Taken immediately
 * before the recompute UPDATE, in the same transaction.
 *
 * Without it the recompute has a lost-update race that the old blind increment
 * did not. Under READ COMMITTED two processes A and B can both be recomputing
 * destination D: A inserts its session_destinations row and commits; B, whose
 * snapshot predates that commit, has already counted the reached rows in its
 * CTE. When B's UPDATE reaches D's row it blocks on A's lock, and on release
 * EvalPlanQual re-fetches and re-evaluates against the NEW version of the
 * TARGET tuple — but the count B is about to write came from the CTE, which is
 * still evaluated against B's original snapshot. B writes a total that never
 * saw A's row, and the count is silently one low until something recomputes D
 * again. The old `+= 1` was immune because each writer only ever read and wrote
 * the one row it was locking.
 *
 * Locking the destination rows FIRST makes B block before it builds its CTE, so
 * B's snapshot is taken after A commits and its count includes A's row.
 * FOR NO KEY UPDATE rather than FOR UPDATE: it does not block the foreign keys
 * that reference destinations(id), which session_destinations inserts need.
 * ORDER BY id so concurrent multi-destination recomputes take their locks in
 * the same sequence and cannot deadlock.
 */
export const DESTINATION_AVERAGES_LOCK_SQL =
  `SELECT id FROM destinations WHERE id = ANY($1::text[]) ORDER BY id FOR NO KEY UPDATE`;

/**
 * Recompute `destinations.averages` for the given destination ids. Idempotent;
 * a no-op on an empty list. Call it for every destination whose
 * session_destinations rows changed — including ones whose rows were DELETED,
 * which processSession can no longer see (see routes/sessions.ts
 * applyDestinationRejections and reachedDestinationIds).
 *
 * Must run inside the caller's transaction: the lock it takes is only held to
 * the end of that transaction, and it has to still be held when the UPDATE
 * commits. Every current caller is mid-transaction.
 */
export async function recomputeDestinationAverages(
  client: PoolClient,
  destinationIds: string[]
): Promise<void> {
  if (destinationIds.length === 0) return;
  await client.query(DESTINATION_AVERAGES_LOCK_SQL, [destinationIds]);
  const sql = buildDestinationAveragesRecomputeSql();
  await client.query(sql.text, [destinationIds]);
}

/**
 * Step 5 of processSession: refresh the popularity buckets of every destination
 * this session currently counts as reached.
 */
async function updateDestinationAverages(
  client: PoolClient,
  sessionId: string
): Promise<void> {
  const destResult = await client.query(
    `SELECT destination_id FROM session_destinations
     WHERE session_id = $1 AND relation = 'reached'`,
    [sessionId]
  );
  await recomputeDestinationAverages(
    client,
    destResult.rows.map((r: { destination_id: string }) => r.destination_id)
  );
}

/**
 * Process a session: match destinations, routes, and group previous attempts.
 * Runs all steps in a single transaction. Idempotent — clears auto-tags first.
 *
 * Concurrency: the opening UPDATE is gated on `processing_state IS DISTINCT
 * FROM 'processing'` so a second concurrent caller (e.g. iOS poll racing
 * with the inline auto-process from PUT /api/sessions/:id) bails out with
 * `already_processing` instead of running matching twice.
 */
export async function processSession(
  sessionId: string,
  userId: string,
  opts: { force?: boolean; pool?: Pool } = {}
): Promise<ProcessingResult> {
  const pool = opts.pool ?? db;
  // Idempotency: an already-completed session is NOT re-processed unless
  // explicitly forced. iOS's upload step 3 (and stray re-process triggers)
  // otherwise re-claim and re-run the expensive PostGIS matching on sessions
  // that are already done — which under load 503s the whole API. The points
  // endpoint marks 'pending' only when NEW points are actually inserted, so a
  // genuinely-changed session still re-processes. Old clients re-POSTing
  // unchanged points insert 0 rows → stay 'completed' → skipped here too.
  if (!opts.force) {
    const cur = await pool.query(
      `SELECT processing_state FROM tracking_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    if (cur.rows[0]?.processing_state === "completed") {
      return {
        destinations_matched: 0,
        routes_matched: 0,
        areas_linked: 0,
        attempt_group_id: null,
        attempt_group_session_count: 0,
        skipped: true,
      };
    }
  }

  // Claim the session. A row already 'processing' is normally off-limits (a
  // concurrent run owns it), but a claim older than STALE_PROCESSING_MINUTES is
  // treated as dead — a prior run that died between here and Step 6 without
  // hitting the catch (e.g. Cloud Run killed the worker), which would otherwise
  // wedge the session at 'processing' forever. processSession is idempotent, so
  // re-claiming a truly-dead run is safe; the window is far longer than any real
  // run so a live run is never stolen.
  const claim = await pool.query(
    `UPDATE tracking_sessions
     SET processing_state = 'processing',
         processing_error = NULL,
         processing_started_at = now(),
         processing_attempts = processing_attempts + 1
     WHERE id = $1 AND user_id = $2
       AND (processing_state IS DISTINCT FROM 'processing'
            OR processing_started_at IS NULL
            OR processing_started_at < now() - make_interval(mins => ${STALE_PROCESSING_MINUTES}))`,
    [sessionId, userId]
  );
  if ((claim.rowCount ?? 0) === 0) {
    throw new Error("already_processing");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Step 0: Materialize the session's GPS track as a single linestring.
    // Used by destination/route matching here AND by reverse-match queries
    // when a new destination is created. Stored on tracking_sessions.path
    // so subsequent reads hit a GIST index instead of rebuilding the line.
    await client.query(
      `UPDATE tracking_sessions s
       SET path = (
         SELECT ST_MakeLine(tp.location::geometry ORDER BY tp.time)::geography
         FROM tracking_points tp
         WHERE tp.session_id = s.id
       )
       WHERE s.id = $1`,
      [sessionId]
    );

    // Step 1: Clear previous auto destination tags. Step 3 atomically replaces
    // route facts, including legacy manual echoes, after measuring the track.
    await client.query(
      `DELETE FROM session_destinations WHERE session_id = $1 AND source = 'auto'`,
      [sessionId]
    );

    // Step 2: Destination matching
    const destinationsMatched = await matchDestinations(client, sessionId)
      + await refreshSessionGlacierCrossings(client, sessionId);

    // Step 3: Route matching
    const routesMatched = await matchRoutes(client, sessionId);

    // Step 4: Tag each saved track segment with the protected areas it crosses. This is
    // part of the same transaction as path materialization, so a completed
    // session always exposes tags for its current path.
    const areasLinked = await linkSessionToAreas(client, sessionId);

    // Step 5: Update destination averages (popular times)
    await updateDestinationAverages(client, sessionId);

    // Step 6: Previous attempt grouping
    const { attempt_group_id, attempt_group_session_count } = await matchPreviousAttempts(
      client,
      sessionId,
      userId
    );

    // Step 7: Mark as processed
    await client.query(
      `UPDATE tracking_sessions
       SET processed_at = NOW(),
           processing_state = 'completed',
           processing_error = NULL,
           processing_attempts = 0
       WHERE id = $1`,
      [sessionId]
    );

    await client.query("COMMIT");

    // Step 8: Check reached summits against protected areas and record the
    // containment links. Runs after COMMIT on the pool (not the just-released
    // client) and is best-effort: destination_areas rows are global and
    // idempotent (ON CONFLICT DO NOTHING), so a failure here must never fail an
    // otherwise-successful recording ingestion.
    try {
      await linkReachedSummitsToAreas(pool, sessionId);
    } catch (err) {
      console.error(`[processSession] area linking failed for session ${sessionId}:`, err);
    }

    // Step 9: pairwise session comparisons ("Your Efforts"). Post-commit and
    // best-effort like Step 8: comparison rows are enrichment, and a failure
    // here must never fail an otherwise-successful ingestion. A missed run
    // self-heals on the next reprocess or via scripts/backfill-comparisons.ts.
    try {
      await matchComparisons(pool, sessionId, userId);
    } catch (err) {
      console.error(`[processSession] comparison matching failed for ${sessionId}:`, err);
    }

    return {
      destinations_matched: destinationsMatched,
      routes_matched: routesMatched,
      areas_linked: areasLinked,
      attempt_group_id,
      attempt_group_session_count,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    // An INLINE run that exceeded the web pool's 30s budget (57014) is NOT a
    // real failure — leave it 'pending' so the relaxed sweep finishes it.
    // Genuine errors still surface as 'failed' + processing_error.
    if (isStatementTimeout(err)) {
      await pool.query(
        `UPDATE tracking_sessions
         SET processing_state = 'pending', processing_error = NULL
         WHERE id = $1`,
        [sessionId]
      );
    } else {
      const message = err instanceof Error ? err.message.slice(0, 500) : "Unknown processing error";
      await pool.query(
        `UPDATE tracking_sessions
         SET processing_state = 'failed', processing_error = $2
         WHERE id = $1`,
        [sessionId, message]
      );
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Match each place at its first visit, preserving goal and manual identities. */
function planPlaceSourceSql(): string {
  return `WITH source AS MATERIALIZED (
    SELECT p.id,p.user_id,p.path FROM plans p WHERE p.id=$1 AND p.path IS NOT NULL
  ), track_vertices AS MATERIALIZED (${planTrackVerticesSql}),
  ${pathPlacesCtes({nearby:false,linked:"EXISTS(SELECT 1 FROM plan_destinations pd WHERE pd.plan_id=$1 AND pd.destination_id=d.id) OR EXISTS(SELECT 1 FROM plan_reached_destinations prd WHERE prd.plan_id=$1 AND prd.destination_id=d.id AND prd.source<>'auto')"})}`;
}

export function buildPlanPlaceReadQuery(planId: string) {
  return {text: `${planPlaceSourceSql()} SELECT id,distance_along_m FROM unique_places ORDER BY distance_along_m,id`,values:[planId]};
}

export function buildPlanDestinationMatchSql(planId: string): { text: string; values: unknown[] } {
  return {
    text: `${planPlaceSourceSql()}
     INSERT INTO plan_reached_destinations (plan_id,destination_id,ordinal,source)
     SELECT $1,id,(row_number() OVER (ORDER BY distance_along_m,id)-1)::int,'auto'
     FROM unique_places
     ON CONFLICT (plan_id, destination_id) DO NOTHING`,
    values: [planId],
  };
}

// Arbitrary fixed key for the session-sweep advisory lock. Ensures at most ONE
// sweep runs across the whole Cloud Run fleet at a time, so the sweep can never
// add more than ~1-2 connections on top of the web pool (db-f1-micro budget).
export const SWEEP_ADVISORY_LOCK_KEY = 4927301;

export interface SweepLockClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
  close(): Promise<void>;
}

async function connectSweepLockClient(): Promise<SweepLockClient> {
  const client = createDbClient();
  await client.connect();
  return {
    query: (text, values) => client.query(text, values),
    close: () => client.end(),
  };
}

// The sweep gives up on a session after this many claims without success. An
// upload or a forced re-run still processes it, and success resets the count.
export const MAX_SWEEP_ATTEMPTS = 5;

// All ended sessions with points stuck at pending/failed or a stale 'processing'
// claim, across EVERY user, oldest first. Parameterless so callers append LIMIT.
export function buildStuckSessionsSql(): string {
  return `SELECT s.id, s.user_id FROM tracking_sessions s
     WHERE s.ended = true
       AND (
         s.processing_state IN ('pending', 'failed')
         OR (s.processing_state = 'processing'
             AND (s.processing_started_at IS NULL
                  OR s.processing_started_at < now() - make_interval(mins => ${STALE_PROCESSING_MINUTES})))
       )
       AND s.processing_attempts < ${MAX_SWEEP_ATTEMPTS}
       AND EXISTS (SELECT 1 FROM tracking_points tp WHERE tp.session_id = s.id)
     ORDER BY s.server_updated_at ASC, s.id ASC`;
}

/**
 * Drain up to `limit` stuck sessions on `pool` (the relaxed processingPool),
 * serially. Fleet-wide-singleton via a Postgres advisory lock: an instance that
 * does not get the lock returns immediately. processSession is idempotent, so a
 * row a live inline run owns throws `already_processing` and is skipped.
 *
 * The lock lives on its own connection, outside `pool`. processSession needs
 * both of the processing pool's two connections: one for its transaction and
 * one to record the outcome. Holding the lock on a pool connection left none
 * to record a timeout, so the session stayed 'processing' and the sweep
 * re-ran it every ten minutes (production, 2026-10-08).
 */
export async function sweepStuckSessions(
  pool: Pool,
  opts: {
    limit?: number;
    processFn?: typeof processSession;
    connectLock?: () => Promise<SweepLockClient>;
  } = {}
): Promise<{ swept: number; locked: boolean }> {
  const limit = opts.limit ?? 50;
  const process = opts.processFn ?? processSession;
  const lockClient = await (opts.connectLock ?? connectSweepLockClient)();
  let locked = false;
  try {
    const lock = await lockClient.query(
      "SELECT pg_try_advisory_lock($1) AS ok",
      [SWEEP_ADVISORY_LOCK_KEY]
    );
    locked = lock.rows[0]?.ok === true;
    if (!locked) return { swept: 0, locked: false };

    const { rows } = await pool.query(`${buildStuckSessionsSql()} LIMIT $1`, [limit]);
    let swept = 0;
    for (const row of rows as Array<{ id: string; user_id: string }>) {
      try {
        const r = await process(row.id, row.user_id, { pool });
        if (!r?.skipped) swept++;
      } catch (err) {
        if (!(err instanceof Error && err.message === "already_processing")) {
          console.error(`[sweep] failed for ${row.id}:`, err);
        }
      }
    }
    return { swept, locked: true };
  } finally {
    try {
      if (locked) {
        await lockClient.query("SELECT pg_advisory_unlock($1)", [SWEEP_ADVISORY_LOCK_KEY]);
      }
    } finally {
      await lockClient.close();
    }
  }
}

/**
 * Claim the oldest queued session: delete its row and return it with its
 * owner, in one statement. SKIP LOCKED gives concurrent drains different rows.
 */
export function buildClaimRematchSql(): string {
  return `DELETE FROM session_rematch_queue q
     USING tracking_sessions s
     WHERE q.session_id = (
         SELECT session_id FROM session_rematch_queue
         ORDER BY queued_at ASC, session_id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       AND s.id = q.session_id
     RETURNING q.session_id AS id, s.user_id`;
}

/**
 * Re-run processSession on sessions a catalog change queued: a destination
 * moved, changed type or owner, or a route was added, activated, reshaped or
 * retired (triggers in migrations/20261004_session_rematch_queue.sql). The
 * re-run is the whole update — it adds new reached destinations and routes,
 * drops auto rows that no longer match, and honors rejections.
 *
 * Called from the sweep, after sweepStuckSessions; at most `limit` sessions
 * and `budgetMs` of starts per call.
 *
 * Rows are claimed one at a time, and nothing holds a connection between
 * statements: processSession needs one connection for its transaction and the
 * second for its post-commit steps, and the processing pool has two. (A held
 * advisory-lock connection starved it in production.) A claimed row is gone
 * from the queue, so:
 *  - an edit made during the re-run queues the session again;
 *  - a re-run that fails marks the session 'failed', and one that dies leaves
 *    a stale 'processing' claim — sweepStuckSessions retries both;
 *  - a session a live run owns is queued again for the next sweep.
 */
export async function drainSessionRematchQueue(
  pool: Pool,
  opts: {
    limit?: number;
    budgetMs?: number;
    now?: () => number;
    processFn?: typeof processSession;
  } = {}
): Promise<{ rematched: number }> {
  const limit = opts.limit ?? 25;
  // The scheduler gives the whole sweep 180 s. Start no new re-match after
  // this much time, so a slow batch cannot push the request past it.
  const budgetMs = opts.budgetMs ?? 90_000;
  const now = opts.now ?? Date.now;
  const process = opts.processFn ?? processSession;
  const startedAt = now();
  let rematched = 0;

  for (let i = 0; i < limit && now() - startedAt < budgetMs; i++) {
    const { rows } = await pool.query(buildClaimRematchSql());
    const row = rows[0] as { id: string; user_id: string } | undefined;
    if (!row) break;
    try {
      await process(row.id, row.user_id, { force: true, pool });
      rematched++;
    } catch (err) {
      if (err instanceof Error && err.message === "already_processing") {
        await pool.query(
          `INSERT INTO session_rematch_queue (session_id, reason)
           VALUES ($1, 'retry:already_processing')
           ON CONFLICT (session_id) DO NOTHING`,
          [row.id]
        );
        continue;
      }
      console.error(`[rematch] failed for ${row.id}:`, err);
    }
  }
  return { rematched };
}

/**
 * Process a plan: match reached destinations against plans.path. Idempotent —
 * clears source='auto' rows first. Claims the plan with the same stale-recovery
 * guard as processSession so a poll racing the inline auto-process bails out
 * with `already_processing` rather than matching twice.
 *
 * plans.path is normally set by the create/update endpoint from client-supplied
 * geometry. If absent (a system-route plan), Step 0 assembles it from the
 * ordered route paths, after checking every referenced route.
 */
export async function processPlan(
  planId: string,
  userId: string,
  opts: { pool?: Pool; expectedSourceFingerprint?: string; expectedUpdatedAt?: string } = {}
): Promise<{ destinations_matched: number }> {
  const pool = opts.pool ?? db;
  const claim = await pool.query(
    `UPDATE plans p
     SET processing_state = 'processing',
         processing_error = NULL,
         processing_started_at = now()
     WHERE id = $1 AND user_id = $2
       AND ($3::text IS NULL OR ${planSourceFingerprintSql()}=$3)
       AND ($4::timestamptz IS NULL OR p.updated_at=$4)
       AND (processing_state IS DISTINCT FROM 'processing'
            OR processing_started_at IS NULL
            OR processing_started_at < now() - make_interval(mins => ${STALE_PROCESSING_MINUTES}))`,
    [planId, userId, opts.expectedSourceFingerprint ?? null, opts.expectedUpdatedAt ?? null]
  );
  if ((claim.rowCount ?? 0) === 0) {
    throw new Error("already_processing");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query("SELECT id FROM plans WHERE id=$1 AND user_id=$2 FOR UPDATE",[planId,userId]);

    // Hold the linked paths stable through matching. Recheck the repair source
    // after taking locks so a concurrent route edit cannot slip past the claim.
    await client.query(`SELECT r.id FROM routes r JOIN plan_routes pr ON pr.route_id=r.id
      WHERE pr.plan_id=$1 ORDER BY r.id FOR SHARE OF r`,[planId]);
    if (opts.expectedSourceFingerprint) {
      const check=await client.query(`SELECT ${planSourceFingerprintSql()} AS fingerprint FROM plans p WHERE p.id=$1`,[planId]);
      if (check.rows[0]?.fingerprint!==opts.expectedSourceFingerprint) throw new Error("Plan source changed during repair");
    }

    // Fail a partial migration or broken route link before replacing auto matches.
    const missing = await client.query(
      `SELECT pr.route_id FROM plan_routes pr LEFT JOIN routes r ON r.id=pr.route_id
       JOIN plans p ON p.id=pr.plan_id
       WHERE pr.plan_id=$1 AND (r.id IS NULL OR r.path IS NULL OR r.status NOT IN ('active','superseded')
         OR NOT (r.owner='peaks' OR r.owner=p.user_id))`, [planId]
    );
    if (missing.rows.length) throw new Error("Plan routes have missing or unavailable geometry: "
      + missing.rows.map(row => row.route_id).join(", "));

    // Preserve route order and gaps when the client did not supply geometry.
    await client.query(
      `UPDATE plans p
       SET path = sub.merged
       FROM (
         SELECT pr.plan_id,
                ST_Force2D(ST_Collect(r.path::geometry ORDER BY pr.ordinal))::geography AS merged
         FROM plan_routes pr
         JOIN routes r ON r.id = pr.route_id
         JOIN plans route_plan ON route_plan.id = pr.plan_id
         WHERE pr.plan_id = $1
           AND (r.owner = 'peaks' OR r.owner = route_plan.user_id)
         GROUP BY pr.plan_id
       ) sub
       WHERE p.id = $1 AND p.path IS NULL`,
      [planId]
    );

    const geometry = await client.query("SELECT path IS NOT NULL AS has_path FROM plans WHERE id=$1",[planId]);
    if (!geometry.rows[0]?.has_path) throw new Error("Plan has no geometry to match");

    // Step 1: clear previous auto-tags (idempotent re-processing). Never touches
    // user-chosen plan_destinations goals.
    await client.query(
      `DELETE FROM plan_reached_destinations WHERE plan_id = $1 AND source = 'auto'`,
      [planId]
    );

    // Step 2: destination matching, ordered along the path.
    const match = buildPlanDestinationMatchSql(planId);
    const result = await client.query(match.text, match.values);
    const destinationsMatched = result.rowCount ?? 0;

    // Step 3: materialize distance from the path if the client didn't provide it.
    await client.query(
      `UPDATE plans SET distance = COALESCE(distance, ST_Length(path))
       WHERE id = $1 AND path IS NOT NULL`,
      [planId]
    );

    // Step 4: mark completed.
    await client.query(
      `UPDATE plans
       SET processed_at = NOW(), processing_state = 'completed', processing_error = NULL
       WHERE id = $1`,
      [planId]
    );

    await client.query("COMMIT");
    return { destinations_matched: destinationsMatched };
  } catch (err) {
    await client.query("ROLLBACK");
    const message = err instanceof Error ? err.message.slice(0, 500) : "Unknown processing error";
    await pool.query(
      `UPDATE plans SET processing_state = 'failed', processing_error = $2 WHERE id = $1`,
      [planId, message]
    );
    throw err;
  } finally {
    client.release();
  }
}
