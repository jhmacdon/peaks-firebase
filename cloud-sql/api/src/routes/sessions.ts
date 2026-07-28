import { Router, Request, Response } from "express";
import { PoolClient } from "pg";
import { getUid } from "../auth";
import db from "../db";
import {
  buildCompleteRouteEffortCurves,
  buildEffortCurves,
  buildPairModel,
  loadSampledTrack,
  orientComparison,
  shapeComparisonList,
} from "../comparisons";
import { COMPARISON_LIST_CAP, FULL_ROUTE_FRAC } from "../comparison-params";
import {
  generateId,
  processSession,
  recomputeDestinationAverages,
  STALE_PROCESSING_MINUTES,
} from "../processing";
import { mergeHealthData, mergeSourceContributions } from "../session-enrichment";
import { notifySessionProcessed } from "../slack";
import { streamQueryAsJsonArray } from "../lib/stream-json";
import {
  ConcurrencyLimiter,
  HEAVY_INFLIGHT_CAP,
  perUserConcurrencyGuard,
} from "../lib/rate-guard";

const router = Router();
const PROCESSING_STATES = ["idle", "pending", "processing", "completed", "failed"] as const;

// Per-user in-flight cap on the heavy write/process endpoints (create session,
// upload points, process). One shared limiter per process; a single account
// can hold at most HEAVY_INFLIGHT_CAP concurrent heavy requests on this
// instance before further ones get 429'd. The cap is derived to sit one below
// the DB pool size so one account can never exhaust the pool. See
// lib/rate-guard.ts.
const heavyWriteLimiter = new ConcurrencyLimiter(HEAVY_INFLIGHT_CAP);
const heavyWriteGuard = perUserConcurrencyGuard(heavyWriteLimiter);

// `boundary` is included as GeoJSON so iOS can compute point-to-polygon
// distance (Destination.distance(to:) prefers boundary over centroid). Without
// it, large polygon destinations like lakes — where the user's GPS track
// follows the shoreline rather than the centroid — get dropped from
// timeline rendering even though they're correctly stored as reached.
const DESTINATIONS_REACHED_SQL = `COALESCE(
  (SELECT json_agg(json_build_object(
    'id', d.id, 'name', d.name, 'elevation', d.elevation,
    'features', d.features,
    'lat', ST_Y(d.location::geometry),
    'lng', ST_X(d.location::geometry),
    'boundary', CASE WHEN d.boundary IS NOT NULL
                     THEN ST_AsGeoJSON(d.boundary)::json END,
    'source', sd.source
  ) ORDER BY d.name, d.id)
  FROM session_destinations sd
  JOIN destinations d ON d.id = sd.destination_id
  WHERE sd.session_id = s.id AND sd.relation = 'reached'),
  '[]'::json
)`;

const DESTINATION_GOALS_SQL = `COALESCE(
  (SELECT json_agg(json_build_object(
    'id', d.id, 'name', d.name, 'elevation', d.elevation,
    'features', d.features,
    'lat', ST_Y(d.location::geometry),
    'lng', ST_X(d.location::geometry),
    'boundary', CASE WHEN d.boundary IS NOT NULL
                     THEN ST_AsGeoJSON(d.boundary)::json END,
    'source', sd.source
  ) ORDER BY d.name, d.id)
  FROM session_destinations sd
  JOIN destinations d ON d.id = sd.destination_id
  WHERE sd.session_id = s.id AND sd.relation = 'goal'),
  '[]'::json
)`;

export const SESSION_ROUTES_SQL = `COALESCE(
  (SELECT json_agg(json_build_object(
    'id', r.id, 'name', r.name, 'polyline6', r.polyline6,
    'distance', r.distance, 'gain', r.gain, 'gain_loss', r.gain_loss,
    'provenance', r.provenance,
    'source', sr.source, 'coverage', sr.coverage
  ) ORDER BY r.name, r.id)
  FROM session_routes sr
  JOIN routes r ON r.id = sr.route_id
  WHERE sr.session_id = s.id AND r.status = 'active'),
  '[]'::json
)`;

/** Inline protected areas crossed by one saved session track. */
export const SESSION_AREAS_SQL = `COALESCE(
  (SELECT json_agg(area_obj ORDER BY kind, name)
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
              'relation', sa.relation,
              'source', sa.source
            ) AS area_obj
     FROM session_areas sa
     JOIN areas a ON a.id = sa.area_id
     WHERE sa.session_id = s.id
     ORDER BY a.kind, a.name, a.designation DESC NULLS LAST, a.id
   ) deduped),
  '[]'::json
)`;

/** Build the owner/public-scoped area lookup for a saved session track. */
export function buildSessionAreasQuery(
  id: string,
  uid: string
): { text: string; values: unknown[] } {
  return {
    text: `SELECT s.id, ${SESSION_AREAS_SQL} AS areas
     FROM tracking_sessions s
     WHERE s.id = $1 AND (s.user_id = $2 OR s.is_public = true)`,
    values: [id, uid],
  };
}

/** Build a session detail query that keeps owner-only import and health data private. */
export function buildSessionDetailQuery(
  id: string,
  uid: string
): { text: string; values: unknown[] } {
  return {
    text: `SELECT s.id,
            CASE WHEN s.user_id = $2 THEN s.user_id ELSE '' END AS user_id,
            s.name, s.start_time, s.end_time,
            s.distance, s.total_time, s.pace, s.gain, s.highest_point,
            s.ascent_time, s.descent_time, s.still_time,
            s.activity_type,
            CASE WHEN s.user_id = $2 THEN s.source ELSE NULL END AS source,
            CASE WHEN s.user_id = $2 THEN s.external_id ELSE NULL END AS external_id,
            CASE WHEN s.user_id = $2 THEN s.health_data ELSE NULL END AS health_data,
            CASE WHEN s.user_id = $2
                 THEN s.source_contributions
                 ELSE '[]'::jsonb
            END AS source_contributions,
            CASE WHEN s.user_id = $2 THEN s.group_id ELSE NULL END AS group_id,
            CASE WHEN s.user_id = $2
                 THEN s.attempt_group_id
                 ELSE NULL
            END AS attempt_group_id,
            s.processed_at, s.processing_state,
            CASE WHEN s.user_id = $2
                 THEN s.processing_error
                 ELSE NULL
            END AS processing_error,
            s.ended, s.is_public,
            s.created_at, s.updated_at, s.server_updated_at,
            ${DESTINATIONS_REACHED_SQL} AS destinations_reached,
            ${DESTINATION_GOALS_SQL} AS destination_goals,
            ${SESSION_ROUTES_SQL} AS routes,
            ${SESSION_AREAS_SQL} AS areas
     FROM tracking_sessions s
     WHERE s.id = $1 AND (s.user_id = $2 OR s.is_public = true)`,
    values: [id, uid],
  };
}

function parseLimit(raw: unknown, fallback = 200, max = 1000): number {
  const parsed = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function parseOffset(raw: unknown): number {
  const parsed = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function parseUpdatedSince(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("updated_since must be a valid ISO-8601 timestamp");
  }

  return parsed.toISOString();
}

function parseProcessingStates(raw: unknown): string[] | null {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }

  const states = raw
    .split(",")
    .map((state) => state.trim())
    .filter((state) => state.length > 0);

  if (states.length === 0) {
    return null;
  }

  const invalid = states.filter(
    (state) => !PROCESSING_STATES.includes(state as typeof PROCESSING_STATES[number])
  );
  if (invalid.length > 0) {
    throw new Error(`Invalid processing_state value: ${invalid.join(", ")}`);
  }

  return states;
}

