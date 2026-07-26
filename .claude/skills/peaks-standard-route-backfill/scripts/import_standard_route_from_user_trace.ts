#!/usr/bin/env node

import db from "../../../../cloud-sql/migrate/src/db";
import {
  computeElevationStats,
  fetchElevations,
} from "../../../../web/src/lib/elevation";
import { haversineDistance } from "../../../../web/src/lib/gpx";
import {
  encodePolyline6,
  generateId,
  pointsToLineStringZ,
  type TrackPoint,
} from "../../../../web/src/lib/route-utils";

interface Args {
  sourceRouteId: string;
  destinationId: string;
  name: string;
  expectedOwner: string;
  sourceLinks: { type: string; id: string }[];
  apply: boolean;
  acknowledgeTraceRights: boolean;
}

interface SourcePoint {
  index: number;
  lat: number;
  lng: number;
  summitDistance: number;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summit: { id: string; name: string; distance: number } | null;
  trailhead: { id: string; name: string; distance: number } | null;
  stats: {
    distance: number;
    gain: number;
    loss: number;
  };
}

const HELP = `Usage:
  tsx import_standard_route_from_user_trace.ts \\
    --source-route-id ID \\
    --destination-id ID \\
    --name "Peak via Standard Route" \\
    --expected-owner USER_ID \\
    --source-url type=https://direct/source/page \\
    [--apply --acknowledge-trace-rights]

Dry-run is the default. Apply creates a Peaks-owned pending route; it never
activates a route. The source trace must belong to the expected owner.
`;

function valueAfter(argv: string[], flag: string): string {
  const prefix = `${flag}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(flag);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--")) {
    return argv[index + 1];
  }
  return "";
}

function parseArgs(argv: string[]): Args {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }

  const sourceRouteId = valueAfter(argv, "--source-route-id");
  const destinationId = valueAfter(argv, "--destination-id");
  const name = valueAfter(argv, "--name");
  const expectedOwner = valueAfter(argv, "--expected-owner");
  const sourceValues: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg.startsWith("--source-url=")) {
      sourceValues.push(arg.slice("--source-url=".length));
    } else if (arg === "--source-url" && argv[index + 1]) {
      sourceValues.push(argv[++index]);
    }
  }

  const sourceLinks = sourceValues.map((value) => {
    const separator = value.indexOf("=");
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error(`Invalid --source-url "${value}"; expected type=https://...`);
    }
    const type = value.slice(0, separator).trim();
    const id = value.slice(separator + 1).trim();
    if (!/^https:\/\//.test(id)) {
      throw new Error(`Source URL must use HTTPS: ${id}`);
    }
    return { type, id };
  });

  if (!sourceRouteId || !destinationId || !name || !expectedOwner) {
    throw new Error(`Missing required argument.\n\n${HELP}`);
  }
  if (sourceLinks.length === 0) {
    throw new Error("At least one direct --source-url is required");
  }

  return {
    sourceRouteId,
    destinationId,
    name,
    expectedOwner,
    sourceLinks,
    apply: argv.includes("--apply"),
    acknowledgeTraceRights: argv.includes("--acknowledge-trace-rights"),
  };
}

async function loadSource(args: Args) {
  const result = await db.query(
    `SELECT r.id, r.name, r.owner, r.status,
            d.id AS destination_id, d.name AS destination_name,
            ST_Y(d.location::geometry) AS destination_lat,
            ST_X(d.location::geometry) AS destination_lng,
            ARRAY(
              SELECT l.name
              FROM list_destinations ld
              JOIN lists l ON l.id = ld.list_id
              WHERE ld.destination_id = d.id AND l.owner = 'peaks'
              ORDER BY l.name
            ) AS list_names,
            EXISTS (
              SELECT 1
              FROM route_destinations current_rd
              JOIN routes current_r ON current_r.id = current_rd.route_id
              WHERE current_rd.destination_id = d.id
                AND current_r.owner = 'peaks'
                AND current_r.status = 'active'
            ) AS has_standard_route,
            EXISTS (
              SELECT 1
              FROM route_destinations source_rd
              WHERE source_rd.route_id = r.id
                AND source_rd.destination_id = d.id
            ) AS source_is_linked
     FROM routes r
     CROSS JOIN destinations d
     WHERE r.id = $1 AND d.id = $2`,
    [args.sourceRouteId, args.destinationId]
  );

  if (result.rows.length === 0) {
    throw new Error("Source route or destination was not found");
  }

  const source = result.rows[0];
  if (source.owner !== args.expectedOwner) {
    throw new Error(
      `Source route owner mismatch: expected ${args.expectedOwner}, found ${source.owner}`
    );
  }
  if (!source.source_is_linked) {
    throw new Error("Source route is not linked to the requested destination");
  }
  if (source.has_standard_route) {
    throw new Error("Destination already has an active Peaks-owned standard route");
  }
  if (!Array.isArray(source.list_names) || source.list_names.length === 0) {
    throw new Error("Destination is not on a Peaks-owned list");
  }

  return source;
}

