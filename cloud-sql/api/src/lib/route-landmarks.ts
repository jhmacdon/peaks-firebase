import { buildRouteAccessSql } from "./route-access";

/** Display-only places near a short route. Never add these to
 * route_destinations: passing a camp does not make it a route objective.
 * Long trails keep their published sections rather than scanning a continent.
 */
export function buildRouteLandmarksQuery(id: string, uid: string) {
  return {
    text: `WITH route AS MATERIALIZED (
      SELECT r.path FROM routes r
      WHERE r.id = $1 AND r.status = 'active' AND r.path IS NOT NULL
        AND ${buildRouteAccessSql("r", "$2")}
        AND ST_Length(r.path) <= 100000
    ), candidates AS MATERIALIZED (
      SELECT d.id, d.name, d.elevation, d.features, d.location,
             ST_Y(d.location::geometry) AS lat,
             ST_X(d.location::geometry) AS lng,
             ST_Distance(d.location, r.path) AS route_offset_m,
             CASE WHEN 'campsite' = ANY(d.features) THEN 0
                  WHEN 'hut' = ANY(d.features) THEN 1 ELSE 2 END AS feature_rank
      FROM route r
      JOIN destinations d ON ST_DWithin(d.location, r.path, 300)
      WHERE d.owner = 'peaks' AND NULLIF(btrim(d.name), '') IS NOT NULL
        AND (
          d.features && ARRAY['campsite', 'hut']::destination_feature[]
          OR (ST_DWithin(d.location, r.path, 50)
              AND d.features && ARRAY['viewpoint', 'waterfall', 'lookout', 'fire-lookout']::destination_feature[])
        )
        AND NOT EXISTS (
          SELECT 1 FROM route_destinations rd
          JOIN destinations linked ON linked.id = rd.destination_id
          WHERE rd.route_id = $1
            AND (linked.id = d.id OR (
              lower(btrim(linked.name)) = lower(btrim(d.name))
              AND ST_DWithin(linked.location, d.location, 50)
            ))
        )
    )
    SELECT d.id, d.name, d.elevation, d.features, d.lat, d.lng, d.route_offset_m
    FROM candidates d
    WHERE NOT EXISTS (
      SELECT 1 FROM candidates other
      WHERE lower(btrim(other.name)) = lower(btrim(d.name))
        AND ST_DWithin(other.location, d.location, 50)
        AND (other.feature_rank, other.route_offset_m, other.id)
          < (d.feature_rank, d.route_offset_m, d.id)
    )
    ORDER BY d.route_offset_m, d.id
    LIMIT 100`,
    values: [id, uid],
  };
}