function jsonbParam(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/**
 * Inline auto-process a session that markSessionPendingIfReady just queued.
 * Runs synchronously so the response carries the final processing_state — iOS
 * doesn't have to poll for the typical case. Maps the concurrency-guard race
 * (`already_processing` thrown by processSession) and any other failure to a
 * non-throwing string so the surrounding handler can still respond 200.
 */
async function autoProcessIfQueued(
  queued: boolean,
  sessionId: string,
  uid: string
): Promise<string | null> {
  if (!queued) return null;
  try {
    const result = await processSession(sessionId, uid);
    notifySessionProcessed(
      sessionId,
      uid,
      result.destinations_matched,
      result.routes_matched
    ).catch((err) => console.error("Slack notify failed:", err));
    return "completed";
  } catch (err) {
    if (err instanceof Error && err.message === "already_processing") {
      return "processing";
    }
    console.error("Auto-processing failed for session", sessionId, err);
    return "failed";
  }
}

async function markSessionPendingIfReady(client: PoolClient, sessionId: string): Promise<boolean> {
  const result = await client.query(
    `UPDATE tracking_sessions s
     SET processing_state = 'pending',
         processing_error = NULL
     WHERE s.id = $1
       AND s.ended = true
       AND (s.processing_state <> 'processing'
            OR s.processing_started_at IS NULL
            OR s.processing_started_at < now() - make_interval(mins => ${STALE_PROCESSING_MINUTES}))
       AND EXISTS (
         SELECT 1
         FROM tracking_points tp
         WHERE tp.session_id = s.id
       )
     RETURNING id`,
    [sessionId]
  );

  return (result.rowCount ?? 0) > 0;
}

async function touchSession(client: PoolClient, sessionId: string): Promise<void> {
  await client.query(
    `UPDATE tracking_sessions
     SET server_updated_at = NOW()
     WHERE id = $1`,
    [sessionId]
  );
}

/**
 * Reconcile the client-supplied reached/goal destinations for a session.
 *
 * CRITICAL: only client-owned ('manual') rows are deleted here — server
 * auto-detected rows ('auto', written by processSession.matchDestinations) are
 * NEVER touched by a client write. iOS `TrackingSession.toAPIBody()` resends its
 * local `destinations_reached` on every create/update PUT; before this scoping a
 * stale/empty local list would `DELETE` the whole set and permanently wipe an
 * auto-detected summit (the "imported climb shows no peak" bug). Reinserts use
 * `ON CONFLICT DO NOTHING` so a dest already present as 'auto' stays 'auto'.
 *
 * CRITICAL, second half: the delete is scoped PER RELATION, and only fires for a
 * list the caller actually supplied. `reached` supplied replaces the manual
 * reached set and leaves goals alone; `goals` supplied replaces the manual goal
 * set and leaves reaches alone; an absent list touches nothing. A blanket
 * `DELETE ... source = 'manual'` meant a body that mentioned neither — say a
 * `{rejected: [...]}` post to the destinations endpoint — silently wiped every
 * manual row on the session.
 *
 * CRITICAL, third half: a `reached` id the user has REJECTED is skipped, and no
 * path here ever clears a veto. The same iOS habit that caused the first bug —
 * resending the local `destinations_reached` on every create/update — means that
 * list goes stale the moment a rejection happens on another device, or on this
 * one before the next sync. Honouring it would put the summit straight back on
 * the next routine PUT and the rejection would look like it never took. This is
 * the fifth writer of 'reached' rows and it anti-joins like the other four.
 * Un-rejecting is an explicit `unreject` list on the destinations endpoint, never
 * an inference from `reached` — see applyDestinationRejections.
 *
 * Goals are not filtered. A rejection says "I did not reach this", which does not
 * contradict "this was my goal" — the attempt still happened, and no matcher
 * reads goal rows.
 */
export async function reconcileClientDestinations(
  client: PoolClient,
  sessionId: string,
  reached: string[] | undefined,
  goals: string[] | undefined
): Promise<void> {
  if (Array.isArray(reached)) {
    await client.query(
      `DELETE FROM session_destinations
       WHERE session_id = $1 AND source = 'manual' AND relation = 'reached'`,
      [sessionId]
    );
    for (const destId of cleanDestinationIds(reached)) {
      await client.query(
        `INSERT INTO session_destinations (session_id, destination_id, relation, source)
         SELECT $1, $2, 'reached', 'manual'
         WHERE NOT EXISTS (
           SELECT 1 FROM session_destination_rejections r
           WHERE r.session_id = $1 AND r.destination_id = $2
         )
         ON CONFLICT DO NOTHING`,
        [sessionId, destId]
      );
    }
  }

  if (Array.isArray(goals)) {
    await client.query(
      `DELETE FROM session_destinations
       WHERE session_id = $1 AND source = 'manual' AND relation = 'goal'`,
      [sessionId]
    );
    for (const destId of cleanDestinationIds(goals)) {
      await client.query(
        `INSERT INTO session_destinations (session_id, destination_id, relation, source)
         VALUES ($1, $2, 'goal', 'manual') ON CONFLICT DO NOTHING`,
        [sessionId, destId]
      );
    }
  }
}

/**
 * Destination ids the session currently counts as reached.
 *
 * Snapshot this BEFORE any write that can remove a reached row, and feed it to
 * recomputeDestinationAverages afterwards. A removed row has to stop being
 * counted, and the request that removes it usually does not name it:
 * reconcileClientDestinations replaces the session's whole manual set, so
 * dropping an id from `destinations_reached` deletes its row silently, and
 * DELETE /:id cascades every row away at once. Once the row is gone nothing can
 * work out which destination to recompute, so the read has to happen first.
 */
async function reachedDestinationIds(
  client: PoolClient,
  sessionId: string
): Promise<string[]> {
  const res = await client.query(
    `SELECT destination_id FROM session_destinations
     WHERE session_id = $1 AND relation = 'reached'`,
    [sessionId]
  );
  return res.rows.map((r: { destination_id: string }) => r.destination_id);
}

/** Non-empty strings only — the client sends whatever its local list holds. */
function cleanDestinationIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter((d): d is string => typeof d === "string" && d.length > 0);
}

/**
 * Destination ids two of a request's lists both name.
 *
 * "I reached it" and "I didn't reach it" in the same breath is a client bug, so
 * the handler answers 400 instead of picking a winner: any precedence rule here
 * would silently discard half of what the client asked for, and the client would
 * never learn its state is confused. Used for both contradictions the
 * destinations endpoint can receive — `reached` against `rejected`, and
 * `unreject` against `rejected`.
 */
export function overlappingDestinationIds(a: unknown, b: unknown): string[] {
  const bSet = new Set(cleanDestinationIds(b));
  return [...new Set(cleanDestinationIds(a).filter((d) => bSet.has(d)))];
}

/**
 * Apply the client's destination rejections ("I didn't actually summit this")
 * and un-rejections.
 *
 * A rejection has two halves that must move together:
 *  - a row in session_destination_rejections, which every auto-matcher
 *    anti-joins, so re-processing, a newly created destination, a boundary edit
 *    and the web backfill can never re-add the pair; and
 *  - deletion of the live 'reached' row WHATEVER its source — an auto row would
 *    otherwise sit there until the next re-process, and a manual row the user is
 *    retracting has to go too. A 'goal' row for the same destination is left
 *    standing; see the comment on that DELETE.
 *
 * Un-rejecting is driven by an EXPLICIT list and nothing else. Inferring it from
 * `reached` was a trap in both directions: a client replaying a stale reached
 * list would have silently dropped a veto, and a caller of this function (B4's
 * averages recompute among them) could clear vetoes it never meant to touch by
 * passing the session's current reaches. Un-rejecting an id that carries no veto
 * is a no-op. Callers must refuse a request naming the same id in `rejected` and
 * in either other list (see overlappingDestinationIds), so the two legs below can
 * never contend for the same pair.
 *
 * Rejections for unknown destination ids are dropped rather than raising an FK
 * violation, mirroring the plan_routes existence guard in routes/plans.ts.
 *
 * Returns the ids actually rejected and actually un-rejected — "actually" because
 * both come from RETURNING, so the caller can recompute exactly the destinations
 * whose averages moved (processSession's own recompute never sees the rejected
 * ones — their rows are already gone from session_destinations by then) and can
 * skip the sync bump when a request changed nothing.
 */
