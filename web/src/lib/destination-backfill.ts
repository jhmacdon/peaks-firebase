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
 * (see cloud-sql/schema.sql). Boundary destinations use a 10m polygon match
 * regardless of feature.
 *
 * Idempotent via ON CONFLICT — safe to call repeatedly.
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
             THEN ST_DWithin(s.path, d.boundary, 10)
             ELSE ST_DWithin(s.path, d.location, destination_match_radius(d.features))
           END
     ON CONFLICT (session_id, destination_id) DO NOTHING`,
    [destinationId]
  );
  return result.rowCount ?? 0;
}