async function loadSourcePoints(
  routeId: string,
  destinationId: string
): Promise<SourcePoint[]> {
  const result = await db.query(
    `SELECT (dp).path[1]::int AS point_index,
            ST_Y((dp).geom) AS lat,
            ST_X((dp).geom) AS lng,
            ST_Distance((dp).geom::geography, d.location) AS summit_distance
     FROM routes r
     JOIN destinations d ON d.id = $2,
          LATERAL ST_DumpPoints(r.path::geometry) dp
     WHERE r.id = $1
     ORDER BY point_index`,
    [routeId, destinationId]
  );

  if (result.rows.length < 5) {
    throw new Error("Source route has fewer than five geometry points");
  }

  return result.rows.map((row) => ({
    index: Number(row.point_index),
    lat: Number(row.lat),
    lng: Number(row.lng),
    summitDistance: Number(row.summit_distance),
  }));
}

async function nearestTrailhead(point: SourcePoint) {
  const result = await db.query(
    `SELECT id, name,
            ST_Distance(
              location,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
            ) AS distance
     FROM destinations
     WHERE 'trailhead'::destination_feature = ANY(features)
     ORDER BY location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
     LIMIT 1`,
    [point.lng, point.lat]
  );
  return {
    id: String(result.rows[0].id),
    name: String(result.rows[0].name),
    distance: Number(result.rows[0].distance),
  };
}

async function extractAscent(points: SourcePoint[]): Promise<{
  points: TrackPoint[];
  orientation: "forward" | "reverse";
  summitSourceIndex: number;
  summitOffset: number;
}> {
  const startTrailhead = await nearestTrailhead(points[0]);
  const endTrailhead = await nearestTrailhead(points[points.length - 1]);
  const orientation =
    startTrailhead.distance <= endTrailhead.distance ? "forward" : "reverse";
  const ordered = orientation === "forward" ? points : [...points].reverse();

  let summitArrayIndex = 0;
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index].summitDistance < ordered[summitArrayIndex].summitDistance) {
      summitArrayIndex = index;
    }
  }

  const clipped = ordered.slice(0, summitArrayIndex + 1);
  const elevations = await fetchElevations(
    clipped.map((point) => ({ lat: point.lat, lng: point.lng }))
  );

  let cumulativeDistance = 0;
  const trackPoints = clipped.map((point, index) => {
    if (index > 0) {
      cumulativeDistance += haversineDistance(
        clipped[index - 1].lat,
        clipped[index - 1].lng,
        point.lat,
        point.lng
      );
    }
    return {
      lat: point.lat,
      lng: point.lng,
      ele: elevations[index],
      dist: Math.round(cumulativeDistance * 10) / 10,
    };
  });

  return {
    points: trackPoints,
    orientation,
    summitSourceIndex: clipped[clipped.length - 1].index,
    summitOffset: clipped[clipped.length - 1].summitDistance,
  };
}