export async function applyDestinationRejections(
  client: PoolClient,
  sessionId: string,
  unreject: string[] | undefined,
  rejected: string[] | undefined
): Promise<{ rejected: string[]; unrejected: string[] }> {
  const toUnreject = cleanDestinationIds(unreject);
  let unrejected: string[] = [];
  if (toUnreject.length > 0) {
    const cleared = await client.query(
      `DELETE FROM session_destination_rejections
       WHERE session_id = $1 AND destination_id = ANY($2::text[])
       RETURNING destination_id`,
      [sessionId, toUnreject]
    );
    unrejected = cleared.rows.map((r: { destination_id: string }) => r.destination_id);
  }

  const toReject = cleanDestinationIds(rejected);
  if (toReject.length === 0) {
    return { rejected: [], unrejected };
  }

  const inserted = await client.query(
    `INSERT INTO session_destination_rejections (session_id, destination_id, rejected_at)
     SELECT $1, ids.d, now()
     FROM unnest($2::text[]) AS ids(d)
     WHERE EXISTS (SELECT 1 FROM destinations WHERE id = ids.d)
     ON CONFLICT (session_id, destination_id)
     DO UPDATE SET rejected_at = EXCLUDED.rejected_at
     RETURNING destination_id`,
    [sessionId, toReject]
  );

  // relation = 'reached' only. A rejection asserts "I did not reach this
  // destination" — it says nothing about whether the user meant to. Deleting a
  // 'goal' row here would throw away the intent along with the false credit, and
  // "aimed for it, didn't summit it" is an ordinary outcome worth keeping. The
  // two rows coexist by design: the goal records the plan, the veto stops every
  // matcher handing back a reach. B4's recompute counts reached rows only, so
  // leaving the goal alone keeps rejections from perturbing goal-derived reads.
  await client.query(
    `DELETE FROM session_destinations
     WHERE session_id = $1 AND destination_id = ANY($2::text[])
       AND relation = 'reached'`,
    [sessionId, toReject]
  );

  return {
    rejected: inserted.rows.map((r: { destination_id: string }) => r.destination_id),
    unrejected,
  };
}

function buildPointInsertQuery(sessionId: string, points: any[]) {
  const values: any[] = [];
  const placeholders: string[] = [];
  let parameterIndex = 1;

  for (const point of points) {
    if (point.lat == null || point.lng == null || point.time == null) {
      continue;
    }

    const elevation = point.elevation ?? 0;

    placeholders.push(
      `($${parameterIndex}, $${parameterIndex + 1}, $${parameterIndex + 2}, ` +
      `ST_SetSRID(ST_MakePoint($${parameterIndex + 4}, $${parameterIndex + 3}, $${parameterIndex + 5}), 4326)::geography, ` +
      `$${parameterIndex + 5}, $${parameterIndex + 6}, $${parameterIndex + 7}, $${parameterIndex + 8}, $${parameterIndex + 9})`
    );

    values.push(
      sessionId,
      point.time,
      point.segment_number ?? point.segmentNumber ?? 0,
      point.lat,
      point.lng,
      elevation,
      point.speed ?? null,
      point.azimuth ?? null,
      point.hdop ?? null,
      point.speed_accuracy ?? point.speedAccuracy ?? null
    );

    parameterIndex += 10;
  }

  return { values, placeholders };
}

