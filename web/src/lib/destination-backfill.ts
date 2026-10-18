import db from "./db";

/**
 * After a new destination is created, find every existing session whose
 * stored linestring (tracking_sessions.path) comes within the same
 * proximity threshold processSession would use for forward-matching, and
 * insert a `(session_id, destination_id, 'reached', 'auto')` row.
 *
 * Owner scope: a destination owned by 'peaks' is system-global and
 * matches all users' sessions; a user-owned destination only matches
 * that user's sessions.
 *
 * Per-feature radius is delegated to the SQL function destination_match_radius()
 * (see cloud-sql/schema.sql). Boundary destinations use
 * destination_boundary_match_radius(): 50 m for lakes, 10 m otherwise.
 *
 * Idempotent via ON CONFLICT — safe to call repeatedly.
 *
 * Rejections: a (session, destination) pair in session_destination_rejections
 * is skipped. The user vetoed that ascent; creating a destination must not
 * overrule them. Same anti-join as buildSessionDestinationMatchSql
 * (cloud-sql/api/src/processing.ts) and link_sessions_on_destination_insert
 * (cloud-sql/schema.sql) — scripts/check-cross-refs.sh fails CI if one of them
 * drifts. Later edits to the destination re-match through session_rematch_queue
 * (cloud-sql/migrations/20261004_session_rematch_queue.sql).
 *
 * Returns the number of rows inserted (sessions newly tagged).
 */
export async function backfillDestinationToSessions(
  destinationId: string
): Promise<number> {
  const result = await db.query(
    `INSERT INTO session_destinations (session_id, destination_id, relation, source)
     SELECT s.id, d.id, 'reached', 'auto'
     FROM tracking_sessions s
     JOIN destinations d ON (d.owner = 'peaks' OR d.owner = s.user_id)
     WHERE d.id = $1
       AND s.path IS NOT NULL
       AND CASE WHEN d.boundary IS NOT NULL
             -- Indexed boundary pieces: a lake outline can hold 475k points.
             THEN EXISTS (
               SELECT 1 FROM destination_boundary_parts bp
               WHERE bp.destination_id = d.id
                 AND ST_DWithin(s.path, bp.boundary_part, 50)
                 AND ST_DWithin(s.path, bp.boundary_part, destination_boundary_match_radius(d.features))
             )
             ELSE ST_DWithin(s.path, d.location, destination_match_radius(d.features))
           END
       AND NOT EXISTS (
         SELECT 1 FROM session_destination_rejections r
         WHERE r.session_id = s.id AND r.destination_id = d.id
       )
     ON CONFLICT (session_id, destination_id) DO NOTHING`,
    [destinationId]
  );
  return result.rowCount ?? 0;
}
