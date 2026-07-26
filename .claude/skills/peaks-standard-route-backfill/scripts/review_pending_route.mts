import process from "node:process";
import dbImport from "../../../../cloud-sql/migrate/src/db";

const db =
  typeof (dbImport as { query?: unknown }).query === "function"
    ? dbImport
    : (dbImport as unknown as { default: typeof dbImport }).default;

type Options = {
  routeId: string;
  activate: boolean;
  acknowledgeMapReview: boolean;
};

type OverlapRow = {
  segment_id: string;
  segment_name: string | null;
  matched_points: number;
  total_points: number;
  match_pct: number;
  route_names: string | null;
};

function usage(): string {
  return [
    "Usage:",
    "  tsx review_pending_route.mts --route-id ID",
    "  tsx review_pending_route.mts --route-id ID --activate --acknowledge-map-review",
    "",
    "Runs read-only geometry and segment-overlap checks by default.",
    "Activation is allowed only when no existing segment overlap needs admin review.",
  ].join("\n");
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    routeId: "",
    activate: false,
    acknowledgeMapReview: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--route-id") {
      options.routeId = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--activate") {
      options.activate = true;
    } else if (arg === "--acknowledge-map-review") {
      options.acknowledgeMapReview = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!/^[A-Za-z0-9_-]+$/.test(options.routeId)) {
    throw new Error("--route-id is required and may contain only letters, numbers, _ and -");
  }

  if (options.activate && !options.acknowledgeMapReview) {
    throw new Error("Activation requires --acknowledge-map-review");
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));