// GET /api/sessions — current user's sessions with inline destinations
router.get("/", async (req, res: Response) => {
  const uid = getUid(req);
  const limit = parseLimit(req.query.limit);
  const offset = parseOffset(req.query.offset);

  let processingStates: string[] | null;
  try {
    processingStates = parseProcessingStates(req.query.processing_state);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const result = await db.query(
    `SELECT s.id, s.user_id, s.name, s.start_time, s.end_time,
            s.distance, s.total_time, s.pace, s.gain, s.highest_point,
            s.ascent_time, s.descent_time, s.still_time,
            s.activity_type, s.source, s.external_id,
            s.health_data, s.source_contributions,
            s.group_id, s.attempt_group_id,
            s.processed_at, s.processing_state, s.processing_error,
            s.ended, s.is_public,
            s.created_at, s.updated_at, s.server_updated_at,
            ${DESTINATIONS_REACHED_SQL} AS destinations_reached,
            ${DESTINATION_GOALS_SQL} AS destination_goals,
            ${SESSION_AREAS_SQL} AS areas
     FROM tracking_sessions s
     WHERE s.user_id = $1
       AND ($2::text[] IS NULL OR s.processing_state = ANY($2))
     ORDER BY s.start_time DESC
     LIMIT $3 OFFSET $4`,
    [uid, processingStates, limit, offset]
  );
  res.json(result.rows);
});

// GET /api/sessions/changes — incremental session sync feed
router.get("/changes", async (req, res: Response) => {
  const uid = getUid(req);
  const limit = parseLimit(req.query.limit);
  const afterId =
    typeof req.query.after_id === "string" && req.query.after_id.trim() !== ""
      ? req.query.after_id
      : null;

  let updatedSince: string | null;
  try {
    updatedSince = parseUpdatedSince(req.query.updated_since);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  if (afterId && !updatedSince) {
    res.status(400).json({ error: "after_id requires updated_since" });
    return;
  }

  const result = await db.query(
    `WITH changed_sessions AS (
        SELECT
          s.id,
          'upsert'::text AS change_type,
          s.server_updated_at,
          NULL::timestamptz AS deleted_at,
          json_build_object(
            'id', s.id,
            'user_id', s.user_id,
            'name', s.name,
            'start_time', s.start_time,
            'end_time', s.end_time,
            'distance', s.distance,
            'total_time', s.total_time,
            'pace', s.pace,
            'gain', s.gain,
            'highest_point', s.highest_point,
            'ascent_time', s.ascent_time,
            'descent_time', s.descent_time,
            'still_time', s.still_time,
            'activity_type', s.activity_type,
            'source', s.source,
            'external_id', s.external_id,
            'health_data', s.health_data,
            'source_contributions', s.source_contributions,
            'group_id', s.group_id,
            'attempt_group_id', s.attempt_group_id,
            'processed_at', s.processed_at,
            'processing_state', s.processing_state,
            'processing_error', s.processing_error,
            'ended', s.ended,
            'is_public', s.is_public,
            'created_at', s.created_at,
            'updated_at', s.updated_at,
            'server_updated_at', s.server_updated_at,
            'destinations_reached', ${DESTINATIONS_REACHED_SQL},
            'destination_goals', ${DESTINATION_GOALS_SQL},
            'routes', ${SESSION_ROUTES_SQL},
            'areas', ${SESSION_AREAS_SQL}
          ) AS session
        FROM tracking_sessions s
        WHERE s.user_id = $1
          AND (
            $2::timestamptz IS NULL
            OR s.server_updated_at > $2
            OR (s.server_updated_at = $2 AND $3::text IS NOT NULL AND s.id > $3)
          )
    ),
    changed_deletions AS (
        SELECT
          st.session_id AS id,
          'delete'::text AS change_type,
          st.server_updated_at,
          st.deleted_at,
          NULL::json AS session
        FROM session_tombstones st
        WHERE st.user_id = $1
          AND (
            $2::timestamptz IS NULL
            OR st.server_updated_at > $2
            OR (st.server_updated_at = $2 AND $3::text IS NOT NULL AND st.session_id > $3)
          )
    )
    SELECT id, change_type, server_updated_at, deleted_at, session
    FROM (
      SELECT * FROM changed_sessions
      UNION ALL
      SELECT * FROM changed_deletions
    ) changes
    ORDER BY server_updated_at ASC, id ASC
    LIMIT $4`,
    [uid, updatedSince, afterId, limit]
  );

  const changes = result.rows.map((row) => ({
    id: row.id,
    change_type: row.change_type,
    server_updated_at: row.server_updated_at,
    deleted_at: row.deleted_at,
    session: row.session,
  }));

  const last = result.rows[result.rows.length - 1];
  res.json({
    changes,
    next_cursor: last
      ? {
          updated_since: last.server_updated_at,
          after_id: last.id,
        }
      : null,
    has_more: result.rows.length === limit,
  });
});

// GET /api/sessions/dedup — check if session already imported
router.get("/dedup", async (req, res: Response) => {
  const uid = getUid(req);
  const source = req.query.source as string;
  const externalId = req.query.externalId as string;

  if (!source || !externalId) {
    res.status(400).json({ error: "source and externalId are required" });
    return;
  }

  const result = await db.query(
    `SELECT id FROM tracking_sessions
     WHERE user_id = $1 AND source = $2 AND external_id = $3`,
    [uid, source, externalId]
  );
  res.json({ exists: result.rows.length > 0, sessionId: result.rows[0]?.id || null });
});

// Parse the comma-separated `ids` query param for the batch status endpoint:
// trim, drop empties, dedupe preserving first-seen order, and cap the count so
// a runaway client can't ask for an unbounded `id = ANY(...)`. Pure + exported
// for unit testing.
export function parseStatusIds(raw: unknown, max = 200): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

// Minimal structural type so the handler can take an injected pool in tests
// without depending on the concrete pg Pool.
interface StatusQueryable {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}

// GET /api/sessions/processing-status?ids=a,b,c — batch poll for processing
// state. Returns ONLY the scalar processing fields for the requested sessions
// (owned by the caller) in a single query — deliberately WITHOUT the expensive
// destinations/routes/goals subqueries that GET /:id runs. iOS polls this once
// per tick instead of firing one heavy GET /:id per pending session, which is
// what saturated the connection pool and 503'd the whole API.
export async function handleProcessingStatus(
  req: Request,
  res: Response,
  pool: StatusQueryable = db
): Promise<void> {
  const uid = getUid(req);
  const ids = parseStatusIds(req.query.ids);
  if (ids.length === 0) {
    res.status(400).json({ error: "ids query parameter required" });
    return;
  }

  const result = await pool.query(
    `SELECT id, processing_state, processing_error, processed_at, server_updated_at
     FROM tracking_sessions
     WHERE user_id = $1 AND id = ANY($2)`,
    [uid, ids]
  );
  res.json(result.rows);
}

router.get("/processing-status", (req, res: Response) => handleProcessingStatus(req, res));

// GET /api/sessions/:id
router.get("/:id", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  // Inline destinations and routes match the shape returned by /changes and /api/sessions
  // so iOS pollProcessingSessions doesn't wipe locally-known destinations on every refresh.
  const query = buildSessionDetailQuery(id, uid);
  const result = await db.query(query.text, query.values);
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(result.rows[0]);
});

// GET /api/sessions/:id/areas — areas crossed by the saved GPS path
router.get("/:id/areas", async (req, res: Response) => {
  const uid = getUid(req);
  const query = buildSessionAreasQuery(req.params.id, uid);
  const result = await db.query(query.text, query.values);
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(result.rows[0].areas);
});

// GET /api/sessions/:id/points — GPS breadcrumbs
router.get("/:id/points", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  // Verify ownership or public access
  const session = await db.query(
    `SELECT id FROM tracking_sessions WHERE id = $1 AND (user_id = $2 OR is_public = true)`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Stream the (unbounded) point set with a server-side cursor instead of
  // buffering every row + a full JSON copy in memory. Output is byte-identical
  // to res.json(rows). Ownership check above already ran and can still 404/500.
  await streamQueryAsJsonArray(
    res,
    db,
    `SELECT time, segment_number, elevation, speed, azimuth,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng
     FROM tracking_points
     WHERE session_id = $1
     ORDER BY time`,
    [id]
  );
});

// GET /api/sessions/:id/elevation — elevation profile by time
router.get("/:id/elevation", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  const session = await db.query(
    `SELECT id FROM tracking_sessions WHERE id = $1 AND (user_id = $2 OR is_public = true)`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Stream the (unbounded) elevation profile with a server-side cursor instead
  // of buffering every row + a full JSON copy in memory. Output is byte-identical
  // to res.json(rows). Ownership check above already ran and can still 404/500.
  await streamQueryAsJsonArray(
    res,
    db,
    `SELECT time, elevation, speed
     FROM tracking_points
     WHERE session_id = $1
     ORDER BY time`,
    [id]
  );
});

// GET /api/sessions/:id/destinations
router.get("/:id/destinations", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            CASE WHEN d.boundary IS NOT NULL
                 THEN ST_AsGeoJSON(d.boundary)::json END AS boundary,
            sd.relation, sd.source
     FROM destinations d
     JOIN session_destinations sd ON sd.destination_id = d.id
     JOIN tracking_sessions s ON s.id = sd.session_id
     WHERE sd.session_id = $1
       AND (s.user_id = $2 OR s.is_public = true)`,
    [id, uid]
  );
  res.json(result.rows);
});

// GET /api/sessions/:id/routes
router.get("/:id/routes", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const result = await db.query(
    `SELECT r.id, r.name, r.polyline6,
            r.distance, r.gain, r.gain_loss, r.provenance,
            sr.source, sr.coverage
     FROM routes r
     JOIN session_routes sr ON sr.route_id = r.id
     JOIN tracking_sessions s ON s.id = sr.session_id
     WHERE sr.session_id = $1
       AND (s.user_id = $2 OR s.is_public = true)
       AND r.status = 'active'`,
    [id, uid]
  );
  res.json(result.rows);
});

// GET /api/sessions/:id/comparisons/:otherId — effort curves for the race
// chart. Recomputes the (2-session, bounded) checkpoint model on demand
// instead of storing curves in pair rows. Owner-only, and the pair row must
// exist (the matcher is the source of truth for WHICH pairs are comparable).
// Guarded by heavyWriteGuard: this route materializes two full point sets per
// request (loadSampledTrack × 2), the same pool/memory budget concern as the
// heavy write endpoints (OOM-regression class — see rate-guard.ts).
router.get("/:id/comparisons/:otherId", heavyWriteGuard, async (req: Request<{ id: string; otherId: string }>, res: Response) => {
  const uid = getUid(req);
  const { id, otherId } = req.params;

  const pair = await db.query(
    `SELECT sc.*,
            o.id AS other_id, o.name AS other_name, o.start_time AS other_start_time,
            o.distance AS other_distance, o.total_time AS other_total_time
     FROM session_comparisons sc
     JOIN tracking_sessions o ON o.id = $3
     WHERE sc.user_id = $2
       AND ((sc.session_a = $1 AND sc.session_b = $3)
         OR (sc.session_a = $3 AND sc.session_b = $1))`,
    [id, uid, otherId]
  );
  if (pair.rows.length === 0) {
    res.status(404).json({ error: "Comparison not found" });
    return;
  }
  const row = pair.rows[0];

  // Corridor is always session_a's — load in canonical order.
  const aSamples = await loadSampledTrack(db, row.session_a);
  const bSamples = await loadSampledTrack(db, row.session_b);
  const storedFullRoute = row.a_frac >= FULL_ROUTE_FRAC && row.b_frac >= FULL_ROUTE_FRAC;
  const model = storedFullRoute ? null : buildPairModel(aSamples, bSamples);
  if (!storedFullRoute && !model) {
    res.status(410).json({ error: "Comparison no longer computable" });
    return;
  }

  const aWindow = {
    enterMs: row.a_enter_ms,
    exitMs: row.a_exit_ms,
    startM: row.a_start_m,
    endM: row.a_end_m,
    outAndBack: row.a_out_and_back,
  };
  const bWindow = {
    enterMs: row.b_enter_ms,
    exitMs: row.b_exit_ms,
    startM: row.b_start_m,
    endM: row.b_end_m,
    outAndBack: row.b_out_and_back,
  };
  const curves = storedFullRoute
    ? buildCompleteRouteEffortCurves(aSamples, bSamples, aWindow, bWindow)
    : buildEffortCurves(model!);
  const thisIsA = row.session_a === id;
  const oriented = orientComparison(row, id);

  // Apex station: summit arrival mapped to corridor meters via the stored
  // arrival time's nearest station on this side's curve.
  let apexM: number | null = null;
  const arrivalMs = thisIsA ? row.a_arrival_ms : row.b_arrival_ms;
  const enterMs = thisIsA ? row.a_enter_ms : row.b_enter_ms;
  if (arrivalMs !== null && arrivalMs !== undefined) {
    const arrivalS = (arrivalMs - enterMs) / 1000;
    let best = Infinity;
    for (const st of curves.stations) {
      const sideS = thisIsA ? st.a_s : st.b_s;
      if (Math.abs(sideS - arrivalS) < best) {
        best = Math.abs(sideS - arrivalS);
        apexM = thisIsA ? (st.a_m ?? st.m) : (st.b_m ?? st.m);
      }
    }
  }

  res.json({
    ...oriented,
    curves: {
      apex_m: apexM,
      stations: curves.stations.map((st) => ({
        m: thisIsA ? (st.a_m ?? st.m) : (st.b_m ?? st.m),
        this_s: thisIsA ? st.a_s : st.b_s,
        other_s: thisIsA ? st.b_s : st.a_s,
        elev_m: thisIsA ? (st.a_elev_m ?? st.elev_m) : (st.b_elev_m ?? st.elev_m),
      })),
    },
  });
});

// GET /api/sessions/:id/comparisons — "Your Efforts": this session vs the
// owner's PRIOR overlapping sessions. Owner-only: comparisons reference the
// owner's other (possibly private) sessions, so is_public does NOT grant
// access. Prior-only: other side must have started before this session.
router.get("/:id/comparisons", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  const own = await db.query(
    `SELECT id, start_time FROM tracking_sessions WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (own.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const result = await db.query(
    `SELECT sc.*,
            o.id AS other_id, o.name AS other_name, o.start_time AS other_start_time,
            o.distance AS other_distance, o.total_time AS other_total_time
     FROM session_comparisons sc
     JOIN tracking_sessions s ON s.id = $1
     JOIN tracking_sessions o
       ON o.id = CASE WHEN sc.session_a = $1 THEN sc.session_b ELSE sc.session_a END
     WHERE (sc.session_a = $1 OR sc.session_b = $1)
       AND sc.user_id = $2
       AND o.start_time < s.start_time`,
    [id, uid]
  );

  res.json({
    session_id: id,
    comparisons: shapeComparisonList(result.rows, id, COMPARISON_LIST_CAP),
  });
});

// GET /api/sessions/:id/markers
router.get("/:id/markers", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const result = await db.query(
    `SELECT sm.id, sm.name, sm.image,
            CASE WHEN s.user_id = $2 THEN sm.created_by ELSE NULL END AS created_by,
            sm.created_at,
            ST_Y(sm.location::geometry) AS lat,
            ST_X(sm.location::geometry) AS lng,
            ST_Z(sm.location::geometry) AS elevation
     FROM session_markers sm
     JOIN tracking_sessions s ON s.id = sm.session_id
     WHERE sm.session_id = $1
       AND (s.user_id = $2 OR s.is_public = true)
     ORDER BY sm.created_at`,
    [id, uid]
  );
  res.json(result.rows);
});