async function validateCandidate(
  name: string,
  points: TrackPoint[]
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const distance = points[points.length - 1]?.dist ?? 0;
  const elevationStats = computeElevationStats(points.map((point) => point.ele));
  const end = points[points.length - 1];
  const start = points[0];

  if (points.length < 5) errors.push("Route has fewer than five points");
  if (distance < 1600) errors.push("Route is shorter than 1,600 m");
  if (elevationStats.gain < 200) errors.push("Route gains less than 200 m");
  if (
    elevationStats.loss > elevationStats.gain * 1.5 &&
    elevationStats.loss > 100
  ) {
    errors.push("Route descends more than it climbs");
  }

  const summitResult = await db.query(
    `SELECT id, name,
            ST_Distance(
              location,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
            ) AS distance
     FROM destinations
     WHERE 'summit'::destination_feature = ANY(features)
       AND ST_DWithin(
         location,
         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
         250
       )
     ORDER BY distance
     LIMIT 1`,
    [end.lng, end.lat]
  );
  const summit =
    summitResult.rows.length > 0
      ? {
          id: String(summitResult.rows[0].id),
          name: String(summitResult.rows[0].name),
          distance: Math.round(Number(summitResult.rows[0].distance)),
        }
      : null;
  if (!summit) errors.push("No summit lies within 250 m of the route endpoint");

  const trailheadResult = await db.query(
    `SELECT id, name,
            ST_Distance(
              location,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
            ) AS distance
     FROM destinations
     WHERE 'trailhead'::destination_feature = ANY(features)
       AND ST_DWithin(
         location,
         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
         300
       )
     ORDER BY distance
     LIMIT 1`,
    [start.lng, start.lat]
  );
  const trailhead =
    trailheadResult.rows.length > 0
      ? {
          id: String(trailheadResult.rows[0].id),
          name: String(trailheadResult.rows[0].name),
          distance: Math.round(Number(trailheadResult.rows[0].distance)),
        }
      : null;
  if (!trailhead) warnings.push("No existing trailhead lies within 300 m");

  const wkt = pointsToLineStringZ(points);
  const duplicateResult = await db.query(
    `SELECT id, name,
            ST_HausdorffDistance(
              path::geometry,
              ST_GeomFromText($1, 4326)
            ) AS hausdorff
     FROM routes
     WHERE owner = 'peaks'
       AND path IS NOT NULL
       AND ST_DWithin(path, ST_GeomFromText($1, 4326)::geography, 1000)
     ORDER BY hausdorff
     LIMIT 1`,
    [wkt]
  );
  if (duplicateResult.rows.length > 0) {
    const hausdorffDegrees = Number(duplicateResult.rows[0].hausdorff);
    const hausdorffMeters =
      hausdorffDegrees *
      111000 *
      Math.cos((start.lat * Math.PI) / 180);
    if (hausdorffMeters < 200) {
      errors.push(
        `Duplicates Peaks route "${duplicateResult.rows[0].name}" ` +
          `(${Math.round(hausdorffMeters)} m Hausdorff distance)`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summit,
    trailhead,
    stats: {
      distance: Math.round(distance),
      gain: elevationStats.gain,
      loss: elevationStats.loss,
    },
  };
}

function printReview(
  args: Args,
  source: Record<string, unknown>,
  extracted: Awaited<ReturnType<typeof extractAscent>>,
  validation: ValidationResult
) {
  console.log(`Mode: ${args.apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Source: ${source.name} (${source.id}), owner ${source.owner}`);
  console.log(
    `Destination: ${source.destination_name} (${source.destination_id}); ` +
      `lists: ${(source.list_names as string[]).join(" | ")}`
  );
  console.log(
    `Extraction: ${extracted.orientation}, source point ` +
      `${extracted.summitSourceIndex}, summit offset ${Math.round(extracted.summitOffset)} m`
  );
  console.log(
    `Candidate: ${args.name}; ${(validation.stats.distance / 1609.344).toFixed(2)} mi ` +
      `one way; +${Math.round(validation.stats.gain * 3.28084)} ft; ` +
      `-${Math.round(validation.stats.loss * 3.28084)} ft`
  );
  console.log(
    `Trailhead: ${validation.trailhead?.name ?? "none"} ` +
      `(${validation.trailhead?.distance ?? "n/a"} m); ` +
      `summit: ${validation.summit?.name ?? "none"} ` +
      `(${validation.summit?.distance ?? "n/a"} m)`
  );
  if (validation.warnings.length > 0) {
    console.log(`Warnings: ${validation.warnings.join("; ")}`);
  }
  if (validation.errors.length > 0) {
    console.log(`Errors: ${validation.errors.join("; ")}`);
  }
  console.log(`Sources: ${args.sourceLinks.map((link) => link.id).join(" | ")}`);
}

async function createPendingRoute(
  args: Args,
  extracted: Awaited<ReturnType<typeof extractAscent>>,
  validation: ValidationResult
) {
  if (!validation.valid || validation.summit?.id !== args.destinationId) {
    throw new Error("Candidate did not pass validation for the requested summit");
  }
  if (!validation.trailhead) {
    throw new Error("Candidate has no existing trailhead within 300 m");
  }

  const routeId = generateId();
  const segmentId = generateId();
  const wkt = pointsToLineStringZ(extracted.points);
  const polyline6 = encodePolyline6(extracted.points);
  const client = await db.connect();

  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT id FROM destinations WHERE id = $1 FOR UPDATE", [
      args.destinationId,
    ]);

    const conflict = await client.query(
      `SELECT r.id, r.name, r.status
       FROM route_destinations rd
       JOIN routes r ON r.id = rd.route_id
       WHERE rd.destination_id = $1
         AND r.owner = 'peaks'
         AND (r.status = 'active' OR lower(r.name) = lower($2))
       LIMIT 1`,
      [args.destinationId, args.name]
    );
    if (conflict.rows.length > 0) {
      throw new Error(
        `A conflicting Peaks route now exists: ${conflict.rows[0].name} ` +
          `(${conflict.rows[0].status})`
      );
    }

    await client.query(
      `INSERT INTO routes (
         id, name, path, polyline6, owner, distance, gain, gain_loss,
         external_links, completion, shape, status
       )
       VALUES (
         $1, $2, ST_GeomFromText($3, 4326)::geography, $4, 'peaks',
         $5, $6, $7, $8::jsonb, 'none', 'out_and_back', 'pending'
       )`,
      [
        routeId,
        args.name,
        wkt,
        polyline6,
        validation.stats.distance,
        validation.stats.gain,
        validation.stats.loss,
        JSON.stringify(args.sourceLinks),
      ]
    );
    await client.query(
      `INSERT INTO segments (
         id, name, path, polyline6, distance, gain, gain_loss
       )
       VALUES (
         $1, $2, ST_GeomFromText($3, 4326)::geography, $4, $5, $6, $7
       )`,
      [
        segmentId,
        args.name,
        wkt,
        polyline6,
        validation.stats.distance,
        validation.stats.gain,
        validation.stats.loss,
      ]
    );
    await client.query(
      `INSERT INTO route_segments (route_id, segment_id, ordinal, direction)
       VALUES ($1, $2, 0, 'forward')`,
      [routeId, segmentId]
    );
    await client.query(
      `INSERT INTO route_destinations (route_id, destination_id, ordinal)
       VALUES ($1, $2, 0), ($1, $3, 1)`,
      [routeId, validation.trailhead.id, args.destinationId]
    );
    await client.query("COMMIT");
    console.log(`Created pending route ${routeId}`);
    return routeId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && !args.acknowledgeTraceRights) {
    throw new Error("--apply requires --acknowledge-trace-rights");
  }

  const source = await loadSource(args);
  const sourcePoints = await loadSourcePoints(args.sourceRouteId, args.destinationId);
  const extracted = await extractAscent(sourcePoints);
  const validation = await validateCandidate(args.name, extracted.points);

  printReview(args, source, extracted, validation);

  if (!validation.valid) {
    throw new Error("Candidate failed validation");
  }
  if (validation.summit?.id !== args.destinationId) {
    throw new Error(
      `Nearest summit is ${validation.summit?.id ?? "none"}, not ${args.destinationId}`
    );
  }

  if (!args.apply) {
    console.log("DRY RUN — no rows written");
    return;
  }

  await createPendingRoute(args, extracted, validation);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
