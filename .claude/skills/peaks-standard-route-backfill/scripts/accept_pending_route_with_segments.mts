#!/usr/bin/env node

import process from "node:process";
import db from "../../../../web/src/lib/db";
import {
  acceptRouteWithSegments,
  analyzePendingRoute,
} from "../../../../web/src/lib/actions/routes";

function valueAfter(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? "" : "";
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    "Usage: accept_pending_route_with_segments.mts --route-id ID " +
      "--destination-id ID --lease-token TOKEN " +
      "[--apply --acknowledge-map-review --acknowledge-segment-plan]"
  );
  process.exit(0);
}
const routeId = valueAfter(argv, "--route-id");
const destinationId = valueAfter(argv, "--destination-id");
const leaseToken = valueAfter(argv, "--lease-token");
const apply = argv.includes("--apply");
for (const [flag, value] of [
  ["--route-id", routeId],
  ["--destination-id", destinationId],
  ["--lease-token", leaseToken],
]) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${flag} is required and contains unsupported characters`);
  }
}
if (
  apply &&
  (!argv.includes("--acknowledge-map-review") ||
    !argv.includes("--acknowledge-segment-plan"))
) {
  throw new Error(
    "--apply requires --acknowledge-map-review and " +
      "--acknowledge-segment-plan"
  );
}

try {
  const jobResult = await db.query<{
    destination_id: string;
    replacement_route_id: string | null;
  }>(
    `SELECT destination_id, replacement_route_id
     FROM standard_route_backfill_jobs
     WHERE destination_id = $1
       AND state = 'approved'
       AND published_route_id = $2
       AND lease_token = $3
       AND lease_expires_at >= now()`,
    [destinationId, routeId, leaseToken]
  );
  if (!jobResult.rows[0]) {
    throw new Error("Route activation is not bound to this approved job lease");
  }
  const replacementRouteId = jobResult.rows[0].replacement_route_id;
  const routeResult = await db.query<{
    name: string;
    owner: string;
    status: string;
    segment_count: number;
  }>(
    `SELECT r.name, r.owner, r.status,
            COUNT(rs.segment_id)::int AS segment_count
     FROM routes r
     LEFT JOIN route_segments rs ON rs.route_id = r.id
     WHERE r.id = $1
     GROUP BY r.id`,
    [routeId]
  );
  const route = routeResult.rows[0];
  if (!route) throw new Error("Route was not found");
  if (route.owner !== "peaks") {
    throw new Error("Route must be Peaks-owned");
  }

  if (route.status === "active") {
    if (route.segment_count < 1) {
      throw new Error("Active route has no segments");
    }
    if (replacementRouteId) {
      const replacement = await db.query<{
        status: string;
        destination_linked: boolean;
      }>(
        `SELECT r.status,
                EXISTS (
                  SELECT 1
                  FROM route_destinations rd
                  WHERE rd.route_id = r.id
                    AND rd.destination_id = $2
                ) AS destination_linked
         FROM routes r
         WHERE r.id = $1`,
        [replacementRouteId, destinationId]
      );
      if (
        replacement.rows[0]?.status !== "superseded" ||
        !replacement.rows[0]?.destination_linked
      ) {
        throw new Error("Replacement route was not superseded");
      }
    }
    console.log(`Route ${routeId} is already active after an earlier run`);
    console.log(
      JSON.stringify({
        mode: apply ? "apply" : "dry_run",
        status: "active",
        route_id: routeId,
        segment_count: route.segment_count,
        replacement_route_id: replacementRouteId,
        reused: true,
      })
    );
  } else {
    if (route.status !== "pending") {
      throw new Error(`Route must be pending or active, found ${route.status}`);
    }
    if (replacementRouteId) {
      const replacement = await db.query<{
        status: string;
        destination_linked: boolean;
      }>(
        `SELECT r.status,
                EXISTS (
                  SELECT 1
                  FROM route_destinations rd
                  WHERE rd.route_id = r.id
                    AND rd.destination_id = $2
                ) AS destination_linked
         FROM routes r
         WHERE r.id = $1`,
        [replacementRouteId, destinationId]
      );
      if (
        replacement.rows[0]?.status !== "active" ||
        !replacement.rows[0]?.destination_linked
      ) {
        throw new Error("Active replacement route is not eligible");
      }
    }
    const { decomposition } = await analyzePendingRoute(routeId);
    console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
    console.log(`Route: ${route.name} (${routeId})`);
    console.log(
      `Plan: ${decomposition.segments.length} segments; ` +
        `${decomposition.segments.filter((segment) => segment.type === "existing").length} reused; ` +
        `${decomposition.segments.filter((segment) => segment.type === "split").length} split-backed; ` +
        `${decomposition.segments.filter((segment) => segment.type === "new").length} new`
    );
    for (const [index, segment] of decomposition.segments.entries()) {
      console.log(
        `  ${index}: ${segment.type}; ${(segment.distance / 1609.344).toFixed(2)} mi; ` +
          (segment.existingSegmentId ??
            segment.parentSegmentId ??
            segment.name ??
            "new")
      );
    }
    if (decomposition.splits.length > 0) {
      console.log(
        `Splits: ` +
          decomposition.splits
            .map(
              (split) =>
                `${split.originalSegmentId}@${split.fractions.join(",")}`
            )
            .join(" | ")
      );
    }
    if (decomposition.affectedRoutes.length > 0) {
      console.log(
        `Affected routes: ` +
          [
            ...new Set(
              decomposition.affectedRoutes.map(
                (affected) => `${affected.routeName} (${affected.routeId})`
              )
            ),
          ].join(" | ")
      );
    }
    if (
      apply &&
      (decomposition.splits.length > 0 ||
        decomposition.affectedRoutes.length > 0)
    ) {
      throw new Error(
        "Shared-segment changes require human web-admin review"
      );
    }
    if (!apply) {
      console.log("DRY RUN — no rows written");
    } else {
      await acceptRouteWithSegments(
        routeId,
        replacementRouteId,
        destinationId
      );
      const verified = await db.query<{
        status: string;
        segment_count: number;
      }>(
        `SELECT r.status,
                COUNT(rs.segment_id)::int AS segment_count
         FROM routes r
         LEFT JOIN route_segments rs ON rs.route_id = r.id
         WHERE r.id = $1
         GROUP BY r.id`,
        [routeId]
      );
      if (
        verified.rows[0]?.status !== "active" ||
        verified.rows[0]?.segment_count < 1
      ) {
        throw new Error("Route activation verification failed");
      }
      if (replacementRouteId) {
        const replacement = await db.query<{
          status: string;
          destination_linked: boolean;
        }>(
          `SELECT r.status,
                  EXISTS (
                    SELECT 1
                    FROM route_destinations rd
                    WHERE rd.route_id = r.id
                      AND rd.destination_id = $2
                  ) AS destination_linked
           FROM routes r
           WHERE r.id = $1`,
          [replacementRouteId, destinationId]
        );
        if (
          replacement.rows[0]?.status !== "superseded" ||
          !replacement.rows[0]?.destination_linked
        ) {
          throw new Error("Replacement route supersede verification failed");
        }
      }
      console.log(
        `Activated ${routeId} with ${verified.rows[0].segment_count} segments`
      );
      console.log(
        JSON.stringify({
          mode: "apply",
          status: "active",
          route_id: routeId,
          segment_count: verified.rows[0].segment_count,
          replacement_route_id: replacementRouteId,
          reused: false,
        })
      );
    }
  }
} finally {
  await db.end();
}