// Candidate-selection SQL for process-all (param $1 = user_id). Drains pending
// + failed AND stale 'processing' claims. Sessions claimed during a storm whose
// process step died (Cloud Run killed the worker, pool 503) wedge at
// 'processing' forever: process-all used to skip them and nothing else
// re-triggers them (the points endpoint only fires on NEW points, which old
// sessions never get). A claim older than STALE_PROCESSING_MINUTES is dead, so
// include it — processSession's claim re-acquires a stale row and completes it,
// while a genuinely-live run (fresh claim) still throws already_processing and
// is skipped. Exported so the predicate is unit-testable without a DB.
export function buildProcessAllCandidateSql(): string {
  return `SELECT s.id FROM tracking_sessions s
     WHERE s.user_id = $1
       AND s.ended = true
       AND (
         s.processing_state IN ('pending', 'failed')
         OR (s.processing_state = 'processing'
             AND (s.processing_started_at IS NULL
                  OR s.processing_started_at < now() - make_interval(mins => ${STALE_PROCESSING_MINUTES})))
       )
       AND EXISTS (SELECT 1 FROM tracking_points tp WHERE tp.session_id = s.id)
     ORDER BY s.server_updated_at ASC, s.id ASC`;
}

// POST /api/sessions/process-all — batch process all unprocessed sessions for this user
router.post("/process-all", async (req, res: Response) => {
  const uid = getUid(req);

  const unprocessed = await db.query(buildProcessAllCandidateSql(), [uid]);

  let skipped = 0;
  const results: Array<{ id: string; destinations: number; routes: number }> = [];
  for (const row of unprocessed.rows) {
    try {
      const result = await processSession(row.id, uid);
      if (result.skipped) {
        skipped++;
      } else {
        results.push({
          id: row.id,
          destinations: result.destinations_matched,
          routes: result.routes_matched,
        });
      }
    } catch (err) {
      console.error(`Failed to process session ${row.id}:`, err);
    }
  }

  res.json({ processed: results.length, skipped, candidates: unprocessed.rows.length });
});

// POST /api/sessions/:id/process — trigger server-side session processing
router.post("/:id/process", heavyWriteGuard, async (req: Request<{ id: string }>, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  // Verify ownership
  const session = await db.query(
    `SELECT id, ended, processing_state
     FROM tracking_sessions
     WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const force = req.query.force === "true";

  // Fast idempotent path: an already-completed session is not re-processed
  // unless forced. Returns before even the point-count query, so a re-process
  // storm against finished sessions costs one cheap SELECT instead of the full
  // PostGIS matching that was 503-ing the API.
  if (!force && session.rows[0].processing_state === "completed") {
    res.json({
      destinations_matched: 0,
      routes_matched: 0,
      areas_linked: 0,
      attempt_group_id: null,
      attempt_group_session_count: 0,
      skipped: true,
    });
    return;
  }

  // Verify session has tracking points
  const pointCount = await db.query(
    `SELECT COUNT(*) AS cnt FROM tracking_points WHERE session_id = $1`,
    [id]
  );
  if (parseInt(pointCount.rows[0].cnt) === 0) {
    res.status(400).json({ error: "Session has no tracking points" });
    return;
  }

  try {
    const result = await processSession(id, uid, { force });
    if (!result.skipped) {
      notifySessionProcessed(id, uid, result.destinations_matched, result.routes_matched)
        .catch((err) => console.error("Slack notify failed:", err));
    }
    res.json(result);
  } catch (err) {
    console.error("Error processing session:", err);
    res.status(500).json({ error: "Failed to process session" });
  }
});

// GET /api/sessions/:id/group — get previous attempts (group members)
router.get("/:id/group", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  // Get session's group_id
  const session = await db.query(
    `SELECT group_id, user_id = $2 AS is_owner FROM tracking_sessions
     WHERE id = $1 AND (user_id = $2 OR is_public = true)`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const groupId = session.rows[0].group_id;
  const isOwner = session.rows[0].is_owner === true;
  if (!groupId) {
    res.json({ group_id: null, group: null, sessions: [] });
    return;
  }
  if (!isOwner) {
    res.json({ group_id: null, group: null, sessions: [] });
    return;
  }

  const result = await db.query(
    `SELECT s.id, s.name, s.start_time, s.end_time,
            s.distance, s.total_time, s.gain, s.highest_point,
            s.activity_type, s.created_at, s.link_opt_out
     FROM tracking_sessions s
     WHERE s.group_id = $1
     ORDER BY s.start_time ASC`,
    [groupId]
  );
  const groupMeta = await db.query(
    `SELECT id, name, manually_linked, created_at, updated_at
       FROM session_groups WHERE id = $1`,
    [groupId]
  );

  res.json({
    group_id: groupId,
    group: groupMeta.rows[0] ?? null,
    sessions: result.rows,
  });
});

// POST /api/sessions/groups — create a group containing two or more sessions
router.post("/groups", async (req, res: Response) => {
  const uid = getUid(req);
  const { session_ids, manually_linked } = req.body as { session_ids?: string[]; manually_linked?: boolean };

  if (!Array.isArray(session_ids) || session_ids.length < 2) {
    res.status(400).json({ error: "session_ids must be an array of at least 2 ids" });
    return;
  }

  // Verify all sessions belong to the caller
  const owned = await db.query(
    `SELECT id FROM tracking_sessions WHERE id = ANY($1) AND user_id = $2`,
    [session_ids, uid]
  );
  if (owned.rows.length !== session_ids.length) {
    res.status(403).json({ error: "One or more sessions not owned or not found" });
    return;
  }

  const groupId = generateId();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO session_groups (id, user_id, manually_linked) VALUES ($1, $2, $3)`,
      [groupId, uid, manually_linked === true]
    );
    await client.query(
      `UPDATE tracking_sessions SET group_id = $1, link_opt_out = false WHERE id = ANY($2)`,
      [groupId, session_ids]
    );
    await client.query("COMMIT");
    res.json({ id: groupId, manually_linked: manually_linked === true, member_ids: session_ids });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error creating session group:", err);
    res.status(500).json({ error: "Failed to create session group" });
  } finally {
    client.release();
  }
});