try {
  const routeResult = await db.query(
    `WITH target AS (
       SELECT r.*,
              (SELECT d.location::geometry
               FROM route_destinations rd
               JOIN destinations d ON d.id = rd.destination_id
               WHERE rd.route_id = r.id AND rd.ordinal = 0) AS trailhead,
              (SELECT d.location::geometry
               FROM route_destinations rd
               JOIN destinations d ON d.id = rd.destination_id
               WHERE rd.route_id = r.id
               ORDER BY rd.ordinal DESC
               LIMIT 1) AS summit
       FROM routes r
       WHERE r.id = $1
     ),
     steps AS (
       SELECT (dp).path[1] AS point_number,
              (dp).geom AS point,
              LAG((dp).geom) OVER (ORDER BY (dp).path[1]) AS prior_point
       FROM target
       CROSS JOIN LATERAL ST_DumpPoints(target.path::geometry) dp
     )
     SELECT target.id, target.name, target.owner, target.status,
            target.shape, target.completion, target.distance,
            target.gain, target.gain_loss,
            ST_NPoints(target.path::geometry)::int AS point_count,
            ST_IsSimple(target.path::geometry) AS is_simple,
            ST_ZMin(Box3D(target.path::geometry)) AS min_z,
            ST_ZMax(Box3D(target.path::geometry)) AS max_z,
            ST_Distance(
              ST_StartPoint(target.path::geometry)::geography,
              target.trailhead::geography
            ) AS start_to_trailhead_m,
            ST_Distance(
              ST_EndPoint(target.path::geometry)::geography,
              target.summit::geography
            ) AS end_to_summit_m,
            (SELECT MAX(ST_Distance(point::geography, prior_point::geography))
             FROM steps
             WHERE prior_point IS NOT NULL) AS max_step_m
     FROM target`,
    [options.routeId]
  );

  if (routeResult.rows.length === 0) {
    throw new Error(`Route not found: ${options.routeId}`);
  }

  const route = routeResult.rows[0];
  if (route.owner !== "peaks") {
    throw new Error(`Route owner must be peaks, found ${route.owner}`);
  }
  if (route.status !== "pending") {
    throw new Error(`Route status must be pending, found ${route.status}`);
  }

  const overlapResult = await db.query<OverlapRow>(
    `WITH target AS (
       SELECT path::geometry AS path
       FROM routes
       WHERE id = $1
     ),
     points AS (
       SELECT (dp).path[1] AS point_number,
              (dp).geom AS point
       FROM target
       CROSS JOIN LATERAL ST_DumpPoints(target.path) dp
     ),
     totals AS (
       SELECT COUNT(*)::int AS total_points FROM points
     ),
     current_segments AS (
       SELECT segment_id FROM route_segments WHERE route_id = $1
     ),
     candidate_segments AS (
       SELECT s.id, s.name
       FROM segments s, target
       WHERE s.id NOT IN (SELECT segment_id FROM current_segments)
         AND ST_DWithin(s.path, target.path::geography, 90)
     )
     SELECT candidate_segments.id AS segment_id,
            candidate_segments.name AS segment_name,
            COUNT(*) FILTER (
              WHERE ST_DWithin(
                points.point::geography,
                segments.path,
                30
              )
            )::int AS matched_points,
            totals.total_points,
            ROUND(
              100.0 * COUNT(*) FILTER (
                WHERE ST_DWithin(
                  points.point::geography,
                  segments.path,
                  30
                )
              ) / totals.total_points,
              1
            )::float8 AS match_pct,
            STRING_AGG(DISTINCT routes.name, ' | ' ORDER BY routes.name)
              AS route_names
     FROM candidate_segments
     JOIN segments ON segments.id = candidate_segments.id
     CROSS JOIN points
     CROSS JOIN totals
     LEFT JOIN route_segments
       ON route_segments.segment_id = candidate_segments.id
     LEFT JOIN routes ON routes.id = route_segments.route_id
     GROUP BY candidate_segments.id, candidate_segments.name,
              segments.path, totals.total_points
     HAVING COUNT(*) FILTER (
       WHERE ST_DWithin(points.point::geography, segments.path, 30)
     ) >= 3
     ORDER BY matched_points DESC, candidate_segments.id`,
    [options.routeId]
  );

  console.log(`Mode: ${options.activate ? "ACTIVATE" : "DRY RUN"}`);
  console.log(`Route: ${route.name} (${route.id})`);
  console.log(
    `Geometry: ${(Number(route.distance) / 1609.344).toFixed(2)} mi; ` +
      `${Math.round(Number(route.gain) * 3.28084)} ft gain; ${route.point_count} points; ` +
      `Z ${Number(route.min_z).toFixed(1)}-${Number(route.max_z).toFixed(1)} m`
  );
  console.log(
    `Endpoints: trailhead ${Number(route.start_to_trailhead_m).toFixed(1)} m; ` +
      `summit ${Number(route.end_to_summit_m).toFixed(1)} m; ` +
      `largest step ${Number(route.max_step_m).toFixed(1)} m; ` +
      `simple=${route.is_simple}`
  );

  if (overlapResult.rows.length === 0) {
    console.log("Existing segment overlap: none above the 3-point, 30 m review threshold");
  } else {
    console.log("Existing segment overlap candidates:");
    for (const overlap of overlapResult.rows) {
      console.log(
        `  ${overlap.segment_name ?? overlap.segment_id} (${overlap.segment_id}): ` +
          `${overlap.matched_points}/${overlap.total_points} points, ` +
          `${overlap.match_pct.toFixed(1)}%; routes=${overlap.route_names ?? "none"}`
      );
    }
  }

  if (!options.activate) {
    console.log(
      overlapResult.rows.length > 0
        ? "DRY RUN — use the admin segment review before activation"
        : "DRY RUN — review the map before activation"
    );
  } else {
    if (overlapResult.rows.length > 0) {
      throw new Error("Existing segment overlap requires the admin segment review");
    }
    const activated = await db.query(
      `UPDATE routes
       SET status = 'active'
       WHERE id = $1 AND owner = 'peaks' AND status = 'pending'
       RETURNING id, name, status`,
      [options.routeId]
    );
    if (activated.rows.length !== 1) {
      throw new Error("Route was not activated");
    }
    console.log(`Activated ${activated.rows[0].name} (${activated.rows[0].id})`);
  }
} finally {
  await db.end();
}
