export function buildPublicSessionRoutesQuery(sessionId: string): {
  text: string;
  values: unknown[];
} {
  return {
    text: `SELECT r.id, r.name, r.polyline6, r.distance, r.gain, r.provenance,
                  (r.owner = 'peaks') AS is_catalog
           FROM session_routes sr
           JOIN routes r ON r.id = sr.route_id
           JOIN tracking_sessions ts ON ts.id = sr.session_id
           WHERE sr.session_id = $1 AND ts.is_public = true
             AND r.status IN ('active', 'superseded')
             AND (r.owner = 'peaks' OR r.owner = ts.user_id)
           ORDER BY r.name ASC NULLS LAST`,
    values: [sessionId],
  };
}