// POST /api/sessions/:id/group/:groupId — join an existing group
router.post("/:id/group/:groupId", async (req, res: Response) => {
  const uid = getUid(req);
  const { id, groupId } = req.params;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const owned = await client.query(
      `SELECT id FROM tracking_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id, uid]
    );
    if (owned.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const group = await client.query(
      `SELECT id FROM session_groups WHERE id = $1 AND user_id = $2`,
      [groupId, uid]
    );
    if (group.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Group not found" });
      return;
    }

    const result = await client.query(
      `UPDATE tracking_sessions SET group_id = $1, link_opt_out = false WHERE id = $2`,
      [groupId, id]
    );
    if (result.rowCount !== 1) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Session not found" });
      return;
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[POST /:id/group/:groupId]", e);
    res.status(500).json({ error: "Internal error" });
  } finally {
    client.release();
  }
});

// DELETE /api/sessions/:id/group — leave the current group; auto-link will skip this session going forward
router.delete("/:id/group", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Read old group_id BEFORE the update (post-update subselect would return NULL)
    const pre = await client.query(
      `SELECT group_id FROM tracking_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id, uid]
    );
    if (pre.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const oldGroupId: string | null = pre.rows[0].group_id;

    await client.query(
      `UPDATE tracking_sessions SET group_id = NULL, link_opt_out = true WHERE id = $1`,
      [id]
    );

    if (oldGroupId) {
      // Delete the group if it's now empty
      await client.query(
        `DELETE FROM session_groups
           WHERE id = $1
             AND NOT EXISTS (SELECT 1 FROM tracking_sessions WHERE group_id = $1)`,
        [oldGroupId]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error leaving session group:", err);
    res.status(500).json({ error: "Failed to leave session group" });
  } finally {
    client.release();
  }
});

// POST /api/sessions/groups/:id/merge — merge another group into this one
// Body: { other_group_id: string }
// Survivor is the group with older created_at; tie-break on lex id.
router.post("/groups/:id/merge", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const { other_group_id } = req.body as { other_group_id?: string };
  if (!other_group_id) {
    res.status(400).json({ error: "other_group_id required" });
    return;
  }

  if (other_group_id === id) {
    res.status(400).json({ error: "other_group_id must differ from the URL :id" });
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const groups = await client.query(
      `SELECT id, created_at, manually_linked
         FROM session_groups
         WHERE id IN ($1, $2) AND user_id = $3
         FOR UPDATE`,
      [id, other_group_id, uid]
    );
    if (groups.rows.length !== 2) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Both groups must exist and be owned by the caller" });
      return;
    }

    // Pick survivor: older created_at, then lex id
    const sorted = groups.rows.sort((a, b) => {
      const t = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (t !== 0) return t;
      return a.id < b.id ? -1 : 1;
    });
    const survivor = sorted[0];
    const loser = sorted[1];
    const survivorManually = survivor.manually_linked || loser.manually_linked;

    await client.query(
      `UPDATE tracking_sessions SET group_id = $1 WHERE group_id = $2 AND user_id = $3`,
      [survivor.id, loser.id, uid]
    );
    await client.query(
      `UPDATE session_groups SET manually_linked = $1 WHERE id = $2`,
      [survivorManually, survivor.id]
    );
    await client.query(`DELETE FROM session_groups WHERE id = $1`, [loser.id]);

    await client.query("COMMIT");
    res.json({ survivor_id: survivor.id, manually_linked: survivorManually });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[POST /groups/:id/merge]", e);
    res.status(500).json({ error: "Internal error" });
  } finally {
    client.release();
  }
});

// PATCH /api/sessions/groups/:id — rename or toggle manually_linked
router.patch("/groups/:id", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const { name, manually_linked } = req.body as { name?: string | null; manually_linked?: boolean };

  const updates: string[] = [];
  const values: any[] = [];
  let i = 1;
  if (name !== undefined) { updates.push(`name = $${i++}`); values.push(name); }
  if (manually_linked !== undefined) { updates.push(`manually_linked = $${i++}`); values.push(manually_linked); }
  if (updates.length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  values.push(id, uid);
  const result = await db.query(
    `UPDATE session_groups SET ${updates.join(", ")}, updated_at = now()
       WHERE id = $${i++} AND user_id = $${i++}
       RETURNING id, name, manually_linked, created_at, updated_at`,
    values
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  res.json(result.rows[0]);
});

export const SESSION_UPSERT_SQL = `INSERT INTO tracking_sessions
  (id, user_id, name, start_time, end_time,
   distance, total_time, pace, gain, highest_point,
   ascent_time, descent_time, still_time,
   activity_type, source, external_id,
   health_data, source_contributions,
   ended, is_public)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,COALESCE($18::jsonb, '[]'::jsonb),$19,$20)
 ON CONFLICT (id) DO UPDATE SET
   name = EXCLUDED.name,
   start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
   distance = EXCLUDED.distance, total_time = EXCLUDED.total_time,
   pace = EXCLUDED.pace, gain = EXCLUDED.gain,
   highest_point = EXCLUDED.highest_point,
   ascent_time = EXCLUDED.ascent_time, descent_time = EXCLUDED.descent_time,
   still_time = EXCLUDED.still_time,
   activity_type = EXCLUDED.activity_type,
   source = EXCLUDED.source, external_id = EXCLUDED.external_id,
   health_data = COALESCE(EXCLUDED.health_data, tracking_sessions.health_data),
   source_contributions = CASE
     WHEN $18::jsonb IS NULL THEN tracking_sessions.source_contributions
     ELSE EXCLUDED.source_contributions
   END,
   ended = EXCLUDED.ended, is_public = EXCLUDED.is_public
 WHERE tracking_sessions.user_id = EXCLUDED.user_id
 RETURNING id`;

// POST /api/sessions — create a new session
router.post("/", heavyWriteGuard, async (req, res: Response) => {
  const uid = getUid(req);
  const {
    id, name, start_date, end_date,
    distance, total_time, pace, gain, high_point,
    ascent_time, descent_time, still_time,
    activity_type, source, external_id,
    health_data, source_contributions,
    ended, is_public,
    destinations_reached, destination_goals, routes: routeIds,
  } = req.body;

  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const existingSession = await client.query(
      `SELECT ended, health_data, source_contributions
       FROM tracking_sessions
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [id, uid]
    );
    const existingRow = existingSession.rows[0];
    const wasEnded = existingRow?.ended ?? false;
    const nextEnded = ended ?? false;
    const mergedHealthData = health_data === undefined
      ? null
      : mergeHealthData(existingRow?.health_data, health_data);
    const mergedSourceContributions = source_contributions === undefined
      ? null
      : mergeSourceContributions(existingRow?.source_contributions, source_contributions);

    const upserted = await client.query(
      SESSION_UPSERT_SQL,
      [
        id, uid, name || null,
        start_date || null, end_date || null,
        distance || null, total_time || null, pace || null,
        gain || null, high_point || null,
        ascent_time || null, descent_time || null, still_time || null,
        activity_type || null, source || null, external_id || null,
        jsonbParam(mergedHealthData), jsonbParam(mergedSourceContributions),
        ended ?? false, is_public ?? false,
      ]
    );
    if (upserted.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Session ID is unavailable" });
      return;
    }

    // Set destinations (client-owned 'manual' rows only; auto detections preserved)
    //
    // The recompute matters here for the same reason it does on the destinations
    // endpoint: reconcile replaces the manual reached set, so an id the client
    // has dropped loses its row and must lose its count with it. Re-processing
    // would fix the ids that survive, but it only fires on the not-ended →
    // ended transition, so an edit to an already-completed session recomputes
    // nothing at all.
    if (destinations_reached || destination_goals) {
      const priorReached = await reachedDestinationIds(client, id);
      await reconcileClientDestinations(client, id, destinations_reached, destination_goals);
      await recomputeDestinationAverages(
        client,
        Array.from(new Set([...priorReached, ...cleanDestinationIds(destinations_reached)]))
      );
    }

    // Set routes
    if (routeIds) {
      await client.query(
        `DELETE FROM session_routes WHERE session_id = $1`,
        [id]
      );
      for (const routeId of routeIds) {
        await client.query(
          `INSERT INTO session_routes (session_id, route_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, routeId]
        );
      }
    }

    await client.query(
      `DELETE FROM session_tombstones
       WHERE session_id = $1 AND user_id = $2`,
      [id, uid]
    );

    const queuedForProcessing =
      (!existingSession.rows[0] && nextEnded) || (!wasEnded && nextEnded)
        ? await markSessionPendingIfReady(client, id)
        : false;

    await client.query("COMMIT");

    const finalState = await autoProcessIfQueued(queuedForProcessing, id, uid);
    res.status(201).json({
      id,
      processing_state: finalState ?? (queuedForProcessing ? "pending" : null),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error creating session:", err);
    res.status(500).json({ error: "Failed to create session" });
  } finally {
    client.release();
  }
});

// PUT /api/sessions/:id — update session metadata
router.put("/:id", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const {
    name, start_date, end_date,
    distance, total_time, pace, gain, high_point,
    ascent_time, descent_time, still_time,
    activity_type, ended, is_public,
    health_data, source_contributions,
    destinations_reached, destination_goals, routes: routeIds,
  } = req.body;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const session = await client.query(
      `SELECT id, ended, processing_state, health_data, source_contributions
       FROM tracking_sessions
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [id, uid]
    );
    if (session.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const currentSession = session.rows[0];
    const mergedHealthData = health_data === undefined
      ? null
      : mergeHealthData(currentSession.health_data, health_data);
    const mergedSourceContributions = source_contributions === undefined
      ? null
      : mergeSourceContributions(currentSession.source_contributions, source_contributions);

    await client.query(
      `UPDATE tracking_sessions SET
         name = COALESCE($2, name),
         start_time = COALESCE($3, start_time),
         end_time = COALESCE($4, end_time),
         distance = COALESCE($5, distance),
         total_time = COALESCE($6, total_time),
         pace = COALESCE($7, pace),
         gain = COALESCE($8, gain),
         highest_point = COALESCE($9, highest_point),
         ascent_time = COALESCE($10, ascent_time),
         descent_time = COALESCE($11, descent_time),
         still_time = COALESCE($12, still_time),
         activity_type = COALESCE($13, activity_type),
         ended = COALESCE($14, ended),
         is_public = COALESCE($15, is_public),
         health_data = COALESCE($16::jsonb, health_data),
         source_contributions = COALESCE($17::jsonb, source_contributions)
       WHERE id = $1`,
      [
        id,
        name ?? null, start_date ?? null, end_date ?? null,
        distance ?? null, total_time ?? null, pace ?? null,
        gain ?? null, high_point ?? null,
        ascent_time ?? null, descent_time ?? null, still_time ?? null,
        activity_type ?? null, ended ?? null, is_public ?? null,
        jsonbParam(mergedHealthData), jsonbParam(mergedSourceContributions),
      ]
    );

    // Update destinations if provided (client-owned 'manual' rows only; auto preserved)
    //
    // This is the client's ordinary manual edit — "I did reach that summit
    // after all", or the reverse — and it is the path most likely to run
    // against a session that has already been processed, where nothing else
    // will ever recompute. See the same block in the POST upsert above.
    if (destinations_reached || destination_goals) {
      const priorReached = await reachedDestinationIds(client, id);
      await reconcileClientDestinations(client, id, destinations_reached, destination_goals);
      await recomputeDestinationAverages(
        client,
        Array.from(new Set([...priorReached, ...cleanDestinationIds(destinations_reached)]))
      );
    }

    // Update routes if provided
    if (routeIds) {
      await client.query(
        `DELETE FROM session_routes WHERE session_id = $1`,
        [id]
      );
      for (const routeId of routeIds) {
        await client.query(
          `INSERT INTO session_routes (session_id, route_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, routeId]
        );
      }
    }

    const queuedForProcessing =
      session.rows[0].ended === false && ended === true
        ? await markSessionPendingIfReady(client, id)
        : false;

    await client.query("COMMIT");

    const finalState = await autoProcessIfQueued(queuedForProcessing, id, uid);
    res.json({
      id,
      processing_state: finalState ?? (queuedForProcessing ? "pending" : null),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating session:", err);
    res.status(500).json({ error: "Failed to update session" });
  } finally {
    client.release();
  }
});

// DELETE /api/sessions/:id — delete session (cascades to points, markers, etc.)
router.delete("/:id", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // The session's ascents, read before they cascade away. Deleting a session
    // deletes its session_destinations rows, which is the last way a reached row
    // can disappear without the popularity buckets hearing about it — and the
    // most complete one. After the DELETE there is nothing left to tell us which
    // destinations to recompute.
    const priorReached = await reachedDestinationIds(client, id);

    const result = await client.query(
      `DELETE FROM tracking_sessions
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [id, uid]
    );
    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Session not found" });
      return;
    }

    await recomputeDestinationAverages(client, priorReached);

    const tombstone = await client.query(
      `INSERT INTO session_tombstones (session_id, user_id, deleted_at, server_updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (session_id, user_id) DO UPDATE SET
         deleted_at = EXCLUDED.deleted_at,
         server_updated_at = EXCLUDED.server_updated_at
       RETURNING deleted_at, server_updated_at`,
      [id, uid]
    );

    await client.query("COMMIT");
    res.json({
      deleted: true,
      id,
      deleted_at: tombstone.rows[0].deleted_at,
      server_updated_at: tombstone.rows[0].server_updated_at,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error deleting session:", err);
    res.status(500).json({ error: "Failed to delete session" });
  } finally {
    client.release();
  }
});

// POST /api/sessions/:id/points — batch insert GPS points
router.post("/:id/points", heavyWriteGuard, async (req: Request<{ id: string }>, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const { points } = req.body;

  if (!Array.isArray(points) || points.length === 0) {
    res.status(400).json({ error: "points array is required" });
    return;
  }

  // Verify ownership
  const session = await db.query(
    `SELECT id, ended FROM tracking_sessions WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const chunkSize = 250;
    let inserted = 0;
    let queuedForProcessing = false;

    for (let i = 0; i < points.length; i += chunkSize) {
      const chunk = points.slice(i, i + chunkSize);
      const { placeholders, values } = buildPointInsertQuery(id, chunk);

      if (placeholders.length === 0) {
        continue;
      }

      const insertResult = await client.query(
        `INSERT INTO tracking_points
          (session_id, time, segment_number, location, elevation,
           speed, azimuth, hdop, speed_accuracy)
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (session_id, time) DO NOTHING`,
        values
      );

      inserted += insertResult.rowCount ?? 0;
    }

    let processingState: string | null = null;
    if (inserted > 0 && session.rows[0].ended) {
      queuedForProcessing = await markSessionPendingIfReady(client, id);
      processingState = queuedForProcessing ? "pending" : session.rows[0].processing_state;
    } else if (inserted > 0) {
      await touchSession(client, id);
    }

    await client.query("COMMIT");

    // Auto-process inline. Inline await (vs fire-and-forget) so iOS gets the
    // final state in the response and Cloud Run can't kill the worker mid-process.
    const finalState = await autoProcessIfQueued(queuedForProcessing, id, uid);
    res.status(201).json({ inserted, processing_state: finalState ?? processingState });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error inserting points:", err);
    res.status(500).json({ error: "Failed to insert points" });
  } finally {
    client.release();
  }
});

// PUT /api/sessions/:id/points — REPLACE the session's entire point set.
//
// POST /:id/points is insert-only (ON CONFLICT DO NOTHING) so a client edit
// that deletes or modifies points can never propagate: the next GET resurrects
// the old track. Session auto-fix (DEM elevation reseed, gap fill, vehicle-tail
// trim) rewrites points in place, so it needs replace semantics.
//
// Transactional: delete-all + chunked re-insert + path rebuild commit together,
// so a mid-write failure can never leave a half-replaced track. Mirrors the
// PUT /api/plans/:id geometry flow — new geometry, then processing_state
// 'pending', then processing kicked after COMMIT.
router.put("/:id/points", heavyWriteGuard, async (req: Request<{ id: string }>, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const { points } = req.body;

  if (!Array.isArray(points) || points.length === 0) {
    res.status(400).json({ error: "points array is required" });
    return;
  }

  // Validate the WHOLE body before BEGIN/DELETE. On a replace the old rows are
  // already gone by the time an insert silently drops a row, so a partially
  // accepted body would commit a track the client never sent and still answer
  // 200. Two ways a row can vanish: buildPointInsertQuery skips a point with a
  // null lat/lng/time, and ON CONFLICT (session_id, time) DO NOTHING drops a
  // time repeated inside the body. Both are caller errors — reject up front so
  // `replaced` always equals points.length on a 200.
  let invalidPoints = 0;
  let duplicateTimes = 0;
  const seenTimes = new Set<unknown>();

  for (const point of points) {
    if (point == null || point.lat == null || point.lng == null || point.time == null) {
      invalidPoints++;
      continue;
    }
    if (seenTimes.has(point.time)) {
      duplicateTimes++;
      continue;
    }
    seenTimes.add(point.time);
  }

  if (invalidPoints > 0 || duplicateTimes > 0) {
    res.status(400).json({
      error: "invalid_points",
      invalid: invalidPoints,
      duplicates: duplicateTimes,
    });
    return;
  }

  // ST_MakeLine needs two points to make a line; one point yields a NULL path
  // and a session whose track silently disappears. A one-point "track" is not a
  // recording anyway.
  if (points.length < 2) {
    res.status(400).json({ error: "too_few_points", points: points.length });
    return;
  }

  // Verify ownership, and read the processing claim in the same round trip.
  // processing_state IS selected here (unlike the POST handler, which reads
  // session.rows[0].processing_state without selecting it and therefore always
  // reports undefined on that branch). Freshness of the claim is evaluated by
  // the database, not by this process, so it cannot drift on clock skew — the
  // condition is markSessionPendingIfReady's, inverted.
  const session = await db.query(
    `SELECT id,
            processing_state,
            (processing_state = 'processing'
             AND processing_started_at IS NOT NULL
             AND processing_started_at >= now() - make_interval(mins => ${STALE_PROCESSING_MINUTES}))
              AS processing_in_flight
     FROM tracking_sessions WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // A live processSession run is reading the point set this request wants to
  // delete. Replacing underneath it would commit a track that the in-flight run
  // then matches destinations against half-stale, and markSessionPendingIfReady
  // would refuse to re-queue, so the rewrite would never be re-processed. Bail
  // before touching any row; iOS treats a non-2xx as retry-later.
  if (session.rows[0].processing_in_flight) {
    res.status(409).json({ error: "processing_in_flight" });
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    await client.query(`DELETE FROM tracking_points WHERE session_id = $1`, [id]);

    const chunkSize = 250;
    let replaced = 0;

    for (let i = 0; i < points.length; i += chunkSize) {
      const chunk = points.slice(i, i + chunkSize);
      const { placeholders, values } = buildPointInsertQuery(id, chunk);

      if (placeholders.length === 0) {
        continue;
      }

      const insertResult = await client.query(
        `INSERT INTO tracking_points
          (session_id, time, segment_number, location, elevation,
           speed, azimuth, hdop, speed_accuracy)
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (session_id, time) DO NOTHING`,
        values
      );

      replaced += insertResult.rowCount ?? 0;
    }

    // The up-front validation makes this unreachable for any caller error: every
    // point has lat/lng/time, every time is unique, and the rows were just
    // deleted, so nothing can be skipped or conflicted away. If the counts still
    // disagree the schema is not what this handler believes — refuse to commit a
    // track that differs from the one the client sent.
    if (replaced !== points.length) {
      await client.query("ROLLBACK");
      console.error(
        `Point replace count mismatch for session ${id}: inserted ${replaced} of ${points.length}`
      );
      res.status(500).json({ error: "Failed to replace points" });
      return;
    }

    // Re-materialize the track (processSession Step 0) inside the same
    // transaction, so `path` can never describe the deleted point set. The
    // stuck-session sweep, the new-destination trigger and the web backfill all
    // read it. This UPDATE also bumps server_updated_at via
    // trg_tracking_sessions_updated, which puts the session on the sync feed.
    await client.query(
      `UPDATE tracking_sessions s
       SET path = (
         SELECT ST_MakeLine(tp.location::geometry ORDER BY tp.time)::geography
         FROM tracking_points tp
         WHERE tp.session_id = s.id
       )
       WHERE s.id = $1`,
      [id]
    );

    const queuedForProcessing = await markSessionPendingIfReady(client, id);

    // Read the state AFTER the queue attempt, not the value SELECTed before the
    // transaction — that one is stale the moment markSessionPendingIfReady
    // flips it to 'pending'.
    const queuedState = await client.query(
      `SELECT processing_state FROM tracking_sessions WHERE id = $1`,
      [id]
    );
    const processingState: string | null = queuedState.rows[0]?.processing_state ?? null;

    await client.query("COMMIT");

    // Inline await (vs fire-and-forget) so iOS gets the final state in the
    // response and Cloud Run can't kill the worker mid-process.
    const finalState = await autoProcessIfQueued(queuedForProcessing, id, uid);
    res.json({ replaced, processing_state: finalState ?? processingState });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error replacing points:", err);
    res.status(500).json({ error: "Failed to replace points" });
  } finally {
    client.release();
  }
});

// POST /api/sessions/:id/destinations — set reached/goal destinations, record
// rejections ("I didn't reach this") and clear them again.
//
// Body: { reached?, goals?, rejected?, unreject? }. `reached` and `goals` each
// replace their own manual set when supplied and are ignored when absent, so a
// body naming only `rejected` disturbs no manual row. A veto is cleared ONLY by
// naming the id in `unreject` — never as a side effect of a `reached` list,
// which iOS resends from possibly stale local state.
router.post("/:id/destinations", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const { reached, goals, rejected, unreject } = req.body;

  // Request-shape guards, ahead of any database work: claiming a destination as
  // both reached and rejected — or un-rejecting and rejecting it at once — is a
  // client bug, and answering 400 tells the client so instead of half-applying
  // its request.
  for (const [name, list] of [["reached", reached], ["unreject", unreject]] as const) {
    const contradictions = overlappingDestinationIds(list, rejected);
    if (contradictions.length > 0) {
      res.status(400).json({
        error: `${name} and rejected must not name the same destination: ${contradictions.join(", ")}`,
      });
      return;
    }
  }

  // Verify ownership
  const session = await db.query(
    `SELECT id FROM tracking_sessions WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Rejections FIRST. A request can reject a destination and keep it as a goal
    // in one go, and the goal insert needs the reached row already gone — the
    // two relations share the (session_id, destination_id) primary key, so a
    // standing reached row would win the conflict, the goal insert would do
    // nothing, and the rejection's delete would then leave the pair with no row
    // at all. The 400 guards above make the reverse contention impossible.
    // What the session reached BEFORE the write. Every id here can lose its row
    // in the next two statements — to the rejection, or to reconcile replacing
    // the manual set — and a lost row has to stop being counted. The request
    // itself names only some of them: dropping an id from `reached` deletes its
    // row while mentioning it nowhere.
    const priorReached = await reachedDestinationIds(client, id);

    const applied = await applyDestinationRejections(client, id, unreject, rejected);
    await reconcileClientDestinations(client, id, reached, goals);

    // Recompute the popularity buckets for every destination this write could
    // have moved: what the session reached going in, plus what the request asks
    // to add.
    //
    // Rejections are why this call has to be here at all. Their
    // session_destinations rows are gone by now, so processSession's own Step 5
    // recompute will never see them again and their buckets would keep counting
    // an ascent the user retracted.
    //
    // The un-rejected ids are included too. Un-rejecting on its own restores no
    // reached row, so the recompute is a no-op for them today — but they ride
    // along in the same UPDATE for free, and including them makes the
    // postcondition unconditional: every destination this request could have
    // affected ends up with buckets equal to its live reached rows, whichever
    // way un-reject semantics move later. It also repairs a destination whose
    // buckets the pre-B4 blind increment had already inflated.
    //
    // Goals are deliberately absent: the recompute counts reached rows only, so
    // reconciling goals cannot move a bucket.
    const touched = Array.from(
      new Set([
        ...priorReached,
        ...cleanDestinationIds(reached),
        ...applied.rejected,
        ...applied.unrejected,
      ])
    );
    await recomputeDestinationAverages(client, touched);

    // Bump the sync feed explicitly. The session_destinations trigger only fires
    // when a live row happened to exist, but a rejection with nothing to delete
    // still changes what other devices must see.
    if (applied.rejected.length > 0 || applied.unrejected.length > 0) {
      await touchSession(client, id);
    }

    await client.query("COMMIT");
    res.json({ session_id: id, rejected: applied.rejected, unrejected: applied.unrejected });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error setting destinations:", err);
    res.status(500).json({ error: "Failed to set destinations" });
  } finally {
    client.release();
  }
});

// POST /api/sessions/:id/markers — create a marker
router.post("/:id/markers", async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const { name, image, lat, lng, elevation } = req.body;

  // Verify ownership
  const session = await db.query(
    `SELECT id FROM tracking_sessions WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const result = await db.query(
    `INSERT INTO session_markers (session_id, location, name, image, created_by)
     VALUES ($1,
             ST_SetSRID(ST_MakePoint($3, $2, $4), 4326)::geography,
             $5, $6, $7)
     RETURNING id, name, image, created_by, created_at,
               ST_Y(location::geometry) AS lat,
               ST_X(location::geometry) AS lng,
               ST_Z(location::geometry) AS elevation`,
    [id, lat ?? 0, lng ?? 0, elevation ?? 0, name ?? null, image ?? null, uid]
  );
  res.status(201).json(result.rows[0]);
});

// DELETE /api/sessions/:id/markers/:markerId — delete a marker
router.delete("/:id/markers/:markerId", async (req, res: Response) => {
  const uid = getUid(req);
  const { id, markerId } = req.params;

  // Verify session ownership
  const session = await db.query(
    `SELECT id FROM tracking_sessions WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (session.rows.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const result = await db.query(
    `DELETE FROM session_markers WHERE id = $1 AND session_id = $2 RETURNING id`,
    [markerId, id]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Marker not found" });
    return;
  }
  res.json({ deleted: true, id: markerId });
});

export default router;
